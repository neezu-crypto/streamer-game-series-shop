const crypto = require('node:crypto');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const catalog = require('./catalog/stickers.json');

initializeApp();
const db = getDatabase();
const REGION = 'us-central1';
const DISPLAY_MS = 5000;
const SEND_COOLDOWN_MS = 900;
const FANPAGE_DECORATION_EVENT_MS = 60000;
const FANPAGE_DECORATION_MAX_ITEMS = 100;
const GAME_IDS = new Set([
  'streamerLifeGame', 'soopStockMarket', 'streamBetMarket',
  'interior3dViewer', 'streamerJurumable', 'onyuVn', 'dontPressButton', 'streamerFanPage'
]);

const stickerIndex = new Map();
for (const product of catalog.products || []) {
  const stickers = product.preview && Array.isArray(product.preview.stickers)
    ? product.preview.stickers : [];
  stickers.forEach((sticker, index) => {
    stickerIndex.set(sticker.id, {
      id: sticker.id,
      productId: product.id,
      freeForAuthenticated: product.freeForAuthenticated === true,
      label: sticker.label,
      alt: sticker.alt,
      index,
      asset: product.preview.asset,
      columns: Number(product.preview.columns) || 1,
      rows: Number(product.preview.rows) || 1
    });
  });
}

function requireUser(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', '감정표현을 사용하려면 연결이 필요합니다.');
  }
  return request.auth.uid;
}

function ownedRecordIsActive(value) {
  return value === true || (!!value && typeof value === 'object' && value.active !== false);
}

async function canUseFreeEmotes(request, uid) {
  const provider = request.auth && request.auth.token && request.auth.token.firebase
    ? request.auth.token.firebase.sign_in_provider : null;
  if (provider && provider !== 'anonymous') return true;
  const verified = await db.ref(`users/${uid}/streamerVerified`).get();
  return verified.val() === true;
}

function normalizeRoomId(value) {
  const raw = String(value || 'public').trim();
  if (!raw || raw.length > 200) throw new HttpsError('invalid-argument', '방 식별자가 올바르지 않습니다.');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function boundedCoordinate(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new HttpsError('invalid-argument', `${name} 좌표가 올바르지 않습니다.`);
  }
  return Math.round(value * 10000) / 10000;
}

async function verifiedStreamerForUid(uid) {
  const snapshot = await db.ref('streamerVerifications')
    .orderByChild('uid').equalTo(uid).limitToFirst(1).get();
  if (!snapshot.exists()) throw new HttpsError('permission-denied', '인증된 스트리머만 본인 팬페이지를 꾸밀 수 있습니다.');
  const record = Object.values(snapshot.val() || {})[0];
  const soopId = String(record && record.soopId || '').trim().toLowerCase();
  if (!/^[a-z0-9]{2,20}$/.test(soopId)) {
    throw new HttpsError('permission-denied', '인증된 스트리머 정보를 확인할 수 없습니다.');
  }
  return soopId;
}

function activeOwnership(value) {
  return value === true || (!!value && typeof value === 'object' && value.active !== false);
}

async function publishFanpageDecorationEvent(streamerId, action, decoration, clientMutationId = '') {
  const now = Date.now();
  const roomKey = crypto.createHash('sha256').update(streamerId).digest('hex');
  const eventsRef = db.ref(`gameSeriesShop/emoteEvents/streamerFanPage/${roomKey}/events`);
  const oldEvents = await eventsRef.get();
  const updates = {};
  oldEvents.forEach((child) => {
    const previous = child.val() || {};
    const createdAt = Number(previous.createdAt || 0);
    const durationMs = Number(previous.durationMs || DISPLAY_MS);
    if (!createdAt || now - createdAt >= durationMs + 1000) {
      updates[`gameSeriesShop/emoteEvents/streamerFanPage/${roomKey}/events/${child.key}`] = null;
    }
  });
  const eventRef = eventsRef.push();
  const event = {
    eventId: eventRef.key,
    type: 'fanpage-decoration',
    action,
    createdAt: now,
    durationMs: FANPAGE_DECORATION_EVENT_MS,
  };
  if (clientMutationId) event.clientMutationId = clientMutationId;
  if (action === 'delete') event.decorationId = decoration.id;
  else if (action === 'upsert-many') event.decorations = decoration;
  else event.decoration = decoration;
  updates[`gameSeriesShop/emoteEvents/streamerFanPage/${roomKey}/events/${eventRef.key}`] = event;
  await db.ref().update(updates);
}

exports.gameSeriesFanPageDecoration = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  const uid = requireUser(request);
  const data = request.data || {};
  const action = String(data.action || '');
  const requestedStreamerId = String(data.streamerId || '').trim().toLowerCase();
  const streamerId = await verifiedStreamerForUid(uid);
  if (requestedStreamerId !== streamerId) {
    throw new HttpsError('permission-denied', '본인 팬페이지에서만 스티커를 관리할 수 있습니다.');
  }
  if (!['add', 'move', 'moveMany', 'delete'].includes(action)) {
    throw new HttpsError('invalid-argument', '지원하지 않는 스티커 작업입니다.');
  }
  const clientMutationId = String(data.clientMutationId || '');
  if (clientMutationId && !/^[A-Za-z0-9_-]{16,64}$/.test(clientMutationId)) {
    throw new HttpsError('invalid-argument', '스티커 요청 식별자가 올바르지 않습니다.');
  }

  const decorationsRef = db.ref(`streamerFanPageEmotes/${streamerId}`);
  const now = Date.now();
  let decoration;
  if (action === 'add') {
    const sticker = stickerIndex.get(String(data.stickerId || ''));
    if (!sticker) throw new HttpsError('invalid-argument', '알 수 없는 스티커입니다.');
    if (!sticker.freeForAuthenticated) {
      const ownership = await db.ref(`gameSeriesShop/ownership/${uid}/${sticker.productId}`).get();
      if (!activeOwnership(ownership.val())) {
        throw new HttpsError('permission-denied', '보유한 스티커만 팬페이지에 붙일 수 있습니다.');
      }
    }
    const x = boundedCoordinate(data.x, 'x');
    const y = boundedCoordinate(data.y, 'y');
    const decorationRef = decorationsRef.push();
    decoration = { id: decorationRef.key, stickerId: sticker.id, x, y, createdAt: now, updatedAt: now };
    let overLimit = false;
    const transaction = await decorationsRef.transaction((current) => {
      overLimit = false;
      const items = current && typeof current === 'object' ? current : {};
      if (Object.keys(items).length >= FANPAGE_DECORATION_MAX_ITEMS) {
        overLimit = true;
        return;
      }
      return { ...items, [decoration.id]: decoration };
    });
    if (!transaction.committed) {
      if (overLimit) throw new HttpsError('resource-exhausted', '팬페이지에 붙일 수 있는 스티커는 최대 100개입니다.');
      throw new HttpsError('aborted', '스티커를 저장하지 못했습니다. 다시 시도해 주세요.');
    }
    await publishFanpageDecorationEvent(streamerId, 'upsert', decoration, clientMutationId);
  } else if (action === 'moveMany') {
    if (!Array.isArray(data.decorations) || data.decorations.length < 1 || data.decorations.length > FANPAGE_DECORATION_MAX_ITEMS) {
      throw new HttpsError('invalid-argument', '이동할 스티커 목록이 올바르지 않습니다.');
    }
    const positions = data.decorations.map((item) => {
      if (!item || typeof item !== 'object') {
        throw new HttpsError('invalid-argument', '이동할 스티커 정보가 올바르지 않습니다.');
      }
      const id = String(item.id || '');
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        throw new HttpsError('invalid-argument', '스티커 항목이 올바르지 않습니다.');
      }
      return { id, x: boundedCoordinate(item.x, 'x'), y: boundedCoordinate(item.y, 'y') };
    });
    if (new Set(positions.map((item) => item.id)).size !== positions.length) {
      throw new HttpsError('invalid-argument', '같은 스티커를 여러 번 이동할 수 없습니다.');
    }

    let missingDecoration = false;
    let invalidSticker = false;
    let updatedDecorations = [];
    const transaction = await decorationsRef.transaction((current) => {
      missingDecoration = false;
      invalidSticker = false;
      updatedDecorations = [];
      // A null local cache lets the SDK fetch the server value before retrying.
      if (current === null) return null;
      const items = current && typeof current === 'object' ? current : {};
      for (const position of positions) {
        const previous = items[position.id];
        if (!previous || typeof previous !== 'object') {
          missingDecoration = true;
          return items;
        }
        if (!stickerIndex.has(String(previous.stickerId || ''))) {
          invalidSticker = true;
          return;
        }
      }
      const nextItems = { ...items };
      updatedDecorations = positions.map((position) => {
        const previous = items[position.id];
        const updated = {
          id: position.id,
          stickerId: String(previous.stickerId || ''),
          x: position.x,
          y: position.y,
          createdAt: Number(previous.createdAt) || now,
          updatedAt: now,
        };
        nextItems[position.id] = updated;
        return updated;
      });
      return nextItems;
    });
    if (!transaction.committed) {
      if (invalidSticker) throw new HttpsError('failed-precondition', '스티커 정보를 확인할 수 없습니다.');
      throw new HttpsError('aborted', '스티커 위치를 저장하지 못했습니다. 다시 시도해 주세요.');
    }
    if (missingDecoration) {
      throw new HttpsError('not-found', '팬페이지 스티커를 찾을 수 없습니다.');
    }
    decoration = updatedDecorations;
    await publishFanpageDecorationEvent(streamerId, 'upsert-many', decoration);
  } else {
    const decorationId = String(data.decorationId || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(decorationId)) {
      throw new HttpsError('invalid-argument', '스티커 항목이 올바르지 않습니다.');
    }
    if (action === 'delete') {
      const transaction = await decorationsRef.transaction((current) => {
        // Admin SDK transactions can first invoke the callback with a null local
        // cache before retrying with the server value. Returning null here lets
        // the ETag check fetch and retry against any existing decoration list.
        if (current === null) return null;
        const items = current && typeof current === 'object' ? current : {};
        if (!items[decorationId] || typeof items[decorationId] !== 'object') {
          return items;
        }
        const nextItems = { ...items };
        delete nextItems[decorationId];
        decoration = { id: decorationId };
        return Object.keys(nextItems).length ? nextItems : null;
      });
      if (!transaction.committed) {
        throw new HttpsError('aborted', '스티커를 삭제하지 못했습니다. 다시 시도해 주세요.');
      }
      if (transaction.snapshot.child(decorationId).exists()) {
        throw new HttpsError('not-found', '팬페이지 스티커를 찾을 수 없습니다.');
      }
      await publishFanpageDecorationEvent(streamerId, 'delete', decoration);
    } else {
      const x = boundedCoordinate(data.x, 'x');
      const y = boundedCoordinate(data.y, 'y');
      let invalidSticker = false;
      const transaction = await decorationsRef.transaction((current) => {
        invalidSticker = false;
        if (current === null) return null;
        const items = current && typeof current === 'object' ? current : {};
        const previous = items[decorationId];
        if (!previous || typeof previous !== 'object') {
          return items;
        }
        const stickerId = String(previous.stickerId || '');
        if (!stickerIndex.has(stickerId)) {
          invalidSticker = true;
          return;
        }
        decoration = {
          id: decorationId,
          stickerId,
          x,
          y,
          createdAt: Number(previous.createdAt) || now,
          updatedAt: now,
        };
        return { ...items, [decorationId]: decoration };
      });
      if (!transaction.committed) {
        if (invalidSticker) throw new HttpsError('failed-precondition', '스티커 정보를 확인할 수 없습니다.');
        throw new HttpsError('aborted', '스티커를 이동하지 못했습니다. 다시 시도해 주세요.');
      }
      if (!transaction.snapshot.child(decorationId).exists()) {
        throw new HttpsError('not-found', '팬페이지 스티커를 찾을 수 없습니다.');
      }
      await publishFanpageDecorationEvent(streamerId, 'upsert', decoration);
    }
  }
  return action === 'moveMany'
    ? { ok: true, decorations: decoration }
    : { ok: true, decoration };
});

exports.gameSeriesShopGetOwnedEmotes = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  const uid = requireUser(request);
  const [eligible, snapshot] = await Promise.all([
    canUseFreeEmotes(request, uid),
    db.ref(`gameSeriesShop/ownership/${uid}`).get()
  ]);
  const ownership = snapshot.val() || {};
  const ownedProductIds = new Set(Object.entries(ownership)
    .filter(([, value]) => ownedRecordIsActive(value))
    .map(([productId]) => productId));
  const stickers = [];
  for (const sticker of stickerIndex.values()) {
    if ((sticker.freeForAuthenticated && eligible) || ownedProductIds.has(sticker.productId)) {
      stickers.push({ id: sticker.id });
    }
  }
  return { eligible, stickers };
});

exports.gameSeriesShopSendEmote = onCall({ region: REGION, maxInstances: 40 }, async (request) => {
  const uid = requireUser(request);
  const data = request.data || {};
  const gameId = String(data.gameId || '');
  if (!GAME_IDS.has(gameId)) throw new HttpsError('invalid-argument', '지원하지 않는 게임입니다.');
  const sticker = stickerIndex.get(String(data.stickerId || ''));
  if (!sticker) throw new HttpsError('invalid-argument', '알 수 없는 스티커입니다.');
  const x = boundedCoordinate(data.x, 'x');
  const y = boundedCoordinate(data.y, 'y');
  const roomKey = normalizeRoomId(data.roomId);
  const clientEventId = String(data.clientEventId || '');
  if (clientEventId && !/^[A-Za-z0-9_-]{16,64}$/.test(clientEventId)) {
    throw new HttpsError('invalid-argument', '스티커 요청 식별자가 올바르지 않습니다.');
  }

  const signInProvider = request.auth.token && request.auth.token.firebase
    ? request.auth.token.firebase.sign_in_provider : null;
  if (sticker.freeForAuthenticated && signInProvider && signInProvider !== 'anonymous') {
    // 일반 로그인 계정은 무료 스티커 자격이 바로 확인되므로 추가 DB 읽기가 필요 없습니다.
  } else if (sticker.freeForAuthenticated) {
    const [eligible, ownership] = await Promise.all([
      canUseFreeEmotes(request, uid),
      db.ref(`gameSeriesShop/ownership/${uid}/${sticker.productId}`).get()
    ]);
    if (!eligible && !ownedRecordIsActive(ownership.val())) {
      throw new HttpsError('permission-denied', '로그인 유저 또는 인증 스트리머만 무료로 사용할 수 있습니다.');
    }
  } else {
    const ownership = await db.ref(`gameSeriesShop/ownership/${uid}/${sticker.productId}`).get();
    if (!ownedRecordIsActive(ownership.val())) {
      throw new HttpsError('permission-denied', '로그인 유저 또는 인증 스트리머만 무료로 사용할 수 있습니다.');
    }
  }

  const now = Date.now();
  const cooldownRef = db.ref(`gameSeriesShop/emoteRateLimits/${uid}`);
  const eventsPath = `gameSeriesShop/emoteEvents/${gameId}/${roomKey}/events`;
  const eventsRef = db.ref(eventsPath);
  const [cooldown, oldEvents] = await Promise.all([
    cooldownRef.transaction((previous) => {
      const lastSentAt = Number(previous || 0);
      if (now - lastSentAt < SEND_COOLDOWN_MS) return;
      return now;
    }),
    eventsRef.get()
  ]);
  if (!cooldown.committed) {
    throw new HttpsError('resource-exhausted', '스티커를 너무 빠르게 보내고 있어요.');
  }

  const expiredEvents = {};
  oldEvents.forEach((child) => {
    const previous = child.val() || {};
    const createdAt = Number(previous.createdAt || 0);
    const durationMs = Number(previous.durationMs || DISPLAY_MS);
    if (!createdAt || now - createdAt >= durationMs + 1000) expiredEvents[`${eventsPath}/${child.key}`] = null;
  });
  const eventRef = eventsRef.push();
  const eventId = eventRef.key;
  const event = {
    eventId,
    stickerId: sticker.id,
    x,
    y,
    createdAt: now,
    durationMs: DISPLAY_MS,
    ...(clientEventId ? { clientEventId } : {})
  };
  expiredEvents[`${eventsPath}/${eventId}`] = event;
  await db.ref().update(expiredEvents);
  return { ok: true, eventId, clientEventId, durationMs: DISPLAY_MS };
});

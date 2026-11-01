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
const WALLET_ROOT = 'gameSeriesWallet';
const WALLET_MIN_CHARGE_KRW = 1000;
const WALLET_MAX_DAILY_CHARGE_KRW = 100000;
const WALLET_KRW_PER_CASH = 100;
const WALLET_MAX_QR_BYTES = 100000;
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

async function requireWalletAdmin(request) {
  const uid = requireUser(request);
  const admin = await db.ref(`adminCenter/adminUids/${uid}`).get();
  if (admin.val() !== true) {
    throw new HttpsError('permission-denied', '관리자만 이용할 수 있습니다.');
  }
  return uid;
}

function walletDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(timestamp));
}

function walletSafeId(value, label = '요청 식별자') {
  const id = String(value || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    throw new HttpsError('invalid-argument', `${label}가 올바르지 않습니다.`);
  }
  return id;
}

function walletText(value, maxLength, label, { required = true } = {}) {
  const text = String(value || '').trim();
  if ((required && !text) || text.length > maxLength) {
    throw new HttpsError('invalid-argument', `${label}은(는) ${required ? '필수이며 ' : ''}${maxLength}자 이내로 입력해 주세요.`);
  }
  return text;
}

function walletReservedRefundCash(account, exceptRequestId = '') {
  const reservations = account && account.refundReservations && typeof account.refundReservations === 'object'
    ? account.refundReservations : {};
  return Object.entries(reservations).reduce((sum, [requestId, reservation]) => {
    if (requestId === exceptRequestId) return sum;
    return sum + Math.max(0, Math.floor(Number(reservation && reservation.cashAmount) || 0));
  }, 0);
}

async function releaseWalletRefundReservation(uid, requestId) {
  const accountRef = db.ref(`${WALLET_ROOT}/accounts/${uid}`);
  await accountRef.transaction((value) => {
    if (!value || typeof value !== 'object') return null;
    const reservations = value.refundReservations && typeof value.refundReservations === 'object'
      ? { ...value.refundReservations } : {};
    if (!Object.prototype.hasOwnProperty.call(reservations, requestId)) return value;
    delete reservations[requestId];
    const next = { ...value };
    if (Object.keys(reservations).length) next.refundReservations = reservations;
    else delete next.refundReservations;
    return next;
  }, undefined, false);
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

// 통합 캐시는 v1에서 관리자 계정만 사용할 수 있다. QR·입금자명·요청 내용과 잔액은
// RTDB 직접 접근을 열지 않고 이 관리자 인증 callable들로만 처리한다.
exports.gameSeriesWalletGetAdminState = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = await requireWalletAdmin(request);
  const base = db.ref(WALLET_ROOT);
  const [profileSnap, accountSnap, qrSnap, requestSnap, supportSnap, dailySnap, ledgerSnap] = await Promise.all([
    base.child(`profiles/${uid}`).get(),
    base.child(`accounts/${uid}`).get(),
    base.child('config/qrDataUrl').get(),
    base.child('chargeRequests').orderByKey().limitToLast(100).get(),
    base.child('supportRequests').orderByKey().limitToLast(100).get(),
    base.child(`dailyReservations/${uid}/${walletDateKey()}`).get(),
    base.child(`ledger/${uid}`).orderByKey().limitToLast(50).get(),
  ]);
  const requests = [];
  requestSnap.forEach((child) => {
    const item = child.val() || {};
    if (item.ownerUid === uid) requests.push({ requestId: child.key, ...item });
  });
  const supportRequests = [];
  supportSnap.forEach((child) => {
    const item = child.val() || {};
    if (item.ownerUid === uid) supportRequests.push({ requestId: child.key, ...item });
  });
  const ledger = [];
  ledgerSnap.forEach((child) => {
    ledger.push({ entryId: child.key, ...(child.val() || {}) });
  });
  const account = accountSnap.val() || {};
  const balanceCash = Number(account.balanceCash) || 0;
  const refundReservedCash = walletReservedRefundCash(account);
  const daily = dailySnap.val() || {};
  const reservedKrw = Object.values(daily.requests || {}).reduce((sum, item) => {
    if (item && !['cancelled', 'rejected'].includes(item.status)) return sum + (Number(item.amountKrw) || 0);
    return sum;
  }, 0);
  return {
    uid,
    balanceCash,
    refundReservedCash,
    availableRefundCash: Math.max(0, balanceCash - refundReservedCash),
    depositorName: String((profileSnap.val() || {}).depositorName || ''),
    qrDataUrl: String(qrSnap.val() || ''),
    todayReservedKrw: reservedKrw,
    todayRemainingKrw: Math.max(0, WALLET_MAX_DAILY_CHARGE_KRW - reservedKrw),
    requests: requests.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 30),
    supportRequests: supportRequests.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 20),
    ledger: ledger.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
  };
});

exports.gameSeriesWalletAdminSaveQr = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const uid = await requireWalletAdmin(request);
  const dataUrl = String((request.data || {}).qrDataUrl || '');
  const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || dataUrl.length > Math.ceil(WALLET_MAX_QR_BYTES * 4 / 3) + 100) {
    throw new HttpsError('invalid-argument', 'QR 이미지는 JPEG, PNG, WebP 파일만 올릴 수 있습니다(100KB 이하).');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > WALLET_MAX_QR_BYTES || bytes.toString('base64') !== match[2]) {
    throw new HttpsError('invalid-argument', 'QR 이미지 파일을 확인할 수 없습니다.');
  }
  const mime = match[1];
  const validSignature = mime === 'jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!validSignature) throw new HttpsError('invalid-argument', '파일 형식이 이미지 확장자와 일치하지 않습니다.');
  await db.ref(`${WALLET_ROOT}/config`).update({ qrDataUrl: dataUrl, updatedAt: Date.now(), updatedByUid: uid });
  return { ok: true, bytes: bytes.length };
});

exports.gameSeriesWalletSubmitCharge = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = await requireWalletAdmin(request);
  const data = request.data || {};
  const requestId = walletSafeId(data.requestId, '충전 요청 번호');
  const amountKrw = Number(data.amountKrw);
  if (!Number.isSafeInteger(amountKrw) || amountKrw < WALLET_MIN_CHARGE_KRW ||
      amountKrw > WALLET_MAX_DAILY_CHARGE_KRW || amountKrw % WALLET_KRW_PER_CASH !== 0) {
    throw new HttpsError('invalid-argument', '1회 최소 1,000원이며 100원 단위로 입력해 주세요.');
  }
  const depositorName = walletText(data.depositorName, 40, '입금자명');
  const base = db.ref(WALLET_ROOT);
  const qrSnap = await base.child('config/qrDataUrl').get();
  if (!qrSnap.exists()) throw new HttpsError('failed-precondition', '관리자가 입금 QR을 등록한 뒤 신청할 수 있습니다.');

  const now = Date.now();
  const dateKey = walletDateKey(now);
  const dailyRef = base.child(`dailyReservations/${uid}/${dateKey}`);
  await base.child(`profiles/${uid}`).update({ depositorName, updatedAt: now });
  let overDailyLimit = false;
  let requestIdConflict = false;
  const reservation = await dailyRef.transaction((current) => {
    overDailyLimit = false;
    requestIdConflict = false;
    const state = current && typeof current === 'object' ? current : {};
    const entries = state.requests && typeof state.requests === 'object' ? { ...state.requests } : {};
    const previous = entries[requestId];
    if (previous) {
      if (Number(previous.amountKrw) !== amountKrw || ['cancelled', 'rejected'].includes(previous.status)) {
        requestIdConflict = true;
      }
      return state;
    }
    const used = Object.values(entries).reduce((sum, entry) => {
      if (entry && !['cancelled', 'rejected'].includes(entry.status)) return sum + (Number(entry.amountKrw) || 0);
      return sum;
    }, 0);
    if (used + amountKrw > WALLET_MAX_DAILY_CHARGE_KRW) {
      overDailyLimit = true;
      return;
    }
    entries[requestId] = { amountKrw, status: 'pending', reservedAt: now };
    return { requests: entries };
  }, undefined, false);
  if (overDailyLimit) throw new HttpsError('resource-exhausted', '한국시간 기준 오늘 충전 신청 한도 100,000원을 초과합니다.');
  if (!reservation.committed) throw new HttpsError('aborted', '오늘 충전 한도를 확인하지 못했습니다. 다시 시도해 주세요.');
  if (requestIdConflict) throw new HttpsError('already-exists', '이미 사용된 충전 요청 번호입니다. 새로고침 후 다시 신청해 주세요.');

  const chargeRef = base.child(`chargeRequests/${requestId}`);
  let idConflict = false;
  let saved;
  try {
    saved = await chargeRef.transaction((current) => {
      idConflict = false;
      if (current) {
        if (current.ownerUid !== uid || Number(current.amountKrw) !== amountKrw) idConflict = true;
        return current;
      }
      return {
        ownerUid: uid,
        amountKrw,
        cashAmount: amountKrw / WALLET_KRW_PER_CASH,
        depositorName,
        dailyKey: dateKey,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
    }, undefined, false);
  } catch (error) {
    await dailyRef.child(`requests/${requestId}`).update({ status: 'cancelled' }).catch(() => {});
    throw error;
  }
  if (!saved.committed || idConflict) {
    await dailyRef.child(`requests/${requestId}`).update({ status: 'cancelled' });
    throw new HttpsError('already-exists', '충전 신청을 저장하지 못했습니다. 새 요청으로 다시 시도해 주세요.');
  }
  return { ok: true, requestId, status: String((saved.snapshot.val() || {}).status || 'pending') };
});

exports.gameSeriesWalletCancelCharge = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = await requireWalletAdmin(request);
  const requestId = walletSafeId((request.data || {}).requestId);
  const chargeRef = db.ref(`${WALLET_ROOT}/chargeRequests/${requestId}`);
  let notCancelable = false;
  const result = await chargeRef.transaction((current) => {
    notCancelable = false;
    // Admin SDK transactions may first call the updater with a local null before
    // loading the server value. Return null to let RTDB compare/retry with the
    // current server record; undefined aborts immediately and makes existing
    // requests impossible to cancel.
    if (!current || current.ownerUid !== uid) { notCancelable = true; return null; }
    if (current.status === 'cancelled') return current;
    if (current.status !== 'pending') { notCancelable = true; return current; }
    return { ...current, status: 'cancelled', updatedAt: Date.now(), cancelledByUid: uid };
  }, undefined, false);
  if (notCancelable || !result.committed) throw new HttpsError('failed-precondition', '대기 중인 본인 신청만 취소할 수 있습니다.');
  const entry = result.snapshot.val();
  await db.ref(`${WALLET_ROOT}/dailyReservations/${uid}/${entry.dailyKey}/requests/${requestId}`).update({ status: 'cancelled' });
  return { ok: true };
});

exports.gameSeriesWalletSubmitRefund = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = await requireWalletAdmin(request);
  const requestId = walletSafeId((request.data || {}).requestId);
  const reason = walletText((request.data || {}).reason, 500, '환불 사유');
  const chargeRef = db.ref(`${WALLET_ROOT}/chargeRequests/${requestId}`);
  const chargeSnap = await chargeRef.get();
  const charge = chargeSnap.val();
  if (!charge || charge.ownerUid !== uid || charge.status !== 'approved') {
    throw new HttpsError('failed-precondition', '환불 신청은 승인된 본인 충전 건만 가능합니다.');
  }
  const originalCashAmount = Number(charge.cashAmount) || 0;
  const alreadyRefundedCash = Number(charge.refundedCashAmount) || 0;
  const chargeRefundLimit = originalCashAmount - alreadyRefundedCash;
  if (!Number.isSafeInteger(originalCashAmount) || originalCashAmount <= 0 ||
      !Number.isSafeInteger(chargeRefundLimit) || chargeRefundLimit <= 0) {
    throw new HttpsError('failed-precondition', '이 충전 건에 환불 가능한 유료 캐시가 없습니다.');
  }

  const accountRef = db.ref(`${WALLET_ROOT}/accounts/${uid}`);
  let refundCashAmount = 0;
  let noAvailableBalance = false;
  let createdReservation = false;
  const reservationResult = await accountRef.transaction((value) => {
    refundCashAmount = 0;
    noAvailableBalance = false;
    createdReservation = false;
    if (!value || typeof value !== 'object') { noAvailableBalance = true; return null; }
    const account = value;
    const reservations = account.refundReservations && typeof account.refundReservations === 'object'
      ? { ...account.refundReservations } : {};
    const existingReservation = reservations[requestId];
    if (existingReservation) {
      const existingCash = Number(existingReservation.cashAmount);
      if (Number.isSafeInteger(existingCash) && existingCash > 0 && existingCash <= chargeRefundLimit) {
        refundCashAmount = existingCash;
        return account;
      }
      noAvailableBalance = true;
      return account;
    }
    const balance = Math.max(0, Math.floor(Number(account.balanceCash) || 0));
    const available = Math.max(0, balance - walletReservedRefundCash(account));
    refundCashAmount = Math.min(chargeRefundLimit, available);
    if (!Number.isSafeInteger(refundCashAmount) || refundCashAmount <= 0) {
      refundCashAmount = 0;
      noAvailableBalance = true;
      return account;
    }
    reservations[requestId] = {
      cashAmount: refundCashAmount,
      amountKrw: refundCashAmount * WALLET_KRW_PER_CASH,
      reservedAt: Date.now(),
    };
    createdReservation = true;
    return { ...account, refundReservations: reservations };
  }, undefined, false);
  if (noAvailableBalance || refundCashAmount <= 0) {
    throw new HttpsError('failed-precondition', '환불 가능한 미사용 잔액이 없습니다.');
  }
  if (!reservationResult.committed) {
    throw new HttpsError('aborted', '환불 가능 잔액을 확보하지 못했습니다. 새로고침해 주세요.');
  }

  let rejected = false;
  const result = await chargeRef.transaction((current) => {
    rejected = false;
    if (!current || current.ownerUid !== uid || current.status !== 'approved') { rejected = true; return current; }
    const now = Date.now();
    const next = {
      ...current,
      status: 'refundRequested',
      refundReason: reason,
      refundCashAmount,
      refundAmountKrw: refundCashAmount * WALLET_KRW_PER_CASH,
      refundRequestedAt: now,
      updatedAt: now,
    };
    delete next.refundDecision;
    delete next.refundAdminNote;
    delete next.refundReviewedAt;
    delete next.refundReviewedByUid;
    delete next.refundAction;
    delete next.refundStartedAt;
    return next;
  }, undefined, false);
  if (rejected || !result.committed) {
    if (createdReservation) await releaseWalletRefundReservation(uid, requestId);
    throw new HttpsError('aborted', '환불 신청 상태가 바뀌었습니다. 새로고침해 주세요.');
  }
  return { ok: true, cashAmount: refundCashAmount, amountKrw: refundCashAmount * WALLET_KRW_PER_CASH };
});

exports.gameSeriesWalletSubmitSupport = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const uid = await requireWalletAdmin(request);
  const data = request.data || {};
  const category = String(data.category || '');
  if (!['deposit-mismatch', 'wrong-payer', 'refund', 'other'].includes(category)) {
    throw new HttpsError('invalid-argument', '문의 유형을 선택해 주세요.');
  }
  const message = walletText(data.message, 1200, '문의 내용');
  const requestId = walletSafeId(data.requestId, '고객센터 요청 번호');
  const amountKrw = data.amountKrw ? Number(data.amountKrw) : 0;
  if (!Number.isSafeInteger(amountKrw) || amountKrw < 0 || amountKrw > 10000000) {
    throw new HttpsError('invalid-argument', '입금액이 올바르지 않습니다.');
  }
  const supportRef = db.ref(`${WALLET_ROOT}/supportRequests/${requestId}`);
  const now = Date.now();
  let idConflict = false;
  const saved = await supportRef.transaction((current) => {
    idConflict = false;
    if (current) {
      if (current.ownerUid !== uid) idConflict = true;
      return current;
    }
    return {
      ownerUid: uid,
      category,
      message,
      amountKrw,
      relatedChargeRequestId: String(data.relatedChargeRequestId || '').slice(0, 80),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
  }, undefined, false);
  if (!saved.committed || idConflict) throw new HttpsError('already-exists', '문의 저장에 실패했습니다. 다시 시도해 주세요.');
  return { ok: true, requestId };
});

exports.gameSeriesWalletAdminList = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  await requireWalletAdmin(request);
  const root = db.ref(WALLET_ROOT);
  const [charges, support, config] = await Promise.all([
    root.child('chargeRequests').orderByKey().limitToLast(200).get(),
    root.child('supportRequests').orderByKey().limitToLast(100).get(),
    root.child('config').get(),
  ]);
  const chargeRequests = [];
  charges.forEach((child) => {
    chargeRequests.push({ requestId: child.key, ...(child.val() || {}) });
  });
  const supportRequests = [];
  support.forEach((child) => {
    supportRequests.push({ requestId: child.key, ...(child.val() || {}) });
  });
  return {
    qrConfigured: !!(config.val() || {}).qrDataUrl,
    chargeRequests: chargeRequests.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
    supportRequests: supportRequests.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
  };
});

exports.gameSeriesWalletAdminReview = onCall({ region: REGION, maxInstances: 10 }, async (request) => {
  const reviewerUid = await requireWalletAdmin(request);
  const data = request.data || {};
  const kind = String(data.kind || 'charge');
  const action = String(data.action || '');
  const requestId = walletSafeId(data.requestId);
  const note = walletText(data.note, 500, '검수 메모', { required: false });
  const now = Date.now();
  const base = db.ref(WALLET_ROOT);

  if (kind === 'support') {
    if (!['close', 'reopen'].includes(action)) throw new HttpsError('invalid-argument', '지원하지 않는 문의 처리입니다.');
    const supportRef = base.child(`supportRequests/${requestId}`);
    let invalid = false;
    const result = await supportRef.transaction((current) => {
      invalid = false;
      if (!current) { invalid = true; return null; }
      return {
        ...current,
        status: action === 'close' ? 'closed' : 'open',
        adminNote: note,
        reviewedAt: now,
        reviewedByUid: reviewerUid,
        updatedAt: now,
      };
    }, undefined, false);
    if (invalid || !result.committed) throw new HttpsError('not-found', '고객센터 문의를 찾지 못했습니다.');
    return { ok: true };
  }
  if (kind !== 'charge' || !['approve', 'reject', 'completeRefund', 'rejectRefund'].includes(action)) {
    throw new HttpsError('invalid-argument', '지원하지 않는 충전 검수 작업입니다.');
  }
  const chargeRef = base.child(`chargeRequests/${requestId}`);
  const currentSnap = await chargeRef.get();
  const current = currentSnap.val();
  if (!current) throw new HttpsError('not-found', '충전 신청을 찾지 못했습니다.');
  const ownerUid = String(current.ownerUid || '');
  const amountKrw = Number(current.amountKrw);
  const cashAmount = Number(current.cashAmount);
  if (!ownerUid || !Number.isSafeInteger(amountKrw) || amountKrw < WALLET_MIN_CHARGE_KRW ||
      amountKrw % WALLET_KRW_PER_CASH !== 0 || cashAmount !== amountKrw / WALLET_KRW_PER_CASH) {
    throw new HttpsError('failed-precondition', '충전 신청 데이터가 올바르지 않습니다.');
  }

  if (action === 'reject') {
    let invalid = false;
    const result = await chargeRef.transaction((value) => {
      invalid = false;
      if (!value || value.status !== 'pending') { invalid = true; return value; }
      return { ...value, status: 'rejected', reviewNote: note, reviewedAt: now, reviewedByUid: reviewerUid, updatedAt: now };
    }, undefined, false);
    if (invalid || !result.committed) throw new HttpsError('failed-precondition', '대기 중인 충전 신청만 거절할 수 있습니다.');
    await base.child(`dailyReservations/${ownerUid}/${current.dailyKey}/requests/${requestId}`).update({ status: 'rejected' });
    return { ok: true };
  }

  if (action === 'approve') {
    let invalid = false;
    const claim = await chargeRef.transaction((value) => {
      invalid = false;
      if (!value) { invalid = true; return null; }
      if (value.status === 'pending') return { ...value, status: 'processing', reviewAction: 'approve', reviewStartedAt: now, reviewedByUid: reviewerUid };
      if (value.status === 'processing' && value.reviewAction === 'approve') return value;
      if (value.status === 'approved') return value;
      invalid = true;
      return value;
    }, undefined, false);
    const afterClaim = claim.snapshot.val() || {};
    if (invalid || !claim.committed || !['processing', 'approved'].includes(afterClaim.status)) {
      throw new HttpsError('failed-precondition', '대기 중인 충전 신청만 승인할 수 있습니다.');
    }
    const accountRef = base.child(`accounts/${ownerUid}`);
    const accountResult = await accountRef.transaction((value) => {
      const account = value && typeof value === 'object' ? value : {};
      const processed = account.processedCharges && typeof account.processedCharges === 'object' ? { ...account.processedCharges } : {};
      if (processed[requestId]) return account;
      processed[requestId] = true;
      return { ...account, balanceCash: (Number(account.balanceCash) || 0) + cashAmount, processedCharges: processed };
    }, undefined, false);
    if (!accountResult.committed) throw new HttpsError('aborted', '캐시 지급을 마치지 못했습니다. 다시 검수해 주세요.');
    await base.child(`ledger/${ownerUid}/${requestId}_charge`).set({
      kind: 'charge', requestId, amountKrw, cashAmount, createdAt: now, createdByUid: reviewerUid,
    });
    await chargeRef.update({
      status: 'approved', reviewNote: note, reviewedAt: now, reviewedByUid: reviewerUid,
      updatedAt: now, cashCreditedAt: now,
    });
    await base.child(`dailyReservations/${ownerUid}/${current.dailyKey}/requests/${requestId}`).update({ status: 'approved' });
    return { ok: true, cashAmount };
  }

  if (action === 'rejectRefund') {
    let invalid = false;
    const claim = await chargeRef.transaction((value) => {
      invalid = false;
      if (!value) { invalid = true; return null; }
      if (value.status === 'refundRequested') {
        return {
          ...value,
          status: 'refundRejecting',
          refundAction: 'rejectRefund',
          refundStartedAt: now,
          refundReviewedByUid: reviewerUid,
        };
      }
      if (value.status === 'refundRejecting' && value.refundAction === 'rejectRefund') return value;
      invalid = true;
      return value;
    }, undefined, false);
    if (invalid || !claim.committed || !['refundRejecting'].includes((claim.snapshot.val() || {}).status)) {
      throw new HttpsError('failed-precondition', '접수된 환불 신청만 거절할 수 있습니다.');
    }
    await releaseWalletRefundReservation(ownerUid, requestId);
    let finalizeInvalid = false;
    const result = await chargeRef.transaction((value) => {
      finalizeInvalid = false;
      if (!value || value.status !== 'refundRejecting' || value.refundAction !== 'rejectRefund') {
        finalizeInvalid = true;
        return value;
      }
      return {
        ...value,
        status: 'approved',
        refundDecision: 'rejected',
        refundAdminNote: note,
        refundReviewedAt: now,
        refundAction: null,
        updatedAt: now,
      };
    }, undefined, false);
    if (finalizeInvalid || !result.committed) {
      throw new HttpsError('aborted', '환불 거절을 마무리하지 못했습니다. 같은 작업을 다시 실행해 주세요.');
    }
    return { ok: true };
  }

  let invalidRefund = false;
  const refundClaim = await chargeRef.transaction((value) => {
    invalidRefund = false;
    if (!value) { invalidRefund = true; return null; }
    if (value.status === 'refundRequested') return { ...value, status: 'refundProcessing', refundAction: 'completeRefund', refundStartedAt: now, refundReviewedByUid: reviewerUid };
    if (value.status === 'refundProcessing' && value.refundAction === 'completeRefund') return value;
    if (value.status === 'refunded') return value;
    invalidRefund = true;
    return value;
  }, undefined, false);
  const refundState = refundClaim.snapshot.val() || {};
  if (invalidRefund || !refundClaim.committed || !['refundProcessing', 'refunded'].includes(refundState.status)) {
    throw new HttpsError('failed-precondition', '접수된 환불 신청만 처리할 수 있습니다.');
  }
  const refundCashAmount = Number(refundState.refundCashAmount) || cashAmount;
  const refundAmountKrw = Number(refundState.refundAmountKrw) || refundCashAmount * WALLET_KRW_PER_CASH;
  if (!Number.isSafeInteger(refundCashAmount) || refundCashAmount <= 0 || refundCashAmount > cashAmount ||
      !Number.isSafeInteger(refundAmountKrw) || refundAmountKrw !== refundCashAmount * WALLET_KRW_PER_CASH) {
    throw new HttpsError('failed-precondition', '환불 금액 데이터가 올바르지 않습니다. 신청 내역을 다시 확인해 주세요.');
  }
  const accountRef = base.child(`accounts/${ownerUid}`);
  let insufficientBalance = false;
  let reservationMismatch = false;
  const refundResult = await accountRef.transaction((value) => {
    insufficientBalance = false;
    reservationMismatch = false;
    const account = value && typeof value === 'object' ? value : {};
    const processed = account.processedRefunds && typeof account.processedRefunds === 'object' ? { ...account.processedRefunds } : {};
    if (processed[requestId]) return account;
    const balance = Number(account.balanceCash) || 0;
    const reservations = account.refundReservations && typeof account.refundReservations === 'object'
      ? { ...account.refundReservations } : {};
    const reservation = reservations[requestId];
    if (reservation && Number(reservation.cashAmount) !== refundCashAmount) {
      reservationMismatch = true;
      return value == null ? null : value;
    }
    if (balance < refundCashAmount || balance - walletReservedRefundCash(account, requestId) < refundCashAmount) {
      insufficientBalance = true;
      return value == null ? null : value;
    }
    processed[requestId] = true;
    delete reservations[requestId];
    const next = {
      ...account,
      balanceCash: balance - refundCashAmount,
      processedRefunds: processed,
    };
    if (Object.keys(reservations).length) next.refundReservations = reservations;
    else delete next.refundReservations;
    return next;
  }, undefined, false);
  if (reservationMismatch) throw new HttpsError('failed-precondition', '환불 예약액이 신청 금액과 다릅니다. 신청을 다시 확인해 주세요.');
  if (insufficientBalance) throw new HttpsError('failed-precondition', '잔액이 환불액보다 적어 환불을 완료할 수 없습니다.');
  if (!refundResult.committed) throw new HttpsError('aborted', '환불 처리를 마치지 못했습니다. 다시 검수해 주세요.');
  await base.child(`ledger/${ownerUid}/${requestId}_refund`).set({
    kind: 'refund', requestId, amountKrw: refundAmountKrw, cashAmount: refundCashAmount,
    originalAmountKrw: amountKrw, originalCashAmount: cashAmount, createdAt: now, createdByUid: reviewerUid,
  });
  await chargeRef.update({
    status: 'refunded', refundDecision: 'completed', refundAdminNote: note,
    refundCashAmount, refundAmountKrw, refundedCashAmount: refundCashAmount,
    refundReviewedAt: now, refundReviewedByUid: reviewerUid, refundedAt: now, updatedAt: now,
  });
  return { ok: true, cashAmount: refundCashAmount, amountKrw: refundAmountKrw };
});

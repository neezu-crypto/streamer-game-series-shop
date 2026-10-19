const crypto = require('node:crypto');
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const catalog = require('../catalog/stickers.json');

if (!admin.apps.length) admin.initializeApp();
const db = admin.database();
const REGION = 'us-central1';
const DISPLAY_MS = 5000;
const SEND_COOLDOWN_MS = 900;
const GAME_IDS = new Set([
  'streamerLifeGame', 'soopStockMarket', 'streamBetMarket',
  'interior3dViewer', 'dontClickAds', 'midnightMartRun',
  'streamerJurumable', 'onyuVn', 'dontPressButton'
]);

const stickerIndex = new Map();
for (const product of catalog.products || []) {
  const stickers = product.preview && Array.isArray(product.preview.stickers)
    ? product.preview.stickers : [];
  stickers.forEach((sticker, index) => {
    stickerIndex.set(sticker.id, {
      id: sticker.id,
      productId: product.id,
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

exports.gameSeriesShopGetOwnedEmotes = onCall({ region: REGION, maxInstances: 20 }, async (request) => {
  const uid = requireUser(request);
  const snapshot = await db.ref(`gameSeriesShop/ownership/${uid}`).get();
  const ownership = snapshot.val() || {};
  const ownedProductIds = new Set(Object.entries(ownership)
    .filter(([, value]) => ownedRecordIsActive(value))
    .map(([productId]) => productId));
  const stickers = [];
  for (const sticker of stickerIndex.values()) {
    if (ownedProductIds.has(sticker.productId)) stickers.push({ id: sticker.id });
  }
  return { stickers };
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

  const ownership = await db.ref(`gameSeriesShop/ownership/${uid}/${sticker.productId}`).get();
  if (!ownedRecordIsActive(ownership.val())) {
    throw new HttpsError('permission-denied', '보유한 스티커만 사용할 수 있습니다.');
  }

  const now = Date.now();
  const cooldownRef = db.ref(`gameSeriesShop/emoteRateLimits/${uid}`);
  const cooldown = await cooldownRef.transaction((previous) => {
    const lastSentAt = Number(previous || 0);
    if (now - lastSentAt < SEND_COOLDOWN_MS) return;
    return now;
  });
  if (!cooldown.committed) {
    throw new HttpsError('resource-exhausted', '스티커를 너무 빠르게 보내고 있어요.');
  }

  const eventRef = db.ref(`gameSeriesShop/emoteEvents/${gameId}/${roomKey}/current`);
  const eventId = eventRef.push().key;
  const event = {
    eventId,
    stickerId: sticker.id,
    x,
    y,
    createdAt: now,
    durationMs: DISPLAY_MS
  };
  await eventRef.set(event);
  return { ok: true, eventId, durationMs: DISPLAY_MS };
});

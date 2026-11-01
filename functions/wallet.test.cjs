const assert = require('node:assert/strict');
const Module = require('node:module');

let tree = {};

function pathParts(path) {
  return String(path || '').split('/').filter(Boolean);
}

function readPath(path) {
  let current = tree;
  for (const part of pathParts(path)) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  return current == null ? null : structuredClone(current);
}

function writePath(path, value) {
  const parts = pathParts(path);
  if (!parts.length) { tree = value == null ? {} : structuredClone(value); return; }
  let current = tree;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') current[part] = {};
    current = current[part];
  }
  if (value == null) delete current[parts.at(-1)];
  else current[parts.at(-1)] = structuredClone(value);
}

class Snapshot {
  constructor(value, limit = 0) { this.value = value == null ? null : structuredClone(value); this.limit = limit; }
  val() { return this.value == null ? null : structuredClone(this.value); }
  exists() { return this.value != null; }
  forEach(callback) {
    if (!this.value || typeof this.value !== 'object') return false;
    let keys = Object.keys(this.value).sort();
    if (this.limit) keys = keys.slice(-this.limit);
    for (const key of keys) if (callback({ key, val: () => structuredClone(this.value[key]) }) === true) return true;
    return false;
  }
}

class Reference {
  constructor(path = '', limit = 0) { this.path = path; this.limit = limit; }
  child(path) { return new Reference([this.path, path].filter(Boolean).join('/'), this.limit); }
  orderByKey() { return this; }
  limitToLast(limit) { return new Reference(this.path, limit); }
  async get() { return new Snapshot(readPath(this.path), this.limit); }
  async set(value) { writePath(this.path, value); }
  async update(value) {
    const previous = readPath(this.path) || {};
    writePath(this.path, { ...previous, ...structuredClone(value) });
  }
  async transaction(update) {
    const next = update(readPath(this.path));
    if (next === undefined) return { committed: false, snapshot: new Snapshot(readPath(this.path)) };
    writePath(this.path, next);
    return { committed: true, snapshot: new Snapshot(readPath(this.path)) };
  }
}

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-admin/app') return { initializeApp: () => ({}) };
  if (request === 'firebase-admin/database') return { getDatabase: () => ({ ref: (path) => new Reference(path) }) };
  if (request === 'firebase-functions/v2/https') {
    return { HttpsError, onCall: (options, handler) => typeof options === 'function' ? options : handler };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const functions = require('./index.js');
Module._load = originalLoad;

const admin = { auth: { uid: 'admin-test-uid' }, data: {} };
const outsider = { auth: { uid: 'ordinary-test-uid' }, data: {} };
const call = (name, user, data = {}) => functions[name]({ auth: user.auth, data });
const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => error && error.code === code);
};

async function main() {
  tree = { adminCenter: { adminUids: { 'admin-test-uid': true } } };
  await expectCode(call('gameSeriesWalletGetAdminState', outsider), 'permission-denied');
  await expectCode(call('gameSeriesWalletSubmitSupport', outsider, { requestId: 'support-uid-0001', category: 'other', message: 'x' }), 'permission-denied');

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  await expectCode(call('gameSeriesWalletAdminSaveQr', admin, { qrDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }), 'invalid-argument');
  const qr = await call('gameSeriesWalletAdminSaveQr', admin, { qrDataUrl: `data:image/jpeg;base64,${jpeg}` });
  assert.equal(qr.ok, true);

  await expectCode(call('gameSeriesWalletSubmitCharge', admin, { requestId: 'charge-min-0001', amountKrw: 900, depositorName: '테스트' }), 'invalid-argument');
  const first = await call('gameSeriesWalletSubmitCharge', admin, { requestId: 'charge-valid-0001', amountKrw: 1000, depositorName: '테스트 입금자' });
  assert.equal(first.status, 'pending');
  const duplicate = await call('gameSeriesWalletSubmitCharge', admin, { requestId: 'charge-valid-0001', amountKrw: 1000, depositorName: '테스트 입금자' });
  assert.equal(duplicate.status, 'pending');
  await expectCode(call('gameSeriesWalletSubmitCharge', admin, { requestId: 'charge-over-0001', amountKrw: 100000, depositorName: '테스트' }), 'resource-exhausted');
  await call('gameSeriesWalletSubmitCharge', admin, { requestId: 'charge-cancel-0001', amountKrw: 1000, depositorName: '테스트 입금자' });
  await call('gameSeriesWalletCancelCharge', admin, { requestId: 'charge-cancel-0001' });
  const second = await call('gameSeriesWalletSubmitCharge', admin, { requestId: 'charge-valid-0002', amountKrw: 99000, depositorName: '테스트 입금자' });
  assert.equal(second.status, 'pending');

  let overview = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(overview.todayReservedKrw, 100000);
  assert.equal(overview.depositorName, '테스트 입금자');
  assert.match(overview.qrDataUrl, /^data:image\/jpeg;base64,/);

  await call('gameSeriesWalletAdminReview', admin, { requestId: 'charge-valid-0002', action: 'reject', note: '테스트 거절' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'charge-valid-0001', action: 'approve', note: '테스트 승인' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'charge-valid-0001', action: 'approve', note: '중복 재시도' });
  overview = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(overview.balanceCash, 10, '중복 승인 재시도도 한 번만 지급되어야 함');
  assert.equal(overview.todayReservedKrw, 1000, '거절된 신청은 일일 한도에서 제외되어야 함');
  assert.equal(overview.ledger.filter((entry) => entry.kind === 'charge').length, 1);

  await call('gameSeriesWalletSubmitRefund', admin, { requestId: 'charge-valid-0001', reason: '테스트 환불' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'charge-valid-0001', action: 'completeRefund', note: '은행 반환 테스트 완료' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'charge-valid-0001', action: 'completeRefund', note: '중복 환불 재시도' });
  overview = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(overview.balanceCash, 0, '중복 환불 재시도도 한 번만 차감되어야 함');
  assert.equal(overview.ledger.filter((entry) => entry.kind === 'refund').length, 1);

  await call('gameSeriesWalletSubmitSupport', admin, {
    requestId: 'support-uid-0001', category: 'wrong-payer', amountKrw: 1500,
    relatedChargeRequestId: 'charge-valid-0001', message: '테스트 문의',
  });
  const adminList = await call('gameSeriesWalletAdminList', admin);
  assert.equal(adminList.chargeRequests.length, 3);
  assert.equal(adminList.supportRequests.length, 1);
  assert.equal(adminList.qrConfigured, true);
  await call('gameSeriesWalletAdminReview', admin, { kind: 'support', requestId: 'support-uid-0001', action: 'close', note: '테스트 답변' });
  overview = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(overview.supportRequests[0].status, 'closed');
  assert.equal(overview.supportRequests[0].adminNote, '테스트 답변');
  await expectCode(call('gameSeriesWalletAdminList', outsider), 'permission-denied');
  await expectCode(call('gameSeriesWalletAdminReview', outsider, { requestId: 'charge-valid-0001', action: 'approve' }), 'permission-denied');
  console.log('wallet function checks passed: admin gate, QR validation, amount limits, daily cap, idempotent credit/refund, support review');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

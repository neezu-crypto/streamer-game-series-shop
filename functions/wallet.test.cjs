const assert = require('node:assert/strict');
const Module = require('node:module');

let tree = {};
const parts = (path) => String(path || '').split('/').filter(Boolean);
function read(path) { let value = tree; for (const part of parts(path)) { if (!value || typeof value !== 'object') return null; value = value[part]; } return value == null ? null : structuredClone(value); }
function write(path, value) { const keys = parts(path); if (!keys.length) { tree = value == null ? {} : structuredClone(value); return; } let parent = tree; for (const key of keys.slice(0, -1)) parent = parent[key] ||= {}; if (value == null) delete parent[keys.at(-1)]; else parent[keys.at(-1)] = structuredClone(value); }
class Snapshot { constructor(value, limit = 0) { this.value = value == null ? null : structuredClone(value); this.limit = limit; } val() { return this.value == null ? null : structuredClone(this.value); } exists() { return this.value != null; } forEach(fn) { if (!this.value || typeof this.value !== 'object') return false; let keys = Object.keys(this.value).sort(); if (this.limit) keys = keys.slice(-this.limit); for (const key of keys) if (fn({ key, val: () => structuredClone(this.value[key]) })) return true; return false; } }
class Ref { constructor(path = '', limit = 0) { this.path = path; this.limit = limit; } child(path) { return new Ref([this.path, path].filter(Boolean).join('/'), this.limit); } orderByKey() { return this; } limitToLast(limit) { return new Ref(this.path, limit); } async get() { return new Snapshot(read(this.path), this.limit); } async set(value) { write(this.path, value); } async update(value) { write(this.path, { ...(read(this.path) || {}), ...structuredClone(value) }); } async transaction(update) { const remote = read(this.path); const local = update(null); if (local === undefined) return { committed: false, snapshot: new Snapshot(remote) }; const next = remote == null ? local : update(remote); if (next === undefined) return { committed: false, snapshot: new Snapshot(remote) }; write(this.path, next); return { committed: true, snapshot: new Snapshot(read(this.path)) }; } }
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) { if (request === 'firebase-admin/app') return { initializeApp: () => ({}) }; if (request === 'firebase-admin/database') return { getDatabase: () => ({ ref: (path) => new Ref(path) }) }; if (request === 'firebase-functions/v2/https') return { HttpsError, onCall: (options, handler) => typeof options === 'function' ? options : handler }; return originalLoad.call(this, request, parent, isMain); };
const functions = require('./index.js'); Module._load = originalLoad;
const googleAuth = (uid) => ({ uid, token: { firebase: { sign_in_provider: 'google.com' } } });
const customAuth = (uid) => ({ uid, token: { firebase: { sign_in_provider: 'custom' } } });
const anonymousAuth = (uid) => ({ uid, token: { firebase: { sign_in_provider: 'anonymous' } } });
const admin = { auth: googleAuth('admin-test-uid'), data: {} }; const outsider = { auth: googleAuth('ordinary-test-uid'), data: {} };
const kakaoUser = { auth: customAuth('kakao-test-uid'), data: {} };
const streamerUser = { auth: anonymousAuth('streamer-test-uid'), data: {} };
const anonymousUser = { auth: anonymousAuth('anonymous-test-uid'), data: {} };
const call = (name, user, data = {}) => functions[name]({ auth: user.auth, data });
const expectCode = (promise, code) => assert.rejects(promise, (error) => error && error.code === code);

async function main() {
  tree = {
    adminCenter: { adminUids: { 'admin-test-uid': true } },
    users: {
      'admin-test-uid': { streamerVerified: true },
      'kakao-test-uid': { kakaoLinked: true },
      'streamer-test-uid': { streamerVerified: true },
    },
  };
  await expectCode(call('gameSeriesWalletGetAdminState', anonymousUser), 'unauthenticated');
  assert.equal((await call('gameSeriesWalletGetAdminState', kakaoUser)).uid, 'kakao-test-uid', '카카오 보호 계정은 custom 토큰이어도 이용할 수 있어야 함');
  assert.equal((await call('gameSeriesWalletGetAdminState', streamerUser)).uid, 'streamer-test-uid', '스트리머 인증 계정은 익명 세션 기반이어도 이용할 수 있어야 함');
  const viewerState = await call('gameSeriesWalletGetAdminState', outsider);
  assert.equal(viewerState.isAdmin, false, '일반 로그인 유저는 검수 권한을 받지 않아야 함');
  assert.equal(viewerState.isVerifiedStreamer, false, '일반 로그인 유저는 본인 충전형이어야 함');
  await call('gameSeriesWalletSubmitCharge', outsider, { requestId: 'viewer-valid-0001', starCount: 7 });
  assert.equal(read('gameSeriesWallet/chargeRequests/viewer-valid-0001').chargeType, 'selfCharge');
  assert.equal(read('gameSeriesWallet/chargeRequests/viewer-valid-0001').soopDonorId, undefined);
  await call('gameSeriesWalletMarkDonationComplete', outsider, { requestId: 'viewer-valid-0001' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'viewer-valid-0001', action: 'approve', note: '시청자 후원 대조 완료' });
  const viewerApproved = await call('gameSeriesWalletGetAdminState', outsider);
  assert.equal(viewerApproved.balanceCash, 7, '시청자 충전 캐시는 신청자 본인 계정에 적립돼야 함');
  const streamerState = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(streamerState.isVerifiedStreamer, true, '인증 스트리머 상태를 반환해야 함');
  await expectCode(call('gameSeriesWalletSubmitCharge', admin, { requestId: 'star-invalid-0001', starCount: 0, soopDonorNickname: '테스트', soopDonorId: 'tester' }), 'invalid-argument');
  await expectCode(call('gameSeriesWalletSubmitCharge', admin, { requestId: 'star-missing-donor-0001', starCount: 10 }), 'invalid-argument');
  const first = await call('gameSeriesWalletSubmitCharge', admin, { requestId: 'star-valid-0001', starCount: 10, soopDonorNickname: '테스트 후원자', soopDonorId: 'tester' });
  assert.equal(first.status, 'awaitingDonation');
  assert.equal(read('gameSeriesWallet/chargeRequests/star-valid-0001').chargeType, 'viewerSupport');
  const duplicate = await call('gameSeriesWalletSubmitCharge', admin, { requestId: 'star-valid-0001', starCount: 10, soopDonorNickname: '테스트 후원자', soopDonorId: 'tester' });
  assert.equal(duplicate.status, 'awaitingDonation');
  await call('gameSeriesWalletCancelCharge', admin, { requestId: 'star-valid-0001' });
  await expectCode(call('gameSeriesWalletMarkDonationComplete', admin, { requestId: 'star-valid-0001' }), 'failed-precondition');
  await call('gameSeriesWalletSubmitCharge', admin, { requestId: 'star-valid-0002', starCount: 10, soopDonorNickname: '테스트 후원자', soopDonorId: 'tester' });
  await expectCode(call('gameSeriesWalletAdminReview', admin, { requestId: 'star-valid-0002', action: 'approve' }), 'failed-precondition');
  await call('gameSeriesWalletMarkDonationComplete', admin, { requestId: 'star-valid-0002' });
  await call('gameSeriesWalletMarkDonationComplete', admin, { requestId: 'star-valid-0002' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'star-valid-0002', action: 'approve', note: '실제 SOOP 후원 대조 완료' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'star-valid-0002', action: 'approve', note: '중복 승인 재시도' });
  let state = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(state.balanceCash, 10, '중복 승인도 한 번만 캐시를 지급해야 함');
  assert.equal(state.ledger.filter((entry) => entry.kind === 'starBalloonCharge').length, 1);
  await call('gameSeriesWalletSubmitRefund', admin, { requestId: 'star-valid-0002', reason: 'SOOP 반환 테스트' });
  state = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(state.refundReservedCash, 10, '반환 대기 캐시는 사용 가능 잔액에서 잠겨야 함');
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'star-valid-0002', action: 'completeRefund', note: 'SOOP 반환 확인' });
  await call('gameSeriesWalletAdminReview', admin, { requestId: 'star-valid-0002', action: 'completeRefund', note: '중복 반환 재시도' });
  state = await call('gameSeriesWalletGetAdminState', admin);
  assert.equal(state.balanceCash, 0, '중복 반환 처리도 한 번만 캐시를 회수해야 함');
  assert.equal(state.ledger.filter((entry) => entry.kind === 'starBalloonRefund').length, 1);
  await call('gameSeriesWalletSubmitSupport', admin, { requestId: 'support-star-0001', category: 'donation-check', starCount: 10, relatedChargeRequestId: 'star-valid-0002', message: '테스트 문의' });
  await expectCode(call('gameSeriesWalletAdminReview', outsider, { requestId: 'star-valid-0002', action: 'approve' }), 'permission-denied');
  console.log('wallet function checks passed: permissions, donation completion, cancellation, manual approval, refund lock, and idempotent credit/refund');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

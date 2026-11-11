// 다마고치 분양소 화면의 순수 판단 로직(DOM·네트워크 없음). Node 테스트로 검증한다.
export const NICKNAME_MAX = 12;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const COLOR_LABELS = { cream: '크림', pink: '핑크', mint: '민트', lavender: '라벤더' };

// 이름: 제어문자·줄바꿈 제거, 공백 정리, 1~12자. 비우면 기본 이름을 쓴다(서버와 같은 규칙).
export function normalizeNickname(value, fallback = '몽실이') {
  const text = (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!text) return { ok: true, value: fallback };
  if (Array.from(text).length > NICKNAME_MAX) return { ok: false, error: `이름은 ${NICKNAME_MAX}자 이하로 입력해 주세요.` };
  return { ok: true, value: text };
}

// 호출자 상태 → 구매 분기. login: 로그인 모달 / verify: 스트리머 인증 / charge: 캐시 충전 / ready: 구매 확인 / admin: 테스트 도구 안내
export function resolvePurchaseState({ isAnonymous, viewer, balanceCash, priceCash }) {
  if (viewer && viewer.isVerifiedStreamer === true && viewer.streamer && viewer.streamer.id) {
    return (Number(balanceCash) || 0) >= priceCash ? 'ready' : 'charge';
  }
  if (viewer && viewer.isAdmin === true) return 'admin';
  if (isAnonymous !== false) return 'login';
  return 'verify';
}

// 요청 번호: 구매 시도마다 하나를 만들고 sessionStorage에 보관한다. 결과 불명 오류의 재시도는 같은 번호를 쓴다.
export function getOrCreateRequestId(storage, key, randomBytes) {
  let value = '';
  try { value = storage.getItem(key) || ''; } catch (_) { value = ''; }
  if (!REQUEST_ID_RE.test(value)) {
    const bytes = randomBytes(18);
    value = `tg_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    try { storage.setItem(key, value); } catch (_) { /* 저장 불가 시 이번 시도에만 사용 */ }
  }
  return value;
}

export function clearRequestId(storage, key) {
  try { storage.removeItem(key); } catch (_) { /* 무시 */ }
}

function codeOf(error) { return String((error && error.code) || '').replace(/^functions\//, ''); }

// 같은 요청 번호로 다시 보내도 결과가 바뀌지 않거나(확정 실패) 환불돼 쓸 수 없는 오류면 번호를 버린다.
export function shouldDiscardRequestId(error) {
  const code = codeOf(error);
  if (['failed-precondition', 'already-exists', 'invalid-argument', 'permission-denied', 'resource-exhausted', 'not-found'].includes(code)) return true;
  return code === 'aborted' && /자동 환불했어요/.test(String((error && error.message) || ''));
}

export function adoptErrorMessage(error) {
  const code = codeOf(error);
  const message = String((error && error.message) || '');
  if (code === 'unauthenticated') return '로그인이 필요해요.';
  if (code === 'unavailable') return message || '서비스 점검 중에는 분양할 수 없어요.';
  if (code === 'resource-exhausted') return '잠시 후 다시 시도해 주세요.';
  if (['failed-precondition', 'permission-denied', 'invalid-argument', 'already-exists', 'aborted', 'not-found'].includes(code) && message) return message;
  return '새 가족을 맞이하지 못했어요. 차감된 캐시가 있다면 자동으로 확인돼요. 잠시 후 다시 시도해 주세요.';
}

// 공개 카탈로그 JSON과 서버 카탈로그가 같은 종·색 목록을 갖는지(가격은 공개 JSON에 없다).
export function catalogsAgree(serverSpecies, publicSpecies) {
  const byId = (list) => new Map((list || []).map((item) => [item.id, item]));
  const a = byId(serverSpecies); const b = byId(publicSpecies);
  for (const [id, item] of a) {
    const other = b.get(id);
    if (!other || JSON.stringify([...item.colors].sort()) !== JSON.stringify(other.colors.map((c) => c.id).sort())) return false;
  }
  return true;
}

export function farmUrl(streamerId) {
  return `https://neezu-crypto.github.io/streamer-fanpage/#/p/${encodeURIComponent(streamerId)}`;
}

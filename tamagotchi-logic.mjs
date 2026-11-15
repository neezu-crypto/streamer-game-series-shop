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
  return withErrorRef(baseAdoptErrorMessage(error), error);
}
function baseAdoptErrorMessage(error) {
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

// ---------- 훈련소(3-B) ----------
// 호출자 상태 → 훈련 분기. login / verify / admin(테스트 훈련) / ready
export function resolveTrainState({ isAnonymous, viewer }) {
  if (viewer && viewer.isVerifiedStreamer === true && viewer.streamer && viewer.streamer.id) return 'ready';
  if (viewer && viewer.isAdmin === true) return 'admin';
  if (isAnonymous !== false) return 'login';
  return 'verify';
}

// 고른 상호작용의 합계(서버 카탈로그 가격만 사용). trainable: [{ id, cash }]
export function trainTotal(trainable, selected) {
  const price = new Map((trainable || []).map((t) => [t.id, Number(t.cash) || 0]));
  return [...new Set(selected || [])].reduce((sum, id) => sum + (price.get(id) || 0), 0);
}

// 아직 배우지 않은 훈련 상호작용만
export function learnableIds(trainable, learned) {
  const have = new Set(learned || []);
  return (trainable || []).map((t) => t.id).filter((id) => !have.has(id));
}

// 훈련 요청 번호: 같은 펫·같은 선택의 재시도에만 같은 번호를 쓴다(선택이 바뀌면 새 번호).
export function trainSignature(petId, selected) { return `${petId}|${[...new Set(selected || [])].sort().join(',')}`; }
export function getTrainRequestId(storage, key, signature, randomBytes) {
  let saved = null;
  try { saved = JSON.parse(storage.getItem(key) || 'null'); } catch (_) { saved = null; }
  if (saved && saved.sig === signature && REQUEST_ID_RE.test(saved.id)) return saved.id;
  const bytes = randomBytes(18);
  const id = `tr_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  try { storage.setItem(key, JSON.stringify({ sig: signature, id })); } catch (_) { /* 이번 시도에만 사용 */ }
  return id;
}

export function trainErrorMessage(error) {
  return withErrorRef(baseTrainErrorMessage(error), error);
}
function baseTrainErrorMessage(error) {
  const code = codeOf(error);
  const message = String((error && error.message) || '');
  if (code === 'unauthenticated') return '로그인이 필요해요.';
  if (code === 'unavailable') return message || '서비스 점검 중에는 훈련할 수 없어요.';
  if (code === 'resource-exhausted') return '잠시 후 다시 시도해 주세요.';
  if (['failed-precondition', 'permission-denied', 'invalid-argument', 'already-exists', 'aborted', 'not-found'].includes(code) && message) return message;
  return '훈련을 마치지 못했어요. 차감된 캐시가 있다면 자동으로 확인돼요. 잠시 후 다시 시도해 주세요.';
}

// 이름 바꾸기 오류 문구(서버 문구 우선)
export function renameErrorMessage(error) {
  const code = codeOf(error);
  const message = String((error && error.message) || '');
  let text = '이름을 바꾸지 못했어요. 차감된 캐시가 있다면 자동으로 확인돼요. 잠시 후 다시 시도해 주세요.';
  if (code === 'unauthenticated') text = '로그인이 필요해요.';
  else if (code === 'resource-exhausted') text = '잠시 후 다시 시도해 주세요.';
  else if (['unavailable', 'failed-precondition', 'permission-denied', 'invalid-argument', 'aborted', 'not-found'].includes(code) && message) text = message;
  return withErrorRef(text, error);
}

// 팬페이지 다마고치 훈련소 주소(팬페이지 잠금 도구에서 연결)
export const TRAIN_URL = 'https://neezu-crypto.github.io/streamer-game-series-shop/tamagotchi-world.html#train';

// 월드맵 보석 상점: 어느 펫을 연결할지(설계: 다마고치_월드맵_보석상점_설계.md 1-1).
// 팬페이지에서 ?s=스트리머&p=펫 으로 들어오면 그 펫, 아니면 훈련소와 같은 흐름. 주소 값은 형식만 거르고 실제 확인은 서버 목록으로 한다.
export function resolveGemShopTarget({ search = '', isAnonymous, viewer }) {
  const q = new URLSearchParams(search);
  const sid = String(q.get('s') || '').trim().toLowerCase();
  const pid = String(q.get('p') || '').trim();
  if (/^[a-z0-9_-]{1,64}$/.test(sid)) return { flow: 'fanpage', streamerId: sid, petId: /^[A-Za-z0-9_-]{1,64}$/.test(pid) ? pid : '' };
  const flow = resolveTrainState({ isAnonymous, viewer });
  return { flow, streamerId: flow === 'ready' ? String(viewer.streamer.id) : '', petId: '' };
}

// 펫 기능 실패 추적: 서버가 기록한 실패는 details.errorRef(요청 ID 끝 8자리)를 준다.
// 서버에 닿지 못한 실패(App Check·네트워크·시간 초과)는 화면이 따로 보고하고 같은 번호를 붙인다.
const TRACKED_ACTIONS = new Set(['adopt', 'train', 'rename']);
export function errorRefOf(error) {
  const ref = (error && error.details && error.details.errorRef) || (error && error.errorRef) || '';
  return /^[A-Za-z0-9]{1,16}$/.test(String(ref)) ? String(ref) : '';
}
export function withErrorRef(message, error) {
  const ref = errorRefOf(error);
  return ref ? `${message} (오류 번호 ${ref})` : message;
}
export function refFromRequestId(requestId) {
  const text = String(requestId || '').replace(/[^A-Za-z0-9]/g, '');
  return text.slice(-8);
}
export function clientFailureStep(error) {
  const code = codeOf(error);
  const message = String((error && error.message) || '').toLowerCase();
  if (message.includes('app check') || message.includes('appcheck') || message.includes('recaptcha')) return 'appcheck';
  if (code === 'deadline-exceeded') return 'timeout';
  if (code === 'unauthenticated') return 'appcheck';
  if (code === 'internal' || code === 'unavailable' || message.includes('network') || message.includes('failed to fetch')) return 'network';
  return 'unknown';
}
export function trackPetFailures(call, report) {
  return async (payload) => {
    try {
      return await call(payload);
    } catch (error) {
      if (payload && TRACKED_ACTIONS.has(payload.action) && !errorRefOf(error)) {
        const ref = refFromRequestId(payload.requestId);
        try { error.errorRef = ref; } catch { /* 읽기 전용 오류 객체 */ }
        Promise.resolve().then(() => report({
          action: 'report', kind: payload.action, streamerId: payload.streamerId, step: clientFailureStep(error),
          code: codeOf(error) || 'error', reason: String((error && error.message) || '').slice(0, 80), requestId: payload.requestId,
        })).catch(() => {});
      }
      throw error;
    }
  };
}

// ---------- 월드맵 펫 병원(설계: streamer-fanpage docs/다마고치_월드맵_병원_설계.md) ----------
// 서버 Care status 응답만으로 진료표·치료 버튼·병문안 가능 여부를 정한다(순수 함수: 테스트 대상).
// skewMs: 서버 시각 - 기기 시각(남은 시간 계산 보정). armed: 한 번 누른 치료 종류.
const COND_LABEL = { ok: '건강해요', low: '조금 지쳤어요', sick: '아파요', down: '쓰러졌어요', hospital: '입원 중' };
const COND_TONE = { ok: 'good', low: 'mid', sick: 'bad', down: 'bad', hospital: 'care' };
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(total / 60); const m = total % 60;
  if (h && m) return `${h}시간 ${m}분`;
  return h ? `${h}시간` : `${m}분`;
}
export function hospitalView(server, { now = Date.now(), skewMs = 0, armed = '', busy = false, hasAccount = false } = {}) {
  const s = server || {};
  const cond = COND_LABEL[s.condition] ? s.condition : 'ok';
  const gems = Math.max(0, Number(s.gems) || 0);
  const health = s.stats && s.stats.health ? s.stats.health.band : '';
  const view = { condition: cond, label: COND_LABEL[cond], tone: COND_TONE[cond], health, gems, gemMax: Number(s.gemMax) || 60,
    remainingMs: 0, remainingText: '', treat: null, visit: cond === 'hospital', note: '' };
  if (cond === 'hospital' && Number(s.hospitalUntil) > 0) {
    view.remainingMs = Math.max(0, Number(s.hospitalUntil) - (now + skewMs));
    view.remainingText = formatRemaining(view.remainingMs);
  }
  const q = s.treatment;
  if (q && (q.kind === 'outpatient' || q.kind === 'discharge')) {
    const cost = Math.max(0, Number(q.cost) || 0);
    const name = q.kind === 'outpatient' ? '외래 진료' : '조기 퇴원';
    const reason = q.usedToday ? '외래 진료는 펫마다 하루 한 번이에요.' : gems < cost ? `금고의 하트 보석이 부족해요. (${gems}/${cost})` : '';
    view.treat = { kind: q.kind, cost, reason,
      label: armed === q.kind ? '한 번 더 누르면 치료해요' : `${name} 💎${cost}`,
      disabled: !!busy || !!reason || q.available === false };
  }
  view.note = cond === 'hospital' ? '입원 중에는 시간이 멈춰요. 병문안하면 유대감이 올라요.'
    : cond === 'sick' ? '건강이 30 아래예요. 외래 진료를 받으면 건강이 80으로 회복돼요.'
      : cond === 'down' ? '곧 병원에 입원해요(24시간). 쓰다듬어 주세요.'
        : '아프지 않아요. 아플 때 이곳에서 치료할 수 있어요.';
  if (!hasAccount && (view.treat || view.visit)) view.note += ' 치료·병문안은 로그인하면 할 수 있어요.';
  return view;
}

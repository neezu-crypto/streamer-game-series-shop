// 월드맵 펫 병원 패널(설계: streamer-fanpage docs/다마고치_월드맵_병원_설계.md)
// - 서버 규칙(입원·외래·퇴원·병문안)은 이미 Care에 있다. 이 화면은 status·treat·interact만 부른다.
// - 대상 펫 연결은 보석 상점과 같다(?s=스트리머&p=펫, 없으면 인증 스트리머=내 펫, 관리자=아이디 입력).
// - 남은 입원 시간은 서버 시각 기준으로 화면에서 계산한다(주기 조회 없음). 탭이 숨으면 타이머를 멈춘다.
import { resolveGemShopTarget, hospitalView, COLOR_LABELS } from './tamagotchi-logic.mjs?v=20261116-tg-hosp4';
import { createMongsil } from './tamagotchi-pet.js?v=20261114-tg-wear1';

const STREAMER_RE = /^[a-z0-9_-]{1,64}$/;
const ADMIN_TARGET_KEY = 'twHospitalAdminTarget';
const FANPAGE_BASE = 'https://neezu-crypto.github.io/streamer-fanpage/';
const VISITS = [['pet', '🤲 쓰다듬기'], ['talk', '💬 말 걸기'], ['cheer', '📣 쾌유 응원']];
const VISIT_FLUSH_MS = 1500;
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }

export function mountHospitalPanel(host, ctx) {
  const { shopCall, careCall } = ctx;
  const st = { flow: '', streamerId: '', streamerName: '', pets: [], petId: '', server: null, skew: 0, loading: false, error: '', destroyed: false, wantPet: '', armed: '', busy: false };
  const root = el('div', 'tw-hosp');
  const who = el('div', 'tw-gem-who');
  const petsRow = el('div', 'tw-train-pets'); petsRow.setAttribute('role', 'radiogroup'); petsRow.setAttribute('aria-label', '다마고치 고르기');
  const stage = el('div', 'tw-hosp-stage'); const petBox = el('div', 'tw-hosp-pet'); stage.append(petBox);
  const chart = el('div', 'tw-hosp-chart'); chart.setAttribute('role', 'status'); chart.setAttribute('aria-live', 'polite');
  const actions = el('div', 'tw-hosp-actions');
  const status = el('p', 'tg-status'); status.setAttribute('role', 'status');
  root.append(who, petsRow, stage, chart, actions, status);
  host.append(root);
  let petApi = null; let petFor = ''; let ticker = 0; let visitQueue = {}; let visitTimer = 0;

  const viewer = () => ctx.server?.viewer || {};
  const hasAccount = () => !!ctx.user && ctx.user.isAnonymous === false;
  const currentPet = () => st.pets.find((p) => p.petId === st.petId) || null;
  const view = () => hospitalView(st.server, { now: Date.now(), skewMs: st.skew, armed: st.armed, busy: st.busy, hasAccount: hasAccount() });

  function renderWho() {
    const box = [];
    if (st.flow === 'fanpage' || st.flow === 'ready' || (st.flow === 'admin' && st.streamerId)) {
      box.push(el('p', 'tw-train-lead', `${st.streamerName || st.streamerId} 팬페이지의 다마고치 진료실이에요.`));
      if (st.streamerId) {
        const back = el('a', 'tw-gem-back', '← 팬페이지로 돌아가기');
        back.href = `${FANPAGE_BASE}#/p/${encodeURIComponent(st.streamerId)}`;
        box.push(back);
      }
    }
    if (st.flow === 'login' || st.flow === 'verify') {
      box.push(el('p', 'tw-train-lead', '스트리머의 팬페이지 다마고치 탭에서 들어오면 그 펫의 진료실이 열려요. 인증 스트리머는 여기서 바로 내 펫을 볼 수 있어요.'));
      const go = el('button', 'tg-button tg-button-primary', st.flow === 'login' ? '로그인하기' : '스트리머 인증하기'); go.type = 'button';
      go.addEventListener('click', () => ctx.openLogin(st.flow === 'verify' ? { streamer: true } : undefined));
      box.push(go);
    }
    if (st.flow === 'admin') {
      const form = el('form', 'tw-train-admin-target');
      const input = el('input', 'tg-input'); input.type = 'text'; input.maxLength = 20; input.placeholder = '팬페이지 ID(SOOP 아이디)'; input.autocomplete = 'off'; input.spellcheck = false;
      input.value = st.streamerId;
      const btn = el('button', 'tg-button', '불러오기'); btn.type = 'submit';
      form.append(el('span', 'tw-train-lead', '관리자 · 팬페이지의 다마고치 진료실을 불러와요.'), input, btn);
      form.addEventListener('submit', (e) => {
        e.preventDefault(); const id = input.value.trim().toLowerCase();
        if (!STREAMER_RE.test(id)) { status.textContent = '팬페이지 ID를 확인해 주세요.'; return; }
        try { sessionStorage.setItem(ADMIN_TARGET_KEY, id); } catch (_) { /* 무시 */ }
        void loadPets(id);
      });
      box.push(form);
    }
    if (st.loading) box.push(el('div', 'loading-card loading-bar', '다마고치를 불러오는 중…'));
    if (!st.loading && st.error) box.push(el('p', 'tg-status is-error', st.error));
    who.replaceChildren(...box);
  }
  function renderPets() {
    petsRow.replaceChildren(...(st.pets.length > 1 ? st.pets.map((p) => {
      const b = el('button', 'tw-pet-chip'); b.append(el('strong', '', p.nickname || '이름 없음'), el('small', '', COLOR_LABELS[p.color] || p.color || '')); b.type = 'button'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.petId === st.petId));
      b.addEventListener('click', () => { if (p.petId !== st.petId && !st.busy) { st.petId = p.petId; st.armed = ''; void loadStatus(); } });
      return b;
    }) : []));
  }
  function renderPet(v) {
    const pet = currentPet();
    stage.hidden = !pet || !st.server;
    if (!pet || !st.server) return;
    if (!petApi || petFor !== pet.petId) {
      petApi?.destroy(); petBox.replaceChildren();
      petApi = createMongsil(petBox, { color: pet.color || 'cream', reduced: ctx.reduced, wear: pet.wear || {} });
      petApi.setLowPower?.(window.matchMedia('(max-width: 720px)').matches); // 휴대폰은 30fps 상한
      petFor = pet.petId;
    }
    if (petApi.condition?.() !== v.condition) petApi.setCondition?.(v.condition);
    stage.classList.toggle('is-ward', v.condition === 'hospital' || v.condition === 'down');
  }
  function renderChart(v) {
    if (!st.server) { chart.replaceChildren(); return; }
    const name = currentPet()?.nickname || '다마고치';
    const badge = el('span', `tw-hosp-badge is-${v.tone}`, v.label);
    const head = el('div', 'tw-hosp-chart-head'); head.append(el('strong', '', `${name} 진료표`), badge);
    const rows = [];
    const bandWord = { good: '좋음', mid: '보통', bad: '나쁨' }[v.health] || '-';
    const health = el('p', 'tw-hosp-row'); health.append(el('span', '', '건강'), el('b', `tw-hosp-band is-${v.health || 'mid'}`, bandWord)); rows.push(health);
    if (v.condition === 'hospital') {
      const left = el('p', 'tw-hosp-row'); left.append(el('span', '', '퇴원까지'), el('b', 'tw-hosp-left', v.remainingText || '곧 퇴원')); rows.push(left);
    }
    const gems = el('p', 'tw-hosp-row'); gems.append(el('span', '', '금고 하트 보석'), el('b', '', `💎 ${v.gems}/${v.gemMax}`)); rows.push(gems);
    chart.replaceChildren(head, ...rows, el('p', 'tw-hosp-note', v.note));
  }
  function renderActions(v) {
    const list = [];
    if (v.treat) {
      const btn = el('button', `tg-button tg-button-primary tw-hosp-treat${st.armed === v.treat.kind ? ' is-armed' : ''}`, v.treat.label); btn.type = 'button';
      btn.disabled = v.treat.disabled;
      btn.addEventListener('click', () => void treat(v.treat.kind));
      list.push(btn);
      list.push(el('small', 'tw-hosp-why', v.treat.reason || '금고의 하트 보석으로 치료해요. 누가 썼는지는 남지 않아요.'));
    }
    const learned = Array.isArray(st.server?.learned) ? st.server.learned : null;
    const visitKinds = (v.visit ? VISITS : v.condition === 'down' ? VISITS.slice(0, 1) : [])
      .filter(([kind]) => !learned || learned.includes(kind));
    if (visitKinds.length) {
      const row = el('div', 'tw-hosp-visits');
      for (const [kind, label] of visitKinds) {
        const b = el('button', 'tg-button', label); b.type = 'button'; b.disabled = st.busy;
        b.addEventListener('click', () => visit(kind));
        row.append(b);
      }
      list.push(row);
      if (v.visit && visitKinds.length < VISITS.length) list.push(el('small', 'tw-hosp-why', '말 걸기·응원은 훈련소에서 배우면 병문안에 쓸 수 있어요.'));
    }
    actions.replaceChildren(...list);
  }
  function render() {
    if (st.destroyed) return;
    const v = view();
    renderWho(); renderPets(); renderPet(v); renderChart(v); renderActions(v);
    scheduleTick(v);
  }

  // 퇴원까지 남은 시간: 1분마다 다시 그리고, 시각이 되면 상태를 다시 조회한다.
  function scheduleTick(v) {
    clearTimeout(ticker); ticker = 0;
    if (v.condition !== 'hospital' || document.hidden || st.destroyed) return;
    if (v.remainingMs <= 0) { ticker = setTimeout(() => void loadStatus(), 1500); return; }
    ticker = setTimeout(render, Math.min(60000, v.remainingMs + 500));
  }
  const onVisible = () => { if (!document.hidden) render(); else { clearTimeout(ticker); ticker = 0; } petApi?.setPaused?.(document.hidden); };
  document.addEventListener('visibilitychange', onVisible);

  function apply(data) {
    if (!data) return;
    st.server = { ...st.server, ...data };
    if (Number(data.serverNow) > 0) st.skew = Number(data.serverNow) - Date.now();
  }
  async function treat(kind) {
    if (!hasAccount()) { ctx.openLogin(); return; }
    if (st.armed !== kind) { st.armed = kind; render(); return; } // 두 번 누르기 확인
    st.busy = true; st.armed = ''; render();
    try {
      await flushVisits();
      apply((await careCall({ action: 'treat', streamerId: st.streamerId, petId: st.petId, kind })).data);
      status.textContent = kind === 'outpatient' ? '외래 진료를 마쳤어요! 건강이 회복됐어요. ✦' : '퇴원했어요! 다시 건강해졌어요. ✦';
      petApi?.fx?.('heart');
    } catch (error) { status.textContent = error?.message || '치료하지 못했어요.'; }
    st.busy = false; render();
  }
  // 병문안: 1.5초 모아 한 번에 보낸다(서버 쿨다운·하루 횟수는 서버가 판정)
  function visit(kind) {
    if (!hasAccount()) { ctx.openLogin(); return; }
    visitQueue[kind] = (visitQueue[kind] || 0) + 1;
    petApi?.fx?.('heart');
    status.textContent = '병문안 마음을 전하는 중…';
    clearTimeout(visitTimer); visitTimer = setTimeout(() => void flushVisits(), VISIT_FLUSH_MS);
  }
  async function flushVisits() {
    clearTimeout(visitTimer); visitTimer = 0;
    const batch = Object.entries(visitQueue).map(([kind, n]) => ({ kind, n: Math.min(10, n) }));
    visitQueue = {};
    if (!batch.length || st.destroyed) return;
    try {
      const data = (await careCall({ action: 'interact', streamerId: st.streamerId, petId: st.petId, batch })).data;
      apply(data);
      const blocked = Object.keys(data?.result?.blocked || {}).length;
      status.textContent = data?.result?.applied > 0 ? (st.server?.condition === 'down' ? '쓰다듬어 줬어요. ♥' : '병문안했어요. 유대감이 올랐어요. ♥') : blocked ? '조금 쉬었다가 다시 병문안해 주세요.' : '병문안을 전하지 못했어요.';
    } catch (error) { status.textContent = error?.message || '병문안을 전하지 못했어요.'; }
    render();
  }

  async function loadPets(streamerId) {
    st.streamerId = streamerId; st.loading = true; st.error = ''; st.pets = []; st.server = null; render();
    try {
      const data = (await shopCall({ action: 'pets', streamerId })).data || {};
      st.pets = Array.isArray(data.pets) ? data.pets : [];
      st.streamerName = String(data.streamer?.nickname || '');
      st.petId = st.pets.some((p) => p.petId === st.wantPet) ? st.wantPet : st.pets[0]?.petId || '';
      if (!st.pets.length) st.error = '이 팬페이지에는 아직 다마고치가 없어요.';
    } catch (error) {
      st.error = error?.code === 'functions/not-found' ? '인증된 스트리머 팬페이지를 찾을 수 없어요.' : (error?.message || '다마고치를 불러오지 못했어요.');
    }
    st.loading = false;
    if (st.petId) await loadStatus(); else render();
  }
  async function loadStatus() {
    const petId = st.petId; status.textContent = '';
    try {
      const data = (await careCall({ action: 'status', streamerId: st.streamerId, petId })).data || null;
      if (petId !== st.petId || st.destroyed) return;
      st.server = null; apply(data);
    } catch (error) { st.server = null; status.textContent = error?.message || '진료실을 불러오지 못했어요.'; }
    render();
  }

  function start() {
    const target = resolveGemShopTarget({ search: location.search, isAnonymous: ctx.user?.isAnonymous !== false, viewer: viewer() });
    st.flow = target.flow; st.wantPet = target.petId || st.wantPet;
    if (target.streamerId) {
      if (target.streamerId !== st.streamerId || !st.pets.length) { void loadPets(target.streamerId); return; }
      void loadStatus(); return;
    }
    if (st.flow === 'admin') {
      let saved = ''; try { saved = sessionStorage.getItem(ADMIN_TARGET_KEY) || ''; } catch (_) { /* 무시 */ }
      if (saved && saved !== st.streamerId) { void loadPets(saved); return; }
      if (st.streamerId) { void loadStatus(); return; }
    }
    if (st.flow === 'login' || st.flow === 'verify') { st.pets = []; st.petId = ''; st.streamerId = ''; st.server = null; }
    render();
  }
  start();

  return {
    busy: () => st.busy,
    onAuthChange() { start(); },
    destroy() {
      if (Object.keys(visitQueue).length) void flushVisits().catch(() => {}); // 닫기 전에 모아 둔 병문안을 보낸다
      st.destroyed = true; clearTimeout(ticker); clearTimeout(visitTimer);
      document.removeEventListener('visibilitychange', onVisible);
      petApi?.destroy(); root.remove();
    },
  };
}

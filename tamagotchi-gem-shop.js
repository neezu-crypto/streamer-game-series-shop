// 월드맵 보석 상점 패널(설계: streamer-fanpage docs/다마고치_월드맵_보석상점_설계.md)
// - 팬페이지에서 ?s=스트리머&p=펫 으로 들어오면 그 펫이 바로 연결된다. 없으면 인증 스트리머는 내 펫, 관리자는 아이디 입력.
// - 사기·입히기 권한은 서버(Care status의 shop.manage)가 판정한다. 화면은 그 값만 따른다.
import { resolveGemShopTarget } from './tamagotchi-logic.mjs?v=20261114-tg-wear1';
import { mountGemShop } from './tamagotchi-gem-shop-ui.js?v=20261114-tg-wear1';

const STREAMER_RE = /^[a-z0-9_-]{1,64}$/;
const ADMIN_TARGET_KEY = 'twGemShopAdminTarget';
const FANPAGE_BASE = 'https://neezu-crypto.github.io/streamer-fanpage/';
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }

export function mountGemShopPanel(host, ctx) {
  const { shopCall, careCall } = ctx;
  const st = { flow: '', streamerId: '', streamerName: '', pets: [], petId: '', server: null, loading: false, error: '', destroyed: false, wantPet: '' };
  let ui = null; let uiPet = '';
  const root = el('div', 'tw-gem');
  const who = el('div', 'tw-gem-who');
  const petsRow = el('div', 'tw-train-pets'); petsRow.setAttribute('role', 'radiogroup'); petsRow.setAttribute('aria-label', '다마고치 고르기');
  const shopBox = el('div', 'tw-gem-shop');
  const status = el('p', 'tg-status'); status.setAttribute('role', 'status');
  root.append(who, petsRow, shopBox, status);
  host.append(root);

  const viewer = () => ctx.server?.viewer || {};
  const hasAccount = () => !!ctx.user && ctx.user.isAnonymous === false;
  const currentPet = () => st.pets.find((p) => p.petId === st.petId) || null;

  function renderWho() {
    const box = [];
    if (st.flow === 'fanpage' || st.flow === 'ready' || (st.flow === 'admin' && st.streamerId)) {
      const name = st.streamerName || st.streamerId;
      box.push(el('p', 'tw-train-lead', st.flow === 'ready' ? `${name} 팬페이지 다마고치를 하트 보석으로 꾸며요.` : `${name} 팬페이지의 다마고치`));
      if (st.streamerId) {
        const back = el('a', 'tw-gem-back', '← 팬페이지로 돌아가기');
        back.href = `${FANPAGE_BASE}#/p/${encodeURIComponent(st.streamerId)}`;
        box.push(back);
      }
    }
    if (st.flow === 'login' || st.flow === 'verify') {
      box.push(el('p', 'tw-train-lead', '스트리머의 팬페이지 다마고치 탭에서 [보석 상점]으로 들어오면 그 펫과 함께 열려요. 인증 스트리머는 여기서 바로 내 펫을 꾸밀 수 있어요.'));
      const go = el('button', 'tg-button tg-button-primary', st.flow === 'login' ? '로그인하기' : '스트리머 인증하기'); go.type = 'button';
      go.addEventListener('click', () => ctx.openLogin(st.flow === 'verify' ? { streamer: true } : undefined));
      box.push(go);
    }
    if (st.flow === 'admin') {
      const form = el('form', 'tw-train-admin-target');
      const input = el('input', 'tg-input'); input.type = 'text'; input.maxLength = 20; input.placeholder = '팬페이지 ID(SOOP 아이디)'; input.autocomplete = 'off'; input.spellcheck = false;
      input.value = st.streamerId;
      const btn = el('button', 'tg-button', '불러오기'); btn.type = 'submit';
      form.append(el('span', 'tw-train-lead', '관리자 · 팬페이지의 다마고치를 불러와 꾸밀 수 있어요.'), input, btn);
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
      const b = el('button', 'tw-train-pet', p.nickname || p.petId); b.type = 'button'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.petId === st.petId));
      b.addEventListener('click', () => { if (p.petId !== st.petId && !ui?.busy()) { st.petId = p.petId; void loadStatus(); } });
      return b;
    }) : []));
  }
  function renderShop() {
    const pet = currentPet();
    if (!pet || !st.server?.shop) { ui?.destroy(); ui = null; uiPet = ''; return; }
    if (ui && uiPet === pet.petId) { ui.render(); return; }
    ui?.destroy();
    uiPet = pet.petId;
    ui = mountGemShop(shopBox, {
      getServer: () => st.server, petColor: pet.color || 'cream',
      call: async (payload) => (await careCall({ streamerId: st.streamerId, petId: pet.petId, ...payload })).data,
      onApplied: (data) => { st.server = { ...st.server, ...data }; if (data?.shop) pet.wear = data.shop.equipped || {}; },
      hasAccount, openLogin: () => ctx.openLogin(),
      footer: '금고의 하트 보석은 팬들이 팬페이지에서 돌보며 함께 모아요. 산 꾸미기는 이 펫이 계속 가지며 되돌릴 수 없어요. 누가 샀는지는 남지 않아요.',
      viewNote: '꾸미기는 스트리머가 골라 입혀 줄 수 있어요. 입혀 보기는 누구나, 간식은 로그인하면 줄 수 있어요.',
    });
  }
  function render() { if (st.destroyed) return; renderWho(); renderPets(); renderShop(); }

  async function loadPets(streamerId) {
    st.streamerId = streamerId; st.loading = true; st.error = ''; st.pets = []; st.server = null; render();
    try {
      const data = (await shopCall({ action: 'pets', streamerId })).data || {};
      st.pets = Array.isArray(data.pets) ? data.pets : [];
      st.streamerName = String(data.streamer?.nickname || '');
      // 주소의 펫 아이디는 서버 목록에 있을 때만 쓴다
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
      st.server = data;
    } catch (error) { st.server = null; status.textContent = error?.message || '상점을 불러오지 못했어요.'; }
    render();
  }

  function start() {
    const target = resolveGemShopTarget({ search: location.search, isAnonymous: ctx.user?.isAnonymous !== false, viewer: viewer() });
    st.flow = target.flow; st.wantPet = target.petId || st.wantPet;
    if (target.streamerId) {
      if (target.streamerId !== st.streamerId || !st.pets.length) { void loadPets(target.streamerId); return; }
      void loadStatus(); return; // 로그인이 바뀌면 권한(shop.manage)이 달라질 수 있다
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
    busy: () => !!ui?.busy(),
    onAuthChange() { start(); },
    destroy() { st.destroyed = true; ui?.destroy(); root.remove(); },
  };
}

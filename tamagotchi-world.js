// 다마고치 마을(월드맵): 장소를 지도 위에 놓고, 장소를 누르면 지도 위 패널로 연다.
// 장소 추가 = catalog/tamagotchi-world.json에 항목 1개 + 패널 모듈(PANELS) 1개.
// 그림(바닥·건물·앞 덮개)이 아직 없으면 코드로 그린 임시 지도와 이모지 건물로 대신한다.
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

const V = '?v=20261113-tg-world3';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:cdddfe20075aa199a3a769',
};
const app = getApps().find((item) => item.name === '[DEFAULT]') || initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const shopCall = httpsCallable(getFunctions(app, 'us-central1'), 'streamerFanPageTamagotchiShop');

// 장소 패널 모듈. 규약: mount(host, ctx) → { destroy(), onAuthChange?() }
const PANELS = { train: () => import(`./tamagotchi-train.js${V}`).then((m) => m.mountTrainPanel) };

const $ = (id) => document.getElementById(id);
const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const mobileMq = window.matchMedia('(max-width: 720px), (orientation: portrait) and (max-width: 1024px)');
const state = { user: null, world: null, server: null, publicSpecies: [], loading: true, error: '', panel: null, placeId: '' };
let toastTimer = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(message) {
  const t = $('toast'); t.textContent = message; t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 2200);
}
const cashText = (v) => `${(Number(v) || 0).toLocaleString('ko-KR')}캐시`;
const layout = () => (mobileMq.matches ? 'm' : 'd');

// ---------- 임시 지도(그림이 오기 전): 잔디·흙길·빈 땅·나무를 SVG로 ----------
function fallbackGround(kind, lots) {
  const [rw, rh] = kind === 'm' ? [90, 160] : [160, 100];
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rw} ${rh}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tw-ground');
  const add = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
  add('rect', { x: 0, y: 0, width: rw, height: rh, fill: '#cfe8b4' });
  const entry = [rw / 2, rh];
  for (const [x, y] of lots) {
    const px = (x / 100) * rw; const py = (y / 100) * rh;
    const cx = (entry[0] + px) / 2 + (px < entry[0] ? -rw * 0.12 : rw * 0.12);
    add('path', { d: `M${entry[0]} ${entry[1]} Q${cx} ${(entry[1] + py) / 2} ${px} ${py}`, stroke: '#e9cfa2', 'stroke-width': kind === 'm' ? 7 : 6, fill: 'none', 'stroke-linecap': 'round' });
  }
  for (const [x, y, w] of lots) {
    const px = (x / 100) * rw; const py = (y / 100) * rh; const lw = (w / 100) * rw; const lh = lw * 0.55;
    add('ellipse', { cx: px, cy: py - lh * 0.25, rx: lw / 2, ry: lh / 2, fill: '#bfe0a0', stroke: '#fff8ea', 'stroke-width': 0.8, 'stroke-dasharray': '1.6 1.2' });
  }
  const trees = kind === 'm' ? [[10, 12], [80, 40], [12, 64], [84, 90], [16, 138], [78, 150]] : [[8, 14], [150, 18], [10, 86], [118, 90], [140, 52], [22, 40]];
  for (const [x, y] of trees) { add('circle', { cx: x, cy: y, r: 6.5, fill: '#9fd08a', stroke: '#7a5a3f', 'stroke-width': 0.7 }); add('circle', { cx: x - 2, cy: y - 2, r: 2.2, fill: '#b9e3a4' }); }
  const pond = kind === 'm' ? [22, 96, 9, 5] : [100, 76, 10, 6];
  add('ellipse', { cx: pond[0], cy: pond[1], rx: pond[2], ry: pond[3], fill: '#b8e1f0', stroke: '#7a5a3f', 'stroke-width': 0.7 });
  return svg;
}

function img(src, className, onFail) {
  const i = document.createElement('img'); i.className = className; i.alt = ''; i.decoding = 'async'; i.draggable = false;
  i.addEventListener('error', () => onFail?.(i), { once: true });
  i.src = src; return i;
}

// ---------- 지도 그리기 ----------
function renderMap() {
  const world = state.world; if (!world) return;
  const kind = layout(); const map = $('twMap');
  const [rw, rh] = world.layers[kind].ratio;
  map.className = `tw-map is-${kind}`; map.style.aspectRatio = `${rw} / ${rh}`;
  map.replaceChildren();
  const lots = world.lots[kind];
  // 바닥: 그림이 있으면 그림, 없으면 임시 지도
  const ground = img(world.layers[kind].ground, 'tw-ground', (i) => i.replaceWith(fallbackGround(kind, lots)));
  map.append(ground);
  // 빈 땅(장소가 없는 자리)은 바닥에만 보인다. 건물:
  for (const place of visiblePlaces()) {
    const lot = lots[place.lot]; if (!lot) continue;
    const [x, y, w] = lot;
    const b = el('button', `tw-bld tw-bld-${place.id}`); b.type = 'button';
    b.style.left = `${x}%`; b.style.top = `${y}%`; b.style.width = `${w * (kind === 'm' ? 0.7 : 1)}%`; // 세로 지도는 자리 사이가 좁아 건물을 줄인다
    b.setAttribute('aria-label', `${place.name} — ${place.desc}`);
    const art = el('span', 'tw-bld-art');
    const sprite = img(place.sprite, 'tw-bld-img', (i) => { i.replaceWith(el('span', 'tw-bld-emoji', place.emoji)); });
    art.append(sprite);
    const tag = el('span', 'tw-bld-tag'); tag.append(el('span', '', place.emoji), el('strong', '', place.name));
    b.append(art, tag);
    b.addEventListener('click', () => openPlace(place.id));
    map.append(b);
  }
  map.append(img(world.layers[kind].front, 'tw-front', (i) => i.remove()));
  if (!reduced) (world.clouds || []).forEach((src, n) => { const c = img(src, `tw-cloud tw-cloud-${n + 1}`, (i) => i.remove()); map.append(c); });
  // 지도 아래 장소 목록(작은 화면·스크린 리더)
  $('twPlaces').replaceChildren(...visiblePlaces().map((place) => {
    const b = el('button', 'tw-place-btn'); b.type = 'button';
    b.append(el('span', 'tw-place-emoji', place.emoji), el('strong', '', place.name), el('small', '', place.desc));
    b.addEventListener('click', () => openPlace(place.id));
    return b;
  }));
}
// 공개 전 장소(status soon)는 넣지 않는다. 지금 목록은 모두 열린 장소.
function visiblePlaces() { return (state.world?.places || []).filter((p) => p.status !== 'soon'); }

function renderBalance() {
  const wrap = $('tgBalance');
  const loggedIn = !!state.user && (!state.user.isAnonymous || state.server?.viewer?.isVerifiedStreamer === true);
  const show = !!state.server && state.server.stage !== 'preparing' && loggedIn;
  wrap.hidden = !show;
  if (show) $('tgBalanceValue').textContent = cashText(state.server.balanceCash);
  $('tgPreviewBadge').hidden = state.server?.adminPreview !== true;
}

function renderPage() {
  const notice = $('twNotice'); const world = $('twWorld');
  const show = (node) => { world.hidden = true; notice.hidden = false; notice.replaceChildren(node); };
  if (state.loading) { show(el('div', 'loading-card loading-bar', '마을을 불러오고 있어요…')); return; }
  if (state.error) {
    const box = el('div', 'empty-card'); box.append(el('strong', '', state.error));
    const retry = el('button', 'tg-button', '다시 시도'); retry.type = 'button'; retry.addEventListener('click', () => void reload());
    box.append(retry); show(box); return;
  }
  if (!state.server || state.server.stage === 'preparing') {
    const box = el('div', 'empty-card tg-preparing');
    box.append(el('strong', '', '다마고치 마을을 준비하고 있어요'), el('span', '', '곧 만나요! 열리면 이곳에서 안내할게요.'));
    show(box); return;
  }
  notice.hidden = true; notice.replaceChildren(); world.hidden = false;
  renderMap();
}

// ---------- 장소 패널(주소 #id) ----------
function placeById(id) { return visiblePlaces().find((p) => p.id === id) || null; }
function openPlace(id, { fromHash = false } = {}) {
  const place = placeById(id); if (!place) return;
  if (place.kind === 'link') { location.href = place.href; return; }
  if (!fromHash && location.hash !== `#${id}`) { history.pushState({ twPlace: id }, '', `#${id}`); }
  void showPanel(place);
}
async function showPanel(place) {
  if (state.placeId === place.id && $('twPlace').open) return;
  closePanel({ keepHash: true });
  state.placeId = place.id;
  $('twPlaceTitle').textContent = `${place.emoji} ${place.name}`;
  const host = $('twPlaceBody'); host.replaceChildren(el('div', 'loading-card loading-bar', `${place.name}에 들어가는 중…`));
  if (!$('twPlace').open) $('twPlace').showModal();
  try {
    const mount = await PANELS[place.module]();
    if (state.placeId !== place.id) return;
    host.replaceChildren();
    state.panel = mount(host, panelContext());
  } catch (error) {
    console.warn('장소를 열지 못했어요', error);
    host.replaceChildren(el('p', 'tg-status is-error', '장소를 열지 못했어요. 새로고침해 주세요.'));
  }
}
function closePanel({ keepHash = false } = {}) {
  state.panel?.destroy?.(); state.panel = null; state.placeId = '';
  if ($('twPlace').open) $('twPlace').close();
  if (!keepHash && location.hash) history.pushState(null, '', location.pathname + location.search);
}
function syncHash() {
  const id = location.hash.replace(/^#/, '');
  if (!state.server || state.server.stage === 'preparing') return;
  if (id && placeById(id)) openPlace(id, { fromHash: true });
  else if ($('twPlace').open) closePanel({ keepHash: true });
}
function panelContext() {
  return {
    shopCall, reduced, toast, cashText,
    get user() { return state.user; },
    get server() { return state.server; },
    get publicSpecies() { return state.publicSpecies; },
    openLogin: (opts) => window.openShopLoginModal?.(opts),
    reload: () => reload({ silent: true }),
    setBalance: (value) => { if (state.server) { state.server.balanceCash = Number(value) || 0; renderBalance(); } },
  };
}
$('twPlaceBack').addEventListener('click', () => closePanel());
$('twPlace').addEventListener('cancel', (e) => { if (state.panel?.busy?.()) { e.preventDefault(); return; } e.preventDefault(); closePanel(); });
window.addEventListener('popstate', syncHash);
window.addEventListener('hashchange', syncHash);
let resizeTimer = 0; let lastLayout = layout();
mobileMq.addEventListener?.('change', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (layout() !== lastLayout) { lastLayout = layout(); renderMap(); } }, 150); });

// ---------- 불러오기 ----------
async function reload({ silent = false } = {}) {
  if (!state.user) return;
  if (!silent) { state.loading = true; state.error = ''; renderPage(); }
  try {
    state.server = (await shopCall({ action: 'catalog' })).data || null;
    state.error = '';
  } catch (error) {
    if (!silent) state.error = error?.code === 'functions/unavailable' ? '서비스 점검 중이에요. 잠시 후 다시 열어 주세요.' : '마을을 불러오지 못했어요.';
  }
  state.loading = false;
  renderBalance();
  if (!silent) { renderPage(); syncHash(); }
  state.panel?.onAuthChange?.();
}
async function loadStatic() {
  try {
    const [w, c] = await Promise.all([fetch('catalog/tamagotchi-world.json', { cache: 'no-cache' }), fetch('catalog/tamagotchi.json', { cache: 'no-cache' })]);
    if (!w.ok || !c.ok) throw new Error('catalog');
    state.world = await w.json();
    state.publicSpecies = (await c.json()).species || [];
  } catch (_) { state.error = '마을을 불러오지 못했어요.'; }
}

let firstAuth = true;
onAuthStateChanged(auth, (user) => {
  state.user = user;
  if (!user) return; // shop-login.js가 익명 세션을 시작한다
  if (firstAuth) { firstAuth = false; void loadStatic().then(() => reload()); return; }
  void reload();
});
window.addEventListener('shop-auth-changed', () => { void reload(); });
renderPage();

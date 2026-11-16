// 다마고치 마을(월드맵): 장소를 지도 위에 놓고, 장소를 누르면 지도 위 패널로 연다.
// 장소 추가 = catalog/tamagotchi-world.json에 항목 1개 + 패널 모듈(PANELS) 1개.
// 그림(바닥·건물·앞 덮개)이 아직 없으면 코드로 그린 임시 지도와 이모지 건물로 대신한다.
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { ensureAppCheck } from './app-check.js?v=20261114-ac1';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

const V = '?v=20261116-tg-dist5';
import { trackPetFailures, normalizeWorld, districtById, neighbor, minimapCells, swipeStarts, swipeResult, dragOffset } from './tamagotchi-logic.mjs?v=20261116-tg-dist1';
import { installUiSound } from './tamagotchi-ui-sound.js?v=20261113-tg-uisnd1';
installUiSound();
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
ensureAppCheck(app);
const auth = getAuth(app);
// 분양·훈련 실패는 단계별로 기록한다(서버 기록 + 서버에 닿지 못한 실패는 화면 보고).
const shopCall = trackPetFailures(
  httpsCallable(getFunctions(app, 'us-central1'), 'streamerFanPageTamagotchiShop'),
  httpsCallable(getFunctions(app, 'us-central1'), 'streamerFanPageTamagotchiFailures'),
);
const careCall = httpsCallable(getFunctions(app, 'us-central1'), 'streamerFanPageTamagotchiCare'); // 보석 상점(금고·꾸미기)

// 장소 패널 모듈. 규약: mount(host, ctx) → { destroy(), onAuthChange?() }
const PANELS = {
  train: () => import(`./tamagotchi-train.js${V}`).then((m) => m.mountTrainPanel),
  gemShop: () => import(`./tamagotchi-gem-shop.js${V}`).then((m) => m.mountGemShopPanel),
  hospital: () => import(`./tamagotchi-hospital.js${V}`).then((m) => m.mountHospitalPanel),
  photo: () => import(`./tamagotchi-photo.js${V}`).then((m) => m.mountPhotoPanel),
};

const $ = (id) => document.getElementById(id);
const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const mobileMq = window.matchMedia('(max-width: 720px), (orientation: portrait) and (max-width: 1024px)');
const state = { user: null, world: null, server: null, publicSpecies: [], loading: true, error: '', panel: null, placeId: '', district: '' };
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

// 보이지 않는 동안 구름 애니메이션 정지(배터리·발열 절약)
let motionWatched = false;
function watchMapMotion(map) {
  if (motionWatched) return; motionWatched = true;
  let onScreen = true;
  const apply = () => map.classList.toggle('tw-paused', !onScreen || document.hidden);
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; apply(); }).observe(map);
  document.addEventListener('visibilitychange', apply);
}

// ---------- 지도 그리기(동네 격자: 지금 동네 + 좌우 이웃을 한 줄로 놓고 가로로 끌어 넘긴다) ----------
function districtPane(d, kind) {
  const pane = el('div', 'tw-pane'); pane.dataset.district = d.id;
  const layer = (d.layers && d.layers[kind]) || {};
  const lots = (d.lots && d.lots[kind]) || [];
  pane.append(layer.ground ? img(layer.ground, 'tw-ground', (i) => i.replaceWith(fallbackGround(kind, lots))) : fallbackGround(kind, lots));
  for (const place of visiblePlaces().filter((p) => p.district === d.id)) {
    const lot = lots[place.lot]; if (!lot) continue;
    const [x, y, w] = lot;
    const b = el('button', `tw-bld tw-bld-${place.id}`); b.type = 'button';
    b.style.left = `${x}%`; b.style.top = `${y}%`; b.style.width = `${w}%`;
    b.setAttribute('aria-label', `${place.name} — ${place.desc}`);
    const art = el('span', 'tw-bld-art');
    art.append(img(place.sprite, 'tw-bld-img', (i) => { i.replaceWith(el('span', 'tw-bld-emoji', place.emoji)); }));
    const tag = el('span', 'tw-bld-tag'); tag.append(el('span', '', place.emoji), el('strong', '', place.name));
    b.append(art, tag);
    b.addEventListener('click', (e) => { if (drag.suppressClick) { e.preventDefault(); return; } openPlace(place.id); });
    pane.append(b);
  }
  if (layer.front) pane.append(img(layer.front, 'tw-front', (i) => i.remove()));
  return pane;
}
function currentDistrict() { return districtById(state.world, state.district) || districtById(state.world, state.world.home); }
function renderMap() {
  const world = state.world; if (!world) return;
  const kind = layout(); const map = $('twMap');
  const cur = currentDistrict(); if (!cur) return;
  state.district = cur.id;
  const ratio = (cur.layers?.[kind]?.ratio) || (kind === 'm' ? [9, 16] : [16, 10]);
  map.className = `tw-map is-${kind}`; map.style.aspectRatio = `${ratio[0]} / ${ratio[1]}`;
  const left = neighbor(world, cur.id, 'left'); const right = neighbor(world, cur.id, 'right');
  const track = el('div', 'tw-track');
  const panes = [left, cur, right].map((d, n) => { const p = d ? districtPane(d, kind) : el('div', 'tw-pane is-edge'); p.style.left = `${(n - 1) * 100}%`; if (n !== 1) { p.inert = true; p.setAttribute('aria-hidden', 'true'); } return p; });
  track.append(...panes);
  map.replaceChildren(track);
  const clouds = (world.clouds || []).slice(0, kind === 'm' ? 1 : undefined);
  if (!reduced) clouds.forEach((src, n) => { const c = img(src, `tw-cloud tw-cloud-${n + 1}`, (i) => i.remove()); map.append(c); });
  // 화살표·미니맵(동네가 둘 이상일 때만)
  const many = world.districts.filter((d) => d.status === 'open').length > 1;
  if (many) {
    for (const [dir, nb, label] of [['left', left, '◀'], ['right', right, '▶']]) {
      if (!nb) continue;
      const a = el('button', `tw-arrow is-${dir}`); a.type = 'button'; a.setAttribute('aria-label', `${nb.name || '옆 동네'} 쪽으로 가기`);
      a.append(el('span', '', label), el('small', '', nb.name || ''));
      a.addEventListener('click', () => goDistrict(nb.id, dir));
      map.append(a);
    }
    const mm = minimapCells(world, cur.id);
    const mini = el('div', 'tw-minimap'); mini.style.gridTemplateColumns = `repeat(${mm.cols}, 1fr)`; mini.setAttribute('aria-label', '마을 지도');
    for (const c of mm.cells) {
      const cell = el('button', `tw-mini-cell is-${c.state}`); cell.type = 'button';
      cell.title = c.state === 'soon' ? '준비 중' : c.name; cell.disabled = c.state === 'empty' || c.state === 'soon' || c.state === 'current';
      if (c.state === 'current') cell.setAttribute('aria-current', 'true');
      cell.addEventListener('click', () => goDistrict(c.id));
      mini.append(cell);
    }
    map.append(mini);
    map.append(el('div', 'tw-district-name', cur.name || ''));
  }
  map.tabIndex = many ? 0 : -1;
  watchMapMotion(map);
  // 지도 아래 장소 목록: 모든 동네의 장소(누르면 그 동네로 가서 연다)
  $('twPlaces').replaceChildren(...visiblePlaces().map((place) => {
    const b = el('button', 'tw-place-btn'); b.type = 'button';
    b.append(el('span', 'tw-place-emoji', place.emoji), el('strong', '', place.name), el('small', '', place.desc));
    b.addEventListener('click', () => openPlace(place.id));
    return b;
  }));
}
function syncDistrictUrl() {
  const u = new URL(location.href);
  if (state.district && state.district !== state.world.home) u.searchParams.set('d', state.district); else u.searchParams.delete('d');
  if (u.href !== location.href) history.replaceState(history.state, '', u.href);
}
// 동네 이동: 트랙을 300ms(경과 시간 기준 CSS 전환) 밀고 끝나면 새로 그린다. 동작 줄이기면 바로.
let moving = false;
function goDistrict(id, dir) {
  if (moving || !districtById(state.world, id) || id === state.district) return;
  const track = $('twMap').querySelector('.tw-track');
  const done = () => { moving = false; state.district = id; syncDistrictUrl(); renderMap(); };
  if (reduced || !track || !dir || (dir !== 'left' && dir !== 'right')) { done(); return; }
  moving = true;
  track.style.transition = 'transform 300ms ease-out';
  track.style.transform = `translate3d(${dir === 'right' ? -100 : 100}%,0,0)`;
  let fired = false; const finish = () => { if (!fired) { fired = true; done(); } };
  track.addEventListener('transitionend', finish, { once: true }); setTimeout(finish, 400);
}
// 가로 끌기(세로는 페이지 스크롤에 맡김: touch-action pan-y)
const drag = { id: null, x: 0, y: 0, t: 0, on: false, dx: 0, suppressClick: false };
function bindMapDrag() {
  const map = $('twMap');
  map.addEventListener('pointerdown', (e) => {
    if (moving || e.button > 0 || e.target.closest('.tw-arrow, .tw-minimap')) return;
    Object.assign(drag, { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), on: false, dx: 0 });
  });
  map.addEventListener('pointermove', (e) => {
    if (drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    const cur = state.district;
    const sides = { hasLeft: !!neighbor(state.world, cur, 'left'), hasRight: !!neighbor(state.world, cur, 'right') };
    if (!sides.hasLeft && !sides.hasRight) return;
    if (!drag.on) { if (!swipeStarts(dx, dy)) { if (Math.abs(dy) > 12) drag.id = null; return; } drag.on = true; try { map.setPointerCapture(e.pointerId); } catch (_) {} }
    drag.dx = dx;
    const track = map.querySelector('.tw-track'); if (!track) return;
    track.style.transition = 'none';
    track.style.transform = `translate3d(${dragOffset(dx, sides)}px,0,0)`;
  });
  const end = (e) => {
    if (drag.id !== e.pointerId) return;
    const was = drag.on; drag.id = null; drag.on = false; if (!was) return;
    drag.suppressClick = true; setTimeout(() => { drag.suppressClick = false; }, 60);
    const cur = state.district;
    const sides = { hasLeft: !!neighbor(state.world, cur, 'left'), hasRight: !!neighbor(state.world, cur, 'right') };
    const dir = swipeResult({ dx: drag.dx, ms: performance.now() - drag.t, width: map.clientWidth, ...sides });
    const track = map.querySelector('.tw-track');
    if (dir) {
      const nb = neighbor(state.world, cur, dir); moving = true;
      const done = () => { moving = false; state.district = nb.id; syncDistrictUrl(); renderMap(); };
      if (reduced || !track) { done(); return; }
      track.style.transition = 'transform 220ms ease-out'; track.style.transform = `translate3d(${dir === 'right' ? -100 : 100}%,0,0)`;
      let fired = false; const finish = () => { if (!fired) { fired = true; done(); } };
      track.addEventListener('transitionend', finish, { once: true }); setTimeout(finish, 320);
    } else if (track) { track.style.transition = reduced ? 'none' : 'transform 200ms ease-out'; track.style.transform = 'translate3d(0,0,0)'; }
  };
  map.addEventListener('pointerup', end); map.addEventListener('pointercancel', end);
  map.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : '';
    const nb = dir && neighbor(state.world, state.district, dir);
    if (nb) { e.preventDefault(); goDistrict(nb.id, dir); }
  });
}
bindMapDrag();
// 공개 전 장소(status soon)는 넣지 않는다. 지금 목록은 모두 열린 장소.
function visiblePlaces() { return (state.world?.places || []).filter((p) => p.status !== 'soon'); }

function renderBalance() {
  const wrap = $('tgBalance');
  const loggedIn = !!state.user && (!state.user.isAnonymous || state.server?.viewer?.isVerifiedStreamer === true);
  const show = !!state.server && state.server.stage !== 'preparing' && loggedIn;
  wrap.hidden = !show;
  if (show) $('tgBalanceValue').textContent = cashText(state.server.balanceCash);
  $('tgPreviewBadge').hidden = state.server?.adminPreview !== true;
  renderFanpageLink();
}
// 팬페이지로 돌아가기: 주소의 ?s=(팬페이지에서 들어온 경우) → 없으면 인증 스트리머 본인 팬페이지. 공개 아이디만 쓴다.
function renderFanpageLink() {
  const link = $('twFanpageLink'); if (!link) return;
  const fromUrl = String(new URLSearchParams(location.search).get('s') || '').trim().toLowerCase();
  const own = String(state.server?.viewer?.streamer?.id || '');
  const id = /^[a-z0-9_-]{1,64}$/.test(fromUrl) ? fromUrl : /^[a-z0-9_-]{1,64}$/.test(own) ? own : '';
  // 갈 팬페이지를 모르면(비로그인·펫 없음·관리자) 팬페이지 홈(스트리머 목록)으로
  link.hidden = false;
  link.href = id ? `https://neezu-crypto.github.io/streamer-fanpage/#/p/${encodeURIComponent(id)}` : 'https://neezu-crypto.github.io/streamer-fanpage/';
  link.textContent = id ? '← 팬페이지로' : '← 팬페이지 홈으로';
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
  if (place.district && place.district !== state.district && districtById(state.world, place.district)) { state.district = place.district; syncDistrictUrl(); renderMap(); }
  if (!fromHash && location.hash !== `#${id}`) { history.pushState({ twPlace: id }, '', `#${id}`); }
  void showPanel(place);
}
async function showPanel(place) {
  if (state.placeId === place.id && $('twPlace').open) return;
  closePanel({ keepHash: true });
  state.placeId = place.id;
  $('twPlaceTitle').textContent = `${place.emoji} ${place.name}`;
  $('twPlace').dataset.place = place.id; // 장소별 창 너비를 로딩 때부터 맞춘다(넓어지며 튀지 않게)
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
    shopCall, careCall, reduced, toast, cashText,
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
    state.world = normalizeWorld(await w.json());
    const d = new URLSearchParams(location.search).get('d');
    state.district = districtById(state.world, d) ? d : state.world.home;
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

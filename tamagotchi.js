import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { createToolController, TOOLS } from './tamagotchi-tools.js?v=20261112-tg-shop39';
import { createMongsil } from './tamagotchi-pet.js?v=20261112-tg-shop39';
import {
  normalizeNickname, resolvePurchaseState, getOrCreateRequestId, clearRequestId, shouldDiscardRequestId,
  adoptErrorMessage, farmUrl, COLOR_LABELS,
} from './tamagotchi-logic.mjs?v=20261112-tg-shop39';

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

const $ = (id) => document.getElementById(id);
const INTENT_KEY = 'tamagotchiAdoptIntent';
const REQUEST_KEY = 'tamagotchiAdoptRequest';

const state = { user: null, publicSpecies: [], server: null, error: '', loading: true, busy: false, speciesId: '', color: '' };
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let petApi = null; let petSpeciesId = ''; let toolCtl = null;
let toastTimer;

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message; toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function cashText(value) { return `${(Number(value) || 0).toLocaleString('ko-KR')}캐시`; }
function randomBytes(n) { const bytes = new Uint8Array(n); crypto.getRandomValues(bytes); return bytes; }
function serverSpecies(id) { return (state.server?.species || []).find((item) => item.id === id) || null; }
function publicSpecies(id) { return state.publicSpecies.find((item) => item.id === id) || null; }

function loadIntent() { try { return JSON.parse(sessionStorage.getItem(INTENT_KEY) || 'null'); } catch (_) { return null; } }
function saveIntent(intent) { try { sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent)); } catch (_) { /* 저장 불가 시 이어하기만 생략 */ } }
function clearIntent() { try { sessionStorage.removeItem(INTENT_KEY); } catch (_) { /* 무시 */ } }

// ---------- 화면: 목록 ----------
function renderBalance() {
  const wrap = $('tgBalance');
  const loggedIn = !!state.user && (!state.user.isAnonymous || state.server?.viewer?.isVerifiedStreamer === true);
  const show = !!state.server && state.server.stage !== 'preparing' && loggedIn;
  wrap.hidden = !show;
  if (show) $('tgBalanceValue').textContent = cashText(state.server.balanceCash);
  $('tgPreviewBadge').hidden = state.server?.adminPreview !== true;
}

function renderList() {
  const list = $('tgList'); const showcase = $('tgShowcase');
  const showNotice = (node) => { showcase.hidden = true; list.hidden = false; list.replaceChildren(node); };
  if (state.loading) { showNotice(el('div', 'loading-card loading-bar', '분양소를 불러오고 있어요…')); return; }
  if (state.error) {
    const box = el('div', 'empty-card');
    box.append(el('strong', '', state.error));
    const retry = el('button', 'tg-button', '다시 시도'); retry.type = 'button';
    retry.addEventListener('click', () => void reload());
    box.append(retry); showNotice(box); return;
  }
  const species = (state.server?.species || []).filter((item) => publicSpecies(item.id));
  if (!state.server || state.server.stage === 'preparing' || !species.length) {
    const box = el('div', 'empty-card tg-preparing');
    box.append(el('strong', '', '분양소를 준비하고 있어요'), el('span', '', '곧 만나요! 열리면 이곳에서 안내할게요.'));
    showNotice(box); return;
  }
  list.hidden = true; list.replaceChildren(); showcase.hidden = false;
  if (!species.some((item) => item.id === state.speciesId)) { state.speciesId = species[0].id; state.color = ''; }
  renderShowcase(serverSpecies(state.speciesId), publicSpecies(state.speciesId));
}

// ---------- 화면: 미리보기 무대 ----------
function renderShowcase(server, pub) {
  if (!pub.colors.some((c) => c.id === state.color)) state.color = pub.colors[0].id;
  if (!petApi || petSpeciesId !== server.id) {
    toolCtl?.destroy(); petApi?.destroy();
    petApi = createMongsil($('tgPet'), { color: state.color, reduced: reducedMotion });
    petSpeciesId = server.id;
    toolCtl = createToolController({
      stage: $('tgStage'), petApi, petEl: $('tgPet'), ignoreOutside: [$('tgActions')], reduced: reducedMotion,
      onChange: (event) => onToolChange(event),
    });
  }
  petApi.setColor(state.color);
  renderStageColors(pub); renderActions(pub); renderInfo(server, pub); renderHealth();
}

// ---------- 크게 보기(전체화면·화면 방향 선택) ----------
// 모든 기기: 무대를 화면 전체에 띄우는 오버레이. 지원 기기(안드로이드 등): 실제 전체화면 + 방향 고정.
// 방향: 자동(산책·입원일 때 가로) / 세로 / 가로. 고정을 지원하지 않으면(아이폰 등) 돌려 달라는 안내만 보인다.
const ORIENT_KEY = 'tgOrientPref';
let expanded = false; let orientHintTimer = 0; let lockedAs = ''; let resizeTimer = 0;
function orientPref() { try { return localStorage.getItem(ORIENT_KEY) || 'auto'; } catch (_) { return 'auto'; } }
function wantedOrientation() {
  const pref = orientPref();
  if (pref !== 'auto') return pref;
  return (toolCtl?.selected() === 'walk' || healthState === 'hospital') ? 'landscape' : null;
}
async function applyOrientation() {
  if (!expanded) return;
  const want = wantedOrientation();
  document.querySelectorAll('[data-orient]').forEach((n) => n.setAttribute('aria-checked', String(n.dataset.orient === orientPref())));
  const o = screen.orientation;
  let locked = false;
  // 같은 요청을 반복하지 않는다(가로 화면에서 잦은 크기 변경 → 고정 요청 → 다시 크기 변경 반복 방지).
  try {
    if (want && o && o.lock && document.fullscreenElement) {
      if (lockedAs !== want) { await o.lock(want); lockedAs = want; }
      locked = true;
    } else if (!want && lockedAs && o && o.unlock && document.fullscreenElement) { o.unlock(); lockedAs = ''; }
  } catch (_) { locked = false; lockedAs = ''; }
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  const mismatch = want && !locked && ((want === 'landscape') !== isLandscape);
  const hint = $('tgOrientHint');
  clearTimeout(orientHintTimer);
  if (mismatch) {
    hint.textContent = want === 'landscape' ? '📱↻ 휴대폰을 가로로 돌리면 더 크게 볼 수 있어요' : '📱↻ 휴대폰을 세로로 돌려 주세요';
    hint.hidden = false; orientHintTimer = setTimeout(() => { hint.hidden = true; }, 3500);
  } else hint.hidden = true;
}
// 크게 보기 가로에서만 흐림 필터를 끈다(가벼운 표현). 기본·세로는 원본 화질.
function syncPowerMode() {
  const lite = expanded && window.matchMedia('(orientation: landscape)').matches;
  // 프레임은 모든 화면 60fps(주사율 그대로). 가로는 흐림 필터만 끈다. 프레임 제한 기능은 남겨 두고 쓰지 않는다.
  petApi?.setLowPower?.(false); toolCtl?.setLowPower?.(false);
  document.querySelector('.tg-tool-cursor')?.classList.toggle('is-lite', lite);
}
function relayoutStage() {
  syncPowerMode(); requestAnimationFrame(() => { if (healthState === 'hospital') placeOnBed(true); }); }
async function setExpanded(on, { fromHistory = false } = {}) {
  if (on === expanded) return;
  expanded = on; toolCtl?.clear();
  const box = $('tgShowcase');
  box.classList.toggle('is-expanded', on); $('tgExpandBar').hidden = !on; $('tgExpand').hidden = on;
  document.documentElement.classList.toggle('tg-noscroll', on);
  if (on) {
    if (!fromHistory) history.pushState({ tgExpanded: true }, '');
    try { if (document.fullscreenEnabled && !document.fullscreenElement) await box.requestFullscreen({ navigationUI: 'hide' }); } catch (_) { /* 오버레이로 대체 */ }
    await applyOrientation();
  } else {
    $('tgOrientHint').hidden = true;
    try { screen.orientation?.unlock?.(); } catch (_) { /* 무시 */ } lockedAs = '';
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) { /* 무시 */ } }
    if (!fromHistory && history.state && history.state.tgExpanded) history.back();
  }
  relayoutStage();
}
function bindExpand() {
  $('tgExpand').addEventListener('click', () => setExpanded(true));
  $('tgExpandClose').addEventListener('click', () => setExpanded(false));
  document.querySelectorAll('[data-orient]').forEach((n) => n.addEventListener('click', () => {
    try { localStorage.setItem(ORIENT_KEY, n.dataset.orient); } catch (_) { /* 무시 */ }
    applyOrientation();
  }));
  window.addEventListener('popstate', () => { if (expanded) setExpanded(false, { fromHistory: true }); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && expanded) setExpanded(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded && !document.fullscreenElement) setExpanded(false); });
  // 크기 변경은 멈춘 뒤 한 번만 처리한다(주소창이 접혔다 펴질 때 연속 발생).
  window.addEventListener('resize', () => { if (!expanded) return; clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { relayoutStage(); applyOrientation(); }, 200); });
}
bindExpand();

// ---------- 건강 상태·스탯 미리보기(막대+표정, 값은 예시) ----------
const HEALTH_STATES = [
  { id: 'ok', label: '건강', stats: [80, 85, 75, 30, 95] },
  { id: 'low', label: '컨디션 저하', stats: [45, 40, 50, 70, 50] },
  { id: 'sick', label: '아픔', stats: [15, 20, 25, 85, 20] },
  { id: 'down', label: '쓰러짐', stats: [5, 10, 10, 95, 0] },
  { id: 'hospital', label: '입원', stats: [50, 50, 50, 30, 40] },
];
const STAT_NAMES = ['배부름', '기분', '청결', '피로', '건강'];
const BLOCK_TEXT = { sick: '아파서 지금은 쉬어야 해요. 쓰다듬기·밥주기·낮잠·수다만 할 수 있어요.', down: '쓰러졌어요… 쓰다듬기만 할 수 있어요. 곧 병원에 가요.', hospital: '입원 중이에요. 병문안(쓰다듬기·수다·응원)만 할 수 있어요.' };
let healthState = 'ok';
function statFace(value, inverse) {
  const v = inverse ? 100 - value : value;
  return v >= 70 ? '😊' : v >= 40 ? '🙂' : v >= 20 ? '😟' : v > 0 ? '😣' : '😵';
}
function renderStats() {
  const st = HEALTH_STATES.find((h) => h.id === healthState);
  $('tgStats').replaceChildren(...STAT_NAMES.map((name, i) => {
    const value = st.stats[i]; const inverse = name === '피로';
    const row = el('div', 'tg-stat'); row.title = `${name} ${value}`;
    const face = el('span', 'tg-stat-face'); face.textContent = statFace(value, inverse); face.setAttribute('aria-hidden', 'true');
    const label = el('span', 'tg-stat-name'); label.textContent = name;
    const bar = el('span', 'tg-stat-bar'); bar.setAttribute('role', 'meter'); bar.setAttribute('aria-label', name);
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(value));
    const fill = el('i'); fill.style.width = `${value}%`;
    const good = inverse ? 100 - value : value;
    fill.dataset.level = good >= 60 ? 'good' : good >= 30 ? 'mid' : 'bad';
    bar.append(fill); row.append(face, label, bar); return row;
  }));
}
function applyHealth(id) {
  healthState = id; toolCtl?.clear(); hideTip();
  petApi?.setCondition?.(id);
  $('tgStage').classList.toggle('is-hospital', id === 'hospital');
  placeOnBed(id === 'hospital'); applyOrientation();
  $('tgHospital').hidden = id !== 'hospital';
  document.querySelectorAll('[data-health]').forEach((n) => n.setAttribute('aria-checked', String(n.dataset.health === id)));
  $('tgBubble').textContent = id === 'ok' ? IDLE_BUBBLE : BLOCK_TEXT[id] || '컨디션이 떨어졌어요. 잘 먹고 푹 쉬게 해 주세요.';
  renderStats();
}
// 병실 일러스트(1585×992)의 베개 위치에 펫을 얹는다. 배경이 cover로 그려지므로 같은 계산으로 좌표를 맞춘다.
const ROOM = { w: 1585, h: 992, pillow: [712, 690], petWidth: 330 };
function placeOnBed(on) {
  const pet = $('tgPet'); const stage = $('tgStage');
  if (!stage.querySelector('.tg-hospital-front')) { const f = el('div', 'tg-hospital-front'); f.setAttribute('aria-hidden', 'true'); stage.append(f); }
  if (!on) { pet.style.transform = ''; window.removeEventListener('resize', bedResize); return; }
  pet.style.transform = '';
  const s = stage.getBoundingClientRect(); const p = pet.getBoundingClientRect();
  const k = Math.max(s.width / ROOM.w, s.height / ROOM.h);
  const ox = (s.width - ROOM.w * k) / 2; const oy = (s.height - ROOM.h * k) / 2;
  const tx = ox + ROOM.pillow[0] * k; const ty = oy + ROOM.pillow[1] * k;
  const scale = (ROOM.petWidth * k) / p.width;
  const cx = p.left - s.left + p.width / 2; const cy = p.top - s.top + p.height / 2;
  pet.style.transform = `translate(${(tx - cx).toFixed(1)}px, ${(ty - cy).toFixed(1)}px) scale(${scale.toFixed(3)})`;
  window.addEventListener('resize', bedResize);
}
let bedTimer = 0;
function bedResize() { clearTimeout(bedTimer); bedTimer = setTimeout(() => { if (healthState === 'hospital') placeOnBed(true); }, 200); }
function renderHealth() {
  $('tgHealth').replaceChildren(...HEALTH_STATES.map((h) => {
    const b = el('button', 'tg-health-chip'); b.type = 'button'; b.dataset.health = h.id; b.textContent = h.label;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(h.id === healthState));
    b.addEventListener('click', () => applyHealth(h.id));
    return b;
  }));
  renderStats();
}

function applyColor(colorId) {
  state.color = colorId; petApi?.setColor(colorId);
  document.querySelectorAll('[data-color]').forEach((node) => node.setAttribute('aria-checked', String(node.dataset.color === colorId)));
}

function renderStageColors(pub) {
  $('tgStageColors').replaceChildren(...pub.colors.map((c) => {
    const b = el('button', 'tg-stage-dot'); b.type = 'button'; b.dataset.color = c.id; b.style.background = c.swatch;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', c.label); b.title = c.label;
    b.setAttribute('aria-checked', String(c.id === state.color));
    b.addEventListener('click', () => applyColor(c.id));
    return b;
  }));
}

const IDLE_BUBBLE = '아래 상호작용을 눌러 미리 보세요';
function toolItem(id) { return (publicSpecies(state.speciesId)?.interactions || []).find((item) => item.tool === id) || null; }
function syncToolButtons() {
  const selected = toolCtl?.selected() || '';
  document.querySelectorAll('.tg-action[data-tool]').forEach((node) => {
    const on = node.dataset.tool === selected;
    node.classList.toggle('is-selected', on); node.setAttribute('aria-pressed', String(on));
  });
}
let tipTimer = 0;
function hideTip() { clearTimeout(tipTimer); $('tgTip').hidden = true; }
function showTip(text) {
  const tip = $('tgTip'); hideTip();
  if (!text) return;
  tip.textContent = text; tip.hidden = false;
  tipTimer = setTimeout(hideTip, 7000);
}
function onToolChange(event) {
  const item = toolItem(event.tool) || { label: '' };
  if (event.type === 'select') { $('tgBubble').textContent = `${item.label} 선택 중 — ${toolHint(event.tool)}`; showTip(TOOLS[event.tool]?.tip); }
  if (event.type === 'clear') { $('tgBubble').textContent = healthState === 'ok' ? IDLE_BUBBLE : BLOCK_TEXT[healthState] || IDLE_BUBBLE; hideTip(); }
  if (event.type === 'blocked') { $('tgBubble').textContent = BLOCK_TEXT[event.condition] || '지금은 할 수 없어요.'; }
  if (event.type === 'act') hideTip();
  if (event.type === 'walk') { if (event.meters > 0) hideTip(); $('tgBubble').textContent = event.meters > 0 ? `산책 중… ${event.meters}m 걸었어요` : '산책로에 도착했어요! 클릭하거나 누른 채 같이 걸어요'; }
  if (event.type === 'stat') $('tgBubble').textContent = event.value > 0 ? `쿨쿨… 피로가 풀리고 있어요 (피로 ${event.value}, ${event.delta})` : '쿨쿨… 피로가 모두 풀렸어요 ✦';
  if (event.type === 'act') $('tgBubble').textContent = `${TOOLS[event.tool]?.done || item.label} ${event.count}`;
  syncToolButtons();
  if (event.type === 'select' || event.type === 'clear') applyOrientation();
}
function toolHint(id) { return TOOLS[id]?.hint || ''; }

function playPreview(item) {
  if (!petApi) return;
  toolCtl?.clear(); hideTip();
  petApi.play(item.preset, { hop: item.hop === true });
  $('tgBubble').textContent = `${item.label} — ${item.desc}`;
}

function renderActions(pub) {
  const row = $('tgActions');
  row.replaceChildren(...pub.interactions.map((item) => {
    const button = el('button', `tg-action${item.group === 'training' ? ' is-training' : ''}`);
    button.type = 'button'; button.dataset.interaction = item.id;
    button.append(el('span', 'tg-action-label', item.label));
    if (item.group === 'training') button.append(el('span', 'tg-action-tag', '훈련소'));
    if (item.tool && toolCtl?.isSupported(item.tool)) {
      button.dataset.tool = item.tool; button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        if (toolCtl.selected() === item.tool) toolCtl.clear(); else toolCtl.select(item.tool);
      });
    } else {
      button.addEventListener('click', () => playPreview(item));
    }
    return button;
  }));
}

function renderInfo(server, pub) {
  const info = $('tgInfo');
  const base = pub.interactions.filter((item) => item.group === 'base');
  const training = pub.interactions.filter((item) => item.group === 'training');
  const head = el('div', 'tg-info-head');
  head.append(el('p', 'tg-card-tagline', pub.tagline), el('h2', 'tg-name', pub.name), el('p', 'tg-desc', pub.description));

  const colors = el('div', 'tg-info-block');
  colors.append(el('h3', 'tg-block-title', '색상'));
  const colorRow = el('div', 'tg-color-row tg-color-row-inline'); colorRow.setAttribute('role', 'radiogroup'); colorRow.setAttribute('aria-label', '색상 선택');
  pub.colors.forEach((c) => {
    const b = el('button', 'tg-color-choice'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.color = c.id;
    b.setAttribute('aria-checked', String(c.id === state.color));
    const dot = el('span', 'tg-swatch tg-swatch-lg'); dot.style.background = c.swatch;
    b.append(dot, el('span', '', c.label));
    b.addEventListener('click', () => applyColor(c.id));
    colorRow.append(b);
  });
  colors.append(colorRow);

  const facts = el('div', 'tg-info-block');
  facts.append(el('h3', 'tg-block-title', '정보'));
  const dl = el('dl', 'tg-facts');
  const rows = [
    ['분양비', `${cashText(server.adoptCash)} · 한 번만 내요`],
    ['함께 지내는 곳', pub.info.home],
    ['돌봐 주는 사람', pub.info.care],
    ['컨디션', pub.info.stats],
    ['기본 상호작용', `${base.length}종 · 처음부터 함께해요`],
    ['훈련소 상호작용', `${training.length}종 · 아이마다 따로 배워요(유료)`],
    ['환불', '한 번 맞이한 친구의 분양비는 환불되지 않아요'],
  ];
  rows.forEach(([k, v]) => { dl.append(el('dt', '', k), el('dd', '', v)); });
  facts.append(dl);

  const inter = el('div', 'tg-info-block');
  inter.append(el('h3', 'tg-block-title', '상호작용'));
  for (const [title, items] of [['기본 · 맞이하면 바로 함께해요', base], ['훈련소 · 배우면 함께할 수 있어요', training]]) {
    inter.append(el('p', 'tg-group-title', title));
    const ul = el('ul', 'tg-interaction-list');
    items.forEach((item) => { const li = el('li'); li.append(el('strong', '', item.label), el('span', '', item.desc)); ul.append(li); });
    inter.append(ul);
  }

  const cta = el('div', 'tg-cta');
  const adopt = el('button', 'tg-button tg-button-primary tg-cta-button', `${pub.name} 맞이하기 · 분양비 ${cashText(server.adoptCash)}`); adopt.type = 'button';
  adopt.addEventListener('click', () => startAdopt(server.id, { color: state.color, name: '' }));
  cta.append(adopt);
  info.replaceChildren(head, colors, facts, inter, cta);
}

// ---------- 구매 흐름 ----------
function currentState(server) {
  return resolvePurchaseState({
    isAnonymous: state.user ? state.user.isAnonymous : true,
    viewer: state.server?.viewer || null,
    balanceCash: state.server?.balanceCash,
    priceCash: server.adoptCash,
  });
}

function openDialog(content) {
  $('tgDialogBody').replaceChildren(...content);
  if (!$('tgDialog').open) $('tgDialog').showModal();
}
function closeDialog() { if ($('tgDialog').open && !state.busy) $('tgDialog').close(); }

function startAdopt(speciesId, selection) {
  const server = serverSpecies(speciesId);
  if (!server) return;
  const flow = currentState(server);
  if (flow === 'login') {
    saveIntent({ speciesId, ...selection });
    openDialog([...heading('로그인이 필요해요', '분양은 인증 스트리머만 할 수 있어요. 로그인한 뒤 이어서 진행할게요.'),
      actionButton('로그인하기', () => { $('tgDialog').close(); window.openShopLoginModal?.(); })]);
    return;
  }
  if (flow === 'verify') {
    saveIntent({ speciesId, ...selection });
    openDialog([...heading('스트리머 인증 후 맞이할 수 있어요', '새 가족은 인증 스트리머의 팬페이지에서 팬들과 함께 지내요. 스트리머 인증을 마치면 이어서 진행할게요.'),
      actionButton('스트리머 인증하기', () => { $('tgDialog').close(); window.openShopLoginModal?.({ streamer: true }); })]);
    return;
  }
  if (flow === 'admin') {
    openDialog([...heading('관리자 계정이에요', '관리자는 아래 "관리자 도구"의 테스트 분양을 사용해 주세요. 결제 분양은 해당 팬페이지의 인증 스트리머 계정으로만 할 수 있어요.')]);
    return;
  }
  if (flow === 'charge') {
    const need = server.adoptCash - (Number(state.server.balanceCash) || 0);
    const link = el('a', 'tg-button tg-button-primary', '통합 캐시 충전하러 가기'); link.href = 'customer-center.html#charge';
    openDialog([...heading('통합 캐시가 부족해요', `보유 ${cashText(state.server.balanceCash)} · 필요 ${cashText(server.adoptCash)} (${cashText(need)} 부족)`), link]);
    return;
  }
  openConfirm(server, selection);
}

function heading(title, text) {
  return [el('p', 'eyebrow section-eyebrow', 'ADOPT'), el('h2', 'tg-dialog-title', title), el('p', 'tg-dialog-text', text)];
}
function actionButton(label, onClick) {
  const button = el('button', 'tg-button tg-button-primary', label); button.type = 'button';
  button.addEventListener('click', onClick); return button;
}

function openConfirm(server, selection) {
  const pub = publicSpecies(server.id);
  const streamer = state.server.viewer.streamer;
  let colorId = pub.colors.some((c) => c.id === selection.color) ? selection.color : pub.colors[0].id;
  const picked = () => pub.colors.find((c) => c.id === colorId);

  const preview = el('div', 'tg-confirm-art');
  const img = document.createElement('img'); img.width = 200; img.height = 176; preview.append(img);
  const colorRow = el('div', 'tg-color-row'); colorRow.setAttribute('role', 'radiogroup'); colorRow.setAttribute('aria-label', '색 선택');
  const colorButtons = pub.colors.map((c) => {
    const b = el('button', 'tg-color-choice'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.color = c.id;
    const dot = el('span', 'tg-swatch tg-swatch-lg'); dot.style.background = c.swatch;
    b.append(dot, el('span', '', c.label));
    b.addEventListener('click', () => { colorId = c.id; sync(); });
    colorRow.append(b); return b;
  });
  const nameLabel = el('label', 'tg-field-label', '이름 (1~12자, 비우면 몽실이)'); nameLabel.htmlFor = 'tgName';
  const nameInput = el('input', 'tg-input'); nameInput.id = 'tgName'; nameInput.type = 'text'; nameInput.maxLength = 30; nameInput.autocomplete = 'off';
  nameInput.value = selection.name || '';
  const nameError = el('p', 'tg-field-error'); nameError.setAttribute('role', 'alert');
  const summary = el('p', 'tg-summary');
  summary.append('분양비 ', el('strong', '', cashText(server.adoptCash)), ` · ${streamer.nickname || streamer.id} 팬페이지에서 함께 지내요`);
  const notice = el('p', 'tg-notice', '분양은 한 번 맞이하면 되돌릴 수 없어서 분양비는 환불되지 않아요. 결제 오류나 이중 차감은 자동으로 환불돼요. 훈련소에서 새로운 상호작용을 더 배울 수 있어요(유료).');
  const agreeLabel = el('label', 'tg-agree'); const agree = el('input'); agree.type = 'checkbox';
  agreeLabel.append(agree, el('span', '', '분양비는 환불되지 않는다는 안내를 확인했어요'));
  const status = el('p', 'tg-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const pay = el('button', 'tg-button tg-button-primary', `${pub.name} 맞이하기 · ${cashText(server.adoptCash)}`); pay.type = 'button'; pay.disabled = true;

  function sync() {
    img.src = picked().image; img.alt = `${pub.name} ${picked().label}`;
    colorButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === colorId)));
    const name = normalizeNickname(nameInput.value, pub.name);
    nameError.textContent = name.ok ? '' : name.error;
    pay.disabled = state.busy || !agree.checked || !name.ok;
  }
  nameInput.addEventListener('input', sync); agree.addEventListener('change', sync);

  pay.addEventListener('click', async () => {
    if (state.busy) return;
    const name = normalizeNickname(nameInput.value, pub.name);
    if (!name.ok || !agree.checked) return sync();
    state.busy = true; pay.disabled = true; status.className = 'tg-status loading-bar'; status.textContent = '새 가족을 맞이하는 중이에요…';
    $('tgDialogClose').disabled = true; colorButtons.forEach((b) => { b.disabled = true; }); nameInput.disabled = true; agree.disabled = true;
    const requestId = getOrCreateRequestId(sessionStorage, REQUEST_KEY, randomBytes);
    try {
      const result = (await shopCall({
        action: 'adopt', streamerId: streamer.id, speciesId: server.id, color: colorId, nickname: nameInput.value, requestId,
      })).data || {};
      if (result.status !== 'adopted') throw new Error('분양 결과를 확인하지 못했어요.');
      clearRequestId(sessionStorage, REQUEST_KEY); clearIntent();
      state.server.balanceCash = Number(result.remainingCash) || 0;
      state.busy = false; $('tgDialogClose').disabled = false;
      renderBalance();
      showSuccess(pub, picked(), name.value, streamer, state.server.balanceCash);
    } catch (error) {
      if (shouldDiscardRequestId(error)) clearRequestId(sessionStorage, REQUEST_KEY);
      state.busy = false; $('tgDialogClose').disabled = false;
      colorButtons.forEach((b) => { b.disabled = false; }); nameInput.disabled = false; agree.disabled = false;
      status.className = 'tg-status is-error'; status.textContent = adoptErrorMessage(error);
      sync();
      void reload({ silent: true });
    }
  });

  openDialog([
    ...heading(`${pub.name} 맞이하기`, '색을 고르고 이름을 지어 주세요. 팬들과 함께 오래 부를 이름이에요.'),
    preview, colorRow, nameLabel, nameInput, nameError, summary, notice, agreeLabel, status, pay,
  ]);
  sync();
}

function showSuccess(pub, color, name, streamer, remaining) {
  const art = el('div', 'tg-confirm-art'); const img = document.createElement('img');
  img.src = color.image; img.alt = `${pub.name} ${color.label}`; img.width = 200; img.height = 176; art.append(img);
  const go = el('a', 'tg-button tg-button-primary', '내 팬페이지로 가기'); go.href = farmUrl(streamer.id);
  const back = el('button', 'tg-button', '분양소로 돌아가기'); back.type = 'button'; back.addEventListener('click', () => $('tgDialog').close());
  openDialog([
    el('p', 'eyebrow section-eyebrow', 'DONE'), el('h2', 'tg-dialog-title', '새 가족이 생겼어요!'),
    art, el('p', 'tg-dialog-text', `이름 ${name} · 색 ${COLOR_LABELS[color.id] || color.label}. 이제 팬페이지에서 만날 수 있어요. 남은 통합 캐시 ${cashText(remaining)}`),
    el('div', 'tg-dialog-actions', ''),
  ]);
  $('tgDialogBody').lastElementChild.append(go, back);
}

// ---------- 관리자 도구 ----------
function setupAdmin() {
  const admin = state.server?.viewer?.isAdmin === true && state.server.species.length > 0;
  $('tgAdmin').hidden = !admin;
  if (!admin) return;
  const select = $('tgAdminColor');
  if (!select.options.length) {
    for (const [id, label] of Object.entries(COLOR_LABELS)) { const o = document.createElement('option'); o.value = id; o.textContent = label; select.append(o); }
  }
}
function adminStatus(text, isError = false) { const s = $('tgAdminStatus'); s.textContent = text; s.classList.toggle('is-error', isError); }
$('tgAdminForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const streamerId = $('tgAdminStreamer').value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(streamerId)) return adminStatus('팬페이지 ID를 확인해 주세요.', true);
  const species = state.server?.species?.[0];
  if (!species) return adminStatus('분양 종류를 찾을 수 없어요.', true);
  adminStatus('지급하고 있어요…');
  try {
    const requestId = `tg_${Array.from(randomBytes(18), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    const result = (await shopCall({ action: 'admin-grant', streamerId, speciesId: species.id, color: $('tgAdminColor').value, nickname: $('tgAdminName').value, requestId })).data;
    adminStatus(`테스트 다마고치를 지급했어요. (${result.petId})`);
  } catch (error) { adminStatus(error?.message || '지급하지 못했어요.', true); }
});
$('tgAdminClear').addEventListener('click', async () => {
  const streamerId = $('tgAdminStreamer').value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(streamerId)) return adminStatus('팬페이지 ID를 확인해 주세요.', true);
  adminStatus('정리하고 있어요…');
  try {
    const result = (await shopCall({ action: 'admin-clear-tests', streamerId })).data;
    adminStatus(`테스트 다마고치 ${result.removed}마리를 정리했어요. 분양받은 다마고치는 그대로예요.`);
  } catch (error) { adminStatus(error?.message || '정리하지 못했어요.', true); }
});

// ---------- 불러오기·로그인 이어하기 ----------
async function reload({ silent = false } = {}) {
  if (!state.user) return;
  if (!silent) { state.loading = true; state.error = ''; renderList(); }
  try {
    state.server = (await shopCall({ action: 'catalog' })).data || null;
    state.error = '';
  } catch (error) {
    if (!silent) state.error = error?.code === 'functions/unavailable' ? '서비스 점검 중이에요. 잠시 후 다시 열어 주세요.' : '분양소를 불러오지 못했어요.';
  }
  state.loading = false;
  renderBalance(); renderList(); setupAdmin();
  if (!silent) resumeIntent();
}

function resumeIntent() {
  const intent = loadIntent();
  if (!intent || state.busy || $('shopLoginModal').open) return;
  const server = serverSpecies(intent.speciesId);
  if (!server) return;
  const flow = currentState(server);
  // 아직 로그인·인증 전이면 그대로 두고, 진행 가능해진 때만 이어서 연다.
  if (flow === 'login' || flow === 'verify') return;
  clearIntent();
  startAdopt(intent.speciesId, { color: intent.color, name: intent.name });
}

async function loadPublicCatalog() {
  try {
    const response = await fetch('catalog/tamagotchi.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('catalog');
    state.publicSpecies = (await response.json()).species || [];
  } catch (_) { state.publicSpecies = []; state.error = '분양소를 불러오지 못했어요.'; }
}

$('tgDialogClose').addEventListener('click', closeDialog);
$('tgDialog').addEventListener('click', (event) => { if (event.target === $('tgDialog')) closeDialog(); });
$('tgDialog').addEventListener('cancel', (event) => { if (state.busy) event.preventDefault(); });

let firstAuth = true;
onAuthStateChanged(auth, (user) => {
  state.user = user;
  if (!user) return; // shop-login.js가 익명 세션을 시작한다
  if (firstAuth) { firstAuth = false; void loadPublicCatalog().then(() => reload()); return; }
  void reload();
});
window.addEventListener('shop-auth-changed', () => { void reload(); });
renderList();

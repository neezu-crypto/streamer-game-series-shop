import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getDatabase, onValue, ref } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:cdddfe20075aa199a3a769'
};
const APP_NAME = 'gameSeriesEmotes';
const DISPLAY_MS = 5000;
const moduleUrl = new URL(import.meta.url);
const gameId = moduleUrl.searchParams.get('game') || '';
const allowedGames = new Set([
  'streamerLifeGame', 'soopStockMarket', 'streamBetMarket',
  'interior3dViewer', 'dontClickAds', 'midnightMartRun',
  'streamerJurumable', 'onyuVn', 'dontPressButton'
]);

if (!allowedGames.has(gameId)) {
  console.error('[게임시리즈 감정표현] 알 수 없는 게임 ID입니다.', gameId);
} else {
  install();
}

function install() {
  const app = getApps().find((item) => item.name === APP_NAME)
    || initializeApp(FIREBASE_CONFIG, APP_NAME);
  const auth = getAuth(app);
  const db = getDatabase(app);
  const functions = getFunctions(app, 'us-central1');
  const getOwnedEmotes = httpsCallable(functions, 'gameSeriesShopGetOwnedEmotes');
  const sendEmote = httpsCallable(functions, 'gameSeriesShopSendEmote');
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./game-series-emotes.css', import.meta.url).href;
  document.head.append(stylesheet);

  const launcher = document.createElement('div');
  launcher.id = 'game-series-emote-launcher';
  launcher.innerHTML = '<button id="game-series-emote-button" type="button" aria-haspopup="dialog" aria-expanded="false">감정표현</button><span id="game-series-emote-tooltip" role="tooltip">단축키 E · ㄷ</span>';
  const picker = document.createElement('div');
  picker.id = 'game-series-emote-picker';
  picker.hidden = true;
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-modal', 'true');
  picker.setAttribute('aria-labelledby', 'gs-emote-title');
  const dialog = document.createElement('section');
  dialog.className = 'gs-emote-dialog';
  const dialogHead = document.createElement('div');
  dialogHead.className = 'gs-emote-dialog-head';
  const title = document.createElement('h2');
  title.className = 'gs-emote-dialog-title';
  title.id = 'gs-emote-title';
  title.textContent = '감정표현';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gs-emote-close';
  closeButton.setAttribute('aria-label', '감정표현 닫기');
  closeButton.textContent = '×';
  dialogHead.append(title, closeButton);
  const hint = document.createElement('p');
  hint.className = 'gs-emote-dialog-hint';
  hint.textContent = '사용할 스티커를 끌어 원하는 곳에 놓아 주세요.';
  const grid = document.createElement('div');
  grid.className = 'gs-emote-grid';
  grid.setAttribute('aria-live', 'polite');
  dialog.append(dialogHead, hint, grid);
  picker.append(dialog);
  const stage = document.createElement('div');
  stage.id = 'game-series-emote-stage';
  stage.setAttribute('aria-hidden', 'true');
  document.body.append(launcher, picker, stage);

  const launchButton = launcher.querySelector('button');
  let owned = [];
  let catalog = null;
  let catalogPromise = null;
  let loadPromise = null;
  let unsubscribe = null;
  let subscriptionVersion = 0;
  let displayTimer = null;
  let activePop = null;
  let dragState = null;
  let currentRoom = initialRoomId();
  let lastEventId = '';

  function initialRoomId() {
    const query = moduleUrl.searchParams.get('roomParam');
    const params = new URLSearchParams(location.search);
    const candidate = window.__gameSeriesEmoteRoomId
      || (query && params.get(query))
      || params.get('room')
      || params.get('roomId')
      || params.get('roomCode')
      || params.get('code')
      || 'public';
    return String(candidate || 'public');
  }

  function setRoom(roomId) {
    const nextRoom = String(roomId || 'public');
    if (nextRoom === currentRoom) return;
    currentRoom = nextRoom;
    lastEventId = '';
    clearActivePop();
    if (catalog) subscribeToCurrentRoom();
    else loadCatalog().then(subscribeToCurrentRoom).catch((error) => {
      console.error('[게임시리즈 감정표현] 카탈로그를 불러오지 못했습니다:', error);
    });
  }

  function subscribeToCurrentRoom() {
    const version = ++subscriptionVersion;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    roomPathKey(currentRoom).then((roomKey) => {
      if (version !== subscriptionVersion) return;
      const path = `gameSeriesShop/emoteEvents/${gameId}/${roomKey}/current`;
      unsubscribe = onValue(ref(db, path), (snapshot) => {
        const event = snapshot.val();
        if (!event || !event.eventId || event.eventId === lastEventId) return;
        lastEventId = event.eventId;
        const ageMs = Date.now() - Number(event.createdAt || 0);
        if (ageMs < 0 || ageMs >= Number(event.durationMs || DISPLAY_MS)) return;
        const sticker = findSticker(event.stickerId);
        if (sticker) showPop(sticker, Number(event.x), Number(event.y), Number(event.durationMs || DISPLAY_MS) - ageMs);
      }, (error) => console.error('[게임시리즈 감정표현] 실시간 구독 실패:', error));
    }).catch((error) => console.error('[게임시리즈 감정표현] 방 식별자 처리 실패:', error));
  }

  async function roomPathKey(roomId) {
    const bytes = new TextEncoder().encode(String(roomId || 'public').trim());
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function findSticker(stickerId) {
    for (const product of catalog?.products || []) {
      const index = (product.preview?.stickers || []).findIndex((item) => item.id === stickerId);
      if (index >= 0) return makeOwnedSticker(product, product.preview.stickers[index], index);
    }
    return null;
  }

  function makeOwnedSticker(product, sticker, index) {
    const columns = Math.max(1, Number(product.preview?.columns) || 1);
    const rows = Math.max(1, Number(product.preview?.rows) || 1);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = columns === 1 ? 0 : (column / (columns - 1)) * 100;
    const y = rows === 1 ? 0 : (row / (rows - 1)) * 100;
    return {
      id: sticker.id,
      label: sticker.label,
      alt: sticker.alt,
      asset: new URL(product.preview.asset, import.meta.url).href,
      backgroundSize: `${columns * 100}% ${rows * 100}%`,
      backgroundPosition: `${x}% ${y}%`
    };
  }

  function styleArt(element, sticker) {
    element.style.backgroundImage = `url("${sticker.asset}")`;
    element.style.backgroundSize = sticker.backgroundSize;
    element.style.backgroundPosition = sticker.backgroundPosition;
  }

  function renderOwned() {
    grid.replaceChildren();
    if (!owned.length) {
      const empty = document.createElement('p');
      empty.className = 'gs-emote-empty';
      empty.textContent = '아직 사용할 수 있는 보유 스티커가 없어요. 상점에서 새 스티커 소식을 확인해 주세요.';
      const link = document.createElement('a');
      link.href = 'https://neezu-crypto.github.io/streamer-game-series-shop/';
      link.textContent = ' 상점 보기';
      empty.append(link);
      grid.append(empty);
      return;
    }

    for (const sticker of owned) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'gs-emote-tile';
      tile.setAttribute('aria-label', `${sticker.label} 스티커를 끌어 놓기`);
      const art = document.createElement('span');
      art.className = 'gs-emote-art';
      art.setAttribute('role', 'img');
      art.setAttribute('aria-label', sticker.alt || sticker.label);
      styleArt(art, sticker);
      const label = document.createElement('span');
      label.className = 'gs-emote-label';
      label.textContent = sticker.label;
      tile.append(art, label);
      tile.addEventListener('pointerdown', (event) => startDrag(event, sticker, tile));
      grid.append(tile);
    }
  }

  async function loadOwned() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      await loadCatalog();
      let user = auth.currentUser;
      if (!user) user = (await signInAnonymously(auth)).user;
      const result = await getOwnedEmotes();
      owned = Array.isArray(result.data?.stickers) ? result.data.stickers
        .map((item) => findSticker(item.id))
        .filter(Boolean) : [];
      renderOwned();
      subscribeToCurrentRoom();
    })().catch((error) => {
      loadPromise = null;
      grid.replaceChildren();
      const message = document.createElement('p');
      message.className = 'gs-emote-error';
      message.textContent = '스티커 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
      grid.append(message);
      console.error('[게임시리즈 감정표현] 보유 목록 조회 실패:', error);
      throw error;
    });
    return loadPromise;
  }

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(new URL('./catalog/stickers.json', import.meta.url), { cache: 'no-cache' })
        .then((response) => {
          if (!response.ok) throw new Error('스티커 목록을 불러오지 못했습니다.');
          return response.json();
        })
        .then((data) => { catalog = data; return catalog; })
        .catch((error) => { catalogPromise = null; throw error; });
    }
    return catalogPromise;
  }

  function openPicker() {
    if (picker.hidden) {
      picker.hidden = false;
      launchButton.setAttribute('aria-expanded', 'true');
      closeButton.focus();
      const loading = document.createElement('p');
      loading.className = 'gs-emote-loading';
      loading.textContent = '보유한 스티커를 확인하고 있어요…';
      grid.replaceChildren(loading);
      loadOwned().catch(() => {});
    } else {
      closePicker();
    }
  }

  function closePicker() {
    picker.hidden = true;
    launchButton.setAttribute('aria-expanded', 'false');
    launchButton.focus({ preventScroll: true });
  }

  function setGhostPosition(ghost, x, y) {
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
  }

  function startDrag(event, sticker, tile) {
    if (event.button !== 0) return;
    event.preventDefault();
    const ghost = document.createElement('span');
    ghost.className = 'gs-emote-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    styleArt(ghost, sticker);
    document.body.append(ghost);
    setGhostPosition(ghost, event.clientX, event.clientY);
    dragState = { pointerId: event.pointerId, sticker, ghost, moved: false, startX: event.clientX, startY: event.clientY };
    try { tile.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture may be unavailable in older browsers. */ }
    document.addEventListener('pointermove', onDragMove, true);
    document.addEventListener('pointerup', onDragEnd, true);
    document.addEventListener('pointercancel', onDragCancel, true);
  }

  function onDragMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 5) dragState.moved = true;
    setGhostPosition(dragState.ghost, event.clientX, event.clientY);
  }

  function finishDrag(event, cancel) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const current = dragState;
    dragState = null;
    current.ghost.remove();
    document.removeEventListener('pointermove', onDragMove, true);
    document.removeEventListener('pointerup', onDragEnd, true);
    document.removeEventListener('pointercancel', onDragCancel, true);
    if (cancel) return;
    if (!current.moved) return;
    closePicker();
    const x = Math.min(1, Math.max(0, event.clientX / Math.max(1, window.innerWidth)));
    const y = Math.min(1, Math.max(0, event.clientY / Math.max(1, window.innerHeight)));
    sendAt(current.sticker, x, y).catch(() => {});
  }

  function onDragEnd(event) { finishDrag(event, false); }
  function onDragCancel(event) { finishDrag(event, true); }

  async function sendAt(sticker, x, y) {
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      await sendEmote({ gameId, roomId: currentRoom, stickerId: sticker.id, x, y });
    } catch (error) {
      console.error('[게임시리즈 감정표현] 전송 실패:', error);
    }
  }

  function showPop(sticker, x, y, remainingMs) {
    clearActivePop();
    const pop = document.createElement('span');
    pop.className = 'gs-emote-pop';
    pop.setAttribute('role', 'img');
    pop.setAttribute('aria-label', sticker.alt || sticker.label);
    styleArt(pop, sticker);
    pop.style.left = `${Math.min(1, Math.max(0, x)) * 100}%`;
    pop.style.top = `${Math.min(1, Math.max(0, y)) * 100}%`;
    stage.append(pop);
    activePop = pop;
    displayTimer = window.setTimeout(() => {
      if (activePop === pop) clearActivePop();
    }, Math.max(0, remainingMs));
  }

  function clearActivePop() {
    window.clearTimeout(displayTimer);
    displayTimer = null;
    if (activePop) activePop.remove();
    activePop = null;
  }

  function isTextEntry(event) {
    const candidates = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return candidates.some((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"]), [data-lexical-editor="true"]')
        || node.isContentEditable;
    });
  }

  launchButton.addEventListener('click', openPicker);
  closeButton.addEventListener('click', closePicker);
  picker.addEventListener('click', (event) => {
    if (event.target === picker) closePicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !picker.hidden) {
      closePicker();
      return;
    }
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event)) return;
    const key = String(event.key || '').toLowerCase();
    if (event.code === 'KeyE' || key === 'e' || key === 'ㄷ') {
      event.preventDefault();
      event.stopPropagation();
      openPicker();
    }
  }, true);
  window.addEventListener('game-series-emote-room-change', (event) => setRoom(event.detail?.roomId));
  if (window.__gameSeriesEmoteRoomId) setRoom(window.__gameSeriesEmoteRoomId);
  loadCatalog().then(subscribeToCurrentRoom).catch((error) => {
    console.error('[게임시리즈 감정표현] 카탈로그를 불러오지 못했습니다:', error);
  });
  if (window.obsstudio || new URLSearchParams(location.search).get('view') === '1') launcher.hidden = true;

  window.gameSeriesEmotes = Object.freeze({
    open: openPicker,
    get currentUid() { return auth.currentUser?.uid || null; },
    appName: APP_NAME
  });
}

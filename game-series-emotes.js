const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:cdddfe20075aa199a3a769'
};
const DISPLAY_MS = 5000;
const OWNED_EMOTE_CACHE_TTL_MS = 30000;
const moduleUrl = new URL(import.meta.url);
const gameId = moduleUrl.searchParams.get('game') || '';
const requestedSdkVersion = moduleUrl.searchParams.get('sdk') || '12.16.0';
const sdkVersion = ['10.7.0', '12.16.0'].includes(requestedSdkVersion) ? requestedSdkVersion : '12.16.0';
const allowedGames = new Set([
  'streamerLifeGame', 'soopStockMarket', 'streamBetMarket',
  'interior3dViewer', 'streamerJurumable', 'onyuVn', 'dontPressButton', 'streamerFanPage'
]);

if (!allowedGames.has(gameId)) {
  console.error('[게임시리즈 감정표현] 알 수 없는 게임 ID입니다.', gameId);
} else {
  const sdkRoot = `https://www.gstatic.com/firebasejs/${sdkVersion}`;
  const [appSdk, authSdk, databaseSdk, functionsSdk] = await Promise.all([
    import(`${sdkRoot}/firebase-app.js`),
    import(`${sdkRoot}/firebase-auth.js`),
    import(`${sdkRoot}/firebase-database.js`),
    import(`${sdkRoot}/firebase-functions.js`)
  ]);
  await install({ appSdk, authSdk, databaseSdk, functionsSdk });
}

async function install({ appSdk, authSdk, databaseSdk, functionsSdk }) {
  const { getApps, initializeApp } = appSdk;
  const { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } = authSdk;
  const { getDatabase, onChildAdded, ref } = databaseSdk;
  const { getFunctions, httpsCallable } = functionsSdk;
  let app = getApps().find((item) => item.name === '[DEFAULT]');
  if (!app && moduleUrl.searchParams.get('standalone') === '1') app = initializeApp(FIREBASE_CONFIG);
  for (let attempt = 0; !app && attempt < 60; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    app = getApps().find((item) => item.name === '[DEFAULT]');
  }
  if (!app) {
    console.error('[게임시리즈 감정표현] 페이지 Firebase 앱이 준비되지 않았습니다.');
    return;
  }
  const auth = getAuth(app);
  const db = getDatabase(app);
  const functions = getFunctions(app, 'us-central1');
  const getOwnedEmotes = httpsCallable(functions, 'gameSeriesShopGetOwnedEmotes');
  const sendEmote = httpsCallable(functions, 'gameSeriesShopSendEmote');
  const mutateFanpageDecoration = httpsCallable(functions, 'gameSeriesFanPageDecoration');
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  const stylesheetUrl = new URL('./game-series-emotes.css', import.meta.url);
  stylesheetUrl.searchParams.set('v', moduleUrl.searchParams.get('v') || '20261020-free-dice-login');
  stylesheet.href = stylesheetUrl.href;
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
  const decorationStage = document.createElement('div');
  decorationStage.id = 'game-series-fanpage-decoration-stage';
  decorationStage.setAttribute('aria-label', '팬페이지 장식 스티커');
  decorationStage.hidden = true;
  const loginGate = document.createElement('div');
  loginGate.id = 'game-series-emote-login';
  loginGate.hidden = true;
  loginGate.setAttribute('role', 'dialog');
  loginGate.setAttribute('aria-modal', 'true');
  loginGate.setAttribute('aria-labelledby', 'gs-emote-login-title');
  loginGate.innerHTML = '<section class="gs-emote-login-card"><button class="gs-emote-close" type="button" aria-label="로그인 안내 닫기">×</button><h2 id="gs-emote-login-title">다이스 스티커 무료 이용</h2><p>로그인 유저와 인증 스트리머는 주사위 스티커를 무료로 사용할 수 있어요. 로그인해 주세요.</p><div class="gs-emote-login-actions"></div></section>';
  document.body.append(launcher, picker, loginGate, stage, decorationStage);

  const launchButton = launcher.querySelector('button');
  const loginActions = loginGate.querySelector('.gs-emote-login-actions');
  const loginCloseButton = loginGate.querySelector('.gs-emote-close');
  let owned = [];
  let ownedCacheUid = '';
  let ownedLoadedAt = 0;
  let catalog = null;
  let catalogPromise = null;
  let loadPromise = null;
  let loadPromiseUid = '';
  let unsubscribe = null;
  let subscriptionVersion = 0;
  const activePops = new Map();
  const pendingClientEvents = new Map();
  const pendingFanpageAdds = new Map();
  let dragState = null;
  let currentRoom = initialRoomId();
  let currentUser = auth.currentUser || null;
  let authInitialized = false;
  let authReadyResolve;
  let pendingLogin = false;
  let fanpageContext = readFanpageContext();
  const fanpageDecorations = new Map();
  let decorationDragState = null;
  const authReady = new Promise((resolve) => { authReadyResolve = resolve; });

  onAuthStateChanged(auth, (user) => {
    const wasInitialized = authInitialized;
    const previousUid = currentUser?.uid || '';
    currentUser = user || null;
    if (wasInitialized && previousUid !== (currentUser?.uid || '')) {
      owned = [];
      ownedCacheUid = '';
      ownedLoadedAt = 0;
      loadPromise = null;
      loadPromiseUid = '';
    }
    if (!authInitialized) {
      authInitialized = true;
      authReadyResolve(user || null);
    }
    if (pendingLogin && user && !user.isAnonymous) {
      pendingLogin = false;
      closeLoginGate();
      openPicker();
      return;
    }
    if (wasInitialized && !picker.hidden) {
      if (!user) {
        closePicker();
        showLoginGate();
        return;
      }
      loadOwned().catch(() => {});
    }
  }, (error) => {
    console.error('[게임시리즈 감정표현] 로그인 상태 확인 실패:', error);
    if (!authInitialized) {
      authInitialized = true;
      authReadyResolve(null);
    }
  });

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

  function readFanpageContext(value = window.__streamerFanPageEmotes) {
    if (gameId !== 'streamerFanPage' || !value || typeof value !== 'object') {
      return { streamerId: '', isStreamerOwner: false, decorations: [] };
    }
    return {
      streamerId: String(value.streamerId || '').trim().toLowerCase(),
      isStreamerOwner: value.isStreamerOwner === true,
      decorations: Array.isArray(value.decorations) ? value.decorations : []
    };
  }

  function setFanpageContext(value) {
    if (gameId !== 'streamerFanPage') return;
    const next = readFanpageContext(value);
    fanpageContext = next;
    fanpageDecorations.clear();
    clearDecorationDrag();
    for (const pending of pendingFanpageAdds.values()) {
      if (pending.cleanupTimer) window.clearTimeout(pending.cleanupTimer);
    }
    pendingFanpageAdds.clear();
    for (const item of next.decorations) {
      if (item && typeof item.id === 'string' && typeof item.stickerId === 'string') {
        fanpageDecorations.set(item.id, {
          id: item.id,
          stickerId: item.stickerId,
          x: clampUnit(item.x),
          y: clampUnit(item.y),
          updatedAt: Number(item.updatedAt) || 0
        });
      }
    }
    launcher.hidden = !next.streamerId || !!window.obsstudio || new URLSearchParams(location.search).get('view') === '1';
    decorationStage.hidden = !next.streamerId;
    updatePickerHint();
    renderFanpageDecorations();
    window.requestAnimationFrame(updateFanpageDecorationPositions);
    setRoom(next.streamerId || 'public');
  }

  function updatePickerHint() {
    hint.textContent = gameId === 'streamerFanPage' && fanpageContext.isStreamerOwner
      ? '스티커를 끌어 놓으면 내 팬페이지에 계속 붙어 있어요. 다시 끌어 이동할 수 있어요.'
      : '사용할 스티커를 끌어 원하는 곳에 놓아 주세요.';
  }

  function clampUnit(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
  }

  function setRoom(roomId) {
    const nextRoom = String(roomId || 'public');
    if (nextRoom === currentRoom) return;
    currentRoom = nextRoom;
    clearActivePops();
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
      const path = `gameSeriesShop/emoteEvents/${gameId}/${roomKey}/events`;
      unsubscribe = onChildAdded(ref(db, path), (snapshot) => {
        const event = snapshot.val();
        if (!event || !event.eventId) return;
        const ageMs = Date.now() - Number(event.createdAt || 0);
        if (ageMs < 0 || ageMs >= Number(event.durationMs || DISPLAY_MS)) return;
        if (event.type === 'fanpage-decoration') {
          if (gameId === 'streamerFanPage') {
            const pending = pendingFanpageAdds.get(String(event.clientMutationId || ''));
            if (pending) {
              pending.serverObserved = true;
              settlePendingFanpageAdd(String(event.clientMutationId), pending);
            }
            applyFanpageDecorationEvent(event);
          }
          return;
        }
        if (activePops.has(event.eventId)) return;
        const sticker = findSticker(event.stickerId);
        if (sticker) {
          const pending = pendingClientEvents.get(String(event.clientEventId || ''));
          if (pending) {
            pending.serverObserved = true;
            settlePendingClientEvent(String(event.clientEventId), pending, event.eventId, sticker, event, Number(event.durationMs || DISPLAY_MS) - ageMs);
          } else {
            showPop(event.eventId, sticker, Number(event.x), Number(event.y), Number(event.durationMs || DISPLAY_MS) - ageMs);
          }
        }
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
      empty.textContent = '현재 사용할 수 있는 스티커가 없어요.';
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
    const user = auth.currentUser || currentUser || (!authInitialized ? await authReady : null);
    if (!user) throw new Error('로그인이 필요합니다.');
    if (ownedCacheUid === user.uid && Date.now() - ownedLoadedAt < OWNED_EMOTE_CACHE_TTL_MS) {
      renderOwned();
      subscribeToCurrentRoom();
      return;
    }
    if (loadPromise && loadPromiseUid === user.uid) return loadPromise;
    const requestUid = user.uid;
    loadPromiseUid = requestUid;
    loadPromise = (async () => {
      await loadCatalog();
      const result = await getOwnedEmotes();
      if ((auth.currentUser?.uid || currentUser?.uid || '') !== requestUid) return;
      if (!result.data?.eligible && user.isAnonymous) {
        closePicker();
        showLoginGate();
        if (loadPromiseUid === requestUid) {
          loadPromise = null;
          loadPromiseUid = '';
        }
        return;
      }
      owned = Array.isArray(result.data?.stickers) ? result.data.stickers
        .map((item) => findSticker(item.id))
        .filter(Boolean) : [];
      ownedCacheUid = requestUid;
      ownedLoadedAt = Date.now();
      renderOwned();
      subscribeToCurrentRoom();
    })().catch((error) => {
      if (loadPromiseUid === requestUid) {
        loadPromise = null;
        loadPromiseUid = '';
        ownedCacheUid = '';
        ownedLoadedAt = 0;
      }
      if ((auth.currentUser?.uid || currentUser?.uid || '') !== requestUid) return;
      grid.replaceChildren();
      const message = document.createElement('p');
      message.className = 'gs-emote-error';
      message.textContent = error?.code === 'functions/unauthenticated'
        ? '로그인 후 무료로 사용할 수 있어요.'
        : '스티커 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
      grid.append(message);
      console.error('[게임시리즈 감정표현] 보유 목록 조회 실패:', error);
      throw error;
    }).finally(() => {
      if (loadPromiseUid === requestUid && ownedCacheUid === requestUid) {
        loadPromise = null;
        loadPromiseUid = '';
      }
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
    if (!picker.hidden) {
      closePicker();
      return;
    }
    openPickerForCurrentUser().catch((error) => {
      console.error('[게임시리즈 감정표현] 스티커 창을 열지 못했습니다:', error);
      showLoginGate();
    });
  }

  function showPicker() {
    picker.hidden = false;
    loginGate.hidden = true;
    launchButton.setAttribute('aria-expanded', 'true');
    closeButton.focus();
    const loading = document.createElement('p');
    loading.className = 'gs-emote-loading';
    loading.textContent = '무료 사용 자격을 확인하고 있어요…';
    grid.replaceChildren(loading);
  }

  async function openPickerForCurrentUser() {
    const user = auth.currentUser || currentUser || (!authInitialized ? await authReady : null);
    showPicker();
    if (!user) {
      closePicker();
      showLoginGate();
      return;
    }
    try {
      await loadOwned();
    } catch (error) {
      if (error?.code === 'functions/unauthenticated') {
        closePicker();
        showLoginGate();
        return;
      }
      const message = document.createElement('p');
      message.className = 'gs-emote-error';
      message.textContent = '스티커 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
      grid.replaceChildren(message);
      console.error('[게임시리즈 감정표현] 무료 스티커 조회 실패:', error);
    }
  }

  function closePicker() {
    picker.hidden = true;
    launchButton.setAttribute('aria-expanded', 'false');
    launchButton.focus({ preventScroll: true });
  }

  function showLoginGate() {
    picker.hidden = true;
    loginGate.hidden = false;
    loginActions.replaceChildren();
    const existingLoginModal = window.streamerFanPageOpenLoginModal || window.sbmOpenLoginModal || window.onyuOpenLoginModal;
    const googleButton = document.createElement('button');
    googleButton.type = 'button';
    googleButton.className = 'gs-emote-login-button';
    googleButton.textContent = existingLoginModal ? '로그인 방법 선택' : 'Google 로그인';
    googleButton.addEventListener('click', () => {
      pendingLogin = true;
      closeLoginGate();
      if (window.streamerFanPageOpenLoginModal) return window.streamerFanPageOpenLoginModal();
      if (window.sbmOpenLoginModal) return window.sbmOpenLoginModal();
      if (window.onyuOpenLoginModal) return window.onyuOpenLoginModal();
      if (window.__firebaseAuth?.signIn) return window.__firebaseAuth.signIn();
      if (typeof window.loginWithGoogle === 'function') return window.loginWithGoogle();
      if (typeof window.sbmSignIn === 'function') return window.sbmSignIn();
      if (document.getElementById('authBtn')) {
        document.getElementById('authBtn').click();
        return;
      }
      return signInWithPopup(auth, new GoogleAuthProvider()).catch((error) => {
        pendingLogin = false;
        console.error('[게임시리즈 감정표현] Google 로그인 실패:', error);
        showLoginGate();
      });
    });
    loginActions.append(googleButton);
    if (typeof window.loginWithKakao === 'function') {
      const kakaoButton = document.createElement('button');
      kakaoButton.type = 'button';
      kakaoButton.className = 'gs-emote-login-button gs-emote-login-secondary';
      kakaoButton.textContent = '카카오 로그인';
      kakaoButton.addEventListener('click', () => {
        pendingLogin = true;
        closeLoginGate();
        window.loginWithKakao();
      });
      loginActions.append(kakaoButton);
    }
    loginCloseButton.focus();
  }

  function closeLoginGate() {
    loginGate.hidden = true;
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
    if (gameId === 'streamerFanPage' && fanpageContext.isStreamerOwner && fanpageContext.streamerId) {
      const position = fanpagePosition(event.clientX, event.clientY);
      addFanpageDecorationOptimistically(current.sticker, position);
      return;
    }
    const x = Math.min(1, Math.max(0, event.clientX / Math.max(1, window.innerWidth)));
    const y = Math.min(1, Math.max(0, event.clientY / Math.max(1, window.innerHeight)));
    sendAt(current.sticker, x, y).catch(() => {});
  }

  function onDragEnd(event) { finishDrag(event, false); }
  function onDragCancel(event) { finishDrag(event, true); }

  async function sendAt(sticker, x, y) {
    const clientEventId = createClientEventId();
    const pending = { localEventId: `pending-${clientEventId}`, serverObserved: false, cleanupTimer: 0 };
    pendingClientEvents.set(clientEventId, pending);
    pending.cleanupTimer = window.setTimeout(() => {
      if (pendingClientEvents.get(clientEventId) === pending) pendingClientEvents.delete(clientEventId);
    }, DISPLAY_MS + 10000);
    showPop(pending.localEventId, sticker, x, y, DISPLAY_MS);
    try {
      if (!auth.currentUser) throw new Error('로그인이 필요합니다.');
      const result = await sendEmote({ gameId, roomId: currentRoom, stickerId: sticker.id, x, y, clientEventId });
      pending.serverEventId = result.data?.eventId || '';
    } catch (error) {
      if (!pending.serverObserved) {
        clearPendingClientEvent(clientEventId, pending);
        removeActivePop(pending.localEventId);
      }
      console.error('[게임시리즈 감정표현] 전송 실패:', error);
      if (error?.code === 'functions/permission-denied' || error?.code === 'functions/unauthenticated') showLoginGate();
    }
  }

  function createClientEventId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function clearPendingClientEvent(clientEventId, pending) {
    if (pending.cleanupTimer) window.clearTimeout(pending.cleanupTimer);
    if (pendingClientEvents.get(clientEventId) === pending) pendingClientEvents.delete(clientEventId);
  }

  function settlePendingClientEvent(clientEventId, pending, eventId, sticker, event, remainingMs) {
    clearPendingClientEvent(clientEventId, pending);
    const local = activePops.get(pending.localEventId);
    if (!local) {
      showPop(eventId, sticker, Number(event.x), Number(event.y), remainingMs);
      return;
    }
    window.clearTimeout(local.timer);
    activePops.delete(pending.localEventId);
    local.pop.style.left = `${Math.min(1, Math.max(0, Number(event.x))) * 100}%`;
    local.pop.style.top = `${Math.min(1, Math.max(0, Number(event.y))) * 100}%`;
    local.timer = window.setTimeout(() => {
      local.pop.remove();
      activePops.delete(eventId);
    }, Math.max(0, remainingMs));
    activePops.set(eventId, local);
  }

  function removeActivePop(eventId) {
    const active = activePops.get(eventId);
    if (!active) return;
    window.clearTimeout(active.timer);
    active.pop.remove();
    activePops.delete(eventId);
  }

  function showPop(eventId, sticker, x, y, remainingMs) {
    if (activePops.has(eventId)) return;
    const pop = document.createElement('span');
    pop.className = 'gs-emote-pop';
    pop.setAttribute('role', 'img');
    pop.setAttribute('aria-label', sticker.alt || sticker.label);
    styleArt(pop, sticker);
    pop.style.left = `${Math.min(1, Math.max(0, x)) * 100}%`;
    pop.style.top = `${Math.min(1, Math.max(0, y)) * 100}%`;
    stage.append(pop);
    const timer = window.setTimeout(() => {
      pop.remove();
      activePops.delete(eventId);
    }, Math.max(0, remainingMs));
    activePops.set(eventId, { pop, timer });
  }

  function clearActivePops() {
    for (const { pop, timer } of activePops.values()) {
      window.clearTimeout(timer);
      pop.remove();
    }
    activePops.clear();
    for (const [clientEventId, pending] of pendingClientEvents) clearPendingClientEvent(clientEventId, pending);
  }

  function pageDimensions() {
    return {
      width: Math.max(1, document.documentElement.clientWidth || window.innerWidth),
      height: Math.max(1, document.documentElement.scrollHeight, document.body.scrollHeight)
    };
  }

  function fanpagePosition(clientX, clientY) {
    const dimensions = pageDimensions();
    return {
      x: clampUnit(clientX / dimensions.width),
      y: clampUnit((clientY + window.scrollY) / dimensions.height)
    };
  }

  function setDecorationPosition(element, decoration) {
    const dimensions = pageDimensions();
    element.style.left = `${clampUnit(decoration.x) * dimensions.width}px`;
    element.style.top = `${clampUnit(decoration.y) * dimensions.height}px`;
  }

  function renderFanpageDecorations() {
    if (gameId !== 'streamerFanPage') return;
    decorationStage.replaceChildren();
    if (decorationStage.hidden) return;
    for (const decoration of fanpageDecorations.values()) {
      const sticker = findSticker(decoration.stickerId);
      if (!sticker) continue;
      const item = document.createElement('div');
      item.className = 'gs-fanpage-decoration';
      item.dataset.decorationId = decoration.id;
      item.setAttribute('role', 'img');
      item.setAttribute('aria-label', sticker.alt || sticker.label);
      item.title = sticker.label;
      item.dataset.owner = fanpageContext.isStreamerOwner ? 'true' : 'false';
      const art = document.createElement('span');
      art.className = 'gs-fanpage-decoration-art';
      styleArt(art, sticker);
      item.append(art);
      if (fanpageContext.isStreamerOwner) {
        item.setAttribute('role', 'group');
        item.setAttribute('aria-label', `${sticker.label} 스티커, 끌어 이동하거나 삭제할 수 있어요`);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'gs-fanpage-decoration-remove';
        remove.setAttribute('aria-label', `${sticker.label} 스티커 삭제`);
        remove.title = '스티커 삭제';
        remove.textContent = '×';
        remove.addEventListener('pointerdown', (event) => event.stopPropagation());
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          mutateDecoration('delete', { decorationId: decoration.id }).catch(showDecorationError);
        });
        item.append(remove);
        item.addEventListener('pointerdown', (event) => startDecorationDrag(event, decoration, item));
      }
      setDecorationPosition(item, decoration);
      decorationStage.append(item);
    }
  }

  function updateFanpageDecorationPositions() {
    if (gameId !== 'streamerFanPage' || decorationStage.hidden) return;
    for (const item of decorationStage.children) {
      const decoration = fanpageDecorations.get(item.dataset.decorationId);
      if (decoration) setDecorationPosition(item, decoration);
    }
  }

  function applyFanpageDecorationEvent(event) {
    if (!fanpageContext.streamerId) return;
    if (event.action === 'delete' && typeof event.decorationId === 'string') {
      fanpageDecorations.delete(event.decorationId);
    } else if (event.action === 'upsert' && event.decoration && typeof event.decoration.id === 'string') {
      const item = event.decoration;
      fanpageDecorations.set(item.id, {
        id: item.id,
        stickerId: String(item.stickerId || ''),
        x: clampUnit(item.x),
        y: clampUnit(item.y),
        updatedAt: Number(item.updatedAt) || 0
      });
    } else return;
    const decorations = [...fanpageDecorations.values()];
    if (window.__streamerFanPageEmotes?.streamerId === fanpageContext.streamerId) {
      window.__streamerFanPageEmotes.decorations = decorations;
    }
    window.dispatchEvent(new CustomEvent('streamer-fanpage-emotes-updated', {
      detail: { streamerId: fanpageContext.streamerId, decorations }
    }));
    renderFanpageDecorations();
  }

  async function mutateDecoration(action, values) {
    if (!fanpageContext.isStreamerOwner || !fanpageContext.streamerId) {
      throw new Error('본인 인증 팬페이지에서만 스티커를 붙일 수 있어요.');
    }
    const result = await mutateFanpageDecoration({
      action,
      streamerId: fanpageContext.streamerId,
      ...values
    });
    const data = result.data || {};
    if (action === 'delete') {
      applyFanpageDecorationEvent({ action: 'delete', decorationId: values.decorationId });
    } else if (data.decoration) {
      applyFanpageDecorationEvent({ action: 'upsert', decoration: data.decoration });
    }
    return data;
  }

  function settlePendingFanpageAdd(clientMutationId, pending, decoration = null) {
    if (pending.cleanupTimer) window.clearTimeout(pending.cleanupTimer);
    if (pendingFanpageAdds.get(clientMutationId) === pending) pendingFanpageAdds.delete(clientMutationId);
    fanpageDecorations.delete(pending.localDecorationId);
    if (decoration) applyFanpageDecorationEvent({ action: 'upsert', decoration });
    else renderFanpageDecorations();
  }

  function addFanpageDecorationOptimistically(sticker, position) {
    const streamerId = fanpageContext.streamerId;
    const clientMutationId = createClientEventId();
    const optimistic = {
      id: `pending-${clientMutationId}`,
      stickerId: sticker.id,
      x: clampUnit(position.x),
      y: clampUnit(position.y),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const pending = { localDecorationId: optimistic.id, serverObserved: false, cleanupTimer: 0 };
    pendingFanpageAdds.set(clientMutationId, pending);
    pending.cleanupTimer = window.setTimeout(() => {
      if (pendingFanpageAdds.get(clientMutationId) !== pending) return;
      pendingFanpageAdds.delete(clientMutationId);
      fanpageDecorations.delete(pending.localDecorationId);
      renderFanpageDecorations();
      showDecorationError(new Error('스티커 저장이 늦어지고 있어요. 페이지를 새로고침해 상태를 확인해 주세요.'));
    }, 15000);
    fanpageDecorations.set(optimistic.id, optimistic);
    renderFanpageDecorations();
    mutateDecoration('add', { stickerId: sticker.id, ...position, clientMutationId })
      .then((data) => {
        if (fanpageContext.streamerId !== streamerId || !fanpageContext.isStreamerOwner) return;
        settlePendingFanpageAdd(clientMutationId, pending, data.decoration || null);
      })
      .catch((error) => {
        if (fanpageContext.streamerId !== streamerId || !fanpageContext.isStreamerOwner) return;
        if (pending.serverObserved) return;
        settlePendingFanpageAdd(clientMutationId, pending);
        showDecorationError(error);
      });
  }

  function startDecorationDrag(event, decoration, element) {
    if (!fanpageContext.isStreamerOwner || event.button !== 0 || event.target.closest('.gs-fanpage-decoration-remove')) return;
    event.preventDefault();
    event.stopPropagation();
    decorationDragState = {
      pointerId: event.pointerId,
      id: decoration.id,
      element,
      original: { ...decoration },
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    try { element.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture can be unavailable in older browsers. */ }
    document.addEventListener('pointermove', onDecorationDragMove, true);
    document.addEventListener('pointerup', onDecorationDragEnd, true);
    document.addEventListener('pointercancel', onDecorationDragCancel, true);
  }

  function onDecorationDragMove(event) {
    if (!decorationDragState || event.pointerId !== decorationDragState.pointerId) return;
    if (Math.hypot(event.clientX - decorationDragState.startX, event.clientY - decorationDragState.startY) > 4) {
      decorationDragState.moved = true;
    }
    if (!decorationDragState.moved) return;
    const position = fanpagePosition(event.clientX, event.clientY);
    const updated = { ...fanpageDecorations.get(decorationDragState.id), ...position };
    fanpageDecorations.set(updated.id, updated);
    setDecorationPosition(decorationDragState.element, updated);
  }

  function finishDecorationDrag(event, cancel) {
    if (!decorationDragState || event.pointerId !== decorationDragState.pointerId) return;
    const current = decorationDragState;
    decorationDragState = null;
    document.removeEventListener('pointermove', onDecorationDragMove, true);
    document.removeEventListener('pointerup', onDecorationDragEnd, true);
    document.removeEventListener('pointercancel', onDecorationDragCancel, true);
    if (cancel) {
      if (current.moved) {
        fanpageDecorations.set(current.id, current.original);
        setDecorationPosition(current.element, current.original);
      }
      return;
    }
    if (!current.moved) return;
    const updated = fanpageDecorations.get(current.id);
    mutateDecoration('move', { decorationId: current.id, x: updated.x, y: updated.y })
      .catch((error) => {
        fanpageDecorations.set(current.id, current.original);
        renderFanpageDecorations();
        showDecorationError(error);
      });
  }

  function onDecorationDragEnd(event) { finishDecorationDrag(event, false); }
  function onDecorationDragCancel(event) { finishDecorationDrag(event, true); }

  function clearDecorationDrag() {
    if (!decorationDragState) return;
    document.removeEventListener('pointermove', onDecorationDragMove, true);
    document.removeEventListener('pointerup', onDecorationDragEnd, true);
    document.removeEventListener('pointercancel', onDecorationDragCancel, true);
    decorationDragState = null;
  }

  function showDecorationError(error) {
    console.error('[게임시리즈 감정표현] 팬페이지 스티커 저장 실패:', error);
    window.dispatchEvent(new CustomEvent('streamer-fanpage-emotes-error', {
      detail: { message: error?.message || '스티커를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }
    }));
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
  loginCloseButton.addEventListener('click', closeLoginGate);
  loginGate.addEventListener('click', (event) => {
    if (event.target === loginGate) closeLoginGate();
  });
  picker.addEventListener('click', (event) => {
    if (event.target === picker) closePicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !picker.hidden) {
      closePicker();
      return;
    }
    if (event.key === 'Escape' && !loginGate.hidden) {
      closeLoginGate();
      return;
    }
    if (launcher.hidden) return;
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isTextEntry(event)) return;
    const key = String(event.key || '').toLowerCase();
    if (event.code === 'KeyE' || key === 'e' || key === 'ㄷ') {
      event.preventDefault();
      event.stopPropagation();
      openPicker();
    }
  }, true);
  window.addEventListener('game-series-emote-room-change', (event) => setRoom(event.detail?.roomId));
  window.addEventListener('streamer-fanpage-emotes-context-change', (event) => setFanpageContext(event.detail));
  window.addEventListener('resize', updateFanpageDecorationPositions);
  if (gameId === 'streamerFanPage') setFanpageContext(window.__streamerFanPageEmotes);
  else if (window.__gameSeriesEmoteRoomId) setRoom(window.__gameSeriesEmoteRoomId);
  loadCatalog().then(() => {
    renderFanpageDecorations();
    subscribeToCurrentRoom();
  }).catch((error) => {
    console.error('[게임시리즈 감정표현] 카탈로그를 불러오지 못했습니다:', error);
  });
  if (gameId !== 'streamerFanPage' && (window.obsstudio || new URLSearchParams(location.search).get('view') === '1')) launcher.hidden = true;

  window.gameSeriesEmotes = Object.freeze({
    open: openPicker,
    get currentUid() { return auth.currentUser?.uid || null; },
    appName: app.name
  });
}

import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { ensureAppCheck } from './app-check.js?v=20261114-ac1';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import { setupBugReport } from './bug-report.js?v=20261121-bug1';
import { createSeriesLogin } from './series-login.js?v=20261128-kit3';

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
const functions = getFunctions(app, 'us-central1');
const callable = (name) => httpsCallable(functions, name);
const getWalletState = callable('gameSeriesWalletGetAdminState');

const loginButton = document.getElementById('shopLoginButton');

// 로그인 창은 시리즈 공통 부품(series-kit login-modal). 로그인 뒤 처리(버튼 숨김·다른 스크립트에 알림)만 여기서 한다.
// 로그인·인증이 끝났음을 다른 스크립트(예: 분양소)에 알린다. Google 연결은 UID가 그대로라 상태 변경 이벤트가 다시 오지 않는다.
function notifyAuthChanged() {
  window.dispatchEvent(new CustomEvent('shop-auth-changed'));
}
const seriesLogin = createSeriesLogin({
  auth, functions, source: 'game-series-shop',
  onChange: async (user) => { notifyAuthChanged(); await updateLoginVisibility(user); },
});
// openShopLoginModal({ streamer, then }): then은 로그인 성공 뒤 이어서 실행할 동작.
window.openShopLoginModal = (options = {}) => seriesLogin.open(options);
window.shopRequireLogin = (fn) => seriesLogin.require(fn);
//  2026-11-21 공용 버그 제보 창(팬페이지·갤러리·상점 공통). 접수는 팬페이지 서버가 로그인 계정인지 판정한다.
setupBugReport({
  service: 'shop',
  call: httpsCallable(functions, 'streamerFanPageViewerStatsBugReports'),
  getUid: () => auth.currentUser?.uid || '',
  openLogin: () => seriesLogin.open(),
  trigger: document.getElementById('openBugReport'),
});

async function updateLoginVisibility(user) {
  if (!loginButton) return;
  if (!user) {
    loginButton.hidden = false;
    try { await signInAnonymously(auth); } catch (error) { console.error('상점 익명 세션 시작 실패:', error); }
    return;
  }
  if (!user.isAnonymous) { loginButton.hidden = true; return; }
  // 스트리머 인증은 기존 익명 UID를 그대로 쓰는 시리즈 공통 구조다. 서버가 인증 기록을 확인한 경우만 로그인된 계정으로 취급한다.
  try {
    const state = await getWalletState();
    loginButton.hidden = state.data?.isVerifiedStreamer === true;
  } catch (error) {
    if (error.code !== 'functions/unauthenticated') console.error('상점 로그인 상태 확인 실패:', error);
    loginButton.hidden = false;
  }
}
if (loginButton) loginButton.addEventListener('click', () => seriesLogin.open());

onAuthStateChanged(auth, updateLoginVisibility);

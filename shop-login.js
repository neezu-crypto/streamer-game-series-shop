import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, linkWithPopup, onAuthStateChanged, signInAnonymously,
  signInWithCustomToken, signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

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
const functions = getFunctions(app, 'us-central1');
const callable = (name) => httpsCallable(functions, name);
const linkGoogleAccount = callable('linkGoogleAccount');
const linkKakaoAccount = callable('linkKakaoAccount');
const requestStreamerVerification = callable('requestStreamerVerification');
const getWalletState = callable('gameSeriesWalletGetAdminState');

const $ = (id) => document.getElementById(id);
const loginButton = $('shopLoginButton');
const loginModal = $('shopLoginModal');
let currentUser = null;

function showLoginButton(show) {
  loginButton.hidden = !show;
}

function openLoginModal(options = {}) {
  const streamerForm = options && options.streamer === true;
  $('shopLoginChoices').hidden = streamerForm;
  $('shopStreamerLoginForm').hidden = !streamerForm;
  $('shopStreamerLoginStatus').textContent = '';
  loginModal.showModal();
}

function closeLoginModal() {
  loginModal.close();
}

// 로그인·인증이 끝났음을 다른 스크립트(예: 분양소)에 알린다. Google 연결은 UID가 그대로라 상태 변경 이벤트가 다시 오지 않는다.
function notifyAuthChanged() {
  window.dispatchEvent(new CustomEvent('shop-auth-changed'));
}
window.openShopLoginModal = openLoginModal;

async function updateLoginVisibility(user) {
  currentUser = user;
  if (!user) {
    showLoginButton(true);
    try { await signInAnonymously(auth); } catch (error) { console.error('상점 익명 세션 시작 실패:', error); }
    return;
  }
  if (!user.isAnonymous) {
    showLoginButton(false);
    return;
  }
  // 스트리머 인증은 기존 익명 UID를 그대로 쓰는 시리즈 공통 구조다. 서버가
  // 인증 기록을 확인한 경우만 로그인된 계정으로 취급한다.
  try {
    const state = await getWalletState();
    showLoginButton(state.data?.isVerifiedStreamer !== true ? true : false);
  } catch (error) {
    if (error.code !== 'functions/unauthenticated') console.error('상점 로그인 상태 확인 실패:', error);
    showLoginButton(true);
  }
}

async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    if (auth.currentUser?.isAnonymous) await linkWithPopup(auth.currentUser, provider);
    else await signInWithPopup(auth, provider);
    await linkGoogleAccount();
    closeLoginModal(); notifyAuthChanged();
  } catch (error) {
    if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return;
    if (error?.code === 'auth/credential-already-in-use' || error?.code === 'auth/email-already-in-use') {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
        await linkGoogleAccount();
        closeLoginModal(); notifyAuthChanged();
        return;
      } catch (switchError) {
        console.error('상점 Google 계정 전환 실패:', switchError);
        window.alert(`Google 로그인에 실패했습니다. ${switchError.message || switchError}`);
        return;
      }
    }
    console.error('상점 Google 로그인 실패:', error);
    window.alert(`Google 로그인에 실패했습니다. ${error.message || error}`);
  }
}

function loginWithKakao() {
  if (typeof window.Kakao === 'undefined' || !window.Kakao.isInitialized()) {
    window.alert('카카오 로그인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }
  window.Kakao.Auth.login({
    success: async (kakaoAuth) => {
      try {
        const result = await linkKakaoAccount({ kakaoAccessToken: kakaoAuth.access_token });
        if (result.data?.action === 'switch') await signInWithCustomToken(auth, result.data.customToken);
        closeLoginModal(); notifyAuthChanged();
        await updateLoginVisibility(auth.currentUser);
      } catch (error) {
        console.error('상점 카카오 로그인 실패:', error);
        window.alert(`카카오 로그인에 실패했습니다. ${error.message || error}`);
      }
    },
    fail: () => window.alert('카카오 로그인이 취소되었거나 실패했습니다.'),
  });
}

async function submitStreamerLogin(data) {
  const status = $('shopStreamerLoginStatus');
  status.textContent = '스트리머 인증 상태를 확인하고 있습니다.';
  try {
    const result = await requestStreamerVerification({ ...data, source: 'game-series-shop' });
    const payload = result.data || {};
    if (payload.action === 'switch' && payload.customToken) {
      await signInWithCustomToken(auth, payload.customToken);
      closeLoginModal(); notifyAuthChanged();
      return;
    }
    if (payload.action === 'already-verified' || payload.action === 'auto-approved') {
      closeLoginModal(); notifyAuthChanged();
      await updateLoginVisibility(auth.currentUser);
      return;
    }
    const code = payload.verificationCode ? ` 인증 코드: ${payload.verificationCode}` : '';
    status.textContent = `인증 신청이 접수되었습니다.${code} SOOP 쪽지 안내를 완료한 뒤 인증 상태 확인을 눌러 주세요.`;
  } catch (error) {
    console.error('상점 스트리머 인증 처리 실패:', error);
    status.textContent = `인증 처리를 완료하지 못했습니다. ${error.message || error}`;
  }
}

loginButton.addEventListener('click', openLoginModal);
$('shopLoginClose').addEventListener('click', closeLoginModal);
loginModal.addEventListener('click', (event) => { if (event.target === loginModal) closeLoginModal(); });
$('shopLoginGoogle').addEventListener('click', loginWithGoogle);
$('shopLoginKakao').addEventListener('click', loginWithKakao);
$('shopLoginStreamer').addEventListener('click', () => {
  $('shopLoginChoices').hidden = true;
  $('shopStreamerLoginForm').hidden = false;
  $('shopStreamerLoginStatus').textContent = '';
});
$('shopStreamerLoginBack').addEventListener('click', () => {
  $('shopLoginChoices').hidden = false;
  $('shopStreamerLoginForm').hidden = true;
});
$('shopStreamerLoginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const nickname = $('shopStreamerNickname').value.trim();
  const soopId = $('shopStreamerSoopId').value.trim();
  if (!nickname) return window.alert('SOOP 닉네임을 입력해 주세요.');
  if (!/^[a-z0-9]{2,20}$/.test(soopId)) return window.alert('SOOP 아이디는 영문 소문자·숫자 2~20자로 입력해 주세요.');
  void submitStreamerLogin({ nickname, soopId });
});
$('shopStreamerCheck').addEventListener('click', () => void submitStreamerLogin({ checkOnly: true }));

if (typeof window.Kakao !== 'undefined' && !window.Kakao.isInitialized()) {
  window.Kakao.init('ed4f01d6903ca41d5dc0ab32b6ae143c');
}
onAuthStateChanged(auth, updateLoginVisibility);

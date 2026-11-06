import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, linkWithPopup, onAuthStateChanged, signInAnonymously,
  signInWithCustomToken, signInWithPopup, signOut,
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

const callable = (name, options) => httpsCallable(functions, name, options);
const getWalletState = callable('gameSeriesWalletGetAdminState');
const submitCharge = callable('gameSeriesWalletSubmitCharge');
const markDonationComplete = callable('gameSeriesWalletMarkDonationComplete', { timeout: 20000 });
const cancelCharge = callable('gameSeriesWalletCancelCharge');
const submitRefund = callable('gameSeriesWalletSubmitRefund');
const submitSupport = callable('gameSeriesWalletSubmitSupport');
const getWalletAdminList = callable('gameSeriesWalletAdminList');
const reviewWalletRequest = callable('gameSeriesWalletAdminReview');
// 주식시장·인생게임과 같은 공용 계정 보호 함수다. 상점이 별도 계정을 만들지
// 않고, 기존 시리즈 UID의 캐시·인증 상태를 그대로 사용하도록 한다.
const linkGoogleAccount = callable('linkGoogleAccount');
const linkKakaoAccount = callable('linkKakaoAccount');
const requestStreamerVerification = callable('requestStreamerVerification');

const $ = (id) => document.getElementById(id);
const authStatus = $('walletAuthStatus');
const authButton = $('walletAuthButton');
const gate = $('walletGate');
const gateTitle = $('walletGateTitle');
const gateMessage = $('walletGateMessage');
const walletApp = $('walletApp');
const chargeStatus = $('walletChargeStatus');
const supportStatus = $('walletSupportStatus');
let currentUser = null;
let walletState = null;
let busy = false;
let isVerifiedStreamer = false;

const walletTabs = Array.from(document.querySelectorAll('[role="tab"][aria-controls^="walletPanel"]'));
const walletQuery = new URLSearchParams(window.location.search);
const shouldOpenWalletReview = walletQuery.get('tab') === 'requests' && walletQuery.get('focus') === 'walletReviewQueue';

function activateWalletTab(tab, focus = false) {
  walletTabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) tab.focus();
}

function applyWalletReviewDeepLink() {
  if (!shouldOpenWalletReview) return;
  const requestTab = $('walletTabRequests');
  if (requestTab) activateWalletTab(requestTab);
  requestAnimationFrame(() => {
    const reviewQueue = $('walletReviewQueue');
    if (!reviewQueue || reviewQueue.hidden) return;
    reviewQueue.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

walletTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateWalletTab(tab));
  tab.addEventListener('keydown', (event) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % walletTabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + walletTabs.length) % walletTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = walletTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateWalletTab(walletTabs[nextIndex], true);
  });
});

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function formatDate(value) {
  const date = new Date(Number(value) || 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0
    ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
    : '시간 정보 없음';
}

function createRequestId() {
  return `${Date.now()}_${crypto.randomUUID()}`;
}

const STATUS_LABELS = {
  awaitingDonation: '후원 대기', donationCompleted: '후원 완료 알림 · 관리자 확인 대기', processing: '지급 처리 중', approved: '승인 · 캐시 지급 완료',
  rejected: '신청 거절', cancelled: '신청 취소', refundRequested: '환불 검수 대기',
  refundProcessing: '환불 처리 중', refundRejecting: '환불 거절 처리 중', refunded: '환불 완료', open: '답변 대기', closed: '처리 완료',
};

function setGate(message, title = '로그인이 필요합니다') {
  gate.hidden = false;
  walletApp.hidden = true;
  gateTitle.textContent = title;
  gateMessage.textContent = message;
}

function setBusy(value) {
  busy = value;
  $('walletChargeSubmit').disabled = value;
  $('walletRefresh').disabled = value;
  $('walletSupportForm').querySelector('button[type="submit"]').disabled = value;
  document.querySelectorAll('[data-wallet-review]').forEach((button) => { button.disabled = value; });
}

function renderChargeRequests(items) {
  const host = $('walletRequestList');
  if (!items.length) {
    host.innerHTML = '<div class="wallet-empty">아직 충전 신청 내역이 없습니다.</div>';
    return;
  }
  host.innerHTML = items.map((item) => {
    const action = ['awaitingDonation', 'donationCompleted'].includes(item.status)
      ? `<button class="wallet-small-action" type="button" data-wallet-cancel="${escapeHtml(item.requestId)}">신청 취소</button>`
      : item.status === 'approved'
        ? `<button class="wallet-small-action" type="button" data-wallet-refund="${escapeHtml(item.requestId)}" data-wallet-refund-cash="${Number(item.cashAmount) || 0}">환불 신청</button>`
        : '';
    const showRefund = ['refundRequested', 'refundProcessing', 'refundRejecting', 'refunded'].includes(item.status);
    const refundCash = showRefund ? Number(item.refundCashAmount) || (item.status === 'refunded' ? Number(item.cashAmount) || 0 : 0) : 0;
    const refundStars = showRefund ? Number(item.refundStarCount) || refundCash : 0;
    const refundDetail = refundCash > 0
      ? `<small>SOOP 반환 요청 ${refundStars.toLocaleString('ko-KR')}개 · ${refundCash.toLocaleString('ko-KR')}캐시</small>` : '';
    const viewerSupport = item.chargeType !== 'selfCharge';
    const donationInfo = item.paymentMethod === 'starBalloon'
      ? viewerSupport
        ? `시청자 후원 · SOOP ${escapeHtml(item.soopDonorNickname || '-')} (${escapeHtml(item.soopDonorId || '-')}) · 별풍선 ${Number(item.starCount || 0).toLocaleString('ko-KR')}개`
        : `본인 직접 후원 · 별풍선 ${Number(item.starCount || 0).toLocaleString('ko-KR')}개`
      : '전환 전 현금 충전 기록';
    return `<article class="wallet-list-row"><div><strong>${Number(item.cashAmount || 0).toLocaleString('ko-KR')}캐시</strong><span>${donationInfo} · ${formatDate(item.createdAt)}</span>${refundDetail}${item.reviewNote ? `<small>검수 메모: ${escapeHtml(item.reviewNote)}</small>` : ''}${item.refundAdminNote ? `<small>반환 메모: ${escapeHtml(item.refundAdminNote)}</small>` : ''}</div><div class="wallet-list-trailing"><b class="wallet-status-pill ${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</b>${action}</div></article>`;
  }).join('');
  host.querySelectorAll('[data-wallet-cancel]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('대기 중인 별풍선 충전 신청을 취소할까요? 이미 후원했다면 취소만으로 SOOP 반환이 처리되지는 않습니다.')) return;
    try { await cancelCharge({ requestId: button.dataset.walletCancel }); await refreshWallet(); }
    catch (error) { window.alert(`취소 실패: ${error.message || error}`); }
  }));
  host.querySelectorAll('[data-wallet-refund]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const latest = await getWalletState();
      const availableCash = Number(latest.data.availableRefundCash ?? latest.data.balanceCash) || 0;
      const refundCash = Math.min(Number(button.dataset.walletRefundCash) || 0, availableCash);
      if (refundCash <= 0) {
        window.alert('현재 환불할 수 있는 미사용 캐시가 없습니다.');
        return;
      }
      if (!window.confirm(`미사용 잔액 ${refundCash.toLocaleString('ko-KR')}캐시의 SOOP 반환을 신청할까요? 검수 중에는 신청액을 사용할 수 없습니다.`)) return;
      const reason = window.prompt('반환 사유를 입력해 주세요. SOOP의 처리 조건과 기간은 확정되지 않았습니다.');
      if (!reason || !reason.trim()) return;
      const response = await submitRefund({ requestId: button.dataset.walletRefund, reason: reason.trim() });
      const result = response.data || {};
      window.alert(`SOOP 반환 신청 접수: ${Number(result.cashAmount || refundCash).toLocaleString('ko-KR')}캐시`);
      await refreshWallet();
    }
    catch (error) { window.alert(`환불 신청 실패: ${error.message || error}`); }
  }));
}

function renderChargeReviews(items) {
  const host = $('walletReviewList');
  const pending = items.filter((item) => item.status === 'donationCompleted');
  if (!pending.length) {
    host.innerHTML = '<div class="wallet-empty">검수 대기 중인 별풍선 충전 신청이 없습니다.</div>';
    return;
  }
  host.innerHTML = pending.map((item) => {
    const viewerSupport = item.chargeType !== 'selfCharge';
    const donorDetail = viewerSupport
      ? `시청자 ${escapeHtml(item.soopDonorNickname || '-')} (${escapeHtml(item.soopDonorId || '-')}) → 인증 스트리머`
      : '본인 직접 후원 → 신청자 본인';
    return `<article class="wallet-list-row wallet-review-row"><div><strong>${Number(item.cashAmount || 0).toLocaleString('ko-KR')}캐시 · 별풍선 ${Number(item.starCount || 0).toLocaleString('ko-KR')}개</strong><span>${donorDetail} · ${formatDate(item.donationCompletedAt || item.updatedAt || item.createdAt)}</span><small>신청 번호: ${escapeHtml(item.requestId)}</small></div><div class="wallet-list-trailing"><b class="wallet-status-pill donationCompleted">후원 완료 알림</b><div class="wallet-review-actions"><button class="wallet-small-action" type="button" data-wallet-review="reject" data-wallet-request-id="${escapeHtml(item.requestId)}">거절</button><button class="wallet-small-action wallet-approve-action" type="button" data-wallet-review="approve" data-wallet-request-id="${escapeHtml(item.requestId)}">승인·캐시 지급</button></div></div></article>`;
  }).join('');
  host.querySelectorAll('[data-wallet-review]').forEach((button) => {
    button.disabled = busy;
    button.addEventListener('click', async () => {
      const action = button.dataset.walletReview;
      const requestId = button.dataset.walletRequestId;
      const isApproval = action === 'approve';
      const confirmation = isApproval
        ? 'SOOP 실제 후원 내역의 후원자 정보와 수량을 대조했나요? 승인하면 해당 신청자에게 캐시가 지급됩니다.'
        : '이 별풍선 충전 신청을 거절할까요? 후원 완료 알림 상태의 신청만 거절할 수 있습니다.';
      if (!window.confirm(confirmation)) return;
      const note = window.prompt(`${isApproval ? '승인' : '거절'} 검수 메모를 입력해 주세요. (선택 입력)`);
      if (note === null) return;
      setBusy(true);
      try {
        await reviewWalletRequest({ kind: 'charge', action, requestId, note: note.trim() });
        window.alert(isApproval ? '승인 완료: 캐시 지급을 처리했습니다.' : '충전 신청을 거절했습니다.');
        await refreshWallet(true);
      } catch (error) {
        window.alert(`${isApproval ? '승인' : '거절'} 처리 실패: ${error.message || error}`);
      } finally {
        setBusy(false);
      }
    });
  });
}

function renderSupport(items) {
  const host = $('walletSupportList');
  if (!items.length) {
    host.innerHTML = '<div class="wallet-empty">접수된 고객센터 문의가 없습니다.</div>';
    return;
  }
  const category = { 'donation-check': '별풍선 후원 확인', 'wrong-donor': '후원자 정보·수량 차이', refund: '반환 문의', other: '기타' };
  host.innerHTML = items.map((item) => `<article class="wallet-list-row"><div><strong>${escapeHtml(category[item.category] || '고객센터 문의')} · ${Number(item.starCount || 0) ? `${Number(item.starCount).toLocaleString('ko-KR')}개` : '수량 미입력'}</strong><span>${formatDate(item.createdAt)}${item.relatedChargeRequestId ? ` · 신청 ${escapeHtml(item.relatedChargeRequestId)}` : ''}</span><p>${escapeHtml(item.message)}</p>${item.adminNote ? `<small>답변: ${escapeHtml(item.adminNote)}</small>` : ''}</div><b class="wallet-status-pill ${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</b></article>`).join('');
}

function renderLedger(items) {
  const host = $('walletLedgerList');
  if (!items.length) {
    host.innerHTML = '<div class="wallet-empty">아직 캐시 변동 내역이 없습니다.</div>';
    return;
  }
  host.innerHTML = items.map((item) => {
    const kind = String(item.kind || '');
    const chestPurchase = kind === 'treasureChestPurchase';
    const chestCancellation = kind === 'treasureChestCancellation';
    const positive = kind === 'starBalloonCharge' || chestCancellation;
    const cashAmount = Number(item.cashAmount || 0);
    const title = chestPurchase
      ? `보물상자 ${Number(item.paidChestCount || 0)}개 구매${Number(item.bonusChestCount || 0) ? ` · 보너스 ${Number(item.bonusChestCount).toLocaleString('ko-KR')}개` : ''}`
      : chestCancellation
        ? `보물상자 ${Number(item.chestCount || 0)}개 취소`
        : (positive ? '별풍선 충전 승인' : 'SOOP 반환 완료');
    const badge = chestPurchase ? '구매' : chestCancellation ? '취소' : (positive ? '지급' : '반환');
    return `<article class="wallet-list-row"><div><strong>${positive ? '+' : '−'}${cashAmount.toLocaleString('ko-KR')}캐시</strong><span>${title} · 별풍선 ${Number(item.starCount || 0).toLocaleString('ko-KR')}개 · ${formatDate(item.createdAt)}</span></div><b class="wallet-status-pill ${positive ? 'approved' : 'refunded'}">${badge}</b></article>`;
  }).join('');
}

function renderWallet(data) {
  walletState = data;
  isVerifiedStreamer = data.isVerifiedStreamer === true;
  configureChargeExperience();
  $('walletBalance').textContent = Number(data.balanceCash || 0).toLocaleString('ko-KR');
  const reserved = Number(data.refundReservedCash) || 0;
  const reserveNote = $('walletRefundReserve');
  reserveNote.hidden = reserved <= 0;
  reserveNote.textContent = reserved > 0
    ? `환불 검수 중인 ${reserved.toLocaleString('ko-KR')}캐시는 처리 완료 또는 거절 전까지 사용할 수 없습니다.`
    : '';
  $('walletDonorNickname').value = isVerifiedStreamer ? (data.soopDonorNickname || '') : '';
  $('walletDonorId').value = isVerifiedStreamer ? (data.soopDonorId || '') : '';
  renderChargeRequests(data.requests || []);
  renderSupport(data.supportRequests || []);
  renderLedger(data.ledger || []);
  $('walletReviewQueue').hidden = data.isAdmin !== true;
  updateCashPreview();
  gate.hidden = true;
  walletApp.hidden = false;
  applyWalletReviewDeepLink();
}

function configureChargeExperience() {
  const donorFields = $('walletDonorFields');
  const nickname = $('walletDonorNickname');
  const donorId = $('walletDonorId');
  donorFields.hidden = !isVerifiedStreamer;
  nickname.required = isVerifiedStreamer;
  donorId.required = isVerifiedStreamer;
  if (isVerifiedStreamer) {
    $('walletChargeTabHint').textContent = '시청자의 SOOP 후원을 접수해 스트리머 본인 계정에 캐시를 적립합니다. 시청자 닉네임·아이디와 수량을 입력한 뒤 라이브에 QR을 보여 주세요.';
    $('walletChargeIntroGuide').textContent = '인증 스트리머 계정입니다. 시청자 후원자 닉네임·아이디와 수량을 먼저 입력하고, 시청자가 라이브 화면의 QR을 스캔해 후원하면 승인 캐시가 스트리머 본인 계정에 적립됩니다.';
    $('walletDonationGuide').textContent = '입력한 시청자가 라이브 화면의 QR을 스캔해 신청 수량만큼 후원한 뒤, 스트리머가 후원 완료를 알려 주세요. 아래 버튼은 관리자에게 검수 대기 알림을 보냅니다.';
  } else {
    $('walletChargeTabHint').textContent = '일반 로그인 계정입니다. 후원자 정보 입력 없이 본인이 QR을 스캔해 후원하면 승인 캐시가 본인 계정에 적립됩니다.';
    $('walletChargeIntroGuide').textContent = '일반 로그인 계정입니다. 후원자 정보는 입력하지 않습니다. 신청 후 본인이 QR을 스캔해 별풍선을 후원하고 직접 후원 완료를 알려 주세요.';
    $('walletDonationGuide').textContent = '본인이 QR을 스캔해 신청 수량만큼 후원한 뒤 후원 완료를 눌러 주세요. 승인 캐시는 이 로그인 계정에 적립됩니다. 아래 버튼은 관리자에게 검수 대기 알림을 보냅니다.';
  }
}

async function refreshReviewQueue() {
  try {
    const adminResult = await getWalletAdminList();
    renderChargeReviews((adminResult.data && adminResult.data.chargeRequests) || []);
  } catch (error) {
    console.error('관리자 충전 검수 목록 조회 실패:', error);
    const host = $('walletReviewList');
    host.innerHTML = '<div class="wallet-empty">검수 대기 목록을 불러오지 못했습니다. 새로고침해 다시 시도해 주세요.</div>';
  }
}

async function refreshWallet(force = false) {
  if (!currentUser || (busy && !force)) return;
  setBusy(true);
  $('walletPageStatus').textContent = '캐시·신청 내역을 불러오는 중입니다.';
  try {
    const result = await getWalletState();
    renderWallet(result.data);
    if (result.data?.isAdmin === true) void refreshReviewQueue();
    $('walletPageStatus').textContent = '';
  } catch (error) {
    console.error('통합 캐시 조회 실패:', error);
    if (error.code === 'functions/unauthenticated') setGate('Google·카카오 로그인 또는 스트리머 인증 후 본인 캐시 충전 신청과 내역을 이용할 수 있습니다.');
    else setGate(`정보를 불러오지 못했습니다. 다시 시도해 주세요. (${error.message || error})`);
    $('walletPageStatus').textContent = '';
  } finally {
    setBusy(false);
  }
}

function updateCashPreview() {
  const input = $('walletAmount');
  const amount = Number(input.value) || 0;
  $('walletCashPreview').textContent = Number.isSafeInteger(amount) && amount > 0
    ? amount.toLocaleString('ko-KR')
    : '0';
  $('walletChargeSubmit').disabled = busy;
}

async function initializeWalletUser(user) {
  currentUser = user;
  if (!user) {
    authStatus.textContent = '로그인이 필요합니다';
    authButton.textContent = '로그인';
    setGate('Google·카카오 로그인 또는 스트리머 인증 후 본인 캐시 충전 신청과 내역을 이용할 수 있습니다.');
    try { await signInAnonymously(auth); } catch (error) { console.error('익명 세션 시작 실패:', error); }
    return;
  }
  authStatus.textContent = user.isAnonymous ? '로그인이 필요합니다' : (user.email || '연결된 계정');
  authButton.textContent = user.isAnonymous ? '로그인' : '로그아웃';
  gateTitle.textContent = '로그인 계정 확인 중';
  gateMessage.textContent = '서버에서 충전 신청 권한을 확인합니다.';
  gate.hidden = false;
  walletApp.hidden = true;
  try {
    const result = await getWalletState();
    renderWallet(result.data);
    if (result.data?.isAdmin === true) void refreshReviewQueue();
  } catch (error) {
    console.error('통합 캐시 로그인 확인 실패:', error);
    if (error.code === 'functions/unauthenticated') setGate('Google·카카오 로그인 또는 스트리머 인증 후 다시 시도해 주세요.');
    else setGate(`계정 정보를 확인하지 못했습니다. 다시 로그인해 주세요. (${error.message || error})`);
  }
}

onAuthStateChanged(auth, initializeWalletUser);

function openLoginModal() {
  $('walletLoginChoices').hidden = false;
  $('walletStreamerLoginForm').hidden = true;
  $('walletStreamerLoginStatus').textContent = '';
  $('walletLoginModal').showModal();
}

function closeLoginModal() {
  $('walletLoginModal').close();
}

async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    if (auth.currentUser?.isAnonymous) {
      await linkWithPopup(auth.currentUser, provider);
    } else {
      await signInWithPopup(auth, provider);
    }
    await linkGoogleAccount();
    closeLoginModal();
  } catch (error) {
    if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return;
    // 이미 다른 시리즈 UID에 연결된 Google 계정은 해당 계정으로 전환한다.
    if (error?.code === 'auth/credential-already-in-use' || error?.code === 'auth/email-already-in-use') {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
        await linkGoogleAccount();
        closeLoginModal();
        return;
      } catch (switchError) {
        console.error('Google 계정 전환 실패:', switchError);
        window.alert(`Google 로그인에 실패했습니다. ${switchError.message || switchError}`);
        return;
      }
    }
    console.error('Google 로그인 실패:', error);
    window.alert(`Google 로그인에 실패했습니다. ${error.message || error}`);
  }
}

async function loginWithKakao() {
  if (typeof window.Kakao === 'undefined' || !window.Kakao.isInitialized()) {
    window.alert('카카오 로그인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }
  window.Kakao.Auth.login({
    success: async (kakaoAuth) => {
      try {
        const result = await linkKakaoAccount({ kakaoAccessToken: kakaoAuth.access_token });
        if (result.data?.action === 'switch') await signInWithCustomToken(auth, result.data.customToken);
        closeLoginModal();
      } catch (error) {
        console.error('카카오 로그인 실패:', error);
        window.alert(`카카오 로그인에 실패했습니다. ${error.message || error}`);
      }
    },
    fail: () => window.alert('카카오 로그인이 취소되었거나 실패했습니다.'),
  });
}

async function submitStreamerLogin(data) {
  const status = $('walletStreamerLoginStatus');
  status.textContent = '스트리머 인증 상태를 확인하고 있습니다.';
  try {
    const result = await requestStreamerVerification({ ...data, source: 'game-series-shop' });
    const payload = result.data || {};
    if (payload.action === 'switch' && payload.customToken) {
      await signInWithCustomToken(auth, payload.customToken);
      closeLoginModal();
      return;
    }
    if (payload.action === 'already-verified' || payload.action === 'auto-approved') {
      closeLoginModal();
      await initializeWalletUser(auth.currentUser);
      return;
    }
    const code = payload.verificationCode ? ` 인증 코드: ${payload.verificationCode}` : '';
    status.textContent = `인증 신청이 접수되었습니다.${code} SOOP 쪽지 안내를 완료한 뒤 인증 상태 확인을 눌러 주세요.`;
  } catch (error) {
    console.error('스트리머 인증 처리 실패:', error);
    status.textContent = `인증 처리를 완료하지 못했습니다. ${error.message || error}`;
  }
}

authButton.addEventListener('click', async () => {
  if (currentUser && !currentUser.isAnonymous) {
    await signOut(auth);
    return;
  }
  openLoginModal();
});

$('walletGateLogin').addEventListener('click', openLoginModal);
$('walletLoginClose').addEventListener('click', closeLoginModal);
$('walletLoginModal').addEventListener('click', (event) => { if (event.target === $('walletLoginModal')) closeLoginModal(); });
$('walletLoginGoogle').addEventListener('click', loginWithGoogle);
$('walletLoginKakao').addEventListener('click', loginWithKakao);
$('walletLoginStreamer').addEventListener('click', () => {
  $('walletLoginChoices').hidden = true;
  $('walletStreamerLoginForm').hidden = false;
  $('walletStreamerLoginStatus').textContent = '';
});
$('walletStreamerLoginBack').addEventListener('click', () => {
  $('walletLoginChoices').hidden = false;
  $('walletStreamerLoginForm').hidden = true;
});
$('walletStreamerLoginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const nickname = $('walletStreamerNickname').value.trim();
  const soopId = $('walletStreamerSoopId').value.trim();
  if (!nickname) return window.alert('SOOP 닉네임을 입력해 주세요.');
  if (!/^[a-z0-9]{2,20}$/.test(soopId)) return window.alert('SOOP 아이디는 영문 소문자·숫자 2~20자로 입력해 주세요.');
  void submitStreamerLogin({ nickname, soopId });
});
$('walletStreamerCheck').addEventListener('click', () => void submitStreamerLogin({ checkOnly: true }));

if (typeof window.Kakao !== 'undefined' && !window.Kakao.isInitialized()) {
  window.Kakao.init('ed4f01d6903ca41d5dc0ab32b6ae143c');
}

$('walletAmount').addEventListener('input', updateCashPreview);
$('walletRefresh').addEventListener('click', refreshWallet);
function openChargeModal() {
  $('walletChargeIntro').hidden = false;
  $('walletChargeForm').hidden = true;
  $('walletDonationStep').hidden = true;
  $('walletDonationStep').dataset.requestId = '';
  $('walletDonationComplete').disabled = false;
  $('walletDonationComplete').textContent = '후원 완료';
  $('walletDonationStatus').textContent = '';
  chargeStatus.textContent = '';
  $('walletChargeModal').showModal();
}

$('walletOpenCharge').addEventListener('click', openChargeModal);
$('walletOpenChargeFromTab').addEventListener('click', openChargeModal);
$('walletCloseCharge').addEventListener('click', () => $('walletChargeModal').close());
$('walletChargeModal').addEventListener('click', (event) => {
  if (event.target === $('walletChargeModal')) $('walletChargeModal').close();
});
$('walletChargeStart').addEventListener('click', () => {
  $('walletChargeIntro').hidden = true;
  $('walletChargeForm').hidden = false;
});
$('walletChargeBack').addEventListener('click', () => {
  $('walletChargeForm').hidden = true;
  $('walletChargeIntro').hidden = false;
  chargeStatus.textContent = '';
});

$('walletDonationCancel').addEventListener('click', async () => {
  const requestId = $('walletDonationStep').dataset.requestId;
  if (!requestId || !window.confirm('별풍선 충전 신청을 취소할까요? 이미 후원했다면 SOOP 반환은 자동으로 처리되지 않습니다.')) return;
  try {
    await cancelCharge({ requestId });
    $('walletDonationStep').hidden = true;
    $('walletChargeForm').hidden = true;
    $('walletChargeIntro').hidden = false;
    await refreshWallet();
  } catch (error) { window.alert(`취소 실패: ${error.message || error}`); }
});

$('walletDonationComplete').addEventListener('click', async () => {
  const requestId = $('walletDonationStep').dataset.requestId;
  if (!requestId || !window.confirm('실제 별풍선 후원을 마쳤나요? 이 알림은 캐시 지급이나 후원 자동 확인이 아닙니다.')) return;
  const completeButton = $('walletDonationComplete');
  completeButton.disabled = true;
  completeButton.textContent = '알림 전송 중';
  $('walletDonationStatus').textContent = '후원 완료 알림을 보내고 있습니다.';
  try {
    await markDonationComplete({ requestId });
    completeButton.textContent = '알림 전송 완료';
    $('walletDonationStatus').textContent = '후원 완료 알림을 보냈습니다. 관리자가 실제 후원 내역을 확인한 뒤 승인합니다.';
    chargeStatus.textContent = '후원 완료 알림을 보냈습니다. 관리자가 실제 후원 내역을 확인한 뒤 승인합니다.';
    await refreshWallet();
  } catch (error) {
    completeButton.disabled = false;
    completeButton.textContent = '후원 완료';
    $('walletDonationStatus').textContent = `후원 완료 알림 실패: ${error.message || error}`;
  }
});

$('walletChargeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const starCount = Number($('walletAmount').value);
  const soopDonorNickname = $('walletDonorNickname').value.trim();
  const soopDonorId = $('walletDonorId').value.trim();
  if (!$('walletChargePolicy').checked) {
    chargeStatus.textContent = '충전 운영 기준을 확인해 주세요.';
    return;
  }
  if (!Number.isSafeInteger(starCount) || starCount <= 0) {
    chargeStatus.textContent = '후원할 별풍선 수량을 1개 이상의 정수로 입력해 주세요.';
    return;
  }
  if (isVerifiedStreamer && (!soopDonorNickname || !soopDonorId)) {
    chargeStatus.textContent = '시청자 SOOP 후원자 닉네임과 아이디를 입력해 주세요.';
    return;
  }
  const target = isVerifiedStreamer ? '시청자 후원으로 스트리머 계정 충전' : '본인 직접 후원 충전';
  if (!window.confirm(`${target}으로 별풍선 ${starCount.toLocaleString('ko-KR')}개를 신청할까요? 신청과 후원 완료 알림만으로 캐시가 지급되지는 않습니다.`)) return;
  setBusy(true);
  chargeStatus.textContent = '충전 신청을 저장하고 있습니다.';
  try {
    const payload = { requestId: createRequestId(), starCount };
    if (isVerifiedStreamer) Object.assign(payload, { soopDonorNickname, soopDonorId });
    const response = await submitCharge(payload);
    $('walletDonationStep').hidden = false;
    $('walletDonationStep').dataset.requestId = response.data.requestId;
    $('walletChargeForm').hidden = true;
    $('walletChargeIntro').hidden = true;
    $('walletChargePolicy').checked = false;
    chargeStatus.textContent = '신청을 접수했습니다. QR로 후원한 뒤 후원 완료를 눌러 주세요.';
    await refreshWallet(true);
  } catch (error) {
    chargeStatus.textContent = error.message || '충전 신청을 저장하지 못했습니다.';
  } finally {
    setBusy(false);
  }
});

$('walletSupportForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const message = $('walletSupportMessage').value.trim();
  if (!message) return;
  setBusy(true);
  supportStatus.textContent = '문의 내용을 저장하고 있습니다.';
  try {
    await submitSupport({
      requestId: createRequestId(),
      category: $('walletSupportCategory').value,
      message,
      starCount: Number($('walletSupportAmount').value) || 0,
      relatedChargeRequestId: $('walletSupportChargeId').value.trim(),
    });
    $('walletSupportForm').reset();
    supportStatus.textContent = '문의가 접수되었습니다. 관리자 검수 목록에서 확인할 수 있습니다.';
    await refreshWallet(true);
  } catch (error) {
    supportStatus.textContent = error.message || '문의 접수에 실패했습니다.';
  } finally {
    setBusy(false);
  }
});

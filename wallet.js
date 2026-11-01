import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
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
const getWalletState = callable('gameSeriesWalletGetAdminState');
const saveQr = callable('gameSeriesWalletAdminSaveQr');
const submitCharge = callable('gameSeriesWalletSubmitCharge');
const cancelCharge = callable('gameSeriesWalletCancelCharge');
const submitRefund = callable('gameSeriesWalletSubmitRefund');
const submitSupport = callable('gameSeriesWalletSubmitSupport');
const bootstrapAdminUid = callable('bootstrapAdminUid');

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

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function formatWon(value) {
  return `${(Number(value) || 0).toLocaleString('ko-KR')}원`;
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
  pending: '입금 확인 대기', processing: '지급 처리 중', approved: '승인 · 캐시 지급 완료',
  rejected: '신청 거절', cancelled: '신청 취소', refundRequested: '환불 검수 대기',
  refundProcessing: '환불 처리 중', refunded: '환불 완료', open: '답변 대기', closed: '처리 완료',
};

function setGate(message, title = '관리자 권한을 확인할 수 없습니다') {
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
}

function renderChargeRequests(items) {
  const host = $('walletRequestList');
  if (!items.length) {
    host.innerHTML = '<div class="wallet-empty">아직 충전 신청 내역이 없습니다.</div>';
    return;
  }
  host.innerHTML = items.map((item) => {
    const action = item.status === 'pending'
      ? `<button class="wallet-small-action" type="button" data-wallet-cancel="${escapeHtml(item.requestId)}">신청 취소</button>`
      : item.status === 'approved'
        ? `<button class="wallet-small-action" type="button" data-wallet-refund="${escapeHtml(item.requestId)}">환불 신청</button>`
        : '';
    return `<article class="wallet-list-row"><div><strong>${formatWon(item.amountKrw)} · ${Number(item.cashAmount || 0).toLocaleString('ko-KR')}캐시</strong><span>입금자명 ${escapeHtml(item.depositorName || '-')} · ${formatDate(item.createdAt)}</span>${item.reviewNote ? `<small>검수 메모: ${escapeHtml(item.reviewNote)}</small>` : ''}${item.refundAdminNote ? `<small>환불 메모: ${escapeHtml(item.refundAdminNote)}</small>` : ''}</div><div class="wallet-list-trailing"><b class="wallet-status-pill ${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</b>${action}</div></article>`;
  }).join('');
  host.querySelectorAll('[data-wallet-cancel]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('대기 중인 충전 신청을 취소할까요? 실제로 입금한 경우 취소만으로 환불되지는 않습니다.')) return;
    try { await cancelCharge({ requestId: button.dataset.walletCancel }); await refreshWallet(); }
    catch (error) { window.alert(`취소 실패: ${error.message || error}`); }
  }));
  host.querySelectorAll('[data-wallet-refund]').forEach((button) => button.addEventListener('click', async () => {
    const reason = window.prompt('환불 사유를 입력해 주세요. 환불은 운영자가 실제 계좌 반환을 확인한 뒤 처리합니다.');
    if (!reason || !reason.trim()) return;
    try { await submitRefund({ requestId: button.dataset.walletRefund, reason: reason.trim() }); await refreshWallet(); }
    catch (error) { window.alert(`환불 신청 실패: ${error.message || error}`); }
  }));
}

function renderSupport(items) {
  const host = $('walletSupportList');
  if (!items.length) {
    host.innerHTML = '<div class="wallet-empty">접수된 고객센터 문의가 없습니다.</div>';
    return;
  }
  const category = { 'deposit-mismatch': '입금 확인·금액 차이', 'wrong-payer': '입금자명·오입금', refund: '환불 문의', other: '기타' };
  host.innerHTML = items.map((item) => `<article class="wallet-list-row"><div><strong>${escapeHtml(category[item.category] || '고객센터 문의')} · ${escapeHtml(item.amountKrw ? formatWon(item.amountKrw) : '금액 미입력')}</strong><span>${formatDate(item.createdAt)}${item.relatedChargeRequestId ? ` · 신청 ${escapeHtml(item.relatedChargeRequestId)}` : ''}</span><p>${escapeHtml(item.message)}</p>${item.adminNote ? `<small>답변: ${escapeHtml(item.adminNote)}</small>` : ''}</div><b class="wallet-status-pill ${escapeHtml(item.status)}">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</b></article>`).join('');
}

function renderLedger(items) {
  const host = $('walletLedgerList');
  if (!items.length) {
    host.innerHTML = '<div class="wallet-empty">아직 캐시 변동 내역이 없습니다.</div>';
    return;
  }
  host.innerHTML = items.map((item) => {
    const positive = item.kind === 'charge';
    return `<article class="wallet-list-row"><div><strong>${positive ? '+' : '−'}${Number(item.cashAmount || 0).toLocaleString('ko-KR')}캐시</strong><span>${positive ? '충전 승인' : '충전 환불'} · ${formatWon(item.amountKrw)} · ${formatDate(item.createdAt)}</span></div><b class="wallet-status-pill ${positive ? 'approved' : 'refunded'}">${positive ? '지급' : '환불'}</b></article>`;
  }).join('');
}

function renderWallet(data) {
  walletState = data;
  $('walletBalance').textContent = Number(data.balanceCash || 0).toLocaleString('ko-KR');
  $('walletRemaining').textContent = Number(data.todayRemainingKrw || 0).toLocaleString('ko-KR');
  $('walletRemainingInline').textContent = formatWon(data.todayRemainingKrw);
  $('walletDepositorName').value = data.depositorName || '';
  $('walletQrImage').hidden = !data.qrDataUrl;
  $('walletQrImage').src = data.qrDataUrl || '';
  $('walletQrEmpty').hidden = !!data.qrDataUrl;
  renderChargeRequests(data.requests || []);
  renderSupport(data.supportRequests || []);
  renderLedger(data.ledger || []);
  updateCashPreview();
  gate.hidden = true;
  walletApp.hidden = false;
}

async function refreshWallet(force = false) {
  if (!currentUser || (busy && !force)) return;
  setBusy(true);
  $('walletPageStatus').textContent = '캐시·신청 내역을 불러오는 중입니다.';
  try {
    const result = await getWalletState();
    renderWallet(result.data);
    $('walletPageStatus').textContent = '';
  } catch (error) {
    console.error('관리자 통합 캐시 조회 실패:', error);
    if (error.code === 'functions/permission-denied') setGate('이 계정은 통합 캐시 관리자 권한이 없습니다.');
    else setGate(`정보를 불러오지 못했습니다. 다시 시도해 주세요. (${error.message || error})`);
    $('walletPageStatus').textContent = '';
  } finally {
    setBusy(false);
  }
}

function updateCashPreview() {
  const amount = Number($('walletAmount').value) || 0;
  $('walletCashPreview').textContent = Number.isInteger(amount) && amount % 100 === 0
    ? (amount / 100).toLocaleString('ko-KR')
    : '0';
}

async function initializeAdmin(user) {
  currentUser = user;
  if (!user || user.isAnonymous) {
    authStatus.textContent = '로그인이 필요합니다';
    authButton.textContent = '관리자 로그인';
    setGate('관리자 계정으로 로그인하면 권한 확인을 시작합니다.', '관리자 로그인이 필요합니다');
    return;
  }
  authStatus.textContent = user.email || '관리자 계정 확인 중';
  authButton.textContent = '로그아웃';
  gateTitle.textContent = '관리자 권한 확인 중';
  gateMessage.textContent = '서버에서 관리자 계정과 충전 권한을 확인합니다.';
  gate.hidden = false;
  walletApp.hidden = true;
  try {
    if (bootstrapAdminUid) await bootstrapAdminUid();
    const result = await getWalletState();
    renderWallet(result.data);
  } catch (error) {
    console.error('관리자 인증 실패:', error);
    if (error.code === 'functions/permission-denied') setGate('이 계정은 관리자 전용 화면에 접근할 수 없습니다.');
    else setGate(`관리자 인증을 확인하지 못했습니다. 통합 관리 센터에서 관리자 uid 등록을 확인해 주세요. (${error.message || error})`);
  }
}

onAuthStateChanged(auth, initializeAdmin);

authButton.addEventListener('click', async () => {
  if (currentUser) {
    await signOut(auth);
    return;
  }
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (error) {
    console.error('관리자 Google 로그인 실패:', error);
    window.alert(`로그인에 실패했습니다. ${error.message || error}`);
  }
});

$('walletGateLogin').addEventListener('click', () => authButton.click());

$('walletAmount').addEventListener('input', updateCashPreview);
$('walletRefresh').addEventListener('click', refreshWallet);
$('walletOpenCharge').addEventListener('click', () => $('walletChargeModal').showModal());
$('walletCloseCharge').addEventListener('click', () => $('walletChargeModal').close());
$('walletChargeModal').addEventListener('click', (event) => {
  if (event.target === $('walletChargeModal')) $('walletChargeModal').close();
});

$('walletQrFile').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 100000) {
    $('walletQrStatus').textContent = 'JPEG, PNG, WebP 파일을 100KB 이하로 선택해 주세요.';
    event.target.value = '';
    return;
  }
  try {
    const qrDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      reader.readAsDataURL(file);
    });
    $('walletQrStatus').textContent = '관리자 전용 저장소에 등록하는 중입니다.';
    await saveQr({ qrDataUrl });
    $('walletQrStatus').textContent = '입금 QR을 관리자 전용 저장소에 저장했습니다.';
    await refreshWallet(true);
  } catch (error) {
    $('walletQrStatus').textContent = `QR 저장 실패: ${error.message || error}`;
  } finally {
    event.target.value = '';
  }
});

$('walletChargeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const amountKrw = Number($('walletAmount').value);
  const depositorName = $('walletDepositorName').value.trim();
  if (!$('walletChargePolicy').checked) {
    chargeStatus.textContent = '충전 운영 기준을 확인해 주세요.';
    return;
  }
  if (!Number.isSafeInteger(amountKrw) || amountKrw < 1000 || amountKrw % 100 !== 0) {
    chargeStatus.textContent = '1,000원 이상을 100원 단위로 입력해 주세요.';
    return;
  }
  if (amountKrw > Number(walletState?.todayRemainingKrw || 0)) {
    chargeStatus.textContent = '오늘 남은 신청 한도를 초과합니다.';
    return;
  }
  if (!depositorName) {
    chargeStatus.textContent = '입금자명을 입력해 주세요.';
    return;
  }
  if (!window.confirm(`${formatWon(amountKrw)} 입금 신청을 할까요? 신청만으로 캐시가 지급되지는 않습니다.`)) return;
  setBusy(true);
  chargeStatus.textContent = '충전 신청을 저장하고 있습니다.';
  try {
    await submitCharge({ requestId: createRequestId(), amountKrw, depositorName });
    $('walletAmount').value = '';
    $('walletChargePolicy').checked = false;
    chargeStatus.textContent = '신청을 접수했습니다. 실제 입금 확인 후 통합 관리 센터에서 검수됩니다.';
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
      amountKrw: Number($('walletSupportAmount').value) || 0,
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

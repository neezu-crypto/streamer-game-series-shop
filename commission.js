// 스트리머 게임 제작 의뢰(모금형) 화면. 2026-11-26.
// 가격·기간·특가·권한 판정은 서버(gameSeriesCommission*)가 하고, 화면은 같은 표로 미리 계산만 한다.
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { ensureAppCheck } from './app-check.js?v=20261114-ac1';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

const app = getApps().find((item) => item.name === '[DEFAULT]') || initializeApp({
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:cdddfe20075aa199a3a769',
});
ensureAppCheck(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');
const listFn = httpsCallable(functions, 'gameSeriesCommissionList');
const actionFn = httpsCallable(functions, 'gameSeriesCommissionAction', { timeout: 30000 });

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const MAX_KRW = 300000;
const GENRE_ORDER = ['roulette', 'viewer', 'card', 'board', 'escape', 'vn'];
const GENRE_DESC = {
  roulette: '룰렛 1종(항목 30개) · 테마·캐릭터 연출 · 방송 화면용',
  viewer: '예측·투표 방식 1종 · 시청자 점수판',
  card: '카드 20장 · 도감·뽑기 연출',
  board: '말판 24칸 · 이벤트 20개 · 2~4인',
  escape: '사건 1개(약 20~30분)',
  vn: '약 45분 분량',
};
const STATUS = {
  awaiting_streamer: '스트리머 동의 대기', funding: '모금 중', queued: '제작 대기', in_production: '제작 중',
  completed: '완성', failed: '모금 종료(반환 완료)', cancelled: '취소(반환 완료)',
};
const STAGE = { planning: '기획·대본', artwork: '그림 작업', assembly: '조립·검수', delivered: '전달 완료' };

const state = { data: null, genre: 'roulette', units: 0, tab: 'funding', busy: false };
const won = (krw) => `${(krw / 10000).toLocaleString('ko-KR')}만 원`;
const cashText = (c) => `${Number(c || 0).toLocaleString('ko-KR')}캐시`;
const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '-');
const newId = (prefix) => prefix + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = (e) => String((e && e.message) || e || '').replace(/^.*?: /, '') || '잠시 후 다시 시도해 주세요.';

function quote(genre, units, donation, promo) {
  const g = state.data && state.data.genres[genre];
  if (!g) return null;
  const krw = (promo ? g.promoKrw : g.regularKrw) + units * g.unitKrw + (donation ? 20000 : 0);
  let days = g.baseDays + Math.max(0, units - g.freeUnits) * g.daysPerUnit;
  if (g.maxDays && days > g.maxDays) return null;
  if (krw > MAX_KRW) return null;
  days += donation ? 14 : 0;
  const promoSpots = krw >= 100000 ? Math.min(500, Math.floor(krw / 50000) * 100 - 100) : 0;
  return { krw, days, promoSpots };
}
const promoAvailable = () => !!(state.data && state.data.promoLeft > 0);

// ---------- 로그인 ----------
function requireLogin() {
  const me = state.data && state.data.me;
  if (auth.currentUser && !auth.currentUser.isAnonymous) return true;
  if (me && me.isStreamer) return true;
  if (typeof window.openShopLoginModal === 'function') window.openShopLoginModal();
  return false;
}

async function call(payload) {
  const res = await actionFn(payload);
  return res.data;
}

// ---------- 불러오기 ----------
async function load() {
  try {
    const res = await listFn({});
    state.data = res.data;
  } catch (e) {
    $('cmFundingList').innerHTML = `<p class="cm-empty">목록을 불러오지 못했어요. ${esc(errText(e))}</p>`;
    return;
  }
  renderHead();
  renderGenres();
  renderForm();
  renderFunding();
  renderMine();
}

function renderHead() {
  const d = state.data;
  $('cmPromoLeft').textContent = d.promoLeft > 0 ? `오픈 특가 남은 자리 ${d.promoLeft}` : '오픈 특가 마감 · 정가 적용';
  $('cmPromoLeft').classList.toggle('cm-chip-hot', d.promoLeft > 0);
  const waitDays = Math.max(0, Math.ceil((d.nextStartAt - d.now) / DAY));
  $('cmQueueInfo').textContent = waitDays > 0 ? `지금 목표를 채우면 약 ${waitDays}일 뒤 제작 시작` : '지금 목표를 채우면 바로 제작 시작';
  const b = $('cmBalance');
  b.hidden = !d.me;
  if (d.me) b.innerHTML = `내 캐시 <strong>${cashText(d.me.balanceCash)}</strong> · <a href="customer-center.html?open=charge">충전</a>`;
}

// ---------- 신청서 ----------
function renderGenres() {
  const d = state.data;
  const promo = promoAvailable();
  $('cmGenres').innerHTML = GENRE_ORDER.map((key) => {
    const g = d.genres[key];
    const price = promo && g.promoKrw < g.regularKrw
      ? `<strong>${won(g.promoKrw)}</strong> <s>${won(g.regularKrw)}</s>`
      : `<strong>${won(promo ? g.promoKrw : g.regularKrw)}</strong>`;
    return `<label class="cm-genre${state.genre === key ? ' active' : ''}"><input type="radio" name="cmGenre" value="${key}"${state.genre === key ? ' checked' : ''}>
      <b>${esc(g.label)}</b><span class="cm-genre-price">${price}</span><small>${esc(GENRE_DESC[key])}</small><small>기본 ${g.baseDays}일</small></label>`;
  }).join('');
}

function renderForm() {
  const d = state.data;
  if (!d) return;
  const g = d.genres[state.genre];
  const donation = $('cmDonation').checked;
  const promo = promoAvailable();
  const q = quote(state.genre, state.units, donation, promo);
  $('cmUnitLabel').textContent = `추가: ${g.unitLabel}`;
  const extra = g.freeUnits ? `${g.freeUnits}개까지 기간 그대로, 이후 개당 +${g.daysPerUnit}일` : `개당 +${g.daysPerUnit}일`;
  $('cmUnitPrice').textContent = `개당 +${won(g.unitKrw)} · ${extra}`;
  $('cmUnits').textContent = String(state.units);
  $('cmMinus').disabled = state.units <= 0;
  $('cmPlus').disabled = !quote(state.genre, state.units + 1, donation, false);
  if (!q) { state.units = Math.max(0, state.units - 1); return renderForm(); }
  $('cmSumPrice').textContent = `${won(q.krw)} (${cashText(q.krw / 100)})`;
  const reg = quote(state.genre, state.units, donation, false);
  $('cmSumRegular').textContent = promo && reg && reg.krw !== q.krw ? `오픈 특가 적용 · 정가 ${won(reg.krw)}` : '정가';
  $('cmSumDays').textContent = donation ? `최대 ${q.days}일` : `${q.days}일`;
  $('cmSumPromo').textContent = q.promoSpots ? `${q.promoSpots}곳` : '없음';
  const me = d.me;
  const isStreamer = !!(me && me.isStreamer);
  $('cmOwnAvatarWrap').hidden = !isStreamer;
  $('cmTargetWrap').hidden = isStreamer;
  $('cmSelfTarget').hidden = !isStreamer;
  if (isStreamer) $('cmSelfTarget').textContent = `인증 스트리머 ${me.streamerNickname || ''} 님 본인 게임으로 신청돼요. 신청하면 바로 모금이 열려요.`;
}

$('cmGenres').addEventListener('change', (e) => {
  if (e.target.name !== 'cmGenre') return;
  state.genre = e.target.value; state.units = 0;
  renderGenres(); renderForm();
});
$('cmMinus').addEventListener('click', () => { state.units = Math.max(0, state.units - 1); renderForm(); });
$('cmPlus').addEventListener('click', () => { state.units += 1; renderForm(); });
$('cmDonation').addEventListener('change', renderForm);

$('cmForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const status = $('cmFormStatus');
  const me = state.data && state.data.me;
  if (!requireLogin()) { status.textContent = '로그인하면 이어서 신청할 수 있어요. 입력한 내용은 그대로 남아 있어요.'; return; }
  const title = $('cmTitle').value.trim(); const pitch = $('cmPitch').value.trim(); const description = $('cmDesc').value.trim();
  if (!title || !pitch || !description) { status.textContent = '제목·한 줄 소개·내용을 모두 적어 주세요.'; return; }
  const targetSoopId = $('cmTargetId').value.trim().toLowerCase();
  if (!(me && me.isStreamer) && !/^[a-z0-9]{2,20}$/.test(targetSoopId)) { status.textContent = '받을 스트리머를 검색해서 골라 주세요.'; return; }
  if (!$('cmConsentCopy').checked || !$('cmConsentRules').checked) { status.textContent = '필수 동의 두 가지를 체크해 주세요.'; return; }
  state.busy = true; $('cmSubmit').disabled = true; status.textContent = '신청하는 중…';
  const form = $('cmForm');
  form.dataset.requestId = form.dataset.requestId || newId('cm_');
  try {
    const r = await call({
      action: 'create', requestId: form.dataset.requestId, genre: state.genre, units: state.units,
      donation: $('cmDonation').checked, ownAvatar: $('cmOwnAvatar').checked,
      style: { art: $('cmArt').value, mood: $('cmMood').value },
      title, pitch, description, targetSoopId,
      consents: { noCopy: true, rules: true },
    });
    delete form.dataset.requestId;
    form.reset(); state.units = 0;
    status.innerHTML = r.status === 'funding'
      ? `신청 완료(번호 ${esc(r.shortCode)}). 모금이 열렸어요! 방송에서 시청자에게 알려 주세요.`
      : `신청 완료(번호 ${esc(r.shortCode)}). <strong>${esc(r.target.nickname)}</strong> 님이 SOOP 쪽지로 동의하면 모금이 열려요. 스트리머에게 신청 번호를 알려 주세요.`;
    await load();
  } catch (err) {
    if (/로그인|unauthenticated/i.test(String(err && (err.code || err.message)))) { window.openShopLoginModal?.(); }
    status.textContent = errText(err);
  } finally {
    state.busy = false; $('cmSubmit').disabled = false;
  }
});

// ---------- 모금 목록 ----------
function card(item, { mine = false } = {}) {
  const pct = Math.min(100, Math.round(((item.raisedCash || 0) / item.priceCash) * 100));
  const myCash = (state.data.myDonations || {})[item.id] || 0;
  const left = item.fundingDeadlineAt ? Math.max(0, Math.ceil((item.fundingDeadlineAt - state.data.now) / DAY)) : 0;
  const lines = [];
  if (item.status === 'funding') lines.push(`모금 마감까지 ${left}일 · 후원 ${item.donorCount}명`, `지금 채우면 ${dateText(item.estStartAt)}쯤 제작 시작`);
  if (item.status === 'queued') lines.push(`제작 대기 ${item.queuePos}번째 · ${dateText(item.estStartAt)}쯤 시작 예정`);
  if (item.status === 'in_production') lines.push(`${STAGE[item.stage] || '제작'} 단계 · ${dateText(item.dueAt)}까지 전달 예정`);
  if (item.status === 'awaiting_streamer') lines.push(`${esc(item.target.nickname)} 님의 SOOP 쪽지 동의를 기다리고 있어요(신청 번호 ${esc(item.shortCode)}).`);
  if (mine && item.closeReason) lines.push(`${esc(item.closeReason)} · 반환 ${cashText(item.refundedCash)}`);
  const tags = [item.genreLabel, item.units ? `+옵션 ${item.units}` : '', item.donation ? '후원 연동' : '', item.isPromo ? '오픈 특가' : '', item.ownAvatar ? '본인 아바타' : ''].filter(Boolean);
  let actions = '';
  if (item.status === 'funding') {
    const remain = item.priceCash - (item.raisedCash || 0);
    actions += `<div class="cm-donate"><input type="number" inputmode="numeric" min="10" step="10" max="${remain}" value="${Math.min(100, remain)}" aria-label="후원할 캐시"><button type="button" class="cm-primary" data-act="donate" data-id="${item.id}">캐시 후원</button></div>`;
    if (myCash) actions += `<button type="button" class="cm-ghost" data-act="cancelDonation" data-id="${item.id}">내 후원 ${cashText(myCash)} 취소</button>`;
  } else if (myCash) actions += `<p class="cm-mini">내 후원 ${cashText(myCash)}</p>`;
  if (mine && ['awaiting_streamer', 'funding', 'queued'].includes(item.status)) actions += `<button type="button" class="cm-ghost" data-act="cancelRequest" data-id="${item.id}">신청 취소(전액 반환)</button>`;
  return `<article class="cm-card" data-card="${item.id}">
    <div class="cm-card-top"><span class="cm-status-badge s-${item.status}">${STATUS[item.status] || item.status}</span><span class="cm-tags">${tags.map((t) => `<i>${esc(t)}</i>`).join('')}</span></div>
    <h3>${esc(item.title)}</h3>
    <p class="cm-target">🎙️ ${esc(item.target.nickname)} <small>(${esc(item.target.soopId)})</small></p>
    <p>${esc(item.pitch)}</p>
    <div class="cm-progress"><span style="width:${pct}%"></span></div>
    <p class="cm-amount"><strong>${cashText(item.raisedCash)}</strong> / ${cashText(item.priceCash)} (${pct}%) · 기간 ${item.days}일</p>
    ${lines.map((l) => `<p class="cm-mini">${l}</p>`).join('')}
    <div class="cm-actions">${actions}</div>
    <p class="cm-status cm-card-status" role="status"></p>
  </article>`;
}

function renderFunding() {
  const items = state.data.items;
  $('cmFundingList').innerHTML = items.length ? items.map((x) => card(x)).join('') : '<p class="cm-empty">아직 열린 모금이 없어요. 첫 신청의 주인공이 되어 보세요!</p>';
}
function renderMine() {
  const d = state.data;
  if (!d.me) { $('cmMineList').innerHTML = '<p class="cm-empty">로그인하면 내 신청이 보여요.</p>'; return; }
  $('cmMineList').innerHTML = d.mine.length ? d.mine.map((x) => card(x, { mine: true })).join('') : '<p class="cm-empty">아직 신청한 게임이 없어요.</p>';
}

// 버튼 하나로 두 번 눌러 확정(브라우저 확인 창을 쓰지 않음).
const armed = new WeakMap();
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || state.busy) return;
  const cardEl = btn.closest('.cm-card');
  const msg = cardEl.querySelector('.cm-card-status');
  if (!requireLogin()) { msg.textContent = '로그인하면 이어서 진행할 수 있어요.'; return; }
  const act = btn.dataset.act; const id = btn.dataset.id;
  const payload = { action: act, id };
  if (act === 'donate') {
    const cash = Math.floor(Number(cardEl.querySelector('.cm-donate input').value) || 0);
    if (cash <= 0) { msg.textContent = '후원할 캐시를 적어 주세요.'; return; }
    const bal = state.data.me ? state.data.me.balanceCash : 0;
    if (state.data.me && bal < cash) { msg.innerHTML = `캐시가 부족해요(보유 ${cashText(bal)}). <a href="customer-center.html?open=charge">충전하기</a>`; return; }
    payload.cash = cash;
    btn.dataset.donationId = btn.dataset.donationId || newId('cd_');
    payload.donationId = btn.dataset.donationId;
  }
  if (!armed.get(btn)) {
    armed.set(btn, true);
    const label = btn.textContent;
    btn.textContent = act === 'donate' ? `${cashText(payload.cash)} 후원 확정` : '한 번 더 누르면 취소돼요';
    setTimeout(() => { armed.delete(btn); btn.textContent = label; }, 4000);
    return;
  }
  armed.delete(btn);
  state.busy = true; btn.disabled = true; msg.textContent = '처리 중…';
  try {
    const r = await call(payload);
    msg.textContent = act === 'donate' ? (r.funded ? '후원 완료! 목표를 채워 제작 대기열에 들어갔어요.' : `후원 완료! (${cashText(r.cash)})`) : `취소했어요. ${cashText(r.refundedCash)}를 돌려드렸어요.`;
    setTimeout(load, 1200);
  } catch (err) {
    msg.textContent = errText(err);
    btn.disabled = false;
  } finally { state.busy = false; }
});

// ---------- 탭 ----------
function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.cm-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('cmPanelFunding').hidden = tab !== 'funding';
  $('cmPanelApply').hidden = tab !== 'apply';
  $('cmPanelMine').hidden = tab !== 'mine';
}
document.querySelectorAll('.cm-tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
const initialTab = new URLSearchParams(location.search).get('tab');
if (['apply', 'mine', 'funding'].includes(initialTab)) showTab(initialTab);
const initialGenre = new URLSearchParams(location.search).get('genre');
if (GENRE_ORDER.includes(initialGenre)) state.genre = initialGenre;

// 받을 스트리머 SOOP 검색(로그인 모달과 같은 검색 위젯). shop-login.js가 불러온 뒤 붙인다.
const searchFn = httpsCallable(functions, 'streamerFanPageVerifySearch');
(function attachTargetSearch(tries = 0) {
  if (!window.attachSoopVerifySearch) { if (tries < 40) setTimeout(() => attachTargetSearch(tries + 1), 250); return; }
  window.attachSoopVerifySearch({
    nicknameInput: 'cmTargetNick', soopIdInput: 'cmTargetId',
    search: async (query) => {
      if (!auth.currentUser) { window.openShopLoginModal?.(); throw new Error('로그인 후 검색할 수 있어요.'); }
      const r = await searchFn({ query });
      return (r.data && r.data.streamers) || [];
    },
  });
})();

let lastUid = null;
onAuthStateChanged(auth, (user) => { const uid = user ? user.uid : ''; if (uid !== lastUid) { lastUid = uid; load(); } });
window.addEventListener('shop-auth-changed', () => load());

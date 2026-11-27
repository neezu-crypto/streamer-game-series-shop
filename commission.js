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
const GENRE_ORDER = ['roulette', 'viewer', 'quiz', 'penalty', 'card', 'board', 'escape', 'vn'];
const GENRE_DESC = {
  roulette: '룰렛 1종(항목 30개) · 테마·캐릭터 연출 · 방송 화면용',
  viewer: '예측·투표 방식 1종 · 시청자 점수판',
  quiz: '문제 20개(최대 50개, 객관식·OX) · 시청자 채팅 정답·점수판',
  card: '카드 20장 · 도감·뽑기 연출',
  board: '말판 24칸 · 이벤트 20개 · 2~4인',
  escape: '사건 1개(약 20~30분)',
  penalty: '고난도 스테이지 6개 · 실패 연출·시청자 구경 화면',
  vn: '약 45분 분량',
};
const STATUS = {
  awaiting_streamer: '스트리머 동의 대기', funding: '모금 중', queued: '제작 대기', in_production: '제작 중',
  completed: '완성', failed: '모금 종료(반환 완료)', cancelled: '취소(반환 완료)',
};
const STAGE = { planning: '기획·대본', artwork: '그림 작업', assembly: '조립·검수', delivered: '전달 완료' };

// genre '' = 장르 미선택(주소에 genre=가 없을 때). 고르기 전에는 옵션·요약·신청 버튼이 잠긴다.
const state = { data: null, genre: '', units: 0, promoUnits: 0, tab: 'funding', busy: false };
const won = (krw) => `${(krw / 10000).toLocaleString('ko-KR')}만 원`;
const cashText = (c) => `${Number(c || 0).toLocaleString('ko-KR')}캐시`;
const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '-');
const newId = (prefix) => prefix + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errText = (e) => String((e && e.message) || e || '').replace(/^.*?: /, '') || '잠시 후 다시 시도해 주세요.';

// 서버 quote(functions/commission.js)와 같은 계산. 최종 금액은 서버가 다시 계산한다.
function quote(genre, units, donation, promo, multi = false, players = 0, promoUnits = 0) {
  const d = state.data; const g = d && d.genres[genre];
  if (!g) return null;
  const M = d.multiOption; const P = d.promoOption;
  if (g.maxUnits !== undefined && units > g.maxUnits) return null;
  if (multi && genre === 'vn') return null;
  let baseKrw = promo ? g.promoKrw : g.regularKrw; let baseDays = g.baseDays;
  if (multi) {
    if (genre === 'roulette') { baseKrw += M.rouletteKrw; baseDays += M.rouletteDays; }
    else { baseKrw = Math.ceil((baseKrw * (1 + M.rate)) / 1000) * 1000; baseDays = Math.ceil(baseDays * (1 + M.rate)); }
  }
  let days = baseDays + Math.max(0, units - g.freeUnits) * g.daysPerUnit;
  if (g.maxDays && days > g.maxDays) return null;
  const donationKrw = donation ? (multi ? M.donationKrw : 20000) : 0;
  days += donation ? (multi ? M.donationDays : 14) : 0;
  const productionKrw = baseKrw + units * g.unitKrw + donationKrw;
  if (productionKrw > MAX_KRW || promoUnits > P.maxUnits) return null;
  const promoKrw = promoUnits * P.unitKrw;
  return { productionKrw, promoKrw, krw: productionKrw + promoKrw, days, promoSpots: promoUnits * P.unitSpots, promoDays: promoUnits * P.daysPerUnit };
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
  if ($('cmArt').dataset.genre !== state.genre) { renderStyles(); $('cmArt').dataset.genre = state.genre; }
  renderForm();
  renderFunding();
  renderMine();
}

function renderHead() {
  const d = state.data;
  const roundOpen = d.roundLeft > 0;
  $('cmRoundLeft').textContent = roundOpen ? `${d.round}차 모집 남은 신청 ${d.roundLeft}/${d.roundSlots}` : `${d.round}차 모집 마감`;
  $('cmRoundLeft').classList.toggle('cm-chip-hot', roundOpen);
  $('cmRoundClosed').hidden = roundOpen;
  $('cmRoundClosed').textContent = `${d.round}차 공개 모금은 신청 ${d.roundSlots}건을 모두 받았어요. 다음 모집은 제작 상황을 보고 가격을 다시 정해 열어요. 지금 열린 모금에는 계속 후원할 수 있어요.`;
  $('cmForm').hidden = !roundOpen;
  $('cmPromoLeft').hidden = !roundOpen;
  $('cmPromoLeft').hidden = !(d.promoLeft > 0); // 오픈 특가 폐지(2026-11-27): 자리가 없으면 표시하지 않음
  $('cmPromoLeft').textContent = `오픈 특가 남은 자리 ${d.promoLeft}`;
  $('cmPromoLeft').classList.toggle('cm-chip-hot', d.promoLeft > 0);
  const waitDays = Math.max(0, Math.ceil((d.nextStartAt - d.now) / DAY));
  $('cmQueueInfo').textContent = waitDays > 0 ? `지금 목표를 채우면 약 ${waitDays}일 뒤 제작 시작` : '지금 목표를 채우면 바로 제작 시작';
  const b = $('cmBalance');
  b.hidden = !d.me;
  if (d.me) b.innerHTML = `내 캐시 <strong>${cashText(d.me.balanceCash)}</strong> · <a href="customer-center.html?open=charge">충전</a>`;
}

// ---------- 게임 제작 이력(정적 목록, 서버·DB 호출 없음) ----------
// status: 'open'(운영 중) | 'paused'(점검 중). paused는 previewReady(메인만 보기 적용)일 때만 [둘러보기] 링크를 연다.
// 운영 상태가 바뀌면 이 목록을 고친다(관리센터 서비스 일시정지 화면 기준).
const PORTFOLIO = [
  { name: '당신이 여기에 온 이유', desc: '스트리머 이야기를 담은 미연시', img: 'assets/portfolio/onyu.webp', url: 'https://neezu-crypto.github.io/onyu-vn/', status: 'open' },
  { name: '다마고치 분양소', desc: '펫 분양·육성', img: 'assets/portfolio/tamagotchi.webp', url: 'tamagotchi.html', status: 'open' },
  { name: '스트리머 배팅시장', desc: '시청자 참여 예측 게임', img: 'assets/portfolio/betting.webp', url: 'https://neezu-crypto.github.io/StreamBet-Market/', status: 'paused', previewReady: true },
  { name: '스트리머 주식시장', desc: '시청자 참여 주식 게임', img: 'assets/portfolio/stock.webp', url: 'https://neezu-crypto.github.io/soop-stock-market/', status: 'paused', previewReady: true },
  { name: '스트리머 인생게임', desc: '시청자 참여 게임', img: 'assets/portfolio/life.webp', url: 'https://neezu-crypto.github.io/streamer-life-game/', status: 'paused', previewReady: true },
  { name: '스트리머 주루마블', desc: '보드게임', img: 'assets/portfolio/jurumable.webp', url: 'https://neezu-crypto.github.io/streamer-jurumable/', status: 'paused', previewReady: true },
];
const SERVICES = [
  { name: '스트리머 팬페이지', desc: '인증 스트리머별 팬 페이지', img: 'assets/portfolio/fanpage.webp', url: 'https://neezu-crypto.github.io/streamer-fanpage/', status: 'open' },
  { name: '스트리머 고점체크', desc: '다시보기 시청 흐름 분석', img: 'assets/portfolio/viewerstats.webp', url: 'https://neezu-crypto.github.io/streamer-fanpage/viewer-stats.html', status: 'open' },
  { name: '스트리머 갤러리', desc: '팬아트·사진 공유', img: 'assets/portfolio/gallery.webp', url: 'https://neezu-crypto.github.io/streamer-gallery/', status: 'open' },
  { name: '스트리머 메신저', desc: '스트리머 채팅방', img: 'assets/portfolio/messenger.webp', url: 'https://neezu-crypto.github.io/streamer-messenger/', status: 'open' },
  { name: '게임시리즈 통합상점', desc: '스티커·캐시·게임 제작 의뢰', img: 'assets/portfolio/shop.webp', url: './', status: 'open' },
];
function renderPortfolio() {
  renderPortfolioList('cmPortfolio', PORTFOLIO);
  renderPortfolioList('cmServices', SERVICES);
}
function renderPortfolioList(id, list) {
  $(id).innerHTML = list.map((p) => {
    const open = p.status === 'open';
    const canView = open || p.previewReady;
    const art = p.img ? `<img src="${esc(p.img)}?v=20261127b" alt="" width="480" height="300" loading="lazy" decoding="async">` : `<span class="cm-portfolio-emoji" aria-hidden="true">${p.emoji || '🎮'}</span>`;
    const badge = open ? '<span class="cm-badge open">운영 중</span>' : `<span class="cm-badge paused">${p.previewReady ? '점검 중 · 둘러보기만 가능' : '점검 중'}</span>`;
    const ext = /^https?:/.test(p.url);
    const link = canView ? `<a class="cm-portfolio-go" href="${esc(p.url)}"${ext ? ' target="_blank" rel="noopener"' : ''}>둘러보기</a>` : '';
    return `<article class="cm-portfolio-card"><div class="cm-portfolio-art">${art}</div><div class="cm-portfolio-body"><b>${esc(p.name)}</b><small>${esc(p.desc)}</small>${badge}${link}</div></article>`;
  }).join('');
}
renderPortfolio();

// ---------- 신청서 ----------
// 장르별 그림체·분위기 선택지(서버 styles). 장르를 바꾸면 첫 항목으로 돌아간다.
function renderStyles() {
  const st = state.data.styles && state.data.styles[state.genre];
  if (!st) return;
  const fill = (sel, list) => { sel.innerHTML = list.map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`).join(''); sel.value = list[0][0]; };
  fill($('cmArt'), st.art); fill($('cmMood'), st.mood);
  // 퀴즈 주제는 주제 목록이 있는 장르(퀴즈쇼)만 보인다.
  $('cmTopicWrap').hidden = !st.topic; if (st.topic) fill($('cmTopic'), st.topic);
}

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
  $('cmSubmit').disabled = !g || state.busy;
  document.querySelectorAll('#cmForm [data-needs-genre]').forEach((el) => { el.hidden = !g; });
  const hint = document.querySelector('#cmForm [data-genre-hint]'); if (hint) hint.hidden = !!g;
  if (!g) {
    ['cmSumProduction', 'cmSumPromo', 'cmSumPrice', 'cmSumDays'].forEach((id) => { $(id).textContent = '-'; });
    $('cmSumRegular').textContent = '장르를 골라 주세요'; $('cmSumPromoNote').textContent = ''; $('cmSumCash').textContent = '';
    $('cmMultiWrap').hidden = true; $('cmPlayersWrap').hidden = true;
    const me0 = d.me; const st0 = !!(me0 && me0.isStreamer);
    $('cmOwnAvatarWrap').hidden = !st0; $('cmTargetWrap').hidden = st0; $('cmSelfTarget').hidden = !st0;
    return;
  }
  const canMulti = state.genre !== 'vn';
  if (!canMulti) $('cmMulti').checked = false;
  $('cmMultiWrap').hidden = !canMulti;
  const multi = $('cmMulti').checked;
  $('cmPlayersWrap').hidden = !multi;
  $('cmMultiNote').textContent = state.genre === 'roulette' ? '합방용 공유 화면 · +1만 원 · 기간 +3일 · 2~4명' : '기본가·기본 기간 +50% · 2~4명 · 차례·점수 대결·협동 방식(실시간 대전 제외)';
  $('cmDonationNote').textContent = multi
    ? '+4만 원 · 기간 +14~21일(SOOP 심사). 참여 스트리머 모두 각자 방송 후원으로 게임 이벤트를 일으킬 수 있어요.'
    : '+2만 원 · 기간 +7~14일(SOOP 심사). 별풍선 후원으로 게임 안 이벤트가 일어나요.';
  const players = Number($('cmPlayers').value) || 2;
  const donation = $('cmDonation').checked;
  const promo = promoAvailable();
  const pu = state.promoUnits;
  const q = quote(state.genre, state.units, donation, promo, multi, players, pu);
  $('cmUnitLabel').textContent = `추가: ${g.unitLabel}`;
  const extra = g.freeUnits ? `${g.freeUnits}개까지 기간 그대로, 이후 개당 +${g.daysPerUnit}일` : `개당 +${g.daysPerUnit}일`;
  $('cmUnitPrice').textContent = `개당 +${won(g.unitKrw)} · ${extra}`;
  $('cmUnits').textContent = String(state.units);
  $('cmMinus').disabled = state.units <= 0;
  $('cmPlus').disabled = !quote(state.genre, state.units + 1, donation, false, multi, players, 0);
  $('cmPromoUnits').textContent = `${pu * d.promoOption.unitSpots}곳`;
  $('cmPromoMinus').disabled = pu <= 0;
  $('cmPromoPlus').disabled = pu >= d.promoOption.maxUnits;
  if (!q) {
    if (state.units > 0) { state.units -= 1; return renderForm(); }
    if (donation) { $('cmDonation').checked = false; return renderForm(); }
    return;
  }
  $('cmSumProduction').textContent = won(q.productionKrw);
  const reg = quote(state.genre, state.units, donation, false, multi, players, 0);
  $('cmSumRegular').textContent = promo && reg && reg.productionKrw !== q.productionKrw ? `오픈 특가 적용 · 정가 ${won(reg.productionKrw)}` : '정가';
  $('cmSumPromo').textContent = q.promoKrw ? won(q.promoKrw) : '없음';
  $('cmSumPromoNote').textContent = q.promoKrw ? `${q.promoSpots}곳 · 완성 후 최대 ${q.promoDays}일` : '선택 안 함';
  $('cmSumPrice').textContent = won(q.krw);
  $('cmSumCash').textContent = cashText(q.krw / 100);
  $('cmSumDays').textContent = donation ? `최대 ${q.days}일` : `${q.days}일`;
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
  renderGenres(); renderStyles(); $('cmArt').dataset.genre = state.genre; renderForm();
});
$('cmMinus').addEventListener('click', () => { state.units = Math.max(0, state.units - 1); renderForm(); });
$('cmPlus').addEventListener('click', () => { state.units += 1; renderForm(); });
$('cmDonation').addEventListener('change', renderForm);
$('cmMulti').addEventListener('change', renderForm);
$('cmPlayers').addEventListener('change', renderForm);
$('cmPromoMinus').addEventListener('click', () => { state.promoUnits = Math.max(0, state.promoUnits - 1); renderForm(); });
$('cmPromoPlus').addEventListener('click', () => { state.promoUnits = Math.min(state.data.promoOption.maxUnits, state.promoUnits + 1); renderForm(); });

$('cmForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const status = $('cmFormStatus');
  const me = state.data && state.data.me;
  if (!requireLogin()) { status.textContent = '로그인하면 이어서 신청할 수 있어요. 입력한 내용은 그대로 남아 있어요.'; return; }
  const title = $('cmTitle').value.trim(); const pitch = $('cmPitch').value.trim(); const description = $('cmDesc').value.trim();
  if (!state.data.genres[state.genre]) { status.textContent = '장르를 먼저 골라 주세요.'; return; }
  if (!title || !pitch || !description) { status.textContent = '제목·한 줄 소개·내용을 모두 적어 주세요.'; return; }
  const targetSoopId = $('cmTargetId').value.trim().toLowerCase();
  if (!(me && me.isStreamer) && !/^[a-z0-9]{2,20}$/.test(targetSoopId)) { status.textContent = '받을 스트리머를 검색해서 골라 주세요.'; return; }
  if (!$('cmConsentCopy').checked || !$('cmConsentWeb').checked || !$('cmConsentRules').checked) { status.textContent = '필수 동의 세 가지를 모두 체크해 주세요.'; return; }
  state.busy = true; $('cmSubmit').disabled = true; status.textContent = '신청하는 중…';
  const form = $('cmForm');
  form.dataset.requestId = form.dataset.requestId || newId('cm_');
  try {
    const r = await call({
      action: 'create', requestId: form.dataset.requestId, genre: state.genre, units: state.units,
      donation: $('cmDonation').checked, ownAvatar: $('cmOwnAvatar').checked,
      style: { art: $('cmArt').value, mood: $('cmMood').value, ...($('cmTopicWrap').hidden ? {} : { topic: $('cmTopic').value }) },
      title, pitch, description, targetSoopId,
      multi: $('cmMulti').checked, players: Number($('cmPlayers').value) || 2, promoUnits: state.promoUnits,
      consents: { noCopy: true, rules: true, webOnly: true },
    });
    delete form.dataset.requestId;
    form.reset(); state.units = 0; state.promoUnits = 0;
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
  if (item.status === 'completed' && item.promoStatus === 'pending') lines.push(`완성 · 대신 홍보 ${item.promoSpots}곳 진행 중`);
  if (item.status === 'awaiting_streamer') lines.push(`${esc(item.target.nickname)} 님의 SOOP 쪽지 동의를 기다리고 있어요(신청 번호 ${esc(item.shortCode)}).`);
  if (mine && item.closeReason) lines.push(`${esc(item.closeReason)} · 반환 ${cashText(item.refundedCash)}`);
  const tags = [item.genreLabel, item.units ? `+옵션 ${item.units}` : '', item.multi ? `멀티 ${item.players}명` : '', item.donation ? '후원 연동' : '', item.promoSpots ? `홍보 ${item.promoSpots}곳` : '', item.isPromo ? '오픈 특가' : '', item.ownAvatar ? '본인 아바타' : ''].filter(Boolean);
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

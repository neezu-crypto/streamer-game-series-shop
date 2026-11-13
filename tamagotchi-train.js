// 훈련소 패널(월드맵 장소). 내 다마고치 고르기 → 무대에서 체험 → 배울 재주 고르기 → 합계·환불 불가 확인 → 결제.
// 가격·판매 여부·배운 목록은 서버 응답만 믿는다. 체험은 서버를 부르지 않는다.
import { createToolController, TOOLS } from './tamagotchi-tools.js?v=20261113-tg-opt1';
import { createSound } from './tamagotchi-sound.js?v=20261113-tg-opt1';
import { createMongsil } from './tamagotchi-pet.js?v=20261113-tg-opt1';
import { createScene } from './tamagotchi-scene.js?v=20261113-tg-trainm1';
import {
  resolveTrainState, trainTotal, learnableIds, trainSignature, getTrainRequestId, clearRequestId,
  shouldDiscardRequestId, trainErrorMessage, farmUrl, COLOR_LABELS,
} from './tamagotchi-logic.mjs?v=20261113-tg-world1';

const REQUEST_KEY = 'tamagotchiTrainRequest';
const ADMIN_TARGET_KEY = 'tamagotchiTrainAdminTarget';
const STREAMER_RE = /^[a-z0-9_-]{1,64}$/;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 받침 유무로 조사 고르기(을/를, 은/는)
function josa(word, withFinal, withoutFinal) {
  const c = String(word || '').trim().slice(-1).charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return withoutFinal;
  return (c - 0xac00) % 28 ? withFinal : withoutFinal;
}

export function mountTrainPanel(host, ctx) {
  const { shopCall, reduced, cashText } = ctx;
  const st = { flow: '', streamerId: '', pets: [], petId: '', selected: new Set(), busy: false, loading: false, error: '', destroyed: false };
  let petApi = null; let toolCtl = null; let scene = null; let sound = null;

  const root = el('div', 'tw-train');
  const who = el('div', 'tw-train-who');
  const petsRow = el('div', 'tw-train-pets'); petsRow.setAttribute('role', 'radiogroup'); petsRow.setAttribute('aria-label', '훈련할 다마고치');
  const stage = el('section', 'tg-stage tw-train-stage'); stage.setAttribute('aria-label', '훈련소 무대');
  const petBox = el('div', 'tg-stage-pet');
  const bubble = el('p', 'tg-bubble'); bubble.setAttribute('role', 'status'); bubble.setAttribute('aria-live', 'polite');
  const soundBtn = el('button', 'tg-sound-btn'); soundBtn.type = 'button';
  const medal = el('div', 'tw-medal'); medal.setAttribute('aria-hidden', 'true'); medal.hidden = true;
  const medalImg = document.createElement('img'); medalImg.alt = ''; medalImg.src = new URL('assets/tamagotchi/train/train-medal.webp', import.meta.url).href;
  medalImg.addEventListener('error', () => { medalImg.replaceWith(el('span', 'tw-medal-emoji', '🏅')); }, { once: true });
  medal.append(medalImg);
  stage.append(petBox, medal, soundBtn, bubble);
  const learnedRow = el('div', 'tw-train-learned');
  const grid = el('div', 'tw-train-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '배울 수 있는 재주');
  const summary = el('div', 'tw-train-summary');
  const status = el('p', 'tg-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const adminBox = el('div', 'tw-train-admin'); adminBox.hidden = true;
  root.append(who, petsRow, stage, learnedRow, grid, summary, status, adminBox);
  host.append(root);

  // ---------- 공용 ----------
  const viewer = () => ctx.server?.viewer || {};
  const species = (id) => (ctx.server?.species || []).find((s) => s.id === id) || null;
  const pubSpecies = (id) => (ctx.publicSpecies || []).find((s) => s.id === id) || null;
  const currentPet = () => st.pets.find((p) => p.petId === st.petId) || null;
  const interactionOf = (pet, id) => (pubSpecies(pet?.speciesId)?.interactions || []).find((i) => i.id === id) || null;
  const label = (pet, id) => interactionOf(pet, id)?.label || TOOLS[id]?.label || id;
  const setBubble = (text) => { bubble.textContent = text; };
  const IDLE = '재주 카드를 누르면 미리 해 볼 수 있어요';

  // ---------- 무대(펫·도구 체험) ----------
  function ensureStage(pet) {
    if (!pet) return;
    if (!petApi) {
      sound = createSound();
      petApi = createMongsil(petBox, { color: pet.color, reduced });
      // 좁은 무대는 세로형 훈련실(1200×1000) 그림·좌표를 쓴다. petUnits는 매트 폭 대비 데스크탑과 같은 비율.
      const TRAIN_M = { w: 1200, h: 1000, seat: [600, 800], petUnits: 510 };
      const narrow = () => { const r = stage.getBoundingClientRect(); const m = r.width > 0 && r.width / Math.max(1, r.height) < 1.4; stage.classList.toggle('is-narrow', m); return m; };
      scene = createScene({ stage, pet: petBox, reduced, maxPetRatio: 0.5, home: () => (narrow() ? TRAIN_M : null) });
      toolCtl = createToolController({ stage, petApi, petEl: petBox, ignoreOutside: [grid], reduced, sound, onChange: onTool });
      stage.classList.add('has-home');
      renderSound();
      soundBtn.addEventListener('click', () => { sound.setEnabled(!sound.enabled()); renderSound(); });
    } else petApi.setColor(pet.color);
    requestAnimationFrame(() => scene?.alignHome());
  }
  function renderSound() { const on = sound?.enabled(); soundBtn.textContent = on ? '🔊 소리' : '🔇 소리'; soundBtn.setAttribute('aria-pressed', String(!!on)); }
  function onTool(event) {
    const pet = currentPet();
    if (event.type === 'select') setBubble(`${label(pet, event.tool)} 체험 중 — ${TOOLS[event.tool]?.hint || ''}`);
    if (event.type === 'clear') { setBubble(IDLE); scene?.setBath(false); }
    if (event.type === 'select') scene?.setBath(event.tool === 'bath');
    if (event.type === 'act') setBubble(`${TOOLS[event.tool]?.done || label(pet, event.tool)} ${event.count}`);
    if (event.type === 'hold') setBubble(`${TOOLS[event.tool]?.done || ''} (${Math.floor(event.total / 1000)}초)`);
    if (event.type === 'holdDone') setBubble('😊');
    if (event.type === 'walk' && event.meters > 0) setBubble(`산책 체험 중… ${event.meters}m`);
    syncTrial();
  }
  function syncTrial() {
    const sel = toolCtl?.selected() || '';
    grid.querySelectorAll('[data-try]').forEach((b) => { const on = b.dataset.try === sel; b.classList.toggle('is-trying', on); b.setAttribute('aria-pressed', String(on)); });
  }
  const onResize = () => requestAnimationFrame(() => scene?.alignHome());
  window.addEventListener('resize', onResize);

  // ---------- 그리기 ----------
  function render() {
    if (st.destroyed) return;
    st.flow = resolveTrainState({ isAnonymous: ctx.user?.isAnonymous !== false, viewer: viewer() });
    renderWho();
    const pet = currentPet();
    const ready = !!pet && !st.loading && !st.error;
    stage.hidden = !ready; learnedRow.hidden = !ready; grid.hidden = !ready; summary.hidden = !ready;
    if (ready) { ensureStage(pet); renderPets(); renderLearned(pet); renderGrid(pet); renderSummary(pet); } else { petsRow.replaceChildren(); if (st.pets.length) renderPets(); }
    renderAdmin(pet);
  }

  function renderWho() {
    const box = [];
    if (st.flow === 'login') {
      const go = el('button', 'tg-button tg-button-primary', '로그인하기'); go.type = 'button';
      go.addEventListener('click', () => ctx.openLogin());
      box.push(el('p', 'tw-train-lead', '훈련은 다마고치를 분양받은 인증 스트리머가 할 수 있어요. 로그인하면 이어서 진행할게요.'), go);
    } else if (st.flow === 'verify') {
      const go = el('button', 'tg-button tg-button-primary', '스트리머 인증하기'); go.type = 'button';
      go.addEventListener('click', () => ctx.openLogin({ streamer: true }));
      box.push(el('p', 'tw-train-lead', '훈련은 펫을 분양받은 인증 스트리머만 할 수 있어요. 스트리머 인증을 마치면 이어서 진행할게요.'), go);
    } else if (st.flow === 'admin') {
      const form = el('form', 'tw-train-admin-target');
      const input = el('input', 'tg-input'); input.type = 'text'; input.maxLength = 20; input.placeholder = '팬페이지 ID(SOOP 아이디)'; input.autocomplete = 'off'; input.spellcheck = false;
      input.value = st.streamerId || (() => { try { return sessionStorage.getItem(ADMIN_TARGET_KEY) || ''; } catch (_) { return ''; } })();
      const btn = el('button', 'tg-button', '불러오기'); btn.type = 'submit';
      form.append(el('span', 'tw-train-lead', '관리자 미리보기 · 팬페이지의 다마고치를 불러와 체험하고, 테스트 펫에는 테스트 훈련을 줄 수 있어요(결제는 인증 스트리머만).'), input, btn);
      form.addEventListener('submit', (e) => { e.preventDefault(); const id = input.value.trim().toLowerCase(); if (!STREAMER_RE.test(id)) { setStatus('팬페이지 ID를 확인해 주세요.', true); return; } try { sessionStorage.setItem(ADMIN_TARGET_KEY, id); } catch (_) { /* 무시 */ } void loadPets(id); });
      box.push(form);
    } else {
      const s = viewer().streamer;
      box.push(el('p', 'tw-train-lead', `${s?.nickname || s?.id} 팬페이지의 다마고치에게 새 재주를 가르쳐요. 배운 재주는 팬들도 바로 쓸 수 있어요.`));
    }
    if (st.loading) box.push(el('div', 'loading-card loading-bar', '다마고치를 불러오는 중…'));
    if (!st.loading && st.error) box.push(el('p', 'tg-status is-error', st.error));
    if (!st.loading && !st.error && st.streamerId && !st.pets.length && (st.flow === 'ready' || st.flow === 'admin')) {
      const adopt = el('a', 'tg-button tg-button-primary', '분양소로 가기'); adopt.href = 'tamagotchi.html';
      box.push(el('p', 'tw-train-lead', st.flow === 'admin' ? '이 팬페이지에는 다마고치가 없어요.' : '먼저 분양소에서 친구를 맞이해 주세요.'), ...(st.flow === 'ready' ? [adopt] : []));
    }
    who.replaceChildren(...box);
  }

  function renderPets() {
    petsRow.replaceChildren(...st.pets.map((p) => {
      const b = el('button', 'tw-pet-chip'); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(p.petId === st.petId));
      b.append(el('strong', '', p.nickname || '이름 없음'), el('small', '', `${COLOR_LABELS[p.color] || p.color}${p.test ? ' · 테스트' : ''}`));
      b.addEventListener('click', () => { if (st.busy || p.petId === st.petId) return; st.petId = p.petId; st.selected.clear(); toolCtl?.clear(); setStatus(''); render(); });
      return b;
    }));
  }

  function renderLearned(pet) {
    const order = (pubSpecies(pet.speciesId)?.interactions || []).map((i) => i.id);
    const sorted = [...pet.learned].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    learnedRow.replaceChildren(el('span', 'tw-train-caption', '배운 재주'), ...sorted.map((id) => {
      const chip = el('span', 'tw-learned-chip'); const icon = TOOLS[id]?.src;
      if (icon) { const i = document.createElement('img'); i.src = icon; i.alt = ''; chip.append(i); }
      chip.append(el('span', '', label(pet, id)), el('b', '', '✓')); return chip;
    }));
  }

  function renderGrid(pet) {
    const sp = species(pet.speciesId);
    const trainable = sp?.trainable || [];
    const open = learnableIds(trainable, pet.learned);
    if (!open.length) { grid.replaceChildren(el('p', 'tw-train-done', '모든 재주를 배웠어요 🎉 팬페이지에서 마음껏 함께 놀아 주세요.')); return; }
    grid.replaceChildren(...trainable.filter((t) => open.includes(t.id)).map((t) => {
      const card = el('div', 'tw-skill'); card.dataset.skill = t.id;
      const tryBtn = el('button', 'tw-skill-try'); tryBtn.type = 'button'; tryBtn.dataset.try = t.id; tryBtn.setAttribute('aria-pressed', 'false');
      tryBtn.setAttribute('aria-label', `${label(pet, t.id)} 체험하기`);
      const icon = TOOLS[t.id]?.src; if (icon) { const i = document.createElement('img'); i.src = icon; i.alt = ''; tryBtn.append(i); }
      tryBtn.append(el('strong', '', label(pet, t.id)), el('small', '', interactionOf(pet, t.id)?.desc || '눌러서 체험'));
      tryBtn.addEventListener('click', () => { if (!toolCtl) return; if (toolCtl.selected() === t.id) toolCtl.clear(); else toolCtl.select(t.id); });
      const pick = el('label', 'tw-skill-pick'); const box = el('input'); box.type = 'checkbox'; box.checked = st.selected.has(t.id); box.disabled = st.busy;
      box.addEventListener('change', () => { if (box.checked) st.selected.add(t.id); else st.selected.delete(t.id); card.classList.toggle('is-picked', box.checked); renderSummary(pet); renderAdmin(pet); });
      pick.append(box, el('span', '', `배우기 · ${cashText(t.cash)}`));
      card.classList.toggle('is-picked', box.checked);
      card.append(tryBtn, pick); return card;
    }));
    syncTrial();
  }

  function renderSummary(pet) {
    const sp = species(pet.speciesId); const trainable = sp?.trainable || [];
    const open = learnableIds(trainable, pet.learned);
    if (!open.length) { summary.replaceChildren(); return; }
    const picked = [...st.selected].filter((id) => open.includes(id));
    const total = trainTotal(trainable, picked);
    const balance = Number(ctx.server?.balanceCash) || 0;
    const line = el('p', 'tw-train-total');
    line.append(`선택 ${picked.length}개 · 합계 `, el('strong', '', cashText(total)));
    if (st.flow === 'ready') line.append(` · 내 캐시 ${cashText(balance)}`);
    const buy = el('button', 'tg-button tg-button-primary', st.flow === 'admin' ? '결제 훈련은 인증 스트리머만 할 수 있어요' : '훈련하기'); buy.type = 'button';
    buy.disabled = st.busy || !picked.length || st.flow !== 'ready';
    buy.addEventListener('click', () => startTrain(pet, picked, total));
    const nodes = [line, buy];
    if (st.flow === 'ready' && picked.length && balance < total) {
      const charge = el('a', 'tw-train-charge', `${cashText(total - balance)} 부족해요 · 캐시 충전하기`); charge.href = 'customer-center.html#charge';
      nodes.push(charge); buy.disabled = true;
    }
    summary.replaceChildren(...nodes);
  }

  function renderAdmin(pet) {
    const show = st.flow === 'admin' && !!pet && pet.test === true;
    adminBox.hidden = !show; if (!show) { adminBox.replaceChildren(); return; }
    const b = el('button', 'tg-button', '고른 재주를 테스트 훈련으로 주기(캐시 없음)'); b.type = 'button';
    b.disabled = st.busy || !st.selected.size;
    b.addEventListener('click', () => void adminTrain(pet));
    adminBox.replaceChildren(el('p', 'tw-train-caption', '관리자 도구 · 테스트 펫 전용'), b);
  }

  function setStatus(text, isError = false) { status.textContent = text; status.className = `tg-status${isError ? ' is-error' : ''}`; }

  // ---------- 결제 ----------
  function startTrain(pet, picked, total) {
    if (st.busy || !picked.length) return;
    const dialog = document.getElementById('tgDialog'); const body = document.getElementById('tgDialogBody'); const closeBtn = document.getElementById('tgDialogClose');
    const sp = species(pet.speciesId);
    const list = el('ul', 'tw-confirm-list');
    for (const id of picked) {
      const li = el('li'); li.append(el('span', '', label(pet, id)), el('strong', '', cashText(sp.trainable.find((t) => t.id === id)?.cash)));
      list.append(li);
    }
    const balance = Number(ctx.server?.balanceCash) || 0;
    const sum = el('p', 'tg-summary'); sum.append('합계 ', el('strong', '', cashText(total)), ` · 결제 후 ${cashText(balance - total)}`);
    const notice = el('p', 'tg-notice', '배운 재주는 되돌릴 수 없어서 훈련비는 환불되지 않아요. 결제 오류나 이중 차감은 자동으로 환불돼요. 배운 재주는 이 다마고치에게만 적용돼요.');
    const agreeLabel = el('label', 'tg-agree'); const agree = el('input'); agree.type = 'checkbox';
    agreeLabel.append(agree, el('span', '', '훈련비는 환불되지 않는다는 안내를 확인했어요'));
    const st2 = el('p', 'tg-status'); st2.setAttribute('role', 'status'); st2.setAttribute('aria-live', 'polite');
    const pay = el('button', 'tg-button tg-button-primary', `${cashText(total)} 결제하고 훈련하기`); pay.type = 'button'; pay.disabled = true;
    agree.addEventListener('change', () => { pay.disabled = st.busy || !agree.checked; });
    pay.addEventListener('click', async () => {
      if (st.busy || !agree.checked) return;
      st.busy = true; pay.disabled = true; agree.disabled = true; closeBtn.disabled = true;
      st2.className = 'tg-status loading-bar'; st2.textContent = '훈련하는 중이에요…';
      const requestId = getTrainRequestId(sessionStorage, REQUEST_KEY, trainSignature(pet.petId, picked), randomBytes);
      try {
        const result = (await shopCall({ action: 'train', streamerId: st.streamerId, petId: pet.petId, interactions: picked, requestId })).data || {};
        if (result.status !== 'trained') throw new Error('훈련 결과를 확인하지 못했어요.');
        clearRequestId(sessionStorage, REQUEST_KEY);
        ctx.setBalance(result.remainingCash);
        pet.learned = Array.isArray(result.learned) ? result.learned : [...pet.learned, ...picked];
        st.selected.clear(); st.busy = false; closeBtn.disabled = false;
        dialog.close();
        render(); void celebrate(pet, picked);
      } catch (error) {
        if (shouldDiscardRequestId(error)) clearRequestId(sessionStorage, REQUEST_KEY);
        st.busy = false; closeBtn.disabled = false; agree.disabled = false; pay.disabled = !agree.checked;
        st2.className = 'tg-status is-error'; st2.textContent = trainErrorMessage(error);
        const already = error?.details?.learned;
        if (Array.isArray(already) && already.length) { void loadPets(st.streamerId, { keepPet: true }); }
        void ctx.reload();
      }
    });
    body.replaceChildren(el('p', 'eyebrow section-eyebrow', 'TRAIN'), el('h2', 'tg-dialog-title', `${pet.nickname} 훈련하기`),
      el('p', 'tg-dialog-text', '고른 재주와 가격을 확인해 주세요.'), list, sum, notice, agreeLabel, st2, pay);
    if (!dialog.open) dialog.showModal();
  }

  async function adminTrain(pet) {
    if (st.busy || !st.selected.size) return;
    st.busy = true; render(); setStatus('테스트 훈련을 주는 중…');
    try {
      const picked = [...st.selected];
      const requestId = `at_${Array.from(randomBytes(18), (b) => b.toString(16).padStart(2, '0')).join('')}`;
      const result = (await shopCall({ action: 'admin-train', streamerId: st.streamerId, petId: pet.petId, interactions: picked, requestId })).data || {};
      pet.learned = result.learned || pet.learned; st.selected.clear(); st.busy = false;
      setStatus(`테스트 훈련: ${(result.items || []).map((id) => label(pet, id)).join(', ') || '새로 배운 재주 없음'}`);
      render(); if (result.items?.length) void celebrate(pet, result.items);
    } catch (error) { st.busy = false; render(); setStatus(trainErrorMessage(error), true); }
  }

  // 성공: 배운 재주를 차례로 한 번씩 보여 준다(모션 줄이기면 문구만)
  async function celebrate(pet, items) {
    toolCtl?.clear();
    medal.hidden = false; medal.classList.remove('is-in'); void medal.offsetWidth; medal.classList.add('is-in');
    sound?.once('bonus'); // 메달이 붙을 때 축하 소리(펫 소리 버튼 설정을 따른다)
    for (const id of items) {
      if (st.destroyed) return;
      const it = interactionOf(pet, id);
      setBubble(`✨ ${label(pet, id)}${josa(label(pet, id), '을', '를')} 배웠어요!`);
      if (!reduced && it?.preset) petApi?.play(it.preset, { hop: it.hop === true });
      await sleep(reduced ? 900 : 1800);
    }
    medal.hidden = true;
    const link = el('a', 'tw-train-link', '팬페이지에서 바로 쓸 수 있어요 →'); link.href = farmUrl(st.streamerId);
    setStatus(''); status.replaceChildren(link);
    setBubble(IDLE);
  }

  // ---------- 불러오기 ----------
  async function loadPets(streamerId, { keepPet = false } = {}) {
    st.streamerId = streamerId; st.loading = true; st.error = ''; render();
    try {
      const data = (await shopCall({ action: 'pets', streamerId })).data || {};
      st.pets = Array.isArray(data.pets) ? data.pets : [];
      if (!keepPet || !st.pets.some((p) => p.petId === st.petId)) st.petId = st.pets[0]?.petId || '';
    } catch (error) {
      st.pets = []; st.petId = '';
      st.error = error?.code === 'functions/not-found' ? '인증된 스트리머 팬페이지를 찾을 수 없어요.' : '다마고치를 불러오지 못했어요.';
    }
    st.loading = false; setBubble(IDLE); render();
  }
  function start() {
    const flow = resolveTrainState({ isAnonymous: ctx.user?.isAnonymous !== false, viewer: viewer() });
    if (flow === 'ready') { const id = viewer().streamer.id; if (id !== st.streamerId || !st.pets.length) void loadPets(id); else render(); return; }
    if (flow === 'admin') { let saved = ''; try { saved = sessionStorage.getItem(ADMIN_TARGET_KEY) || ''; } catch (_) { /* 무시 */ } if (saved && saved !== st.streamerId) { void loadPets(saved); return; } }
    if (flow === 'login' || flow === 'verify') { st.pets = []; st.petId = ''; st.streamerId = ''; }
    render();
  }
  setBubble(IDLE);
  start();

  return {
    busy: () => st.busy,
    onAuthChange() { if (!st.busy) start(); },
    destroy() {
      st.destroyed = true; window.removeEventListener('resize', onResize);
      toolCtl?.destroy(); petApi?.destroy(); scene?.destroy?.(); sound?.stopAll?.();
      root.remove();
    },
  };
}

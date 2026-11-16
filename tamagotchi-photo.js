// 월드맵 사진관 "몽글필름" 패널(설계: streamer-fanpage docs/다마고치_월드맵_동네_확장_설계.md §7)
// - 서버 호출은 펫 목록(Shop.pets) 1번뿐. 사진·사인은 이 기기 브라우저(IndexedDB)에만 저장하고 서버로 보내지 않는다.
// - 흐름: 펫 고르기 → 배경·프레임·스트리머 이름 → 3·2·1 네 번 촬영 → 스티커 붙이기 → 완성(앞면) → 뒤집어 사인(뒷면) → 앨범.
// - 움직임은 경과 시간 기준(setTimeout·CSS 전환), 동작 줄이기면 카운트다운 숫자 애니메이션·뒤집기 전환 없음.
import { resolveGemShopTarget, COLOR_LABELS } from './tamagotchi-logic.mjs?v=20261116-tg-dist1';
import { createMongsil } from './tamagotchi-pet.js?v=20261114-tg-wear1';
import { petEmptyCard } from './tamagotchi-empty.js?v=20261116-tg-empty1';

const STREAMER_RE = /^[a-z0-9_-]{1,64}$/;
const ADMIN_TARGET_KEY = 'twPhotoAdminTarget';
const W = 1080; const H = 1920;
// 2×2 네 컷 자리(캔버스 좌표). 프레임 그림은 이 자리 뒤 바탕으로 깔리고, 사진은 그 위 둥근 칸에 그린다.
const SLOTS = [[60, 110, 465, 690], [555, 110, 465, 690], [60, 830, 465, 690], [555, 830, 465, 690]];
const SIGN_AREA = [120, 980, 840, 620];
const POSES = ['기쁨', '응원', '놀람', '쓰다듬 받음'];
const STICKER_MAX = 8;
const PENS = [['#3b2a20', '먹색'], ['#e2557f', '분홍'], ['#4a7bd9', '파랑']];
const WIDTHS = [[7, '가늘게'], [14, '굵게']];
const DB_NAME = 'mongleFilm'; const STORE = 'photos';
const ALBUM_MAX = 200;
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 앨범(IndexedDB, 이 기기에만) ----------
function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'createdAt'); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function dbDo(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode); const store = tx.objectStore(STORE);
      let out; const r = fn(store); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const albumPut = (rec) => dbDo('readwrite', (s) => s.put(rec));
const albumDel = (id) => dbDo('readwrite', (s) => s.delete(id));
const albumAll = async () => ((await dbDo('readonly', (s) => s.getAll())) || []).sort((a, b) => b.createdAt - a.createdAt);
const albumCount = async () => (await dbDo('readonly', (s) => s.count())) || 0;

// ---------- 그림 불러오기 ----------
const imgCache = new Map();
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) imgCache.set(src, new Promise((resolve) => { const i = new Image(); i.decoding = 'async'; i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; }));
  return imgCache.get(src);
}
function blobToDataUrl(blob) { return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(''); r.readAsDataURL(blob); }); }
const dataUrlCache = new Map();
async function inlineHref(href) {
  if (!href || href.startsWith('data:')) return href;
  if (!dataUrlCache.has(href)) dataUrlCache.set(href, fetch(href).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? blobToDataUrl(b) : '')).catch(() => ''));
  return dataUrlCache.get(href);
}
// 지금 펫 SVG 모양 그대로 그림으로(꾸미기 그림은 data URL로 넣어야 캔버스에 그려진다)
async function snapshotPet(svg) {
  if (!svg) return null;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // 색·표시 여부는 페이지 CSS(변수·클래스)에서 오므로, 계산된 값을 복제본에 직접 적는다(그림 파일에는 페이지 CSS가 없다).
  const live = [svg, ...svg.querySelectorAll('*')]; const copy = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < live.length; i += 1) {
    const cs = getComputedStyle(live[i]); const st = copy[i].style;
    for (const k of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility', 'stroke-linecap', 'stroke-linejoin']) st.setProperty(k, cs.getPropertyValue(k));
  }
  for (const im of clone.querySelectorAll('image')) {
    const href = im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    const data = await inlineHref(href); if (data) im.setAttribute('href', data); else im.remove();
  }
  const vb = (svg.getAttribute('viewBox') || '0 0 1250 1100').split(/\s+/).map(Number);
  clone.setAttribute('width', String(vb[2])); clone.setAttribute('height', String(vb[3]));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); imgCache.delete(url); }
}

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawCover(g, im, x, y, w, h) {
  const s = Math.max(w / im.width, h / im.height); const iw = im.width * s; const ih = im.height * s;
  g.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function dateText(t) { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`; }
function fileStamp(t) { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
// 앞면(사진)은 JPEG로 줄여 앨범 용량을 아끼고, 뒷면(단색·사인)은 PNG가 더 작다.
const canvasBlob = (c, type = 'image/png') => new Promise((resolve) => c.toBlob((b) => resolve(b), type, 0.92));
function download(blob, name) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// 앞면 합성: 프레임 바탕 → 칸마다 배경+펫 → 아래 글자 → 스티커
async function composeFront({ frame, bg, shots, stickers, showName, streamerName, petName, at }) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = frame.color || '#fff6ea'; g.fillRect(0, 0, W, H);
  const fim = await loadImage(frame.src); if (fim) drawCover(g, fim, 0, 0, W, H);
  const bim = await loadImage(bg.src);
  SLOTS.forEach(([x, y, w, h], n) => {
    g.save(); roundRect(g, x, y, w, h, 28); g.clip();
    if (bim) drawCover(g, bim, x, y, w, h); else { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, bg.top || '#ffe7ef'); gr.addColorStop(1, bg.bottom || '#fff6ea'); g.fillStyle = gr; g.fillRect(x, y, w, h); }
    const pet = shots[n];
    if (pet) { const pw = w * 0.92; const ph = pw * (pet.height / pet.width); g.drawImage(pet, x + (w - pw) / 2, y + h - ph - h * 0.04, pw, ph); }
    g.restore();
    g.lineWidth = 8; g.strokeStyle = frame.ink || '#7a5a3f'; roundRect(g, x, y, w, h, 28); g.stroke();
  });
  g.fillStyle = frame.ink || '#7a5a3f'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 64px "Pretendard", "Apple SD Gothic Neo", sans-serif'; g.fillText('MONGLE FILM', W / 2, 1620);
  g.font = '700 38px "Pretendard", "Apple SD Gothic Neo", sans-serif';
  const line = [petName, showName && streamerName ? `with ${streamerName}` : ''].filter(Boolean).join('  ·  ');
  if (line) g.fillText(line, W / 2, 1700);
  g.font = '600 32px "Pretendard", "Apple SD Gothic Neo", sans-serif'; g.fillText(dateText(at), W / 2, 1765);
  for (const s of stickers) {
    const im = await loadImage(s.src); const size = s.size || 200;
    g.save(); g.translate(s.x * W, s.y * H); g.rotate((s.rot || 0) * Math.PI / 180);
    if (im) g.drawImage(im, -size / 2, -size / 2, size, size);
    else { g.font = `${size * 0.8}px sans-serif`; g.fillText(s.emoji || '★', 0, 0); }
    g.restore();
  }
  return c;
}
// 뒷면: 종이 바탕 + 사인 칸 + 사인 선
function drawBack(c, { frame, at, strokes, art }) {
  const g = c.getContext('2d');
  g.fillStyle = '#fffaf2'; g.fillRect(0, 0, W, H);
  g.strokeStyle = frame.color || '#ffd9e4'; g.lineWidth = 40; g.strokeRect(20, 20, W - 40, H - 40);
  g.fillStyle = frame.ink || '#7a5a3f'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 80px "Pretendard", "Apple SD Gothic Neo", sans-serif'; g.fillText('MONGLE FILM', W / 2, 360);
  g.font = '700 40px "Pretendard", "Apple SD Gothic Neo", sans-serif'; g.fillText('📸 몽글필름 · 다마고치 마을', W / 2, 470);
  g.font = '600 34px "Pretendard", "Apple SD Gothic Neo", sans-serif'; g.fillText(dateText(at), W / 2, 545);
  if (art) { const s = 340; g.drawImage(art, (W - s) / 2, 600, s, s); }
  const [sx, sy, sw, sh] = SIGN_AREA;
  g.setLineDash([18, 14]); g.lineWidth = 4; g.strokeStyle = 'rgba(122,90,63,.45)'; roundRect(g, sx, sy, sw, sh, 30); g.stroke(); g.setLineDash([]);
  g.font = '600 30px "Pretendard", "Apple SD Gothic Neo", sans-serif'; g.fillStyle = 'rgba(122,90,63,.55)'; g.fillText('SIGN', W / 2, sy + sh + 50);
  g.save(); roundRect(g, sx, sy, sw, sh, 30); g.clip(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.pts.length) continue;
    g.strokeStyle = s.color; g.lineWidth = s.width; g.beginPath(); g.moveTo(s.pts[0][0], s.pts[0][1]);
    if (s.pts.length === 1) g.lineTo(s.pts[0][0] + 0.1, s.pts[0][1]);
    for (let i = 1; i < s.pts.length; i += 1) g.lineTo(s.pts[i][0], s.pts[i][1]);
    g.stroke();
  }
  g.restore();
}

export function mountPhotoPanel(host, ctx) {
  const { shopCall } = ctx;
  const st = {
    flow: '', streamerId: '', streamerName: '', pets: [], petId: '', loading: false, error: '', destroyed: false, wantPet: '',
    tab: 'shoot', step: 'setup', catalog: null, bgId: '', frameId: '', showName: true, shots: [], stickers: [], shooting: false,
    result: null, flipped: false, signMode: false, pen: 0, width: 0, strokes: [], album: [], armedDel: '', storageNote: '',
  };
  const root = el('div', 'tw-photo');
  const tabs = el('div', 'tw-photo-tabs'); tabs.setAttribute('role', 'tablist');
  const who = el('div', 'tw-gem-who');
  const body = el('div', 'tw-photo-body');
  const status = el('p', 'tg-status'); status.setAttribute('role', 'status');
  root.append(tabs, who, body, status); host.append(root);
  let petApi = null; let petFor = ''; let petBox = null; const urls = new Set();
  const viewer = () => ctx.server?.viewer || {};
  const currentPet = () => st.pets.find((p) => p.petId === st.petId) || null;
  const bg = () => st.catalog?.backgrounds.find((b) => b.id === st.bgId) || st.catalog?.backgrounds[0] || {};
  const frame = () => st.catalog?.frames.find((f) => f.id === st.frameId) || st.catalog?.frames[0] || {};
  let backArt = null; void loadImage(new URL('./assets/tamagotchi/world/bld-photo.webp', import.meta.url).href).then((i) => { backArt = i; });
  const objUrl = (blob) => { const u = URL.createObjectURL(blob); urls.add(u); return u; };

  function renderTabs() {
    tabs.replaceChildren(...[['shoot', '📸 찍기'], ['album', '🗂 앨범']].map(([id, label]) => {
      const b = el('button', `tw-photo-tab${st.tab === id ? ' is-on' : ''}`, label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(st.tab === id));
      b.disabled = st.shooting;
      b.addEventListener('click', () => { if (st.tab === id) return; st.tab = id; if (id === 'album') void loadAlbum(); render(); });
      return b;
    }));
  }
  function renderWho() {
    const box = [];
    if (st.tab !== 'shoot' || st.step !== 'setup') { who.replaceChildren(); return; }
    if (st.streamerId && st.pets.length) box.push(el('p', 'tw-train-lead', `${st.streamerName || st.streamerId} 팬페이지 펫과 네 컷 사진을 찍어요. 사진은 이 기기에만 저장돼요.`));
    if (st.flow === 'login' || st.flow === 'verify') {
      box.push(el('p', 'tw-train-lead', '스트리머 팬페이지 다마고치 탭에서 들어오면 그 펫과 사진을 찍을 수 있어요. 인증 스트리머는 여기서 바로 내 펫과 찍어요.'));
      const go = el('button', 'tg-button tg-button-primary', st.flow === 'login' ? '로그인하기' : '스트리머 인증하기'); go.type = 'button';
      go.addEventListener('click', () => ctx.openLogin(st.flow === 'verify' ? { streamer: true } : undefined));
      box.push(go);
    }
    if (st.flow === 'admin') {
      const form = el('form', 'tw-train-admin-target');
      const input = el('input', 'tg-input'); input.type = 'text'; input.maxLength = 20; input.placeholder = '팬페이지 ID(SOOP 아이디)'; input.autocomplete = 'off'; input.spellcheck = false; input.value = st.streamerId;
      const btn = el('button', 'tg-button', '불러오기'); btn.type = 'submit';
      form.append(el('span', 'tw-train-lead', '관리자 · 팬페이지 펫을 불러와요.'), input, btn);
      form.addEventListener('submit', (e) => {
        e.preventDefault(); const id = input.value.trim().toLowerCase();
        if (!STREAMER_RE.test(id)) { status.textContent = '팬페이지 ID를 확인해 주세요.'; return; }
        try { sessionStorage.setItem(ADMIN_TARGET_KEY, id); } catch (_) { /* 무시 */ }
        void loadPets(id);
      });
      box.push(form);
    }
    if (st.loading) box.push(el('div', 'loading-card loading-bar', '다마고치를 불러오는 중…'));
    if (!st.loading && st.error === 'no-pet') box.push(petEmptyCard({ place: '몽글필름', streamerName: st.streamerName, own: String(viewer().streamer?.id || '') === st.streamerId, admin: st.flow === 'admin' }));
    else if (!st.loading && st.error) box.push(el('p', 'tg-status is-error', st.error));
    who.replaceChildren(...box);
  }

  // ---------- 찍기: 준비(펫·배경·프레임·이름) ----------
  function choiceRow(label, items, cur, onPick, kind) {
    const wrap = el('div', 'tw-photo-choice'); wrap.append(el('strong', '', label));
    const row = el('div', 'tw-photo-swatches'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', label);
    for (const it of items) {
      const b = el('button', `tw-photo-swatch is-${kind}`); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(it.id === cur)); b.title = it.name;
      const thumb = el('span', 'tw-photo-thumb');
      thumb.style.background = it.color || `linear-gradient(${it.top || '#ffe7ef'}, ${it.bottom || '#fff6ea'})`;
      if (it.src) { const im = el('img'); im.alt = ''; im.loading = 'lazy'; im.src = it.src; im.onerror = () => im.remove(); thumb.append(im); }
      else if (it.emoji) thumb.textContent = it.emoji;
      b.append(thumb, el('small', '', it.name));
      b.addEventListener('click', () => onPick(it));
      row.append(b);
    }
    wrap.append(row); return wrap;
  }
  function ensurePet(boxEl) {
    const pet = currentPet(); if (!pet) return;
    if (petApi && petFor === pet.petId && petBox === boxEl) return;
    petApi?.destroy(); boxEl.replaceChildren();
    petApi = createMongsil(boxEl, { color: pet.color || 'cream', reduced: ctx.reduced, wear: pet.wear || {} });
    petApi.setLowPower?.(window.matchMedia('(max-width: 720px)').matches);
    petFor = pet.petId; petBox = boxEl;
  }
  function renderSetup() {
    const pet = currentPet();
    if (!pet || !st.catalog) { body.replaceChildren(); return; }
    const grid = el('div', 'tw-photo-grid');
    const booth = el('div', 'tw-photo-booth');
    const view = el('div', 'tw-photo-view');
    const b = bg(); view.style.background = `linear-gradient(${b.top || '#ffe7ef'}, ${b.bottom || '#fff6ea'})`;
    if (b.src) view.style.backgroundImage = `url("${b.src}")`;
    const pbox = el('div', 'tw-photo-pet'); view.append(pbox);
    const count = el('div', 'tw-photo-count'); count.setAttribute('aria-live', 'assertive'); view.append(count);
    const flash = el('div', 'tw-photo-flash'); view.append(flash);
    const dots = el('div', 'tw-photo-dots'); for (let n = 0; n < 4; n += 1) dots.append(el('span', n < st.shots.length ? 'is-on' : ''));
    booth.append(view, dots);
    const side = el('div', 'tw-photo-side');
    if (st.pets.length > 1) {
      const row = el('div', 'tw-train-pets'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', '다마고치 고르기');
      for (const p of st.pets) {
        const c = el('button', 'tw-pet-chip'); c.type = 'button'; c.setAttribute('role', 'radio'); c.setAttribute('aria-checked', String(p.petId === st.petId)); c.disabled = st.shooting;
        c.append(el('strong', '', p.nickname || '이름 없음'), el('small', '', COLOR_LABELS[p.color] || p.color || ''));
        c.addEventListener('click', () => { st.petId = p.petId; render(); });
        row.append(c);
      }
      side.append(row);
    }
    side.append(choiceRow('배경', st.catalog.backgrounds, b.id, (it) => { st.bgId = it.id; render(); }, 'bg'));
    side.append(choiceRow('프레임', st.catalog.frames, frame().id, (it) => { st.frameId = it.id; render(); }, 'frame'));
    const nameRow = el('label', 'tw-photo-toggle');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = st.showName; cb.disabled = !st.streamerName;
    cb.addEventListener('change', () => { st.showName = cb.checked; });
    nameRow.append(cb, el('span', '', st.streamerName ? `사진에 스트리머 이름 넣기 (${st.streamerName})` : '사진에 스트리머 이름 넣기'));
    side.append(nameRow);
    const shoot = el('button', 'tg-button tg-button-primary tw-photo-shoot', st.shooting ? '촬영 중…' : '📸 네 컷 찍기'); shoot.type = 'button'; shoot.disabled = st.shooting;
    shoot.addEventListener('click', () => void runShoot(pbox, count, flash, dots));
    side.append(shoot, el('small', 'tw-hosp-why', '3·2·1 카운트다운으로 네 번 찍어요. 매번 다른 포즈를 해요.'));
    grid.append(booth, side);
    body.replaceChildren(grid);
    ensurePet(pbox);
  }
  async function runShoot(pbox, count, flash, dots) {
    if (st.shooting) return;
    st.shooting = true; st.shots = []; renderTabs();
    for (const b of body.querySelectorAll('button, input')) b.disabled = true;
    [...dots.children].forEach((d) => d.classList.remove('is-on'));
    try {
      for (let n = 0; n < 4 && !st.destroyed; n += 1) {
        petApi?.play?.(POSES[n], { hop: false, seconds: 3.5 });
        for (const k of [3, 2, 1]) { count.textContent = String(k); count.classList.remove('is-pop'); void count.offsetWidth; if (!ctx.reduced) count.classList.add('is-pop'); await sleep(700); if (st.destroyed) return; }
        count.textContent = '';
        const shot = await snapshotPet(pbox.querySelector('svg'));
        st.shots.push(shot);
        if (!ctx.reduced) { flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on'); }
        dots.children[n]?.classList.add('is-on');
        await sleep(450);
      }
    } finally { st.shooting = false; }
    if (st.destroyed) return;
    if (st.shots.filter(Boolean).length < 4) { status.textContent = '사진을 찍지 못했어요. 다시 시도해 주세요.'; render(); return; }
    st.stickers = []; st.step = 'decorate'; status.textContent = '';
    petApi?.destroy(); petApi = null; petFor = ''; petBox = null;
    render();
  }

  // ---------- 스티커 붙이기(끌어서 옮기기, 최대 8개) ----------
  let previewUrl = '';
  async function renderDecorate() {
    const grid = el('div', 'tw-photo-grid');
    const wrap = el('div', 'tw-photo-strip-wrap');
    const strip = el('div', 'tw-photo-strip');
    const im = el('img', 'tw-photo-strip-img'); im.alt = '네 컷 사진 미리보기'; im.draggable = false;
    strip.append(im); wrap.append(strip);
    const side = el('div', 'tw-photo-side');
    side.append(el('p', 'tw-train-lead', `스티커를 눌러 붙이고 끌어서 옮겨요(최대 ${STICKER_MAX}개). 붙인 스티커를 두 번 누르면 떼어져요.`));
    const row = el('div', 'tw-photo-swatches');
    for (const sk of st.catalog.stickers) {
      const b = el('button', 'tw-photo-swatch is-sticker'); b.type = 'button'; b.title = sk.name;
      const thumb = el('span', 'tw-photo-thumb'); thumb.textContent = sk.emoji || '';
      if (sk.src) { const i = el('img'); i.alt = ''; i.src = sk.src; i.onload = () => { thumb.firstChild?.nodeType === 3 && thumb.firstChild.remove(); }; i.onerror = () => i.remove(); thumb.append(i); }
      b.append(thumb, el('small', '', sk.name));
      b.addEventListener('click', () => {
        if (st.stickers.length >= STICKER_MAX) { status.textContent = `스티커는 ${STICKER_MAX}개까지 붙일 수 있어요.`; return; }
        st.stickers.push({ ...sk, x: 0.3 + Math.random() * 0.4, y: 0.25 + Math.random() * 0.4, rot: Math.round((Math.random() - 0.5) * 30), size: 210 });
        drawStickers();
      });
      row.append(b);
    }
    const done = el('button', 'tg-button tg-button-primary', '✨ 완성하기'); done.type = 'button';
    done.addEventListener('click', () => void finish());
    const again = el('button', 'tg-button', '↺ 다시 찍기'); again.type = 'button';
    again.addEventListener('click', () => { st.step = 'setup'; st.shots = []; st.stickers = []; render(); });
    side.append(row, done, again);
    grid.append(wrap, side); body.replaceChildren(grid);
    const base = await composeFront({ frame: frame(), bg: bg(), shots: st.shots, stickers: [], showName: st.showName, streamerName: st.streamerName, petName: currentPet()?.nickname || '', at: Date.now() });
    if (st.destroyed || st.step !== 'decorate') return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(await canvasBlob(base)); im.src = previewUrl;
    function drawStickers() {
      strip.querySelectorAll('.tw-photo-sticker').forEach((n) => n.remove());
      st.stickers.forEach((s, idx) => {
        const n = el('button', 'tw-photo-sticker'); n.type = 'button'; n.setAttribute('aria-label', `${s.name} 스티커(두 번 눌러 떼기)`);
        n.style.left = `${s.x * 100}%`; n.style.top = `${s.y * 100}%`; n.style.width = `${(s.size / W) * 100}%`; n.style.transform = `translate(-50%,-50%) rotate(${s.rot}deg)`;
        if (s.src) { const i = el('img'); i.alt = ''; i.draggable = false; i.src = s.src; i.onerror = () => { i.replaceWith(el('span', '', s.emoji || '★')); }; n.append(i); } else n.append(el('span', '', s.emoji || '★'));
        let drag = null; let lastTap = 0;
        n.addEventListener('pointerdown', (e) => { e.preventDefault(); n.setPointerCapture(e.pointerId); drag = { id: e.pointerId, moved: false }; });
        n.addEventListener('pointermove', (e) => {
          if (!drag || drag.id !== e.pointerId) return;
          const r = strip.getBoundingClientRect();
          s.x = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width)); s.y = Math.min(0.97, Math.max(0.03, (e.clientY - r.top) / r.height));
          n.style.left = `${s.x * 100}%`; n.style.top = `${s.y * 100}%`; drag.moved = true;
        });
        n.addEventListener('pointerup', () => {
          const moved = drag?.moved; drag = null; if (moved) return;
          const now = performance.now(); if (now - lastTap < 400) { st.stickers.splice(idx, 1); drawStickers(); } lastTap = now;
        });
        n.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') { st.stickers.splice(idx, 1); drawStickers(); } });
        strip.append(n);
      });
    }
    drawStickers();
  }
  async function finish() {
    const at = Date.now();
    status.textContent = '사진을 인화하는 중…';
    const front = await composeFront({ frame: frame(), bg: bg(), shots: st.shots, stickers: st.stickers, showName: st.showName, streamerName: st.streamerName, petName: currentPet()?.nickname || '', at });
    const frontBlob = await canvasBlob(front, 'image/jpeg');
    const rec = { id: `${at}-${Math.random().toString(36).slice(2, 8)}`, createdAt: at, front: frontBlob, back: null, strokes: [], frameId: frame().id, petName: currentPet()?.nickname || '', streamerName: st.showName ? st.streamerName : '' };
    st.result = rec; st.strokes = []; st.flipped = false; st.signMode = false; st.step = 'result';
    status.textContent = '';
    await saveRecord(rec, true);
    render();
  }
  async function saveRecord(rec, first) {
    try {
      if (first && (await albumCount()) >= ALBUM_MAX) { status.textContent = `앨범이 가득 찼어요(${ALBUM_MAX}장). 앨범에서 지운 뒤 다시 저장해 주세요.`; rec.unsaved = true; return; }
      const back = document.createElement('canvas'); back.width = W; back.height = H; drawBack(back, { frame: frameOf(rec), at: rec.createdAt, strokes: rec.strokes || [], art: backArt });
      rec.back = await canvasBlob(back);
      await albumPut({ id: rec.id, createdAt: rec.createdAt, front: rec.front, back: rec.back, strokes: rec.strokes || [], frameId: rec.frameId, petName: rec.petName, streamerName: rec.streamerName });
      rec.unsaved = false;
      if (first) { status.textContent = '앨범에 저장했어요. 이 기기 브라우저에만 보관돼요.'; requestPersist(); }
    } catch (error) {
      rec.unsaved = true;
      status.textContent = error?.name === 'QuotaExceededError' ? '기기 저장 공간이 부족해 앨범에 저장하지 못했어요. 바로 내려받아 주세요.' : '이 브라우저에서는 앨범에 저장할 수 없어요. 바로 내려받아 주세요.';
    }
  }
  function frameOf(rec) { return st.catalog?.frames.find((f) => f.id === rec.frameId) || frame(); }
  let persistAsked = false;
  function requestPersist() { if (persistAsked) return; persistAsked = true; try { navigator.storage?.persist?.().catch(() => {}); } catch (_) { /* 무시 */ } }

  // ---------- 결과 카드: 끌어서 뒤집기 + 뒷면 사인 ----------
  function renderResult() {
    const rec = st.result; if (!rec) { st.step = 'setup'; render(); return; }
    const grid = el('div', 'tw-photo-grid');
    const stage = el('div', 'tw-photo-card-stage');
    const card = el('div', `tw-photo-card${st.flipped ? ' is-flipped' : ''}`);
    const front = el('img', 'tw-photo-face is-front'); front.alt = '몽글필름 네 컷 사진 앞면'; front.draggable = false; front.src = objUrl(rec.front);
    const backWrap = el('div', 'tw-photo-face is-back');
    const back = document.createElement('canvas'); back.width = W; back.height = H; back.className = 'tw-photo-back-canvas'; back.setAttribute('aria-label', '사진 뒷면(사인 칸)');
    backWrap.append(back); card.append(front, backWrap); stage.append(card);
    const redrawBack = () => drawBack(back, { frame: frameOf(rec), at: rec.createdAt, strokes: st.strokes, art: backArt });
    redrawBack();
    let angle = st.flipped ? 180 : 0;
    const setAngle = (a, animate) => { card.style.transition = animate && !ctx.reduced ? 'transform 380ms ease-out' : 'none'; card.style.transform = `rotateY(${a}deg)`; };
    setAngle(angle, false);
    // 뒤집기 끌기(사인 모드에서는 사인 칸 안 끌기가 그리기)
    let fl = null;
    stage.addEventListener('pointerdown', (e) => {
      if (st.signMode && st.flipped) { startStroke(e); return; }
      fl = { id: e.pointerId, x: e.clientX, t: performance.now(), base: angle, on: false };
    });
    stage.addEventListener('pointermove', (e) => {
      if (stroke) { moveStroke(e); return; }
      if (!fl || fl.id !== e.pointerId) return;
      const dx = e.clientX - fl.x;
      if (!fl.on) { if (Math.abs(dx) < 8) return; fl.on = true; try { stage.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } }
      angle = fl.base + (dx / stage.clientWidth) * 180; setAngle(angle, false);
    });
    const endFlip = (e) => {
      if (stroke) { endStroke(); return; }
      if (!fl || fl.id !== e.pointerId) return;
      const was = fl.on; const dx = e.clientX - fl.x; const v = Math.abs(dx) / Math.max(1, performance.now() - fl.t); const base = fl.base; fl = null;
      if (!was) return;
      const moved = angle - base;
      const flip = Math.abs(moved) > 90 || (v > 0.5 && Math.abs(dx) > 24);
      angle = flip ? base + (moved > 0 ? 180 : -180) : base;
      st.flipped = Math.round(Math.abs(angle) / 180) % 2 === 1;
      setAngle(angle, true); card.classList.toggle('is-flipped', st.flipped); syncSide();
    };
    stage.addEventListener('pointerup', endFlip); stage.addEventListener('pointercancel', endFlip);
    // 사인 그리기
    let stroke = null;
    // 뒷면은 CSS로 rotateY(180deg)를 한 번 더 걸어 두어, 뒤집힌 카드에서도 화면 좌표 그대로 사인 칸 좌표가 된다.
    const toCanvasFixed = (e) => { const r = back.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
    function inSign([x, y]) { const [sx, sy, sw, sh] = SIGN_AREA; return x >= sx && x <= sx + sw && y >= sy && y <= sy + sh; }
    function startStroke(e) {
      const p = toCanvasFixed(e); if (!inSign(p)) return;
      e.preventDefault(); try { stage.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
      stroke = { color: PENS[st.pen][0], width: WIDTHS[st.width][0], pts: [p] }; st.strokes.push(stroke); redrawBack();
    }
    function moveStroke(e) { const p = toCanvasFixed(e); const last = stroke.pts[stroke.pts.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3 || stroke.pts.length >= 2000) return; stroke.pts.push(p); redrawBack(); }
    function endStroke() { stroke = null; markDirty(); }
    let dirty = false; const markDirty = () => { dirty = true; saveBtn.disabled = false; };

    const side = el('div', 'tw-photo-side');
    const flipBtn = el('button', 'tg-button', '↻ 뒤집기'); flipBtn.type = 'button';
    flipBtn.addEventListener('click', () => { angle += 180; st.flipped = !st.flipped; setAngle(angle, true); card.classList.toggle('is-flipped', st.flipped); syncSide(); });
    const hint = el('p', 'tw-train-lead');
    const signTools = el('div', 'tw-photo-sign-tools');
    const signBtn = el('button', 'tg-button tg-button-primary'); signBtn.type = 'button';
    signBtn.addEventListener('click', () => { st.signMode = !st.signMode; syncSide(); });
    const pens = el('div', 'tw-photo-pens');
    PENS.forEach(([c, name], i) => { const b = el('button', `tw-photo-pen${st.pen === i ? ' is-on' : ''}`); b.type = 'button'; b.title = name; b.setAttribute('aria-label', `${name} 펜`); b.style.background = c; b.addEventListener('click', () => { st.pen = i; pens.querySelectorAll('.tw-photo-pen').forEach((n, k) => n.classList.toggle('is-on', k === i)); }); pens.append(b); });
    WIDTHS.forEach(([, name], i) => { const b = el('button', `tw-photo-width${st.width === i ? ' is-on' : ''}`, name); b.type = 'button'; b.addEventListener('click', () => { st.width = i; pens.querySelectorAll('.tw-photo-width').forEach((n, k) => n.classList.toggle('is-on', k === i)); }); pens.append(b); });
    const undo = el('button', 'tg-button', '↶ 되돌리기'); undo.type = 'button'; undo.addEventListener('click', () => { st.strokes.pop(); redrawBack(); markDirty(); });
    const clear = el('button', 'tg-button', '지우기'); clear.type = 'button'; clear.addEventListener('click', () => { st.strokes = []; redrawBack(); markDirty(); });
    const saveBtn = el('button', 'tg-button tg-button-primary', '💾 사인 저장'); saveBtn.type = 'button'; saveBtn.disabled = true;
    saveBtn.addEventListener('click', async () => { rec.strokes = st.strokes.map((s) => ({ ...s, pts: s.pts.slice() })); await saveRecord(rec, false); if (!rec.unsaved) { status.textContent = '사인을 앨범에 저장했어요.'; dirty = false; saveBtn.disabled = true; } });
    const edit = el('div', 'tw-photo-edit-row'); edit.append(undo, clear, saveBtn);
    signTools.append(pens, edit);
    const dl = el('div', 'tw-photo-dl');
    const name = (side_) => `mongle-film-${fileStamp(rec.createdAt)}-${side_}.${side_ === 'front' ? 'jpg' : 'png'}`;
    const dFront = el('button', 'tg-button', '⬇ 앞면'); dFront.type = 'button'; dFront.addEventListener('click', () => download(rec.front, name('front')));
    const dBack = el('button', 'tg-button', '⬇ 뒷면'); dBack.type = 'button'; dBack.addEventListener('click', async () => download(await canvasBlob(back), name('back')));
    const dBoth = el('button', 'tg-button', '⬇ 둘 다'); dBoth.type = 'button'; dBoth.addEventListener('click', async () => { download(rec.front, name('front')); await sleep(600); download(await canvasBlob(back), name('back')); });
    dl.append(dFront, dBack, dBoth);
    const more = el('div', 'tw-photo-edit-row');
    const again = el('button', 'tg-button', '📸 새로 찍기'); again.type = 'button';
    again.addEventListener('click', () => { if (dirty) { status.textContent = '저장하지 않은 사인이 있어요. 💾 사인 저장을 누르거나 한 번 더 누르면 새로 찍어요.'; dirty = false; return; } st.result = null; st.step = 'setup'; st.shots = []; render(); });
    const toAlbum = el('button', 'tg-button', '🗂 앨범 보기'); toAlbum.type = 'button'; toAlbum.addEventListener('click', () => { st.tab = 'album'; void loadAlbum(); render(); });
    more.append(again, toAlbum);
    side.append(hint, flipBtn, signBtn, signTools, dl, more);
    function syncSide() {
      if (!st.flipped) st.signMode = false;
      signBtn.hidden = !st.flipped; signTools.hidden = !(st.flipped && st.signMode);
      signBtn.textContent = st.signMode ? '✋ 사인 끝내기(뒤집기로)' : '✍️ 뒷면에 사인하기';
      stage.classList.toggle('is-signing', st.signMode);
      hint.textContent = st.signMode ? '점선 칸 안에 손가락이나 마우스로 사인해요.' : '카드를 옆으로 끌거나 ↻ 뒤집기를 누르면 뒷면이 보여요.';
    }
    syncSide();
    grid.append(stage, side); body.replaceChildren(grid);
  }

  // ---------- 앨범 ----------
  async function loadAlbum() {
    try { st.album = await albumAll(); st.storageNote = ''; } catch (_) { st.album = []; st.storageNote = '이 브라우저에서는 앨범을 쓸 수 없어요(사생활 보호 모드 등).'; }
    if (st.tab === 'album') render();
  }
  function renderAlbum() {
    const box = el('div', 'tw-photo-album');
    box.append(el('p', 'tw-train-lead', `사진은 이 기기 브라우저에만 보관돼요(${st.album.length}/${ALBUM_MAX}장). 브라우저 데이터를 지우면 함께 지워지니 소중한 사진은 내려받아 두세요.`));
    if (st.storageNote) box.append(el('p', 'tg-status is-error', st.storageNote));
    if (!st.album.length && !st.storageNote) box.append(el('div', 'empty-card', '아직 찍은 사진이 없어요. 📸 찍기에서 첫 네 컷을 남겨 보세요!'));
    const grid = el('div', 'tw-photo-album-grid');
    for (const rec of st.album) {
      const item = el('div', 'tw-photo-album-item');
      const open = el('button', 'tw-photo-album-open'); open.type = 'button'; open.setAttribute('aria-label', `${dateText(rec.createdAt)} 사진 열기`);
      const im = el('img'); im.alt = ''; im.loading = 'lazy'; im.src = objUrl(rec.front); open.append(im);
      open.addEventListener('click', () => { st.result = { ...rec }; st.strokes = (rec.strokes || []).map((s) => ({ ...s, pts: s.pts.slice() })); st.flipped = false; st.signMode = false; st.step = 'result'; st.tab = 'shoot'; render(); });
      const meta = el('div', 'tw-photo-album-meta'); meta.append(el('small', '', `${dateText(rec.createdAt)}${rec.petName ? ` · ${rec.petName}` : ''}`));
      const del = el('button', `tw-photo-del${st.armedDel === rec.id ? ' is-armed' : ''}`, st.armedDel === rec.id ? '정말 지울까요?' : '지우기'); del.type = 'button';
      del.addEventListener('click', async () => {
        if (st.armedDel !== rec.id) { st.armedDel = rec.id; render(); return; }
        st.armedDel = '';
        try { await albumDel(rec.id); status.textContent = '사진을 지웠어요.'; } catch (_) { status.textContent = '지우지 못했어요.'; }
        await loadAlbum();
      });
      meta.append(del); item.append(open, meta); grid.append(item);
    }
    box.append(grid); body.replaceChildren(box);
  }

  function render() {
    if (st.destroyed) return;
    renderTabs(); renderWho();
    if (st.tab === 'album') { petApi?.destroy(); petApi = null; petFor = ''; petBox = null; renderAlbum(); return; }
    if (st.step !== 'setup') { petApi?.destroy(); petApi = null; petFor = ''; petBox = null; }
    if (st.step === 'result') renderResult();
    else if (st.step === 'decorate') void renderDecorate();
    else renderSetup();
  }
  const onVisible = () => petApi?.setPaused?.(document.hidden);
  document.addEventListener('visibilitychange', onVisible);

  async function loadCatalog() {
    try {
      const r = await fetch('catalog/tamagotchi-photo.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('catalog');
      const c = await r.json();
      st.catalog = { backgrounds: c.backgrounds || [], frames: c.frames || [], stickers: c.stickers || [] };
      st.bgId = st.catalog.backgrounds[0]?.id || ''; st.frameId = st.catalog.frames[0]?.id || '';
    } catch (_) { st.error = '사진관을 불러오지 못했어요.'; }
  }
  async function loadPets(streamerId) {
    st.streamerId = streamerId; st.loading = true; st.error = ''; st.pets = []; render();
    try {
      const data = (await shopCall({ action: 'pets', streamerId })).data || {};
      st.pets = Array.isArray(data.pets) ? data.pets : [];
      st.streamerName = String(data.streamer?.nickname || '');
      st.petId = st.pets.some((p) => p.petId === st.wantPet) ? st.wantPet : st.pets[0]?.petId || '';
      if (!st.pets.length) st.error = 'no-pet';
    } catch (error) {
      st.error = error?.code === 'functions/not-found' ? '인증된 스트리머 팬페이지를 찾을 수 없어요.' : (error?.message || '다마고치를 불러오지 못했어요.');
    }
    st.loading = false; render();
  }
  function start() {
    const target = resolveGemShopTarget({ search: location.search, isAnonymous: ctx.user?.isAnonymous !== false, viewer: viewer() });
    st.flow = target.flow; st.wantPet = target.petId || st.wantPet;
    if (target.streamerId) { if (target.streamerId !== st.streamerId || !st.pets.length) { void loadPets(target.streamerId); return; } render(); return; }
    if (st.flow === 'admin') {
      let saved = ''; try { saved = sessionStorage.getItem(ADMIN_TARGET_KEY) || ''; } catch (_) { /* 무시 */ }
      if (saved && saved !== st.streamerId) { void loadPets(saved); return; }
    }
    if (st.flow === 'login' || st.flow === 'verify') { st.pets = []; st.petId = ''; st.streamerId = ''; }
    render();
  }
  void loadCatalog().then(start);

  return {
    busy: () => st.shooting,
    onAuthChange() { if (!st.shooting) start(); },
    destroy() {
      st.destroyed = true; document.removeEventListener('visibilitychange', onVisible);
      petApi?.destroy(); root.remove();
      for (const u of urls) URL.revokeObjectURL(u); urls.clear(); if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
  };
}

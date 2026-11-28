// 다마고치 공원(함께 산책).
// 설계: streamer-fanpage/docs/다마고치_공원_함께산책_설계.md (§10·§13·§14·§15·§18~§21).
// - 바닥(그림자 포함)은 미리 구운 한 장, 물체는 조각 그림을 y 순서로 세워 가림을 만든다.
// - 서버 호출은 펫 목록·입장·간식 줍기뿐. 위치(목표점)·감정표현·따라가기는 내 세션 노드에 직접 쓴다(최소 1초 간격).
// - 다른 펫은 받은 목표점까지 각자 화면에서 걸어가게 그린다. 따라가는 펫은 위치를 보내지 않고 앞 펫 기준으로 계산한다.
import { Application, Assets, Container, Graphics, Sprite, Text } from './vendor/pixi-8.23.0.min.mjs';
import { WEAR_ITEMS } from './tamagotchi-pet.js?v=20261128-park4';
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { ensureAppCheck } from './app-check.js?v=20261114-ac1';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';
import {
  getDatabase, ref, onChildAdded, onChildChanged, onChildRemoved, onValue, update, onDisconnect, remove, get, serverTimestamp, goOffline, goOnline,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const V = '?v=20261128-park6';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:cdddfe20075aa199a3a769',
};
const FANPAGE_DB = 'https://streamer-fanpage-rtdb.firebaseio.com';
const fbApp = getApps().find((a) => a.name === '[DEFAULT]') || initializeApp(FIREBASE_CONFIG);
ensureAppCheck(fbApp);
const auth = getAuth(fbApp);
const rtdb = getDatabase(fbApp, FANPAGE_DB);
const parkCall = httpsCallable(getFunctions(fbApp, 'us-central1'), 'streamerFanPageTamagotchiPark');

const $ = (id) => document.getElementById(id);
const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const mobile = window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
const EMOTES = [['❤️', 'heart'], ['🎵', 'note'], ['❓', 'q'], ['❗', 'ex'], ['💤', 'zz'], ['👋', 'hi']];
const EMO_OF = Object.fromEntries(EMOTES.map(([g, c]) => [c, g]).concat([['eat', '😋'], ['pick', '🐟']]));
const PET_W = 96, PET_H = PET_W * 1100 / 1250, SPEED = 190, SEND_GAP = 1100, IDLE_MS = 5 * 60 * 1000;
const COLORS = ['pink', 'mint', 'cream', 'lavender'];

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), ms);
}
function overlay(title, body = '', actions = []) {
  const l = $('tpLoading'); l.classList.remove('is-done'); l.replaceChildren();
  const box = document.createElement('div'); box.className = 'tp-card';
  const h = document.createElement('strong'); h.textContent = title; box.append(h);
  if (body) { const p = document.createElement('p'); p.textContent = body; box.append(p); }
  for (const [label, fn] of actions) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    if (typeof fn === 'string') { const a = document.createElement('a'); a.href = fn; a.textContent = label; box.append(a); continue; }
    b.addEventListener('click', fn); box.append(b);
  }
  l.append(box);
}
const hideOverlay = () => $('tpLoading').classList.add('is-done');

export function cellOf(cat, x, y) {
  const c = cat.world.cell, i = Math.floor(x / c), j = Math.floor(y / c);
  if (j < 0 || i < 0 || j >= cat.grid.length || i >= cat.grid[0].length) return -1;
  return cat.grid[j][i];
}
export const walkable = (cat, x, y) => { const k = cellOf(cat, x, y); return k !== -1 && k !== 3; };
// 간식 자리: 서버(functions/tamagotchi-park.js snackSpot)와 같은 식
export function snackSpot(spots, room, slot) {
  const n = Number(String(room).slice(1)) || 1;
  return spots[(slot * 7919 + n * 104729) % spots.length];
}
const petUrl = (look) => `assets/tamagotchi/mongsil-${COLORS.includes(look && look.c) ? look.c : 'cream'}.svg`;
const errMsg = (e) => String((e && e.message) || '').replace(/^.*?:\s*/, '') || '잠시 뒤 다시 시도해 주세요.';

async function main() {
  const cat = await (await fetch(`catalog/tamagotchi-park.json${V}`)).json();
  const { w: W, h: H } = cat.world;
  const app = new Application();
  await app.init({ resizeTo: window, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), background: '#eef1fa' });
  if (mobile) app.ticker.maxFPS = 30;
  $('tpStage').append(app.canvas);

  const tex = {};
  const urls = { ground: cat.ground, ...cat.sprites };
  for (const c of COLORS) urls[`pet-${c}`] = `assets/tamagotchi/mongsil-${c}.svg`;
  for (const id of Object.keys(WEAR_ITEMS)) urls[`wear-${id}`] = `assets/tamagotchi/wear/${id}.png`;
  await Promise.all(Object.entries(urls).map(async ([k, u]) => { tex[k] = await Assets.load(u); }));

  const world = new Container(); app.stage.addChild(world);
  world.addChild(new Sprite(tex.ground));
  const under = new Container(); world.addChild(under); // 발밑 표시·그림자
  const layer = new Container(); layer.sortableChildren = true; world.addChild(layer);
  const top = new Container(); world.addChild(top); // 감정표현·이름표

  const bushes = [];
  for (const it of cat.items) {
    const s = new Sprite(tex[it.n]); s.anchor.set(0.5, 1); s.scale.set(it.s / cat.spriteScale[it.n]);
    s.position.set(it.x, it.y); s.zIndex = it.y; layer.addChild(s);
    if (it.n.startsWith('bush-hide')) bushes.push({ s, x: it.x, cy: it.y - s.height * 0.28, rx: s.width * 0.40, ry: s.height * 0.26, wig: 0 });
  }
  const inBush = (x, y) => bushes.find((b) => ((x - b.x) / b.rx) ** 2 + ((y - b.cy) / b.ry) ** 2 < 1) || null;
  const snackSprite = new Sprite(tex[cat.snackSprite]); snackSprite.anchor.set(0.5, 1); snackSprite.scale.set(0.3 / cat.spriteScale[cat.snackSprite]); snackSprite.visible = false;
  layer.addChild(snackSprite);

  // ---------- 펫(나·다른 펫 공통 그리기) ----------
  const pets = new Map(); // session → pet
  function makePet(session, m, mine) {
    const p = { session, mine, x: m.x, y: m.y, tx: m.x, ty: m.y, face: 1, t: Math.random() * 9, moving: false, bush: null, emo: '', emoT: 0, emoSeen: m.e || '', follow: m.f || '', name: m.name || '', page: m.page || '', look: m.look || {} };
    const key = `pet-${COLORS.includes(p.look.c) ? p.look.c : 'cream'}`;
    // 펫 = 꾸미기 뒤(망토) + 몸 + 꾸미기 앞(머리·얼굴·목). 좌표는 몽실이 viewBox(80 20 1250 1100) 그대로 쓰고 한 번에 줄인다.
    p.sprite = new Container();
    const art = new Container(); const k = PET_W / 1250; art.scale.set(k); art.position.set(-PET_W / 2 - 80 * k, -PET_H + 6 - 20 * k);
    const wearSprite = (id) => {
      const it = WEAR_ITEMS[id]; const w = new Sprite(tex[`wear-${id}`]); w.anchor.set(0.5);
      const f = Math.min(it.w / w.texture.width, it.h / w.texture.height); w.scale.set(f); // 이미지 비율 유지(meet)
      w.position.set(it.x + it.w / 2, it.y + it.h / 2); w.rotation = ((it.rot || 0) * Math.PI) / 180; return w;
    };
    const wear = p.look.w && typeof p.look.w === 'object' ? p.look.w : {};
    const ok = (slot) => { const id = wear[slot]; return WEAR_ITEMS[id] && WEAR_ITEMS[id].slot === slot ? id : ''; };
    if (ok('back')) art.addChild(wearSprite(ok('back')));
    const body = new Sprite(tex[key]); body.position.set(80, 20); body.width = 1250; body.height = 1100; art.addChild(body);
    for (const slot of ['neck', 'face', 'head']) if (ok(slot)) art.addChild(wearSprite(ok(slot)));
    p.sprite.addChild(art);
    p.shadow = new Graphics().ellipse(6, 0, 28, 9).fill({ color: 0x3c4678, alpha: 0.25 });
    if (mine) { p.mark = new Graphics().ellipse(0, 0, 36, 12).fill({ color: 0xffd65a, alpha: 0.55 }); under.addChild(p.mark); }
    under.addChild(p.shadow); layer.addChild(p.sprite);
    p.emoText = new Text({ text: '', style: { fontSize: 30 } }); p.emoText.anchor.set(0.5, 1);
    p.tag = new Text({ text: '', style: { fontSize: 15, fontWeight: '800', fill: 0x5b3a2a, stroke: { color: 0xffffff, width: 4 } } }); p.tag.anchor.set(0.5, 1); p.tag.visible = false;
    top.addChild(p.emoText, p.tag);
    pets.set(session, p); return p;
  }
  function dropPet(session) {
    const p = pets.get(session); if (!p) return;
    p.sprite.destroy(); p.shadow.destroy(); p.emoText.destroy(); p.tag.destroy(); if (p.mark) p.mark.destroy();
    pets.delete(session);
    for (const q of pets.values()) if (q.follow === session) q.follow = '';
  }
  function showEmo(p, code) { const g = EMO_OF[code]; if (!g) return; p.emo = g; p.emoT = 2; }

  // ---------- 상태 ----------
  const S = { room: '', session: '', serverOffset: 0, picked: false, takenSlot: -1, pickBusy: false, lastSend: 0, pending: null, sendTimer: 0, emoSeq: 0, lastInput: Date.now(), joined: false, subs: [], spots: cat.snackSpots, slotMs: 600000, followStart: 0 };
  const now = () => Date.now() + S.serverOffset;
  let me = null;

  // 내 세션 노드에 보내기: 최소 1.1초 간격, 그 사이 바뀐 값은 마지막 것만 모아 보낸다
  function queue(patch) {
    if (!S.joined) return;
    S.pending = { ...(S.pending || {}), ...patch };
    const wait = Math.max(0, S.lastSend + SEND_GAP - Date.now());
    if (!S.sendTimer) S.sendTimer = setTimeout(flush, wait);
  }
  function flush() {
    S.sendTimer = 0; if (!S.pending || !S.joined) return;
    const body = { ...S.pending, t: serverTimestamp() }; S.pending = null; S.lastSend = Date.now();
    update(ref(rtdb, `tamagotchiPark/rooms/${S.room}/${S.session}`), body).catch((e) => console.warn('공원 위치 전송 실패', e.message));
  }
  let lastSentTarget = null;
  function sendTarget() {
    if (!me || me.follow) return;
    const x = Math.round(me.tx), y = Math.round(me.ty);
    if (lastSentTarget && lastSentTarget[0] === x && lastSentTarget[1] === y) return;
    lastSentTarget = [x, y]; queue({ x, y });
  }

  // ---------- 조작 ----------
  const cam = { x: cat.entry[0] - app.screen.width / 2, y: cat.entry[1] - app.screen.height / 2 };
  const clampCam = () => { cam.x = Math.max(0, Math.min(W - app.screen.width, cam.x)); cam.y = Math.max(0, Math.min(H - app.screen.height, cam.y)); };
  let hold = null, blockedAt = 0;
  const hitPet = (x, y) => [...pets.values()].find((q) => !q.mine && !q.bush && Math.abs(q.x - x) < PET_W * 0.45 && y < q.y + 6 && y > q.y - PET_H);
  const aim = (gx, gy) => {
    if (!me) return; S.lastInput = Date.now();
    const x = gx + cam.x, y = gy + cam.y;
    if (walkable(cat, x, y)) {
      if (me.follow) { me.follow = ''; queue({ f: null }); }
      me.tx = x; me.ty = y; sendTarget(); return;
    }
    if (performance.now() - blockedAt > 1500) { blockedAt = performance.now(); toast('거기는 들어갈 수 없어요'); }
  };
  app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e) => {
    if (!me) return;
    const x = e.global.x + cam.x, y = e.global.y + cam.y;
    const q = hitPet(x, y);
    if (q) {
      q.tag.text = q.page ? `${q.name} · ${q.page}` : q.name; q.tag.visible = true; q.tagT = 3;
      const lead = q.follow ? (pets.get(q.follow) || q) : q; // 따라가는 펫을 누르면 맨 앞 펫을 따라간다
      if (lead !== me && !lead.mine) { me.follow = lead.session; S.followStart = Date.now(); queue({ f: lead.session }); toast(`${lead.name || '친구'}를 따라가요 · 땅을 누르면 그만`); }
      return;
    }
    hold = { x: e.global.x, y: e.global.y }; aim(hold.x, hold.y);
  });
  app.stage.on('pointermove', (e) => { if (hold) { hold.x = e.global.x; hold.y = e.global.y; } });
  const release = () => { hold = null; };
  app.stage.on('pointerup', release); app.stage.on('pointerupoutside', release);
  window.addEventListener('blur', release);
  for (const [g, code] of EMOTES) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = g; b.setAttribute('aria-label', `감정표현 ${g}`);
    b.addEventListener('click', () => { if (!me) return; S.lastInput = Date.now(); showEmo(me, code); S.emoSeq = (S.emoSeq + 1) % 1e6; queue({ e: `${code}:${S.emoSeq}` }); });
    $('tpEmotes').append(b);
  }

  // ---------- 입장·구독 ----------
  function unsubscribe() { for (const u of S.subs) u(); S.subs = []; }
  function leaveLocal() {
    S.joined = false; unsubscribe(); clearTimeout(S.sendTimer); S.sendTimer = 0; S.pending = null;
    for (const k of [...pets.keys()]) dropPet(k); me = null; snackSprite.visible = false;
  }
  async function leave() {
    if (S.joined && S.session) await remove(ref(rtdb, `tamagotchiPark/rooms/${S.room}/${S.session}`)).catch(() => {});
    leaveLocal();
  }
  function subscribe() {
    const roomRef = ref(rtdb, `tamagotchiPark/rooms/${S.room}`);
    const onMember = (snap) => {
      const m = snap.val(); if (!m) return;
      let p = pets.get(snap.key);
      if (!p) { p = makePet(snap.key, m, snap.key === S.session); if (p.mine) me = p; return; }
      if (p.mine) return; // 내 펫은 내 화면이 기준
      if (typeof m.x === 'number') { p.tx = m.x; p.ty = m.y; }
      p.follow = m.f || '';
      if (m.e && m.e !== p.emoSeen) { p.emoSeen = m.e; showEmo(p, String(m.e).split(':')[0]); }
    };
    S.subs.push(onChildAdded(roomRef, onMember), onChildChanged(roomRef, onMember));
    S.subs.push(onChildRemoved(roomRef, async (snap) => {
      if (snap.key !== S.session) { dropPet(snap.key); return; }
      // 내가 빠짐: 교대 또는 끊김
      const bumped = (await get(ref(rtdb, `tamagotchiPark/bumped/${S.session}`)).catch(() => null))?.val();
      leaveLocal();
      if (bumped && bumped.why === 'guest') overlay('펫과 함께 온 친구에게 자리를 양보했어요', '공원이 가득 차면 펫을 데려온 친구가 먼저 들어와요. 조금 뒤 다시 와 주세요.', [['다시 들어가기', () => void enter()], ['마을로', 'tamagotchi-world.html']]);
      else if (bumped) overlay('스트리머가 직접 산책하러 왔어요', '이 펫은 지금 스트리머와 함께 걸어요. 다음에 또 데려와 주세요.', [['마을로', 'tamagotchi-world.html']]);
      else overlay('공원과 연결이 끊겼어요', '', [['다시 들어가기', () => void enter()], ['마을로', 'tamagotchi-world.html']]);
    }));
    S.subs.push(onValue(ref(rtdb, `tamagotchiPark/taken/${S.room}`), (snap) => { S.takenSlot = Number(snap.val()) || -1; }));
  }
  async function joinWith(streamerId, petId) {
    overlay('공원으로 걸어가는 중…');
    let out;
    try { out = (await parkCall(petId ? { action: 'join', streamerId, petId } : { action: 'join', streamerId, guest: true })).data; }
    catch (e) { overlay('공원에 들어가지 못했어요', errMsg(e), [['다시 시도', () => void enter()], ['마을로', 'tamagotchi-world.html']]); return; }
    S.room = out.room; S.session = out.session; S.serverOffset = out.serverNow - Date.now(); S.picked = !!out.pickedToday; S.slotMs = out.snackSlotMs || S.slotMs;
    S.joined = true; S.lastSend = Date.now(); S.lastInput = Date.now();
    onDisconnect(ref(rtdb, `tamagotchiPark/rooms/${S.room}/${S.session}`)).remove();
    subscribe(); hideOverlay();
    if (out.guest) S.picked = true; // 손님 펫은 간식을 못 줍는다(흐리게 보이기만)
    if (out.bumped) toast('팬들이 데려온 펫과 교대했어요');
    toast(out.guest ? `손님 몽실이와 공원 ${S.room.slice(1)}번 · 땅을 누르면 걸어가요` : `공원 ${S.room.slice(1)}번 · 땅을 누르면 걸어가요`);
  }
  async function enter() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
      overlay('로그인하면 공원에 들어갈 수 있어요', '펫과 함께 다른 펫들을 만나요.', [['로그인하기', () => window.openShopLoginModal?.({ then: () => void enter() })], ['마을로', 'tamagotchi-world.html']]);
      return;
    }
    overlay('함께 걸을 펫을 찾는 중…');
    const streamerId = String(new URLSearchParams(location.search).get('s') || '').trim().toLowerCase();
    let info;
    try { info = (await parkCall({ action: 'pets', streamerId })).data; }
    catch (e) { overlay('공원에 들어가지 못했어요', errMsg(e), [['다시 시도', () => void enter()], ['마을로', 'tamagotchi-world.html']]); return; }
    const sid = info.streamer ? info.streamer.id : streamerId;
    if (!info.pets.length) {
      overlay(info.streamer ? '이 팬페이지에는 아직 펫이 없어요' : '함께 걸을 펫이 없어요', '손님 몽실이와 공원을 구경할 수 있어요. 간식 줍기는 분양받은 펫과 함께일 때만 돼요.',
        [['손님으로 산책하기', () => void joinWith(sid, '')], ['분양소 가기', 'tamagotchi.html'], ['마을로', 'tamagotchi-world.html']]);
      return;
    }
    if (info.pets.length === 1) { await joinWith(info.streamer.id, info.pets[0].petId); return; }
    overlay(`${info.streamer.nickname} 팬페이지의 펫`, '함께 산책할 펫을 골라 주세요.',
      info.pets.map((p) => [p.nickname || '펫', () => void joinWith(info.streamer.id, p.petId)]));
  }

  // ---------- 매 프레임 ----------
  const tStart = performance.now();
  const meTag = new Text({ text: '▼ 나', style: { fontSize: 18, fontWeight: '800', fill: 0x5b3a2a } }); meTag.anchor.set(0.5, 1); top.addChild(meTag);
  app.ticker.add((tk) => {
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    for (const p of pets.values()) {
      if (p.follow) {
        const f = pets.get(p.follow);
        if (!f || f.follow) { p.follow = ''; if (p.mine) queue({ f: null }); }
        else { const a = Math.atan2(p.y - f.y, p.x - f.x); p.tx = f.x + Math.cos(a) * 70; p.ty = f.y + Math.sin(a) * 40; }
        if (p.mine && p.follow && Date.now() - S.followStart > 3 * 60 * 1000) { p.follow = ''; queue({ f: null }); sendTarget(); toast('따라가기가 끝났어요'); }
      }
      const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
      if (d > 4) {
        const s = Math.min(1, SPEED * (d > 400 && !p.mine ? 2 : 1) * dt / d), nx = p.x + dx * s, ny = p.y + dy * s;
        if (walkable(cat, nx, ny)) { p.x = nx; p.y = ny; p.moving = true; if (Math.abs(dx) > 2) p.face = dx < 0 ? -1 : 1; }
        else { p.tx = p.x; p.ty = p.y; p.moving = false; }
      } else p.moving = false;
      p.t += dt;
      const b = inBush(p.x, p.y); if (b && b !== p.bush) b.wig = 0.6; p.bush = b;
      const bob = reduced ? 0 : (p.moving ? Math.abs(Math.sin(p.t * 11)) * 7 : Math.sin(p.t * 2) * 1.5);
      const sq = (!reduced && p.moving) ? 1 + Math.sin(p.t * 22) * 0.04 : 1;
      p.sprite.position.set(p.x, p.y - bob); p.sprite.zIndex = p.y;
      p.sprite.scale.set(p.face / sq, sq);
      p.shadow.position.set(p.x, p.y); if (p.mark) p.mark.position.set(p.x, p.y);
      if (p.emoT > 0) p.emoT -= dt;
      p.emoText.text = p.emoT > 0 ? p.emo : ''; p.emoText.alpha = Math.min(1, Math.max(0, p.emoT) * 2);
      const head = p.bush ? Math.min(p.y - PET_H, p.bush.s.y - p.bush.s.height * 0.9) : p.y - PET_H;
      p.emoText.position.set(p.x, head - 16 - (2 - Math.max(0, p.emoT)) * 6);
      if (p.tagT > 0) { p.tagT -= dt; p.tag.position.set(p.x, head - 6); } else p.tag.visible = false;
    }
    for (const bb of bushes) { if (bb.wig > 0) { bb.wig -= dt; bb.s.rotation = reduced ? 0 : Math.sin(bb.wig * 40) * 0.03 * (bb.wig / 0.6); } else bb.s.rotation = 0; }

    // 간식: 방·시간칸으로 자리를 계산, 누가 주웠으면(taken) 감춘다
    if (S.joined && me) {
      const slot = Math.floor(now() / S.slotMs); const [sx, sy] = snackSpot(S.spots, S.room, slot);
      const show = S.takenSlot !== slot;
      snackSprite.visible = show; snackSprite.alpha = S.picked ? 0.45 : 1;
      snackSprite.position.set(sx, sy - (reduced ? 0 : Math.abs(Math.sin(performance.now() / 300)) * 6)); snackSprite.zIndex = sy;
      if (show && !S.picked && !S.pickBusy && Math.hypot(me.x - sx, me.y - sy) < 50) {
        S.pickBusy = true; queue({ x: Math.round(me.x), y: Math.round(me.y) }); flush();
        setTimeout(() => {
          parkCall({ action: 'pickup', session: S.session, slot }).then((r) => {
            S.picked = true; S.takenSlot = slot; showEmo(me, 'pick'); S.emoSeq += 1; queue({ e: `pick:${S.emoSeq}` });
            toast(`간식을 주웠어요! (가방 ${r.data.bag}개)`);
          }).catch((e) => { const m = errMsg(e); if (/이미 주웠/.test(m)) S.picked = true; toast(m); })
            .finally(() => { setTimeout(() => { S.pickBusy = false; }, 3000); });
        }, 400);
      }
      if (Date.now() - S.lastInput > IDLE_MS) {
        void leave().then(() => overlay('오래 쉬어서 공원에서 나왔어요', '', [['다시 들어가기', () => void enter()], ['마을로', 'tamagotchi-world.html']]));
      }
    }

    meTag.visible = !!me && performance.now() - tStart < 6000; if (me) meTag.position.set(me.x, me.y - PET_H - 10);
    if (hold) aim(hold.x, hold.y);
    const focus = me || { x: cat.entry[0], y: cat.entry[1] };
    const zw = app.screen.width * 0.18, zh = app.screen.height * 0.16, cx = cam.x + app.screen.width / 2, cy = cam.y + app.screen.height / 2;
    let gx = cam.x, gy = cam.y;
    if (focus.x < cx - zw) gx = focus.x + zw - app.screen.width / 2; if (focus.x > cx + zw) gx = focus.x - zw - app.screen.width / 2;
    if (focus.y < cy - zh) gy = focus.y + zh - app.screen.height / 2; if (focus.y > cy + zh) gy = focus.y - zh - app.screen.height / 2;
    const f = reduced ? 1 : Math.min(1, dt * 6); cam.x += (gx - cam.x) * f; cam.y += (gy - cam.y) * f;
    clampCam(); world.position.set(-Math.round(cam.x), -Math.round(cam.y));
  });

  // 탭을 숨기면 그리기·연결을 멈추고, 돌아오면 다시 잇는다(세션이 지워졌으면 그때 끊김 안내)
  // 잠깐 다른 탭에 다녀오는 건(1분 안) 같은 세션을 그대로 이어 쓴다. 그보다 길면 연결을 끊어 자리를 비운다.
  let offTimer = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { app.ticker.stop(); offTimer = setTimeout(() => { offTimer = 0; goOffline(rtdb); }, 60000); }
    else { if (offTimer) { clearTimeout(offTimer); offTimer = 0; } else goOnline(rtdb); app.ticker.start(); S.lastInput = Date.now(); }
  });
  window.addEventListener('pagehide', () => { if (S.joined) void leave(); });

  // 로컬 시연(?demo=1, localhost만): 서버 없이 꾸민 펫들을 띄워 그림을 확인한다. 공개 사이트에서는 동작하지 않는다.
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && new URLSearchParams(location.search).has('demo')) {
    const looks = [
      { c: 'pink', w: { head: 'hat', face: 'glasses' } }, { c: 'mint', w: { head: 'ribbon', neck: 'necklace' } },
      { c: 'cream', w: { back: 'cape', head: 'hat' } }, { c: 'lavender', w: { face: 'glasses', back: 'cape', neck: 'necklace' } }, { c: 'cream', w: {} },
    ];
    looks.forEach((look, i) => {
      const p = makePet(`demo${i}`, { x: 1000 + i * 110, y: 760 + (i % 2) * 50, look, name: `시연${i}` }, i === 0);
      if (i === 0) me = p;
    });
    S.room = 'r1'; hideOverlay(); toast('로컬 시연 모드');
    window.__parkDemo = { pets, me };
    return;
  }
  let started = false;
  onAuthStateChanged(auth, () => { if (!started) { started = true; void enter(); } else if (!S.joined) void enter(); });
}

main().catch((err) => {
  console.error(err);
  overlay('공원을 불러오지 못했어요', '새로고침해 주세요.');
});

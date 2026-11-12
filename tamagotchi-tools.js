// 상호작용 도구(마우스·터치). 도구를 고르면 커서 자리에 도구 일러스트가 나타나고 펫에게 직접 한다.
// 도구는 DOM 오버레이(pointer-events:none)로 그린다. 마우스는 커서 위치가 닿는 점, 터치는 손가락 위쪽에 띄워 가리지 않게 한다.
import { createWalkMode } from './tamagotchi-walk.js?v=20261113-tg-care2';
import { insideEllipse, createRubTracker, toolPlacement } from './tamagotchi-gestures.mjs?v=20261113-tg-care2';

export const TOOLS = {
  pet: {
    id: 'pet', label: '쓰다듬기', src: 'assets/tamagotchi/tools/pet.svg', hotspot: [128, 150], mode: 'rub',
    preset: '쓰다듬 받음', fx: 'heart', tip: '누른 채 문질러 보세요', done: '쓰다듬기 중… 기분이 좋아졌어요 ♥',
    hint: '펫 위에서 누른 채 문질러 보세요. 다시 누르면 선택이 풀려요.',
  },
  feed: {
    id: 'feed', label: '밥주기', src: 'assets/tamagotchi/tools/feed.svg', hotspot: [88, 86], mode: 'tap', target: 'mouth', nudge: [24, 18],
    preset: '먹기', fx: 'heart', tip: '입 근처를 눌러 먹여 보세요', done: '냠냠, 맛있게 먹었어요 ♥',
    hint: '펫의 입 근처를 눌러 한 입씩 먹여 보세요. 다시 누르면 선택이 풀려요.',
    // 터치 기기 문구(손가락이 입을 가리므로 펫 어디든 눌러도 먹는다)
    tipTouch: '펫을 누르고 있으면 먹어요', hintTouch: '펫을 누르고 있으면 한 입씩 계속 먹어요. 다시 누르면 선택이 풀려요.',
  },
  groom: {
    id: 'groom', label: '털갈이', src: 'assets/tamagotchi/tools/groom.svg', hotspot: [78, 68], mode: 'rub', threshold: 200,
    preset: '털갈이', fx: 'spark', tip: '누른 채 쓸어 보세요', done: '털이 몽실몽실 말끔해졌어요 ✦',
    hint: '펫 위에서 누른 채 쓸어 보세요. 다시 누르면 선택이 풀려요.',
  },
  gem: {
    id: 'gem', label: '하트 보석', src: 'assets/tamagotchi/tools/gem.svg', hotspot: [128, 100], mode: 'tap', trail: 'heart', quiet: true,
    preset: '보석', fx: 'spark', tip: '펫을 눌러 건네 보세요', done: '반짝이는 보석을 받았어요 ✦',
    hint: '펫을 눌러 보석을 건네 보세요. 다시 누르면 선택이 풀려요.',
  },
  play: {
    id: 'play', label: '놀기', src: 'assets/tamagotchi/tools/play.svg', hotspot: [128, 128], mode: 'tap', scale: 0.85, chase: true, anywhere: true,
    preset: '놀기', fx: 'spark', tip: '어디든 눌러 공을 던져 보세요', done: '신나게 뛰어놀았어요 ✦',
    hint: '화면 어디든 눌러 공을 던져 주세요. 누르고 있으면 펫이 다가와요. 다시 누르면 선택이 풀려요.',
  },
  bath: {
    id: 'bath', label: '목욕', src: 'assets/tamagotchi/tools/bath.svg', hotspot: [114, 148], mode: 'rub', threshold: 220, water: true, holdFx: 'bubble', foam: true,
    preset: '목욕', fx: 'bubble', tip: '누른 채 샤워해 주세요', done: '보송보송 개운해졌어요 ✦',
    hint: '펫 위에서 누른 채 움직여 샤워해 주세요. 다시 누르면 선택이 풀려요.',
  },
  nap: {
    id: 'nap', label: '낮잠', src: 'assets/tamagotchi/tools/nap.svg', hotspot: [205, 176], mode: 'once', restEvery: 12000, restStep: 1,
    preset: '잠', fx: null, tip: '펫을 한 번 눌러 재워 주세요', done: '쿨쿨… 포근하게 잠들었어요 z',
    hint: '펫을 한 번 누르면 낮잠을 자요. 자는 동안 피로가 조금씩 풀려요. 다른 상호작용을 하면 깨어나요.',
  },
  walk: {
    id: 'walk', label: '산책', src: 'assets/tamagotchi/tools/walk.svg', hotspot: [52, 50], mode: 'walk', scale: 1.1,
    preset: '산책', fx: null, tip: '클릭하거나 누른 채 같이 걸어요', done: '산책 중',
    hint: '산책로 어디든 클릭하면 걸어가고, 누르고 있으면 따라와요. 다시 누르면 산책이 끝나요.',
  },
  talk: {
    id: 'talk', label: '수다', src: 'assets/tamagotchi/tools/talk.svg', hotspot: [105, 95], mode: 'tap',
    preset: '대화', fx: 'speech', tip: '펫을 눌러 말을 걸어 보세요', done: '도란도란 이야기를 나눴어요 💬',
    hint: '펫을 눌러 말을 걸어 보세요. 누르고 있으면 대화가 이어져요. 다시 누르면 선택이 풀려요.',
  },
  sing: {
    id: 'sing', label: '노래', src: 'assets/tamagotchi/tools/sing.svg', hotspot: [103, 92], mode: 'tap',
    preset: '노래', fx: 'note', tip: '펫을 눌러 노래를 불러 주세요', done: '흥얼흥얼 노래해요 ♪',
    hint: '펫을 눌러 마이크를 건네 보세요. 누르고 있으면 계속 불러요. 다시 누르면 선택이 풀려요.',
  },
  dance: {
    id: 'dance', label: '춤', src: 'assets/tamagotchi/tools/dance.svg', hotspot: [208, 76], mode: 'tap', scale: 1.1,
    preset: '춤', fx: 'note', tip: '펫을 눌러 춤추게 해 보세요', done: '리듬에 맞춰 춤춰요 ♪',
    hint: '펫을 눌러 리본을 흔들어 보세요. 누르고 있으면 계속 춰요. 다시 누르면 선택이 풀려요.',
  },
  cheer: {
    id: 'cheer', label: '응원', src: 'assets/tamagotchi/tools/cheer.svg', hotspot: [100, 80], mode: 'tap',
    preset: '응원', fx: 'spark', tip: '펫을 눌러 응원해 주세요', done: '힘이 솟아요! 파이팅 ✦',
    hint: '펫을 눌러 응원봉을 흔들어 주세요. 응원은 한 번에 한 번씩이에요. 다시 누르면 선택이 풀려요.',
  },
};
// 모듈 기준 경로: 팬페이지에서 불러와도 상점의 도구 그림을 찾는다
for (const tool of Object.values(TOOLS)) tool.src = new URL(tool.src, import.meta.url).href;
// 움직이지 않는 톡 도구: 누르고 있으면 0.6초 뒤부터 천천히 계속(최대 20초). 보석·응원은 선물이라 1회만.
export const HOLDABLE = ['feed', 'play', 'talk', 'sing', 'dance'];
export const HOLD_DELAY_MS = 600; export const HOLD_MAX_MS = 20000; const HOLD_TICK_MS = 250;
const DESKTOP_SIZE = 72; const TOUCH_SIZE = 88;

// 상호작용별 소리: keep = 하는 동안 반복(멈추면 서서히 꺼짐), once = 한 번(gap 안에서는 겹치지 않음)
const SFX = { pet: 'keep', feed: 'keep', groom: 'keep', bath: 'keep', sing: 'keep', dance: 'keep', cheer: 'keep', play: 'once', gem: 'once', talk: 'once' };
const ONCE_GAP = { talk: 2300, play: 300, gem: 600 };
export function createToolController({ stage, petApi, petEl, ignoreOutside = [], onChange, reduced = false, sound = null }) {
  const cursor = document.createElement('div');
  cursor.className = 'tg-tool-cursor'; cursor.hidden = true; cursor.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img'); img.alt = ''; img.draggable = false;
  // 목욕: 샤워기 끝에서 떨어지는 물줄기(누르는 동안만 보인다)
  const water = document.createElement('div'); water.className = 'tg-water';
  water.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
  cursor.append(img, water); document.body.append(cursor);
  const walk = petEl ? createWalkMode({ stage, petEl, petApi, reduced, onChange: (e) => { if (e.type === 'step') sound?.once('step', 900); else onChange?.(e); } }) : null;
  function sfx(id) {
    if (!sound || !SFX[id]) return;
    if (SFX[id] === 'keep') sound.keep(id, REPEAT_MS + 450); else sound.once(id, ONCE_GAP[id]);
  }

  let selected = null; let pressed = false; let activePointer = null; let rubCount = 0;
  let tracker = createRubTracker();
  let holdTimer = 0; let lastX = 0; let lastY = 0;
  let fatigue = 80; // 미리보기용 피로(서버 저장 없음)
  const REPEAT_MS = 650;

  function place(event) {
    const tool = TOOLS[selected]; if (!tool) return;
    const touch = event.pointerType === 'touch';
    const size = (touch ? TOUCH_SIZE : DESKTOP_SIZE) * (tool.scale || 1);
    cursor.style.width = `${size}px`; cursor.style.height = `${size}px`;
    const p = toolPlacement({ pointerType: event.pointerType, x: event.clientX, y: event.clientY, size, hotspot: tool.hotspot });
    const [nx, ny] = tool.nudge || [0, 0]; // 입을 가리지 않도록 도구를 닿는 점에서 비켜 그린다
    cursor.style.transform = `translate(${p.left + nx}px, ${p.top + ny}px)`;
  }
  // 크게 보기(전체화면)에서는 전체화면 요소 바깥이 그려지지 않으므로 도구 그림을 그 안으로 옮긴다.
  function ensureHost() {
    const host = document.fullscreenElement || stage.closest('.is-expanded') || document.body;
    if (cursor.parentNode !== host) host.append(cursor);
  }
  let lastType = 'mouse';
  function show(event) { if (!selected) return; lastX = event.clientX; lastY = event.clientY; lastType = event.pointerType || 'mouse'; ensureHost(); cursor.hidden = false; place(event); }
  function overPet() {
    const tool = TOOLS[selected];
    if (tool && tool.anywhere) return true; // 무대 어디를 눌러도 인정(포인터 이벤트가 무대에서만 들어온다)
    // 밥주기: 마우스는 입 근처만, 터치는 손가락이 입을 가리므로 펫 어디를 눌러도 먹는다.
    if (tool && tool.target === 'mouth' && lastType !== 'touch') return insideEllipse(lastX, lastY, petApi.mouthRect(), 1);
    return insideEllipse(lastX, lastY, petApi.bodyRect());
  }
  // 공 놀이: 펫이 포인터 쪽으로 몸을 기울이고 따라온다.
  function followPointer(event) {
    const tool = TOOLS[selected];
    if (!tool || !tool.chase || (event.pointerType === 'touch' && !pressed)) return;
    // 누르는 동안은 포인터 바로 옆까지 다가오고, 누르지 않을 때는 살짝 기울어 쳐다본다.
    petApi.chase(event.clientX, event.clientY, pressed ? 150 : 36);
  }
  // 하트 보석: 도구가 펫 위를 지나간 자리에 하트를 남긴다(약 28px마다 하나).
  let trailLast = null;
  function trailAt(event) {
    const tool = TOOLS[selected];
    if (!tool || !tool.trail || (event.pointerType === 'touch' && !pressed)) return;
    if (!insideEllipse(event.clientX, event.clientY, petApi.bodyRect(), 1.05)) { trailLast = null; return; }
    if (trailLast && Math.hypot(event.clientX - trailLast[0], event.clientY - trailLast[1]) < 28) return;
    trailLast = [event.clientX, event.clientY];
    petApi.heartAt?.(event.clientX, event.clientY);
  }
  function restChase() { petApi.chase(); }
  // 목욕: 무대에 김이 서렸다가 끝나면 천천히 걷힌다.
  const steam = document.createElement('div'); steam.className = 'tg-steam'; steam.setAttribute('aria-hidden', 'true');
  stage.append(steam);
  let steamLevel = 0; let steamTimer = 0;
  function bathTick(tool) {
    if (!tool.foam) return;
    petApi.foam?.();
    steamLevel = Math.min(0.85, steamLevel + 0.05);
    steam.classList.add('is-on'); steam.style.transition = 'opacity 1s ease'; steam.style.opacity = String(steamLevel);
    clearTimeout(steamTimer);
    steamTimer = setTimeout(() => { steamLevel = 0; steam.style.transition = 'opacity 7s ease'; steam.style.opacity = '0'; steamTimer = setTimeout(() => steam.classList.remove('is-on'), 7100); }, 2000);
  }
  // 낮잠: 펫이 자는 동안(누르지 않아도) 일정 주기로 피로가 줄어든다. 깨어나면 멈춘다.
  let restTimer = 0;
  function startRest(tool) {
    clearInterval(restTimer);
    restTimer = setInterval(() => {
      if (!petApi.isSleeping?.()) { clearInterval(restTimer); return; }
      if (fatigue <= 0) return;
      fatigue = Math.max(0, fatigue - tool.restStep);
      if (fatigue === 0) sound?.once('bonus');
      onChange?.({ type: 'stat', tool: 'nap', stat: 'fatigue', value: fatigue, delta: -tool.restStep });
    }, tool.restEvery);
  }
  function stopHold() { clearInterval(holdTimer); holdTimer = 0; }
  // 누르고 있는 동안: 탭 도구는 일정 간격으로 계속 반복하고, 문지르기 도구는 가만히 눌러도 표정을 유지한다.
  function tapAct() {
    const tool = TOOLS[selected]; if (!tool) return;
    rubCount += 1; petApi.hold(tool.preset, 1.6, { quiet: !!tool.quiet }); if (tool.fx) petApi.fx(tool.fx); popDone(); sfx(selected);
    onChange?.({ type: 'act', tool: selected, count: rubCount });
  }
  // 누르고 있기: 톡 도구 중 HOLDABLE만 0.6초 뒤부터 HOLD_TICK_MS마다 'hold' 이벤트(ms)를 보낸다. 20초가 차면 만족 이모지.
  let heldMs = 0; let holdStarted = 0;
  function satisfied() {
    stopHold(); onChange?.({ type: 'holdDone', tool: selected, ms: heldMs });
    const r = petApi.bodyRect(); const host = stage.getBoundingClientRect();
    const emoji = document.createElement('span'); emoji.className = `tg-satisfied${reduced ? ' is-reduced' : ''}`; emoji.textContent = '😊'; emoji.setAttribute('aria-hidden', 'true');
    emoji.style.left = `${r.left - host.left + r.width / 2}px`; emoji.style.top = `${r.top - host.top}px`;
    stage.append(emoji); setTimeout(() => emoji.remove(), 1300);
  }
  function startHold(tool) {
    stopHold();
    if (tool.mode === 'tap') {
      if (!HOLDABLE.includes(selected)) return;
      heldMs = 0; holdStarted = performance.now();
      holdTimer = setInterval(() => {
        if (!pressed || !selected || !overPet()) return;
        if (performance.now() - holdStarted < HOLD_DELAY_MS) return;
        const ms = Math.min(HOLD_TICK_MS, HOLD_MAX_MS - heldMs); heldMs += ms;
        petApi.hold(tool.preset, 0.6, { quiet: !!tool.quiet }); sfx(selected);
        if (tool.fx && Math.random() < 0.12) petApi.fx(tool.fx);
        onChange?.({ type: 'hold', tool: selected, ms, total: heldMs });
        if (heldMs >= HOLD_MAX_MS) satisfied();
      }, HOLD_TICK_MS);
      return;
    }
    holdTimer = setInterval(() => {
      if (!pressed || !selected || !overPet()) return;
      petApi.hold(tool.preset, 1.1); bathTick(tool); sfx(selected); if (tool.holdFx && Math.random() < 0.35) petApi.fx(tool.holdFx);
    }, 500);
  }

  function popDone() {
    if (reduced) return;
    cursor.classList.remove('is-done'); void cursor.offsetWidth; cursor.classList.add('is-done');
  }

  function onDown(event) {
    if (!selected || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target.closest && event.target.closest('.tg-stage-colors, .tg-sound-btn')) return; // 색상 점은 그대로 누를 수 있게
    const tool = TOOLS[selected];
    pressed = true; activePointer = event.pointerId;
    try { stage.setPointerCapture(event.pointerId); } catch (_) { /* 무시 */ }
    show(event); followPointer(event); event.preventDefault();
    if (tool.mode === 'walk') { walk?.down(event); return; }
    if (tool.mode === 'once') {
      if (overPet() && !petApi.isSleeping?.()) {
        petApi.sleep(); rubCount += 1; popDone();
        onChange?.({ type: 'act', tool: selected, count: rubCount });
        startRest(tool);
      }
      return;
    }
    if (tool.mode === 'tap') {
      if (overPet()) tapAct();
      startHold(tool);
      return;
    }
    cursor.classList.add('is-active'); tracker.reset(); tracker.start(); startHold(tool);
  }
  function onMove(event) {
    if (!selected) return;
    show(event); followPointer(event); trailAt(event);
    if (TOOLS[selected].mode === 'walk') walk?.move(event);
    if (!pressed || event.pointerId !== activePointer) return;
    const tool = TOOLS[selected];
    if (tool.mode !== 'rub') return;
    const inside = insideEllipse(event.clientX, event.clientY, petApi.bodyRect());
    const result = tracker.move(event.clientX, event.clientY, inside);
    if (inside) { petApi.hold(tool.preset, 1.1); sfx(selected); }
    if (result.rubbed) {
      rubCount += 1; if (tool.fx) petApi.fx(tool.fx); bathTick(tool); popDone();
      onChange?.({ type: 'act', tool: selected, count: rubCount });
    }
  }
  function onUp(event) {
    if (event.pointerId !== activePointer) return;
    walk?.up(event);
    pressed = false; activePointer = null; stopHold(); tracker.end(); cursor.classList.remove('is-active');
    try { stage.releasePointerCapture(event.pointerId); } catch (_) { /* 무시 */ }
    if (event.pointerType === 'touch') { cursor.hidden = true; restChase(); } else followPointer(event);
  }
  function onLeave(event) { walk?.leave(); if (!pressed && event.pointerType !== 'touch') cursor.hidden = true; restChase(); }
  function onOutside(event) {
    if (!selected) return;
    const target = event.target;
    if (stage.contains(target) || ignoreOutside.some((node) => node && node.contains(target))) return;
    clear();
  }
  function onBlur() { if (selected !== 'walk') sound?.stopAll(); restChase(); stopHold(); pressed = false; activePointer = null; tracker.end(); cursor.classList.remove('is-active'); cursor.hidden = true; }

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('pointerleave', onLeave);
  stage.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') show(event); });
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('blur', onBlur);

  // 건강 상태에 따라 할 수 있는 상호작용(설계 문서 2-2, 8절)
  const ALLOWED = { sick: ['pet', 'feed', 'nap', 'talk'], down: ['pet'], hospital: ['pet', 'talk', 'cheer'] };
  function select(id) {
    const tool = TOOLS[id]; if (!tool) return false;
    const allow = ALLOWED[petApi.condition?.() || 'ok'];
    if (allow && !allow.includes(id)) { onChange?.({ type: 'blocked', tool: id, condition: petApi.condition() }); return false; }
    if (selected && selected !== id && TOOLS[selected].mode === 'walk') walk?.exit();
    if (selected !== id) sound?.stopAll();
    selected = id; img.src = tool.src; rubCount = 0;
    sound?.load(id); if (id === 'walk') { sound?.load('step'); sound?.start('walk'); } if (id === 'nap') sound?.load('bonus');
    if (tool.mode === 'walk') walk?.enter();
    cursor.classList.toggle('has-water', !!tool.water);
    water.style.left = `${(tool.hotspot[0] / 256) * 100}%`; water.style.top = `${(tool.hotspot[1] / 256) * 100}%`;
    tracker = createRubTracker(tool.threshold ? { threshold: tool.threshold } : {});
    stage.classList.add('is-tool-mode');
    onChange?.({ type: 'select', tool: id });
    return true;
  }
  function clear() {
    if (!selected) return;
    const was = selected; sound?.stopAll(); walk?.exit(); stopHold(); selected = null; pressed = false; activePointer = null; tracker.reset();
    cursor.hidden = true; cursor.classList.remove('is-active', 'is-done'); restChase();
    stage.classList.remove('is-tool-mode');
    onChange?.({ type: 'clear', tool: was });
  }
  return {
    setLowPower(on) { walk?.setLowPower(on); },
    select, clear, selected: () => selected, isSupported: (id) => !!TOOLS[id],
    destroy() {
      clear();
      stage.removeEventListener('pointerdown', onDown); stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerdown', onOutside, true); window.removeEventListener('blur', onBlur);
      cursor.remove(); walk?.destroy(); clearTimeout(steamTimer); clearInterval(restTimer); steam.remove();
    },
  };
}

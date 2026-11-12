// 산책 모드(분양소 미리보기). 배경이 탑다운 산책로 지도로 바뀌고, 펫이 28% 크기로 지도 위를 걷는다.
// 클릭하면 그 지점까지 걸어가고, 누르는 동안은 포인터를 목줄 길이만큼 뒤에서 따라온다.
// 펫 크기·위치는 #tgPet 컨테이너의 CSS transform으로 바꾼다(리그 내부는 건드리지 않는다).
import { stepToward, followTarget, clampToBox, isClick } from './tamagotchi-gestures.mjs?v=20261112-tg-shop36';

const SCALE = 0.28;
const LEASH_PX = 60;
const PX_PER_M = 8;
const NS = 'http://www.w3.org/2000/svg';

export function createWalkMode({ stage, petEl, petApi, onChange, reduced = false }) {
  const bg = document.createElement('div'); bg.className = 'tg-walk-bg'; bg.setAttribute('aria-hidden', 'true');
  const leash = document.createElementNS(NS, 'svg'); leash.setAttribute('class', 'tg-walk-leash'); leash.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS(NS, 'path'); const strap = document.createElementNS(NS, 'path');
  outline.setAttribute('class', 'tg-leash-outline'); strap.setAttribute('class', 'tg-leash-strap');
  leash.append(outline, strap);
  const feet = document.createElement('div'); feet.className = 'tg-walk-feet'; feet.setAttribute('aria-hidden', 'true');
  stage.prepend(bg); stage.append(feet, leash);

  let active = false; let raf = 0; let last = 0;
  let base = { x: 0, y: 0 }; let pos = { x: 0, y: 0 }; let target = { x: 0, y: 0 };
  let pointer = null; let pressed = false; let downAt = 0; let downPt = null; let travel = 0;
  let facing = 1; let meters = 0; let footAcc = 0; let footSide = 1; let reported = 0;

  let boxCache = null;
  const box = () => boxCache || (boxCache = stage.getBoundingClientRect());
  const resetBox = () => { boxCache = null; };
  window.addEventListener('resize', resetBox); window.addEventListener('scroll', resetBox, { passive: true });
  const toStage = (event) => { const b = box(); return { x: event.clientX - b.left, y: event.clientY - b.top }; };
  const petSize = () => ({ w: petEl.offsetWidth * SCALE, h: petEl.offsetHeight * SCALE });

  function applyTransform() {
    petEl.style.transform = `translate(${(pos.x - base.x).toFixed(1)}px, ${(pos.y - base.y).toFixed(1)}px) scale(${SCALE * facing}, ${SCALE})`;
  }
  function drawLeash() {
    if (!pointer) { leash.style.display = 'none'; return; }
    leash.style.display = 'block';
    const { h } = petSize();
    const neck = { x: pos.x, y: pos.y - h * 0.12 };
    const dist = Math.hypot(pointer.x - neck.x, pointer.y - neck.y);
    const sag = Math.max(0, LEASH_PX * 1.6 - dist) * 0.5; // 가까우면 처지고 멀면 팽팽
    const mx = (pointer.x + neck.x) / 2; const my = (pointer.y + neck.y) / 2 + sag;
    const d = `M${pointer.x.toFixed(1)} ${pointer.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${neck.x.toFixed(1)} ${neck.y.toFixed(1)}`;
    outline.setAttribute('d', d); strap.setAttribute('d', d);
  }
  function dropFoot(dx, dy) {
    if (reduced) return;
    const { h } = petSize();
    const foot = document.createElement('i');
    const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    const off = 7 * footSide; footSide *= -1;
    const nx = -dy; const ny = dx; const n = Math.hypot(nx, ny) || 1;
    foot.style.left = `${(pos.x + (nx / n) * off).toFixed(1)}px`;
    foot.style.top = `${(pos.y + h * 0.4 + (ny / n) * off).toFixed(1)}px`;
    foot.style.transform = `translate(-50%, -50%) rotate(${ang.toFixed(0)}deg)`;
    foot.addEventListener('animationend', () => foot.remove());
    feet.append(foot);
    while (feet.children.length > 24) feet.firstChild.remove();
  }

  function frame(now) {
    raf = 0; if (!active) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    if (pressed && pointer) target = clampToBox(followTarget(pos, pointer, LEASH_PX), box());
    const prev = pos;
    const next = stepToward(pos, target, dt);
    pos = { x: next.x, y: next.y };
    if (next.moved > 0.3) {
      const dx = pos.x - prev.x; const dy = pos.y - prev.y;
      if (Math.abs(dx) > 0.2) facing = dx < 0 ? -1 : 1;
      petApi.hold('산책', 0.9);
      meters += next.moved / PX_PER_M;
      footAcc += next.moved;
      if (footAcc > 22) { footAcc = 0; dropFoot(dx, dy); }
      if (Math.floor(meters) !== reported) { reported = Math.floor(meters); onChange?.({ type: 'walk', meters: reported }); }
    }
    applyTransform(); drawLeash();
    if (next.remaining > 0.5 || pressed) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && active) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  return {
    active: () => active,
    enter() {
      if (active) return;
      active = true; meters = 0; reported = 0; facing = 1; boxCache = null;
      petApi.wakeUp?.();
      petEl.style.transform = '';
      const s = box(); const p = petEl.getBoundingClientRect();
      base = { x: p.left - s.left + p.width / 2, y: p.top - s.top + p.height / 2 };
      pos = { ...base };
      target = clampToBox({ x: s.width / 2, y: s.height - 70 }, s, 60);
      stage.classList.add('is-walk');
      petEl.classList.add('is-walking');
      // 진입: 크기를 줄이며 출발점으로(0.5초 전환) 이동한 뒤 걷기 시작
      petEl.style.transition = reduced ? 'none' : 'transform .5s ease';
      pos = { ...target }; applyTransform();
      setTimeout(() => { petEl.style.transition = 'none'; }, reduced ? 0 : 520);
      onChange?.({ type: 'walk', meters: 0 });
    },
    exit() {
      if (!active) return;
      active = false; pressed = false; pointer = null;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      stage.classList.remove('is-walk');
      petEl.style.transition = reduced ? 'none' : 'transform .5s ease';
      petEl.style.transform = '';
      setTimeout(() => { petEl.style.transition = ''; petEl.classList.remove('is-walking'); }, reduced ? 0 : 520);
      leash.style.display = 'none'; feet.replaceChildren();
    },
    down(event) {
      if (!active) return;
      pressed = true; downAt = performance.now(); downPt = toStage(event); travel = 0; pointer = downPt;
      kick();
    },
    move(event) {
      if (!active) return;
      const p = toStage(event);
      if (pressed && downPt) travel = Math.max(travel, Math.hypot(p.x - downPt.x, p.y - downPt.y));
      pointer = p;
      if (pressed) kick(); else drawLeash();
    },
    up(event) {
      if (!active || !pressed) return;
      pressed = false;
      const p = toStage(event);
      // 클릭이면 그 지점까지 걸어간다. 누르고 있다 뗀 경우는 지금 목표에서 멈춘다.
      if (isClick(downAt, performance.now(), travel)) target = clampToBox(p, box());
      if (event.pointerType === 'touch') pointer = null;
      kick(); drawLeash();
    },
    leave() { if (!pressed) { pointer = null; drawLeash(); } },
    destroy() { this.exit(); bg.remove(); leash.remove(); feet.remove(); window.removeEventListener('resize', resetBox); window.removeEventListener('scroll', resetBox); },
  };
}

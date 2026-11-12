// 도구 동작 판정(DOM 없음): 문지르기 누적 거리, 영역 안 판정. Node 테스트 대상.

// 몸통 사각형 안의 타원 영역인지(모서리 제외). shrink: 사각형 대비 인정 범위.
export function insideEllipse(x, y, rect, shrink = 0.92) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
  const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
  const rx = (rect.width / 2) * shrink; const ry = (rect.height / 2) * shrink;
  const dx = (x - cx) / rx; const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

// 문지르기: 영역 안에서 누른 채 움직인 거리를 모아 threshold마다 1회로 센다.
// 한 이벤트에서 maxJump 이상 건너뛰면 새로 시작한 것으로 보고 거리에 넣지 않는다(순간이동·터치 점프 방지).
export function createRubTracker({ threshold = 260, minStep = 2, maxJump = 160 } = {}) {
  let last = null; let distance = 0; let rubs = 0;
  const snapshot = (rubbed) => ({ rubbed, rubs, progress: Math.min(1, distance / threshold) });
  return {
    start() { last = null; },
    move(x, y, inside) {
      if (!inside) { last = null; return snapshot(false); }
      if (last) {
        const step = Math.hypot(x - last.x, y - last.y);
        if (step > maxJump) { last = { x, y }; return snapshot(false); }
        if (step >= minStep) { distance += step; last = { x, y }; }
      } else { last = { x, y }; }
      if (distance >= threshold) { distance -= threshold; rubs += 1; return snapshot(true); }
      return snapshot(false);
    },
    end() { last = null; },
    reset() { last = null; distance = 0; rubs = 0; },
  };
}

// 마우스는 커서 위치가 곧 닿는 점. 터치는 손가락 위쪽(offsetY)에 도구를 띄우되 닿는 점은 손가락 위치다.
export const TOUCH_TOOL_OFFSET_Y = 44;
export function toolPlacement({ pointerType, x, y, size, hotspot }) {
  const touch = pointerType === 'touch';
  const scale = size / 256;
  const left = x - hotspot[0] * scale;
  const top = (touch ? y - TOUCH_TOOL_OFFSET_Y : y) - hotspot[1] * scale;
  return { left, top, touch };
}

// 산책: 목표로 한 프레임 이동. 가까워지면 감속, 최대 maxSpeed(px/s). 남은 거리와 이동량을 함께 돌려준다.
export function stepToward(pos, target, dt, { maxSpeed = 180, slowRadius = 60 } = {}) {
  const dx = target.x - pos.x; const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5) return { x: target.x, y: target.y, moved: dist, remaining: 0 };
  const speed = maxSpeed * Math.min(1, dist / slowRadius);
  const step = Math.min(dist, Math.max(8, speed) * dt);
  return { x: pos.x + (dx / dist) * step, y: pos.y + (dy / dist) * step, moved: step, remaining: dist - step };
}

// 누르는 동안 펫은 포인터에 붙지 않고 leash(px)만큼 뒤에 선다. 이미 그보다 가까우면 제자리.
export function followTarget(pos, pointer, leash = 60) {
  const dx = pointer.x - pos.x; const dy = pointer.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= leash) return { x: pos.x, y: pos.y };
  return { x: pointer.x - (dx / dist) * leash, y: pointer.y - (dy / dist) * leash };
}

// 무대 안쪽 여백(margin) 안으로 제한.
export function clampToBox(p, box, margin = 40) {
  return {
    x: Math.min(box.width - margin, Math.max(margin, p.x)),
    y: Math.min(box.height - margin, Math.max(margin, p.y)),
  };
}

// 짧게 누르고 거의 움직이지 않았으면 클릭.
export function isClick(downAt, upAt, travel, { maxMs = 220, maxTravel = 10 } = {}) {
  return upAt - downAt <= maxMs && travel <= maxTravel;
}

// 프레임 제한(가변 주사율 대응): 화면이 60·90·120·144Hz 어느 것이든 목표 fps 박자에 맞춰 그릴지 정한다.
// 직전 그림과의 간격만 보면 144Hz에서 프레임이 31ms·38ms로 들쭉날쭉해진다. 대신 다음 그릴 시각을 박자로 쌓고,
// 반 프레임(tolerance) 이내로 일찍 온 프레임도 그 박자로 인정한다. 오래 멈췄다 돌아오면 박자를 지금으로 맞춘다.
export function createFrameGate(fps = 30, tolerance = 0.004) {
  const step = 1 / fps; let next = 0;
  return {
    shouldDraw(t) {
      if (t + tolerance < next) return false;
      next = (t - next > step) ? t + step : next + step;
      return true;
    },
    reset() { next = 0; },
  };
}

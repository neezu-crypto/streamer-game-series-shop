import test from 'node:test';
import assert from 'node:assert/strict';
import { insideEllipse, createRubTracker, toolPlacement, TOUCH_TOOL_OFFSET_Y } from '../tamagotchi-gestures.mjs';

const rect = { left: 100, top: 100, width: 200, height: 160 };

test('몸통 타원 안 판정: 중심은 안, 모서리·밖은 바깥', () => {
  assert.equal(insideEllipse(200, 180, rect), true);
  assert.equal(insideEllipse(101, 101, rect), false);
  assert.equal(insideEllipse(50, 180, rect), false);
  assert.equal(insideEllipse(200, 180, null), false);
  assert.equal(insideEllipse(200, 180, { left: 0, top: 0, width: 0, height: 0 }), false);
});

test('문지르기: 영역 안에서 누적 거리가 기준에 닿으면 1회', () => {
  const t = createRubTracker({ threshold: 100 });
  t.start();
  let rubbed = 0;
  for (let i = 0; i < 40; i += 1) {
    const r = t.move(150 + (i % 2 === 0 ? 0 : 25), 180, true);
    if (r.rubbed) rubbed += 1;
  }
  assert.ok(rubbed >= 8 && rubbed <= 10, `rubbed=${rubbed}`);
});

test('문지르기: 영역 밖 이동은 세지 않고, 다시 들어오면 새로 시작', () => {
  const t = createRubTracker({ threshold: 50 });
  t.move(150, 180, true);
  for (let i = 0; i < 20; i += 1) assert.equal(t.move(10 + i * 20, 10, false).rubbed, false);
  assert.equal(t.move(150, 180, true).rubbed, false);
  assert.equal(t.move(152, 180, true).progress < 0.2, true);
});

test('문지르기: 순간이동(큰 점프)과 아주 작은 떨림은 거리에 넣지 않는다', () => {
  const t = createRubTracker({ threshold: 100, minStep: 2, maxJump: 160 });
  t.move(150, 180, true);
  for (let i = 0; i < 200; i += 1) assert.equal(t.move(150 + (i % 2), 180, true).rubbed, false);
  assert.equal(t.move(150, 500, true).rubbed, false);
  assert.equal(t.move(150, 180, true).rubbed, false);
});

test('문지르기: reset 과 end', () => {
  const t = createRubTracker({ threshold: 20 });
  t.move(0, 0, true); t.move(30, 0, true);
  t.reset();
  assert.equal(t.move(0, 0, true).progress, 0);
  t.end();
  assert.equal(t.move(500, 500, true).progress, 0);
});

test('도구 위치: 마우스는 커서 위치가 닿는 점, 터치는 손가락 위로 띄움', () => {
  const mouse = toolPlacement({ pointerType: 'mouse', x: 300, y: 200, size: 72, hotspot: [128, 150] });
  assert.equal(mouse.left, 300 - 36); assert.equal(mouse.top, 200 - 150 * 72 / 256); assert.equal(mouse.touch, false);
  const touch = toolPlacement({ pointerType: 'touch', x: 300, y: 200, size: 88, hotspot: [128, 150] });
  assert.equal(touch.top, 200 - TOUCH_TOOL_OFFSET_Y - 150 * 88 / 256); assert.equal(touch.touch, true);
});

import { stepToward, followTarget, clampToBox, isClick } from '../tamagotchi-gestures.mjs';
test('산책: 목표로 다가가며 최대 속도를 넘지 않고 결국 도착한다', () => {
  let p = { x: 0, y: 0 }; const t = { x: 300, y: 0 };
  const first = stepToward(p, t, 0.1);
  assert.ok(first.x > 0 && first.x <= 18.01);
  for (let i = 0; i < 200; i++) p = stepToward(p, t, 1 / 60);
  assert.deepEqual([Math.round(p.x), p.y], [300, 0]);
});
test('산책: 따라오기 목표는 목줄 길이만큼 뒤, 가까우면 제자리', () => {
  assert.deepEqual(followTarget({ x: 0, y: 0 }, { x: 100, y: 0 }, 60), { x: 40, y: 0 });
  assert.deepEqual(followTarget({ x: 0, y: 0 }, { x: 30, y: 0 }, 60), { x: 0, y: 0 });
});
test('산책: 무대 경계 안으로 제한, 클릭 판정', () => {
  assert.deepEqual(clampToBox({ x: -10, y: 900 }, { width: 800, height: 500 }), { x: 40, y: 460 });
  assert.equal(isClick(0, 150, 4), true);
  assert.equal(isClick(0, 600, 4), false);
  assert.equal(isClick(0, 100, 40), false);
});

import { createFrameGate } from '../tamagotchi-gestures.mjs';
test('프레임 제한: 60·90·120·144Hz 모두 초당 약 30번 그린다', () => {
  for (const hz of [60, 90, 120, 144]) {
    const gate = createFrameGate(30); let draws = 0;
    for (let i = 0; i < hz * 2; i++) {
      const jitter = (i % 3 - 1) * 0.0008; // 실제 화면처럼 약간 흔들리는 간격
      if (gate.shouldDraw(i / hz + jitter)) draws++;
    }
    assert.ok(draws >= 58 && draws <= 62, `${hz}Hz → ${draws}/2초`);
  }
});
test('프레임 제한: 오래 멈췄다 돌아오면 바로 그리고 박자를 다시 맞춘다', () => {
  const gate = createFrameGate(30);
  assert.equal(gate.shouldDraw(0), true);
  assert.equal(gate.shouldDraw(0.01), false);
  assert.equal(gate.shouldDraw(5), true);
  assert.equal(gate.shouldDraw(5.01), false);
  assert.equal(gate.shouldDraw(5.034), true);
});

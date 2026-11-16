import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorld, neighbor, minimapCells, swipeStarts, swipeResult, dragOffset } from '../tamagotchi-logic.mjs';

const v2 = { version: 2, districts: [{ id: 'square', x: 0, y: 0, name: '광장' }, { id: 'east', x: 1, y: 0, name: '동쪽' }, { id: 'north', x: 0, y: -1, status: 'soon' }], places: [{ id: 'a' }, { id: 'photo', district: 'east' }] };

test('v1 카탈로그는 동네 하나(square)로 읽는다', () => {
  const w = normalizeWorld({ layers: { d: 'x' }, lots: { d: [[1, 2, 3]] }, places: [{ id: 'a' }] });
  assert.equal(w.districts.length, 1); assert.equal(w.home, 'square'); assert.equal(w.places[0].district, 'square');
});
test('이웃 동네: 열린 곳만, 준비 중은 이동 불가', () => {
  const w = normalizeWorld(v2);
  assert.equal(neighbor(w, 'square', 'right').id, 'east');
  assert.equal(neighbor(w, 'east', 'left').id, 'square');
  assert.equal(neighbor(w, 'square', 'up'), null);
  assert.equal(neighbor(w, 'square', 'left'), null);
  assert.equal(w.places[1].district, 'east');
});
test('미니맵은 바운딩 박스 칸을 행 순서로', () => {
  const m = minimapCells(normalizeWorld(v2), 'east');
  assert.equal(m.cols, 2); assert.equal(m.rows, 2);
  assert.deepEqual(m.cells.map((c) => c.state), ['soon', 'empty', 'open', 'current']);
});
test('끌기 시작·결정', () => {
  assert.equal(swipeStarts(9, 3), true); assert.equal(swipeStarts(5, 0), false); assert.equal(swipeStarts(10, 20), false);
  assert.equal(swipeResult({ dx: -300, ms: 1000, width: 1000, hasRight: true }), 'right');
  assert.equal(swipeResult({ dx: -100, ms: 1000, width: 1000, hasRight: true }), '');
  assert.equal(swipeResult({ dx: -100, ms: 100, width: 1000, hasRight: true }), 'right');
  assert.equal(swipeResult({ dx: 400, ms: 100, width: 1000, hasRight: true }), '');
  assert.equal(dragOffset(-90, { hasRight: false }), -30);
});

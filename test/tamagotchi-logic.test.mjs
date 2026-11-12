import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESET_NAMES, COLORS_BY_ID } from '../tamagotchi-pet.js';
import { TOOLS } from '../tamagotchi-tools.js';
import {
  normalizeNickname, resolvePurchaseState, getOrCreateRequestId, clearRequestId, shouldDiscardRequestId,
  adoptErrorMessage, catalogsAgree, farmUrl, REQUEST_ID_RE,
} from '../tamagotchi-logic.mjs';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);
const streamer = { isAdmin: false, isVerifiedStreamer: true, streamer: { id: 'gmyo0o', nickname: '그묘' } };

test('구매 상태 판정', () => {
  assert.equal(resolvePurchaseState({ isAnonymous: true, viewer: { isAdmin: false, isVerifiedStreamer: false, streamer: null }, balanceCash: 99, priceCash: 50 }), 'login');
  assert.equal(resolvePurchaseState({ isAnonymous: false, viewer: { isAdmin: false, isVerifiedStreamer: false, streamer: null }, balanceCash: 99, priceCash: 50 }), 'verify');
  assert.equal(resolvePurchaseState({ isAnonymous: true, viewer: streamer, balanceCash: 49, priceCash: 50 }), 'charge');
  assert.equal(resolvePurchaseState({ isAnonymous: true, viewer: streamer, balanceCash: 50, priceCash: 50 }), 'ready');
  assert.equal(resolvePurchaseState({ isAnonymous: false, viewer: { isAdmin: true, isVerifiedStreamer: false, streamer: null }, balanceCash: 0, priceCash: 50 }), 'admin');
  assert.equal(resolvePurchaseState({ isAnonymous: true, viewer: null, balanceCash: 0, priceCash: 50 }), 'login');
  assert.equal(resolvePurchaseState({ isAnonymous: true, viewer: { ...streamer, streamer: null }, balanceCash: 99, priceCash: 50 }), 'login');
});

test('이름 정리는 서버와 같다', () => {
  assert.deepEqual(normalizeNickname('  두  부 \n 야 '), { ok: true, value: '두 부 야' });
  assert.deepEqual(normalizeNickname('   '), { ok: true, value: '몽실이' });
  assert.deepEqual(normalizeNickname(null), { ok: true, value: '몽실이' });
  assert.equal(normalizeNickname('가'.repeat(12)).ok, true);
  assert.equal(normalizeNickname('가'.repeat(13)).ok, false);
  assert.equal(normalizeNickname('😀'.repeat(12)).ok, true);
});

test('요청 번호: 형식, 재사용, 정리', () => {
  const s = memory();
  const first = getOrCreateRequestId(s, 'k', bytes);
  assert.match(first, REQUEST_ID_RE);
  assert.ok(first.startsWith('tg_'));
  assert.equal(getOrCreateRequestId(s, 'k', () => new Uint8Array(18)), first);
  clearRequestId(s, 'k');
  assert.notEqual(getOrCreateRequestId(s, 'k', () => Uint8Array.from({ length: 18 }, () => 9)), first);
  s.setItem('bad', 'short');
  assert.match(getOrCreateRequestId(s, 'bad', bytes), REQUEST_ID_RE);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.match(getOrCreateRequestId(broken, 'k', bytes), REQUEST_ID_RE);
  clearRequestId(broken, 'k');
});

test('확정 실패는 번호를 버리고 결과 불명은 유지한다', () => {
  for (const code of ['failed-precondition', 'already-exists', 'invalid-argument', 'permission-denied', 'resource-exhausted', 'not-found']) {
    assert.equal(shouldDiscardRequestId({ code: `functions/${code}` }), true, code);
  }
  assert.equal(shouldDiscardRequestId({ code: 'functions/aborted', message: '분양을 마치지 못해 자동 환불했어요. 다시 시도해 주세요.' }), true);
  assert.equal(shouldDiscardRequestId({ code: 'functions/aborted', message: '결제 후 분양을 마치지 못했고 환불을 확인 중이에요.' }), false);
  assert.equal(shouldDiscardRequestId({ code: 'functions/unavailable', message: '점검' }), false);
  assert.equal(shouldDiscardRequestId({ code: 'functions/internal' }), false);
  assert.equal(shouldDiscardRequestId(new Error('network')), false);
  assert.equal(shouldDiscardRequestId(null), false);
});

test('오류 문구', () => {
  assert.equal(adoptErrorMessage({ code: 'functions/failed-precondition', message: '통합 캐시가 부족해요. 필요 50캐시입니다.' }), '통합 캐시가 부족해요. 필요 50캐시입니다.');
  assert.equal(adoptErrorMessage({ code: 'functions/resource-exhausted', message: 'x' }), '잠시 후 다시 시도해 주세요.');
  assert.equal(adoptErrorMessage({ code: 'functions/unauthenticated' }), '로그인이 필요해요.');
  assert.match(adoptErrorMessage({ code: 'functions/internal', message: 'INTERNAL' }), /자동으로 확인/);
  assert.ok(!adoptErrorMessage({ code: 'functions/internal', message: 'INTERNAL' }).includes('INTERNAL'));
  assert.match(adoptErrorMessage(null), /자동으로 확인/);
});

test('공개 카탈로그 JSON: 가격·판매 상태가 없고 서버 종·색과 맞는다', () => {
  const raw = readFileSync(new URL('../catalog/tamagotchi.json', import.meta.url), 'utf8');
  const json = JSON.parse(raw);
  assert.ok(!/cash|price|status|adopt/i.test(raw));
  const server = [{ id: 'mongsil', colors: ['cream', 'pink', 'mint', 'lavender'] }];
  assert.equal(catalogsAgree(server, json.species), true);
  assert.equal(catalogsAgree([{ id: 'mongsil', colors: ['cream'] }], json.species), false);
  assert.equal(catalogsAgree([{ id: 'other', colors: [] }], json.species), false);
  for (const color of json.species[0].colors) assert.ok(readFileSync(new URL(`../${color.image}`, import.meta.url)).length > 1000, color.image);
});

test('팬페이지 주소', () => {
  assert.equal(farmUrl('gmyo0o'), 'https://neezu-crypto.github.io/streamer-fanpage/#/p/gmyo0o');
  assert.ok(farmUrl('a/b').includes('a%2Fb'));
});

test('상호작용 미리보기: 서버 상호작용과 id가 같고 모든 동작이 리그 프리셋에 있다', () => {
  const json = JSON.parse(readFileSync(new URL('../catalog/tamagotchi.json', import.meta.url), 'utf8'));
  const species = json.species[0];
  const serverBase = ['pet', 'feed', 'groom', 'gem'];
  const serverTrain = ['play', 'bath', 'nap', 'walk', 'talk', 'sing', 'dance', 'cheer'];
  const ids = (group) => species.interactions.filter((i) => i.group === group).map((i) => i.id).sort();
  assert.deepEqual(ids('base'), [...serverBase].sort());
  assert.deepEqual(ids('training'), [...serverTrain].sort());
  for (const item of species.interactions) {
    assert.ok(PRESET_NAMES.includes(item.preset), `${item.id} → ${item.preset}`);
    assert.ok(item.label && item.desc, item.id);
  }
  for (const color of species.colors) assert.ok(COLORS_BY_ID[color.id], color.id);
});

test('도구: 카탈로그의 tool 항목마다 도구 정의·일러스트·프리셋이 있다', () => {
  const json = JSON.parse(readFileSync(new URL('../catalog/tamagotchi.json', import.meta.url), 'utf8'));
  const withTool = json.species[0].interactions.filter((item) => item.tool);
  assert.ok(withTool.length >= 1);
  for (const item of withTool) {
    const tool = TOOLS[item.tool];
    assert.ok(tool, item.tool);
    assert.ok(PRESET_NAMES.includes(tool.preset), tool.preset);
    const svg = readFileSync(new URL(tool.src, import.meta.url), "utf8");
    assert.ok(svg.includes('<svg') && svg.includes('tool-base'), tool.src);
    assert.equal(tool.hotspot.length, 2);
  }
});

import * as L from '../tamagotchi-logic.mjs';
test('훈련소: 상태 분기·합계·배울 수 있는 목록·요청 번호', () => {
  assert.equal(L.resolveTrainState({ isAnonymous: true, viewer: null }), 'login');
  assert.equal(L.resolveTrainState({ isAnonymous: false, viewer: { isVerifiedStreamer: false } }), 'verify');
  assert.equal(L.resolveTrainState({ isAnonymous: false, viewer: { isAdmin: true } }), 'admin');
  assert.equal(L.resolveTrainState({ isAnonymous: false, viewer: { isVerifiedStreamer: true, streamer: { id: 'a' } } }), 'ready');
  const tr = [{ id: 'play', cash: 10 }, { id: 'walk', cash: 10 }, { id: 'sing', cash: 10 }];
  assert.equal(L.trainTotal(tr, ['play', 'walk', 'walk', 'nope']), 20);
  assert.deepEqual(L.learnableIds(tr, ['pet', 'walk']), ['play', 'sing']);
  const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const rb = (n) => new Uint8Array(n).fill(7);
  const a = L.getTrainRequestId(storage, 'k', L.trainSignature('p1', ['walk', 'play']), rb);
  assert.equal(L.getTrainRequestId(storage, 'k', L.trainSignature('p1', ['play', 'walk']), rb), a);
  const rb2 = (n) => new Uint8Array(n).fill(9);
  assert.notEqual(L.getTrainRequestId(storage, 'k', L.trainSignature('p1', ['play']), rb2), a);
  assert.match(a, L.REQUEST_ID_RE);
});

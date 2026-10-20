// src/lib/inboundMatch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineQty, matchInboundLines } from './inboundMatch.js';

const inventory = [
  { id: 'milk', name: '우유 1L', unit: '개' },
  { id: 'bean', name: '원두', unit: '봉' },
  { id: 'decaf', name: '디카페인 원두', unit: '봉' },
  { id: 'cup', name: '아이스 컵', unit: '박스' },
];

test('parseLineQty: 설명 끝의 숫자+단위에서 수량', () => {
  assert.equal(parseLineQty('원두 3봉'), 3);
  assert.equal(parseLineQty('우유 1L 12개'), 12);
  assert.equal(parseLineQty('아이스 컵 1.5박스'), 1.5);
  assert.equal(parseLineQty('원두'), null);
  assert.equal(parseLineQty('수리비'), null);
});

test('matchInboundLines: 저장된 품목·수량 우선 (auto=false)', () => {
  const lines = matchInboundLines([
    { id: 'e1', description: '우유 1L 12개', amount: 30000, inventory_item_id: 'milk', qty: 12 },
  ], inventory);
  assert.deepEqual(lines, [{ expenseItemId: 'e1', description: '우유 1L 12개', amount: 30000, itemId: 'milk', qty: 12, auto: false }]);
});

test('matchInboundLines: 저장값 없으면 이름 매칭 — 가장 긴 품목명 우선, 수량은 설명에서', () => {
  const lines = matchInboundLines([
    { id: 'e2', description: '디카페인 원두 2봉', amount: 50000 },
    { id: 'e3', description: '원두', amount: 25000 },
    { id: 'e4', description: '에스프레소 머신 수리', amount: 120000 },
  ], inventory);
  assert.equal(lines[0].itemId, 'decaf');
  assert.equal(lines[0].qty, 2);
  assert.equal(lines[0].auto, true);
  assert.equal(lines[1].itemId, 'bean');
  assert.equal(lines[1].qty, null);
  assert.equal(lines[2].itemId, null);
  assert.equal(lines[2].qty, null);
});

// src/lib/stockCount.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCountPlan, formatCountedAgo } from './stockCount.js';

const items = [
  { id: 'a', current_qty: 10, unit: '봉' },
  { id: 'b', current_qty: 3.5, unit: '병' },
  { id: 'c', current_qty: 0, unit: '개' },
];

test('buildCountPlan: 입력한 품목만, 차이만큼 adjust, 0 차이는 countedIds 만', () => {
  const plan = buildCountPlan([
    { itemId: 'a', counted: 7, unit: '봉' },
    { itemId: 'b', counted: 3.5, unit: '병' },
    { itemId: 'c', counted: '', unit: '개' },
  ], items, { dateKey: '2026-10-20' });
  assert.deepEqual(plan.transactions, [{ item_id: 'a', type: 'adjust', qty_delta: -3, note: '실사 10/20' }]);
  assert.deepEqual(plan.countedIds, ['a', 'b']);
  assert.deepEqual(plan.unitChanges, []);
});

test('buildCountPlan: 단위를 바꾼 품목은 unitChanges, 모르는 품목·음수는 무시', () => {
  const plan = buildCountPlan([
    { itemId: 'a', counted: 12, unit: '박스' },
    { itemId: 'zzz', counted: 1, unit: '개' },
    { itemId: 'c', counted: -1, unit: '개' },
  ], items, { dateKey: '2026-10-20' });
  assert.deepEqual(plan.unitChanges, [{ id: 'a', unit: '박스' }]);
  assert.deepEqual(plan.countedIds, ['a']);
  assert.equal(plan.transactions[0].qty_delta, 2);
});

test('buildCountPlan: 소수 차이는 소수 셋째 자리로 반올림', () => {
  const plan = buildCountPlan([{ itemId: 'b', counted: 1.2, unit: '병' }], items, { dateKey: '2026-10-20' });
  assert.equal(plan.transactions[0].qty_delta, -2.3);
});

test('formatCountedAgo', () => {
  const now = new Date('2026-10-20T10:00:00+09:00');
  assert.equal(formatCountedAgo(null, now), '');
  assert.equal(formatCountedAgo('2026-10-20T01:00:00+09:00', now), '실사 오늘');
  assert.equal(formatCountedAgo('2026-10-13T12:00:00+09:00', now), '실사 7일 전');
});

// src/lib/posSyncHelpers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByItemCount } from './posSyncHelpers.js';

test('주문을 아이템 개수별로 묶어 꼬리 삭제 그룹을 만든다', () => {
  const groups = groupByItemCount([
    { orderId: 'a', count: 2 },
    { orderId: 'b', count: 1 },
    { orderId: 'c', count: 2 },
    { orderId: 'd', count: 0 },
  ]);
  assert.deepEqual(groups, [
    { count: 0, orderIds: ['d'] },
    { count: 1, orderIds: ['b'] },
    { count: 2, orderIds: ['a', 'c'] },
  ]);
});

test('빈 입력이면 빈 배열', () => {
  assert.deepEqual(groupByItemCount([]), []);
});

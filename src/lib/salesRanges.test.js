// src/lib/salesRanges.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeDates } from './salesRanges.js';

// 기준일: 2026-10-15 (목요일), 로컬 시간
const now = new Date(2026, 9, 15, 14, 30);

test('today', () => assert.deepEqual(rangeDates('today', null, now), { from: '2026-10-15', to: '2026-10-15' }));
test('week: 이번 주 월요일 ~ 오늘', () => assert.deepEqual(rangeDates('week', null, now), { from: '2026-10-12', to: '2026-10-15' }));
test('month: 이번 달 1일 ~ 오늘', () => assert.deepEqual(rangeDates('month', null, now), { from: '2026-10-01', to: '2026-10-15' }));
test('lastWeek: 지난 주 월 ~ 일', () => assert.deepEqual(rangeDates('lastWeek', null, now), { from: '2026-10-05', to: '2026-10-11' }));
test('lastMonth: 지난달 1일 ~ 말일', () => assert.deepEqual(rangeDates('lastMonth', null, now), { from: '2026-09-01', to: '2026-09-30' }));
test('lastMonth: 1월이면 전년 12월', () => assert.deepEqual(rangeDates('lastMonth', null, new Date(2026, 0, 3)), { from: '2025-12-01', to: '2025-12-31' }));
test('week: 월요일이면 from=to', () => assert.deepEqual(rangeDates('week', null, new Date(2026, 9, 12)), { from: '2026-10-12', to: '2026-10-12' }));
test('week: 일요일은 지난 월요일부터', () => assert.deepEqual(rangeDates('week', null, new Date(2026, 9, 18)), { from: '2026-10-12', to: '2026-10-18' }));
test('custom: 그대로 반환', () => assert.deepEqual(rangeDates('custom', { from: '2026-01-01', to: '2026-02-01' }, now), { from: '2026-01-01', to: '2026-02-01' }));

// src/lib/date.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDaysKey } from './date.js';

test('addDaysKey: 날짜 키에 일수 가감 (시간대 무관, 순수 문자열 연산)', () => {
  assert.equal(addDaysKey('2026-10-15', -1), '2026-10-14');
  assert.equal(addDaysKey('2026-10-01', -1), '2026-09-30');
  assert.equal(addDaysKey('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysKey('2026-02-28', 1), '2026-03-01');
  assert.equal(addDaysKey('2026-10-15', 0), '2026-10-15');
});

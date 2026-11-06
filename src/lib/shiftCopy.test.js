// src/lib/shiftCopy.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekdayCopyMap, formatShiftRange } from './shiftCopy.js';

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('buildWeekdayCopyMap: 대상 달의 모든 날이 지난달 같은 요일(4주 전, 없으면 5주 전)에서 온다', () => {
  // 2026-10 → 2026-11 (11/1 은 일요일, 10/1 은 목요일)
  const m = buildWeekdayCopyMap(2026, 10); // month0 = 10 → 11월
  const targets = [...m.values()].flat();
  assert.equal(targets.length, 30); // 11월 30일 전부 채워짐
  const byTarget = Object.fromEntries(targets.map((t) => [key(t), t]));
  assert.ok(byTarget['2026-11-01'] && byTarget['2026-11-30']);
  // 11/1(일) ← 10/4(일) (4주 전)
  assert.deepEqual(m.get('2026-10-04').map(key), ['2026-11-01']);
  // 11/29(일) 은 4주 전이 11/1 이라 5주 전 10/25(일) 에서 — 10/25 는 11/22 와 11/29 두 번 쓰임
  assert.deepEqual(m.get('2026-10-25').map(key), ['2026-11-22', '2026-11-29']);
  // 11/5(목) ← 10/8(목)
  assert.deepEqual(m.get('2026-10-08').map(key), ['2026-11-05']);
  // 10/1(목)·10/2·10/3 은 4주 뒤가 10월 안이라 쓰이지 않음
  assert.equal(m.get('2026-10-01'), undefined);
  // 요일 보존
  for (const [src, list] of m) {
    const [y, mo, d] = src.split('-').map(Number);
    const sd = new Date(y, mo - 1, d);
    for (const t of list) assert.equal(t.getDay(), sd.getDay(), `${src} → ${key(t)}`);
  }
});

test('buildWeekdayCopyMap: 2월 → 3월 (28일짜리 달)', () => {
  const m = buildWeekdayCopyMap(2027, 2); // 2027-03
  const targets = [...m.values()].flat();
  assert.equal(targets.length, 31);
  // 3/1/2027 은 월요일 ← 2/1/2027(월) (4주 전)
  assert.deepEqual(m.get('2027-02-01').map(key), ['2027-03-01']);
  assert.deepEqual(m.get('2027-02-22').map(key), ['2027-03-22', '2027-03-29']);
});

test('formatShiftRange: 시작-끝 시각', () => {
  assert.equal(formatShiftRange('2026-11-05T00:00:00.000Z', '2026-11-05T04:00:00.000Z', 'Asia/Seoul'), '09:00-13:00');
  assert.equal(formatShiftRange('2026-11-05T00:30:00.000Z', '2026-11-05T09:00:00.000Z', 'Asia/Seoul'), '09:30-18:00');
});

// src/lib/trendScore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTrend, weekStartKey } from './trendScore.js';

test('weekStartKey: 날짜의 월요일 키', () => {
  assert.equal(weekStartKey('2026-10-16'), '2026-10-12'); // 금 → 월
  assert.equal(weekStartKey('2026-10-12'), '2026-10-12'); // 월
  assert.equal(weekStartKey('2026-10-18'), '2026-10-12'); // 일 → 지난 월
});

test('scoreTrend: 최근 4주 평균 / 이전 8주 평균 − 1 = 상승률, 점수는 상승률×최근 평균 지수', () => {
  // 이전 8주 10, 최근 4주 30 → +200%
  const series = [...Array(8).fill(10), ...Array(4).fill(30)];
  const s = scoreTrend(series);
  assert.equal(s.changePct, 200);
  assert.equal(s.recentAvg, 30);
  assert.equal(s.baseAvg, 10);
  assert.ok(s.score > 0);
});

test('scoreTrend: 하락이면 음수 상승률, 점수 0', () => {
  const s = scoreTrend([...Array(8).fill(40), ...Array(4).fill(20)]);
  assert.equal(s.changePct, -50);
  assert.equal(s.score, 0);
});

test('scoreTrend: 이전 기간이 전부 0이면 상승률은 null, 최근 평균만으로 점수', () => {
  const s = scoreTrend([...Array(8).fill(0), ...Array(4).fill(5)]);
  assert.equal(s.changePct, null);
  assert.equal(s.score, 5);
});

test('scoreTrend: 데이터가 4주 미만이면 null', () => {
  assert.equal(scoreTrend([1, 2]), null);
  assert.equal(scoreTrend([]), null);
});

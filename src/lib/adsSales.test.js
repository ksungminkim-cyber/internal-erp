// src/lib/adsSales.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthly, dailyCorrelation, changePoints, verdict, BREAK_EVEN } from './adsSales.js';

const seqDates = (from, n) => Array.from({ length: n }, (_, i) => { const t = new Date(from + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + i); return t.toISOString().slice(0, 10); });
const mkRev = (from, n, f) => Object.fromEntries(seqDates(from, n).map((d, i) => [d, f(d, i)]));
const mkDays = (from, n, f) => seqDates(from, n).map((d, i) => ({ d, ...f(d, i) }));

test('monthly: 전년 동월 일평균 대비 증분 ÷ 하루 광고비', () => {
  const rev = { ...mkRev('2025-10-01', 31, () => ({ day: 400000, bar: 100000 })), ...mkRev('2026-10-01', 31, () => ({ day: 500000, bar: 100000 })) };
  const days = mkDays('2026-10-01', 31, () => ({ google: { cost: 20000 }, naver: { cost: 5000 } }));
  const [r] = monthly(rev, days, { today: '2026-11-15' });
  assert.equal(r.m, '2026-10'); assert.equal(r.ad, 25000 * 31); assert.equal(r.incrPerDay, 100000); assert.equal(r.ratio, 4); assert.equal(r.ratioDay, 4); assert.equal(r.partial, false);
  assert.equal(monthly(rev, days, { today: '2026-10-20' })[0].partial, true); // 이번 달은 부분
  assert.equal(+r.dayYoy.toFixed(2), 0.25); assert.equal(r.barYoy, 0);
});

test('dailyCorrelation: 광고비와 무관하게 평소 수준이면 r≈0, 광고비 따라 오르면 r>0.9', () => {
  const rev = mkRev('2026-08-01', 90, () => ({ day: 400000, bar: 0 }));
  const flat = mkDays('2026-09-01', 59, (d, i) => ({ google: { cost: 10000 + (i % 5) * 1000 } }));
  assert.equal(dailyCorrelation(rev, flat).r, 0);
  const spend = (i) => 10000 + ((i * 7919) % 11) * 3000; // 주기 11일의 들쭉날쭉한 광고비
  const noisy = mkDays('2026-09-01', 59, (d, i) => ({ google: { cost: spend(i) } }));
  const rev2 = mkRev('2026-08-01', 90, (d, i) => ({ day: 300000 + (i >= 31 ? spend(i - 31) * 30 : 0), bar: 0 })); // 매출이 그날 광고비를 따라감
  assert.ok(dailyCorrelation(rev2, noisy).r > 0.5);
});

test('changePoints: 광고비가 2배로 뛴 날을 잡고 전후 14일 낮 매출 변화를 낸다', () => {
  const rev = mkRev('2026-09-01', 60, (d, i) => ({ day: i >= 30 ? 600000 : 400000, bar: 0 })); // 10/1 부터 매출 +50%
  const days = mkDays('2026-09-01', 60, (d, i) => ({ google: { cost: i >= 30 ? 20000 : 10000 } })); // 10/1 부터 광고비 2배
  const [c] = changePoints(rev, days);
  assert.equal(c.ch, 'google'); assert.equal(c.d, '2026-10-01'); assert.equal(c.chg, 1);
  assert.equal(+c.raw.toFixed(2), 0.5); assert.equal(c.adj, null); // 전년 데이터 없음 → 보정 불가
  assert.equal(c.ratio, 200000 / 10000);
});

test('verdict: 손익분기 2배 이상이면 good, 미만이면 warn', () => {
  const row = (o) => ({ m: '2026-10', partial: false, incrDayPerDay: 100000, adPerDay: 30000, barYoy: -0.1, ...o });
  assert.equal(verdict([row({ ratioDay: BREAK_EVEN * 3 })]).level, 'good');
  assert.equal(verdict([row({ ratioDay: 0.5 })]).level, 'warn');
  assert.equal(verdict([row({ m: '2026-11', partial: true, ratioDay: 9 })]).level, 'info');
});

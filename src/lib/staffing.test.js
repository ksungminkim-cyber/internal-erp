// src/lib/staffing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, spreadOrder, demandByDateHour, staffByDateHour, buildStaffing, shiftsToLogs, monthSalesForecast, groupRecs, coveredDates, DEFAULT_RULES } from './staffing.js';

const K = (d, h) => `${d}|${h}`;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('percentile: 순위 기반', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.75), 3);
  assert.equal(percentile([5], 0.85), 5);
  assert.equal(percentile([], 0.5), 0);
});

test('spreadOrder: 바로 결제한 주문은 그 시각 한 칸 (KST)', () => {
  // 2026-11-10(화) 14:20 KST
  assert.deepEqual(spreadOrder({ opened: '2026-11-10T05:20:00Z', closed: '2026-11-10T05:20:00Z' }, 5), [{ dateKey: '2026-11-10', dow: 2, hour: 14, wt: 1 }]);
});

test('spreadOrder: 바 테이블(20:30 열고 22:00 결제)은 머문 시간만큼 시간대에 나눈다', () => {
  const parts = spreadOrder({ opened: '2026-11-13T11:30:00Z', closed: '2026-11-13T13:00:00Z' }, 5); // 금 20:30~22:00 KST
  assert.deepEqual(parts.map((p) => p.hour), [20, 21]);
  near(parts[0].wt, 30 / 90); near(parts[1].wt, 60 / 90);
  near(parts.reduce((s, p) => s + p.wt, 0), 1);
});

test('spreadOrder: 5시간 넘게 열려 있던 주문(닫는 걸 잊은 것)은 결제 시각 한 칸으로', () => {
  const parts = spreadOrder({ opened: '2026-11-13T03:00:00Z', closed: '2026-11-13T13:10:00Z' }, 5);
  assert.deepEqual(parts, [{ dateKey: '2026-11-13', dow: 5, hour: 22, wt: 1 }]);
});

test('spreadOrder: 열린 시각이 없으면 결제 시각', () => {
  assert.deepEqual(spreadOrder({ opened: null, closed: '2026-11-10T05:20:00Z' }, 5), [{ dateKey: '2026-11-10', dow: 2, hour: 14, wt: 1 }]);
});

test('demandByDateHour: 매출·주문·잔 수를 시간대별로 합산', () => {
  const m = demandByDateHour([
    { created_at_pos: '2026-11-10T05:20:00Z', completed_at: '2026-11-10T05:20:00Z', charge_total: 5000, items: 1 },
    { created_at_pos: '2026-11-10T05:40:00Z', completed_at: '2026-11-10T05:40:00Z', charge_total: 12000, items: 3 },
    { created_at_pos: '2026-11-13T11:30:00Z', completed_at: '2026-11-13T13:00:00Z', charge_total: 90000, items: 9 },
  ], DEFAULT_RULES);
  assert.deepEqual(m.get(K('2026-11-10', 14)), { sales: 17000, orders: 2, items: 4 });
  near(m.get(K('2026-11-13', 20)).sales, 30000); near(m.get(K('2026-11-13', 21)).items, 6);
});

test('staffByDateHour: 시프트를 시간 칸으로 (30분은 0.5명), 취소 제외, 기본 시급 비용', () => {
  const m = staffByDateHour([
    { user_id: 'a', start_at: '2026-11-10T00:00:00Z', end_at: '2026-11-10T02:30:00Z', status: 'scheduled' }, // 09:00~11:30 KST
    { user_id: 'b', start_at: '2026-11-10T01:00:00Z', end_at: '2026-11-10T02:00:00Z', status: 'cancelled' },
  ], (u) => ({ a: 10000, b: 12000 }[u]));
  assert.deepEqual(m.get(K('2026-11-10', 9)), { staff: 1, cost: 10000 });
  assert.deepEqual(m.get(K('2026-11-10', 11)), { staff: 0.5, cost: 5000 });
  assert.equal(m.get(K('2026-11-10', 12)), undefined);
});

// 2주(월~일 ×2) 시나리오: 낮 14시는 한가(1명 배치), 금 21시는 바쁨(1명 배치 → 2명 권장), 화 13시는 2명 겹침(한가 → 1명 권장)
function scenario() {
  const dates = [];
  for (let i = 0; i < 14; i++) { const d = new Date(Date.UTC(2026, 10, 2 + i)); dates.push(d.toISOString().slice(0, 10)); } // 11/2(월)~11/15(일)
  const demand = new Map(); const staff = new Map();
  const dowOf = (k) => new Date(k + 'T00:00:00Z').getUTCDay();
  for (const d of dates) {
    for (let h = 9; h <= 23; h++) {
      const bar = h >= 19;
      let items = bar ? 4 : 6; let st = 1;
      if (dowOf(d) === 5 && h === 21) items = 30;           // 금 21시 바쁨
      if (dowOf(d) === 2 && h === 13) { st = 2; items = 5; } // 화 13시 2명 겹침, 한가
      demand.set(K(d, h), { sales: items * 6000, orders: items / 2, items });
      staff.set(K(d, h), { staff: st, cost: st * 10000 });
    }
  }
  return { dates, demand, staff };
}

test('buildStaffing: 최소 인원을 바닥으로, 1명이 소화한 양을 넘는 시간대만 2명 권장', () => {
  const { dates, demand, staff } = scenario();
  const r = buildStaffing({ demand, staff, dates, rules: DEFAULT_RULES, loadFactor: 1 });
  assert.equal(r.weeks, 2);
  const slot = (dow, hour) => r.slots.find((s) => s.dow === dow && s.hour === hour);
  assert.equal(slot(5, 21).rec, 2);           // 금 21시: 바쁨 → 2명
  assert.equal(slot(5, 21).kind, 'under');
  assert.equal(slot(2, 13).rec, 1);           // 화 13시: 2명 배치인데 한가 → 1명
  assert.equal(slot(2, 13).kind, 'over');
  assert.equal(slot(3, 14).rec, 1);           // 평범한 시간대는 그대로
  assert.equal(slot(3, 14).kind, 'ok');
  assert.equal(slot(3, 20).daypart, 'bar');
  assert.equal(slot(3, 14).daypart, 'day');
});

test('buildStaffing: 요약 — 인건비율, 권장 반영 시 절감·추가와 비율', () => {
  const { dates, demand, staff } = scenario();
  const r = buildStaffing({ demand, staff, dates, rules: DEFAULT_RULES, loadFactor: 1.2 });
  // 인건비 = 기본급 × 1.2 (주휴·가산 반영 배수)
  const base = [...staff.values()].reduce((s, x) => s + x.cost, 0);
  near(r.summary.laborCost, base * 1.2, 1);
  near(r.summary.ratio, r.summary.laborCost / r.summary.sales, 1e-9);
  // 화 13시 1명 줄이기: 주 1시간 × 10000원 × 1.2
  const over = r.recs.find((x) => x.kind === 'over');
  assert.equal(over.dow, 2); assert.equal(over.hour, 13);
  near(over.weeklyDelta, -12000, 1);
  const under = r.recs.find((x) => x.kind === 'under');
  near(under.weeklyDelta, 12000, 1);
  near(r.summary.weeklySaving, 12000, 1);     // 줄일 수 있는 금액(여유 칸 합)
  near(r.summary.weeklyAdd, 12000, 1);        // 부족 칸을 채우는 데 드는 금액
  assert.equal(r.byDow.length, 7);
  assert.equal(r.byDow.find((d) => d.dow === 2).days, 2);
});

test('buildStaffing: 근무도 주문도 거의 없는 시간대는 표에서 뺀다', () => {
  const { dates, demand, staff } = scenario();
  const r = buildStaffing({ demand, staff, dates, rules: DEFAULT_RULES, loadFactor: 1 });
  assert.equal(r.slots.some((s) => s.hour === 8 || s.hour === 3), false);
});

test('shiftsToLogs: 시프트를 출퇴근 기록 형태로 (인건비 계산기 재사용)', () => {
  assert.deepEqual(shiftsToLogs([
    { start_at: '2026-11-10T08:00:00Z', end_at: '2026-11-10T15:00:00Z', status: 'scheduled' },
    { start_at: '2026-11-09T00:00:00Z', end_at: '2026-11-09T05:00:00Z', status: 'confirmed' },
    { start_at: '2026-11-11T00:00:00Z', end_at: '2026-11-11T05:00:00Z', status: 'cancelled' },
  ]), [
    { event_type: 'clock_in', event_at: '2026-11-09T00:00:00Z' }, { event_type: 'clock_out', event_at: '2026-11-09T05:00:00Z' },
    { event_type: 'clock_in', event_at: '2026-11-10T08:00:00Z' }, { event_type: 'clock_out', event_at: '2026-11-10T15:00:00Z' },
  ]);
});

test('monthSalesForecast: 그 달의 요일 수 × 요일별 평균 매출', () => {
  const byDow = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, sales: (dow + 1) * 100000 }));
  // 2026-12 (12/1 화요일, 31일): 화·수·목 5번, 나머지 4번
  // 일(10만)·월(20만)·금(60만)·토(70만) ×4 = 640만, 화(30만)·수(40만)·목(50만) ×5 = 600만
  assert.equal(monthSalesForecast(byDow, 2026, 11), 12400000);
});

test('groupRecs: 이어진 시간은 한 구간으로, 같은 구간·같은 조정은 요일을 묶는다', () => {
  const mk = (dow, hour, kind, to, weeklyDelta) => ({ dow, hour, kind, to, from: kind === 'over' ? to + 1 : to - 0.5, weeklyDelta });
  const g = groupRecs([
    mk(2, 17, 'over', 1, -9000), mk(2, 18, 'over', 1, -9000),
    mk(3, 17, 'over', 1, -9000), mk(3, 18, 'over', 1, -9000),
    mk(5, 21, 'under', 2, 5000), mk(5, 22, 'under', 2, 5000),
    mk(6, 18, 'over', 1, -10000),
  ]);
  assert.deepEqual(g, [
    { kind: 'over', days: [2, 3], fromHour: 17, toHour: 19, to: 1, weeklyDelta: -36000 },
    { kind: 'over', days: [6], fromHour: 18, toHour: 19, to: 1, weeklyDelta: -10000 },
    { kind: 'under', days: [5], fromHour: 21, toHour: 23, to: 2, weeklyDelta: 10000 },
  ]);
});

test('coveredDates: 근무표가 있는 주만 남긴다 (비어 있는 주가 섞이면 평균이 왜곡됨)', () => {
  const dates = [];
  for (let i = 0; i < 21; i++) dates.push(new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10)); // 11/2(월)~11/22(일), 3주
  const mk = (day, n) => Array.from({ length: n }, () => ({ start_at: `2026-11-${String(day).padStart(2, '0')}T01:00:00Z`, status: 'scheduled' }));
  const shifts = [...mk(2, 3), ...mk(4, 3), ...mk(10, 2), ...mk(17, 6), { start_at: '2026-11-18T01:00:00Z', status: 'cancelled' }];
  const c = coveredDates(dates, shifts, 5);
  assert.equal(c.weeksTotal, 3);
  assert.equal(c.weeksCovered, 2);                 // 2주차는 2건뿐이라 제외
  assert.equal(c.dates.length, 14);
  assert.equal(c.dates[0], '2026-11-02'); assert.equal(c.dates[7], '2026-11-16');
  assert.equal(c.lastShiftDate, '2026-11-17');
});

test('coveredDates: KST 날짜로 주를 가른다 (일요일 밤 23시 KST 시작 시프트는 그 주)', () => {
  const dates = [];
  for (let i = 0; i < 14; i++) dates.push(new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10));
  // 11/8(일) 23:00 KST = 11/8 14:00Z → 1주차
  const shifts = Array.from({ length: 5 }, () => ({ start_at: '2026-11-08T14:00:00Z', status: 'scheduled' }));
  const c = coveredDates(dates, shifts, 5);
  assert.deepEqual([c.weeksCovered, c.dates[0], c.dates.length], [1, '2026-11-02', 7]);
});

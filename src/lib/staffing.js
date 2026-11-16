// src/lib/staffing.js
// 매출 기반 인력 배치 진단 — 순수 로직 (서버·클라이언트 공용, 시간은 모두 KST 로 명시 계산).
//
// 생각 방식
//  - 수요: 시간대별 "잔 수"(주문 품목 수량). 바 테이블은 주문을 열고 한참 뒤에 결제하므로
//          열린 시각~결제 시각 구간에 고르게 나눈다 (결제 시각만 보면 19시가 비어 보이는 문제 방지).
//  - 처리량: 근무한 모든 시간대의 "1인당 잔 수" 중 바빴던 시간(상위 10%) 값을 "1명이 감당 가능한 양"으로 본다. 낮·바 따로.
//          (1명만 있던 시간대로만 재면 한가한 시간만 잡혀 처리량이 과소평가된다 — 바쁠 땐 원래 2명을 세우므로)
//  - 권장 인원: max(최소 인원, 바쁜 주(상위 25%) 수요 ÷ 1명 처리량 올림). 평소 세우는 최대 인원은 넘지 않는다.

export const DEFAULT_RULES = {
  targetRatio: 0.30,   // 목표 인건비율
  dayFloor: 1,         // 낮 최소 인원
  barFloor: 1,         // 바 최소 인원 (주말 2명 여부는 밤 수요로 판단)
  barStartHour: 19,    // 이 시각부터 바 시간대
  maxSpreadHours: 5,   // 이보다 오래 열려 있던 주문은 닫는 걸 잊은 것으로 보고 결제 시각에 몰아 넣는다
};

const HOUR = 3600e3;
const KST = 9 * HOUR;
const key = (dateKey, hour) => `${dateKey}|${hour}`;

/** 순위 기반 백분위 (빈 배열은 0) */
export function percentile(values, p) {
  if (!values?.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

function kstParts(ms) {
  const d = new Date(ms + KST);
  return { dateKey: d.toISOString().slice(0, 10), dow: d.getUTCDay(), hour: d.getUTCHours() };
}

/**
 * 주문 하나를 시간 칸으로 나눈다. 반환: [{ dateKey, dow, hour, wt }] (wt 합 = 1)
 * @param {{ opened: string|null, closed: string }} o
 */
export function spreadOrder({ opened, closed }, maxSpreadHours = DEFAULT_RULES.maxSpreadHours) {
  const e = new Date(closed).getTime();
  let s = opened ? new Date(opened).getTime() : e;
  if (!Number.isFinite(s) || s > e || e - s > maxSpreadHours * HOUR) s = e;
  if (s === e) return [{ ...kstParts(e), wt: 1 }];
  const out = [];
  for (let t = Math.floor(s / HOUR) * HOUR; t < e; t += HOUR) {
    const overlap = Math.min(e, t + HOUR) - Math.max(s, t);
    if (overlap > 0) out.push({ ...kstParts(t), wt: overlap / (e - s) });
  }
  return out;
}

/**
 * 주문 목록 → 날짜·시간 칸별 수요. Map<'YYYY-MM-DD|H', { sales, orders, items }>
 * @param {{ created_at_pos, completed_at, charge_total, items }[]} orders
 */
export function demandByDateHour(orders, rules = DEFAULT_RULES) {
  const m = new Map();
  for (const o of orders ?? []) {
    if (!o?.completed_at) continue;
    for (const p of spreadOrder({ opened: o.created_at_pos, closed: o.completed_at }, rules.maxSpreadHours)) {
      const k = key(p.dateKey, p.hour);
      const cur = m.get(k) ?? { sales: 0, orders: 0, items: 0 };
      cur.sales += (Number(o.charge_total) || 0) * p.wt;
      cur.orders += p.wt;
      cur.items += (Number(o.items) || 0) * p.wt;
      m.set(k, cur);
    }
  }
  return m;
}

/**
 * 시프트 목록 → 날짜·시간 칸별 배치 인원·기본급. Map<key, { staff, cost }>
 * @param {{ user_id, start_at, end_at, status }[]} shifts
 * @param {(userId: string) => number} wageOf 시급
 */
export function staffByDateHour(shifts, wageOf) {
  const m = new Map();
  for (const sh of shifts ?? []) {
    if (!sh?.start_at || !sh?.end_at || sh.status === 'cancelled') continue;
    const s = new Date(sh.start_at).getTime(), e = new Date(sh.end_at).getTime();
    const wage = Number(wageOf?.(sh.user_id)) || 0;
    for (let t = Math.floor(s / HOUR) * HOUR; t < e; t += HOUR) {
      const frac = (Math.min(e, t + HOUR) - Math.max(s, t)) / HOUR;
      if (frac <= 0) continue;
      const p = kstParts(t);
      const k = key(p.dateKey, p.hour);
      const cur = m.get(k) ?? { staff: 0, cost: 0 };
      cur.staff += frac; cur.cost += frac * wage;
      m.set(k, cur);
    }
  }
  return m;
}

/** 시프트를 출퇴근 기록 형태로 — laborCalc.calcLabor 로 주휴·야간·연장을 계산하기 위함 */
export function shiftsToLogs(shifts) {
  return (shifts ?? [])
    .filter((s) => s?.start_at && s?.end_at && s.status !== 'cancelled')
    .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))
    .flatMap((s) => [{ event_type: 'clock_in', event_at: s.start_at }, { event_type: 'clock_out', event_at: s.end_at }]);
}

/** 그 달의 예상 매출 = 요일 수 × 요일별 하루 평균 매출. month0: 0 = 1월 */
export function monthSalesForecast(byDow, year, month0) {
  const avg = Object.fromEntries((byDow ?? []).map((d) => [d.dow, Number(d.sales) || 0]));
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  let total = 0;
  for (let d = 1; d <= days; d++) total += avg[new Date(Date.UTC(year, month0, d)).getUTCDay()] ?? 0;
  return Math.round(total);
}

/**
 * 진단 본체.
 * @param {{ demand: Map, staff: Map, dates: string[], rules?: object, loadFactor?: number }} p
 *   dates: 분석 기간의 날짜('YYYY-MM-DD', 온전한 주 단위). loadFactor: 기본급 → 실제 인건비(주휴·가산 포함) 배수
 */
export function buildStaffing({ demand, staff, dates, rules = DEFAULT_RULES, loadFactor = 1 }) {
  const dowOf = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const datesByDow = Array.from({ length: 7 }, () => []);
  for (const d of dates) datesByDow[dowOf(d)].push(d);
  const daypartOf = (hour) => (hour >= rules.barStartHour ? 'bar' : 'day');

  // 1명이 감당한 양: 근무자가 있던 칸의 "1인당 잔 수" 상위 10% 값 (낮·바 따로)
  const perStaff = { day: [], bar: [] };
  for (const d of dates) for (let h = 0; h < 24; h++) {
    const st = staff.get(key(d, h));
    if (!st || st.staff < 0.9) continue;
    perStaff[daypartOf(h)].push((demand.get(key(d, h))?.items ?? 0) / st.staff);
  }
  const capOf = (part) => {
    const own = percentile(perStaff[part], 0.9);
    if (own > 0) return own;
    return percentile([...perStaff.day, ...perStaff.bar], 0.9) || 0; // 표본이 없으면 전체로
  };
  const capacity = { day: capOf('day'), bar: capOf('bar'), daySamples: perStaff.day.length, barSamples: perStaff.bar.length };

  const raw = [];
  const byDowAcc = Array.from({ length: 7 }, () => ({ sales: 0, cost: 0 }));
  let totalSales = 0, totalBase = 0;
  for (let dow = 0; dow < 7; dow++) {
    const ds = datesByDow[dow];
    if (!ds.length) continue;
    for (let hour = 0; hour < 24; hour++) {
      let sales = 0, items = 0, orders = 0, st = 0, cost = 0;
      const itemSeries = [];
      for (const d of ds) {
        const dm = demand.get(key(d, hour)), sm = staff.get(key(d, hour));
        sales += dm?.sales ?? 0; items += dm?.items ?? 0; orders += dm?.orders ?? 0;
        st += sm?.staff ?? 0; cost += sm?.cost ?? 0;
        itemSeries.push(dm?.items ?? 0);
      }
      totalSales += sales; totalBase += cost;
      byDowAcc[dow].sales += sales; byDowAcc[dow].cost += cost;
      const n = ds.length;
      const avgStaff = st / n, avgItems = items / n;
      if (avgStaff < 0.5 && avgItems < 1) continue; // 영업 안 하는 시간대
      raw.push({
        dow, hour, daypart: daypartOf(hour),
        avgSales: sales / n, avgOrders: orders / n, avgItems, p75Items: percentile(itemSeries, 0.75),
        avgStaff, avgCost: (cost / n) * loadFactor,
      });
    }
  }
  // 권장은 평소 세우는 최대 인원(반올림 평균의 최댓값, 최소 2)을 넘지 않는다 — 작은 매장에 없는 인원을 권하지 않도록
  const maxRec = Math.max(2, ...raw.map((s) => Math.round(s.avgStaff)));
  const slots = raw.map((s) => {
    const floor = s.daypart === 'bar' ? rules.barFloor : rules.dayFloor;
    const cap = capacity[s.daypart];
    const rec = Math.min(maxRec, Math.max(floor, cap > 0 ? Math.ceil(s.p75Items / cap) : floor));
    const diff = s.avgStaff - rec;
    return { ...s, rec, kind: diff >= 0.5 ? 'over' : diff <= -0.5 ? 'under' : 'ok' };
  });

  const laborCost = totalBase * loadFactor;
  // 시급 평균(전체) — 부족 칸을 채울 때 드는 비용 추정에 사용
  let staffHours = 0;
  for (const d of dates) for (let h = 0; h < 24; h++) staffHours += staff.get(key(d, h))?.staff ?? 0;
  const avgWage = staffHours > 0 ? totalBase / staffHours : 0;

  const recs = slots.filter((s) => s.kind !== 'ok').map((s) => {
    const wage = s.avgStaff > 0 ? s.avgCost / s.avgStaff : avgWage * loadFactor;
    return { dow: s.dow, hour: s.hour, daypart: s.daypart, kind: s.kind, from: s.avgStaff, to: s.rec, weeklyDelta: (s.rec - s.avgStaff) * wage };
  }).sort((a, b) => a.weeklyDelta - b.weeklyDelta);

  const weeks = dates.length / 7;
  const weeklySaving = -recs.filter((r) => r.kind === 'over').reduce((s, r) => s + r.weeklyDelta, 0);
  const weeklyAdd = recs.filter((r) => r.kind === 'under').reduce((s, r) => s + r.weeklyDelta, 0);
  const weeklySales = weeks > 0 ? totalSales / weeks : 0;
  const weeklyLabor = weeks > 0 ? laborCost / weeks : 0;

  return {
    weeks,
    capacity,
    summary: {
      sales: totalSales, laborCost,
      ratio: totalSales > 0 ? laborCost / totalSales : null,
      targetRatio: rules.targetRatio,
      weeklySales, weeklyLabor, weeklySaving, weeklyAdd,
      // 여유 칸만 줄였을 때 / 부족 칸까지 채웠을 때의 인건비율
      ratioIfTrimmed: weeklySales > 0 ? (weeklyLabor - weeklySaving) / weeklySales : null,
      ratioIfApplied: weeklySales > 0 ? (weeklyLabor - weeklySaving + weeklyAdd) / weeklySales : null,
    },
    byDow: byDowAcc.map((a, dow) => {
      const days = datesByDow[dow].length;
      const sales = days ? a.sales / days : 0, cost = days ? (a.cost * loadFactor) / days : 0;
      return { dow, days, sales, laborCost: cost, ratio: sales > 0 ? cost / sales : null };
    }),
    slots,
    recs,
  };
}

/**
 * 시간 칸 단위 제안을 읽기 쉬운 묶음으로.
 * 같은 요일의 이어진 시간(같은 종류·같은 권장 인원)을 한 구간으로 합치고, 구간이 같은 요일끼리 묶는다.
 * 요일 순서는 월→일. 반환: [{ kind, days: [dow], fromHour, toHour(끝 시각, 미포함), to, weeklyDelta }]
 * 정렬: 줄이는 것(절감 큰 순) 먼저, 그다음 보강.
 */
export function groupRecs(recs) {
  const order = (dow) => (dow === 0 ? 7 : dow);
  const sorted = [...(recs ?? [])].sort((a, b) => order(a.dow) - order(b.dow) || a.hour - b.hour);
  const ranges = [];
  for (const r of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.dow === r.dow && last.kind === r.kind && last.to === r.to && last.toHour === r.hour) {
      last.toHour = r.hour + 1; last.weeklyDelta += r.weeklyDelta;
    } else {
      ranges.push({ dow: r.dow, kind: r.kind, to: r.to, fromHour: r.hour, toHour: r.hour + 1, weeklyDelta: r.weeklyDelta });
    }
  }
  const groups = new Map();
  for (const r of ranges) {
    const k = `${r.kind}|${r.fromHour}|${r.toHour}|${r.to}`;
    const g = groups.get(k) ?? { kind: r.kind, days: [], fromHour: r.fromHour, toHour: r.toHour, to: r.to, weeklyDelta: 0 };
    g.days.push(r.dow); g.weeklyDelta += r.weeklyDelta;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => (a.kind === b.kind ? (a.kind === 'over' ? a.weeklyDelta - b.weeklyDelta : b.weeklyDelta - a.weeklyDelta) : a.kind === 'over' ? -1 : 1));
}

/**
 * 분석 기간(온전한 주 단위 dates) 중 근무표가 들어 있는 주만 남긴다.
 * 근무표가 빈 주가 섞이면 "배치 0명"으로 평균돼 인건비율·권장이 왜곡된다 (예: 구글시트로 관리해 Counter 에 안 넣은 달).
 * @returns {{ dates: string[], weeksTotal: number, weeksCovered: number, lastShiftDate: string|null }}
 */
export function coveredDates(dates, shifts, minPerWeek = 5) {
  const count = new Map();
  let lastShiftDate = null;
  for (const s of shifts ?? []) {
    if (!s?.start_at || s.status === 'cancelled') continue;
    const d = kstParts(new Date(s.start_at).getTime()).dateKey;
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  const out = [];
  const weeksTotal = Math.floor(dates.length / 7);
  let weeksCovered = 0;
  for (let w = 0; w < weeksTotal; w++) {
    const week = dates.slice(w * 7, w * 7 + 7);
    const n = week.reduce((s, d) => s + (count.get(d) ?? 0), 0);
    for (const d of week) if (count.has(d) && (!lastShiftDate || d > lastShiftDate)) lastShiftDate = d;
    if (n >= minPerWeek) { weeksCovered += 1; out.push(...week); }
  }
  return { dates: out, weeksTotal, weeksCovered, lastShiftDate };
}

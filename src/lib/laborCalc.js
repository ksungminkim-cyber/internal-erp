// 근로기준법 기반 인건비 자동 계산
// - 야간수당: 22:00 ~ 익일 06:00 근무분에 대해 +50%
// - 연장수당: 1일 8시간 초과분에 대해 +50%
// - 주휴수당: 1주 15시간 이상 근무 시 (주 근무 / 40) × 8h × 시급, 주 40h 상한

const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;
const OVERTIME_DAILY_MINUTES = 8 * 60;
const WEEKLY_REST_THRESHOLD_MINUTES = 15 * 60;
const WEEKLY_FULLTIME_CAP_MINUTES = 40 * 60;
const PREMIUM_RATE = 0.5;

/**
 * 한 직원의 attendance_logs 를 받아 인건비 상세 산출
 * @param {Array} logs - {event_type, event_at} 시간 순 정렬
 * @param {number} hourlyWage
 * @returns {Object} 상세 내역
 */
export function calcLabor(logs, hourlyWage) {
  const sessions = parseSessions(logs);

  let baseMins = 0;
  let nightMins = 0;
  const dailyMins = {}; // 'YYYY-MM-DD' → 분
  const weeklyMins = {}; // 주 시작일 → 분

  for (const s of sessions) {
    const mins = Math.max(0, Math.floor((s.end - s.start) / 60000));
    baseMins += mins;
    nightMins += nightMinutesIn(s.start, s.end);

    const dKey = ymd(s.start);
    dailyMins[dKey] = (dailyMins[dKey] ?? 0) + mins;
    const wKey = weekKey(s.start);
    weeklyMins[wKey] = (weeklyMins[wKey] ?? 0) + mins;
  }

  // 연장: 일 8시간 초과
  let overtimeMins = 0;
  for (const m of Object.values(dailyMins)) {
    if (m > OVERTIME_DAILY_MINUTES) overtimeMins += m - OVERTIME_DAILY_MINUTES;
  }

  // 주휴: 1주 15h 이상이면 비례 산정
  let weeklyRestMins = 0;
  for (const m of Object.values(weeklyMins)) {
    if (m >= WEEKLY_REST_THRESHOLD_MINUTES) {
      const cappedMins = Math.min(m, WEEKLY_FULLTIME_CAP_MINUTES);
      // 1주 소정근로 / 40 × 8h
      weeklyRestMins += Math.round((cappedMins / 40) * 8);
    }
  }

  const w = Number(hourlyWage) || 0;
  const baseCost       = Math.round((baseMins        / 60) * w);
  const nightPremium   = Math.round((nightMins       / 60) * w * PREMIUM_RATE);
  const overtimePremium = Math.round((overtimeMins   / 60) * w * PREMIUM_RATE);
  const weeklyRestPay  = Math.round((weeklyRestMins  / 60) * w);
  const totalLabor = baseCost + nightPremium + overtimePremium + weeklyRestPay;

  return {
    baseMinutes: baseMins,
    nightMinutes: nightMins,
    overtimeMinutes: overtimeMins,
    weeklyRestMinutes: weeklyRestMins,
    baseCost, nightPremium, overtimePremium, weeklyRestPay,
    totalLabor,
  };
}

// 출퇴근 로그를 work session 으로 변환 (휴게 제외)
function parseSessions(logs) {
  const sessions = [];
  let clockIn = null;
  let breakStart = null;
  let currentBreaks = [];

  for (const l of logs) {
    const t = new Date(l.event_at);
    if (l.event_type === 'clock_in') {
      clockIn = t;
      currentBreaks = [];
      breakStart = null;
    } else if (l.event_type === 'break_start' && clockIn) {
      breakStart = t;
    } else if (l.event_type === 'break_end' && breakStart) {
      currentBreaks.push({ start: breakStart, end: t });
      breakStart = null;
    } else if (l.event_type === 'clock_out' && clockIn) {
      const subs = subtractRanges(clockIn, t, currentBreaks);
      sessions.push(...subs);
      clockIn = null;
      currentBreaks = [];
      breakStart = null;
    }
  }
  return sessions;
}

// [start, end] 에서 ranges([{start,end}, ...]) 를 빼고 남는 구간
function subtractRanges(start, end, ranges) {
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const result = [];
  let cur = new Date(start);
  for (const r of sorted) {
    if (r.start > cur) {
      const segEnd = r.start < end ? new Date(r.start) : new Date(end);
      result.push({ start: new Date(cur), end: segEnd });
    }
    if (r.end > cur) cur = new Date(r.end);
    if (cur >= end) break;
  }
  if (cur < end) result.push({ start: new Date(cur), end: new Date(end) });
  return result.filter((r) => r.end > r.start);
}

// [start, end] 안에서 야간 시간대(22:00~익일 06:00) 와 겹치는 분
function nightMinutesIn(start, end) {
  let mins = 0;
  // 시작일의 00:00 ~ 종료일의 다음날 00:00 사이 매일 두 구간 검사
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const lastDay = new Date(end);
  lastDay.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= lastDay.getTime()) {
    // 새벽: 00:00 ~ 06:00
    const m1 = new Date(cursor);
    const m2 = new Date(cursor); m2.setHours(NIGHT_END_HOUR, 0, 0, 0);
    mins += overlap(start, end, m1, m2);
    // 저녁: 22:00 ~ 다음날 00:00
    const e1 = new Date(cursor); e1.setHours(NIGHT_START_HOUR, 0, 0, 0);
    const e2 = new Date(cursor); e2.setDate(e2.getDate() + 1); e2.setHours(0, 0, 0, 0);
    mins += overlap(start, end, e1, e2);
    cursor.setDate(cursor.getDate() + 1);
  }
  return mins;
}

function overlap(a1, a2, b1, b2) {
  const s = Math.max(a1.getTime(), b1.getTime());
  const e = Math.min(a2.getTime(), b2.getTime());
  return Math.max(0, Math.floor((e - s) / 60000));
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 월요일 시작 주의 식별자
function weekKey(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay() === 0 ? 7 : date.getDay(); // 일=7
  date.setDate(date.getDate() - day + 1); // 월요일로
  return ymd(date);
}

// 분 → "Xh Ym"
export function formatMinutes(mins) {
  if (!mins) return '0h 0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

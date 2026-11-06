// src/lib/shiftCopy.js
// 시프트 표시·지난달 복사 순수 로직.

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 지난달 → 대상 달 "요일 기준" 복사 매핑.
 * 대상 달의 날짜마다 같은 요일인 4주 전 날짜(지난달 안이면)를, 아니면 5주 전 날짜를 원본으로 잡는다.
 * 그래서 대상 달의 모든 날이 채워지고 요일이 보존된다. 지난달 앞쪽 며칠은 안 쓰이고, 뒤쪽 며칠은 두 번 쓰일 수 있다.
 * @param {number} targetYear
 * @param {number} targetMonth0 0 = 1월
 * @returns {Map<string, Date[]>} 지난달 날짜 키('YYYY-MM-DD') → 대상 달 날짜들(로컬 자정)
 */
export function buildWeekdayCopyMap(targetYear, targetMonth0) {
  const prevStart = new Date(targetYear, targetMonth0 - 1, 1);
  const prevEnd = new Date(targetYear, targetMonth0, 1); // 대상 달 1일 (exclusive)
  const daysInTarget = new Date(targetYear, targetMonth0 + 1, 0).getDate();
  const map = new Map();
  for (let day = 1; day <= daysInTarget; day++) {
    const t = new Date(targetYear, targetMonth0, day);
    for (const weeks of [4, 5]) {
      const src = new Date(targetYear, targetMonth0, day - 7 * weeks);
      if (src >= prevStart && src < prevEnd) {
        const k = dateKey(src);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(t);
        break;
      }
    }
  }
  return map;
}

/** '11-14' / '9:30-13' — 좁은 칸용. 정각이면 분을 생략 */
export function formatShiftRangeCompact(startIso, endIso, timeZone) {
  const f = (iso) => {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return m === '00' ? String(h) : `${h}:${m}`;
  };
  return `${f(startIso)}-${f(endIso)}`;
}

/** '09:00-13:00' — 시작·끝 시각 (timeZone 은 테스트용, 브라우저에서는 기본 로컬) */
export function formatShiftRange(startIso, endIso, timeZone) {
  const opt = { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) };
  const f = (iso) => new Date(iso).toLocaleTimeString('ko-KR', opt);
  return `${f(startIso)}-${f(endIso)}`;
}

// src/lib/salesRanges.js
// 상품별 판매 카드의 기간 칩 → { from, to } ('YYYY-MM-DD', 양 끝 포함). 브라우저 로컬(KST) 기준.
import { ymd } from './date.js';

export const RANGES = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'lastWeek', label: '지난 주' },
  { key: 'lastMonth', label: '지난 달' },
  { key: 'custom', label: '직접 선택' },
];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// 이번 주 월요일 (일요일은 지난 월요일)
function monday(d) { return addDays(d, -((d.getDay() + 6) % 7)); }

export function rangeDates(key, custom, now = new Date()) {
  const today = startOfDay(now);
  switch (key) {
    case 'today': return { from: ymd(today), to: ymd(today) };
    case 'week': return { from: ymd(monday(today)), to: ymd(today) };
    case 'month': return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
    case 'lastWeek': {
      const mon = addDays(monday(today), -7);
      return { from: ymd(mon), to: ymd(addDays(mon, 6)) };
    }
    case 'lastMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: ymd(first), to: ymd(last) };
    }
    default: return custom;
  }
}

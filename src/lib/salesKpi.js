// src/lib/salesKpi.js
// 월 매출 목표 KPI 계산. 순수 함수.

const BAR_RE = /칵테일|위스키|스피리츠|맥주|와인|하이볼|주류|사케|소주/;

export function isBarCategory(category) {
  return BAR_RE.test(String(category ?? ''));
}

/**
 * @param {{ target: number, monthTotal: number, todayKey: string }} p todayKey 'YYYY-MM-DD'
 */
export function computeKpi({ target, monthTotal, todayKey }) {
  const t = Number(target) || 0;
  const m = Number(monthTotal) || 0;
  const [y, mo, d] = String(todayKey).split('-').map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - d + 1);       // 오늘 포함
  const remaining = Math.max(0, t - m);
  const progress = t > 0 ? Math.round((m / t) * 100) / 100 : 0;
  return {
    target: t,
    monthTotal: m,
    remaining,
    progress,
    daysInMonth,
    daysLeft,
    perDayNeeded: remaining > 0 ? Math.ceil(remaining / daysLeft) : 0,
  };
}

/** 남은 금액을 이 상품만으로 채운다면 몇 개 더 팔아야 하는지 (평균 단가 기준). 단가를 알 수 없으면 null */
export function unitsToTarget(remaining, product) {
  const qty = Number(product?.qty) || 0;
  const amount = Number(product?.amount) || 0;
  if (!(qty > 0) || !(amount > 0)) return null;
  const unitPrice = amount / qty;
  const r = Math.max(0, Number(remaining) || 0);
  return r === 0 ? 0 : Math.ceil(r / unitPrice);
}

/** 총 필요 개수를 남은 날로 나눈 하루 몫 (올림). null 은 그대로 */
export function perDayUnits(units, daysLeft) {
  if (units == null) return null;
  const u = Math.max(0, Number(units) || 0);
  const d = Math.max(1, Number(daysLeft) || 1);
  return u === 0 ? 0 : Math.ceil(u / d);
}

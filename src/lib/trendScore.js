// src/lib/trendScore.js
// 네이버 데이터랩 주간 검색 지수 시계열 → 트렌드 점수. 순수 함수.

/** 'YYYY-MM-DD' 의 그 주 월요일 키 */
export function weekStartKey(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay();                // 0=일
  t.setUTCDate(t.getUTCDate() - ((dow + 6) % 7));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * @param {number[]} series 오래된 주 → 최근 주 순서의 검색 지수 (최대 12주 권장)
 * @returns {{ recentAvg, baseAvg, changePct: number|null, score: number } | null}
 *  - changePct: 최근 4주 평균이 이전 기간 평균 대비 몇 % 올랐는지. 이전 기간이 0이면 null
 *  - score: 상승률이 양수일 때 상승률 비율 × 최근 평균 (관심이 크고 가파를수록 높음). 하락은 0
 */
export function scoreTrend(series) {
  const xs = (series ?? []).map((v) => Number(v) || 0);
  if (xs.length < 4) return null;
  const recent = xs.slice(-4);
  const base = xs.slice(0, -4);
  const recentAvg = Math.round(avg(recent) * 100) / 100;
  const baseAvg = Math.round(avg(base) * 100) / 100;
  if (base.length === 0 || baseAvg === 0) {
    return { recentAvg, baseAvg, changePct: null, score: recentAvg };
  }
  const changePct = Math.round(((recentAvg / baseAvg) - 1) * 100);
  const score = changePct > 0 ? Math.round((changePct / 100) * recentAvg * 100) / 100 : 0;
  return { recentAvg, baseAvg, changePct, score };
}

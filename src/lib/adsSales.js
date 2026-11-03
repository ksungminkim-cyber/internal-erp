// src/lib/adsSales.js
// 광고비 → 매출 기여 추정 (순수 함수). 오프라인 매장이라 전환 추적이 없으므로 "인과"가 아니라
// 전년 동기·직전 기간 보정 후의 "증분 매출 대 광고비" 비율과, 예산이 크게 바뀐 시점 전후 비교로 판단한다.
// rev: { 'YYYY-MM-DD': { day, bar } } (낮=19시 전, 바=19시 이후 POS 매출), days: ad_dashboard.data.days

export const GROSS_MARGIN = 0.7; // 원가표 기준 음료 원가율 10~25%, 베이커리 30% → 매출총이익률 약 70%. 광고비 1원이 남으려면 증분 매출 1/0.7 ≈ 1.4원 필요
export const BREAK_EVEN = 1 / GROSS_MARGIN;
const CHS = ['naver', 'google', 'meta', 'karrot'];

const adOf = (x) => CHS.reduce((a, k) => a + ((x[k] && x[k].cost) || 0), 0);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastYear = (s) => `${+s.slice(0, 4) - 1}${s.slice(4)}`;
const sumRev = (rev, from, to) => { let day = 0, bar = 0, n = 0; for (let d = from; d <= to; d = addDays(d, 1)) { const r = rev[d]; if (!r) continue; day += r.day; bar += r.bar; n++; } return { day, bar, n }; };

// 월별: 매출(낮/바), 전년 동월, 광고비, 광고비/매출, 전년 대비 증분 매출 ÷ 광고비
export function monthly(rev, days, { months = 6, today = new Date().toISOString().slice(0, 10) } = {}) {
  const byM = {};
  for (const x of days) { const m = x.d.slice(0, 7); (byM[m] ||= { ad: 0, adDays: 0, ch: {} }).ad += adOf(x); byM[m].adDays++; for (const k of CHS) byM[m].ch[k] = (byM[m].ch[k] || 0) + ((x[k] && x[k].cost) || 0); }
  const revM = {};
  for (const [d, r] of Object.entries(rev)) { const m = d.slice(0, 7); const o = (revM[m] ||= { day: 0, bar: 0, n: 0 }); o.day += r.day; o.bar += r.bar; o.n++; }
  const keys = Object.keys(revM).filter((m) => byM[m]).sort().slice(-months);
  return keys.map((m) => {
    const r = revM[m], ly = revM[lastYear(m)], a = byM[m];
    const total = r.day + r.bar, lyTotal = ly ? ly.day + ly.bar : null;
    // 영업일 수가 다르면 일평균으로 비교
    const perDay = total / r.n, lyPerDay = ly ? lyTotal / ly.n : null;
    const incrPerDay = lyPerDay !== null ? perDay - lyPerDay : null; // 전년 대비 하루 증분 매출 (전체)
    const incrDayPerDay = ly && ly.day ? r.day / r.n - ly.day / ly.n : null; // 낮 매출만 (광고가 겨냥하는 쪽, 바 감소와 분리)
    const adPerDay = a.ad / a.adDays;
    return { m, day: r.day, bar: r.bar, total, n: r.n, perDay, lyPerDay, yoy: lyPerDay ? perDay / lyPerDay - 1 : null, dayYoy: ly && ly.day ? (r.day / r.n) / (ly.day / ly.n) - 1 : null, barYoy: ly && ly.bar ? (r.bar / r.n) / (ly.bar / ly.n) - 1 : null,
      ad: a.ad, adPerDay, adDays: a.adDays, ch: a.ch, adShare: total ? a.ad / total : 0, incrPerDay, incrDayPerDay,
      ratio: incrPerDay !== null && adPerDay > 0 ? incrPerDay / adPerDay : null, ratioDay: incrDayPerDay !== null && adPerDay > 0 ? incrDayPerDay / adPerDay : null,
      partial: m >= today.slice(0, 7) || a.adDays < r.n - 3 };
  });
}

// 일 단위 상관: 그날 광고비 vs 그날 낮 매출의 "평소 대비"(같은 요일 직전 4주 평균) 지수. 0 근처면 일별로는 못 읽는다는 뜻
export function dailyCorrelation(rev, days) {
  const usual = (d) => { const v = []; for (let w = 1; w <= 4; w++) { const p = addDays(d, -7 * w); if (rev[p] && rev[p].day > 0) v.push(rev[p].day); } return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const xs = [], ys = [];
  for (const x of days) { const r = rev[x.d]; const u = r && usual(x.d); if (!u) continue; xs.push(adOf(x)); ys.push(r.day / u); }
  const n = xs.length; if (n < 14) return { n, r: null };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { n, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}

// 예산 변화 시점: 채널의 7일 평균 광고비가 직전 14일 평균 대비 ±30% 이상(그리고 하루 3,000원 이상 차이) 바뀐 날.
// 전후 14일 매출(낮)을 전년 같은 날짜와 비교해 보정한 변화율을 낸다. 시점이 겹치면 가장 큰 변화만 남긴다.
export function changePoints(rev, days, { window = 14 } = {}) {
  const out = [];
  const byD = Object.fromEntries(days.map((x) => [x.d, x]));
  const spend = (k, from, to) => { let s = 0, n = 0; for (let d = from; d <= to; d = addDays(d, 1)) { if (byD[d]) { s += (byD[d][k] && byD[d][k].cost) || 0; n++; } } return n ? s / n : 0; };
  for (const k of CHS) {
    for (let i = 14; i < days.length - 6; i++) {
      const d = days[i].d;
      const before = spend(k, addDays(d, -14), addDays(d, -1)), after = spend(k, d, addDays(d, 6));
      if (Math.abs(after - before) < 5000) continue;
      const chg = before ? after / before - 1 : (after ? 10 : 0);
      if (Math.abs(chg) < 0.3) continue;
      const preFrom = addDays(d, -window), preTo = addDays(d, -1), postFrom = d, postTo = addDays(d, window - 1);
      const pre = sumRev(rev, preFrom, preTo), post = sumRev(rev, postFrom, postTo);
      if (pre.n < window * 0.7 || post.n < window * 0.5) continue;
      const preLY = sumRev(rev, lastYear(preFrom), lastYear(preTo)), postLY = sumRev(rev, lastYear(postFrom), lastYear(postTo));
      const raw = (post.day / post.n) / (pre.day / pre.n) - 1;
      const adj = preLY.n >= window * 0.7 && postLY.n >= window * 0.5 && preLY.day && postLY.day ? ((post.day / post.n) / (postLY.day / postLY.n)) / ((pre.day / pre.n) / (preLY.day / preLY.n)) - 1 : null;
      const adDelta = after - before; // 하루 광고비 변화
      const revDelta = (adj ?? raw) * (pre.day / pre.n); // 하루 낮 매출 변화 (전년 보정값이 있으면 그것으로)
      out.push({ ch: k, d, before, after, chg, preDays: pre.n, postDays: post.n, partial: post.n < window, raw, adj, adDelta, revDelta, ratio: adDelta > 0 ? revDelta / adDelta : null });
    }
  }
  // 같은 채널에서 14일 안에 여러 시점이 잡히면 변화폭이 큰 것만
  out.sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
  const keep = [];
  for (const c of out) if (!keep.some((x) => x.ch === c.ch && Math.abs(new Date(x.d) - new Date(c.d)) < 14 * 864e5)) keep.push(c);
  return keep.sort((a, b) => (a.d < b.d ? 1 : -1));
}

// 한 줄 판정: 가장 최근 완결 월 기준
export function verdict(rows) {
  const full = rows.filter((r) => !r.partial && r.ratioDay !== null);
  const r = full[full.length - 1];
  if (!r) return { level: 'info', text: '전년 같은 달 매출이 없어 증분을 계산할 수 없습니다. 월이 더 쌓이면 자동으로 채워집니다.' };
  const x = r.ratioDay, m = +r.m.slice(5), bar = r.barYoy !== null ? ` 바 매출은 전년 대비 ${r.barYoy >= 0 ? '+' : ''}${Math.round(r.barYoy * 100)}%로 별개의 문제입니다.` : '';
  if (x >= BREAK_EVEN * 2) return { level: 'good', text: `${m}월 낮 매출이 전년보다 하루 ${Math.round(r.incrDayPerDay / 1e4)}만 원 늘었고, 하루 광고비 ${Math.round(r.adPerDay / 1e4)}만 원의 ${x.toFixed(1)}배입니다 (손익분기 ${BREAK_EVEN.toFixed(1)}배). 광고가 전부 원인은 아니어도 예산을 늘려 볼 근거는 됩니다. 한 채널씩 +50%로 2주 실험해 아래 「예산 변화 전후」에서 확인하세요.${bar}` };
  if (x >= BREAK_EVEN) return { level: 'info', text: `${m}월 낮 매출 증분이 광고비의 ${x.toFixed(1)}배로 손익분기(${BREAK_EVEN.toFixed(1)}배)를 겨우 넘습니다. 예산을 늘리기보다 채널별 효율을 먼저 가르세요.${bar}` };
  return { level: 'warn', text: `${m}월 낮 매출 증분이 광고비의 ${x.toFixed(1)}배로 손익분기(${BREAK_EVEN.toFixed(1)}배)에 못 미칩니다. 예산을 늘릴 근거가 없습니다. 효율 낮은 채널부터 줄이세요.${bar}` };
}

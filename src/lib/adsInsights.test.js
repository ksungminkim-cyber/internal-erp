// src/lib/adsInsights.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stats, bucketize, buildInsights } from './adsInsights.js';

const day = (d, ch, cost, imp, inn, extra = {}) => ({ d, [ch]: { cost, imp, in: inn, c: [], ...extra } });
const seq = (from, n, f) => Array.from({ length: n }, (_, i) => { const t = new Date(from + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + i); return f(t.toISOString().slice(0, 10), i); });

test('stats: 합계·클릭률·유입당·지출일·순위 평균', () => {
  const s = stats([day('2026-10-01', 'naver', 1000, 100, 10, { rank: 3 }), day('2026-10-02', 'naver', 0, 0, 0, { rank: 5 })], 'naver');
  assert.equal(s.cost, 1000); assert.equal(s.days, 2); assert.equal(s.spendDays, 1);
  assert.equal(s.ctr, 0.1); assert.equal(s.cpi, 100); assert.equal(s.rank, 4);
});

test('bucketize: 주는 월요일 기준, 월은 YYYY-MM, 부분 묶음 표시', () => {
  const days = seq('2026-10-26', 10, (d) => day(d, 'google', 100, 10, 1)); // 10/26(월)~11/4(수)
  const w = bucketize(days, 'week');
  assert.deepEqual(w.map((b) => [b.key, b.days.length, b.partial]), [['2026-10-26', 7, false], ['2026-11-02', 3, true]]);
  const m = bucketize(days, 'month');
  assert.deepEqual(m.map((b) => [b.key, b.days.length, b.partial]), [['2026-10', 6, true], ['2026-11', 4, true]]);
  assert.equal(bucketize(days, 'day', { limit: 3 }).length, 3);
});

test('buildInsights: 지출 0원 날·단가 상승(소재 피로)·잔액 경고가 액션 플랜 앞에 온다', () => {
  const base = seq('2026-09-01', 28, (d) => day(d, 'naver', 10000, 10000, 100));          // 평소 클릭당 100원, 클릭률 1%
  const cur = seq('2026-10-01', 4, (d, i) => day(d, 'naver', i === 3 ? 0 : 15000, 10000, 60)); // 단가 250원, 클릭률 0.6%, 하루 0원
  const r = buildInsights({ cur, base, D: { alerts: [{ ch: '네이버', level: 'warning', text: '비즈머니 잔액 1,000원' }] } });
  const titles = r.findings.map((f) => f.title);
  assert.ok(titles.some((t) => /4일 중 1일 지출 0원/.test(t)));
  const cpi = r.findings.find((f) => /클릭당 비용/.test(f.title));
  assert.ok(cpi && /소재 피로/.test(cpi.meaning) && cpi.test);
  assert.ok(!r.findings.some((f) => /잔액/.test(f.title))); // 잔액 경고는 해석에 넣지 않는다 (채널 카드가 보여줌)
  assert.ok(r.plan.every((f) => f.level !== 'good'));
});

test('buildInsights: 표본이 작으면 효율 판단을 유보하고, 집행 없는 채널은 info', () => {
  const r = buildInsights({ cur: [day('2026-10-01', 'meta', 500, 200, 3)], base: [] });
  assert.ok(r.findings.some((f) => f.ch === '메타' && /유보/.test(f.title)));
  assert.ok(r.findings.some((f) => f.ch === '구글' && /기록 없음/.test(f.title)));
});

test('buildInsights: 구글 디맨드젠 집중 + 높은 클릭률은 실수 클릭 경고, 네이버 소재 격차는 A/B 제안', () => {
  const cur = seq('2026-10-01', 7, (d) => ({ d, google: { cost: 30000, imp: 16000, in: 1300, c: [{ name: '녹턴 디스플레이_합정 #2', cost: 29000, imp: 15800, clicks: 1290 }, { name: '녹턴 검색', cost: 1000, imp: 200, clicks: 10 }] } }));
  const D = { naver: { ads: [{ name: 'A', imp: 10000, clicks: 200, cost: 1 }, { name: 'B', imp: 10000, clicks: 100, cost: 1 }] }, google: { status: { campaigns: [{ name: '녹턴 검색', status: '운영 가능(제한적)', budget: 10000 }] } } };
  const r = buildInsights({ cur, D });
  assert.ok(r.findings.some((f) => f.ch === '구글' && /실수 클릭/.test(f.meaning)));
  assert.ok(r.findings.some((f) => f.ch === '구글' && /예산 제약/.test(f.title)));
  const nv = r.findings.find((f) => f.ch === '네이버' && /소재 격차/.test(f.title));
  assert.ok(nv && nv.test && /「A」/.test(nv.test.what));
  // 버튼: 낮은 소재 끄기(서버 액션) + 변형 올리기(링크)
  assert.deepEqual(nv.ops.map((o) => [o.kind, o.args?.name]), [['naver.adLock', 'B'], ['link', undefined]]);
  const lim = r.findings.find((f) => f.ch === '구글' && /예산 제약/.test(f.title));
  assert.deepEqual(lim.ops[0], { kind: 'google.budget', label: '일예산 15,000원으로', args: { campaign: '녹턴 검색', amount: 15000 }, confirm: '구글 「녹턴 검색」 캠페인 일예산을 15,000원으로 바꿉니다.' });
});

test('buildInsights: 지출 0원은 재개 버튼, 효율 좋음은 예산 +20% 버튼', () => {
  const base = seq('2026-09-01', 28, (d) => day(d, 'naver', 10000, 10000, 100));
  const cur = seq('2026-10-01', 4, (d, i) => day(d, 'naver', i === 3 ? 0 : 7000, 10000, 100)); // 단가 70원 (-30%), 하루 0원
  const r = buildInsights({ cur, base, D: { alerts: [{ ch: '네이버', level: 'warning', text: '비즈머니 잔액 1,000원' }] } });
  assert.equal(r.findings.find((f) => /지출 0원/.test(f.title)).ops[0].kind, 'naver.campaignLock');
  assert.deepEqual(r.findings.find((f) => /저렴/.test(f.title)).ops[0].args, { pct: 20 });
});

// src/lib/adsInsights.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stats, bucketize, buildInsights, prepaidBalance, spendPace, paceWithHint, customRange, applyAdStatus, refreshSpendAlerts } from './adsInsights.js';

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

test('prepaidBalance: 기준일 뒤 지출만 빼고 0 아래로 내려가지 않는다', () => {
  const days = [{ d: '2026-11-12', karrot: { cost: 9000 } }, { d: '2026-11-13', karrot: { cost: 10000 } }, { d: '2026-11-14', karrot: null }, { d: '2026-11-15', karrot: { cost: 4000 }, naver: { cost: 999 } }];
  assert.equal(prepaidBalance(60000, '2026-11-12', days, 'karrot'), 46000);
  assert.equal(prepaidBalance(60000, '2026-11-15', days, 'karrot'), 60000);
  assert.equal(prepaidBalance(5000, '2026-11-12', days, 'karrot'), 0);
});

test('spendPace: 최근 7일 중 지출한 날의 중앙값 — 0원인 날과 중간에 끊긴 날에 흔들리지 않는다', () => {
  const mk = (costs) => costs.map((c, i) => ({ d: `2026-11-${String(i + 1).padStart(2, '0')}`, karrot: c === null ? null : { cost: c } }));
  assert.equal(spendPace(mk([99999, 4009, 0, 0, 6164, 10057, 10001, 9971]), 'karrot'), 9971); // 8일 전 값은 제외
  assert.equal(spendPace(mk([8000, 10000]), 'karrot'), 9000);
  assert.equal(spendPace(mk([0, null, 0]), 'karrot'), 0);
});

test('paceWithHint: 예산을 바꾼 직후에는 새 예산 속도를 쓰고, 기한이 지나면 실제 속도로 돌아간다', () => {
  const hint = { value: 20000, until: '2026-11-18' };
  assert.equal(paceWithHint(9971, hint, '2026-11-13'), 20000);
  assert.equal(paceWithHint(9971, hint, '2026-11-18'), 20000);
  assert.equal(paceWithHint(9971, hint, '2026-11-19'), 9971);
  assert.equal(paceWithHint(23000, hint, '2026-11-13'), 23000); // 실제가 더 빠르면 실제를 쓴다
  assert.equal(paceWithHint(9971, undefined, '2026-11-13'), 9971);
});

test('customRange: 프리셋에서 처음 고르면 그날 하루, 직접 지정 중이면 시작·끝을 따로 바꾸고 데이터 범위로 자른다', () => {
  const F = '2026-09-06', C = '2026-11-15';
  assert.deepEqual(customRange(null, 'from', '2026-11-05', F, C), { from: '2026-11-05', to: '2026-11-05' });
  assert.deepEqual(customRange(null, 'to', '2026-11-05', F, C), { from: '2026-11-05', to: '2026-11-05' });
  const one = { from: '2026-11-05', to: '2026-11-05' };
  assert.deepEqual(customRange(one, 'to', '2026-11-09', F, C), { from: '2026-11-05', to: '2026-11-09' });
  assert.deepEqual(customRange(one, 'from', '2026-11-01', F, C), { from: '2026-11-01', to: '2026-11-05' });
  assert.deepEqual(customRange(one, 'from', '2026-11-10', F, C), { from: '2026-11-10', to: '2026-11-10' }); // 시작이 끝을 넘으면 그날 하루
  assert.deepEqual(customRange(one, 'to', '2026-12-25', F, C), { from: '2026-11-05', to: C }); // 마감일 뒤는 마감일로
  assert.deepEqual(customRange(null, 'from', '2026-01-01', F, C), { from: F, to: F }); // 데이터 시작 전은 첫날로
});

// ── 서버 자동 마감이 광고 API에서 읽은 상태를 마감 자료에 반영
const baseD = () => ({
  closed: '2026-11-16',
  ads: [
    { ch: 'naver', name: '플레이스#1_녹턴', type: '플레이스 (클릭형+노출형)', status: '운영 중', budget: 25000, cost: 100, in: 10, lastSpend: '2026-11-16' },
    { ch: 'google', name: '녹턴 바_합정 저녁', type: '자동 수집', status: '운영 중', budget: null, cost: 5440, in: 10, lastSpend: '2026-11-16' },
    { ch: 'meta', name: '녹턴 흰색 트리', type: '인스타 게시물 홍보', status: '운영 중', budget: null, cost: 3338, in: 30, lastSpend: '2026-11-16' },
    { ch: 'karrot', name: '녹턴 #12', type: '비즈프로필 홍보', status: '운영중', budget: 5000, cost: 0, in: 0, lastSpend: '2026-10-27' },
  ],
  naver: { ads: [{ name: '옛 소재', status: 'ELIGIBLE', imp: 100, clicks: 1, cost: 90 }], bizmoney: -58, campaign: { name: '플레이스#1_녹턴', status: 'ELIGIBLE', dailyBudget: 25000 }, updated: '2026-11-09T01:02:42.512Z' },
  google: { status: { alerts: ['잔액이 거의 소진됨'], checked: '2026-11-09', campaigns: [] }, updated: '2026-11-09T01:02:50.541Z' },
  meta: { status: { spent: 17091, activeCampaigns: 1, checked: '2026-11-09' }, updated: '2026-11-09T01:02:47.637Z' },
  karrot: { status: { asOf: '2026-11-12', balance_cash: 163565, checked: '2026-11-09', campaigns: [{ name: '녹턴 #12', type: '비즈프로필 홍보', budget: 5000, status: '운영중' }] }, updated: '2026-11-09T01:02:50.000Z' },
});
const when = { today: '2026-11-17', now: '2026-11-17T08:00:00.000Z' };

test('applyAdStatus: 네이버 소재·일예산, 구글·당근 캠페인 상태·유형·일예산을 방금 읽은 값으로 바꾼다', () => {
  const D = baseD();
  const out = applyAdStatus(D, {
    naver: { campaign: { name: '플레이스#1_녹턴', status: 'PAUSED', dailyBudget: 30000 }, ads: [{ name: '저녁 7시부터는 칵테일 바', status: 'ELIGIBLE', imp: 2000, clicks: 30, cost: 2700 }] },
    google: { campaigns: [{ name: '녹턴 바_합정 저녁', type: '검색', status: '운영 가능', budget: 10000 }, { name: '새 캠페인', type: '디맨드젠', status: '일시중지됨', budget: 5000 }] },
    karrot: { campaigns: [{ name: '녹턴 (전문가) 토스트+바', type: 'Display (전문가)', status: '운영중', budget: 20000 }] },
    meta: null,
  }, when);
  assert.deepEqual(out.naver.ads.map((a) => a.name), ['저녁 7시부터는 칵테일 바']);
  assert.equal(out.naver.updated, when.now);
  assert.equal(out.naver.bizmoney, -58); // 건드리지 않는 값은 그대로
  const row = (ch, name) => out.ads.find((a) => a.ch === ch && a.name === name);
  assert.deepEqual([row('naver', '플레이스#1_녹턴').status, row('naver', '플레이스#1_녹턴').budget], ['PAUSED', 30000]);
  assert.deepEqual([row('google', '녹턴 바_합정 저녁').type, row('google', '녹턴 바_합정 저녁').budget, row('google', '녹턴 바_합정 저녁').cost], ['검색', 10000, 5440]);
  assert.deepEqual(row('google', '새 캠페인'), { ch: 'google', name: '새 캠페인', type: '디맨드젠', status: '일시중지됨', budget: 5000, cost: 0, in: 0, lastSpend: null });
  assert.deepEqual(out.google.status.alerts, ['잔액이 거의 소진됨']); // API로 못 읽는 값은 유지
  assert.equal(out.google.status.checked, '2026-11-17');
  // 당근: API에 없는 간편모드 캠페인은 남기고, 전문가모드 캠페인을 더한다. 잔액 기준값도 그대로
  assert.deepEqual(out.karrot.status.campaigns.map((c) => c.name), ['녹턴 #12', '녹턴 (전문가) 토스트+바']);
  assert.equal(out.karrot.status.balance_cash, 163565);
  assert.equal(row('karrot', '녹턴 (전문가) 토스트+바').budget, 20000);
  // 조회에 실패한 채널(null)과 원본은 그대로
  assert.deepEqual(out.meta, D.meta);
  assert.equal(D.naver.ads[0].name, '옛 소재');
  assert.equal(D.ads.length, 4);
});

test('applyAdStatus: 네이버 캠페인이 정상이면 「운영 중」, 메타는 이미 있는 캠페인의 상태만 바꾼다', () => {
  const out = applyAdStatus(baseD(), {
    naver: { campaign: { name: '플레이스#1_녹턴', status: 'ELIGIBLE', dailyBudget: 25000 }, ads: [] },
    google: null, karrot: null,
    meta: { activeCampaigns: 2, campaigns: [{ name: '녹턴 흰색 트리', status: '일시중지됨', budget: null }, { name: '표에 없는 캠페인', status: '운영 중', budget: 7000 }] },
  }, when);
  assert.equal(out.ads.find((a) => a.ch === 'naver').status, '운영 중');
  const m = out.ads.filter((a) => a.ch === 'meta');
  assert.deepEqual(m.map((a) => [a.name, a.status, a.budget]), [['녹턴 흰색 트리', '일시중지됨', null]]);
  assert.deepEqual([out.meta.status.activeCampaigns, out.meta.status.checked, out.meta.status.spent], [2, '2026-11-17', 17091]);
});

test('refreshSpendAlerts: 지난 마감일의 「지출 0원」 경고는 지우고, 이번 마감일에 0원인 채널만 다시 넣는다', () => {
  const alerts = [
    { ch: '구글', level: 'critical', text: '구글 애즈 경고: 잔액이 거의 소진됨.', at: '2026-11-09' },
    { ch: '네이버', level: 'warning', text: '마감일(2026-11-08)에 지출이 0원입니다. 광고가 멈췄는지 확인하세요.' },
    { ch: '당근', level: 'warning', text: '마감일(2026-11-08)에 지출이 0원입니다. 광고가 멈췄는지 확인하세요.' },
  ];
  const days = [day('2026-11-15', 'naver', 0, 0, 0), { d: '2026-11-16', naver: { cost: 15176, imp: 1, in: 1 }, google: { cost: 0, imp: 0, in: 0 }, meta: { cost: 0, imp: 0, in: 0 }, karrot: null }];
  const out = refreshSpendAlerts(alerts, days);
  assert.deepEqual(out.map((a) => [a.ch, a.text.slice(0, 16)]), [['구글', '구글 애즈 경고: 잔액이 거의'], ['구글', '마감일(2026-11-16)에']]);
  assert.equal(alerts.length, 3); // 원본은 그대로
  assert.deepEqual(refreshSpendAlerts(undefined, []), []);
});

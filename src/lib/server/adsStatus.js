// src/lib/server/adsStatus.js
// 광고 현황의 "상태" 부분을 광고 API에서 읽는다 (조회 전용): 네이버 소재별 최근 7일 성과·캠페인 일예산,
// 구글·당근 캠페인 유형·상태·일예산, 메타 캠페인 상태. /api/ads/close 가 매일 불러 마감 자료에 반영한다 (adsInsights 의 applyAdStatus).
// 예전에는 이 값을 PC의 로컬 일 마감(모니터링 폴더 collect_*.js)만 올려서, 그 작업이 멈추면 소재 표·상태·일예산이 굳었다.
// 이름·상태 문구 규칙은 로컬 수집기와 같게 맞춘다 (로컬 마감이 다시 올려도 같은 모양).
import { NAVER_CAMPAIGN, META_ACCOUNT, naverCall, adName, metaCall, googleCall } from './adsOps.js';
import { KARROT_ADVERTISER } from './adsLive.js';

const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// 소재별 성과는 어제까지 7일 합계 (화면의 「소재 · 최근 7일」)
async function naver(today) {
  const timeRange = JSON.stringify({ since: addDays(today, -7), until: addDays(today, -1) });
  const c = await naverCall('GET', `/ncc/campaigns/${NAVER_CAMPAIGN}`);
  const ads = [];
  for (const g of await naverCall('GET', '/ncc/adgroups', { query: { nccCampaignId: NAVER_CAMPAIGN } }))
    for (const a of await naverCall('GET', '/ncc/ads', { query: { nccAdgroupId: g.nccAdgroupId } })) {
      const r = await naverCall('GET', '/stats', { query: { id: a.nccAdId, fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt']), timeRange, timeIncrement: 'allDays' } });
      const s = (r.data && r.data[0]) || {};
      ads.push({ name: adName(a, g), status: a.status, imp: s.impCnt || 0, clicks: s.clkCnt || 0, cost: Math.round(s.salesAmt || 0) });
    }
  return { campaign: { name: c.name, status: c.status, dailyBudget: c.dailyBudget }, ads };
}

const G_TYPE = { SEARCH: '검색', DISPLAY: '디스플레이', DEMAND_GEN: '디맨드젠', PERFORMANCE_MAX: '실적 최대화', VIDEO: '동영상', SHOPPING: '쇼핑', LOCAL: '지역' };
const G_STATUS = { ELIGIBLE: '운영 가능', LIMITED: '운영 가능(제한적)', LEARNING: '운영 가능(학습 중)', PAUSED: '일시중지됨', ENDED: '종료됨', PENDING: '대기 중', NOT_ELIGIBLE: '운영 불가', MISCONFIGURED: '설정 오류', REMOVED: '삭제됨' };
async function google() {
  const j = await googleCall('googleAds:searchStream', { query: "SELECT campaign.name, campaign.status, campaign.primary_status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name" });
  return {
    campaigns: (Array.isArray(j) ? j : [j]).flatMap((b) => b.results || []).map(({ campaign: c, campaignBudget: b }) => ({
      name: c.name, type: G_TYPE[c.advertisingChannelType] || c.advertisingChannelType,
      status: c.status === 'PAUSED' ? G_STATUS.PAUSED : G_STATUS[c.primaryStatus] || c.primaryStatus,
      budget: Math.round((+(b && b.amountMicros) || 0) / 1e6),
    })),
  };
}

const M_STATUS = { ACTIVE: '운영 중', PAUSED: '일시중지됨', CAMPAIGN_PAUSED: '일시중지됨', ADSET_PAUSED: '일시중지됨' };
async function meta() {
  const [camps, sets] = await Promise.all([
    metaCall(`${META_ACCOUNT}/campaigns`, { fields: 'name,effective_status', limit: 200 }),
    metaCall(`${META_ACCOUNT}/adsets`, { fields: 'daily_budget,effective_status,campaign{name}', limit: 200 }),
  ]);
  const budgetBy = {}; // 켜져 있는 광고 세트의 일예산 합 (총예산형 게시물 홍보는 일예산이 없다)
  for (const a of sets.data || []) if (a.effective_status === 'ACTIVE' && +a.daily_budget) budgetBy[a.campaign?.name] = (budgetBy[a.campaign?.name] || 0) + +a.daily_budget;
  const list = camps.data || [];
  return {
    activeCampaigns: list.filter((c) => c.effective_status === 'ACTIVE').length,
    campaigns: list.map((c) => ({ name: c.name, status: M_STATUS[c.effective_status] || c.effective_status, budget: budgetBy[c.name] || null })),
  };
}

const K_STATUS = { ON: '운영중', OFF: '중지', DELETED: '삭제' };
async function karrot() {
  const key = process.env.KARROT_OPENAPI_KEY;
  if (!key) throw new Error('당근 OpenAPI 키 없음');
  const headers = { 'X-API-KEY': key, 'X-ADVERTISER-ID': KARROT_ADVERTISER, 'Content-Type': 'application/json' };
  const all = async (what) => {
    const out = [];
    for (let page = 1; ; page++) {
      const r = await fetch(`https://ads-openapi.kr.karrotmarket.com/v1/${what}?pageNumber=${page}&pageSize=100`, { headers, cache: 'no-store' });
      if (!r.ok) throw new Error(`당근 ${what} ${r.status}`);
      const j = await r.json();
      out.push(...(j[what] || []));
      if (!j.pagination || page >= j.pagination.totalPageCount) break;
    }
    return out;
  };
  const [camps, groups] = await Promise.all([all('campaigns'), all('groups')]);
  const budgetBy = {};
  for (const g of groups) if (g.budget && g.budget.type === 'DAILY_BUDGET') budgetBy[g.campaignId] = (budgetBy[g.campaignId] || 0) + Math.round(+g.budget.amount.value);
  return { campaigns: camps.filter((c) => c.liveStatus !== 'DELETED').map((c) => ({ name: c.title, type: `${c.type} (전문가)`, status: K_STATUS[c.liveStatus] || c.liveStatus, budget: budgetBy[c.id] ?? null })) };
}

// today: 한국 날짜 'YYYY-MM-DD'. 채널이 실패하면 그 채널만 null + errors 에 이유 (applyAdStatus 가 그 채널은 건드리지 않는다).
export async function fetchAdStatus(today) {
  const errors = {};
  const safe = (k, p) => p.catch((e) => { errors[k] = e.message; return null; });
  const [n, g, m, k] = await Promise.all([safe('naver', naver(today)), safe('google', google()), safe('meta', meta()), safe('karrot', karrot())]);
  return { naver: n, google: g, meta: m, karrot: k, errors };
}

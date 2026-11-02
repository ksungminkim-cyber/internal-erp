// src/lib/server/adsOps.js
// 광고 현황 「해석과 다음 액션」 버튼이 실제로 광고 설정을 바꾸는 부분 (대표가 눌렀을 때만 실행).
// 네이버 검색광고 API(소재 on/off·입찰가·일예산·캠페인 on/off), 메타 Marketing API(광고 세트 예산·on/off),
// 구글 애즈 API(캠페인 일예산). 당근 OpenAPI 는 쓰기 미확인이라 링크만 제공한다.
import crypto from 'crypto';

const NAVER_CAMPAIGN = 'cmp-a001-06-000000009424591';
const GOOGLE_CUSTOMER = '1309305023';
const META_ACCOUNT = 'act_1513789977241121';

// ── 네이버
async function naverCall(method, uri, { query, body } = {}) {
  const key = process.env.NAVER_AD_API_KEY, secret = process.env.NAVER_AD_SECRET_KEY, customer = process.env.NAVER_AD_CUSTOMER_ID;
  if (!key || !secret || !customer) throw new Error('네이버 API 환경변수 없음');
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${method}.${uri}`).digest('base64');
  const r = await fetch(`https://api.searchad.naver.com${uri}${query ? `?${new URLSearchParams(query)}` : ''}`, {
    method, headers: { 'X-Timestamp': ts, 'X-API-KEY': key, 'X-Customer': customer, 'X-Signature': sig, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`네이버 ${r.status}: ${j.title || j.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const adName = (a, g) => (a.ad && (a.ad.description || a.ad.headline)) || g.name; // collect_naver 와 같은 이름 규칙

async function naverAds() {
  const out = [];
  for (const g of await naverCall('GET', '/ncc/adgroups', { query: { nccCampaignId: NAVER_CAMPAIGN } }))
    for (const a of await naverCall('GET', '/ncc/ads', { query: { nccAdgroupId: g.nccAdgroupId } })) out.push({ id: a.nccAdId, name: adName(a, g), userLock: a.userLock, group: g });
  return out;
}

const NAVER = {
  // 소재 끄기/켜기
  async adLock({ name, lock = true }) {
    const ad = (await naverAds()).find((a) => a.name === name);
    if (!ad) throw new Error(`소재를 찾지 못했습니다: ${name}`);
    await naverCall('PUT', `/ncc/ads/${ad.id}`, { query: { fields: 'userLock' }, body: { nccAdId: ad.id, userLock: lock } });
    return `「${name}」 소재를 ${lock ? '껐습니다' : '켰습니다'}.`;
  },
  // 광고그룹 입찰가 ±pct%
  async bid({ pct }) {
    const groups = await naverCall('GET', '/ncc/adgroups', { query: { nccCampaignId: NAVER_CAMPAIGN } });
    const done = [];
    for (const g of groups) {
      const next = Math.max(70, Math.round((g.bidAmt * (1 + pct / 100)) / 10) * 10);
      await naverCall('PUT', `/ncc/adgroups/${g.nccAdgroupId}`, { query: { fields: 'bidAmt' }, body: { nccAdgroupId: g.nccAdgroupId, bidAmt: next } });
      done.push(`${g.name} ${g.bidAmt}→${next}원`);
    }
    return `입찰가 변경: ${done.join(', ')}`;
  },
  // 캠페인 일예산 ±pct% 또는 금액 지정
  async budget({ pct, amount }) {
    const c = await naverCall('GET', `/ncc/campaigns/${NAVER_CAMPAIGN}`);
    const next = amount || Math.round((c.dailyBudget * (1 + pct / 100)) / 1000) * 1000;
    await naverCall('PUT', `/ncc/campaigns/${NAVER_CAMPAIGN}`, { query: { fields: 'dailyBudget' }, body: { nccCampaignId: NAVER_CAMPAIGN, dailyBudget: next, useDailyBudget: true } });
    return `플레이스 캠페인 일예산 ${c.dailyBudget.toLocaleString('ko-KR')}→${next.toLocaleString('ko-KR')}원`;
  },
  async campaignLock({ lock }) {
    await naverCall('PUT', `/ncc/campaigns/${NAVER_CAMPAIGN}`, { query: { fields: 'userLock' }, body: { nccCampaignId: NAVER_CAMPAIGN, userLock: lock } });
    return `플레이스 캠페인을 ${lock ? '중지했습니다' : '재개했습니다'}.`;
  },
};

// ── 메타 (광고 세트 단위)
async function metaCall(path, params, method = 'GET') {
  const token = process.env.META_ADS_TOKEN;
  if (!token) throw new Error('메타 토큰 환경변수 없음');
  const q = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`https://graph.facebook.com/v25.0/${path}${method === 'GET' ? `?${q}` : ''}`, { method, body: method === 'GET' ? undefined : q, cache: 'no-store' });
  const j = await r.json();
  if (j.error) throw new Error(`메타: ${j.error.message}`);
  return j;
}
async function metaAdsets(campaign) {
  const j = await metaCall(`${META_ACCOUNT}/adsets`, { fields: 'id,name,status,daily_budget,campaign{name}', limit: 100 });
  const list = (j.data || []).filter((a) => !campaign || a.campaign?.name === campaign);
  if (!list.length) throw new Error(`광고 세트를 찾지 못했습니다: ${campaign || '(전체)'}`);
  return list;
}
const META = {
  async budget({ campaign, pct, amount }) {
    const done = [];
    for (const a of await metaAdsets(campaign)) {
      const cur = +a.daily_budget || 0;
      const next = amount || Math.round((cur * (1 + pct / 100)) / 100) * 100;
      if (!next) throw new Error('일예산이 없는 광고 세트(총예산형)입니다. 광고 관리자에서 바꾸세요.');
      await metaCall(a.id, { daily_budget: next }, 'POST');
      done.push(`${a.name} ${cur.toLocaleString('ko-KR')}→${next.toLocaleString('ko-KR')}원`);
    }
    return `메타 일예산 변경: ${done.join(', ')}`;
  },
  async status({ campaign, status }) {
    const done = [];
    for (const a of await metaAdsets(campaign)) { await metaCall(a.id, { status }, 'POST'); done.push(a.name); }
    return `메타 광고 세트 ${status === 'ACTIVE' ? '재개' : '일시중지'}: ${done.join(', ')}`;
  },
};

// ── 구글 (캠페인 일예산)
async function googleToken() {
  const raw = process.env.GOOGLE_ADS_SA_JSON;
  if (!raw) throw new Error('구글 서비스 계정 환경변수 없음');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/adwords', aud: sa.token_uri, iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const tr = await fetch(sa.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}`, cache: 'no-store' });
  const tj = await tr.json();
  if (!tj.access_token) throw new Error('구글 토큰 발급 실패');
  return tj.access_token;
}
async function googleCall(path, body) {
  const token = await googleToken();
  const r = await fetch(`https://googleads.googleapis.com/v26/customers/${GOOGLE_CUSTOMER}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const j = await r.json();
  if (!r.ok) { const e = Array.isArray(j) ? j[0]?.error : j.error; throw new Error(`구글 ${r.status}: ${e?.details?.[0]?.errors?.[0]?.message || e?.message || JSON.stringify(j).slice(0, 200)}`); }
  return j;
}
const GOOGLE = {
  async budget({ campaign, pct, amount }) {
    const j = await googleCall('googleAds:searchStream', { query: `SELECT campaign.name, campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign WHERE campaign.name = '${campaign.replace(/'/g, "\\'")}' AND campaign.status != 'REMOVED'` });
    const row = (Array.isArray(j) ? j : [j]).flatMap((b) => b.results || [])[0];
    if (!row) throw new Error(`캠페인을 찾지 못했습니다: ${campaign}`);
    const cur = Math.round(+row.campaignBudget.amountMicros / 1e6);
    const next = amount || Math.round((cur * (1 + pct / 100)) / 1000) * 1000;
    await googleCall('campaignBudgets:mutate', { operations: [{ update: { resourceName: row.campaignBudget.resourceName, amountMicros: String(next * 1e6) }, updateMask: 'amount_micros' }] });
    return `「${campaign}」 일예산 ${cur.toLocaleString('ko-KR')}→${next.toLocaleString('ko-KR')}원`;
  },
};

const OPS = { 'naver.adLock': NAVER.adLock, 'naver.bid': NAVER.bid, 'naver.budget': NAVER.budget, 'naver.campaignLock': NAVER.campaignLock, 'meta.budget': META.budget, 'meta.status': META.status, 'google.budget': GOOGLE.budget };

// kind: 위 OPS 키. 성공하면 사람이 읽을 결과 문장을 돌려준다.
export async function runAdOp(kind, args = {}) {
  const fn = OPS[kind];
  if (!fn) throw new Error(`지원하지 않는 액션: ${kind}`);
  return fn(args);
}

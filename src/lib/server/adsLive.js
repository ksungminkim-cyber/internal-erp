// src/lib/server/adsLive.js
// 광고 현황 "오늘" 탭용 실시간 조회. 네이버·구글·메타는 각 광고 API를 직접 호출한다 (조회 전용).
// 당근은 공개 API가 없어 오늘 수치를 못 받는다 (전날 마감만).
// 필요한 환경변수: NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY, NAVER_AD_CUSTOMER_ID,
//                 GOOGLE_ADS_SA_JSON (서비스 계정 키 JSON 통째로), META_ADS_TOKEN
import crypto from 'crypto';

const NAVER_CAMPAIGN = 'cmp-a001-06-000000009424591'; // 플레이스#1_녹턴
const GOOGLE_CUSTOMER = '1309305023'; // 130-930-5023
const META_ACCOUNT = 'act_1513789977241121'; // 녹턴 (2026-10-27 개설)
const META_RESULT_ACTIONS = ['instagram_profile_visit', 'onsite_conversion.ig_profile_visit', 'profile_visit', 'link_click', 'post_engagement'];
const CACHE_MS = 5 * 60 * 1000;

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function naver(today) {
  const key = process.env.NAVER_AD_API_KEY, secret = process.env.NAVER_AD_SECRET_KEY, customer = process.env.NAVER_AD_CUSTOMER_ID;
  if (!key || !secret || !customer) throw new Error('네이버 API 환경변수 없음');
  const call = async (uri, query) => {
    const ts = String(Date.now());
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.GET.${uri}`).digest('base64');
    const r = await fetch(`https://api.searchad.naver.com${uri}?${new URLSearchParams(query)}`, { headers: { 'X-Timestamp': ts, 'X-API-KEY': key, 'X-Customer': customer, 'X-Signature': sig }, cache: 'no-store' });
    if (!r.ok) throw new Error(`네이버 ${r.status}`);
    return r.json();
  };
  const st = await call('/stats', { id: NAVER_CAMPAIGN, fields: JSON.stringify(['impCnt', 'clkCnt', 'salesAmt']), timeRange: JSON.stringify({ since: today, until: today }), timeIncrement: 'allDays' });
  const s = (st.data && st.data[0]) || {};
  return { cost: Math.round(s.salesAmt || 0), imp: s.impCnt || 0, in: s.clkCnt || 0, c: [{ name: '플레이스#1_녹턴', cost: Math.round(s.salesAmt || 0), imp: s.impCnt || 0, clicks: s.clkCnt || 0 }] };
}

async function google(today) {
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
  const r = await fetch(`https://googleads.googleapis.com/v26/customers/${GOOGLE_CUSTOMER}/googleAds:searchStream`, { method: 'POST', headers: { Authorization: `Bearer ${tj.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign WHERE segments.date = '${today}'` }), cache: 'no-store' });
  const j = await r.json();
  if (!r.ok) throw new Error(`구글 ${r.status}`);
  const out = { cost: 0, imp: 0, in: 0, c: [] };
  for (const { campaign, metrics } of (Array.isArray(j) ? j : [j]).flatMap((b) => b.results || [])) {
    const imp = +metrics.impressions || 0, clicks = +metrics.clicks || 0, cost = Math.round((+metrics.costMicros || 0) / 1e6);
    if (!imp && !cost) continue; // 오늘 노출이 없는 캠페인(일시중지 등)은 표에서 뺀다
    out.imp += imp; out.in += clicks; out.cost += cost;
    out.c.push({ name: campaign.name, cost, imp, clicks });
  }
  return out;
}

async function meta(today) {
  const token = process.env.META_ADS_TOKEN;
  if (!token) throw new Error('메타 토큰 환경변수 없음');
  const q = new URLSearchParams({ level: 'campaign', fields: 'campaign_name,spend,impressions,reach,actions', time_range: JSON.stringify({ since: today, until: today }), access_token: token });
  const r = await fetch(`https://graph.facebook.com/v25.0/${META_ACCOUNT}/insights?${q}`, { cache: 'no-store' });
  const j = await r.json();
  if (j.error) throw new Error(`메타: ${j.error.message}`);
  const out = { cost: 0, imp: 0, in: 0, c: [] };
  for (const row of j.data || []) {
    const imp = +row.impressions || 0, cost = Math.round(+row.spend || 0);
    let res = 0;
    for (const t of META_RESULT_ACTIONS) { const a = (row.actions || []).find((x) => x.action_type === t); if (a) { res = +a.value; break; } }
    out.imp += imp; out.in += res; out.cost += cost;
    out.c.push({ name: row.campaign_name, cost, imp, results: res });
  }
  return out;
}

// 당근 광고 OpenAPI (베타, 2026-10). 키는 전문가모드 → 온라인 문의 → [광고 도구 및 전환] > [OpenAPI 키 발급]. 60회/분.
const KARROT_ADVERTISER = '4722601'; // 전문가모드 녹턴_광고 (2026-10-28 이전). 간편모드 smk 4405635 는 OpenAPI 불가
async function karrot(today) {
  const key = process.env.KARROT_OPENAPI_KEY;
  if (!key) throw new Error('당근 OpenAPI 키 없음');
  const H = { 'X-API-KEY': key, 'X-ADVERTISER-ID': KARROT_ADVERTISER, 'Content-Type': 'application/json' };
  const cr = await fetch(`https://ads-openapi.kr.karrotmarket.com/v1/campaigns?pageNumber=1&pageSize=100&liveStatuses=ON`, { headers: H, cache: 'no-store' });
  if (!cr.ok) throw new Error(`당근 캠페인 ${cr.status}`);
  const camps = (await cr.json()).campaigns || [];
  const out = { cost: 0, imp: 0, in: 0, c: [] };
  if (!camps.length) return out;
  const pr = await fetch('https://ads-openapi.kr.karrotmarket.com/v1/performance', { method: 'POST', headers: H, body: JSON.stringify({ analysisItem: 'Campaign', ids: camps.map((c) => c.id), startDateTime: `${today}T00:00:00+09:00`, endDateTime: `${today}T23:59:59+09:00`, timeGranularity: 'DAY' }), cache: 'no-store' });
  if (!pr.ok) throw new Error(`당근 성과 ${pr.status}`);
  const name = Object.fromEntries(camps.map((c) => [c.id, c.title]));
  for (const row of (await pr.json()).performances || []) {
    const imp = +row.impression || 0, clicks = +row.click || 0, cost = Math.round(+row.cost || 0);
    if (!imp && !cost) continue;
    out.imp += imp; out.in += clicks; out.cost += cost;
    out.c.push({ name: name[row.id] || row.id, cost, imp, clicks });
  }
  return out;
}

let cache = null;

// 오늘(KST) 채널별 광고비·노출·유입. 채널이 실패하면 그 채널만 null + errors 에 이유.
export async function fetchAdsLive() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const today = kstToday();
  const errors = {};
  const [n, g, m, k] = await Promise.all([
    naver(today).catch((e) => { errors.naver = e.message; return null; }),
    google(today).catch((e) => { errors.google = e.message; return null; }),
    meta(today).catch((e) => { errors.meta = e.message; return null; }),
    karrot(today).catch((e) => { errors.karrot = e.message; return null; }),
  ]);
  const data = { d: today, asOf: new Date().toISOString(), naver: n, google: g, meta: m, karrot: k, errors };
  cache = { at: Date.now(), data };
  return data;
}

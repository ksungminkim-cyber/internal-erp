// src/app/api/ads/close/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getServiceClient } from '@/lib/server/guard';
import { naver, google, meta, karrot } from '@/lib/server/adsLive';
import { prepaidBalance } from '@/lib/adsInsights';

// ─────────────────────────────────────────────────────────────────────────
// 광고 일 마감 자동 채움 — Vercel Cron 이 매일 00:30 UTC(09:30 KST) 호출.
// 로컬 /ad-daily(모니터링 폴더)가 돌지 않아도 ad_dashboard.data.days 가 어제까지 채워지게 한다.
// 마지막 마감일 다음 날부터 어제(KST)까지 네 채널 광고 API로 하루씩 받아 붙이고, 캠페인 표(7일 합계·마지막 지출)와
// 네이버 잔액을 갱신한다. 로컬 마감이 나중에 돌면 더 자세한 값(순위·도달·잔액·의견)으로 덮어쓴다.
//   GET  (Vercel Cron)  헤더 Authorization: Bearer CRON_SECRET
//   POST (수동)         헤더 x-sync-secret: POS_SYNC_SECRET, 본문 { days?: 최대 일수 }
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 120;
const MAX_DAYS = 14;
const CH = ['naver', 'google', 'meta', 'karrot'];

const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function secretMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function fill(maxDays) {
  const svc = getServiceClient();
  const { data: row, error } = await svc.from('ad_dashboard').select('data').eq('id', 'nocturne').maybeSingle();
  if (error) throw new Error(error.message);
  const D = row?.data;
  if (!D || !Array.isArray(D.days) || !D.days.length) return { filled: [], reason: '마감 데이터 없음' };
  const yesterday = addDays(kst(new Date()), -1);
  let from = addDays(D.closed || D.days[D.days.length - 1].d, 1);
  if (from > yesterday) return { filled: [], closed: D.closed };
  if (addDays(from, maxDays - 1) < yesterday) from = addDays(yesterday, -(maxDays - 1)); // 너무 오래 비었으면 최근 N일만
  const byD = Object.fromEntries(D.days.map((x) => [x.d, x]));
  const filled = [], errors = {};
  let naverBal = null;
  for (let d = from; d <= yesterday; d = addDays(d, 1)) {
    const [n, g, m, k] = await Promise.all([
      naver(d).catch((e) => { errors[`naver ${d}`] = e.message; return null; }),
      google(d).catch((e) => { errors[`google ${d}`] = e.message; return null; }),
      meta(d).catch((e) => { errors[`meta ${d}`] = e.message; return null; }),
      karrot(d).catch((e) => { errors[`karrot ${d}`] = e.message; return null; }),
    ]);
    if (n && n.bal !== null && n.bal !== undefined) naverBal = n.bal;
    const strip = (v) => v ? { cost: v.cost, imp: v.imp, in: v.in, c: v.c || [] } : null; // 실시간 전용 필드(bal, ads)는 뺀다
    byD[d] = { d, naver: strip(n), google: strip(g), meta: strip(m), karrot: strip(k), auto: true };
    filled.push(d);
  }
  const days = Object.values(byD).sort((a, b) => (a.d < b.d ? -1 : 1));
  const closed = days[days.length - 1].d;
  // 캠페인 표: 최근 7일 합계와 마지막 지출일을 다시 계산 (이름 기준. 네이버는 채널 합계)
  const last7 = days.slice(-7);
  const inKey = { meta: 'results', google: 'clicks', karrot: 'clicks', naver: 'clicks' };
  for (const a of D.ads || []) {
    const pick = (x) => a.ch === 'naver' ? (x.naver ? [{ cost: x.naver.cost, inn: x.naver.in }] : []) : ((x[a.ch] && x[a.ch].c) || []).filter((c) => c.name === a.name).map((c) => ({ cost: c.cost, inn: c[inKey[a.ch]] || c.clicks || c.results || 0 }));
    a.cost = last7.reduce((s, x) => s + pick(x).reduce((t, c) => t + c.cost, 0), 0);
    a.in = last7.reduce((s, x) => s + pick(x).reduce((t, c) => t + c.inn, 0), 0);
    for (let i = days.length - 1; i >= 0; i--) if (pick(days[i]).some((c) => c.cost > 0)) { a.lastSpend = days[i].d; break; }
  }
  // 새 캠페인(자동 채움 날에만 나타난 이름)은 표에 추가
  for (const ch of CH) for (const d of filled) for (const c of (byD[d][ch] && byD[d][ch].c) || []) {
    if (ch === 'naver' || (D.ads || []).some((a) => a.ch === ch && a.name === c.name)) continue;
    D.ads = D.ads || [];
    D.ads.push({ ch, name: c.name, type: ch === 'meta' ? '인스타 게시물 홍보' : '자동 수집', status: '운영 중', budget: null, cost: c.cost, in: c[inKey[ch]] || 0, lastSpend: c.cost > 0 ? d : null });
  }
  // 네이버 잔액 (실시간 값)
  if (naverBal !== null) {
    const f = (D.funding || []).find((x) => x.ch === 'naver');
    if (f) { const avg = last7.reduce((s, x) => s + (x.naver ? x.naver.cost : 0), 0) / 7; f.balance = naverBal; f.avg = Math.round(avg); f.daysLeft = avg > 0 ? +(naverBal / avg).toFixed(1) : null; f.checked = kst(new Date()); f.note = naverBal <= 0 ? '잔액 소진으로 잠김' : ''; }
  }
  // 당근 잔액 (조회 API 없음): 확인한 잔액(base, asOf 끝 기준)에서 그 뒤 지출을 뺀 추정. 충전하면 base·asOf 를 다시 넣어야 한다
  const kf = (D.funding || []).find((x) => x.ch === 'karrot');
  if (kf && kf.asOf && kf.base !== null && kf.base !== undefined) { const avg = last7.reduce((s, x) => s + (x.karrot ? x.karrot.cost : 0), 0) / 7; kf.balance = prepaidBalance(kf.base, kf.asOf, days, 'karrot'); kf.avg = Math.round(avg); kf.daysLeft = avg > 0 ? +(kf.balance / avg).toFixed(1) : null; }
  const data = { ...D, days, closed, built: new Date().toISOString(), autoFilled: [...new Set([...(D.autoFilled || []), ...filled])].filter((d) => d > (D.localClosed || '')).slice(-30) };
  const { error: e2 } = await svc.from('ad_dashboard').upsert({ id: 'nocturne', data, html: null, closed_date: closed, built_at: data.built, updated_at: new Date().toISOString() });
  if (e2) throw new Error(e2.message);
  return { filled, closed, errors };
}

export async function GET(request) {
  const auth = request.headers.get('authorization') || '';
  if (!secretMatches(auth.replace(/^Bearer\s+/i, ''), process.env.CRON_SECRET)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await fill(MAX_DAYS)) }); } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

export async function POST(request) {
  if (!secretMatches(request.headers.get('x-sync-secret'), process.env.POS_SYNC_SECRET)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body = {}; try { body = await request.json(); } catch { /* 본문 없어도 됨 */ }
  try { return NextResponse.json({ ok: true, ...(await fill(Math.min(MAX_DAYS, +body.days || MAX_DAYS))) }); } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 500 }); }
}

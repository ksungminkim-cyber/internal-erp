// src/app/api/trends/refresh/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { fetchSearchTrend, fetchBlogCount } from '@/lib/server/naverHub';
import { generateTrendIdeas } from '@/lib/server/trendIdeas';
import { scoreTrend, weekStartKey } from '@/lib/trendScore';
import { isBarCategory } from '@/lib/salesKpi';

// ─────────────────────────────────────────────────────────────────────────
// 홈 "이번 주 트렌드 픽" 주간 갱신 — pg_cron 이 화요일 05:00 KST 에 호출.
//   POST { workplaceId?, top?, skipIdeas? }   헤더 x-sync-secret: POS_SYNC_SECRET
//   1) 활성 키워드의 최근 13주 검색 지수(데이터랩, anchor '카페' 정규화) + 블로그 게시물 수 → trend_snapshots
//   2) 상승률 점수 상위 N(기본 5) → 매장별 메뉴 맥락과 함께 Claude 에 → trend_picks
// ─────────────────────────────────────────────────────────────────────────

// Vercel Hobby 함수 상한: Fluid compute 꺼짐 60초 / 켜짐 300초. 배포 호환을 위해 60초로 두고 실행은 30초 안팎으로 유지
export const maxDuration = 60;

const ANCHOR = '카페';
const BLOG_CONCURRENCY = 5;
const WEEKS = 13;
const TOP_DEFAULT = 5;
// 블로그 게시물 수는 동음이의어(밤=night, 감=feeling)로 부풀려지므로 그룹별 접미어를 붙여 센다
const BLOG_SUFFIX = { '과일': '디저트', '디저트': '카페', '음료': '카페', '재료': '카페', '주류': '바' };

function getServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
function secretMatches(given, expected) {
  if (typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

export async function POST(request) {
  const secret = process.env.POS_SYNC_SECRET;
  if (!secret || !secretMatches(request.headers.get('x-sync-secret'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const top = Math.min(10, Math.max(1, Number(body.top) || TOP_DEFAULT));
  const svc = getServiceClient();

  // 1. 키워드 → 검색 추이 + 블로그 수
  const { data: keywords, error: e0 } = await svc.from('trend_keywords').select('id, keyword, group_name').eq('active', true);
  if (e0) return NextResponse.json({ error: e0.message }, { status: 500 });
  if (!keywords?.length) return NextResponse.json({ ok: true, note: 'no keywords' });

  const today = kst(new Date());
  const thisWeek = weekStartKey(today);
  // 진행 중인 이번 주는 부분 집계라 시계열 끝이 꺼져 보인다 → 지난 일요일까지의 완전한 주 13개만 조회
  const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
  const lastWeek = addDays(thisWeek, -7);          // 마지막 완전한 주의 월요일 (스냅샷 키)
  const endDate = addDays(thisWeek, -1);           // 지난 일요일
  const startDate = addDays(thisWeek, -WEEKS * 7); // 13주 전 월요일

  let series;
  try {
    series = await fetchSearchTrend({ keywords: keywords.map((k) => k.keyword), startDate, endDate, anchor: ANCHOR });
  } catch (err) {
    return NextResponse.json({ error: `naver trend: ${String(err?.message ?? err).slice(0, 200)}` }, { status: 502 });
  }

  // 블로그 게시물 수 — 동시 5개씩
  const blogCounts = {};
  for (let i = 0; i < keywords.length; i += BLOG_CONCURRENCY) {
    await Promise.all(keywords.slice(i, i + BLOG_CONCURRENCY).map(async (k) => {
      try { blogCounts[k.keyword] = await fetchBlogCount(`${k.keyword} ${BLOG_SUFFIX[k.group_name] ?? '카페'}`); } catch { blogCounts[k.keyword] = null; }
    }));
  }

  const scored = [];
  const snapshots = [];
  for (const k of keywords) {
    const pts = series[k.keyword] ?? [];
    const ratios = pts.map((p) => p.ratio);
    const s = scoreTrend(ratios);
    const blogPosts = blogCounts[k.keyword] ?? null;
    const last = pts[pts.length - 1];
    if (last) {
      snapshots.push({ keyword_id: k.id, week_start: lastWeek, search_index: Math.min(last.ratio, 999999.99), blog_posts: blogPosts, fetched_at: new Date().toISOString() });
    }
    scored.push({ keyword: k.keyword, group: k.group_name ?? '', series: ratios.slice(-WEEKS), blogPosts, ...(s ?? { recentAvg: 0, baseAvg: 0, changePct: null, score: 0 }) });
  }
  if (snapshots.length) {
    const { error: eSnap } = await svc.from('trend_snapshots').upsert(snapshots, { onConflict: 'keyword_id,week_start' });
    if (eSnap) console.error('trend_snapshots upsert', eSnap.message);
  }
  // 점수 상위 — 상승 중인 것 우선, 상승이 없으면 최근 평균 상위
  const withData = scored.filter((x) => x.series.length >= 4 && x.recentAvg > 0);
  const rising = withData.filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const fallback = withData.filter((x) => !(x.score > 0)).sort((a, b) => b.recentAvg - a.recentAvg);
  const picked = [...rising, ...fallback].slice(0, top);

  // 2. 매장별 맥락 + Claude
  let q = svc.from('workplaces').select('id, name').eq('pos_provider', 'toss').not('pos_store_code', 'is', null);
  if (body.workplaceId) q = q.eq('id', body.workplaceId);
  const { data: wps, error: eWp } = await q;
  if (eWp) return NextResponse.json({ error: `workplaces: ${eWp.message}` }, { status: 500 });
  const results = await Promise.all((wps ?? []).map(async (wp) => {
    const d90 = kst(new Date(Date.now() - 90 * 86400_000));
    const [{ data: products, error: eProd }, { data: recipes }, { data: barRows }] = await Promise.all([
      svc.rpc('pos_product_sales', { p_workplace_id: wp.id, p_from: d90, p_to: today }),
      svc.from('recipes').select('name').eq('active', true).or(`workplace_id.is.null,workplace_id.eq.${wp.id}`),
      // 바 상품이 하나라도 있는지 — 카테고리로 직접 검색
      svc.from('pos_order_items').select('item_category').eq('workplace_id', wp.id)
        .or(['칵테일', '위스키', '스피리츠', '맥주', '와인', '하이볼', '주류'].map((w) => `item_category.ilike.%${w}%`).join(','))
        .limit(1),
    ]);
    if (eProd) return { workplace: wp.name, items: 0, ideas: 0, error: `pos_product_sales: ${eProd.message}` };
    const menu = (products ?? []).map((p) => p.item_title);
    const hasBar = (barRows ?? []).some((c) => isBarCategory(c.item_category));
    // 매장 내부 신호: 상품명에 키워드가 들어간 상품의 최근 90일 판매량
    const trends = picked.map((t) => {
      const kw = t.keyword.replace(/\s/g, '');
      const hits = kw.length >= 2 ? (products ?? []).filter((p) => String(p.item_title).replace(/\s/g, '').includes(kw)) : [];
      const qty = hits.reduce((a, p) => a + (Number(p.qty) || 0), 0);
      return { keyword: t.keyword, group: t.group, changePct: t.changePct, recentAvg: t.recentAvg, blogPosts: t.blogPosts,
        internal: hits.length ? `${hits.map((h) => h.item_title).slice(0, 2).join(', ')} 최근 90일 ${qty}개 판매` : null };
    });

    let ideas = { picks: [], model: null };
    if (!body.skipIdeas && process.env.ANTHROPIC_API_KEY) {
      try {
        ideas = await generateTrendIdeas({ workplaceName: wp.name, hasBar, menu, topSellers: menu.slice(0, 15), recipes: (recipes ?? []).map((r) => r.name), trends });
      } catch (err) {
        console.error('trend ideas', wp.name, err?.message ?? err);
      }
    }
    const byKw = Object.fromEntries((ideas.picks ?? []).map((p) => [p.keyword, p]));
    const items = picked.map((t, i) => ({
      rank: i + 1, keyword: t.keyword, group: t.group, score: t.score, change_pct: t.changePct, recent_avg: t.recentAvg,
      series: t.series, blog_posts: t.blogPosts, internal: trends[i].internal,
      headline: byKw[t.keyword]?.headline ?? null, cafe: byKw[t.keyword]?.cafe ?? [], bar: hasBar ? (byKw[t.keyword]?.bar ?? []) : [],
    }));
    const { error: e2 } = await svc.from('trend_picks').upsert({
      workplace_id: wp.id, week_start: thisWeek, generated_at: new Date().toISOString(), items, model: ideas.model,
    }, { onConflict: 'workplace_id,week_start' });
    return { workplace: wp.name, items: items.length, ideas: (ideas.picks ?? []).length, error: e2?.message ?? null };
  }));

  return NextResponse.json({ ok: results.every((r) => !r.error), week: thisWeek, keywords: keywords.length, top: picked.map((p) => `${p.keyword} ${p.changePct == null ? '신규' : p.changePct + '%'}`), results });
}

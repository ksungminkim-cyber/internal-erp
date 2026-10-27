// src/app/api/ads/publish/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getServiceClient } from '@/lib/server/guard';

// ─────────────────────────────────────────────────────────────────────────
// 광고 대시보드 게시 — 광고 모니터링 팀(로컬 /ad-daily)이 매일 마감 후 호출.
//   POST { data, closed, built }   헤더 x-ads-secret: ADS_PUBLISH_SECRET
// data 는 모니터링 폴더 build.js 가 만드는 대시보드 데이터(JSON). /ads 가 ERP 스타일로 그린다.
// ─────────────────────────────────────────────────────────────────────────

const MAX_BYTES = 4 * 1024 * 1024;

function secretMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!secretMatches(request.headers.get('x-ads-secret'), process.env.ADS_PUBLISH_SECRET)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  const { data, closed, built } = body ?? {};
  if (!data || typeof data !== 'object' || !Array.isArray(data.days)) return NextResponse.json({ ok: false, error: 'data.days required' }, { status: 400 });
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > MAX_BYTES) return NextResponse.json({ ok: false, error: 'data too large' }, { status: 413 });

  const svc = getServiceClient();
  const { error } = await svc.from('ad_dashboard').upsert({
    id: 'nocturne',
    data,
    html: null,
    closed_date: closed || data.closed || null,
    built_at: built || data.built || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, closed: closed || data.closed || null, days: data.days.length, bytes });
}

// src/app/api/ads/publish/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getServiceClient } from '@/lib/server/guard';

// ─────────────────────────────────────────────────────────────────────────
// 광고 대시보드 게시 — 광고 모니터링 팀(로컬 /ad-daily)이 매일 마감 후 호출.
//   POST { html, closed, built }   헤더 x-ads-secret: ADS_PUBLISH_SECRET
// html 은 head/body 없는 조각(제목·스타일·본문·스크립트). /ads 에서 iframe srcdoc 으로 감싼다.
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
  const { html, closed, built } = body ?? {};
  if (typeof html !== 'string' || !html.trim()) return NextResponse.json({ ok: false, error: 'html required' }, { status: 400 });
  if (Buffer.byteLength(html, 'utf8') > MAX_BYTES) return NextResponse.json({ ok: false, error: 'html too large' }, { status: 413 });

  const svc = getServiceClient();
  const { error } = await svc.from('ad_dashboard').upsert({
    id: 'nocturne',
    html,
    closed_date: closed || null,
    built_at: built || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, closed: closed || null, bytes: Buffer.byteLength(html, 'utf8') });
}

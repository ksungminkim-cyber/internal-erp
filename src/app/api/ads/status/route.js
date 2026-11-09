// src/app/api/ads/status/route.js
// 광고 마감 상태만 돌려주는 공개 경로 (마감일·생성 시각·자동 채움 날짜). 수치는 없다.
// 자동 마감(pg_cron → /api/ads/close)이 돌았는지 밖에서 확인하는 용도.
import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data: row, error } = await getServiceClient().from('ad_dashboard').select('closed_date, built_at, data->autoFilled').eq('id', 'nocturne').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, closed: row?.closed_date ?? null, built: row?.built_at ?? null, autoFilled: row?.autoFilled ?? [] });
}

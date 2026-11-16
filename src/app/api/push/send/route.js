// src/app/api/push/send/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getServiceClient } from '@/lib/server/guard';
import { sendPush } from '@/lib/server/push';

// ─────────────────────────────────────────────────────────────────────────
// 알림 → 웹 푸시. notifications 표에 행이 들어오면 DB 트리거(trg_push_notify, 마이그레이션 62)가
// pg_net 으로 여기를 부른다. 세션 대신 비밀키 헤더로 인증 (proxy 의 공개 경로 예외).
//   POST { ids: string[] }   헤더 x-sync-secret: POS_SYNC_SECRET
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 30;
const MAX_IDS = 500;

function secretMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!secretMatches(request.headers.get('x-sync-secret'), process.env.POS_SYNC_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, MAX_IDS) : [];
  if (!ids.length) return NextResponse.json({ sent: 0, failed: 0, removed: 0 });

  const svc = getServiceClient();
  const { data: rows, error } = await svc.from('notifications').select('id, user_id, title, body, link').in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(await sendPush(svc, rows ?? []));
}

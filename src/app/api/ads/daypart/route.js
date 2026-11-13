// src/app/api/ads/daypart/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { runAdOp } from '@/lib/server/adsOps';

// ─────────────────────────────────────────────────────────────────────────
// 시간대 운영 — 요일·시간 타겟이 없는 광고그룹을 정해진 시간에만 켠다.
// pg_cron 이 매시 정각에 호출하고, 지금(KST) 시각이 from~to 안이면 켜고 밖이면 끈다 (이미 그 상태면 아무것도 안 함).
// 구글·당근은 매체 자체에 시간 설정이 있어 여기서 다루지 않는다.
//   POST  헤더 x-sync-secret: POS_SYNC_SECRET
// 멈추려면 Supabase 에서 cron 잡 'ads-daypart-hourly' 를 해제하고 그룹을 끈다.
// ─────────────────────────────────────────────────────────────────────────

const DAYPARTS = [
  { op: 'naver.groupLock', groupId: 'grp-a001-06-000000076332339', label: '네이버 바 저녁', from: 17, to: 23 },
];

const kstHour = () => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()) % 24;
function secretMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!secretMatches(request.headers.get('x-sync-secret'), process.env.POS_SYNC_SECRET)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const hour = kstHour();
  const results = [];
  for (const d of DAYPARTS) {
    const on = hour >= d.from && hour < d.to;
    try { results.push({ label: d.label, on, result: await runAdOp(d.op, { groupId: d.groupId, lock: !on }) }); } catch (e) { results.push({ label: d.label, on, error: e.message }); }
  }
  return NextResponse.json({ ok: results.every((r) => !r.error), hour, results });
}

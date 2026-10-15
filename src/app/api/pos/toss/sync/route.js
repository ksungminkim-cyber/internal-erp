// src/app/api/pos/toss/sync/route.js
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { fetchOrders } from '@/lib/server/tossPlace';
import { mapOrder } from '@/lib/posOrderMap';
import { groupByItemCount } from '@/lib/posSyncHelpers';

// ─────────────────────────────────────────────────────────────────────────
// 토스 POS 주문 폴링 — Supabase pg_cron 이 10분마다(최근 90분) / 매일 04:00 KST(최근 48h) 호출.
// 백필은 from/to 를 직접 넣어 수동 호출.
//   POST { merchantId?, from?, to?, hours? }   헤더 x-sync-secret: POS_SYNC_SECRET
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_HOURS = 1.5;
const CHUNK = 100; // .in(ids) URL 길이(~4KB) 여유

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// 한국시간 기준 'YYYY-MM-DD'
function kstDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

// 길이가 달라도 상수 시간에 비교
function secretMatches(given, expected) {
  if (typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function resolveWindow({ from, to, hours }) {
  const toD = to ? new Date(to) : new Date();
  const fromD = from ? new Date(from) : new Date(toD.getTime() - (Number(hours) || DEFAULT_HOURS) * 3600_000);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime()) || fromD >= toD) {
    throw new Error('invalid window');
  }
  return { from: fromD, to: toD };
}

// 같은 주문이 여러 페이지에 걸쳐 두 번 오면 updatedAt 이 늦은 것만 남긴다
function dedupe(orders) {
  const m = new Map();
  for (const o of orders) {
    const prev = m.get(String(o.id));
    if (!prev || new Date(o.updatedAt ?? 0) >= new Date(prev.updatedAt ?? 0)) m.set(String(o.id), o);
  }
  return [...m.values()];
}

async function syncWorkplace(svc, wp, window) {
  const { data: log, error: logErr } = await svc.from('pos_sync_log')
    .insert({ workplace_id: wp.id, window_from: window.from.toISOString(), window_to: window.to.toISOString() })
    .select('id').single();
  if (logErr || !log) {
    const message = `pos_sync_log insert: ${logErr?.message ?? 'no row'}`;
    console.error('toss sync error', wp.pos_store_code, message);
    return { merchantId: wp.pos_store_code, workplaceId: wp.id, fetched: 0, upserted: 0, error: message };
  }

  let fetched = 0, upserted = 0, filledDays = 0, deducted = 0;
  try {
    const orders = dedupe(await fetchOrders({ merchantId: wp.pos_store_code, from: window.from, to: window.to }));
    fetched = orders.length;
    const mapped = orders.map((o) => mapOrder(o, { workplaceId: wp.id, merchantId: wp.pos_store_code }));
    const syncedAt = new Date().toISOString();

    for (let i = 0; i < mapped.length; i += CHUNK) {
      const chunk = mapped.slice(i, i + CHUNK);
      const { data: rows, error: e1 } = await svc.from('pos_orders')
        .upsert(chunk.map((m) => ({ ...m.order, synced_at: syncedAt })), { onConflict: 'workplace_id,external_id' })
        .select('id, external_id');
      if (e1) throw new Error(`pos_orders upsert: ${e1.message}`);
      const idByExt = new Map(rows.map((r) => [r.external_id, r.id]));

      // 라인아이템 교체: (order_id, line_no) upsert 후 줄어든 꼬리만 삭제.
      // delete→insert 와 달리 겹치는 실행·중단 시에도 아이템이 비는 구간이 없다.
      const items = chunk.flatMap((m) => m.items.map((it) => ({ ...it, order_id: idByExt.get(m.order.external_id) })));
      if (items.length) {
        const { error: e2 } = await svc.from('pos_order_items').upsert(items, { onConflict: 'order_id,line_no' });
        if (e2) throw new Error(`pos_order_items upsert: ${e2.message}`);
      }
      const groups = groupByItemCount(chunk.map((m) => ({ orderId: idByExt.get(m.order.external_id), count: m.items.length })));
      for (const g of groups) {
        const { error: e3 } = await svc.from('pos_order_items').delete().in('order_id', g.orderIds).gte('line_no', g.count);
        if (e3) throw new Error(`pos_order_items tail delete: ${e3.message}`);
      }
      upserted += rows.length;
    }

    // 창에 걸친 날짜의 일 매출(sales_daily)을 다시 채움 — 수기 입력·마감 월은 함수가 건너뜀
    const { data: filled, error: e4 } = await svc.rpc('pos_fill_sales_daily', {
      p_workplace_id: wp.id,
      p_from: kstDate(new Date(window.from.getTime() - 86400_000)),
      p_to: kstDate(window.to),
    });
    if (e4) throw new Error(`pos_fill_sales_daily: ${e4.message}`);
    filledDays = Number(filled) || 0;

    // 판매량 × 소요량 → 재고 자동 차감 (workplaces.pos_deduct_from 이후 날짜만, 차액만 반영)
    const { data: ded, error: e5 } = await svc.rpc('pos_apply_usage_deductions', {
      p_workplace_id: wp.id,
      p_from: kstDate(new Date(window.from.getTime() - 86400_000)),
      p_to: kstDate(window.to),
    });
    if (e5) throw new Error(`pos_apply_usage_deductions: ${e5.message}`);
    deducted = Number(ded) || 0;

    await svc.from('pos_sync_log').update({ finished_at: new Date().toISOString(), fetched_count: fetched, upserted_count: upserted }).eq('id', log.id);
    return { merchantId: wp.pos_store_code, workplaceId: wp.id, fetched, upserted, filledDays, deducted, error: null };
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 500);
    console.error('toss sync error', wp.pos_store_code, message);
    await svc.from('pos_sync_log').update({ finished_at: new Date().toISOString(), fetched_count: fetched, upserted_count: upserted, error: message }).eq('id', log.id);
    return { merchantId: wp.pos_store_code, workplaceId: wp.id, fetched, upserted, filledDays, deducted, error: message };
  }
}

export async function POST(request) {
  const secret = process.env.POS_SYNC_SECRET;
  if (!secret || !secretMatches(request.headers.get('x-sync-secret'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  let window;
  try { window = resolveWindow(body); } catch { return NextResponse.json({ error: 'invalid_window' }, { status: 400 }); }

  const svc = getServiceClient();
  let q = svc.from('workplaces').select('id, pos_store_code').eq('pos_provider', 'toss').not('pos_store_code', 'is', null);
  if (body.merchantId) q = q.eq('pos_store_code', String(body.merchantId));
  const { data: wps, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!wps?.length) return NextResponse.json({ ok: true, results: [], note: 'no toss workplaces' });

  const results = [];
  for (const wp of wps) results.push(await syncWorkplace(svc, wp, window));

  return NextResponse.json({ ok: results.every((r) => !r.error), window: { from: window.from, to: window.to }, results });
}

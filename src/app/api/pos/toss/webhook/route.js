import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────
// 토스 POS Webhook 수신 엔드포인트
//
// 토스 POS 가 외부 시스템으로 결제 이벤트를 푸시할 수 있게 되면 이 라우트로 받을 수 있도록 준비
// (2026년 5월 기준 토스플레이스 공식 외부 webhook 은 일반 가맹점에 공개되지 않음)
//
// 보안:
//   - 환경변수 POS_WEBHOOK_SECRET 으로 HMAC-SHA256 서명 검증
//   - 헤더: X-Toss-Signature (또는 토스 측이 지정하는 헤더)
//   - 가맹점/매장 매핑: payload 의 store_code 를 workplace 와 연결 (workplaces.pos_store_code 컬럼 추가 권장)
//
// 예상 payload (가설):
// {
//   "event": "payment.completed",
//   "transaction_id": "tx_123",
//   "store_code": "ST001",
//   "amount": 5500,
//   "payment_method": "card",
//   "occurred_at": "2026-05-21T15:30:00+09:00",
//   "items": [{ "name": "아메리카노", "qty": 1, "amount": 4500 }, ...]
// }
//
// 응답: 토스 측 spec 에 맞춰 200 OK + JSON
// ─────────────────────────────────────────────────────────────────────────

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // 시간 안전 비교
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request) {
  const secret = process.env.POS_WEBHOOK_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-toss-signature') || request.headers.get('x-signature');

  // secret 이 설정되어 있으면 서명 검증 (테스트 모드 시 미설정 가능)
  if (secret && !verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 매장 매핑 — store_code 로 workplace 찾기
  const storeCode = payload.store_code || payload.merchant_id;
  let workplaceId = payload.workplace_id;

  if (!workplaceId && storeCode) {
    const { data: wp } = await supabase
      .from('workplaces')
      .select('id')
      .eq('pos_store_code', storeCode)
      .maybeSingle();
    workplaceId = wp?.id;
  }

  if (!workplaceId) {
    return NextResponse.json({ error: 'workplace_not_found', store_code: storeCode }, { status: 400 });
  }

  const externalId = String(payload.transaction_id ?? payload.id ?? '');
  const amount = Number(payload.amount ?? 0);
  const paymentMethod = payload.payment_method ?? null;
  const occurredAt = payload.occurred_at ?? payload.paid_at ?? new Date().toISOString();
  const items = payload.items ?? null;

  if (!externalId || !amount) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  // 결제 취소/환불 이벤트는 amount 를 음수로 기록
  const isRefund = payload.event === 'payment.cancelled' || payload.event === 'payment.refunded';
  const finalAmount = isRefund ? -Math.abs(amount) : amount;

  const { error } = await supabase.from('sales_transactions').upsert({
    workplace_id: workplaceId,
    external_id: externalId,
    source: 'pos_toss',
    amount: finalAmount,
    payment_method: paymentMethod,
    occurred_at: occurredAt,
    items,
    raw_payload: payload,
  }, { onConflict: 'workplace_id,source,external_id' });

  if (error) {
    console.error('webhook insert error', error);
    return NextResponse.json({ error: 'insert_failed', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    name: 'toss-pos-webhook',
    status: 'ready',
    docs: '토스 POS 가 외부 webhook 제공 가능 시 이 엔드포인트로 POST 하도록 설정',
  });
}

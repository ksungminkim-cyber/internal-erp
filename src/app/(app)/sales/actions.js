'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * 일 매출 저장 — 서비스롤 + 멤버십 검증.
 * 기존 RLS가 매니저(is_manager_of)만 허용해 마감 담당 직원이 입력 못 하던 문제 해결.
 * 해당 매장의 active 멤버면 누구나 입력 가능 (마감 담당이 직원인 경우 대응).
 */
export async function saveSales({ workplaceId, salesDate, totalAmount, transactionCount, cashAmount, cardAmount, otherAmount, notes }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!workplaceId || !salesDate) return { ok: false, error: '사업장·날짜가 필요합니다.' };

  const svc = getServiceClient();

  // 권한: 해당 매장 active 멤버 또는 본사/super_admin·임원
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const isMemberHere = (mems ?? []).some((m) => m.workplace_id === workplaceId);
  if (!(isMemberHere || isHQ || prof?.is_super_admin === true || prof?.is_executive === true)) {
    return { ok: false, error: '이 매장의 매출을 입력할 권한이 없습니다.' };
  }

  const { error } = await svc.from('sales_daily').upsert({
    workplace_id: workplaceId,
    sales_date: salesDate,
    total_amount: Number(totalAmount) || 0,
    transaction_count: Number(transactionCount) || 0,
    cash_amount: Number(cashAmount) || 0,
    card_amount: Number(cardAmount) || 0,
    other_amount: Number(otherAmount) || 0,
    source: 'manual',
    notes: notes?.trim() || null,
    recorded_by: user.id,
    recorded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workplace_id,sales_date' });

  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('마감 잠금') || msg.includes('locked')) {
      return { ok: false, error: '마감된 월의 매출은 수정할 수 없습니다.' };
    }
    return { ok: false, error: msg || '매출 저장 중 오류가 발생했습니다.' };
  }
  return { ok: true };
}

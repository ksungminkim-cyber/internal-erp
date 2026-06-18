'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { loadActorPerms } from '@/lib/server/guard';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// 한국시간 기준 'YYYY-MM-DD'
function kstDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

/**
 * 매출 합계 집계 — 누적(전체) + 이번 달. 서비스롤(RLS 무관), 멤버면 조회 가능.
 */
export async function getSalesSummary(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId) return null;

  const svc = getServiceClient();
  // 멤버십 검증 (본인 매장 매출만)
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const allowed = (mems ?? []).some((m) => m.workplace_id === workplaceId) || isHQ || prof?.is_super_admin === true || prof?.is_executive === true;
  if (!allowed) return null;

  const { data } = await svc
    .from('sales_daily')
    .select('total_amount, sales_date')
    .eq('workplace_id', workplaceId);
  const rows = data ?? [];

  const monthPrefix = kstDate().slice(0, 7); // 'YYYY-MM'
  let allTotal = 0, allCount = 0, monthTotal = 0, monthCount = 0;
  for (const r of rows) {
    const amt = Number(r.total_amount) || 0;
    allTotal += amt; allCount += 1;
    if (typeof r.sales_date === 'string' && r.sales_date.slice(0, 7) === monthPrefix) {
      monthTotal += amt; monthCount += 1;
    }
  }
  return { allTotal, allCount, monthTotal, monthCount, monthLabel: monthPrefix };
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

// sales_tips 테이블 미적용(마이그레이션 전) 여부 판정
function isTableMissing(error) {
  if (!error) return false;
  if (error.code === '42P01') return true;
  return String(error.message || '').includes('does not exist');
}

const TIPS_MIGRATION_MSG = '팁 기능을 쓰려면 DB 마이그레이션(sales_tips)을 먼저 적용해주세요.';

/**
 * 매장별 매출 팁 조회 — 멤버면 조회 가능. 테이블 미적용 시 graceful.
 */
export async function getSalesTips(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId) return { tips: [], enabled: false };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { tips: [], enabled: false };

  const { data, error } = await svc
    .from('sales_tips')
    .select('*')
    .eq('workplace_id', workplaceId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (isTableMissing(error)) return { tips: [], enabled: false };
    return { tips: [], enabled: false };
  }
  return { tips: data ?? [], enabled: true };
}

/**
 * 매출 팁 저장(추가/수정) — 해당 매장 매니저만. id 있으면 update, 없으면 insert.
 */
export async function saveSalesTip({ id, workplaceId, content, sortOrder }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const text = String(content ?? '').trim();
  if (!text) return { ok: false, error: '내용을 입력해주세요.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);

  if (id) {
    // 기존 팁 — 해당 팁의 매장으로 권한 검증
    const { data: existing, error: fetchErr } = await svc
      .from('sales_tips')
      .select('workplace_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) {
      if (isTableMissing(fetchErr)) return { ok: false, error: TIPS_MIGRATION_MSG };
      return { ok: false, error: fetchErr.message || '팁 저장 중 오류가 발생했습니다.' };
    }
    if (!existing) return { ok: false, error: '팁을 찾을 수 없습니다.' };
    if (!perms.isManagerOf(existing.workplace_id)) {
      return { ok: false, error: '이 매장의 팁을 수정할 권한이 없습니다.' };
    }
    const { error } = await svc
      .from('sales_tips')
      .update({ content: text, sort_order: Number(sortOrder) || 0, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      if (isTableMissing(error)) return { ok: false, error: TIPS_MIGRATION_MSG };
      return { ok: false, error: error.message || '팁 저장 중 오류가 발생했습니다.' };
    }
    return { ok: true };
  }

  // 신규 팁
  if (!workplaceId) return { ok: false, error: '사업장이 필요합니다.' };
  if (!perms.isManagerOf(workplaceId)) {
    return { ok: false, error: '이 매장의 팁을 추가할 권한이 없습니다.' };
  }
  const { error } = await svc.from('sales_tips').insert({
    workplace_id: workplaceId,
    content: text,
    sort_order: Number(sortOrder) || 0,
    created_by: user.id,
  });
  if (error) {
    if (isTableMissing(error)) return { ok: false, error: TIPS_MIGRATION_MSG };
    return { ok: false, error: error.message || '팁 저장 중 오류가 발생했습니다.' };
  }
  return { ok: true };
}

/**
 * 매출 팁 삭제(하드 삭제) — 해당 매장 매니저만.
 */
export async function deleteSalesTip({ id }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!id) return { ok: false, error: '삭제할 팁이 없습니다.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);

  const { data: existing, error: fetchErr } = await svc
    .from('sales_tips')
    .select('workplace_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    if (isTableMissing(fetchErr)) return { ok: false, error: TIPS_MIGRATION_MSG };
    return { ok: false, error: fetchErr.message || '팁 삭제 중 오류가 발생했습니다.' };
  }
  if (!existing) return { ok: true }; // 이미 없음
  if (!perms.isManagerOf(existing.workplace_id)) {
    return { ok: false, error: '이 매장의 팁을 삭제할 권한이 없습니다.' };
  }

  const { error } = await svc.from('sales_tips').delete().eq('id', id);
  if (error) {
    if (isTableMissing(error)) return { ok: false, error: TIPS_MIGRATION_MSG };
    return { ok: false, error: error.message || '팁 삭제 중 오류가 발생했습니다.' };
  }
  return { ok: true };
}

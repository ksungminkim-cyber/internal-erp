'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';
import { formatCurrency } from '@/lib/format';

/**
 * 월 마감 확정 — month_closings upsert (서비스 롤 + 코드 권한검증)
 */
export async function confirmMonthClosing({
  workplaceId, year, month, totalRevenue, totalLabor, totalExpense, netProfit,
  revenueBreakdown, laborBreakdown, expenseBreakdown,
}) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('month_closings').upsert({
    workplace_id: workplaceId,
    year,
    month,
    total_revenue: totalRevenue,
    total_labor: totalLabor,
    total_expense: totalExpense,
    net_profit: netProfit,
    revenue_breakdown: revenueBreakdown,
    labor_breakdown: laborBreakdown,
    expense_breakdown: expenseBreakdown,
    locked: true,
    closed_by: user.id,
    closed_at: new Date().toISOString(),
  }, { onConflict: 'workplace_id,year,month' });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

/**
 * 월 마감 해제 — month_closings delete
 */
export async function unlockMonthClosing({ workplaceId, year, month }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc
    .from('month_closings')
    .delete()
    .eq('workplace_id', workplaceId)
    .eq('year', year)
    .eq('month', month);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

/**
 * 마감 스냅샷에 결재 ID 연결 — month_closings.approval_request_id 업데이트
 */
export async function linkClosingApproval({ closingId, requestId }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();

  const { data: closing, error: fetchErr } = await svc
    .from('month_closings')
    .select('workplace_id')
    .eq('id', closingId)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!closing) return { ok: false, error: '마감 스냅샷을 찾을 수 없습니다.' };

  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(closing.workplace_id)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc
    .from('month_closings')
    .update({ approval_request_id: requestId })
    .eq('id', closingId);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

/**
 * 월 마감 결재 제출 — approval_requests + approval_steps insert
 */
export async function submitClosingApproval({
  workplaceId, year, month, totalRevenue, operatingProfit, approverIds,
}) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!Array.isArray(approverIds) || approverIds.length === 0) {
    return { ok: false, error: '결재자를 최소 1명 지정해주세요.' };
  }
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { data: req, error: e1 } = await svc
    .from('approval_requests')
    .insert({
      workplace_id: workplaceId,
      drafter_id: user.id,
      doc_type: 'closing',
      title: `${year}년 ${month}월 월 마감`,
      body: `매출 ${formatCurrency(totalRevenue)}원 / 영업이익 ${formatCurrency(operatingProfit)}원`,
      total_amount: operatingProfit,
      period_year: year,
      period_month: month,
    })
    .select('id')
    .single();
  if (e1) return { ok: false, error: friendlyDbError(e1) };
  const requestId = req.id;

  const { error: e2 } = await svc.from('approval_steps').insert(
    approverIds.map((uid, i) => ({
      request_id: requestId,
      step_order: i + 1,
      approver_id: uid,
      status: 'waiting',
    }))
  );
  if (e2) return { ok: false, error: friendlyDbError(e2) };

  return { ok: true, requestId };
}

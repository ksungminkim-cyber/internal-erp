'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';
import { formatCurrency } from '@/lib/format';
import { kstDateKey } from '@/lib/date';
import { sliceSessionLogs } from '@/lib/laborCalc';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 월 마감·월별 리포트용 데이터 (매출/지출/근태/직원) — 서비스 롤 조회.
 * 클라이언트 profiles(name, hourly_wage)가 RLS로 빈 결과 나던 문제 해결.
 * - 시급(hourly_wage)은 매장 관리자 또는 마감 권한자에게만 반환 (laborVisible)
 * - 기간 종료 이후 시급이 바뀐 직원은 당시 시급으로 계산되도록 wage_history 반영
 */
export async function getClosingSourceData(workplaceId, startISO, endISO) {
  const empty = { sales: [], expenses: [], attendance: [], profiles: [], laborVisible: false };
  const user = await getActor();
  if (!user || !workplaceId) return empty;

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return empty;
  const { data: me } = await svc.from('profiles').select('can_close_books').eq('user_id', user.id).maybeSingle();
  const laborVisible = perms.isManagerOf(workplaceId) || me?.can_close_books === true;

  // sales_date는 date 컬럼 — ISO(UTC)를 그대로 자르면 KST 기준 하루가 밀림 (전월 말일 포함·당월 말일 누락)
  const startDate = kstDateKey(startISO);
  const endDate = kstDateKey(endISO);
  // 월 경계를 넘는 야간 세션까지 잡기 위해 앞뒤 하루씩 넓게 조회 후 출근 시각 기준으로 잘라냄
  const attFrom = new Date(new Date(startISO).getTime() - DAY_MS).toISOString();
  const attTo = new Date(new Date(endISO).getTime() + DAY_MS).toISOString();

  const [sales, expenses, attendance, profiles, wageChanges] = await Promise.all([
    svc
      .from('sales_daily')
      .select('sales_date, total_amount, transaction_count, cash_amount, card_amount, other_amount')
      .eq('workplace_id', workplaceId)
      .gte('sales_date', startDate)
      .lt('sales_date', endDate)
      .order('sales_date'),
    svc
      .from('approval_requests')
      .select('id, title, total_amount, decided_at, expense_items(category, amount, description, kind)')
      .eq('workplace_id', workplaceId)
      .eq('doc_type', 'expense')
      .eq('status', 'approved')
      .gte('submitted_at', startISO)
      .lt('submitted_at', endISO),
    svc
      .from('attendance_logs')
      .select('user_id, event_type, event_at')
      .eq('workplace_id', workplaceId)
      .gte('event_at', attFrom)
      .lt('event_at', attTo)
      .order('event_at'),
    svc.from('profiles').select(laborVisible ? 'user_id, name, hourly_wage' : 'user_id, name'),
    laborVisible
      ? svc.from('wage_history').select('user_id, old_wage').gte('changed_at', endISO).order('changed_at', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  // 기간 종료 후 첫 변경의 old_wage = 기간 종료 시점에 적용되던 시급
  const wageAtPeriod = {};
  (wageChanges.data ?? []).forEach((w) => {
    if (!(w.user_id in wageAtPeriod)) wageAtPeriod[w.user_id] = Number(w.old_wage ?? 0);
  });
  const profileRows = (profiles.data ?? []).map((p) =>
    p.user_id in wageAtPeriod ? { ...p, hourly_wage: wageAtPeriod[p.user_id] } : p
  );

  return {
    sales: sales.data ?? [],
    expenses: expenses.data ?? [],
    attendance: sliceSessionLogs(attendance.data ?? [], startISO, endISO),
    profiles: profileRows,
    laborVisible,
  };
}

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

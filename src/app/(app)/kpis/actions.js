'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

// KPI 권한: workplaceId 있으면 매니저, null(전사)이면 super_admin.
function canManage(perms, workplaceId) {
  return workplaceId ? perms.isManagerOf(workplaceId) : perms.isSuper;
}

/**
 * KPI 저장 — 신규: 결재요청 + 결재선 생성 후 kpis insert / 편집: kpis update.
 * 전체 흐름을 서버에서 처리하고 생성된 결재 id를 반환.
 */
export async function saveKpi({ id, workplaceId, payload, approverIds = [], isNew }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const wpId = workplaceId || null;

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!canManage(perms, wpId)) return { ok: false, error: '권한이 없습니다.' };

  const name = (payload?.name || '').trim();
  if (!name) return { ok: false, error: '지표명을 입력해주세요.' };

  const category = payload?.category || 'kpi';
  const target = payload?.target_value;

  let approvalId = null;

  if (isNew) {
    if (!approverIds.length) return { ok: false, error: '결재자를 1명 이상 지정해주세요.' };

    const { data: req, error: e1 } = await svc
      .from('approval_requests')
      .insert({
        workplace_id: wpId,
        drafter_id: user.id,
        doc_type: 'kpi',
        title: `[${category.toUpperCase()}] ${name}`,
        body: (payload?.description || '').trim() || null,
        total_amount: Number(target) || 0,
      })
      .select('id')
      .single();
    if (e1) return { ok: false, error: friendlyDbError(e1) };
    approvalId = req.id;

    const { error: e2 } = await svc.from('approval_steps').insert(
      approverIds.map((uid, i) => ({
        request_id: approvalId,
        step_order: i + 1,
        approver_id: uid,
        status: 'waiting',
      }))
    );
    if (e2) return { ok: false, error: friendlyDbError(e2) };
  }

  const row = {
    workplace_id: wpId,
    category,
    name,
    target_value: Number(target) || null,
    unit: (payload?.unit || '').trim() || null,
    period: payload?.period || 'monthly',
    description: (payload?.description || '').trim() || null,
    approval_request_id: approvalId ?? payload?.approval_request_id ?? null,
  };

  if (isNew) {
    const { error } = await svc.from('kpis').insert({ ...row, created_by: user.id });
    if (error) return { ok: false, error: friendlyDbError(error) };
  } else {
    const { error } = await svc.from('kpis').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return { ok: false, error: friendlyDbError(error) };
  }

  return { ok: true, approvalId };
}

/** KPI 보관 처리 — 해당 지표의 사업장 기준 권한 확인 후 active=false. */
export async function archiveKpi({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);

  const { data: kpi, error: fetchErr } = await svc.from('kpis').select('workplace_id').eq('id', id).maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!kpi) return { ok: false, error: '지표를 찾을 수 없습니다.' };
  if (!canManage(perms, kpi.workplace_id || null)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('kpis').update({ active: false }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

/** KPI 실적 기록 — 지표의 사업장 기준 매니저 권한 확인 후 kpi_records insert. */
export async function recordKpi({ kpiId, periodStart, periodEnd, actualValue, notes }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);

  const { data: kpi, error: fetchErr } = await svc.from('kpis').select('workplace_id').eq('id', kpiId).maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!kpi) return { ok: false, error: '지표를 찾을 수 없습니다.' };
  if (!canManage(perms, kpi.workplace_id || null)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('kpi_records').insert({
    kpi_id: kpiId,
    period_start: periodStart,
    period_end: periodEnd,
    actual_value: Number(actualValue),
    notes: (notes || '').trim() || null,
    recorded_by: user.id,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

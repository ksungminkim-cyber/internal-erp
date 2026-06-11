'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * 시프트 + 근태 로그 + 동료(이름·시급) 통합 조회
 * 서비스 롤로 조회해 profile JOIN RLS 충돌 회피.
 * 시프트에는 user 이름을 붙여 반환하고, 근태 로그로 계획-실적 매칭 가능.
 */
export async function getScheduleData(workplaceId, periodStartISO, periodEndISO) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId) return { shifts: [], logs: [], coworkers: [] };

  const svc = getServiceClient();

  // ── 요청자가 시급을 볼 권한이 있는지 (대표/임원/본사/super_admin만 — 매니저 제외) ──
  const [{ data: myProfile }, { data: myMems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('role, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const canSeeWage =
    myProfile?.is_super_admin === true ||
    myProfile?.is_executive === true ||
    (myMems ?? []).some((m) => m.role === 'owner') ||
    (myMems ?? []).some((m) => m.workplaces?.name === '본사');

  const [{ data: shifts }, { data: members }, { data: logs }] = await Promise.all([
    svc
      .from('shifts')
      .select('*, approval_request_id')
      .eq('workplace_id', workplaceId)
      .gte('start_at', periodStartISO)
      .lt('start_at', periodEndISO)
      .order('start_at'),
    svc
      .from('memberships')
      .select('user_id, role')
      .eq('workplace_id', workplaceId)
      .eq('active', true)
      .order('role'),
    svc
      .from('attendance_logs')
      .select('id, user_id, event_type, event_at')
      .eq('workplace_id', workplaceId)
      .gte('event_at', periodStartISO)
      .lt('event_at', periodEndISO),
  ]);

  // 이름/시급/퇴사 한 번에 조회
  const allUserIds = [
    ...new Set([
      ...(shifts ?? []).map((s) => s.user_id),
      ...(members ?? []).map((m) => m.user_id),
    ].filter(Boolean)),
  ];
  let profMap = new Map();
  if (allUserIds.length > 0) {
    const { data: profs } = await svc
      .from('profiles')
      .select('user_id, name, hourly_wage, retired_at')
      .in('user_id', allUserIds);
    profMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
  }

  const enrichedShifts = (shifts ?? []).map((s) => ({
    ...s,
    user: { name: profMap.get(s.user_id)?.name ?? null },
  }));

  const coworkers = (members ?? [])
    .filter((m) => !profMap.get(m.user_id)?.retired_at)
    .map((m) => ({
      user_id: m.user_id,
      name: profMap.get(m.user_id)?.name || '—',
      role: m.role,
      // 시급은 권한자에게만 노출 (일반 직원에게는 마스킹)
      hourly_wage: canSeeWage ? Number(profMap.get(m.user_id)?.hourly_wage ?? 0) : 0,
    }));

  return { shifts: enrichedShifts, logs: logs ?? [], coworkers, canSeeWage };
}

/**
 * 시프트 저장 (신규/수정) — 서비스 롤
 */
export async function saveShift({ id, workplaceId, userId, startAt, endAt, roleLabel, notes }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId || !userId || !startAt || !endAt) return { ok: false, error: '필수 항목을 모두 입력해주세요.' };

  const svc = getServiceClient();
  const payload = {
    workplace_id: workplaceId,
    user_id: userId,
    start_at: startAt,
    end_at: endAt,
    role_label: roleLabel || null,
    notes: notes || null,
    created_by: user.id,
  };

  const { error } = id
    ? await svc.from('shifts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id)
    : await svc.from('shifts').insert(payload);

  // 에러는 throw 대신 return — Next.js 운영 빌드가 throw된 메시지를 가려
  // "An error occurred in the Server Components render"로 표시되는 문제 방지.
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('시프트 충돌')) {
      return { ok: false, error: '이 직원은 같은 시간대에 이미 다른 시프트가 있어요. 시간이 겹치지 않게 조정해주세요.' };
    }
    if (msg.includes('range lower bound must be less than')) {
      return { ok: false, error: '종료 시간이 시작 시간보다 빠릅니다. 시간을 확인해주세요.' };
    }
    return { ok: false, error: msg || '저장 중 오류가 발생했습니다.' };
  }
  return { ok: true };
}

/**
 * 시프트 삭제 — 서비스 롤
 */
export async function deleteShift(id) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!id) throw new Error('시프트 ID 누락');

  const svc = getServiceClient();
  const { error } = await svc.from('shifts').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * 시프트 결재 제출 — approval_requests + approval_steps insert, 시프트에 결재 ID 묶기
 */
export async function submitScheduleApproval({
  workplaceId, year, month, shiftCount, shiftIds, approverIds,
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
      doc_type: 'schedule',
      title: `${year}년 ${month}월 근무 스케줄`,
      body: `${shiftCount}개 시프트`,
      total_amount: 0,
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

  const ids = Array.isArray(shiftIds) ? shiftIds : [];
  if (ids.length > 0) {
    const { error: e3 } = await svc
      .from('shifts')
      .update({ approval_request_id: requestId })
      .in('id', ids);
    if (e3) return { ok: false, error: friendlyDbError(e3) };
  }

  return { ok: true, requestId };
}

/**
 * 지난달 시프트 복사 — 새 시프트 배열 insert (created_by는 서버에서 설정)
 */
export async function copyPreviousShifts({ workplaceId, rows }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: '복사할 시프트를 선택해주세요.' };
  }
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const payload = rows.map((r) => ({
    workplace_id: workplaceId,
    user_id: r.user_id,
    start_at: r.start_at,
    end_at: r.end_at,
    role_label: r.role_label ?? null,
    notes: r.notes ?? null,
    status: r.status || 'scheduled',
    created_by: user.id,
  }));

  const { error } = await svc.from('shifts').insert(payload);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

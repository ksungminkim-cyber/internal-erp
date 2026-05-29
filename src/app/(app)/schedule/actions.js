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

  // ── 요청자가 시급을 볼 권한이 있는지 (매니저/대표/본사/super_admin) ──
  const [{ data: myProfile }, { data: myMems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('role, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const canSeeWage =
    myProfile?.is_super_admin === true ||
    myProfile?.is_executive === true ||
    (myMems ?? []).some((m) => m.role === 'manager' || m.role === 'owner') ||
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

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
      hourly_wage: Number(profMap.get(m.user_id)?.hourly_wage ?? 0),
    }));

  return { shifts: enrichedShifts, logs: logs ?? [], coworkers };
}

// Server Component — 출퇴근 로그/보드를 SSR로 미리 로드
// profile JOIN 분리 (RLS 충돌 회피) — 서비스 롤로 안전하게 조회
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AttendanceClient from './AttendanceClient';

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function AttendancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const cookieStore = await cookies();
  const cookieWpId = cookieStore.get('erp_wp')?.value ?? null;
  let wpId = cookieWpId;
  if (!wpId) {
    const { data: firstMem } = await supabase
      .from('memberships')
      .select('workplace_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    wpId = firstMem?.workplace_id ?? null;
  }

  if (!wpId) {
    return <AttendanceClient initialLogs={[]} initialBoard={[]} ssrWorkplaceId={null} userId={user.id} />;
  }

  // 영업일 기준 시작 (자정~새벽 6시는 전일로 간주 → 야간 근무자 처리)
  const BUSINESS_DAY_START_HOUR = 6;
  const todayStart = new Date();
  if (todayStart.getHours() < BUSINESS_DAY_START_HOUR) {
    todayStart.setDate(todayStart.getDate() - 1);
  }
  todayStart.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);

  const svc = getServiceClient();

  const [{ data: logs }, { data: brd }] = await Promise.all([
    svc
      .from('attendance_logs')
      .select('id, user_id, event_type, event_at, note')
      .eq('workplace_id', wpId)
      .gte('event_at', todayStart.toISOString())
      .order('event_at', { ascending: false }),
    svc
      .from('attendance_current_status')
      .select('*')
      .eq('workplace_id', wpId)
      .order('event_at', { ascending: false }),
  ]);

  // 이름 별도 조회 + 매핑
  const ids = [...new Set((logs ?? []).map((l) => l.user_id).filter(Boolean))];
  let nameMap = new Map();
  if (ids.length > 0) {
    const { data: profs } = await svc.from('profiles').select('user_id, name').in('user_id', ids);
    nameMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
  }

  const enrichedLogs = (logs ?? []).map((l) => ({
    ...l,
    profiles: { name: nameMap.get(l.user_id) ?? null },
  }));

  return (
    <AttendanceClient
      initialLogs={enrichedLogs}
      initialBoard={brd ?? []}
      ssrWorkplaceId={wpId}
      userId={user.id}
    />
  );
}

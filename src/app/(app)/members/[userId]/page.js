// Server Component — 직원별 월 통계 대시보드 (SSR)
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import MemberStatsClient from './MemberStatsClient';

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function MemberStatsPage({ params, searchParams }) {
  const { userId } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const svc = getServiceClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // 권한: 본인 또는 관리자만
  const { data: myProfile } = await supabase
    .from('profiles')
    .select('is_super_admin, is_executive')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: myMems } = await supabase
    .from('memberships')
    .select('role, workplaces(name)')
    .eq('user_id', user.id)
    .eq('active', true);

  const isAdmin = myProfile?.is_super_admin === true
    || myProfile?.is_executive === true
    || (myMems ?? []).some((m) => m.role === 'owner')
    || (myMems ?? []).some((m) => m.workplaces?.name === '본사');

  if (user.id !== userId && !isAdmin) {
    return (
      <main className="page-main">
        <div className="card empty">
          <div className="empty-title">접근 권한 없음</div>
        </div>
      </main>
    );
  }

  // 대상 직원 정보
  const { data: target } = await svc
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!target) {
    return (
      <main className="page-main">
        <div className="card empty">
          <div className="empty-title">직원을 찾을 수 없어요</div>
        </div>
      </main>
    );
  }

  // 조회 월 (기본: 이번 달)
  const today = new Date();
  const year = Number(sp?.year) || today.getFullYear();
  const month = Number(sp?.month) || (today.getMonth() + 1);

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  // 쿠키 workplace 우선, 없으면 전 사업장
  const cookieStore = await cookies();
  const cookieWpId = cookieStore.get('erp_wp')?.value ?? null;

  let logsQuery = svc
    .from('attendance_logs')
    .select('event_at, event_type, workplace_id, workplaces(name)')
    .eq('user_id', userId)
    .gte('event_at', monthStart.toISOString())
    .lt('event_at', monthEnd.toISOString())
    .order('event_at');
  if (cookieWpId) logsQuery = logsQuery.eq('workplace_id', cookieWpId);

  const [{ data: logs }, { data: shifts }, { data: wageHist }, { data: mems }] = await Promise.all([
    logsQuery,
    svc
      .from('shifts')
      .select('start_at, end_at, workplace_id, workplaces(name)')
      .eq('user_id', userId)
      .gte('start_at', monthStart.toISOString())
      .lt('start_at', monthEnd.toISOString())
      .order('start_at'),
    svc
      .from('wage_history')
      .select('id, old_wage, new_wage, changed_at')
      .eq('user_id', userId)
      .order('changed_at', { ascending: false })
      .limit(20),
    svc
      .from('memberships')
      .select('id, role, active, workplaces(id, name)')
      .eq('user_id', userId),
  ]);

  return (
    <MemberStatsClient
      target={target}
      year={year}
      month={month}
      logs={logs ?? []}
      shifts={shifts ?? []}
      wageHistory={wageHist ?? []}
      memberships={mems ?? []}
      isMe={user.id === userId}
    />
  );
}

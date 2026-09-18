// Server Component — 직원별 월 통계 대시보드 (SSR)
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import MemberStatsClient from './MemberStatsClient';
import { sliceSessionLogs } from '@/lib/laborCalc';

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

  // 서버 런타임은 UTC — KST 자정 기준으로 월 경계를 잡아야 1일 00~09시 기록이 안 밀림
  const pad = (n) => String(n).padStart(2, '0');
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const monthStart = new Date(`${year}-${pad(month)}-01T00:00:00+09:00`);
  const monthEnd = new Date(`${nextY}-${pad(nextM)}-01T00:00:00+09:00`);
  // 월 경계를 넘는 야간 세션까지 잡기 위해 앞뒤 하루씩 넓게 조회 후 출근 시각 기준으로 잘라냄
  const DAY_MS = 24 * 60 * 60 * 1000;
  const logsFrom = new Date(monthStart.getTime() - DAY_MS).toISOString();
  const logsTo = new Date(monthEnd.getTime() + DAY_MS).toISOString();

  // 쿠키 workplace 우선, 없으면 전 사업장
  const cookieStore = await cookies();
  const cookieWpId = cookieStore.get('erp_wp')?.value ?? null;

  let logsQuery = svc
    .from('attendance_logs')
    .select('event_at, event_type, workplace_id, workplaces(name)')
    .eq('user_id', userId)
    .gte('event_at', logsFrom)
    .lt('event_at', logsTo)
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
      logs={sliceSessionLogs(logs, monthStart.toISOString(), monthEnd.toISOString())}
      shifts={shifts ?? []}
      wageHistory={wageHist ?? []}
      memberships={mems ?? []}
      isMe={user.id === userId}
    />
  );
}

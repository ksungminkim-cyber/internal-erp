// Server Component — 출퇴근 로그/보드를 SSR로 미리 로드
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import AttendanceClient from './AttendanceClient';

export default async function AttendancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // 쿠키에서 workplace 결정
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

  // today boundary — UTC 기준으로 한국 시간 자정 계산
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  const [{ data: logs }, { data: brd }] = await Promise.all([
    supabase
      .from('attendance_logs')
      .select('id, user_id, event_type, event_at, note, profiles:profiles!attendance_logs_user_id_fkey(name)')
      .eq('workplace_id', wpId)
      .gte('event_at', todayStart.toISOString())
      .order('event_at', { ascending: false }),
    supabase
      .from('attendance_current_status')
      .select('*')
      .eq('workplace_id', wpId)
      .order('event_at', { ascending: false }),
  ]);

  return (
    <AttendanceClient
      initialLogs={logs ?? []}
      initialBoard={brd ?? []}
      ssrWorkplaceId={wpId}
      userId={user.id}
    />
  );
}

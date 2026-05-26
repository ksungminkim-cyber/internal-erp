// Server Component — 모든 stats를 SSR로 미리 로드 → 스켈레톤 완전 제거
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import HomeClient from './HomeClient';

function todayKey() { return new Date().toISOString().slice(0, 10); }

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // 쿠키에서 workplace 결정 (layout.js와 동일 로직)
  const cookieStore = await cookies();
  const cookieWpId = cookieStore.get('erp_wp')?.value ?? null;

  // 쿠키 workplace가 없으면 첫 번째 active membership
  let wpId = cookieWpId ?? null;
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

  // workplace 없음 → 빈 상태 화면
  if (!wpId) {
    return (
      <HomeClient
        initialStats={null}
        initialAnnouncements={[]}
        initialReadIds={[]}
        ssrWorkplaceId={null}
        userId={user.id}
      />
    );
  }

  // ── 모든 stats 서버에서 병렬 패치 ────────────────────────────────────────
  const todayStr   = todayKey();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const tomorrow   = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    board, inboxSteps, anns, reads, todayLogs, annTotal,
    salesToday, inv, todayShifts, handover,
  ] = await Promise.all([
    supabase
      .from('attendance_current_status')
      .select('user_id, status')
      .eq('workplace_id', wpId),
    supabase
      .from('approval_steps')
      .select('id, step_order, approval_requests!inner(workplace_id, status, current_step)')
      .eq('approver_id', user.id)
      .eq('status', 'waiting'),
    supabase
      .from('announcements')
      .select('id, title, created_at, pinned, author:profiles!announcements_author_id_fkey(name)')
      .eq('workplace_id', wpId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', user.id),
    supabase
      .from('attendance_logs')
      .select('user_id')
      .eq('workplace_id', wpId)
      .eq('event_type', 'clock_in')
      .gte('event_at', todayStart.toISOString()),
    supabase
      .from('announcements')
      .select('*', { count: 'exact', head: true })
      .eq('workplace_id', wpId),
    supabase
      .from('sales_daily')
      .select('total_amount, transaction_count')
      .eq('workplace_id', wpId)
      .eq('sales_date', todayStr)
      .maybeSingle(),
    supabase
      .from('inventory_items')
      .select('id, current_qty, min_qty')
      .eq('workplace_id', wpId)
      .eq('archived', false),
    supabase
      .from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('workplace_id', wpId)
      .gte('start_at', todayStart.toISOString())
      .lt('start_at', tomorrow.toISOString()),
    supabase
      .from('handover_notes')
      .select('id', { count: 'exact', head: true })
      .eq('workplace_id', wpId)
      .eq('resolved', false),
  ]);

  const readIds    = new Set((reads.data ?? []).map((r) => r.announcement_id));
  const inboxValid = (inboxSteps.data ?? []).filter(
    (s) =>
      s.approval_requests?.workplace_id === wpId &&
      s.approval_requests?.status === 'pending' &&
      s.approval_requests?.current_step === s.step_order
  );
  const lowStock = (inv.data ?? []).filter(
    (i) => Number(i.current_qty) < Number(i.min_qty)
  ).length;

  const initialStats = {
    working:            (board.data ?? []).filter((b) => b.status === 'working' || b.status === 'on_break').length,
    inbox:              inboxValid.length,
    unread:             Math.max(0, (annTotal.count ?? 0) - readIds.size),
    todayCheckins:      new Set((todayLogs.data ?? []).map((l) => l.user_id)).size,
    todaySales:         Number(salesToday.data?.total_amount ?? 0),
    lowStock,
    todayShifts:        todayShifts.count ?? 0,
    handoverUnresolved: handover.count ?? 0,
  };

  return (
    <HomeClient
      initialStats={initialStats}
      initialAnnouncements={anns.data ?? []}
      initialReadIds={[...readIds]}
      ssrWorkplaceId={wpId}
      userId={user.id}
    />
  );
}

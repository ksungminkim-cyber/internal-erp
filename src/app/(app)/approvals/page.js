// Server Component — 결재함(inbox) 기본 뷰 SSR로 미리 로드
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ApprovalsClient from './ApprovalsClient';

export default async function ApprovalsListPage() {
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
    return <ApprovalsClient initialItems={[]} ssrWorkplaceId={null} userId={user.id} />;
  }

  // 결재함(inbox) 기본 뷰: pending + 내가 현재 단계 승인 대기
  const { data } = await supabase
    .from('approval_requests')
    .select(`
      id, title, status, total_amount, current_step, submitted_at, drafter_id, doc_type,
      drafter:profiles!approval_requests_drafter_id_fkey(name),
      approval_steps(id, step_order, approver_id, status)
    `)
    .eq('workplace_id', wpId)
    .order('submitted_at', { ascending: false })
    .limit(200);

  const inbox = (data ?? []).filter(
    (r) =>
      r.status === 'pending' &&
      r.approval_steps?.some(
        (s) => s.step_order === r.current_step && s.approver_id === user.id && s.status === 'waiting'
      )
  );

  return (
    <ApprovalsClient
      initialItems={inbox}
      ssrWorkplaceId={wpId}
      userId={user.id}
    />
  );
}

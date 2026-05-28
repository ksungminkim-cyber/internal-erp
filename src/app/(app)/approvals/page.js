// Server Component — 결재함(inbox) 기본 뷰 SSR
// profiles JOIN을 서비스롤 분리 조회로 우회하여 RLS 충돌 회피.
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import ApprovalsClient from './ApprovalsClient';

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

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

  const svc = getServiceClient();

  // 1) 결재 요청 본문 (RLS 우회)
  const { data: reqs } = await svc
    .from('approval_requests')
    .select('id, title, status, total_amount, current_step, submitted_at, drafter_id, doc_type, workplace_id')
    .eq('workplace_id', wpId)
    .order('submitted_at', { ascending: false })
    .limit(200);

  // 2) 결재 단계 (각 request_id에 묶임)
  const requestIds = (reqs ?? []).map((r) => r.id);
  const { data: steps } = requestIds.length > 0
    ? await svc.from('approval_steps').select('id, request_id, step_order, approver_id, status').in('request_id', requestIds)
    : { data: [] };
  const stepsByReq = new Map();
  (steps ?? []).forEach((s) => {
    if (!stepsByReq.has(s.request_id)) stepsByReq.set(s.request_id, []);
    stepsByReq.get(s.request_id).push(s);
  });

  // 3) drafter 이름 별도 조회
  const drafterIds = [...new Set((reqs ?? []).map((r) => r.drafter_id).filter(Boolean))];
  let drafterMap = new Map();
  if (drafterIds.length > 0) {
    const { data: profs } = await svc.from('profiles').select('user_id, name').in('user_id', drafterIds);
    drafterMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
  }

  const enriched = (reqs ?? []).map((r) => ({
    ...r,
    drafter: { name: drafterMap.get(r.drafter_id) ?? null },
    approval_steps: stepsByReq.get(r.id) ?? [],
  }));

  // inbox: 내가 현재 단계 승인 대기
  const inbox = enriched.filter(
    (r) =>
      r.status === 'pending' &&
      r.approval_steps.some(
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

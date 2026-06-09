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
 * 결재 상세 조회 — 서비스 롤로 RLS 우회 (기안자가 자기 문서를 못 읽어
 * "존재하지 않는 문서"로 뜨던 문제 해결). 권한 검증 후 반환.
 */
export async function getApprovalDetail(id) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: '로그인이 필요합니다.' };
  if (!id) return { notFound: true };

  const svc = getServiceClient();

  const [
    { data: request },
    { data: items },
    { data: steps },
    { data: attachments },
    { data: shifts },
  ] = await Promise.all([
    svc.from('approval_requests')
      .select('*, drafter:profiles!approval_requests_drafter_id_fkey(name, phone)')
      .eq('id', id)
      .maybeSingle(),
    svc.from('expense_items').select('*').eq('request_id', id).order('created_at'),
    svc.from('approval_steps')
      .select('*, approver:profiles!approval_steps_approver_id_fkey(name)')
      .eq('request_id', id)
      .order('step_order'),
    svc.from('approval_attachments').select('*').eq('request_id', id).order('uploaded_at'),
    svc.from('shifts')
      .select('*, user:profiles!shifts_user_id_fkey(name)')
      .eq('approval_request_id', id)
      .order('start_at'),
  ]);

  if (!request) return { notFound: true };

  // 권한: 기안자 / 결재자 / 해당 매장 매니저·대표 / 본사 / super_admin·임원
  const approverIds = (steps ?? []).map((s) => s.approver_id);
  let allowed = request.drafter_id === user.id || approverIds.includes(user.id);
  if (!allowed) {
    const [{ data: prof }, { data: mems }] = await Promise.all([
      svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
      svc.from('memberships').select('role, workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
    ]);
    const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
    const isMgrHere = !!request.workplace_id
      && (mems ?? []).some((m) => m.workplace_id === request.workplace_id && (m.role === 'manager' || m.role === 'owner'));
    allowed = prof?.is_super_admin === true || prof?.is_executive === true || isHQ || isMgrHere;
  }
  if (!allowed) return { forbidden: true };

  return {
    request,
    items: items ?? [],
    steps: steps ?? [],
    attachments: attachments ?? [],
    shifts: shifts ?? [],
  };
}

/**
 * 결재자 후보 조회 — 현재 매장 매니저/대표 + 본사 active 멤버 전원
 * 서비스 롤로 조회해 RLS(본사 직원 프로필 가림) 우회.
 */
export async function getApproverCandidates(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId) return [];

  const svc = getServiceClient();

  const [{ data: storeMems }, { data: hqMems }] = await Promise.all([
    svc
      .from('memberships')
      .select('user_id, role')
      .eq('workplace_id', workplaceId)
      .eq('active', true)
      .in('role', ['manager', 'owner'])
      .neq('user_id', user.id),
    svc
      .from('memberships')
      .select('user_id, role, workplaces!inner(name)')
      .eq('workplaces.name', '본사')
      .eq('active', true)
      .neq('user_id', user.id),
  ]);

  // 중복 제거 (본사 우선)
  const merged = new Map();
  (storeMems ?? []).forEach((m) =>
    merged.set(m.user_id, { user_id: m.user_id, role: m.role, source: 'store' })
  );
  (hqMems ?? []).forEach((m) =>
    merged.set(m.user_id, { user_id: m.user_id, role: m.role, source: 'hq' })
  );

  const uids = [...merged.keys()];
  let profMap = new Map();
  if (uids.length > 0) {
    const { data: profs } = await svc
      .from('profiles')
      .select('user_id, name, is_executive, retired_at')
      .in('user_id', uids);
    profMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
  }

  const list = [...merged.values()]
    .map((m) => {
      const p = profMap.get(m.user_id);
      return {
        user_id: m.user_id,
        name: p?.name || '—',
        role: m.role,
        isExecutive: p?.is_executive === true,
        source: m.source,
        retired: !!p?.retired_at,
      };
    })
    .filter((c) => !c.retired); // 퇴사자 제외

  list.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'hq' ? -1 : 1;
    const rank = { owner: 0, manager: 1, staff: 2 };
    return (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
  });

  return list;
}

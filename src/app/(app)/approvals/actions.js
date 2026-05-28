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

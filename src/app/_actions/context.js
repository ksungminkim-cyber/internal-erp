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
 * 로그인 사용자 본인의 profile + active 멤버십 로드 — 서비스롤.
 * 클라이언트/유저세션 RLS로 본인 멤버십이 누락돼 '정식 직원 아님'으로
 * 출근이 막히던 문제 방지 (본인 데이터이므로 서비스롤 안전).
 * 본사/super_admin이면 전 사업장 가상 멤버십까지 확장해 반환.
 */
export async function getMyContext() {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { profile: null, memberships: [] };

  const svc = getServiceClient();
  const [{ data: profile }, { data: rawMemberships }] = await Promise.all([
    svc.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
    svc
      .from('memberships')
      .select('id, workplace_id, role, active, workplaces(id, name, address)')
      .eq('user_id', user.id)
      .eq('active', true),
  ]);

  let memberships = rawMemberships ?? [];
  const isHQ = profile?.is_super_admin || memberships.some((m) => m.workplaces?.name === '본사');
  if (isHQ) {
    const { data: allWps } = await svc.from('workplaces').select('id, name, address').order('name');
    if (allWps?.length) {
      const realWpIds = new Set(memberships.map((m) => m.workplace_id));
      const virtualMems = allWps
        .filter((w) => !realWpIds.has(w.id))
        .map((w) => ({ id: `virtual_${w.id}`, workplace_id: w.id, role: 'manager', active: true, workplaces: w }));
      memberships = [...memberships, ...virtualMems];
    }
  }

  return { profile: profile ?? null, memberships };
}

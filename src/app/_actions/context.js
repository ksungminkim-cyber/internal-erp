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
  if (!user) return { user: null, profile: null, memberships: [] };

  const svc = getServiceClient();
  // workplaces는 몇 행 안 되므로 무조건 병렬 조회 — HQ 분기 시 순차 왕복 1회 제거
  const [{ data: profile }, { data: rawMemberships }, { data: allWps }] = await Promise.all([
    svc.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
    svc
      .from('memberships')
      .select('id, workplace_id, role, active, workplaces(id, name, address)')
      .eq('user_id', user.id)
      .eq('active', true),
    svc.from('workplaces').select('id, name, address').order('name'),
  ]);

  let memberships = rawMemberships ?? [];
  const isHQ = profile?.is_super_admin || memberships.some((m) => m.workplaces?.name === '본사');
  if (isHQ && allWps?.length) {
    const realWpIds = new Set(memberships.map((m) => m.workplace_id));
    const virtualMems = allWps
      .filter((w) => !realWpIds.has(w.id))
      .map((w) => ({ id: `virtual_${w.id}`, workplace_id: w.id, role: 'manager', active: true, workplaces: w }));
    memberships = [...memberships, ...virtualMems];
  }

  return { user, profile: profile ?? null, memberships };
}

/**
 * 온보딩 완료 표시 — 본인 profiles.onboarded_at 설정 (서비스롤).
 * profiles UPDATE RLS가 super_admin 전용이라 일반 직원은 클라이언트에서
 * 업데이트가 막혀 온보딩 모달이 매번 뜨던 문제 해결.
 */
export async function markOnboarded() {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false };
  const svc = getServiceClient();
  await svc.from('profiles').update({ onboarded_at: new Date().toISOString() }).eq('user_id', user.id).is('onboarded_at', null);
  return { ok: true };
}

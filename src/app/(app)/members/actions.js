'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

/** 서비스 롤 클라이언트 — RLS 우회, members 전용 관리 작업 */
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * 직원 관리 페이지에 필요한 전체 데이터 조회
 * – 서버 사이드에서 실행되므로 클라이언트 인증 hang 없음
 * – 관리자 전용 페이지이므로 서비스 롤 사용
 */
export async function getMembersData() {
  // 현재 로그인 사용자 세션 확인 (서버 측 인증)
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  // 현재 사용자 프로필로 권한 확인
  const { data: myProfile } = await authClient
    .from('profiles')
    .select('is_super_admin')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: myMem } = await authClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('active', true);

  const canManage =
    myProfile?.is_super_admin === true ||
    (myMem ?? []).some((m) => m.role === 'owner');

  if (!canManage) throw new Error('접근 권한이 없습니다.');

  // 서비스 롤로 전체 데이터 조회 (RLS 우회)
  const svc = getServiceClient();
  const [wpsRes, profsRes, memsRes] = await Promise.all([
    svc.from('workplaces').select('id, name').order('name'),
    svc.from('profiles').select('*').order('created_at', { ascending: false }),
    svc.from('memberships').select('id, user_id, workplace_id, role, active'),
  ]);

  if (wpsRes.error) throw new Error('workplaces: ' + wpsRes.error.message);
  if (profsRes.error) throw new Error('profiles: ' + profsRes.error.message);
  if (memsRes.error) throw new Error('memberships: ' + memsRes.error.message);

  return {
    workplaces: wpsRes.data ?? [],
    profiles: profsRes.data ?? [],
    memberships: memsRes.data ?? [],
  };
}

/**
 * 멤버 배정 저장
 * @param {{ userId: string, hourlyWage: number, canCloseBooks: boolean, updates: Array<{workplaceId, active, role, existingId}> }} params
 */
export async function saveMemberAssignment({ userId, hourlyWage, canCloseBooks, profileChanged, updates }) {
  // 권한 확인
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const { data: myProfile } = await authClient
    .from('profiles')
    .select('is_super_admin')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: myMem } = await authClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('active', true);

  const canManage =
    myProfile?.is_super_admin === true ||
    (myMem ?? []).some((m) => m.role === 'owner');

  if (!canManage) throw new Error('접근 권한이 없습니다.');

  const svc = getServiceClient();

  // 프로필 변경
  if (profileChanged) {
    const { error } = await svc
      .from('profiles')
      .update({
        hourly_wage: Number(hourlyWage) || 0,
        can_close_books: canCloseBooks,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (error) throw new Error('프로필 저장 실패: ' + error.message);
  }

  // 멤버십 변경
  for (const u of updates) {
    if (u.existingId) {
      // 기존 멤버십 업데이트
      const { error } = await svc
        .from('memberships')
        .update({ active: u.active, role: u.role })
        .eq('id', u.existingId);
      if (error) throw new Error('멤버십 수정 실패: ' + error.message);
    } else if (u.active) {
      // 신규 멤버십 생성
      const { error } = await svc
        .from('memberships')
        .insert({ user_id: userId, workplace_id: u.workplaceId, role: u.role, active: true });
      if (error) throw new Error('멤버십 배정 실패: ' + error.message);
    }
  }
}

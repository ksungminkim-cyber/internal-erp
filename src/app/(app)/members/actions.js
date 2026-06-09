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
 */
export async function getMembersData() {
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
    .select('role, workplaces(name)')
    .eq('user_id', user.id)
    .eq('active', true);

  const canManage =
    myProfile?.is_super_admin === true ||
    (myMem ?? []).some((m) => m.role === 'owner') ||
    (myMem ?? []).some((m) => m.workplaces?.name === '본사');

  if (!canManage) throw new Error('접근 권한이 없습니다.');

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
 * - 신규(orphan) 유저: 프로필 INSERT
 * - 기존 유저: hourly_wage·can_close_books만 UPDATE (name/phone 덮어쓰기 금지)
 * - 본사 배정 시: is_super_admin 자동 부여
 */
export async function saveMemberAssignment({ userId, userName, userPhone, hourlyWage, canCloseBooks, profileChanged, updates }) {
  // ── 권한 확인 ────────────────────────────────────────────────────────────
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
    .select('role, workplaces(name)')
    .eq('user_id', user.id)
    .eq('active', true);

  const canManage =
    myProfile?.is_super_admin === true ||
    (myMem ?? []).some((m) => m.role === 'owner') ||
    (myMem ?? []).some((m) => m.workplaces?.name === '본사');

  if (!canManage) throw new Error('접근 권한이 없습니다.');

  const svc = getServiceClient();

  // ── 프로필 처리 ──────────────────────────────────────────────────────────
  const { data: existingProf } = await svc
    .from('profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!existingProf) {
    // 신규(orphan): auth 유저 정보로 프로필 생성
    const { error } = await svc.from('profiles').insert({
      user_id:        userId,
      name:           userName  ?? null,
      phone:          userPhone ?? null,
      hourly_wage:    Number(hourlyWage) || 0,
      can_close_books: canCloseBooks,
    });
    if (error) throw new Error('프로필 생성 실패: ' + error.message);
  } else if (profileChanged) {
    // 기존 프로필: wage·권한만 업데이트 — name/phone은 본인이 /me 에서 수정
    const { error } = await svc.from('profiles').update({
      hourly_wage:    Number(hourlyWage) || 0,
      can_close_books: canCloseBooks,
      updated_at:     new Date().toISOString(),
    }).eq('user_id', userId);
    if (error) throw new Error('프로필 저장 실패: ' + error.message);
  }

  // ── 멤버십 변경 ──────────────────────────────────────────────────────────
  for (const u of updates) {
    if (u.existingId) {
      const { error } = await svc
        .from('memberships')
        .update({ active: u.active, role: u.role })
        .eq('id', u.existingId);
      if (error) throw new Error('멤버십 수정 실패: ' + error.message);
    } else if (u.active) {
      const { error } = await svc
        .from('memberships')
        .insert({ user_id: userId, workplace_id: u.workplaceId, role: u.role, active: true });
      if (error) throw new Error('멤버십 배정 실패: ' + error.message);
    }
  }

  // ── 본사 배정 여부 확인 → is_super_admin 자동 부여 ────────────────────
  // 변경 후 현재 활성 멤버십을 조회해 '본사' 사업장이 있으면 super_admin 권한 부여
  const { data: activeMems } = await svc
    .from('memberships')
    .select('workplaces(name)')
    .eq('user_id', userId)
    .eq('active', true);

  const isHQMember = (activeMems ?? []).some((m) => m.workplaces?.name === '본사');
  if (isHQMember) {
    await svc.from('profiles')
      .update({ is_super_admin: true, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }
}

/**
 * 직원 퇴사 처리
 * - profiles.retired_at, retired_reason 설정
 * - DB 트리거가 자동으로 memberships.active = false 처리
 */
export async function retireMember(userId, opts = {}) {
  // 하위호환: 두 번째 인자가 문자열이면 reason 으로 간주
  const { reason = null, retiredAt = null } = typeof opts === 'string' ? { reason: opts } : opts;
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const { data: myProfile } = await authClient
    .from('profiles')
    .select('is_super_admin, is_executive')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: myMem } = await authClient
    .from('memberships')
    .select('role, workplaces(name)')
    .eq('user_id', user.id)
    .eq('active', true);

  const canManage =
    myProfile?.is_super_admin === true ||
    myProfile?.is_executive === true ||
    (myMem ?? []).some((m) => m.role === 'owner') ||
    (myMem ?? []).some((m) => m.workplaces?.name === '본사');

  if (!canManage) return { ok: false, error: '접근 권한이 없습니다.' };

  // 퇴사일 — 'YYYY-MM-DD'(KST 자정) 또는 ISO 허용, 없으면 현재시각
  let retiredIso = new Date().toISOString();
  if (retiredAt) {
    const raw = /^\d{4}-\d{2}-\d{2}$/.test(retiredAt) ? `${retiredAt}T00:00:00+09:00` : retiredAt;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) retiredIso = d.toISOString();
  }

  const svc = getServiceClient();
  const { error } = await svc
    .from('profiles')
    .update({
      retired_at: retiredIso,
      retired_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) return { ok: false, error: '퇴사 처리 실패: ' + error.message };
  return { ok: true };
}

/**
 * 복직 처리 (퇴사 취소)
 */
export async function unretireMember(userId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const { data: myProfile } = await authClient
    .from('profiles')
    .select('is_super_admin, is_executive')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: myMem } = await authClient
    .from('memberships')
    .select('role, workplaces(name)')
    .eq('user_id', user.id)
    .eq('active', true);

  const canManage =
    myProfile?.is_super_admin === true ||
    myProfile?.is_executive === true ||
    (myMem ?? []).some((m) => m.role === 'owner') ||
    (myMem ?? []).some((m) => m.workplaces?.name === '본사');

  if (!canManage) return { ok: false, error: '접근 권한이 없습니다.' };

  const svc = getServiceClient();
  const { error } = await svc
    .from('profiles')
    .update({
      retired_at: null,
      retired_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) return { ok: false, error: '복직 처리 실패: ' + error.message };
  return { ok: true };
}

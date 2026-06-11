// 서버액션 전용 공용 권한 가드 (RLS 비의존 — 서비스롤 + 코드 권한검증).
// 'use server' 아님: 서버액션 파일들이 import해서 쓰는 헬퍼 모듈.
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// 현재 로그인 사용자 (없으면 null)
export async function getActor() {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  return user ?? null;
}

/**
 * 사용자의 권한 정보 로드 (서비스롤). 반환된 헬퍼로 권한 판정.
 *  - isSuper: super_admin / 임원 / 본사 소속 → 전 매장 권한
 *  - isMemberOf(wpId): 해당 매장 active 멤버 (or isSuper)
 *  - isManagerOf(wpId): 해당 매장 manager/owner (or isSuper)
 */
export async function loadActorPerms(svc, userId) {
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', userId).maybeSingle(),
    svc.from('memberships').select('workplace_id, role, workplaces(name)').eq('user_id', userId).eq('active', true),
  ]);
  const list = mems ?? [];
  const isHQ = list.some((m) => m.workplaces?.name === '본사');
  const isSuper = prof?.is_super_admin === true || prof?.is_executive === true || isHQ;
  return {
    isSuper,
    isMemberOf: (wpId) => isSuper || list.some((m) => m.workplace_id === wpId),
    isManagerOf: (wpId) => isSuper || list.some((m) => m.workplace_id === wpId && (m.role === 'manager' || m.role === 'owner')),
  };
}

// 마감 잠금 등 공통 DB 에러 → 사용자용 메시지
export function friendlyDbError(error, fallback = '처리 중 오류가 발생했습니다.') {
  const msg = String(error?.message || '');
  if (msg.includes('마감 잠금') || msg.includes('locked')) return '마감된 월의 데이터는 수정할 수 없습니다.';
  if (msg.includes('시프트 충돌')) return '이 직원은 같은 시간대에 이미 다른 시프트가 있어요.';
  if (msg.includes('range lower bound must be less than')) return '종료 시간이 시작 시간보다 빠릅니다.';
  return msg || fallback;
}

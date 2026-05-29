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
 * user_id 배열 → { user_id: name } 맵 반환 (서비스 롤, RLS 우회).
 * 클라이언트 페이지에서 profile JOIN 대신 사용하면
 * 마이그레이션/RLS 상태와 무관하게 직원 이름이 항상 표시됨.
 */
export async function getProfileNames(userIds) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return {};

  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (ids.length === 0) return {};

  const svc = getServiceClient();
  const { data } = await svc.from('profiles').select('user_id, name').in('user_id', ids);
  return Object.fromEntries((data ?? []).map((p) => [p.user_id, p.name]));
}

// Server Component — 인수인계 노트 SSR
// profiles JOIN을 그대로 쓰면 RLS/관계명 차이로 빈 결과가 나올 수 있어 분리 조회.
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import HandoverClient from './HandoverClient';

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function HandoverPage() {
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
    return <HandoverClient initialItems={[]} ssrWorkplaceId={null} userId={user.id} />;
  }

  // 1) 노트 본문 (RLS 우회 — 서비스 롤)
  const svc = getServiceClient();
  const { data: notes } = await svc
    .from('handover_notes')
    .select('id, workplace_id, author_id, shift_type, note_date, content, flags, resolved, resolved_by, resolved_at, created_at')
    .eq('workplace_id', wpId)
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  // 2) author 이름 별도 조회 후 매핑
  const authorIds = [...new Set((notes ?? []).map((n) => n.author_id).filter(Boolean))];
  let authorMap = new Map();
  if (authorIds.length > 0) {
    const { data: profs } = await svc
      .from('profiles')
      .select('user_id, name')
      .in('user_id', authorIds);
    authorMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
  }

  const items = (notes ?? []).map((n) => ({
    ...n,
    author: { name: authorMap.get(n.author_id) ?? null },
  }));

  return (
    <HandoverClient
      initialItems={items}
      ssrWorkplaceId={wpId}
      userId={user.id}
    />
  );
}

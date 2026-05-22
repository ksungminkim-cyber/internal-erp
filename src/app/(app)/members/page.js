// Server Component — 데이터를 SSR에서 직접 가져오므로 클라이언트 로딩 없음
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { Shield } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import MembersClient from './MembersClient';

function getServiceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function MembersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // 현재 사용자 권한 확인
  const [{ data: myProfile }, { data: myMem }] = await Promise.all([
    supabase.from('profiles').select('is_super_admin').eq('user_id', user.id).maybeSingle(),
    supabase.from('memberships').select('role').eq('user_id', user.id).eq('active', true),
  ]);

  const canManage =
    myProfile?.is_super_admin === true ||
    (myMem ?? []).some((m) => m.role === 'owner');

  if (!canManage) {
    return (
      <>
        <PageHeader title="직원 관리" hideSwitcher />
        <main className="page-main">
          <div className="card empty">
            <div className="empty-icon"><Shield size={26} /></div>
            <div className="empty-title">접근 권한 없음</div>
            <div className="empty-desc">대표(owner) 또는 전체 관리자만 이용할 수 있어요.</div>
          </div>
        </main>
      </>
    );
  }

  // 서비스 롤로 전체 데이터 조회 (RLS 우회)
  const svc = getServiceClient();
  const [wpsRes, profsRes, memsRes] = await Promise.all([
    svc.from('workplaces').select('id, name').order('name'),
    svc.from('profiles').select('*').order('created_at', { ascending: false }),
    svc.from('memberships').select('id, user_id, workplace_id, role, active'),
  ]);

  return (
    <MembersClient
      workplaces={wpsRes.data ?? []}
      profiles={profsRes.data ?? []}
      memberships={memsRes.data ?? []}
      currentUserId={user.id}
    />
  );
}

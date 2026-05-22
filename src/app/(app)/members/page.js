// Server Component — SSR에서 직접 fetch, 클라이언트 로딩 없음
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
  const svc     = getServiceClient();

  // ── 모든 쿼리 동시 실행 (auth + 데이터 3종) ─────────────────────────────
  const [
    { data: { user } },
    wpsRes,
    profsRes,
    memsRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    svc.from('workplaces').select('id, name').order('name'),
    svc.from('profiles').select('*').order('created_at', { ascending: false }),
    svc.from('memberships').select('id, user_id, workplace_id, role, active'),
  ]);

  if (!user) redirect('/login');

  // ── 권한 확인: 임원(본사 대표)만 허용 ────────────────────────────────────
  const myProfile    = (profsRes.data ?? []).find((p) => p.user_id === user.id);
  const myActiveMems = (memsRes.data ?? []).filter((m) => m.user_id === user.id && m.active);
  // is_executive = 본사 owner만 true. 나울·녹턴 owner 없으므로 owner role = 사실상 본사 대표
  const canManage    = myProfile?.is_executive === true || myActiveMems.some((m) => m.role === 'owner');

  if (!canManage) {
    return (
      <>
        <PageHeader title="직원 관리" hideSwitcher />
        <main className="page-main">
          <div className="card empty">
            <div className="empty-icon"><Shield size={26} /></div>
            <div className="empty-title">접근 권한 없음</div>
            <div className="empty-desc">대표(임원)만 이용할 수 있어요.</div>
          </div>
        </main>
      </>
    );
  }

  return (
    <MembersClient
      workplaces={wpsRes.data ?? []}
      profiles={profsRes.data   ?? []}
      memberships={memsRes.data ?? []}
      currentUserId={user.id}
    />
  );
}

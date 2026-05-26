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

  // ── 모든 쿼리 동시 실행 (auth + 데이터 4종) ─────────────────────────────
  const [
    { data: { user } },
    wpsRes,
    profsRes,
    memsRes,
    authListRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    svc.from('workplaces').select('id, name').order('name'),
    svc.from('profiles').select('*').order('created_at', { ascending: false }),
    svc.from('memberships').select('id, user_id, workplace_id, role, active'),
    svc.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  if (!user) redirect('/login');

  // ── 권한 확인: 본사 직원(is_super_admin) + 임원 + owner ────────────────
  const myProfile    = (profsRes.data ?? []).find((p) => p.user_id === user.id);
  const myActiveMems = (memsRes.data ?? []).filter((m) => m.user_id === user.id && m.active);
  const hqWpId    = (wpsRes.data ?? []).find((w) => w.name === '본사')?.id;
  const canManage = myProfile?.is_executive === true
    || myProfile?.is_super_admin === true
    || myActiveMems.some((m) => m.role === 'owner')
    || (hqWpId != null && myActiveMems.some((m) => m.workplace_id === hqWpId));

  if (!canManage) {
    return (
      <>
        <PageHeader title="직원 관리" hideSwitcher />
        <main className="page-main">
          <div className="card empty">
            <div className="empty-icon"><Shield size={26} /></div>
            <div className="empty-title">접근 권한 없음</div>
            <div className="empty-desc">본사 직원 또는 대표만 이용할 수 있어요.</div>
          </div>
        </main>
      </>
    );
  }

  // ── profiles 없는 auth 유저 보완 ────────────────────────────────────────
  // handle_new_user 트리거 실행 전 가입자, 혹은 직접 생성된 계정은
  // auth.users에는 있지만 profiles 테이블에 row가 없을 수 있음.
  // admin.listUsers()로 전체 auth 유저를 가져와 프로필 없는 유저를 합산.
  const profiles  = profsRes.data ?? [];
  const authUsers = authListRes.data?.users ?? [];

  // ── null 이름 자동 복구 ──────────────────────────────────────────────────
  // 이전 upsert 버그로 name이 null이 된 프로필을 auth 메타데이터 or 이메일 prefix로 복원.
  // 서비스 롤로 실행 — 관리자가 /members 열 때마다 조용히 수정 (idempotent).
  const authMap = new Map(authUsers.map((u) => [u.id, u]));
  const nullNameProfiles = profiles.filter((p) => !p.name || !p.name.trim());
  if (nullNameProfiles.length > 0) {
    await Promise.all(
      nullNameProfiles.map((p) => {
        const u = authMap.get(p.user_id);
        if (!u) return null;
        const restored = (u.user_metadata?.name || '').trim() || u.email?.split('@')[0] || null;
        if (!restored) return null;
        p.name = restored; // 렌더 즉시 반영
        return svc.from('profiles')
          .update({ name: restored, updated_at: new Date().toISOString() })
          .eq('user_id', p.user_id);
      }).filter(Boolean)
    );
  }

  // ── orphan auth 유저 (profiles 없음) ────────────────────────────────────
  const profiledIds   = new Set(profiles.map((p) => p.user_id));
  const orphanProfiles = authUsers
    .filter((u) => !profiledIds.has(u.id))
    .map((u) => ({
      user_id:        u.id,
      name:           u.user_metadata?.name || u.email?.split('@')[0] || null,
      phone:          u.user_metadata?.phone || null,
      email:          u.email,
      hourly_wage:    0,
      can_close_books: false,
      is_super_admin: false,
      is_executive:   false,
      created_at:     u.created_at,
    }));

  const allProfiles = [...profiles, ...orphanProfiles];

  // is_executive 또는 owner만 기존 배정 수정 가능
  const isExecutive = myProfile?.is_executive === true
    || myActiveMems.some((m) => m.role === 'owner');

  return (
    <MembersClient
      workplaces={wpsRes.data ?? []}
      profiles={allProfiles}
      memberships={memsRes.data ?? []}
      currentUserId={user.id}
      isExecutive={isExecutive}
    />
  );
}

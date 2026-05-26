import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppProvider } from '@/context/AppContext';
import BottomNav from '@/components/BottomNav';
import Sidebar from '@/components/Sidebar';
import WelcomeModal from '@/components/WelcomeModal';

export default async function AppLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // SSR에서 profile + memberships 미리 로드 → 새로고침 시 깜빡임 방지
  const [{ data: profile }, { data: rawMemberships }] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('memberships')
      .select('id, workplace_id, role, active, workplaces(id, name, address)')
      .eq('user_id', user.id)
      .eq('active', true),
  ]);

  // super_admin 또는 본사 소속이면 모든 사업장을 switcher에서 접근 가능하게
  let memberships = rawMemberships ?? [];
  const isHQ = profile?.is_super_admin || (rawMemberships ?? []).some((m) => m.workplaces?.name === '본사');
  if (isHQ) {
    const { data: allWps } = await supabase
      .from('workplaces')
      .select('id, name, address')
      .order('name');
    if (allWps?.length) {
      const realWpIds = new Set(memberships.map((m) => m.workplace_id));
      const virtualMems = allWps
        .filter((w) => !realWpIds.has(w.id))
        .map((w) => ({
          id: `virtual_${w.id}`,
          workplace_id: w.id,
          role: 'manager',
          active: true,
          workplaces: w,
        }));
      memberships = [...memberships, ...virtualMems];
    }
  }

  // 쿠키에서 마지막 선택 사업장 읽기 → AppContext에 전달하여 SSR/클라이언트 hydration 일치
  const cookieStore = await cookies();
  const cookieWpId = cookieStore.get('erp_wp')?.value ?? null;
  const validCookieWp = cookieWpId
    ? memberships.find((m) => m.workplace_id === cookieWpId)
    : null;
  const initialWorkplaceId = validCookieWp?.workplace_id ?? memberships[0]?.workplace_id ?? null;

  return (
    <AppProvider
      initialUser={user}
      initialProfile={profile ?? null}
      initialMemberships={memberships}
      initialWorkplaceId={initialWorkplaceId}
    >
      <Sidebar />
      <div className="app-shell">{children}</div>
      <BottomNav />
      <WelcomeModal />
    </AppProvider>
  );
}

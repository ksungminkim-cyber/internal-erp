import { createClient } from '@/lib/supabase/server';
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

  // super_admin은 모든 사업장을 switcher에서 접근 가능하게
  // (DB 마이그레이션으로 is_member_of가 super_admin을 허용하므로 workplaces 쿼리 가능)
  let memberships = rawMemberships ?? [];
  if (profile?.is_super_admin) {
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

  return (
    <AppProvider
      initialUser={user}
      initialProfile={profile ?? null}
      initialMemberships={memberships}
    >
      <Sidebar />
      <div className="app-shell">{children}</div>
      <BottomNav />
      <WelcomeModal />
    </AppProvider>
  );
}

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

  // SSR에서 profile + memberships 미리 로드 → 새로고침 시 "미배정" 깜빡임 방지
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('memberships')
      .select('id, workplace_id, role, active, workplaces(id, name, address)')
      .eq('user_id', user.id)
      .eq('active', true),
  ]);

  return (
    <AppProvider
      initialUser={user}
      initialProfile={profile ?? null}
      initialMemberships={memberships ?? []}
    >
      <Sidebar />
      <div className="app-shell">{children}</div>
      <BottomNav />
      <WelcomeModal />
    </AppProvider>
  );
}

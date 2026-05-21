import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { AppProvider } from '@/context/AppContext';
import BottomNav from '@/components/BottomNav';
import Sidebar from '@/components/Sidebar';

export default async function AppLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <AppProvider initialUser={user}>
      <Sidebar />
      <div className="app-shell">{children}</div>
      <BottomNav />
    </AppProvider>
  );
}

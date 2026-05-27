// Server Component — 인수인계 노트 SSR로 미리 로드
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import HandoverClient from './HandoverClient';

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

  const { data } = await supabase
    .from('handover_notes')
    .select('*, author:profiles!handover_notes_author_id_fkey(name)')
    .eq('workplace_id', wpId)
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <HandoverClient
      initialItems={data ?? []}
      ssrWorkplaceId={wpId}
      userId={user.id}
    />
  );
}

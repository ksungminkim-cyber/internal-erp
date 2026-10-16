'use server';

import { getServiceClient, getActor, loadActorPerms } from '@/lib/server/guard';

/** 홈 "이번 주 트렌드 픽" — 가장 최근 주의 생성 결과. 멤버면 조회 가능 */
export async function getTrendPicks({ workplaceId }) {
  const user = await getActor();
  if (!user || !workplaceId) return null;
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return null;
  const { data, error } = await svc.from('trend_picks')
    .select('week_start, generated_at, items, model')
    .eq('workplace_id', workplaceId)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`trend_picks: ${error.message}`);
  return data ?? null;
}

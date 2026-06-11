'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

export async function createSuggestion({ workplaceId, category, title, body, anonymous }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { error } = await svc.from('suggestions').insert({
    user_id: user.id,
    workplace_id: workplaceId || null,
    category,
    title,
    body,
    anonymous,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function respondSuggestion({ id, status, response }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isSuper) return { ok: false, error: '권한이 없습니다.' };
  const hasResponse = !!(response && response.trim());
  const { error } = await svc.from('suggestions').update({
    status,
    response: hasResponse ? response.trim() : null,
    responded_by: user.id,
    responded_at: hasResponse ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

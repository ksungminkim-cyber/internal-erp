'use server';

import { getServiceClient, getActor, friendlyDbError } from '@/lib/server/guard';

// 본인 프로필(이름·연락처) 수정 — self-scoped.
export async function updateMyProfile({ name, phone }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { error } = await svc
    .from('profiles')
    .update({
      name: String(name ?? '').trim(),
      phone: String(phone ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

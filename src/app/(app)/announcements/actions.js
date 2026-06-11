'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

export async function createAnnouncement({ workplaceId, title, body, pinned }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };
  const { error } = await svc.from('announcements').insert({
    workplace_id: workplaceId,
    title,
    body,
    pinned,
    author_id: user.id,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function updateAnnouncement({ id, title, body, pinned }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { data: row } = await svc.from('announcements').select('workplace_id').eq('id', id).maybeSingle();
  if (!row) return { ok: false, error: '공지를 찾을 수 없습니다.' };
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(row.workplace_id)) return { ok: false, error: '권한이 없습니다.' };
  const { error } = await svc.from('announcements').update({
    title,
    body,
    pinned,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function deleteAnnouncement(id) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { data: row } = await svc.from('announcements').select('workplace_id').eq('id', id).maybeSingle();
  if (!row) return { ok: false, error: '공지를 찾을 수 없습니다.' };
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isManagerOf(row.workplace_id)) return { ok: false, error: '권한이 없습니다.' };
  const { error } = await svc.from('announcements').delete().eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function markAnnouncementRead(announcementId) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  // best-effort: 중복(이미 읽음)이어도 성공 취급
  await svc.from('announcement_reads').insert({ announcement_id: announcementId, user_id: user.id });
  return { ok: true };
}

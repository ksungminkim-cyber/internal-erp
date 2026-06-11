'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

export async function createComplaint({
  workplaceId, channel, category, severity,
  customer_label, customer_contact, summary, status, resolution,
}) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };
  const resolved = status === 'resolved';
  const { error } = await svc.from('customer_complaints').insert({
    workplace_id: workplaceId,
    reporter_id: user.id,
    channel,
    category,
    severity,
    customer_label,
    customer_contact,
    summary,
    status,
    resolution,
    resolved_at: resolved ? new Date().toISOString() : null,
    resolved_by: resolved ? user.id : null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function updateComplaint({
  id, channel, category, severity,
  customer_label, customer_contact, summary, status, resolution,
}) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { data: row } = await svc
    .from('customer_complaints')
    .select('workplace_id, resolved_at')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: '클레임을 찾을 수 없습니다.' };
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(row.workplace_id)) return { ok: false, error: '권한이 없습니다.' };
  const resolved = status === 'resolved';
  const { error } = await svc.from('customer_complaints').update({
    channel,
    category,
    severity,
    customer_label,
    customer_contact,
    summary,
    status,
    resolution,
    resolved_at: resolved ? (row.resolved_at || new Date().toISOString()) : null,
    resolved_by: resolved ? user.id : null,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

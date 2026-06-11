'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

export async function saveEquipment({ id, workplaceId, payload }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const row = {
    workplace_id: workplaceId,
    name: payload.name,
    category: payload.category,
    model: payload.model,
    serial_no: payload.serial_no,
    vendor: payload.vendor,
    purchased_at: payload.purchased_at,
    warranty_until: payload.warranty_until,
    next_check_at: payload.next_check_at,
    status: payload.status,
    notes: payload.notes,
  };

  if (id) {
    const { error } = await svc
      .from('equipment')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: friendlyDbError(error) };
  } else {
    const { error } = await svc.from('equipment').insert(row);
    if (error) return { ok: false, error: friendlyDbError(error) };
  }
  return { ok: true };
}

export async function archiveEquipment({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();

  const { data: eq, error: fetchErr } = await svc
    .from('equipment')
    .select('workplace_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!eq) return { ok: false, error: '존재하지 않는 장비입니다.' };

  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(eq.workplace_id)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('equipment').update({ archived: true }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function addEquipmentLog({ workplaceId, equipmentId, logType, title, description, cost, nextCheckAt }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('equipment_logs').insert({
    equipment_id: equipmentId,
    workplace_id: workplaceId,
    user_id: user.id,
    log_type: logType,
    title,
    description,
    cost,
    next_check_at: nextCheckAt,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

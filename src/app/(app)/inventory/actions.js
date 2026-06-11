'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

export async function closeInventoryMonth({ workplaceId, year, month, itemCount, totalQtyEstimate, lowStockCount, snapshot, notes }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_closings').upsert({
    workplace_id: workplaceId,
    year,
    month,
    item_count: itemCount,
    total_qty_estimate: totalQtyEstimate,
    low_stock_count: lowStockCount,
    snapshot,
    notes: notes?.trim() || null,
    closed_by: user.id,
    closed_at: new Date().toISOString(),
  }, { onConflict: 'workplace_id,year,month' });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function deleteInventoryClosing({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();

  const { data: row, error: fetchErr } = await svc
    .from('inventory_closings')
    .select('workplace_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!row) return { ok: false, error: '마감 기록을 찾을 수 없습니다.' };

  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(row.workplace_id)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_closings').delete().eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function saveInventoryItem({ id, workplaceId, payload }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const base = {
    name: payload.name,
    category: payload.category,
    unit: payload.unit,
    current_qty: payload.current_qty,
    min_qty: payload.min_qty,
    vendor: payload.vendor,
    notes: payload.notes,
  };

  let error;
  if (id) {
    ({ error } = await svc
      .from('inventory_items')
      .update({ ...base, updated_at: new Date().toISOString() })
      .eq('id', id));
  } else {
    ({ error } = await svc
      .from('inventory_items')
      .insert({ ...base, workplace_id: workplaceId }));
  }
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function archiveInventoryItem({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();

  const { data: row, error: fetchErr } = await svc
    .from('inventory_items')
    .select('workplace_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!row) return { ok: false, error: '품목을 찾을 수 없습니다.' };

  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(row.workplace_id)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_items').update({ archived: true }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function recordInventoryTransaction({ workplaceId, itemId, type, qtyDelta, note }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_transactions').insert({
    item_id: itemId,
    workplace_id: workplaceId,
    user_id: user.id,
    type,
    qty_delta: qtyDelta,
    note: note?.trim() || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

'use server';

import { getServiceClient, getActor, friendlyDbError } from '@/lib/server/guard';

// 결재 위임 등록 — delegator는 항상 현재 사용자.
export async function createDelegation({ delegateId, workplaceId, startAt, endAt, reason }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!delegateId) return { ok: false, error: '피위임자를 선택해주세요.' };
  const svc = getServiceClient();
  const { error } = await svc.from('approval_delegations').insert({
    delegator_id: user.id,
    delegate_id: delegateId,
    workplace_id: workplaceId,
    start_at: startAt,
    end_at: endAt || null,
    reason: reason || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

// 위임 비활성화 — 본인 소유(delegator) 건만.
export async function deactivateDelegation({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { data: row, error: fetchErr } = await svc
    .from('approval_delegations')
    .select('delegator_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!row || row.delegator_id !== user.id) return { ok: false, error: '권한이 없습니다.' };
  const { error } = await svc.from('approval_delegations').update({ active: false }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

// 위임 삭제 — 본인 소유(delegator) 건만.
export async function deleteDelegation({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { data: row, error: fetchErr } = await svc
    .from('approval_delegations')
    .select('delegator_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!row || row.delegator_id !== user.id) return { ok: false, error: '권한이 없습니다.' };
  const { error } = await svc.from('approval_delegations').delete().eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

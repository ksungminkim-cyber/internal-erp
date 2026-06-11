'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

/** 레시피 저장 — 신규 insert / 편집 update. 해당 매장 멤버 권한 확인. */
export async function saveRecipe({ id, workplaceId, payload }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const wpId = workplaceId || null;
  const isNew = !id;

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(wpId)) return { ok: false, error: '권한이 없습니다.' };

  const row = {
    workplace_id: wpId,
    name: (payload?.name || '').trim(),
    category: payload?.category ?? null,
    serving_size: payload?.serving_size ?? null,
    cost: payload?.cost ?? null,
    sell_price: payload?.sell_price ?? null,
    notes: payload?.notes ?? null,
    ingredients: payload?.ingredients ?? [],
    steps: payload?.steps ?? [],
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  if (isNew) {
    const { data, error } = await svc.from('recipes').insert({ ...row, created_by: user.id }).select('id').single();
    if (error) return { ok: false, error: friendlyDbError(error) };
    return { ok: true, id: data.id };
  }

  const { error } = await svc.from('recipes').update(row).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true, id };
}

/** 레시피 보관 처리 — 레시피의 사업장 기준 멤버 권한 확인 후 active=false. */
export async function archiveRecipe({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);

  const { data: recipe, error: fetchErr } = await svc.from('recipes').select('workplace_id').eq('id', id).maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!recipe) return { ok: false, error: '레시피를 찾을 수 없습니다.' };
  if (!perms.isMemberOf(recipe.workplace_id || null)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('recipes').update({ active: false }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

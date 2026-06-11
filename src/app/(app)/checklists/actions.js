'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

/**
 * 체크리스트 완료 저장 (upsert) — 서비스 롤
 */
export async function saveChecklistCompletion({ workplaceId, templateId, completionDate, items, completedCount, totalCount }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('checklist_completions').upsert({
    template_id: templateId,
    workplace_id: workplaceId,
    completion_date: completionDate,
    items,
    completed_count: completedCount,
    total_count: totalCount,
    last_updated_by: user.id,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'template_id,completion_date' });

  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

/**
 * 체크리스트 템플릿 저장 (신규/편집) — 서비스 롤
 * 편집: 템플릿 업데이트 → 기존 항목 삭제 → 항목 재삽입
 * 신규: 템플릿 삽입(id 반환) → 항목 삽입
 */
export async function saveChecklistTemplate({ workplaceId, templateId, meta, items }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  let id = templateId;
  if (templateId) {
    const { error } = await svc.from('checklist_templates').update(meta).eq('id', templateId);
    if (error) return { ok: false, error: friendlyDbError(error) };
    const { error: eDel } = await svc.from('checklist_items').delete().eq('template_id', templateId);
    if (eDel) return { ok: false, error: friendlyDbError(eDel) };
  } else {
    const { data, error } = await svc
      .from('checklist_templates')
      .insert({ workplace_id: workplaceId, ...meta })
      .select('id')
      .single();
    if (error) return { ok: false, error: friendlyDbError(error) };
    id = data.id;
  }

  const { error: eItems } = await svc.from('checklist_items').insert(
    (items ?? []).map((it) => ({
      template_id: id,
      text: it.text,
      order_idx: it.order_idx,
      required: it.required ?? true,
    }))
  );
  if (eItems) return { ok: false, error: friendlyDbError(eItems) };

  return { ok: true, templateId: id };
}

/**
 * 체크리스트 템플릿 삭제 (active=false) — 서비스 롤
 */
export async function deleteChecklistTemplate({ templateId }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const { data: tpl } = await svc
    .from('checklist_templates')
    .select('workplace_id')
    .eq('id', templateId)
    .maybeSingle();
  if (!tpl) return { ok: false, error: '체크리스트를 찾을 수 없습니다.' };

  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(tpl.workplace_id)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('checklist_templates').update({ active: false }).eq('id', templateId);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

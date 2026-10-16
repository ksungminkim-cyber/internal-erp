'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { kstDateKey } from '@/lib/date';
import { loadActorPerms } from '@/lib/server/guard';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * 인수인계 노트 조회 — 서비스 롤로 본문 + 작성자 이름 매핑 (RLS 우회)
 */
export async function getHandoverNotes(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId) return [];

  const svc = getServiceClient();
  const { data: notes } = await svc
    .from('handover_notes')
    .select('id, workplace_id, author_id, shift_type, note_date, content, flags, resolved, resolved_by, resolved_at, created_at')
    .eq('workplace_id', workplaceId)
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50);

  const authorIds = [...new Set((notes ?? []).map((n) => n.author_id).filter(Boolean))];
  let authorMap = new Map();
  if (authorIds.length > 0) {
    const { data: profs } = await svc.from('profiles').select('user_id, name').in('user_id', authorIds);
    authorMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
  }

  return (notes ?? []).map((n) => ({
    ...n,
    author: { name: authorMap.get(n.author_id) ?? null },
  }));
}

/**
 * 인수인계 확인 처리 토글 (서비스 롤)
 */
export async function toggleHandoverResolved(noteId, resolved) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const { error } = await svc
    .from('handover_notes')
    .update({
      resolved,
      resolved_by: resolved ? user.id : null,
      resolved_at: resolved ? new Date().toISOString() : null,
    })
    .eq('id', noteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// 수정·삭제 권한: 작성자 본인 또는 해당 매장 매니저 이상 (RLS update 정책과 동일 기준)
async function loadEditableNote(svc, userId, noteId) {
  const { data: note } = await svc.from('handover_notes').select('id, workplace_id, author_id').eq('id', noteId).maybeSingle();
  if (!note) return { error: '노트를 찾을 수 없어요.' };
  if (note.author_id !== userId) {
    const perms = await loadActorPerms(svc, userId);
    if (!perms.isManagerOf(note.workplace_id)) return { error: '작성자 또는 매니저만 수정·삭제할 수 있어요.' };
  }
  return { note };
}

/**
 * 인수인계 노트 수정 (서비스 롤) — 시프트·내용·플래그만 바꾸고 날짜는 유지
 */
export async function updateHandoverNote({ noteId, shiftType, content, flags }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!content?.trim()) return { ok: false, error: '내용을 입력해주세요.' };

  const svc = getServiceClient();
  const chk = await loadEditableNote(svc, user.id, noteId);
  if (chk.error) return { ok: false, error: chk.error };

  const { error } = await svc
    .from('handover_notes')
    .update({ shift_type: shiftType, content: content.trim(), flags: flags ?? [] })
    .eq('id', noteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 인수인계 노트 삭제 (서비스 롤)
 */
export async function deleteHandoverNote(noteId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const svc = getServiceClient();
  const chk = await loadEditableNote(svc, user.id, noteId);
  if (chk.error) return { ok: false, error: chk.error };

  const { error } = await svc.from('handover_notes').delete().eq('id', noteId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 인수인계 노트 작성 (서비스 롤)
 */
export async function createHandoverNote({ workplaceId, shiftType, content, flags }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!content?.trim()) return { ok: false, error: '내용을 입력해주세요.' };

  const svc = getServiceClient();
  const { error } = await svc.from('handover_notes').insert({
    workplace_id: workplaceId,
    author_id: user.id,
    shift_type: shiftType,
    note_date: kstDateKey(),
    content: content.trim(),
    flags: flags ?? [],
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

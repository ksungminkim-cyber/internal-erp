'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { formatRelative } from '@/lib/format';
import { safeMutate } from '@/lib/safeMutate';
import { Plus, Pin, Megaphone, X, MoreVertical, Edit3, Trash2 } from 'lucide-react';

export default function AnnouncementsPage() {
  const { user, currentWorkplaceId, supabase, isManager } = useApp();
  const [items, setItems] = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !user) return;
    // profile JOIN 없이 본문만 (RLS 충돌 회피) + 별도 조회로 author 매핑
    const [{ data: anns }, { data: reads }] = await Promise.all([
      supabase
        .from('announcements')
        .select('id, title, body, pinned, created_at, updated_at, author_id')
        .eq('workplace_id', currentWorkplaceId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id),
    ]);
    const authorIds = [...new Set((anns ?? []).map((a) => a.author_id).filter(Boolean))];
    let authorMap = new Map();
    if (authorIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('user_id, name').in('user_id', authorIds);
      authorMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
    }
    setItems((anns ?? []).map((a) => ({ ...a, author: { name: authorMap.get(a.author_id) ?? null } })));
    setReadIds(new Set((reads ?? []).map((r) => r.announcement_id)));
    setLoading(false);
  }, [supabase, currentWorkplaceId, user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`announcements:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'announcements', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  useEffect(() => {
    function onDocClick() { setMenuOpenId(null); }
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, []);

  async function markRead(id) {
    if (readIds.has(id)) return;
    setReadIds((prev) => new Set([...prev, id]));
    await supabase.from('announcement_reads').insert({ announcement_id: id, user_id: user.id });
  }

  async function deleteAnnouncement(id) {
    if (!confirm('이 공지를 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) alert(error.message);
    else load();
  }

  function canEdit(item) {
    return isManager || item.author_id === user?.id;
  }

  return (
    <>
      <PageHeader title="공지사항" subtitle="모든 직원이 함께 보는 공지" />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading ? (
          <div className="stack stack-3">
            <div className="skeleton" style={{ height: 100 }} />
            <div className="skeleton" style={{ height: 100 }} />
          </div>
        ) : items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon"><Megaphone size={26} /></div>
              <div className="empty-title">공지가 없어요</div>
              <div className="empty-desc">
                {isManager ? '+ 버튼으로 첫 공지를 작성해보세요' : '관리자가 작성한 공지가 여기 표시됩니다'}
              </div>
            </div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {items.map((a) => {
              const read = readIds.has(a.id);
              const editable = canEdit(a);
              return (
                <article
                  key={a.id}
                  className="card"
                  onClick={() => markRead(a.id)}
                  style={{
                    cursor: 'pointer',
                    border: !read ? '1.5px solid var(--accent-soft-2)' : '1.5px solid transparent',
                    background: a.pinned ? 'linear-gradient(180deg, var(--accent-soft) 0%, var(--surface) 60%)' : undefined,
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Avatar name={a.author?.name} userId={a.author_id} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="h4" style={{ fontSize: 13 }}>{a.author?.name || '—'}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        {formatRelative(a.created_at)}
                        {a.updated_at && a.updated_at !== a.created_at && ' · 수정됨'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {a.pinned && <span className="tag tag-accent"><Pin size={10} /> 고정</span>}
                      {!read && <span className="tag tag-danger" style={{ fontSize: 10 }}>NEW</span>}
                      {editable && (
                        <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            style={{ minHeight: 32, padding: 6 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(menuOpenId === a.id ? null : a.id);
                            }}
                            aria-label="메뉴"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {menuOpenId === a.id && (
                            <div
                              style={{
                                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: 12, padding: 4,
                                boxShadow: 'var(--sh-md)',
                                minWidth: 130,
                                zIndex: 30,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => { setMenuOpenId(null); setEditing(a); }}
                                style={{
                                  width: '100%', padding: '10px 12px',
                                  border: 'none', background: 'transparent', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  fontSize: 13, fontWeight: 600, textAlign: 'left',
                                  borderRadius: 8,
                                }}
                              >
                                <Edit3 size={14} /> 수정
                              </button>
                              <button
                                type="button"
                                onClick={() => { setMenuOpenId(null); deleteAnnouncement(a.id); }}
                                style={{
                                  width: '100%', padding: '10px 12px',
                                  border: 'none', background: 'transparent', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  fontSize: 13, fontWeight: 600, textAlign: 'left',
                                  borderRadius: 8,
                                  color: 'var(--danger)',
                                }}
                              >
                                <Trash2 size={14} /> 삭제
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <h3 className="h3">{a.title}</h3>
                  <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {a.body}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {isManager && (
        <button type="button" className="fab" onClick={() => setEditing({})} aria-label="새 공지">
          <Plus size={26} />
        </button>
      )}

      {editing && (
        <AnnouncementEditor
          item={editing}
          supabase={supabase}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function AnnouncementEditor({ item, supabase, userId, workplaceId, onClose, onSaved }) {
  const isEdit = !!item?.id;
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [pinned, setPinned] = useState(item?.pinned ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!title.trim() || !body.trim()) return setError('제목과 내용을 모두 입력해주세요.');
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        pinned,
        updated_at: new Date().toISOString(),
      };
      const op = isEdit
        ? supabase.from('announcements').update(payload).eq('id', item.id)
        : supabase.from('announcements').insert({
            ...payload,
            workplace_id: workplaceId,
            author_id: userId,
          });
      const { error } = await safeMutate(op);
      if (error) { setError(error.message); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">{isEdit ? '공지 수정' : '새 공지'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">제목</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" required />

      <label className="label" style={{ marginTop: 12 }}>내용</label>
      <textarea
        className="input"
        rows={6}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="공지 내용"
        style={{ resize: 'vertical' }}
      />

      <label
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 14, padding: '10px 12px',
          background: pinned ? 'var(--accent-soft)' : 'var(--surface-soft)',
          borderRadius: 10, cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
          color: pinned ? 'var(--accent-strong)' : 'var(--text-secondary)',
          transition: 'all var(--t-sm) var(--ease)',
        }}
      >
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
        <Pin size={14} /> 상단에 고정
      </label>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : isEdit ? '저장' : '게시'}
        </button>
      </div>
    </BottomSheet>
  );
}

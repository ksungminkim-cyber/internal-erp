'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatRelative } from '@/lib/format';
import { Plus, Pin, Megaphone, X } from 'lucide-react';

export default function AnnouncementsPage() {
  const { user, currentWorkplaceId, supabase, isManager } = useApp();
  const [items, setItems] = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !user) return;
    setLoading(true);
    const [{ data: anns }, { data: reads }] = await Promise.all([
      supabase
        .from('announcements')
        .select('id, title, body, pinned, created_at, author_id, author:profiles!announcements_author_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id),
    ]);
    setItems(anns ?? []);
    setReadIds(new Set((reads ?? []).map((r) => r.announcement_id)));
    setLoading(false);
  }, [supabase, currentWorkplaceId, user]);

  useEffect(() => { load(); }, [load]);

  async function markRead(id) {
    if (readIds.has(id)) return;
    setReadIds((prev) => new Set([...prev, id]));
    await supabase.from('announcement_reads').insert({ announcement_id: id, user_id: user.id });
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) return setError('제목과 내용을 모두 입력해주세요.');
    const { error } = await supabase.from('announcements').insert({
      workplace_id: currentWorkplaceId, author_id: user.id,
      title: title.trim(), body: body.trim(), pinned,
    });
    if (error) return setError(error.message);
    setTitle(''); setBody(''); setPinned(false);
    setComposing(false);
    load();
  }

  return (
    <>
      <PageHeader title="공지사항" subtitle="모든 직원이 함께 보는 공지" />

      <main className="fade-in" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {composing && (
          <form onSubmit={submit} className="card pop-in" style={{ border: '1.5px solid var(--accent)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 className="h3">새 공지 작성</h2>
              <button type="button" onClick={() => setComposing(false)} className="btn btn-ghost btn-icon">
                <X size={16} />
              </button>
            </div>

            <label className="label">제목</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" required />

            <label className="label" style={{ marginTop: 12 }}>내용</label>
            <textarea
              className="input"
              rows={5}
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

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-outline" onClick={() => setComposing(false)} style={{ flex: 1 }}>취소</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 2 }}>게시하기</button>
            </div>
          </form>
        )}

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
              return (
                <article
                  key={a.id}
                  className="card"
                  onClick={() => markRead(a.id)}
                  style={{
                    cursor: 'pointer',
                    border: !read ? '1.5px solid var(--accent-soft-2)' : '1.5px solid transparent',
                    background: a.pinned ? 'linear-gradient(180deg, var(--accent-soft) 0%, var(--surface) 60%)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Avatar name={a.author?.name} userId={a.author_id} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="h4" style={{ fontSize: 13 }}>{a.author?.name || '—'}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{formatRelative(a.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {a.pinned && <span className="tag tag-accent"><Pin size={10} /> 고정</span>}
                      {!read && <span className="tag tag-danger" style={{ fontSize: 10 }}>NEW</span>}
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

      {isManager && !composing && (
        <button type="button" className="fab" onClick={() => setComposing(true)} aria-label="새 공지">
          <Plus size={26} />
        </button>
      )}
    </>
  );
}

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { formatRelative } from '@/lib/format';
import {
  ChevronLeft, Plus, X, MessageSquare, Lock, EyeOff, Send, CheckCircle2, Clock, XCircle,
} from 'lucide-react';

const CATEGORY_META = {
  general:     { label: '일반' },
  environment: { label: '근무환경' },
  process:     { label: '업무프로세스' },
  welfare:     { label: '복지' },
  other:       { label: '기타' },
};

const STATUS_META = {
  open:       { label: '접수',   tag: 'tag-warning', icon: Clock },
  reviewing:  { label: '검토중', tag: 'tag-accent',  icon: Clock },
  resolved:   { label: '해결',   tag: 'tag-success', icon: CheckCircle2 },
  declined:   { label: '미반영', tag: 'tag-danger',  icon: XCircle },
};

export default function SuggestionsPage() {
  const router = useRouter();
  const { user, profile, supabase } = useApp();
  const isHq = profile?.is_super_admin === true;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [responding, setResponding] = useState(null);
  const [filter, setFilter] = useState(isHq ? 'open' : 'mine');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('suggestions')
      .select('*, author:profiles!suggestions_user_id_fkey(name)')
      .order('created_at', { ascending: false })
      .limit(100);
    setItems(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'mine'
    ? items.filter((i) => i.user_id === user?.id)
    : filter === 'open'
    ? items.filter((i) => i.status !== 'resolved' && i.status !== 'declined')
    : items;

  return (
    <>
      <PageHeader
        title="건의함"
        subtitle={isHq ? '직원이 보낸 건의를 검토/응답' : '본사로 건의를 보낼 수 있어요'}
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="segment" style={{ alignSelf: 'flex-start' }}>
          {isHq && <button className={`segment-item ${filter === 'open' ? 'is-active' : ''}`} onClick={() => setFilter('open')}>처리 필요</button>}
          <button className={`segment-item ${filter === 'mine' ? 'is-active' : ''}`} onClick={() => setFilter('mine')}>내 건의</button>
          <button className={`segment-item ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>전체</button>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : filtered.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><MessageSquare size={26} /></div>
            <div className="empty-title">
              {filter === 'mine' ? '보낸 건의가 없어요' : filter === 'open' ? '처리할 건의가 없어요' : '아직 건의가 없어요'}
            </div>
            <div className="empty-desc">+ 버튼으로 첫 건의를 보내보세요</div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {filtered.map((s) => {
              const sm = STATUS_META[s.status];
              const StatusIcon = sm.icon;
              const isMine = s.user_id === user?.id;
              const showAuthor = !s.anonymous || isMine || isHq;
              return (
                <article key={s.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    {showAuthor ? (
                      <>
                        <Avatar name={s.author?.name} userId={s.user_id} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="h4" style={{ fontSize: 13 }}>
                            {s.author?.name || '—'}
                            {s.anonymous && <EyeOff size={11} style={{ marginLeft: 6, display: 'inline', color: 'var(--text-muted)' }} />}
                          </div>
                          <div className="text-muted" style={{ fontSize: 11 }}>{formatRelative(s.created_at)}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="avatar" style={{ background: 'var(--surface-strong)', color: 'var(--text-muted)' }}>
                          <EyeOff size={14} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className="h4" style={{ fontSize: 13, color: 'var(--text-muted)' }}>익명</div>
                          <div className="text-muted" style={{ fontSize: 11 }}>{formatRelative(s.created_at)}</div>
                        </div>
                      </>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span className={`tag ${sm.tag} dot`}><StatusIcon size={10} /> {sm.label}</span>
                      <span className="tag" style={{ fontSize: 10 }}>{CATEGORY_META[s.category]?.label}</span>
                    </div>
                  </div>

                  <h3 className="h3">{s.title}</h3>
                  <p style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                    {s.body}
                  </p>

                  {s.response && (
                    <div style={{ marginTop: 12, padding: 12, background: 'var(--accent-soft)', borderRadius: 12, fontSize: 13 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-strong)', letterSpacing: 0.04, textTransform: 'uppercase', marginBottom: 4 }}>
                        💬 본사 응답
                      </div>
                      <p style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{s.response}</p>
                    </div>
                  )}

                  {isHq && (s.status === 'open' || s.status === 'reviewing' || !s.response) && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                      <button type="button" className="btn btn-soft btn-sm" onClick={() => setResponding(s)}>
                        응답
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      <button type="button" className="fab" onClick={() => setComposing(true)} aria-label="새 건의">
        <Plus size={26} />
      </button>

      {composing && (
        <SuggestionComposer
          supabase={supabase}
          userId={user.id}
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load(); }}
        />
      )}

      {responding && (
        <ResponseDialog
          suggestion={responding}
          supabase={supabase}
          userId={user.id}
          onClose={() => setResponding(null)}
          onSaved={() => { setResponding(null); load(); }}
        />
      )}
    </>
  );
}

function SuggestionComposer({ supabase, userId, onClose, onSaved }) {
  const { currentWorkplaceId } = useApp();
  const [category, setCategory] = useState('general');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!title.trim() || !body.trim()) return setError('제목과 내용을 모두 입력해주세요.');
    setSaving(true);
    const { error } = await supabase.from('suggestions').insert({
      user_id: userId,
      workplace_id: currentWorkplaceId || null,
      category,
      title: title.trim(),
      body: body.trim(),
      anonymous,
    });
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">건의 보내기</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">카테고리</label>
      <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
        {Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
      </select>

      <label className="label" style={{ marginTop: 12 }}>제목</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="짧고 명확하게" />

      <label className="label" style={{ marginTop: 12 }}>내용</label>
      <textarea
        className="input" rows={6} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="어떤 점이 불편하신가요? 어떤 개선이 필요한가요?"
        style={{ resize: 'vertical' }}
      />

      <label
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          marginTop: 14, padding: 12, borderRadius: 12,
          background: anonymous ? 'var(--surface-strong)' : 'var(--surface-soft)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 18, height: 18 }}
        />
        <div style={{ flex: 1 }}>
          <div className="h4" style={{ fontSize: 13 }}><EyeOff size={12} style={{ display: 'inline', marginRight: 6 }} />익명으로 보내기</div>
          <p className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
            본사만 작성자를 볼 수 있어요. 다른 직원에겐 익명으로 표시됩니다.
          </p>
        </div>
      </label>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          <Send size={14} /> {saving ? '전송 중...' : '보내기'}
        </button>
      </div>
    </BottomSheet>
  );
}

function ResponseDialog({ suggestion, supabase, userId, onClose, onSaved }) {
  const [status, setStatus] = useState(suggestion.status === 'open' ? 'reviewing' : suggestion.status);
  const [response, setResponse] = useState(suggestion.response ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from('suggestions')
      .update({
        status,
        response: response.trim() || null,
        responded_by: userId,
        responded_at: response.trim() ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', suggestion.id);
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 className="h3">건의 응답</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
        <strong style={{ color: 'var(--text)' }}>{suggestion.title}</strong>
      </div>

      <label className="label">상태</label>
      <div className="segment" style={{ width: '100%' }}>
        {Object.entries(STATUS_META).map(([k, m]) => (
          <button
            key={k} type="button"
            className={`segment-item ${status === k ? 'is-active' : ''}`}
            onClick={() => setStatus(k)}
            style={{ flex: 1, fontSize: 12 }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>응답 내용</label>
      <textarea
        className="input" rows={5} value={response} onChange={(e) => setResponse(e.target.value)}
        placeholder="검토 결과 또는 답변을 적어주세요" style={{ resize: 'vertical' }}
      />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </BottomSheet>
  );
}

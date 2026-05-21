'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { formatRelative } from '@/lib/format';
import { Plus, ChevronLeft, X, AlertTriangle, CheckCircle2, Package, Wrench, Users, Coins, Sparkles, ClipboardCheck } from 'lucide-react';

const SHIFT_LABEL = { open: '오픈', mid: '미들', close: '마감' };
const SHIFT_TAG   = { open: 'tag-mint', mid: 'tag-accent', close: 'tag-violet' };

const FLAG_META = {
  stock_low:        { label: '재고 부족',   icon: Package,     tag: 'tag-warning' },
  equipment_issue:  { label: '장비 이슈',   icon: Wrench,      tag: 'tag-danger'  },
  customer:         { label: '고객 이슈',   icon: Users,       tag: 'tag-warning' },
  cash:             { label: '시재/매출',   icon: Coins,       tag: 'tag-accent'  },
  cleaning:         { label: '청소/위생',   icon: Sparkles,    tag: 'tag-mint'    },
};

export default function HandoverPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    setLoading(true);
    const { data } = await supabase
      .from('handover_notes')
      .select('*, author:profiles!handover_notes_author_id_fkey(name)')
      .eq('workplace_id', currentWorkplaceId)
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    setItems(data ?? []);
    setLoading(false);
  }, [supabase, currentWorkplaceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`handover:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'handover_notes', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  async function toggleResolved(note) {
    const next = !note.resolved;
    await supabase
      .from('handover_notes')
      .update({
        resolved: next,
        resolved_by: next ? user.id : null,
        resolved_at: next ? new Date().toISOString() : null,
      })
      .eq('id', note.id);
  }

  const filtered = filter === 'unresolved' ? items.filter((i) => !i.resolved) : items;

  return (
    <>
      <PageHeader
        title="인수인계"
        subtitle="교대 시 다음 근무자에게 전달"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="segment">
          <button className={`segment-item ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>전체</button>
          <button className={`segment-item ${filter === 'unresolved' ? 'is-active' : ''}`} onClick={() => setFilter('unresolved')}>
            미확인 {items.filter((i) => !i.resolved).length > 0 && `(${items.filter((i) => !i.resolved).length})`}
          </button>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : filtered.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><ClipboardCheck size={26} /></div>
            <div className="empty-title">{filter === 'unresolved' ? '미확인 항목 없음' : '인수인계 노트 없음'}</div>
            <div className="empty-desc">+ 버튼으로 첫 노트를 남겨보세요</div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {filtered.map((n) => (
              <HandoverCard key={n.id} note={n} onToggle={() => toggleResolved(n)} canManage={user?.id === n.author_id} />
            ))}
          </div>
        )}
      </main>

      <button type="button" className="fab" onClick={() => setComposing(true)} aria-label="새 인수인계">
        <Plus size={26} />
      </button>

      {composing && (
        <HandoverComposer
          supabase={supabase}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load(); }}
        />
      )}
    </>
  );
}

function HandoverCard({ note, onToggle, canManage }) {
  return (
    <article
      className="card"
      style={{
        opacity: note.resolved ? 0.7 : 1,
        borderLeft: !note.resolved && note.flags?.length ? '3px solid var(--warning)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Avatar name={note.author?.name} userId={note.author_id} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="h4" style={{ fontSize: 13 }}>{note.author?.name || '—'}</div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {note.note_date} · {formatRelative(note.created_at)}
          </div>
        </div>
        <span className={`tag ${SHIFT_TAG[note.shift_type]}`}>
          {SHIFT_LABEL[note.shift_type]}
        </span>
      </div>

      <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
        {note.content}
      </p>

      {note.flags?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {note.flags.map((f) => {
            const m = FLAG_META[f];
            if (!m) return null;
            const FlagIcon = m.icon;
            return (
              <span key={f} className={`tag ${m.tag}`}>
                <FlagIcon size={11} /> {m.label}
              </span>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          className={`btn ${note.resolved ? 'btn-outline' : 'btn-success'} btn-sm`}
          onClick={onToggle}
        >
          <CheckCircle2 size={14} />
          {note.resolved ? '확인 취소' : '확인 완료'}
        </button>
      </div>
    </article>
  );
}

function HandoverComposer({ supabase, userId, workplaceId, onClose, onSaved }) {
  const [shiftType, setShiftType] = useState('close');
  const [content, setContent] = useState('');
  const [flags, setFlags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggleFlag(f) {
    setFlags((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  async function save() {
    setError(null);
    if (!content.trim()) return setError('내용을 입력해주세요.');
    setSaving(true);
    const { error } = await supabase.from('handover_notes').insert({
      workplace_id: workplaceId,
      author_id: userId,
      shift_type: shiftType,
      note_date: new Date().toISOString().slice(0, 10),
      content: content.trim(),
      flags,
    });
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">새 인수인계</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">시프트</label>
      <div className="segment" style={{ width: '100%' }}>
        {['open', 'mid', 'close'].map((t) => (
          <button
            key={t}
            type="button"
            className={`segment-item ${shiftType === t ? 'is-active' : ''}`}
            onClick={() => setShiftType(t)}
            style={{ flex: 1 }}
          >
            {SHIFT_LABEL[t]}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 16 }}>전달 내용</label>
      <textarea
        className="input"
        rows={5}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="다음 근무자에게 전달할 내용을 적어주세요"
        style={{ resize: 'vertical' }}
      />

      <label className="label" style={{ marginTop: 16 }}>플래그 (선택)</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(FLAG_META).map(([k, m]) => {
          const FlagIcon = m.icon;
          const active = flags.includes(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleFlag(k)}
              className={`tag ${active ? m.tag : ''} lg`}
              style={{ cursor: 'pointer', border: active ? '1px solid currentColor' : '1px dashed var(--border-strong)' }}
            >
              <FlagIcon size={12} /> {m.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '게시'}
        </button>
      </div>
    </BottomSheet>
  );
}

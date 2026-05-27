'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  ChevronLeft, Plus, X, MessageCircle, Phone, MessageSquare, Star,
  Users as UsersIcon, AlertCircle, CheckCircle2, Clock,
} from 'lucide-react';

const CHANNEL_META = {
  in_person: { label: '직접 방문', icon: UsersIcon },
  phone:     { label: '전화',     icon: Phone },
  kakao:     { label: '카카오톡', icon: MessageSquare },
  review:    { label: '리뷰',     icon: Star },
  sns:       { label: 'SNS',     icon: MessageSquare },
  other:     { label: '기타',     icon: MessageCircle },
};

const CATEGORY_META = {
  taste:   { label: '맛/품질' },
  service: { label: '서비스/응대' },
  hygiene: { label: '위생/청결' },
  billing: { label: '결제/금액' },
  wait:    { label: '대기시간' },
  other:   { label: '기타' },
};

const SEVERITY_META = {
  low:    { label: '낮음',   tag: 'tag' },
  medium: { label: '보통',   tag: 'tag-warning' },
  high:   { label: '심각',   tag: 'tag-danger' },
};

const STATUS_META = {
  open:        { label: '접수',     tag: 'tag-danger',  icon: AlertCircle },
  in_progress: { label: '처리 중',  tag: 'tag-warning', icon: Clock },
  resolved:    { label: '해결',     tag: 'tag-success', icon: CheckCircle2 },
};

export default function ComplaintsPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('open');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    setLoading(true);
    const { data } = await supabase
      .from('customer_complaints')
      .select('*, reporter:profiles!customer_complaints_reporter_id_fkey(name)')
      .eq('workplace_id', currentWorkplaceId)
      .order('occurred_at', { ascending: false })
      .limit(100);
    setItems(data ?? []);
    setLoading(false);
  }, [supabase, currentWorkplaceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`complaints:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'customer_complaints', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'open') return items.filter((i) => i.status !== 'resolved');
    return items.filter((i) => i.status === 'resolved');
  }, [items, filter]);

  const openCount = items.filter((i) => i.status !== 'resolved').length;

  return (
    <>
      <PageHeader
        title="고객 클레임"
        subtitle="고객 불만/요청 기록"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="segment">
          <button className={`segment-item ${filter === 'open' ? 'is-active' : ''}`} onClick={() => setFilter('open')}>
            진행 중 {openCount > 0 && `(${openCount})`}
          </button>
          <button className={`segment-item ${filter === 'resolved' ? 'is-active' : ''}`} onClick={() => setFilter('resolved')}>
            해결
          </button>
          <button className={`segment-item ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>
            전체
          </button>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : filtered.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><MessageCircle size={26} /></div>
            <div className="empty-title">
              {filter === 'open' ? '진행 중 클레임 없음' : filter === 'resolved' ? '해결된 기록 없음' : '기록 없음'}
            </div>
            <div className="empty-desc">+ 버튼으로 클레임을 기록해보세요</div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {filtered.map((c) => {
              const cm = CHANNEL_META[c.channel] || CHANNEL_META.other;
              const ChannelIcon = cm.icon;
              const sm = STATUS_META[c.status] || STATUS_META.open;
              const StatusIcon = sm.icon;
              const sev = SEVERITY_META[c.severity];
              return (
                <article
                  key={c.id}
                  className="card interactive"
                  onClick={() => setEditing(c)}
                  style={{
                    borderLeft: c.severity === 'high' && c.status !== 'resolved'
                      ? '3px solid var(--danger)'
                      : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Avatar name={c.reporter?.name} userId={c.reporter_id} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {c.reporter?.name || '—'} · {formatRelative(c.occurred_at)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 11, color: 'var(--text-muted)' }}>
                        <ChannelIcon size={11} /> {cm.label}
                        {c.customer_label && <span>· {c.customer_label}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      <span className={`tag ${sm.tag} dot`}>
                        <StatusIcon size={10} /> {sm.label}
                      </span>
                      <span className={`tag ${sev.tag}`}>{sev.label}</span>
                    </div>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <span className="tag">{CATEGORY_META[c.category]?.label}</span>
                  </div>

                  <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                    {c.summary}
                  </p>

                  {c.resolution && (
                    <div style={{ marginTop: 10, padding: 10, background: 'var(--success-soft)', borderRadius: 10, fontSize: 13 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#00876c', letterSpacing: 0.04, textTransform: 'uppercase', marginBottom: 4 }}>
                        ✓ 처리 결과
                      </div>
                      <p style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{c.resolution}</p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      <button type="button" className="fab" onClick={() => setEditing({})} aria-label="새 클레임">
        <Plus size={26} />
      </button>

      {editing && (
        <ComplaintEditor
          complaint={editing}
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

function ComplaintEditor({ complaint, supabase, userId, workplaceId, onClose, onSaved }) {
  const isEdit = !!complaint?.id;
  const [channel, setChannel] = useState(complaint?.channel ?? 'in_person');
  const [category, setCategory] = useState(complaint?.category ?? 'service');
  const [severity, setSeverity] = useState(complaint?.severity ?? 'medium');
  const [customerLabel, setCustomerLabel] = useState(complaint?.customer_label ?? '');
  const [customerContact, setCustomerContact] = useState(complaint?.customer_contact ?? '');
  const [summary, setSummary] = useState(complaint?.summary ?? '');
  const [status, setStatus] = useState(complaint?.status ?? 'open');
  const [resolution, setResolution] = useState(complaint?.resolution ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!summary.trim()) return setError('내용을 입력해주세요.');
    setSaving(true);
    const payload = {
      workplace_id: workplaceId,
      reporter_id: isEdit ? complaint.reporter_id : userId,
      channel, category, severity,
      customer_label: customerLabel.trim() || null,
      customer_contact: customerContact.trim() || null,
      summary: summary.trim(),
      status,
      resolution: resolution.trim() || null,
      resolved_at: status === 'resolved' ? (complaint?.resolved_at || new Date().toISOString()) : null,
      resolved_by: status === 'resolved' ? userId : null,
      updated_at: new Date().toISOString(),
    };
    const op = isEdit
      ? supabase.from('customer_complaints').update(payload).eq('id', complaint.id)
      : supabase.from('customer_complaints').insert(payload);
    const { error } = await op;
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose} maxWidth={520}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">{isEdit ? '클레임 편집' : '새 클레임'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">접수 채널</label>
      <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
        {Object.entries(CHANNEL_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">카테고리</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">심각도</label>
          <div className="segment" style={{ width: '100%' }}>
            {['low', 'medium', 'high'].map((s) => (
              <button
                key={s}
                type="button"
                className={`segment-item ${severity === s ? 'is-active' : ''}`}
                onClick={() => setSeverity(s)}
                style={{ flex: 1, fontSize: 12 }}
              >
                {SEVERITY_META[s].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>고객 표시 (선택)</label>
      <input className="input" value={customerLabel} onChange={(e) => setCustomerLabel(e.target.value)} placeholder="예) 여성 30대, 단골 김씨 (개인정보 최소화)" />

      <label className="label" style={{ marginTop: 12 }}>연락처 (선택)</label>
      <input className="input" type="tel" value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} placeholder="010-0000-0000" />

      <label className="label" style={{ marginTop: 12 }}>내용</label>
      <textarea
        className="input"
        rows={4}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="발생한 일과 고객의 요청을 적어주세요"
        style={{ resize: 'vertical' }}
      />

      <label className="label" style={{ marginTop: 12 }}>처리 상태</label>
      <div className="segment" style={{ width: '100%' }}>
        {Object.entries(STATUS_META).map(([k, m]) => (
          <button
            key={k}
            type="button"
            className={`segment-item ${status === k ? 'is-active' : ''}`}
            onClick={() => setStatus(k)}
            style={{ flex: 1, fontSize: 12 }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>처리 결과 (선택)</label>
      <textarea
        className="input"
        rows={3}
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        placeholder="어떻게 처리했는지, 사과/보상/재발 방지 등"
        style={{ resize: 'vertical' }}
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

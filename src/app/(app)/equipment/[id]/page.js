'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { formatDateTime, formatCurrency, formatRelative } from '@/lib/format';
import { ChevronLeft, Plus, X, Wrench, AlertTriangle, CheckCircle2, ScanLine, Sparkles } from 'lucide-react';

const LOG_TYPE_META = {
  check:       { label: '점검',   tag: 'tag-accent',  icon: ScanLine },
  maintenance: { label: '정비',   tag: 'tag-mint',    icon: Sparkles },
  issue:       { label: '이슈',   tag: 'tag-warning', icon: AlertTriangle },
  repair:      { label: '수리',   tag: 'tag-violet',  icon: Wrench },
  replace:     { label: '교체',   tag: 'tag',         icon: Wrench },
};

export default function EquipmentDetail({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, currentWorkplaceId, supabase } = useApp();
  const [equipment, setEquipment] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    const [{ data: eq }, { data: lg }] = await Promise.all([
      supabase.from('equipment').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('equipment_logs')
        .select('*, user:profiles!equipment_logs_user_id_fkey(name)')
        .eq('equipment_id', id)
        .order('performed_at', { ascending: false }),
    ]);
    setEquipment(eq);
    setLogs(lg ?? []);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <main className="section">
        <div className="skeleton" style={{ height: 200 }} />
      </main>
    );
  }
  if (!equipment) {
    return (
      <main className="section">
        <div className="card empty"><div className="empty-title">존재하지 않는 장비</div></div>
      </main>
    );
  }

  return (
    <>
      <PageHeader
        title={equipment.name}
        subtitle={equipment.category}
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card">
          <div className="stack stack-2" style={{ fontSize: 13 }}>
            {equipment.model && <Row label="모델" value={equipment.model} />}
            {equipment.serial_no && <Row label="시리얼" value={equipment.serial_no} />}
            {equipment.vendor && <Row label="거래처/AS" value={equipment.vendor} />}
            {equipment.purchased_at && <Row label="구입일" value={equipment.purchased_at} />}
            {equipment.warranty_until && <Row label="보증 만료" value={equipment.warranty_until} />}
            {equipment.next_check_at && <Row label="다음 점검" value={equipment.next_check_at} />}
            {equipment.notes && (
              <div style={{ marginTop: 8, padding: 10, background: 'var(--surface-soft)', borderRadius: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                {equipment.notes}
              </div>
            )}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <h2 className="h3">점검·수리 이력</h2>
            <span className="text-muted" style={{ fontSize: 12 }}>{logs.length}건</span>
          </div>

          {logs.length === 0 ? (
            <div className="card empty">
              <div className="empty-desc">아직 기록된 이력이 없어요</div>
            </div>
          ) : (
            <div className="stack stack-3 stagger">
              {logs.map((l) => {
                const meta = LOG_TYPE_META[l.log_type] || LOG_TYPE_META.check;
                const Icon = meta.icon;
                return (
                  <article key={l.id} className="card compact">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div
                        style={{
                          width: 32, height: 32, borderRadius: 10,
                          background: 'var(--surface-soft)', color: 'var(--text-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className={`tag ${meta.tag}`}>{meta.label}</span>
                          <span className="h4">{l.title}</span>
                        </div>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {l.user?.name || '—'} · {formatRelative(l.performed_at)}
                        </div>
                      </div>
                      {l.cost != null && Number(l.cost) > 0 && (
                        <span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>
                          {formatCurrency(l.cost)}원
                        </span>
                      )}
                    </div>
                    {l.description && (
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginTop: 6 }}>
                        {l.description}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <button type="button" className="fab" onClick={() => setComposing(true)} aria-label="이력 추가">
        <Plus size={26} />
      </button>

      {composing && (
        <LogComposer
          equipmentId={id}
          workplaceId={currentWorkplaceId}
          userId={user.id}
          supabase={supabase}
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load(); }}
        />
      )}
    </>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span className="text-muted">{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function LogComposer({ equipmentId, workplaceId, userId, supabase, onClose, onSaved }) {
  const [logType, setLogType] = useState('check');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [nextCheckAt, setNextCheckAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!title.trim()) return setError('제목을 입력해주세요.');
    setSaving(true);
    const { error } = await supabase.from('equipment_logs').insert({
      equipment_id: equipmentId,
      workplace_id: workplaceId,
      user_id: userId,
      log_type: logType,
      title: title.trim(),
      description: description.trim() || null,
      cost: Number(cost) || null,
      next_check_at: nextCheckAt || null,
    });
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">이력 추가</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">유형</label>
      <div className="segment" style={{ width: '100%' }}>
        {Object.entries(LOG_TYPE_META).map(([k, m]) => (
          <button
            key={k}
            type="button"
            className={`segment-item ${logType === k ? 'is-active' : ''}`}
            onClick={() => setLogType(k)}
            style={{ flex: 1, fontSize: 12 }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>제목</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 보일러 청소" />

      <label className="label" style={{ marginTop: 12 }}>상세 내용</label>
      <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} style={{ resize: 'vertical' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">비용 (원)</label>
          <input className="input num" type="number" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="label">다음 점검 예정일</label>
          <input className="input" type="date" value={nextCheckAt} onChange={(e) => setNextCheckAt(e.target.value)} />
        </div>
      </div>

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

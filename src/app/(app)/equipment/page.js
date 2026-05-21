'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { formatRelative } from '@/lib/format';
import { ChevronLeft, Plus, X, Wrench, AlertTriangle, CheckCircle2, Coffee, Snowflake, ScanLine, Trash2, ChevronRight } from 'lucide-react';

const STATUS_META = {
  ok:      { label: '정상',   tag: 'tag-success', icon: CheckCircle2 },
  warning: { label: '주의',   tag: 'tag-warning', icon: AlertTriangle },
  broken:  { label: '고장',   tag: 'tag-danger',  icon: AlertTriangle },
  retired: { label: '폐기',   tag: 'tag',         icon: X },
};

const CATEGORY_OPTIONS = ['에스프레소 머신', '그라인더', '냉장고/쇼케이스', '제빙기', '오븐', 'POS', '청소기', '기타'];

const CATEGORY_ICON = {
  '에스프레소 머신': Coffee,
  '그라인더': Coffee,
  '냉장고/쇼케이스': Snowflake,
  '제빙기': Snowflake,
  'POS': ScanLine,
};

function dateInDays(d) {
  if (!d) return null;
  const ms = new Date(d).getTime() - new Date().setHours(0,0,0,0);
  return Math.ceil(ms / 86400000);
}

export default function EquipmentPage() {
  const router = useRouter();
  const { currentWorkplaceId, supabase } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    setLoading(true);
    const { data } = await supabase
      .from('equipment')
      .select('*')
      .eq('workplace_id', currentWorkplaceId)
      .eq('archived', false)
      .order('status')
      .order('name');
    setItems(data ?? []);
    setLoading(false);
  }, [supabase, currentWorkplaceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`equipment:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'equipment', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  const needsAttention = items.filter((e) => {
    if (e.status === 'warning' || e.status === 'broken') return true;
    const days = dateInDays(e.next_check_at);
    return days !== null && days <= 7;
  });

  return (
    <>
      <PageHeader
        title="장비 점검"
        subtitle="머신·기기 관리"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {needsAttention.length > 0 && (
          <div className="bento warm" style={{ padding: 16 }}>
            <div className="bento-decor" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Wrench size={24} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>점검·수리 필요</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                  {needsAttention.length}대
                </div>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : items.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><Wrench size={26} /></div>
            <div className="empty-title">등록된 장비 없음</div>
            <div className="empty-desc">+ 버튼으로 장비를 추가해보세요</div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {items.map((eq) => {
              const Icon = CATEGORY_ICON[eq.category] || Wrench;
              const meta = STATUS_META[eq.status] || STATUS_META.ok;
              const StatusIcon = meta.icon;
              const days = dateInDays(eq.next_check_at);
              const checkSoon = days !== null && days <= 7;
              return (
                <Link key={eq.id} href={`/equipment/${eq.id}`} style={{ textDecoration: 'none' }}>
                  <div className="card interactive" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div
                      style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: eq.status === 'broken' ? 'var(--danger-soft)' :
                                    eq.status === 'warning' ? 'var(--warning-soft)' :
                                    'var(--accent-soft)',
                        color: eq.status === 'broken' ? 'var(--danger)' :
                               eq.status === 'warning' ? '#c2410c' :
                               'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={22} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="h4">{eq.name}</div>
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {eq.category}{eq.model ? ` · ${eq.model}` : ''}
                      </div>
                      {eq.next_check_at && (
                        <div style={{ fontSize: 11, marginTop: 4, color: checkSoon ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                          {checkSoon ? `🔔 ` : ''}다음 점검 {eq.next_check_at} ({days >= 0 ? `D-${days}` : `${-days}일 경과`})
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={`tag ${meta.tag} dot`}>
                        <StatusIcon size={11} /> {meta.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <button type="button" className="fab" onClick={() => setEditing({})} aria-label="장비 추가">
        <Plus size={26} />
      </button>

      {editing && (
        <EquipmentEditor
          equipment={editing}
          supabase={supabase}
          workplaceId={currentWorkplaceId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function EquipmentEditor({ equipment, supabase, workplaceId, onClose, onSaved }) {
  const isEdit = !!equipment?.id;
  const [name, setName] = useState(equipment?.name ?? '');
  const [category, setCategory] = useState(equipment?.category ?? '에스프레소 머신');
  const [model, setModel] = useState(equipment?.model ?? '');
  const [serialNo, setSerialNo] = useState(equipment?.serial_no ?? '');
  const [vendor, setVendor] = useState(equipment?.vendor ?? '');
  const [purchasedAt, setPurchasedAt] = useState(equipment?.purchased_at ?? '');
  const [warrantyUntil, setWarrantyUntil] = useState(equipment?.warranty_until ?? '');
  const [nextCheckAt, setNextCheckAt] = useState(equipment?.next_check_at ?? '');
  const [status, setStatus] = useState(equipment?.status ?? 'ok');
  const [notes, setNotes] = useState(equipment?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError('장비명을 입력해주세요.');
    setSaving(true);
    const payload = {
      workplace_id: workplaceId,
      name: name.trim(),
      category,
      model: model.trim() || null,
      serial_no: serialNo.trim() || null,
      vendor: vendor.trim() || null,
      purchased_at: purchasedAt || null,
      warranty_until: warrantyUntil || null,
      next_check_at: nextCheckAt || null,
      status,
      notes: notes.trim() || null,
    };
    const op = isEdit
      ? supabase.from('equipment').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', equipment.id)
      : supabase.from('equipment').insert(payload);
    const { error } = await op;
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  async function archive() {
    if (!confirm('이 장비를 보관 처리할까요?')) return;
    setSaving(true);
    const { error } = await supabase.from('equipment').update({ archived: true }).eq('id', equipment.id);
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">{isEdit ? '장비 수정' : '새 장비'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">장비명</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 에스프레소 머신 1번" />

      <label className="label" style={{ marginTop: 12 }}>카테고리</label>
      <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">모델</label>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="모델명" />
        </div>
        <div>
          <label className="label">시리얼</label>
          <input className="input" value={serialNo} onChange={(e) => setSerialNo(e.target.value)} placeholder="S/N" />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>거래처 / AS 연락처</label>
      <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="거래처명 또는 전화번호" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">구입일</label>
          <input className="input" type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
        </div>
        <div>
          <label className="label">보증 만료</label>
          <input className="input" type="date" value={warrantyUntil} onChange={(e) => setWarrantyUntil(e.target.value)} />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>다음 점검 예정일</label>
      <input className="input" type="date" value={nextCheckAt} onChange={(e) => setNextCheckAt(e.target.value)} />

      <label className="label" style={{ marginTop: 12 }}>상태</label>
      <div className="segment" style={{ width: '100%' }}>
        {['ok', 'warning', 'broken'].map((s) => (
          <button
            key={s}
            type="button"
            className={`segment-item ${status === s ? 'is-active' : ''}`}
            onClick={() => setStatus(s)}
            style={{ flex: 1 }}
          >
            {STATUS_META[s].label}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>메모</label>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: 'vertical' }} />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {isEdit && (
          <button type="button" className="btn btn-outline" onClick={archive} disabled={saving} style={{ color: 'var(--danger)' }}>
            <Trash2 size={14} />
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </BottomSheet>
  );
}

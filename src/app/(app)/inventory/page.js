'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { formatRelative } from '@/lib/format';
import { safeMutate } from '@/lib/safeMutate';
import { ChevronLeft, Plus, X, Package, AlertTriangle, TrendingUp, TrendingDown, Edit3, Trash2, Search, Lock, ClipboardList } from 'lucide-react';

const CATEGORY_OPTIONS = ['식자재', '음료/시럽', '주류', '컵·뚜껑', '비품', '청소·세제', '포장', '기타'];

export default function InventoryPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [showClosing, setShowClosing] = useState(false);
  const [adjusting, setAdjusting] = useState(null);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    const { data } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('workplace_id', currentWorkplaceId)
      .eq('archived', false)
      .order('category')
      .order('name');
    setItems(data ?? []);
    setLoading(false);
  }, [supabase, currentWorkplaceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`inventory:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'inventory_items', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  const filtered = useMemo(() => {
    let list = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q));
    }
    if (filter === 'low') list = list.filter((i) => Number(i.current_qty) < Number(i.min_qty));
    return list;
  }, [items, search, filter]);

  const lowCount = items.filter((i) => Number(i.current_qty) < Number(i.min_qty)).length;
  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach((it) => {
      const k = it.category || '기타';
      if (!g[k]) g[k] = [];
      g[k].push(it);
    });
    return g;
  }, [filtered]);

  return (
    <>
      <PageHeader
        title="재고·발주"
        subtitle="식자재·비품 재고 관리"
        hideSwitcher
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setShowClosing(true)} className="btn btn-soft btn-sm">
              <Lock size={14} /> 재고 마감
            </button>
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
          </div>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {lowCount > 0 && (
          <div className="bento warm" style={{ padding: 16 }}>
            <div className="bento-decor" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AlertTriangle size={24} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>발주 필요 품목</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>
                  {lowCount}개 품목
                </div>
              </div>
              <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.25)', color: '#fff', border: 'none' }} onClick={() => setFilter('low')}>
                보기
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input"
              placeholder="품목 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>

        <div className="segment">
          <button className={`segment-item ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>
            전체 ({items.length})
          </button>
          <button className={`segment-item ${filter === 'low' ? 'is-active' : ''}`} onClick={() => setFilter('low')}>
            발주 필요 ({lowCount})
          </button>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : filtered.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><Package size={26} /></div>
            <div className="empty-title">
              {search ? '검색 결과 없음' : filter === 'low' ? '발주 필요 품목 없음' : '등록된 품목 없음'}
            </div>
            <div className="empty-desc">+ 버튼으로 품목을 추가해보세요</div>
          </div>
        ) : (
          <div className="stack stack-4">
            {Object.entries(grouped).map(([cat, list]) => (
              <section key={cat}>
                <h3 className="text-secondary" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.04, textTransform: 'uppercase', marginBottom: 8 }}>
                  {cat}
                </h3>
                <div className="stack stack-2">
                  {list.map((it) => (
                    <InventoryRow
                      key={it.id}
                      item={it}
                      onAdjust={() => setAdjusting(it)}
                      onEdit={() => setEditing(it)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <button type="button" className="fab" onClick={() => setEditing({})} aria-label="새 품목">
        <Plus size={26} />
      </button>

      {editing && (
        <InventoryEditor
          item={editing}
          supabase={supabase}
          workplaceId={currentWorkplaceId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {adjusting && (
        <InventoryAdjust
          item={adjusting}
          supabase={supabase}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          onClose={() => setAdjusting(null)}
          onSaved={() => { setAdjusting(null); load(); }}
        />
      )}

      {showClosing && (
        <InventoryClosingDialog
          items={items}
          supabase={supabase}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          onClose={() => setShowClosing(false)}
        />
      )}
    </>
  );
}

function InventoryClosingDialog({ items, supabase, userId, workplaceId, onClose }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [closings, setClosings] = useState([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    // profile JOIN 분리 — RLS 충돌 회피
    const { data } = await supabase
      .from('inventory_closings')
      .select('id, workplace_id, year, month, snapshot, item_count, low_stock_count, closed_by, closed_at')
      .eq('workplace_id', workplaceId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(12);
    setClosings(data ?? []);
    setLoading(false);
  }, [supabase, workplaceId]);

  useEffect(() => { load(); }, [load]);

  const lowStockCount = items.filter((i) => Number(i.current_qty) < Number(i.min_qty)).length;
  const totalQty = items.reduce((s, i) => s + Number(i.current_qty || 0), 0);

  async function closeMonth() {
    if (!confirm(`${year}년 ${month}월 재고를 마감하시겠습니까?\n현재 ${items.length}개 품목의 수량을 스냅샷으로 저장합니다.`)) return;
    setSaving(true);
    setError(null);
    try {
      const snapshot = items.map((i) => ({
        id: i.id, name: i.name, category: i.category, unit: i.unit,
        qty: Number(i.current_qty), min_qty: Number(i.min_qty), vendor: i.vendor,
      }));
      const { error } = await safeMutate(supabase.from('inventory_closings').upsert({
        workplace_id: workplaceId,
        year, month,
        item_count: items.length,
        total_qty_estimate: totalQty,
        low_stock_count: lowStockCount,
        snapshot,
        notes: notes.trim() || null,
        closed_by: userId,
        closed_at: new Date().toISOString(),
      }, { onConflict: 'workplace_id,year,month' }));
      if (error) { setError(error.message); return; }
      setNotes('');
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteClosing(id) {
    if (!confirm('이 마감 기록을 삭제하시겠습니까?')) return;
    try {
      const { error } = await safeMutate(supabase.from('inventory_closings').delete().eq('id', id));
      if (error) { alert(error.message); return; }
      load();
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">월별 재고 마감</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <div className="card" style={{ background: 'var(--accent-soft)', boxShadow: 'none', marginBottom: 16 }}>
        <div className="h4" style={{ marginBottom: 6 }}>현재 재고 스냅샷</div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <span>품목 <strong className="num">{items.length}</strong>개</span>
          <span>총수량 <strong className="num">{Math.round(totalQty)}</strong></span>
          <span className={lowStockCount > 0 ? 'text-danger' : ''}>부족 <strong className="num">{lowStockCount}</strong></span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="label">연도</label>
          <input className="input num" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">월</label>
          <input className="input num" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>비고</label>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: 'vertical' }} placeholder="예: 월말 실사 완료, 폐기 처리 5건 포함" />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>{error}</div>
      )}

      <button type="button" className="btn btn-primary btn-lg btn-block" onClick={closeMonth} disabled={saving} style={{ marginTop: 14 }}>
        <Lock size={16} /> {saving ? '마감 중...' : `${year}년 ${month}월 마감하기`}
      </button>

      <div style={{ marginTop: 24 }}>
        <h3 className="h4" style={{ marginBottom: 8 }}>이력</h3>
        {loading ? (
          <div className="skeleton" style={{ height: 60 }} />
        ) : closings.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>아직 마감 기록이 없어요</p>
        ) : (
          <div className="stack stack-2">
            {closings.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--surface-soft)', borderRadius: 10 }}>
                <ClipboardList size={16} color="var(--accent)" />
                <div style={{ flex: 1 }}>
                  <div className="h4" style={{ fontSize: 13 }}>{c.year}년 {c.month}월</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    품목 {c.item_count}개 · 부족 {c.low_stock_count}개 · {c.closed_at?.slice(0, 10)}
                  </div>
                </div>
                <button type="button" onClick={() => deleteClosing(c.id)} className="btn btn-ghost btn-icon">
                  <Trash2 size={13} color="var(--danger)" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function InventoryRow({ item, onAdjust, onEdit }) {
  const low = Number(item.current_qty) < Number(item.min_qty);
  return (
    <div
      className="card compact"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        borderLeft: low ? '3px solid var(--danger)' : '3px solid transparent',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="h4">{item.name}</div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
          {item.vendor ? `${item.vendor} · ` : ''}최소 {item.min_qty}{item.unit}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="num" style={{ fontSize: 20, fontWeight: 800, color: low ? 'var(--danger)' : 'var(--text)' }}>
          {Number(item.current_qty)}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>{item.unit}</span>
        </div>
        {low && <span className="tag tag-danger" style={{ fontSize: 10, marginTop: 2 }}>발주</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button onClick={onAdjust} className="btn btn-soft btn-xs">±</button>
        <button onClick={onEdit} className="btn btn-ghost btn-icon" style={{ minHeight: 28, padding: 4 }}>
          <Edit3 size={12} />
        </button>
      </div>
    </div>
  );
}

function InventoryEditor({ item, supabase, workplaceId, onClose, onSaved }) {
  const isEdit = !!item?.id;
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? '식자재');
  const [unit, setUnit] = useState(item?.unit ?? '개');
  const [currentQty, setCurrentQty] = useState(item?.current_qty ?? 0);
  const [minQty, setMinQty] = useState(item?.min_qty ?? 0);
  const [vendor, setVendor] = useState(item?.vendor ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError('품목명을 입력해주세요.');
    setSaving(true);
    const payload = {
      workplace_id: workplaceId,
      name: name.trim(),
      category,
      unit: unit.trim() || '개',
      current_qty: Number(currentQty) || 0,
      min_qty: Number(minQty) || 0,
      vendor: vendor.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const op = isEdit
        ? supabase.from('inventory_items').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', item.id)
        : supabase.from('inventory_items').insert(payload);
      const { error } = await safeMutate(op);
      if (error) { setError(error.message); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm('이 품목을 보관 처리할까요? (목록에서 사라집니다)')) return;
    setSaving(true);
    try {
      const { error } = await safeMutate(supabase
        .from('inventory_items')
        .update({ archived: true })
        .eq('id', item.id));
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
        <h2 className="h3">{isEdit ? '품목 편집' : '새 품목'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">품목명</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 우유 1L" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">카테고리</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">단위</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="개, kg, L" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">현재 수량</label>
          <input className="input" type="number" inputMode="decimal" value={currentQty} onChange={(e) => setCurrentQty(e.target.value)} />
        </div>
        <div>
          <label className="label">최소 (발주 알림)</label>
          <input className="input" type="number" inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>거래처 (선택)</label>
      <input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="거래처명" />

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

function InventoryAdjust({ item, supabase, userId, workplaceId, onClose, onSaved }) {
  const [type, setType] = useState('restock');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    const n = Number(qty);
    if (!n || n === 0) return setError('수량을 입력해주세요.');
    setSaving(true);
    const delta = type === 'restock' ? Math.abs(n) : -Math.abs(n);
    try {
      const { error } = await safeMutate(supabase.from('inventory_transactions').insert({
        item_id: item.id,
        workplace_id: workplaceId,
        user_id: userId,
        type,
        qty_delta: delta,
        note: note.trim() || null,
      }));
      if (error) { setError(error.message); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  const TYPE_LABEL = { restock: '입고', use: '사용', adjust: '조정', discard: '폐기' };

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 className="h3">{item.name}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
        현재 <span className="num" style={{ fontWeight: 700, color: 'var(--text)' }}>{Number(item.current_qty)}{item.unit}</span>
      </div>

      <label className="label">유형</label>
      <div className="segment" style={{ width: '100%' }}>
        {['restock', 'use', 'discard'].map((t) => (
          <button
            key={t}
            type="button"
            className={`segment-item ${type === t ? 'is-active' : ''}`}
            onClick={() => setType(t)}
            style={{ flex: 1 }}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>수량</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          className="input lg num"
          type="number"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="0"
          style={{ flex: 1, textAlign: 'center', fontSize: 24, fontWeight: 800 }}
        />
        <span className="h3 text-secondary">{item.unit}</span>
      </div>

      <label className="label" style={{ marginTop: 12 }}>메모 (선택)</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 배송 도착, 깨짐 등" />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {type === 'restock' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {saving ? '처리 중...' : `${TYPE_LABEL[type]} 기록`}
        </button>
      </div>
    </BottomSheet>
  );
}

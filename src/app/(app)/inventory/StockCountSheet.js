'use client';

import { useMemo, useState } from 'react';
import { X, Search, ClipboardCheck } from 'lucide-react';
import BottomSheet from '@/components/BottomSheet';
import { useFeedback } from '@/context/FeedbackContext';
import UnitSelect, { COUNT_UNITS } from './UnitSelect';
import { formatCountedAgo } from '@/lib/stockCount';
import { applyStockCount } from './actions';

/**
 * 재고 실사 — 전 품목을 한 화면에서 세고 한 번에 저장.
 * 입력한 품목만 조정 거래로 기록되고(차이 0 이면 실사 시각만), 비워 둔 품목은 건드리지 않는다.
 * 세는 단위는 품목마다 바꿀 수 있고(입고 형태를 아직 모르는 품목 대비) 바꾸면 품목 단위도 함께 저장된다.
 */
export default function StockCountSheet({ items, workplaceId, onClose, onSaved }) {
  const { toast } = useFeedback();
  const [rows, setRows] = useState(() => Object.fromEntries((items ?? []).map((it) => [it.id, { counted: '', unit: it.unit ?? '개' }])));
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('stale'); // 'stale' 오래된 실사 순 | 'name'
  const [saving, setSaving] = useState(false);

  const list = useMemo(() => {
    let l = items ?? [];
    const q = search.trim().toLowerCase();
    if (q) l = l.filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q));
    l = [...l];
    if (sort === 'stale') {
      l.sort((a, b) => (a.last_counted_at ? new Date(a.last_counted_at).getTime() : 0) - (b.last_counted_at ? new Date(b.last_counted_at).getTime() : 0) || a.name.localeCompare(b.name, 'ko'));
    } else {
      l.sort((a, b) => (a.category ?? '기타').localeCompare(b.category ?? '기타', 'ko') || a.name.localeCompare(b.name, 'ko'));
    }
    return l;
  }, [items, search, sort]);

  const filledCount = Object.values(rows).filter((r) => r.counted !== '').length;

  function setRow(id, patch) {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { counted: '', unit: (items ?? []).find((i) => i.id === id)?.unit ?? '개' }), ...patch } }));
  }

  async function save() {
    if (filledCount === 0) return toast('센 수량을 하나 이상 입력해 주세요', 'error');
    setSaving(true);
    try {
      const lines = Object.entries(rows).filter(([, r]) => r.counted !== '').map(([itemId, r]) => ({ itemId, counted: Number(r.counted), unit: r.unit }));
      const res = await applyStockCount({ workplaceId, lines });
      if (res?.error) return toast(res.error, 'error');
      toast(`${res.counted}품목 실사 저장 (조정 ${res.adjusted}건)`, 'success');
      onSaved();
    } catch (e) {
      toast(String(e?.message || e), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose} maxWidth={640}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 className="h3"><ClipboardCheck size={16} style={{ display: 'inline', verticalAlign: -2, marginRight: 6 }} />재고 세기</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="닫기"><X size={18} /></button>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
        센 수량만 적으면 차이가 &ldquo;조정&rdquo;으로 기록돼요. 비워 둔 품목은 그대로 둡니다. 단위는 실제 세는 형태(봉·병·박스)로 바꿔도 됩니다.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input sm" placeholder="품목 검색" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 30 }} />
        </div>
        <div className="segment" role="group" aria-label="정렬">
          <button type="button" className={`segment-item ${sort === 'stale' ? 'is-active' : ''}`} onClick={() => setSort('stale')}>오래된 순</button>
          <button type="button" className={`segment-item ${sort === 'name' ? 'is-active' : ''}`} onClick={() => setSort('name')}>분류</button>
        </div>
      </div>

      <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'grid', gap: 6, paddingRight: 2 }}>
        {list.map((it) => {
          const r = rows[it.id] ?? { counted: '', unit: it.unit ?? '개' };
          const filled = r.counted !== '';
          const unitLocked = !!it.usage_unit; // 소진 단위(ml/g) 연결 품목은 단위를 바꾸면 환산이 깨져 편집기에서만 변경
          return (
            <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr 96px 88px', gap: 6, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: filled ? 'var(--accent-soft)' : 'var(--surface-soft)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                <div className="text-muted num" style={{ fontSize: 11 }}>
                  현재 {Number(it.current_qty)}{it.unit}{formatCountedAgo(it.last_counted_at) ? ` · ${formatCountedAgo(it.last_counted_at)}` : ' · 실사 기록 없음'}
                </div>
              </div>
              {unitLocked
                ? <div className="input sm text-muted" style={{ display: 'flex', alignItems: 'center' }} title="판매 연결 품목은 품목 편집에서 단위를 바꿔 주세요">{r.unit}</div>
                : <UnitSelect compact value={r.unit} onChange={(u) => setRow(it.id, { unit: u })} options={COUNT_UNITS} ariaLabel={`${it.name} 단위`} />}
              <input
                className="input sm num" type="number" inputMode="decimal" min="0" step="any"
                placeholder="센 수량" aria-label={`${it.name} 센 수량`}
                value={r.counted} onChange={(e) => setRow(it.id, { counted: e.target.value })}
              />
            </div>
          );
        })}
        {list.length === 0 && <div className="text-muted" style={{ fontSize: 13, padding: 12, textAlign: 'center' }}>검색 결과 없음</div>}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || filledCount === 0} style={{ flex: 2 }}>
          {saving ? '저장 중...' : `${filledCount}품목 저장`}
        </button>
      </div>
    </BottomSheet>
  );
}

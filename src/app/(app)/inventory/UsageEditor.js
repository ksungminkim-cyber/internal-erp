// src/app/(app)/inventory/UsageEditor.js
'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Link2 } from 'lucide-react';
import BottomSheet from '@/components/BottomSheet';
import { suggestQty } from '@/lib/usageSuggest';
import { getProductUsage, saveProductUsage } from './actions';

// 재고 품목 ↔ 토스 상품 소요량 연결 편집. 상품 1개당 이 품목이 얼마나 들어가는지(품목 단위).
export default function UsageEditor({ item, workplaceId, onClose, onSaved }) {
  const [loaded, setLoaded] = useState(null); // { products, links, recipes, avgDailyUsage }
  const [loadError, setLoadError] = useState(null);
  const [qtyByTitle, setQtyByTitle] = useState({}); // item_title → 입력 문자열 ('' = 연결 안 함)
  const [query, setQuery] = useState('');
  const [bulk, setBulk] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    getProductUsage({ workplaceId, inventoryItemId: item.id })
      .then((d) => {
        if (!alive) return;
        if (!d) { setLoadError('권한이 없거나 데이터를 불러오지 못했어요.'); return; }
        setLoaded(d);
        setQtyByTitle(Object.fromEntries(d.links.map((l) => [l.item_title, String(l.qty_per_unit)])));
      })
      .catch((e) => { if (alive) setLoadError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [workplaceId, item.id]);

  const products = useMemo(() => loaded?.products ?? [], [loaded]);
  const suggestions = useMemo(() => {
    if (!loaded) return {};
    const out = {};
    for (const p of products) {
      const s = suggestQty(p.item_title, item.name, loaded.recipes);
      if (s) out[p.item_title] = { ...s, sameUnit: !!s.unit && s.unit.toLowerCase() === String(item.unit ?? '').toLowerCase() };
    }
    return out;
  }, [loaded, products, item.name, item.unit]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? products.filter((p) => p.item_title.toLowerCase().includes(q)) : products;
    // 열 때 이미 연결돼 있던 상품을 위로 (스냅샷 기준 — 입력 중에 행이 움직이지 않도록)
    const linked = new Set((loaded?.links ?? []).map((l) => l.item_title));
    return [...list].sort((a, b) => (linked.has(b.item_title) ? 1 : 0) - (linked.has(a.item_title) ? 1 : 0));
  }, [products, query, loaded]);

  const checkedTitles = Object.keys(qtyByTitle);
  const validCount = checkedTitles.filter((t) => Number(qtyByTitle[t]) > 0).length;
  const emptyCount = checkedTitles.length - validCount;

  function setQty(title, v) { setQtyByTitle((m) => ({ ...m, [title]: v })); }
  function toggle(title) {
    setQtyByTitle((m) => {
      if (title in m) { const n = { ...m }; delete n[title]; return n; }
      // 체크 시 기본값: 레시피 추천이 품목과 같은 단위일 때만 자동 입력, 아니면 일괄 값 또는 빈칸
      const s = suggestions[title];
      return { ...m, [title]: s?.sameUnit ? String(s.qty) : (Number(bulk) > 0 ? bulk : '') };
    });
  }
  function applyBulk() {
    if (!(Number(bulk) > 0)) return;
    setQtyByTitle((m) => Object.fromEntries(Object.keys(m).map((t) => [t, bulk])));
  }

  async function save() {
    setError(null);
    if (emptyCount > 0) { setError(`소요량이 비어 있는 상품이 ${emptyCount}개 있어요. 값을 넣거나 체크를 해제해 주세요.`); return; }
    setSaving(true);
    try {
      const rows = Object.entries(qtyByTitle).map(([item_title, v]) => ({ item_title, qty_per_unit: Number(v) }));
      const res = await saveProductUsage({ workplaceId, inventoryItemId: item.id, rows });
      if (res?.error) { setError(res.error); return; }
      onSaved?.();
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <h2 className="h3" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Link2 size={16} /> 소요량 연결</h2>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{item.name} · 단위 {item.unit}</div>
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="닫기"><X size={18} /></button>
      </div>
      <p className="text-secondary" style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
        상품 1개를 팔 때 이 품목이 얼마나 쓰이는지 적어 주세요. 레시피에 같은 재료가 있으면 추천값을 눌러 넣을 수 있어요.
        {loaded?.avgDailyUsage != null && (
          <> 최근 30일 판매 기준 하루 평균 소진 <strong>{Math.round(loaded.avgDailyUsage * 100) / 100}{item.unit}</strong>.</>
        )}
      </p>

      {loadError ? (
        <div className="card empty"><div className="empty-desc">{loadError}</div></div>
      ) : !loaded ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" style={{ paddingLeft: 30 }} placeholder="상품 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="stack stack-1" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
            {filtered.length === 0 && <div className="text-muted" style={{ fontSize: 12, padding: '8px 0' }}>{query ? '검색 결과가 없어요' : '최근 90일 판매 상품이 없어요'}</div>}
            {filtered.map((p) => {
              const on = qtyByTitle[p.item_title] != null;
              const sug = suggestions[p.item_title];
              return (
                <div key={p.item_title} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.item_title)} aria-label={`${p.item_title} 연결`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.item_title}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      90일 {p.qty90}개
                      {sug && (
                        <button
                          type="button"
                          className="btn btn-soft btn-xs"
                          style={{ marginLeft: 6, padding: '0 6px', minHeight: 18, fontSize: 10, color: sug.sameUnit ? undefined : 'var(--danger)' }}
                          title={sug.sameUnit ? '레시피 값 넣기' : `레시피 단위(${sug.unit || '?'})가 품목 단위(${item.unit})와 달라요. 환산해서 넣어 주세요.`}
                          onClick={() => setQty(p.item_title, String(sug.qty))}
                        >
                          레시피 {sug.qty}{sug.unit}{sug.sameUnit ? '' : ' ≠' + item.unit}
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    className="input" type="number" inputMode="decimal" min="0" step="any"
                    style={{ width: 86, textAlign: 'right' }}
                    value={on ? (qtyByTitle[p.item_title] ?? '') : ''}
                    placeholder="소요량"
                    onChange={(e) => setQty(p.item_title, e.target.value)}
                    aria-label={`${p.item_title} 소요량`}
                  />
                  <span className="text-muted" style={{ fontSize: 11, width: 22 }}>{item.unit}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input className="input" type="number" inputMode="decimal" min="0" step="any" placeholder="선택한 상품 모두 같은 값" value={bulk} onChange={(e) => setBulk(e.target.value)} style={{ flex: 1 }} />
            <button type="button" className="btn btn-soft btn-sm" onClick={applyBulk} disabled={!(Number(bulk) > 0) || checkedTitles.length === 0}>일괄 적용</button>
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
          <button type="button" className="btn btn-primary btn-block" onClick={save} disabled={saving} style={{ marginTop: 12 }}>
            {saving ? '저장 중…' : `저장 (${validCount}개 연결)`}
          </button>
        </>
      )}
    </BottomSheet>
  );
}

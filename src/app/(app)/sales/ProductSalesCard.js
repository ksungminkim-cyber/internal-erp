// src/app/(app)/sales/ProductSalesCard.js
'use client';

import { useEffect, useState } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { formatCurrency, formatTime } from '@/lib/format';
import { ymd } from '@/lib/date';
import { getPageCache, setPageCache } from '@/lib/pageCache';
import { getProductSales } from './actions';

const RANGES = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'custom', label: '직접 선택' },
];

function rangeDates(key, custom) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (key === 'today') return { from: ymd(today), to: ymd(today) };
  if (key === 'week') {
    const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 월요일
    return { from: ymd(d), to: ymd(today) };
  }
  if (key === 'month') return { from: `${ymd(today).slice(0, 7)}-01`, to: ymd(today) };
  return custom;
}

export default function ProductSalesCard({ workplaceId }) {
  const [range, setRange] = useState('today');
  const [custom, setCustom] = useState(() => ({ from: ymd(new Date()), to: ymd(new Date()) }));
  const { from, to } = rangeDates(range, custom);
  const cacheKey = `productSales:${workplaceId}:${from}:${to}`;
  // 마지막으로 받은 결과와 그 키. 키가 다르면 페이지 캐시로 대체 (stale-while-revalidate)
  const [result, setResult] = useState({ key: null, data: null });
  const [tick, setTick] = useState(0); // 새로고침 트리거

  useEffect(() => {
    if (!workplaceId || !from || !to || from > to) return undefined;
    let alive = true;
    getProductSales({ workplaceId, from, to })
      .then((res) => {
        if (!alive) return;
        setResult({ key: cacheKey, data: res });
        setPageCache(cacheKey, res);
      })
      .catch(() => { if (alive) setResult({ key: cacheKey, data: null }); });
    return () => { alive = false; };
  }, [workplaceId, from, to, cacheKey, tick]);

  const data = result.key === cacheKey ? result.data : getPageCache(cacheKey);
  const loading = result.key !== cacheKey && !data;
  const items = data?.items ?? [];

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Package size={18} color="var(--accent-strong)" />
        <h2 className="h3" style={{ flex: 1 }}>상품별 판매</h2>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setTick((t) => t + 1)} aria-label="새로고침">
          <RefreshCw size={12} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`btn btn-xs ${range === r.key ? 'btn-primary' : 'btn-soft'}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input type="date" className="input" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span className="text-muted">~</span>
          <input type="date" className="input" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}

      {loading ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : items.length === 0 ? (
        <div className="empty" style={{ padding: '16px 0' }}>
          <div className="empty-desc">아직 동기화된 주문이 없어요</div>
        </div>
      ) : (
        <div className="stack stack-1">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 90px', gap: 8, fontSize: 11, fontWeight: 700 }} className="text-muted">
            <span>상품</span><span style={{ textAlign: 'right' }}>수량</span><span style={{ textAlign: 'right' }}>금액</span>
          </div>
          {items.map((it) => (
            <div key={`${it.item_title}|${it.item_code ?? ''}`} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 90px', gap: 8, fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.item_title}</span>
              <span className="num" style={{ textAlign: 'right' }}>{formatCurrency(it.qty)}</span>
              <span className="num" style={{ textAlign: 'right' }}>{formatCurrency(it.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>
        {data?.lastSyncedAt ? `마지막 동기화 ${formatTime(data.lastSyncedAt)}` : '동기화 전'}
      </div>
    </section>
  );
}

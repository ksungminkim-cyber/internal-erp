// src/app/(app)/sales/ProductSalesCard.js
'use client';

import { useEffect, useState } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { formatCurrency, formatTime, formatDateTime } from '@/lib/format';
import { ymd } from '@/lib/date';
import { RANGES, rangeDates } from '@/lib/salesRanges';
import { getPageCache, setPageCache } from '@/lib/pageCache';
import { getProductSales } from './actions';

export default function ProductSalesCard({ workplaceId }) {
  const [range, setRange] = useState('today');
  const [custom, setCustom] = useState(() => ({ from: ymd(new Date()), to: ymd(new Date()) }));
  const { from, to } = rangeDates(range, custom);
  const cacheKey = `productSales:${workplaceId}:${from}:${to}`;
  // 마지막으로 받은 결과와 그 키. 키가 다르면 페이지 캐시로 대체 (stale-while-revalidate)
  const [result, setResult] = useState({ key: null, data: null, error: null, tick: 0 });
  const [tick, setTick] = useState(0); // 새로고침 트리거
  const invalidRange = !from || !to || from > to; // 직접 선택에서 빈 날짜·역순

  useEffect(() => {
    if (!workplaceId || invalidRange) return undefined;
    let alive = true;
    getProductSales({ workplaceId, from, to })
      .then((res) => {
        if (!alive) return;
        // null = 권한 없음/잘못된 요청 → 오류로 표시 (빈 데이터와 구분)
        setResult({ key: cacheKey, data: res, error: res ? null : '불러올 권한이 없어요', tick });
        if (res) setPageCache(cacheKey, res);
      })
      .catch((e) => { if (alive) setResult({ key: cacheKey, data: null, error: String(e?.message ?? '불러오지 못했어요'), tick }); });
    return () => { alive = false; };
  }, [workplaceId, from, to, cacheKey, tick, invalidRange]);

  const fresh = result.key === cacheKey;
  const data = fresh ? result.data : getPageCache(cacheKey);
  const error = fresh ? result.error : null;
  const loading = !invalidRange && !fresh && !data;
  const refreshing = fresh && result.tick !== tick; // 새로고침 요청 후 응답 전
  const items = data?.items ?? [];
  const syncedToday = data?.lastSyncedAt ? ymd(new Date(data.lastSyncedAt)) === ymd(new Date()) : false;

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Package size={18} color="var(--accent-strong)" />
        <h2 className="h3" style={{ flex: 1 }}>상품별 판매</h2>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setTick((t) => t + 1)} aria-label="새로고침" disabled={refreshing || loading}>
          <RefreshCw size={12} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
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
          <input type="date" className="input" style={{ flex: 1, minWidth: 0 }} value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span className="text-muted">~</span>
          <input type="date" className="input" style={{ flex: 1, minWidth: 0 }} value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}

      {invalidRange ? (
        <div className="empty" style={{ padding: '16px 0' }}>
          <div className="empty-desc">기간을 확인하세요. 시작일이 종료일보다 늦거나 비어 있어요.</div>
        </div>
      ) : loading ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : error ? (
        <div className="empty" style={{ padding: '16px 0' }}>
          <div className="empty-desc">불러오지 못했어요. {error}</div>
        </div>
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
        {data?.lastSyncedAt
          ? `마지막 동기화 ${syncedToday ? formatTime(data.lastSyncedAt) : formatDateTime(data.lastSyncedAt)}`
          : '동기화 전'}
      </div>
    </section>
  );
}

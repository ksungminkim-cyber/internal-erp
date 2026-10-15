// src/app/(app)/sales/ProductSalesCard.js
'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, ChevronDown } from 'lucide-react';
import { formatCurrency, formatTime, formatDateTime } from '@/lib/format';
import { ymd } from '@/lib/date';
import { RANGES, rangeDates } from '@/lib/salesRanges';
import { getPageCache, setPageCache } from '@/lib/pageCache';
import { getProductSales } from './actions';

const TOP_N = 8;

function fmtQty(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? formatCurrency(v) : String(Math.round(v * 100) / 100);
}

function rangeLabel(from, to) {
  if (!from || !to) return '';
  const f = new Date(from), t = new Date(to);
  const fmt = (d) => d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  return from === to ? fmt(f) : `${fmt(f)} – ${fmt(t)}`;
}

export default function ProductSalesCard({ workplaceId }) {
  const [range, setRange] = useState('today');
  const [custom, setCustom] = useState(() => ({ from: ymd(new Date()), to: ymd(new Date()) }));
  const [showAll, setShowAll] = useState(false);
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
        setResult({ key: cacheKey, data: res, error: res ? null : '권한이 없거나 잘못된 요청이에요.', tick });
        if (res) setPageCache(cacheKey, res);
      })
      .catch((e) => {
        if (!alive) return;
        console.error('getProductSales', e);
        setResult({ key: cacheKey, data: null, error: '잠시 후 다시 시도해 주세요.', tick });
      });
    return () => { alive = false; };
  }, [workplaceId, from, to, cacheKey, tick, invalidRange]);

  const fresh = result.key === cacheKey;
  const data = fresh ? result.data : getPageCache(cacheKey);
  const error = fresh ? result.error : null;
  const loading = !invalidRange && !fresh && !data;
  const refreshing = fresh && result.tick !== tick; // 새로고침 요청 후 응답 전
  const items = data?.items ?? [];
  const summary = data?.summary ?? null;
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const maxQty = items.reduce((m, it) => Math.max(m, Number(it.qty) || 0), 0);
  const shown = showAll ? items : items.slice(0, TOP_N);
  const syncedToday = data?.lastSyncedAt ? ymd(new Date(data.lastSyncedAt)) === ymd(new Date()) : false;
  const periodLabel = RANGES.find((r) => r.key === range)?.label ?? '';

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* 기간 선택 — 가로 스크롤되는 세그먼트 */}
      <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 className="h3" style={{ flex: 1 }}>상품별 판매</h2>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setTick((t) => t + 1)}
          aria-label="새로고침"
          disabled={refreshing || loading}
        >
          <RefreshCw size={13} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
        </button>
      </div>
      <div style={{ padding: '10px 16px 0', overflowX: 'auto', scrollbarWidth: 'none' }}>
        <div className="segment" role="tablist" aria-label="기간" style={{ whiteSpace: 'nowrap' }}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              className={`segment-item ${range === r.key ? 'is-active' : ''}`}
              style={{ padding: '7px 12px', fontSize: 12.5 }}
              onClick={() => { setRange(r.key); setShowAll(false); }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {range === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px 0' }}>
          <input type="date" className="input" style={{ flex: 1, minWidth: 0 }} value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="시작일" />
          <span className="text-muted">~</span>
          <input type="date" className="input" style={{ flex: 1, minWidth: 0 }} value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="종료일" />
        </div>
      )}

      {/* 기간 합계 — 숫자 하나를 크게, 나머지는 조용히 */}
      {!invalidRange && !error && (
        <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--border)' }}>
          <div className="text-muted" style={{ fontSize: 12, fontWeight: 600 }}>
            {periodLabel} 매출 <span style={{ fontWeight: 500 }}>· {rangeLabel(from, to)}</span>
          </div>
          {loading ? (
            <div className="skeleton" style={{ height: 34, width: 160, marginTop: 6 }} />
          ) : (
            <div className="num" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2, marginTop: 4, color: 'var(--accent-strong)' }}>
              {formatCurrency(summary?.total ?? 0)}<span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 3, fontWeight: 600 }}>원</span>
            </div>
          )}
          {!loading && summary && (
            <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>거래 <strong className="num">{formatCurrency(summary.count)}</strong>건</span>
              <span>판매 <strong className="num">{fmtQty(totalQty)}</strong>개</span>
              {summary.days > 1 && (
                <span>일평균 <strong className="num">{formatCurrency(Math.round(summary.total / summary.days))}</strong>원</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 상품 랭킹 — 판매 수량 비중 막대 */}
      <div style={{ padding: '6px 16px 12px' }}>
        {invalidRange ? (
          <div className="empty" style={{ padding: '18px 0' }}>
            <div className="empty-desc">기간을 확인하세요. 시작일이 종료일보다 늦거나 비어 있어요.</div>
          </div>
        ) : loading ? (
          <div className="stack stack-2" style={{ paddingTop: 8 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}
          </div>
        ) : error ? (
          <div className="empty" style={{ padding: '18px 0' }}>
            <div className="empty-desc">불러오지 못했어요. {error}</div>
          </div>
        ) : items.length === 0 ? (
          <div className="empty" style={{ padding: '18px 0' }}>
            <div className="empty-desc">이 기간에는 동기화된 주문이 없어요</div>
          </div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((it, i) => {
              const qty = Number(it.qty) || 0;
              const share = totalQty > 0 ? qty / totalQty : 0;
              const width = maxQty > 0 ? Math.max((qty / maxQty) * 100, 2) : 0;
              return (
                <li key={`${it.item_title}|${it.item_code ?? ''}`} style={{ padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span className="num text-muted" style={{ width: 18, fontSize: 12, fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.item_title}</span>
                    <span className="num" style={{ fontSize: 13.5, fontWeight: 800, flexShrink: 0 }}>{fmtQty(qty)}<span className="text-muted" style={{ fontSize: 11, fontWeight: 600, marginLeft: 1 }}>개</span></span>
                    <span className="num text-secondary" style={{ fontSize: 12.5, width: 78, textAlign: 'right', flexShrink: 0 }}>{formatCurrency(it.amount)}원</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, paddingLeft: 28 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--surface-soft)', overflow: 'hidden' }} aria-hidden="true">
                      <div style={{ width: `${width}%`, height: '100%', borderRadius: 999, background: i === 0 ? 'var(--grad-accent)' : 'var(--accent-soft-2)' }} />
                    </div>
                    <span className="num text-muted" style={{ fontSize: 11, width: 34, textAlign: 'right', flexShrink: 0 }}>{Math.round(share * 100)}%</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {!loading && !error && items.length > TOP_N && (
          <button type="button" className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 4 }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? '상위 8개만 보기' : `${items.length - TOP_N}개 더 보기`}
            <ChevronDown size={14} style={{ transform: showAll ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-sm) var(--ease)' }} />
          </button>
        )}

        <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
          {error
            ? ''
            : data?.lastSyncedAt
              ? `마지막 동기화 ${syncedToday ? formatTime(data.lastSyncedAt) : formatDateTime(data.lastSyncedAt)} · 금액은 주문 최종금액 기준`
              : '동기화 전'}
        </div>
      </div>
    </section>
  );
}

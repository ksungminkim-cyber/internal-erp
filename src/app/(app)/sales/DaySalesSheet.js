// src/app/(app)/sales/DaySalesSheet.js
'use client';

import { useEffect, useState } from 'react';
import { X, CreditCard, Banknote, Smartphone } from 'lucide-react';
import BottomSheet from '@/components/BottomSheet';
import { formatCurrency } from '@/lib/format';
import { getDaySalesDetail } from './actions';

// 매출 페이지에서 날짜를 눌렀을 때 — 그날의 합계(총액·건수·카드·현금·기타)와 상품별 판매
export default function DaySalesSheet({ workplaceId, date, onClose }) {
  // 결과와 그 결과의 날짜. 날짜가 다르면 로딩 중 (effect 안에서 동기 setState 하지 않기 위함)
  const [state, setState] = useState({ key: null, data: null, error: null });
  const stateKey = `${workplaceId}|${date}`; // 매장을 바꿔도 이전 매장 데이터가 보이지 않도록

  useEffect(() => {
    let alive = true;
    getDaySalesDetail({ workplaceId, date })
      .then((data) => { if (alive) setState({ key: stateKey, data, error: null }); })
      .catch((e) => { if (alive) setState({ key: stateKey, data: null, error: String(e?.message ?? e) }); });
    return () => { alive = false; };
  }, [workplaceId, date, stateKey]);

  const loading = state.key !== stateKey;
  const data = loading ? null : state.data;
  const error = loading ? null : state.error;
  const summary = data?.summary ?? null;
  const items = data?.items ?? [];
  const title = new Date(date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 className="h3">{title}</h2>
          {summary && (
            <span className={`tag ${summary.source === 'manual' ? '' : 'tag-mint'}`} style={{ fontSize: 10, marginTop: 4 }}>
              {summary.source === 'manual' ? '수기 입력' : 'POS 자동'}
            </span>
          )}
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="닫기"><X size={18} /></button>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : error ? (
        <div className="card empty"><div className="empty-desc">불러오지 못했어요. 다시 시도해 주세요.</div></div>
      ) : !summary && items.length === 0 ? (
        <div className="card empty"><div className="empty-desc">이 날짜에는 기록된 매출이 없어요</div></div>
      ) : (
        <div className="stack stack-3">
          {summary && (
            <div className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 700 }}>총매출</div>
              <div className="num" style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>
                {formatCurrency(summary.total)}<span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
                {summary.count ? <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>{summary.count}건</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12 }} className="text-secondary">
                <span><CreditCard size={11} style={{ display: 'inline', marginRight: 3 }} />카드 {formatCurrency(summary.card)}</span>
                <span><Banknote size={11} style={{ display: 'inline', marginRight: 3 }} />현금 {formatCurrency(summary.cash)}</span>
                <span><Smartphone size={11} style={{ display: 'inline', marginRight: 3 }} />기타 {formatCurrency(summary.other)}</span>
              </div>
            </div>
          )}

          <div>
            <div className="h4" style={{ marginBottom: 8 }}>상품별 판매</div>
            {items.length === 0 ? (
              <div className="text-muted" style={{ fontSize: 12 }}>POS 주문 데이터가 없는 날이에요</div>
            ) : (
              <div className="stack stack-1" style={{ maxHeight: '45vh', overflowY: 'auto' }}>
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
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

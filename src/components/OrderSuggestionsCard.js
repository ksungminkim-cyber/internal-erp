// src/components/OrderSuggestionsCard.js
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ClipboardList, ChevronRight } from 'lucide-react';
import { ymd } from '@/lib/date';
import { buildOrderDraft, formatDaysLeft } from '@/lib/orderDraft';
import { getOrderSuggestions } from '@/app/(app)/inventory/actions';

export const ORDER_DRAFT_KEY = 'approvalPrefill';

/**
 * 발주 권장 카드 — POS 판매 기반 예측(연결 품목) + 최소 수량 기준(그 외).
 * props: workplaceId, workplaceName, canDraft(매니저 이상), limit(홈 5개), onLoaded({ count, daysLeftById })
 */
function fmtQty(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

export default function OrderSuggestionsCard({ workplaceId, workplaceName, canDraft = false, limit = null, onLoaded, showAllLink = false, refreshKey = '' }) {
  const router = useRouter();
  const [result, setResult] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    if (!workplaceId) return undefined;
    let alive = true;
    getOrderSuggestions({ workplaceId })
      .then((data) => {
        if (!alive) return;
        setResult({ key: workplaceId, data, error: null });
        onLoaded?.({ count: data?.suggestions?.length ?? 0, daysLeftById: data?.daysLeftById ?? {} });
      })
      .catch((e) => {
        if (!alive) return;
        setResult({ key: workplaceId, data: null, error: String(e?.message ?? e) });
        onLoaded?.({ count: 0, daysLeftById: {} });
      });
    return () => { alive = false; };
    // onLoaded 는 부모 setState 래퍼 — 의존성에 넣으면 매 렌더 재조회됨. refreshKey 가 바뀌면 재조회(이전 데이터는 유지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workplaceId, refreshKey]);

  const loading = result.key !== workplaceId;
  const suggestions = result.data?.suggestions ?? [];
  const shown = limit ? suggestions.slice(0, limit) : suggestions;

  function openDraft() {
    const draft = buildOrderDraft(suggestions, { workplaceName: workplaceName ?? '', dateKey: ymd(new Date()) });
    try { sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(draft)); } catch { /* 저장 불가 시 빈 기안으로 이동 */ }
    router.push('/approvals/new?prefill=1');
  }

  if (loading) return null;
  if (result.error) return null;
  if (suggestions.length === 0) return null;

  return (
    <section className="card" style={{ borderLeft: '3px solid var(--warning)', background: 'var(--warning-soft)', boxShadow: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <AlertTriangle size={18} color="#c2410c" />
        <h2 className="h4" style={{ flex: 1, color: '#c2410c' }}>발주 권장 {suggestions.length}품목</h2>
        {showAllLink && (
          <Link href="/inventory" className="text-muted" style={{ fontSize: 12, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            재고 <ChevronRight size={14} />
          </Link>
        )}
      </div>

      <div className="stack stack-1">
        {shown.map((s) => (
          <div key={s.inventory_item_id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, padding: '4px 0', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
            <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              {s.basis === 'forecast' ? formatDaysLeft(s.days_left) : '최소 수량 미달'}
            </span>
            <span className="num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              {fmtQty(s.suggested_qty)}{s.unit}
            </span>
          </div>
        ))}
        {limit && suggestions.length > limit && (
          <div className="text-muted" style={{ fontSize: 11, paddingTop: 4 }}>외 {suggestions.length - limit}품목 · 재고 페이지에서 전체 보기</div>
        )}
      </div>

      {canDraft && (
        <button type="button" className="btn btn-primary btn-sm btn-block" style={{ marginTop: 10 }} onClick={openDraft}>
          <ClipboardList size={14} /> 발주 기안 만들기
        </button>
      )}
    </section>
  );
}

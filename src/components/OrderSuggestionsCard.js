// src/components/OrderSuggestionsCard.js
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, ChefHat, ClipboardList, ChevronRight, ChevronDown } from 'lucide-react';
import { ymd } from '@/lib/date';
import { buildOrderDraft, formatDaysLeft, formatUsageQty } from '@/lib/orderDraft';
import { getOrderSuggestions } from '@/app/(app)/inventory/actions';

export const ORDER_DRAFT_KEY = 'approvalPrefill';

// 남은 일수에 따른 긴급도 — 0: 재고 없음/1일 미만, 1: 2일 이내 또는 최소 수량 미달, 2: 그 외
function urgency(s) {
  if (s.basis !== 'forecast') return 1;
  if (s.days_left == null) return 2;
  if (s.days_left < 1) return 0;
  if (s.days_left <= 2) return 1;
  return 2;
}
const URGENCY_STYLE = [
  { bg: 'var(--danger-soft)', fg: '#c52f3e', bar: 'var(--danger)' },
  { bg: 'var(--warning-soft)', fg: '#c2410c', bar: 'var(--warning)' },
  { bg: 'var(--surface-soft)', fg: 'var(--text-secondary)', bar: 'var(--accent-soft-2)' },
];

function statusText(s) {
  if (s.basis !== 'forecast') return '최소 수량 미달';
  return formatDaysLeft(s.days_left) || '소진 예측';
}

function Row({ s, verb }) {
  const st = URGENCY_STYLE[urgency(s)];
  // 남은 일수를 예측 기간(리드타임+안전) 대비 비율로 — 가득 차면 넉넉, 비면 급함
  const horizon = Number(s.horizon_days) || 4;
  const ratio = s.days_left == null ? 0 : Math.max(0, Math.min(1, s.days_left / horizon));
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 12, rowGap: 4, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>
            {statusText(s)}
          </span>
          <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>현재 {formatUsageQty(s.current_qty, s)}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', alignSelf: 'center' }}>
        <div className="num" style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.1 }}>{formatUsageQty(s.suggested_qty, s).split(' ')[0]}</div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{verb}</div>
      </div>
      <div style={{ gridColumn: '1 / -1', height: 4, borderRadius: 999, background: 'var(--surface-soft)', overflow: 'hidden' }} aria-hidden="true">
        <div style={{ width: `${Math.max(ratio * 100, 3)}%`, height: '100%', background: st.bar, borderRadius: 999 }} />
      </div>
    </li>
  );
}

/**
 * 발주 권장 카드 — POS 판매 기반 예측(연결 품목) + 최소 수량 기준(그 외).
 * props: workplaceId, workplaceName, canDraft(매니저 이상), limit(홈 5개), onLoaded({ count, daysLeftById }),
 *        showAllLink, refreshKey(바뀌면 재조회), collapsed/onToggle(재고 페이지 접기)
 */
export default function OrderSuggestionsCard({ workplaceId, workplaceName, canDraft = false, limit = null, onLoaded, showAllLink = false, refreshKey = '', collapsed = false, onToggle = null }) {
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
  const purchase = suggestions.filter((s) => s.supply_type !== 'made');
  const made = suggestions.filter((s) => s.supply_type === 'made');
  const shown = limit ? purchase.slice(0, limit) : purchase;
  const shownMade = limit ? made.slice(0, limit) : made;
  const urgent = suggestions.filter((s) => urgency(s) === 0).length;

  function openDraft() {
    const draft = buildOrderDraft(suggestions, { workplaceName: workplaceName ?? '', dateKey: ymd(new Date()) });
    try { sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(draft)); } catch { /* 저장 불가 시 빈 기안으로 이동 */ }
    router.push('/approvals/new?prefill=1');
  }

  if (loading || result.error || suggestions.length === 0) return null;

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* 헤더 — 재고 페이지에서는 제목 줄 전체가 접기 버튼 */}
      <div
        role={onToggle ? 'button' : undefined}
        tabIndex={onToggle ? 0 : undefined}
        aria-expanded={onToggle ? !collapsed : undefined}
        onClick={onToggle ?? undefined}
        onKeyDown={onToggle ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } } : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: onToggle ? 'pointer' : 'default' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="h3" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            오늘 챙길 재고
            <span className="num" style={{ fontSize: 13, fontWeight: 700, color: urgent > 0 ? '#c52f3e' : 'var(--text-muted)' }}>
              {suggestions.length}품목{urgent > 0 ? ` · 급함 ${urgent}` : ''}
            </span>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
            판매 추세로 예측한 소진량에서 현재 재고를 뺀 값이에요
          </div>
        </div>
        {showAllLink && (
          <Link href="/inventory" className="btn btn-ghost btn-xs" style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            전체 <ChevronRight size={14} />
          </Link>
        )}
        {onToggle && (
          <ChevronDown size={18} className="text-muted" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform var(--t-sm) var(--ease)', flexShrink: 0 }} />
        )}
      </div>

      {!collapsed && (
        <div style={{ padding: '0 16px 14px' }}>
          {purchase.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>
                <ShoppingCart size={13} /> 발주 {purchase.length}
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {shown.map((s) => <Row key={s.inventory_item_id} s={s} verb="주문" />)}
              </ol>
              {limit && purchase.length > limit && (
                <Link href="/inventory" className="text-muted" style={{ fontSize: 12, display: 'inline-block', paddingTop: 6, textDecoration: 'none' }}>
                  외 {purchase.length - limit}품목 더 보기
                </Link>
              )}
            </div>
          )}

          {made.length > 0 && (
            <div style={{ marginTop: purchase.length ? 14 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 2 }}>
                <ChefHat size={13} /> 만들기 {made.length}
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {shownMade.map((s) => <Row key={s.inventory_item_id} s={s} verb="더 만들기" />)}
              </ol>
              {limit && made.length > limit && (
                <Link href="/inventory" className="text-muted" style={{ fontSize: 12, display: 'inline-block', paddingTop: 6, textDecoration: 'none' }}>
                  외 {made.length - limit}품목 더 보기
                </Link>
              )}
            </div>
          )}

          {canDraft && purchase.length > 0 && (
            <button type="button" className="btn btn-primary btn-sm btn-block" style={{ marginTop: 12 }} onClick={openDraft}>
              <ClipboardList size={14} /> 발주 기안 만들기 · {purchase.length}품목
            </button>
          )}
        </div>
      )}
    </section>
  );
}

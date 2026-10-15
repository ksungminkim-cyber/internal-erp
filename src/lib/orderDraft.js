// src/lib/orderDraft.js
// 발주 추천(inventory_order_suggestions 결과) → 지출결의서 새 기안 초안. 순수 함수.

// 재고 카테고리 → 지출결의서 분류 (approvals/new 의 EXPENSE_CATEGORIES 값)
const CATEGORY_MAP = {
  '식자재': '식자재', '음료/시럽': '음료/시럽', '주류': '주류', '비품': '비품',
  '컵·뚜껑': '소모품', '청소·세제': '소모품', '포장': '소모품', '기타': '기타',
};

function fmtQty(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

export function formatDaysLeft(days) {
  if (days == null || Number.isNaN(Number(days))) return '';
  const d = Number(days);
  if (d <= 0) return '재고 없음';
  return d < 10 ? `약 ${Math.round(d * 10) / 10}일분` : `약 ${Math.round(d)}일분`;
}

/**
 * @param {Array} suggestions inventory_order_suggestions 행
 * @param {{ workplaceName: string, dateKey: string }} ctx dateKey 'YYYY-MM-DD'
 * @returns {{ title: string, body: string, items: { description, category, amount, vendor, product_url }[] }}
 */
export function buildOrderDraft(suggestions, { workplaceName, dateKey }) {
  // 직접 제조 품목은 발주 대상이 아님
  const rows = (suggestions ?? []).filter((s) => Number(s.suggested_qty) > 0 && s.supply_type !== 'made');
  const md = `${dateKey.slice(5, 7)}/${dateKey.slice(8, 10)}`;
  const items = rows.map((s) => {
    const qty = Number(s.suggested_qty);
    const cost = s.unit_cost != null ? Number(s.unit_cost) : null;
    return {
      description: `${s.name} ${fmtQty(qty)}${s.unit ?? ''}`,
      category: CATEGORY_MAP[s.category] ?? '식자재',
      amount: cost != null && cost > 0 ? String(Math.round(cost * qty)) : '',
      vendor: s.vendor ?? '',
      product_url: '',
    };
  });
  const lines = rows.map((s) => {
    const why = s.basis === 'forecast'
      ? `${formatDaysLeft(s.days_left) || '소진 예측'} · 현재 ${fmtQty(s.current_qty)}${s.unit ?? ''}`
      : `최소 수량 미달 · 현재 ${fmtQty(s.current_qty)}${s.unit ?? ''}`;
    return `- ${s.name}: ${fmtQty(s.suggested_qty)}${s.unit ?? ''} (${why})`;
  });
  return {
    title: `발주 — ${md}${workplaceName ? ` ${workplaceName}` : ''}`,
    body: `POS 판매 기반 발주 추천 (${dateKey})\n${lines.join('\n')}`,
    items,
  };
}

/**
 * 수량 표시 — 세는 단위에 소진 단위를 병기. 예) 7개 (3,500ml)
 * @param {number} qty 세는 단위 수량
 * @param {{ unit?: string, usage_unit?: string|null, usage_per_unit?: number|null }} item
 */
export function formatUsageQty(qty, item) {
  const v = Number(qty) || 0;
  const base = `${fmtQty(v)}${item?.unit ?? ''}`;
  const per = Number(item?.usage_per_unit);
  if (!item?.usage_unit || !(per > 0)) return base;
  const usage = Math.round(v * per * 100) / 100;
  return `${base} (${new Intl.NumberFormat('ko-KR').format(usage)}${item.usage_unit})`;
}

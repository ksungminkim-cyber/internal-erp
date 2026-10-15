// src/lib/posOrderMap.js
// 토스플레이스 Order → pos_orders / pos_order_items 행. 순수 함수 (DB·네트워크 없음).

export function toIso(v) {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// item.category 는 { title, code } 객체 (스파이크 확인). 문자열이 오면 그대로 사용.
function categoryTitle(category) {
  if (category == null) return null;
  if (typeof category === 'string') return category;
  return category.title ?? null;
}

// raw 저장용 — 마스킹 카드번호·승인번호가 든 payments[].cardDetails 제거. 입력은 변형하지 않는다.
function sanitizeRaw(order) {
  if (!Array.isArray(order.payments)) return order;
  return { ...order, payments: order.payments.map((p) => ({ ...p, cardDetails: null })) };
}

export function mapOrder(order, { workplaceId, merchantId }) {
  const row = {
    workplace_id: workplaceId,
    merchant_id: String(merchantId),
    external_id: String(order.id),
    order_key: order.orderKey ?? null,
    order_number: order.orderNumber ?? null,
    source: order.source ?? null,
    order_state: order.orderState ?? 'UNDEFINED',
    charge_total: order.chargePrice?.totalAmount ?? null,
    created_at_pos: toIso(order.createdAt),
    updated_at_pos: toIso(order.updatedAt),
    completed_at: toIso(order.completedAt),
    cancelled_at: toIso(order.cancelledAt),
    raw: sanitizeRaw(order),
  };
  const items = (order.lineItems ?? []).map((li, i) => ({
    workplace_id: workplaceId,
    line_no: i,
    item_title: li.item?.title ? String(li.item.title) : '(이름 없음)',
    item_code: li.item?.code ?? null,
    item_category: categoryTitle(li.item?.category),
    quantity: Number(li.quantity ?? 0),
    unit_price: Number(li.itemPrice?.priceValue ?? 0),
    options: li.optionChoices ?? [],
    discounts: li.appliedDiscounts ?? [],
    dining_option: li.diningOption ?? null,
  }));
  return { order: row, items };
}

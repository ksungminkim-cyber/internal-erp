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

// raw 저장용 정제. 입력은 변형하지 않는다.
//  - payments[]: 금액·수단·상태·시각 허용 목록만 (cardDetails·approvedNo·cashReceipt·easyPayDetails 등 제거)
//  - 최상위 memo·requestedInfo, 라인아이템 memo 제거 (고객 연락처 등 자유 입력란)
const PAYMENT_KEEP = ['id', 'state', 'sourceType', 'paymentMethod', 'amount', 'taxAmount', 'supplyAmount',
  'taxExemptAmount', 'tipAmount', 'approvedAt', 'cancelledAt'];

function sanitizeRaw(order) {
  const { memo, requestedInfo, ...rest } = order;
  void memo; void requestedInfo;
  return {
    ...rest,
    payments: Array.isArray(order.payments)
      ? order.payments.map((p) => Object.fromEntries(PAYMENT_KEEP.filter((k) => k in p).map((k) => [k, p[k]])))
      : order.payments,
    lineItems: Array.isArray(order.lineItems)
      ? order.lineItems.map(({ memo: liMemo, ...li }) => { void liMemo; return li; })
      : order.lineItems,
  };
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

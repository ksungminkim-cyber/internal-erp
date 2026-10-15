// src/lib/posSyncHelpers.js
// 동기화 라우트의 순수 보조 함수.

/**
 * 라인아이템 upsert 뒤 "꼬리 삭제"용 그룹. 같은 아이템 개수를 가진 주문끼리 묶어
 * `delete where order_id in (...) and line_no >= count` 를 그룹당 한 번만 날린다.
 * @param {{ orderId: string, count: number }[]} entries
 * @returns {{ count: number, orderIds: string[] }[]} count 오름차순
 */
export function groupByItemCount(entries) {
  const m = new Map();
  for (const { orderId, count } of entries) {
    if (!m.has(count)) m.set(count, []);
    m.get(count).push(orderId);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([count, orderIds]) => ({ count, orderIds }));
}

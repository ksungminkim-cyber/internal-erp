// src/lib/inboundMatch.js
// 승인된 지출결의서 라인 → 재고 품목 매칭 (입고 확인 화면용). 순수 로직.
import { normalizeTitle } from './usageSuggest.js';

/** 설명 끝의 "숫자+단위" 에서 수량. 예) '원두 3봉' → 3, '우유 1L 12개' → 12. 없으면 null */
export function parseLineQty(description) {
  const m = String(description ?? '').trim().match(/(\d+(?:\.\d+)?)\s*[가-힣a-zA-Z]+$/);
  return m ? Number(m[1]) : null;
}

/** 승인 → 입고 일수. 잘못된 값·0~30일 밖이면 null (리드타임 보정에 쓰지 않음) */
export function leadDaysBetween(decidedAt, now = new Date()) {
  if (!decidedAt) return null;
  // Postgres 의 마이크로초(6자리) 소수는 Date 가 못 읽을 수 있어 밀리초로 자른다
  const t = new Date(String(decidedAt).replace(/(\.\d{3})\d+/, '$1')).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.round((now.getTime() - t) / 86400000);
  return days >= 0 && days <= 30 ? days : null;
}

/** 리드타임을 관측값 쪽으로 절반 당긴다 */
export function blendLeadTime(current, observed) {
  const cur = Number.isFinite(Number(current)) && current != null ? Number(current) : observed;
  return Math.round((cur + observed) / 2);
}

/**
 * @param {{ id, description, amount, inventory_item_id?, qty? }[]} expenseItems
 * @param {{ id, name }[]} inventoryItems
 * @returns {{ expenseItemId, description, amount, itemId: string|null, qty: number|null, auto: boolean }[]}
 */
export function matchInboundLines(expenseItems, inventoryItems) {
  const inv = (inventoryItems ?? []).map((i) => ({ id: i.id, n: normalizeTitle(i.name) })).filter((i) => i.n);
  return (expenseItems ?? []).map((e) => {
    if (e.inventory_item_id) {
      return { expenseItemId: e.id, description: e.description, amount: e.amount, itemId: e.inventory_item_id, qty: e.qty == null ? parseLineQty(e.description) : Number(e.qty), auto: false };
    }
    const d = normalizeTitle(e.description);
    // 설명이 품목명을 포함하는 것 중 가장 긴 품목명 ("원두" 가 "디카페인 원두" 라인에 붙지 않도록)
    const hit = inv.filter((i) => d.includes(i.n)).sort((a, b) => b.n.length - a.n.length)[0];
    return { expenseItemId: e.id, description: e.description, amount: e.amount, itemId: hit?.id ?? null, qty: hit ? parseLineQty(e.description) : null, auto: !!hit };
  });
}

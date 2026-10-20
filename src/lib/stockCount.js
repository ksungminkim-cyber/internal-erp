// src/lib/stockCount.js
// 재고 실사(한 화면에서 세기) — 입력값을 조정 거래로 바꾸는 순수 로직.

/**
 * @param {{ itemId: string, counted: number|string, unit?: string }[]} lines 입력 행 (counted '' 이면 건너뜀)
 * @param {{ id: string, current_qty: number, unit: string }[]} items 저장 시점의 품목 (서버에서 최신값으로 다시 읽은 것)
 * @param {{ dateKey: string }} ctx 'YYYY-MM-DD'
 * @returns {{ transactions: { item_id, type:'adjust', qty_delta, note }[], unitChanges: { id, unit }[], countedIds: string[] }}
 */
export function buildCountPlan(lines, items, { dateKey }) {
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const note = `실사 ${String(dateKey).slice(5, 7)}/${String(dateKey).slice(8, 10)}`;
  const transactions = [], unitChanges = [], countedIds = [];
  for (const line of lines ?? []) {
    const item = byId.get(line.itemId);
    if (!item) continue;
    if (line.counted === '' || line.counted == null) continue;
    const counted = Number(line.counted);
    if (!Number.isFinite(counted) || counted < 0) continue;
    countedIds.push(item.id);
    const delta = Math.round((counted - Number(item.current_qty || 0)) * 1000) / 1000;
    if (delta !== 0) transactions.push({ item_id: item.id, type: 'adjust', qty_delta: delta, note });
    const unit = String(line.unit ?? '').trim();
    if (unit && unit !== item.unit) unitChanges.push({ id: item.id, unit });
  }
  return { transactions, unitChanges, countedIds };
}

/** 마지막 실사 표시 — '' | '실사 오늘' | '실사 N일 전' (KST 날짜 기준) */
export function formatCountedAgo(lastCountedAt, now = new Date()) {
  if (!lastCountedAt) return '';
  const kstDay = (d) => Math.floor((new Date(d).getTime() + 9 * 3600 * 1000) / 86400000);
  const days = kstDay(now) - kstDay(lastCountedAt);
  if (days <= 0) return '실사 오늘';
  return `실사 ${days}일 전`;
}

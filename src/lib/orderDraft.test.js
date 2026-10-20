// src/lib/orderDraft.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderDraft, formatDaysLeft, formatUsageQty, vendorsOf } from './orderDraft.js';

const suggestions = [
  { inventory_item_id: 'a', name: '아이스 컵', unit: '개', category: '비품', vendor: null, suggested_qty: 150, unit_cost: 80, days_left: 1.5, basis: 'forecast' },
  { inventory_item_id: 'b', name: '우유 1L', unit: '개', category: '음료/시럽', vendor: '매일우유', suggested_qty: 12, unit_cost: null, days_left: 0.8, basis: 'forecast' },
  { inventory_item_id: 'c', name: '참 크래커', unit: '박스', category: '식자재', vendor: null, suggested_qty: 2, unit_cost: 15000, days_left: null, basis: 'min_qty' },
  { inventory_item_id: 'd', name: '핫 컵', unit: '개', category: '비품', vendor: null, suggested_qty: 0, unit_cost: 50, days_left: 9, basis: 'forecast' },
];

test('buildOrderDraft: 권장 수량 > 0 품목만, 제목·본문·항목', () => {
  const d = buildOrderDraft(suggestions, { workplaceName: '녹턴', dateKey: '2026-10-16' });
  assert.equal(d.title, '발주 — 10/16 녹턴');
  assert.equal(d.items.length, 3);
  assert.deepEqual(d.items[0], { description: '아이스 컵 150개', category: '비품', amount: '12000', vendor: '', product_url: '', inventory_item_id: 'a', qty: 150 });
  assert.deepEqual(d.items[1], { description: '우유 1L 12개', category: '음료/시럽', amount: '', vendor: '매일우유', product_url: '', inventory_item_id: 'b', qty: 12 });
  assert.equal(d.items[2].amount, '30000');
  assert.match(d.body, /아이스 컵.*약 1\.5일분/);
  assert.match(d.body, /참 크래커.*최소 수량/);
});

test('buildOrderDraft: 재고 카테고리 → 기안 분류 (컵·뚜껑/청소·세제/포장은 소모품, 모르면 식자재)', () => {
  const mk = (category) => buildOrderDraft([{ ...suggestions[0], category }], { workplaceName: '녹턴', dateKey: '2026-10-16' }).items[0].category;
  assert.equal(mk('컵·뚜껑'), '소모품');
  assert.equal(mk('청소·세제'), '소모품');
  assert.equal(mk('주류'), '주류');
  assert.equal(mk('이상한값'), '식자재');
  assert.equal(mk(null), '식자재');
});

test('formatDaysLeft', () => {
  assert.equal(formatDaysLeft(1.5), '약 1.5일분');
  assert.equal(formatDaysLeft(0), '재고 없음');
  assert.equal(formatDaysLeft(null), '');
  assert.equal(formatDaysLeft(12.3), '약 12일분');
});

test('buildOrderDraft: 매장명이 없으면 제목 끝에 공백이 없다', () => {
  const d = buildOrderDraft(suggestions, { workplaceName: '', dateKey: '2026-10-16' });
  assert.equal(d.title, '발주 — 10/16');
});

test('buildOrderDraft: 직접 제조 품목은 기안 항목에서 제외', () => {
  const d = buildOrderDraft([
    ...suggestions,
    { inventory_item_id: 'e', name: '스카치 크림', unit: 'g', category: '식자재', vendor: null, suggested_qty: 300, unit_cost: null, days_left: 0.5, basis: 'forecast', supply_type: 'made' },
  ], { workplaceName: '녹턴', dateKey: '2026-10-16' });
  assert.equal(d.items.length, 3);
  assert.ok(!d.items.some((it) => it.description.startsWith('스카치 크림')));
  assert.ok(!d.body.includes('스카치 크림'));
});

test('formatUsageQty: 소진 단위가 있으면 함께 표시', () => {
  assert.equal(formatUsageQty(7, { unit: '개', usage_unit: 'ml', usage_per_unit: 500 }), '7개 (3,500ml)');
  assert.equal(formatUsageQty(0.5, { unit: '봉', usage_unit: 'g', usage_per_unit: 1000 }), '0.5봉 (500g)');
  assert.equal(formatUsageQty(3, { unit: '개' }), '3개');
});

// ── 입고 연결·거래처별 묶기 ──
test('buildOrderDraft: 항목에 재고 품목 id 와 수량을 함께 싣는다', () => {
  const d = buildOrderDraft(suggestions, { workplaceName: '녹턴', dateKey: '2026-10-20' });
  assert.equal(d.items[0].inventory_item_id, 'a');
  assert.equal(d.items[0].qty, 150);
});

test('vendorsOf: 발주 품목의 거래처별 건수 (없음 포함, 제조 품목 제외)', () => {
  const v = vendorsOf([
    ...suggestions,
    { inventory_item_id: 'e', name: '스카치 크림', unit: 'g', category: '식자재', vendor: '매일우유', suggested_qty: 300, basis: 'forecast', supply_type: 'made' },
  ]);
  assert.deepEqual(v, [{ vendor: '매일우유', count: 1 }, { vendor: '', count: 2 }]);
});

test('buildOrderDraft: vendor 를 지정하면 그 거래처 품목만, 제목에 거래처명', () => {
  const d = buildOrderDraft(suggestions, { workplaceName: '녹턴', dateKey: '2026-10-20', vendor: '매일우유' });
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].description, '우유 1L 12개');
  assert.equal(d.title, '발주 — 10/20 녹턴 · 매일우유');
  const none = buildOrderDraft(suggestions, { workplaceName: '녹턴', dateKey: '2026-10-20', vendor: '' });
  assert.equal(none.items.length, 2);
});

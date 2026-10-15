// src/lib/posOrderMap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapOrder, toIso } from './posOrderMap.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./__fixtures__/toss-order.json', import.meta.url), 'utf8'));
const ctx = { workplaceId: '00000000-0000-0000-0000-000000000001', merchantId: '182323' };

test('toIso: 숫자 epoch ms, ISO 문자열, 빈 값', () => {
  assert.equal(toIso(1791966421918), '2026-10-14T08:27:01.918Z');
  assert.equal(toIso('2026-10-14T17:27:01+09:00'), '2026-10-14T08:27:01.000Z');
  assert.equal(toIso(null), null);
  assert.equal(toIso(undefined), null);
});

test('완료 주문: 주문 행 매핑', () => {
  const { order } = mapOrder(fixture, ctx);
  assert.equal(order.workplace_id, ctx.workplaceId);
  assert.equal(order.merchant_id, '182323');
  assert.equal(order.external_id, String(fixture.id));
  assert.equal(order.order_key, fixture.orderKey);
  assert.equal(order.order_state, fixture.orderState);
  assert.equal(order.charge_total, fixture.chargePrice.totalAmount);
  assert.equal(order.completed_at, toIso(fixture.completedAt));
  assert.equal(order.raw.id, fixture.id);
  assert.equal(order.raw.lineItems.length, fixture.lineItems.length);
});

test('raw: payments[].cardDetails 는 제거, 입력 객체는 변형하지 않음', () => {
  const withCard = JSON.parse(JSON.stringify(fixture));
  withCard.payments[0].cardDetails = { cardNo: '37918395*******', approvalNo: '75632250' };
  const { order } = mapOrder(withCard, ctx);
  assert.equal(order.raw.payments[0].cardDetails, null);
  assert.equal(order.raw.payments[0].amount, withCard.payments[0].amount);
  assert.deepEqual(withCard.payments[0].cardDetails, { cardNo: '37918395*******', approvalNo: '75632250' });
});

test('라인아이템: 순서·수량·단가·옵션·카테고리 제목', () => {
  const { items } = mapOrder(fixture, ctx);
  assert.equal(items.length, fixture.lineItems.length);
  items.forEach((it, i) => {
    const li = fixture.lineItems[i];
    assert.equal(it.line_no, i);
    assert.equal(it.workplace_id, ctx.workplaceId);
    assert.equal(it.item_title, li.item.title);
    assert.equal(it.item_code, li.item.code ?? null);
    assert.equal(it.item_category, li.item.category?.title ?? null);
    assert.equal(it.quantity, Number(li.quantity));
    assert.equal(it.unit_price, Number(li.itemPrice.priceValue));
    assert.deepEqual(it.options, li.optionChoices ?? []);
    assert.deepEqual(it.discounts, li.appliedDiscounts ?? []);
    assert.equal(it.dining_option, li.diningOption ?? null);
  });
});

test('취소 주문: order_state CANCELLED, cancelled_at 채움', () => {
  const cancelled = { ...fixture, orderState: 'CANCELLED', cancelledAt: '2026-10-14T10:00:00+09:00', completedAt: null };
  const { order } = mapOrder(cancelled, ctx);
  assert.equal(order.order_state, 'CANCELLED');
  assert.equal(order.cancelled_at, '2026-10-14T01:00:00.000Z');
  assert.equal(order.completed_at, null);
});

test('lineItems 비어도 주문은 생성', () => {
  const { order, items } = mapOrder({ ...fixture, lineItems: [] }, ctx);
  assert.equal(order.external_id, String(fixture.id));
  assert.deepEqual(items, []);
});

test('item.code 없음 → null, 이름 없음 → 대체 텍스트, 카테고리 문자열도 허용', () => {
  const li = { ...fixture.lineItems[0], item: { title: '', category: '디저트' } };
  const { items } = mapOrder({ ...fixture, lineItems: [li] }, ctx);
  assert.equal(items[0].item_code, null);
  assert.equal(items[0].item_title, '(이름 없음)');
  assert.equal(items[0].item_category, '디저트');
});

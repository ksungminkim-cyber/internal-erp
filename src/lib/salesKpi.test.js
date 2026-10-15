// src/lib/salesKpi.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBarCategory, computeKpi, unitsToTarget } from './salesKpi.js';

test('isBarCategory: 칵테일·위스키·스피리츠·맥주·와인·하이볼은 바', () => {
  for (const c of ['칵테일', '위스키 (버번)', '위스키 (싱글몰트)', '스피리츠', '맥주', '와인', '하이볼']) assert.equal(isBarCategory(c), true, c);
  for (const c of ['시그니처', '커피', '베이커리', '기본', '셋트', '', null]) assert.equal(isBarCategory(c), false, String(c));
});

test('computeKpi: 진행률·남은 금액·남은 일수·하루 필요액', () => {
  const k = computeKpi({ target: 20_000_000, monthTotal: 10_402_688, todayKey: '2026-10-16' });
  assert.equal(k.remaining, 9_597_312);
  assert.equal(k.progress, 0.52);                 // 소수 둘째 자리
  assert.equal(k.daysInMonth, 31);
  assert.equal(k.daysLeft, 16);                   // 오늘 포함 16~31일
  assert.equal(k.perDayNeeded, Math.ceil(9_597_312 / 16));
});

test('computeKpi: 목표 달성 시 남은 금액 0, 진행률 1 초과 허용', () => {
  const k = computeKpi({ target: 1_000_000, monthTotal: 1_200_000, todayKey: '2026-10-31' });
  assert.equal(k.remaining, 0);
  assert.equal(k.progress, 1.2);
  assert.equal(k.daysLeft, 1);
  assert.equal(k.perDayNeeded, 0);
});

test('unitsToTarget: 남은 금액을 상품 평균 단가로 나눠 올림', () => {
  assert.equal(unitsToTarget(9_597_312, { qty: 387, amount: 1_935_000 }), Math.ceil(9_597_312 / 5000));
  assert.equal(unitsToTarget(0, { qty: 10, amount: 50_000 }), 0);
  assert.equal(unitsToTarget(100, { qty: 0, amount: 0 }), null);
});

// src/lib/usageSuggest.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, suggestQty } from './usageSuggest.js';

const recipes = [
  { name: '바닐라 라떼', ingredients: [{ name: '에스프레소 샷', qty: '30', unit: 'g' }, { name: '우유', qty: '180(ICE), 250(HOT)', unit: 'g' }, { name: '바닐라 시럽 ', qty: '20', unit: 'g' }] },
  { name: '아메리카노', ingredients: [{ name: '에스프레소', qty: '2', unit: '샷' }, { name: '물', qty: '200', unit: 'ml' }] },
  { name: '프렌치 토스트', ingredients: [{ name: '브리오슈 식빵', qty: '1', unit: '개' }, { name: '계란', qty: '1', unit: '개' }] },
];

test('normalizeTitle: 공백·대소문자·ICE/HOT·아이스/핫·괄호·하이픈 제거', () => {
  assert.equal(normalizeTitle('바닐라 라떼 ICE'), '바닐라라떼');
  assert.equal(normalizeTitle('ICE) 스카치 크림 라떼'), '스카치크림라떼');
  assert.equal(normalizeTitle('아이스 아메리카노'), '아메리카노');
  assert.equal(normalizeTitle('아메리카노 - Hot'), '아메리카노');
  assert.equal(normalizeTitle('바닐라라떼 Ice'), '바닐라라떼');
});

test('suggestQty: 상품명이 레시피명을 포함하고 품목 키워드가 재료에 맞으면 첫 숫자', () => {
  assert.equal(suggestQty('바닐라 라떼 ICE', '우유 1L', recipes), 180);
  assert.equal(suggestQty('바닐라 라떼 ICE', '바닐라 시럽', recipes), 20);
  assert.equal(suggestQty('바닐라라떼 Ice', '유타 블렌드 원두', recipes), 30);
  assert.equal(suggestQty('아메리카노 ICE', '원두', recipes), 2);
});

test('suggestQty: 토스트 ↔ 식빵', () => {
  assert.equal(suggestQty('프렌치토스트', '프렌치 토스트', recipes), 1);
});

test('suggestQty: 매칭 없으면 null', () => {
  assert.equal(suggestQty('청포도 히비스커스 에이드', '우유 1L', recipes), null);
  assert.equal(suggestQty('아메리카노 ICE', '아이스 컵', recipes), null);
  assert.equal(suggestQty('아메리카노 ICE', '우유 1L', recipes), null);
});

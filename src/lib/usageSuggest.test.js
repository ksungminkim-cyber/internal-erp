// src/lib/usageSuggest.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, temperatureOf, suggestQty } from './usageSuggest.js';

const recipes = [
  { name: '바닐라 라떼', ingredients: [{ name: '에스프레소 샷', qty: '30', unit: 'g' }, { name: '우유', qty: '180(ICE), 250(HOT)', unit: 'ml' }, { name: '바닐라 시럽 ', qty: '20', unit: 'g' }] },
  { name: '아메리카노', ingredients: [{ name: '에스프레소', qty: '2', unit: '샷' }, { name: '물', qty: '200', unit: 'ml' }] },
  { name: '프렌치 토스트', ingredients: [{ name: '브리오슈 식빵', qty: '1', unit: '개' }, { name: '계란', qty: '1', unit: '개' }] },
];

test('normalizeTitle: 공백·대소문자·ICE/HOT·아이스/핫·괄호·하이픈 제거, 아이스크림은 보존', () => {
  assert.equal(normalizeTitle('바닐라 라떼 ICE'), '바닐라라떼');
  assert.equal(normalizeTitle('ICE) 스카치 크림 라떼'), '스카치크림라떼');
  assert.equal(normalizeTitle('아이스 아메리카노'), '아메리카노');
  assert.equal(normalizeTitle('아메리카노 - Hot'), '아메리카노');
  assert.equal(normalizeTitle('바닐라라떼 Ice'), '바닐라라떼');
  assert.equal(normalizeTitle('아이스크림 라떼'), '아이스크림라떼');
});

test('temperatureOf: ICE/HOT 판별, 없으면 null', () => {
  assert.equal(temperatureOf('바닐라 라떼 ICE'), 'ICE');
  assert.equal(temperatureOf('아메리카노 - Hot'), 'HOT');
  assert.equal(temperatureOf('아이스 아메리카노'), 'ICE');
  assert.equal(temperatureOf('핫초코'), 'HOT');
  assert.equal(temperatureOf('프렌치토스트'), null);
});

test('suggestQty: 단위를 함께 돌려주고, 온도 표기가 있는 양은 상품 온도에 맞는 값', () => {
  assert.deepEqual(suggestQty('바닐라 라떼 ICE', '우유 1L', recipes), { qty: 180, unit: 'ml' });
  assert.deepEqual(suggestQty('바닐라 라떼 HOT', '우유 1L', recipes), { qty: 250, unit: 'ml' });
  assert.deepEqual(suggestQty('바닐라 라떼 ICE', '바닐라 시럽', recipes), { qty: 20, unit: 'g' });
  assert.deepEqual(suggestQty('바닐라라떼 Ice', '유타 블렌드 원두', recipes), { qty: 30, unit: 'g' });
  assert.deepEqual(suggestQty('아메리카노 ICE', '원두', recipes), { qty: 2, unit: '샷' });
});

test('suggestQty: 토스트 ↔ 식빵', () => {
  assert.deepEqual(suggestQty('프렌치토스트', '프렌치 토스트', recipes), { qty: 1, unit: '개' });
});

test('suggestQty: 상품명이 레시피명을 포함하는 방향만 (짧은 상품명 "라떼"는 "바닐라 라떼"와 매칭하지 않음)', () => {
  assert.equal(suggestQty('라떼', '우유 1L', recipes), null);
});

test('suggestQty: 매칭 없으면 null', () => {
  assert.equal(suggestQty('청포도 히비스커스 에이드', '우유 1L', recipes), null);
  assert.equal(suggestQty('아메리카노 ICE', '아이스 컵', recipes), null);
  assert.equal(suggestQty('아메리카노 ICE', '우유 1L', recipes), null);
});

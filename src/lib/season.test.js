import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSeason, XMAS_END, NEWYEAR_END } from './season.js';

const pick = (search, now) => pickSeason(search, now, XMAS_END, NEWYEAR_END);
const kst = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h - 9);

test('12월 31일 밤까지는 크리스마스', () => {
  assert.equal(pick('', kst(2026, 11, 17, 10)), 'xmas');
  assert.equal(pick('', kst(2026, 12, 31, 23)), 'xmas');
});

test('1월 1일 0시부터 1월 15일 밤까지는 새해', () => {
  assert.equal(pick('', kst(2027, 1, 1, 0)), 'newyear');
  assert.equal(pick('', kst(2027, 1, 15, 23)), 'newyear');
});

test('1월 16일 0시부터는 꺼진다', () => {
  assert.equal(pick('', kst(2027, 1, 16, 0)), 'off');
});

test('주소의 ?season= 이 날짜보다 우선한다 (미리 보기)', () => {
  assert.equal(pick('?season=newyear', kst(2026, 11, 17)), 'newyear');
  assert.equal(pick('?next=%2Fhome&season=off', kst(2026, 11, 17)), 'off');
  assert.equal(pick('?season=xmas', kst(2027, 3, 1)), 'xmas');
});

test('모르는 값은 무시하고 날짜를 따른다', () => {
  assert.equal(pick('?season=halloween', kst(2026, 11, 17)), 'xmas');
});

test('함수 본문만 떼어 실행해도 같은 결과 (인라인 스크립트로 쓰기 때문)', () => {
  const standalone = new Function(`return (${pickSeason.toString()})`)();
  assert.equal(standalone('?season=newyear', kst(2026, 11, 17), XMAS_END, NEWYEAR_END), 'newyear');
  assert.equal(standalone('', kst(2027, 1, 16), XMAS_END, NEWYEAR_END), 'off');
});

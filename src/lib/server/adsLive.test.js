// src/lib/server/adsLive.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveCacheFresh } from './adsLive.js';

test('liveCacheFresh: 자동 갱신은 5분 캐시, 새로고침 버튼(force)은 15초만 캐시', () => {
  // 자동(5분 주기) — 5분 안이면 캐시 사용
  assert.equal(liveCacheFresh(60_000, false), true);
  assert.equal(liveCacheFresh(4 * 60_000 + 59_000, false), true);
  assert.equal(liveCacheFresh(5 * 60_000, false), false);
  // 새로고침 버튼 — 1분 지난 캐시는 버리고 다시 조회 (이게 안 돼서 "눌러도 안 바뀜")
  assert.equal(liveCacheFresh(60_000, true), false);
  // 연타 방지: 15초 안에는 버튼이라도 캐시 (광고 API 호출 한도 보호)
  assert.equal(liveCacheFresh(5_000, true), true);
  assert.equal(liveCacheFresh(15_000, true), false);
});

// src/lib/server/tossPlace.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOrders } from './tossPlace.js';

const env = { TOSS_PLACE_ACCESS_KEY: 'ak', TOSS_PLACE_SECRET_KEY: 'sk' };
const ok = (arr, headers = {}) => ({
  status: 200, ok: true,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => ({ resultType: 'SUCCESS', success: arr }),
  text: async () => JSON.stringify({ resultType: 'SUCCESS', success: arr }),
});
const fail = (status, body, headers = {}) => ({
  status, ok: false,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const order = (id) => ({ id, orderState: 'COMPLETED', lineItems: [] });

test('헤더·경로·쿼리 구성', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url: String(url), init }); return ok([]); };
  await fetchOrders({ merchantId: '182323', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }, { fetch, env });
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, 'https://open-api.tossplace.com/api-public/openapi/v1/merchants/182323/order/orders');
  assert.equal(u.searchParams.get('from'), '2026-10-01T00:00:00.000Z');
  assert.equal(u.searchParams.get('to'), '2026-10-02T00:00:00.000Z');
  assert.equal(u.searchParams.get('page'), '1');
  assert.equal(u.searchParams.get('size'), '100');
  assert.equal(calls[0].init.headers['x-access-key'], 'ak');
  assert.equal(calls[0].init.headers['x-secret-key'], 'sk');
});

test('페이지네이션: size 미만이 올 때까지 page 증가', async () => {
  const pages = [Array.from({ length: 100 }, (_, i) => order(`a${i}`)), [order('b0'), order('b1')]];
  let n = 0;
  const fetch = async () => ok(pages[n++]);
  const list = await fetchOrders({ merchantId: '1', from: new Date(0), to: new Date(1000) }, { fetch, env });
  assert.equal(list.length, 102);
  assert.equal(n, 2);
});

test('429: 리셋 시각까지 대기 후 1회 재시도', async () => {
  let n = 0; const waited = [];
  const resetAt = Date.now() + 300;
  const fetch = async () => (n++ === 0
    ? fail(429, { resultType: 'FAIL', error: { errorCode: '4290', reason: 'rate' } }, { 'x-ratelimit-reset': String(resetAt) })
    : ok([order('x')]));
  const sleep = async (ms) => { waited.push(ms); };
  const list = await fetchOrders({ merchantId: '1', from: new Date(0), to: new Date(1) }, { fetch, sleep, env });
  assert.equal(list.length, 1);
  assert.equal(n, 2);
  assert.ok(waited[0] > 0 && waited[0] <= 1000);
});

test('429 두 번이면 throw', async () => {
  const fetch = async () => fail(429, { resultType: 'FAIL', error: { errorCode: '4290', reason: 'rate' } }, { 'x-ratelimit-reset': String(Date.now()) });
  await assert.rejects(
    fetchOrders({ merchantId: '1', from: new Date(0), to: new Date(1) }, { fetch, sleep: async () => {}, env }),
    (e) => e.status === 429
  );
});

test('403: 오류 코드·사유를 메시지에 포함', async () => {
  const fetch = async () => fail(403, { resultType: 'FAIL', error: { errorCode: '4030', reason: '해당 기능에 대한 접근 권한이 없습니다' } });
  await assert.rejects(
    fetchOrders({ merchantId: '1', from: new Date(0), to: new Date(1) }, { fetch, env }),
    (e) => e.status === 403 && /4030/.test(e.message) && /접근 권한/.test(e.message)
  );
});

test('키 미설정이면 호출 전에 throw', async () => {
  await assert.rejects(
    fetchOrders({ merchantId: '1', from: new Date(0), to: new Date(1) }, { fetch: async () => ok([]), env: {} }),
    /TOSS_PLACE_ACCESS_KEY/
  );
});

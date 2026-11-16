// src/lib/reads.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWith } from './reads.js';

const res = (status, body, { type = 'application/json', redirected = false } = {}) => ({
  ok: status >= 200 && status < 300, status, redirected,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
  json: async () => body,
});

test('readWith: /api/read 로 이름·인자를 보내고 data 를 돌려준다', async () => {
  let sent;
  const fetchFn = async (url, init) => { sent = { url, init }; return res(200, { data: { n: 1 } }); };
  assert.deepEqual(await readWith(fetchFn, 'getOrderSuggestions', [{ workplaceId: 'w' }]), { n: 1 });
  assert.equal(sent.url, '/api/read');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body), { fn: 'getOrderSuggestions', args: [{ workplaceId: 'w' }] });
});

test('readWith: 값이 없으면(undefined/null 반환) 그대로', async () => {
  assert.equal(await readWith(async () => res(200, {}), 'x', []), undefined);
  assert.equal(await readWith(async () => res(200, { data: null }), 'x', []), null);
});

test('readWith: 서버 오류는 메시지를 담아 던진다 (서버 액션이 throw 하던 것과 같은 동작)', async () => {
  await assert.rejects(readWith(async () => res(500, { error: 'pos_product_sales: boom' }), 'getProductSales', []), /pos_product_sales: boom/);
});

test('readWith: 로그인 화면으로 넘겨졌으면(세션 만료) 알기 쉬운 오류', async () => {
  await assert.rejects(readWith(async () => res(200, null, { type: 'text/html', redirected: true }), 'x', []), /로그인/);
});

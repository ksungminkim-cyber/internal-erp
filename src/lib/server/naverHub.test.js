// src/lib/server/naverHub.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSearchTrend, fetchBlogCount, chunk } from './naverHub.js';

const env = { NAVER_HUB_KEY_ID: 'id', NAVER_HUB_KEY: 'key' };
const ok = (body) => ({ status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) });

test('chunk: 5개씩 나눔', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5, 6, 7], 5), [[1, 2, 3, 4, 5], [6, 7]]);
});

test('fetchSearchTrend: 허브 주소·헤더·본문, 결과를 키워드별 시계열로', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return ok({ results: [
      { title: '무화과', keywords: ['무화과'], data: [{ period: '2026-10-05', ratio: 10 }, { period: '2026-10-12', ratio: 30 }] },
    ] });
  };
  const r = await fetchSearchTrend({ keywords: ['무화과'], startDate: '2026-10-05', endDate: '2026-10-18' }, { fetch, env });
  assert.equal(calls[0].url, 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-NCP-APIGW-API-KEY-ID'], 'id');
  assert.equal(calls[0].init.headers['X-NCP-APIGW-API-KEY'], 'key');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.timeUnit, 'week');
  assert.deepEqual(body.keywordGroups, [{ groupName: '무화과', keywords: ['무화과'] }]);
  assert.deepEqual(r, { '무화과': [{ period: '2026-10-05', ratio: 10 }, { period: '2026-10-12', ratio: 30 }] });
});

test('fetchSearchTrend: 키워드 6개는 2번 호출', async () => {
  let n = 0;
  const fetch = async (url, init) => { n++; const g = JSON.parse(init.body).keywordGroups; return ok({ results: g.map((x) => ({ title: x.groupName, keywords: x.keywords, data: [] })) }); };
  const r = await fetchSearchTrend({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'], startDate: '2026-10-05', endDate: '2026-10-18' }, { fetch, env });
  assert.equal(n, 2);
  assert.equal(Object.keys(r).length, 6);
});

test('fetchBlogCount: GET 블로그 검색, total 반환', async () => {
  const fetch = async (url) => { assert.ok(String(url).startsWith('https://naverapihub.apigw.ntruss.com/search/v1/blog?')); return ok({ total: 1234 }); };
  assert.equal(await fetchBlogCount('무화과 디저트', { fetch, env }), 1234);
});

test('오류 상태면 throw (키 누락 포함)', async () => {
  await assert.rejects(fetchBlogCount('x', { fetch: async () => ok({}), env: {} }), /NAVER_HUB_KEY_ID/);
  await assert.rejects(fetchBlogCount('x', { fetch: async () => ({ status: 401, ok: false, json: async () => ({}), text: async () => 'nope' }), env }), /401/);
});

test('fetchSearchTrend: anchor 를 주면 매 요청에 포함되고 anchor 평균으로 정규화', async () => {
  const fetch = async (url, init) => {
    const g = JSON.parse(init.body).keywordGroups;
    assert.ok(g.some((x) => x.groupName === '카페'), 'anchor 포함');
    return ok({ results: g.map((x) => ({ title: x.groupName, keywords: x.keywords,
      data: x.groupName === '카페' ? [{ period: 'w1', ratio: 50 }, { period: 'w2', ratio: 50 }] : [{ period: 'w1', ratio: 10 }, { period: 'w2', ratio: 20 }] })) });
  };
  const r = await fetchSearchTrend({ keywords: ['a', 'b', 'c', 'd', 'e'], startDate: 'x', endDate: 'y', anchor: '카페' }, { fetch, env });
  assert.deepEqual(Object.keys(r).sort(), ['a', 'b', 'c', 'd', 'e']);        // anchor 는 결과에서 제외
  assert.deepEqual(r.a.map((d) => d.ratio), [20, 40]);                      // 10/50*100, 20/50*100
});

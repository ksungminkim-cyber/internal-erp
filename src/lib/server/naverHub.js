// src/lib/server/naverHub.js
// NAVER API HUB (네이버 클라우드) 클라이언트 — 검색어 트렌드(데이터랩) + 블로그 검색 게시물 수. 서버 전용.
// 문서: https://naverapihub.apigw.ntruss.com — 헤더 X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY

const BASE = 'https://naverapihub.apigw.ntruss.com';
const MAX_GROUPS = 5; // 검색어 트렌드 요청당 키워드 그룹 최대 5개 (anchor 포함)

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function headers(env) {
  if (!env.NAVER_HUB_KEY_ID || !env.NAVER_HUB_KEY) throw new Error('NAVER_HUB_KEY_ID / NAVER_HUB_KEY 환경변수가 없습니다');
  return { 'X-NCP-APIGW-API-KEY-ID': env.NAVER_HUB_KEY_ID, 'X-NCP-APIGW-API-KEY': env.NAVER_HUB_KEY, 'Content-Type': 'application/json' };
}

async function readJson(res, label) {
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 키워드별 주간 검색 지수. 반환: { [keyword]: [{ period:'YYYY-MM-DD', ratio }] }
 * 데이터랩 지수는 한 요청 안의 키워드끼리만 상대값(최대 100)이라, anchor 키워드를 매 요청에 넣고
 * anchor 평균을 100으로 맞춰 요청 간에 비교 가능하게 만든다. anchor 는 결과에서 제외.
 * @param {{ keywords: string[], startDate: string, endDate: string, anchor?: string|null }} p
 */
export async function fetchSearchTrend({ keywords, startDate, endDate, anchor = null }, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const h = headers(env);
  const out = {};
  const per = anchor ? MAX_GROUPS - 1 : MAX_GROUPS;
  for (const group of chunk(keywords.filter((k) => k !== anchor), per)) {
    const names = anchor ? [anchor, ...group] : group;
    const res = await fetchFn(`${BASE}/search-trend/v1/search`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        startDate, endDate, timeUnit: 'week',
        keywordGroups: names.map((k) => ({ groupName: k, keywords: [k] })),
      }),
    });
    const body = await readJson(res, 'naver search-trend');
    const results = body.results ?? [];
    let scale = 1;
    if (anchor) {
      const a = results.find((r) => r.title === anchor);
      const vals = (a?.data ?? []).map((d) => Number(d.ratio) || 0);
      const mean = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0;
      scale = mean > 0 ? 100 / mean : 1;
    }
    for (const r of results) {
      if (r.title === anchor) continue;
      out[r.title] = (r.data ?? []).map((d) => ({ period: d.period, ratio: Math.round((Number(d.ratio) || 0) * scale * 100) / 100 }));
    }
  }
  return out;
}

/** 블로그 검색 총 게시물 수 */
export async function fetchBlogCount(query, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const h = headers(env);
  const res = await fetchFn(`${BASE}/search/v1/blog?query=${encodeURIComponent(query)}&display=1`, { headers: h });
  const body = await readJson(res, 'naver blog');
  return Number(body.total) || 0;
}

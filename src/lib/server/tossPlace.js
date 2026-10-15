// src/lib/server/tossPlace.js
// 토스플레이스 Open API 클라이언트 (서버 전용). 주문 목록 조회만 담당.
// 문서: https://docs.tossplace.com/reference/open-api/order/order-methods.html

const BASE = 'https://open-api.tossplace.com/api-public/openapi/v1';
const PAGE_SIZE = 100;
const MAX_PAGES = 200;   // 20,000건. API 가 page 를 무시하는 등의 이상 상황에서 무한 루프 방지

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toQueryTs(v) {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function apiError(status, body) {
  const code = body?.error?.errorCode ?? '';
  const reason = body?.error?.reason ?? '';
  const err = new Error(`toss api ${status}${code ? ` [${code}]` : ''}${reason ? ` ${reason}` : ''}`.slice(0, 300));
  err.status = status;
  return err;
}

async function getPage(url, headers, { fetch, sleep }) {
  let res = await fetch(url, { headers });
  if (res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;   // epoch ms
    const wait = Math.min(Math.max(reset - Date.now(), 100), 1000);
    await sleep(wait);
    res = await fetch(url, { headers });
  }
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || body?.resultType !== 'SUCCESS') throw apiError(res.status, body);
  const s = body.success;
  if (s == null) return [];            // 0건 구간을 null 로 주는 경우 대비
  if (Array.isArray(s)) return s;
  if (Array.isArray(s?.orders)) return s.orders;
  const err = new Error('toss api 응답 형식이 예상과 다릅니다 (success 가 배열이 아님)');
  err.status = res.status;
  throw err;
}

/**
 * 기간 내 주문 전체 (COMPLETED + CANCELLED, 토스 기본값). 페이지를 끝까지 돈다.
 * @param {{ merchantId: string|number, from: Date|string, to: Date|string }} p
 * @param {{ fetch?: typeof fetch, sleep?: (ms:number)=>Promise<void>, env?: Record<string,string> }} [deps]
 */
export async function fetchOrders({ merchantId, from, to }, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  if (!env.TOSS_PLACE_ACCESS_KEY || !env.TOSS_PLACE_SECRET_KEY) {
    throw new Error('TOSS_PLACE_ACCESS_KEY / TOSS_PLACE_SECRET_KEY 환경변수가 없습니다');
  }
  const headers = {
    'x-access-key': env.TOSS_PLACE_ACCESS_KEY,
    'x-secret-key': env.TOSS_PLACE_SECRET_KEY,
    'Content-Type': 'application/json',
  };
  const all = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`toss api 페이지가 ${MAX_PAGES}을 넘었습니다 (merchant ${merchantId})`);
    const qs = new URLSearchParams({
      from: toQueryTs(from), to: toQueryTs(to),
      page: String(page), size: String(PAGE_SIZE), sortOrder: 'ASC',
    });
    const list = await getPage(`${BASE}/merchants/${merchantId}/order/orders?${qs}`, headers, { fetch: fetchFn, sleep });
    all.push(...list);
    if (list.length < PAGE_SIZE) break;
  }
  return all;
}

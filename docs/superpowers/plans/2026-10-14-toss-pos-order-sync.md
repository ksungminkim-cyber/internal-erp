# 토스 POS 주문 수집 (1단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 토스플레이스 Open API에서 두 매장의 주문을 10분 주기로 가져와 상품별 일 판매량을 쌓고, 매출 페이지에서 기간별 상품 판매를 보여준다.

**Architecture:** Supabase pg_cron이 pg_net으로 Next.js 라우트 `/api/pos/toss/sync`를 호출한다. 라우트는 토스 주문 조회 API를 폴링해 `pos_orders`·`pos_order_items`에 upsert하고 `pos_sync_log`에 기록한다. SQL 뷰 `pos_product_daily`가 완료 주문을 매장×상품×일로 집계하고, 서버 액션 `getProductSales`가 이를 매출 페이지의 `ProductSalesCard`에 공급한다.

**Tech Stack:** Next.js 16 (App Router, JS), Supabase (Postgres, pg_cron, pg_net), Node 24 내장 `node --test`, 토스플레이스 Open API v1.

스펙: `docs/superpowers/specs/2026-10-14-toss-pos-order-sync-design.md`

## Global Constraints

- 새 npm 의존성 추가 금지. 테스트는 Node 내장 `node --test`만 사용.
- 기존 `sales_daily`, `/api/pos/toss/webhook` 라우트는 수정하지 않는다.
- 토스 API 기본 URL `https://open-api.tossplace.com/api-public/openapi/v1`, 헤더 `x-access-key`, `x-secret-key`, `Content-Type: application/json`.
- 환경변수 이름: `TOSS_PLACE_ACCESS_KEY`, `TOSS_PLACE_SECRET_KEY`, `POS_SYNC_SECRET`.
- 토스 응답 봉투: 성공 `{ resultType: "SUCCESS", success: <결과> }`, 실패 `{ resultType: "FAIL", error: { errorCode, reason } }`.
- 주문 목록 응답 타입은 `Order[]`. `chargePrice.totalAmount`가 최종 금액.
- 테이블 쓰기는 서비스 롤만. 서비스 롤 클라이언트는 `src/app/(app)/sales/actions.js`의 `getServiceClient()` 패턴을 따른다.
- 매장 merchantId: 나울 `166568`, 녹턴 `182323`. `workplaces.pos_store_code`에 저장.
- 마이그레이션은 사용자가 Supabase Dashboard → SQL Editor에서 수동 실행한다. 파일 머리에 그 안내 주석을 넣는다.
- 날짜 키는 KST. 서버에서는 `src/lib/date.js`의 `kstDateKey`, 클라이언트에서는 `ymd`를 쓴다.
- 커밋 메시지는 기존 관례(`feat:`, `fix:`, `docs:` + 한국어)를 따르고 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`을 붙인다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20261014_37_toss_pos_orders.sql` (신규) | 테이블 3개, 뷰, RLS, workplaces 매핑, pg_cron 2개 |
| `src/lib/posOrderMap.js` (신규, 순수) | 토스 `Order` → `pos_orders` 행 + `pos_order_items` 행 배열 |
| `src/lib/posOrderMap.test.js` (신규) | 위 함수 단위 테스트 |
| `src/lib/__fixtures__/toss-order.json` (신규) | 테스트 매장 실제 주문 1건(개인정보 제거) |
| `src/lib/server/tossPlace.js` (신규) | 토스 API 호출: 페이지네이션, 429 재시도, 봉투 해제 |
| `src/lib/server/tossPlace.test.js` (신규) | 가짜 fetch로 페이지네이션·429·오류 테스트 |
| `src/app/api/pos/toss/sync/route.js` (신규) | 비밀키 인증, 매장 순회, upsert, 로그 |
| `src/app/(app)/sales/actions.js` (수정) | `getProductSales` 추가 |
| `src/app/(app)/sales/ProductSalesCard.js` (신규) | 기간 칩 + 상품별 표 + 마지막 동기화 |
| `src/app/(app)/sales/page.js` (수정) | 카드 마운트 한 줄 |
| `.env.local.example` (수정) | 환경변수 3개 |
| `package.json` (수정) | `test` 스크립트 |

---

### Task 0: 스파이크 — 미지수 확정 (앱 설치 후)

전제: 개발자센터에서 테스트 가맹점(182323, 166568)에 `mclean-counter` 앱 사용 설정이 켜져 있어야 한다. 켜지기 전엔 모든 매장 API가 403 `4030`을 돌려준다. `.env.local`에 `TOSS_PLACE_ACCESS_KEY`, `TOSS_PLACE_SECRET_KEY`가 있어야 한다.

**Files:**
- Create: `scripts/toss-spike.mjs` (커밋하지 않음, 스파이크 후 삭제)
- Modify: `docs/superpowers/specs/2026-10-14-toss-pos-order-sync-design.md` "첫 작업에서 확정할 미지수" 절
- Create: `src/lib/__fixtures__/toss-order.json`

**Interfaces:**
- Produces: 확정된 `from`/`to` 형식, 응답 봉투 모양, 과거 조회 범위. 이후 Task 2·3의 가정을 검증한다.

- [ ] **Step 1: 스파이크 스크립트 작성**

```js
// scripts/toss-spike.mjs — 커밋 금지. 키는 .env.local에서 읽고 출력하지 않는다.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE = 'https://open-api.tossplace.com/api-public/openapi/v1';
const headers = {
  'x-access-key': env.TOSS_PLACE_ACCESS_KEY,
  'x-secret-key': env.TOSS_PLACE_SECRET_KEY,
  'Content-Type': 'application/json',
};
const merchantId = process.argv[2] ?? '182323';

async function call(label, qs) {
  const res = await fetch(`${BASE}/merchants/${merchantId}/order/orders?${qs}`, { headers });
  const body = await res.json().catch(() => null);
  const list = Array.isArray(body?.success) ? body.success : (body?.success?.orders ?? null);
  console.log(`\n=== ${label} → HTTP ${res.status} | remaining=${res.headers.get('x-ratelimit-remaining')}`);
  console.log('    qs:', qs);
  console.log('    success type:', Array.isArray(body?.success) ? 'array' : typeof body?.success,
    '| count:', Array.isArray(list) ? list.length : '-',
    '| error:', body?.error ? JSON.stringify(body.error) : '-');
  return list;
}

const now = Date.now(), DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

// 매장 정보 (설치 확인)
const m = await fetch(`${BASE}/merchants/${merchantId}`, { headers });
console.log('merchant →', m.status, (await m.text()).slice(0, 120));

// from/to 형식 탐색 — 어느 것이 200인지 기록
const a = await call('no params', 'size=3');
await call('ISO 7d', `from=${encodeURIComponent(iso(now - 7 * DAY))}&to=${encodeURIComponent(iso(now))}&size=3`);
await call('epoch ms 7d', `from=${now - 7 * DAY}&to=${now}&size=3`);
await call('epoch s 7d', `from=${Math.floor((now - 7 * DAY) / 1000)}&to=${Math.floor(now / 1000)}&size=3`);

// 과거 범위 — 월 단위로 거슬러 올라가며 첫 빈 달 찾기 (ISO가 됐다고 가정, 아니면 위 결과에 맞춰 바꿀 것)
for (let k = 1; k <= 18; k++) {
  const list = await call(`${k}개월 전`, `from=${encodeURIComponent(iso(now - (k + 1) * 30 * DAY))}&to=${encodeURIComponent(iso(now - k * 30 * DAY))}&size=1`);
  if (!list || list.length === 0) { console.log(`→ ${k}개월 전부터 데이터 없음`); break; }
}

// 픽스처 저장 (완료 주문 1건). 고객·메모 필드 제거
const sample = (a ?? []).find((o) => o.orderState === 'COMPLETED') ?? a?.[0];
if (sample) {
  const s = JSON.parse(JSON.stringify(sample));
  delete s.memo; delete s.requestedInfo; delete s.customer;
  fs.mkdirSync('src/lib/__fixtures__', { recursive: true });
  fs.writeFileSync('src/lib/__fixtures__/toss-order.json', JSON.stringify(s, null, 2) + '\n');
  console.log('\nfixture saved. keys:', Object.keys(s).join(', '));
  console.log('chargePrice:', JSON.stringify(s.chargePrice));
  console.log('first lineItem:', JSON.stringify(s.lineItems?.[0]).slice(0, 500));
}
```

- [ ] **Step 2: 실행**

Run: `node scripts/toss-spike.mjs 182323`
Expected: `merchant → 200 ...`, 네 가지 형식 중 하나 이상 200, `fixture saved.` 출력. 403 `4030`이면 앱 설치가 아직 안 된 것이니 중단하고 사용자에게 알린다.

- [ ] **Step 3: 픽스처 검토**

`src/lib/__fixtures__/toss-order.json`을 열어 전화번호·이름 등 개인정보가 없는지 확인한다. 있으면 해당 필드를 `"<redacted>"`로 바꾼다.

- [ ] **Step 4: 스펙 갱신**

스펙의 "첫 작업에서 확정할 미지수" 절을 아래 형식의 "확정된 사실"로 바꾼다 (값은 실제 결과로).

```markdown
## 확정된 사실 (2026-10-XX 스파이크)

1. `from`/`to`: ISO 8601 문자열 (예 `2026-10-07T08:00:00.000Z`) — 200. epoch는 400.
2. 과거 조회: N개월 전까지 데이터 있음.
3. 테스트 매장(실매장 불러오기)은 실제 주문을 돌려줌 / 빈 샌드박스.
4. `chargePrice.totalAmount`가 최종 금액.
5. 응답 `success`는 `Order[]` 배열. 총 건수 메타 없음 → 길이 < size면 종료.
```

- [ ] **Step 5: 스크립트 삭제 후 커밋**

```bash
rm scripts/toss-spike.mjs
git add docs/superpowers/specs/2026-10-14-toss-pos-order-sync-design.md src/lib/__fixtures__/toss-order.json
git commit -m "docs: 토스 Open API 스파이크 결과 반영, 주문 픽스처 추가

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: 마이그레이션 37 — 테이블·뷰·RLS·스케줄러

**Files:**
- Create: `supabase/migrations/20261014_37_toss_pos_orders.sql`

**Interfaces:**
- Produces: 테이블 `pos_orders`, `pos_order_items`, `pos_sync_log`, 뷰 `pos_product_daily`. 컬럼명은 아래 SQL 그대로이며 Task 2·4·5가 의존한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- ========================================================================
-- 토스 POS 주문 수집 (1단계)
-- pos_orders / pos_order_items / pos_sync_log + 뷰 pos_product_daily + pg_cron 폴링
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- 실행 전: 아래 두 곳의 __POS_SYNC_SECRET__ 을 Vercel 환경변수 POS_SYNC_SECRET 값으로 바꿀 것
-- ========================================================================

-- 1. 매장 ↔ 토스 merchantId 매핑 (기존 컬럼 재사용)
update workplaces set pos_provider = 'toss', pos_store_code = '166568' where name = '나울';
update workplaces set pos_provider = 'toss', pos_store_code = '182323' where name = '녹턴';

-- 2. 주문
create table if not exists pos_orders (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  merchant_id text not null,
  external_id text not null,                -- 토스 주문 id
  order_key text,
  order_number text,
  source text,                              -- 'POS' 등
  order_state text not null,                -- COMPLETED / CANCELLED / ...
  charge_total numeric(14,2),               -- chargePrice.totalAmount
  created_at_pos timestamptz,
  updated_at_pos timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (workplace_id, external_id)
);
create index if not exists idx_pos_orders_wp_completed on pos_orders(workplace_id, completed_at desc);

-- 3. 라인아이템
create table if not exists pos_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references pos_orders(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  line_no int not null,
  item_title text not null,
  item_code text,
  item_category text,
  quantity numeric(10,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  options jsonb not null default '[]',
  discounts jsonb not null default '[]',
  dining_option text,
  unique (order_id, line_no)
);
create index if not exists idx_pos_items_wp_title on pos_order_items(workplace_id, item_title);

-- 4. 동기화 로그
create table if not exists pos_sync_log (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  window_from timestamptz not null,
  window_to timestamptz not null,
  fetched_count int not null default 0,
  upserted_count int not null default 0,
  error text
);
create index if not exists idx_pos_sync_log_wp on pos_sync_log(workplace_id, started_at desc);

-- 5. 상품별 일 집계 뷰 (완료 주문만, KST 날짜)
create or replace view pos_product_daily as
select o.workplace_id,
       (o.completed_at at time zone 'Asia/Seoul')::date as sales_date,
       i.item_title,
       i.item_code,
       sum(i.quantity)                as qty,
       sum(i.quantity * i.unit_price) as amount
from pos_orders o
join pos_order_items i on i.order_id = o.id
where o.order_state = 'COMPLETED' and o.completed_at is not null
group by 1, 2, 3, 4;

-- 6. RLS — 읽기는 멤버, 쓰기는 서비스 롤만 (정책 없음)
alter table pos_orders enable row level security;
alter table pos_order_items enable row level security;
alter table pos_sync_log enable row level security;

drop policy if exists "pos_orders_select" on pos_orders;
create policy "pos_orders_select" on pos_orders for select using (is_member_of(workplace_id));
drop policy if exists "pos_items_select" on pos_order_items;
create policy "pos_items_select" on pos_order_items for select using (is_member_of(workplace_id));
drop policy if exists "pos_sync_log_select" on pos_sync_log;
create policy "pos_sync_log_select" on pos_sync_log for select using (is_member_of(workplace_id));

-- 7. 스케줄러 — 10분마다 최근 90분, 매일 KST 04:00(UTC 19:00) 최근 48시간
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('toss-pos-sync-10m', 'toss-pos-sync-daily');

select cron.schedule('toss-pos-sync-10m', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{}'::jsonb);
$$);

select cron.schedule('toss-pos-sync-daily', '0 19 * * *', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{"hours":48}'::jsonb);
$$);
```

- [ ] **Step 2: 사용자에게 실행 요청**

사용자에게: "마이그레이션 37을 SQL Editor에서 실행해 주세요. 실행 전 `__POS_SYNC_SECRET__` 두 곳을 임의의 긴 문자열(예: `openssl rand -hex 24` 결과)로 바꾸고, 같은 값을 Vercel 환경변수 `POS_SYNC_SECRET`과 로컬 `.env.local`에도 넣어 주세요." 사용자가 실행했다고 하면 Step 3으로.

- [ ] **Step 3: 적용 확인**

Run (프로젝트 루트, `.env.local`에 서비스 롤 키가 있어야 함):

```bash
node -e "
const fs=require('fs');const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const {createClient}=require('@supabase/supabase-js');
const s=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{
 const w=await s.from('workplaces').select('name,pos_store_code,pos_provider');console.log(w.data);
 for(const t of ['pos_orders','pos_order_items','pos_sync_log','pos_product_daily']){const r=await s.from(t).select('*',{count:'exact',head:true});console.log(t,r.error?r.error.message:'ok');}
})()"
```

Expected: 나울 166568 / 녹턴 182323 / 본사 null, 네 객체 모두 `ok`.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20261014_37_toss_pos_orders.sql
git commit -m "feat: 토스 POS 주문 테이블·집계 뷰·pg_cron 폴링 스케줄 (마이그레이션 37)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `posOrderMap` — 토스 주문 → DB 행 (순수 함수, TDD)

**Files:**
- Create: `src/lib/posOrderMap.js`
- Create: `src/lib/posOrderMap.test.js`
- Modify: `package.json` scripts
- Uses: `src/lib/__fixtures__/toss-order.json` (Task 0)

**Interfaces:**
- Produces: `mapOrder(order, { workplaceId, merchantId }) → { order: PosOrderRow, items: PosOrderItemRow[] }`
  - `PosOrderRow` 키: `workplace_id, merchant_id, external_id, order_key, order_number, source, order_state, charge_total, created_at_pos, updated_at_pos, completed_at, cancelled_at, raw`
  - `PosOrderItemRow` 키: `workplace_id, line_no, item_title, item_code, item_category, quantity, unit_price, options, discounts, dining_option` (`order_id`는 라우트가 upsert 후 채움)
- Produces: `toIso(v)` — 숫자(epoch ms)나 문자열을 ISO 문자열로, 없으면 `null`

- [ ] **Step 1: test 스크립트 추가**

`package.json`의 `scripts`에 추가:

```json
"test": "node --test \"src/**/*.test.js\""
```

- [ ] **Step 2: 실패하는 테스트 작성**

```js
// src/lib/posOrderMap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapOrder, toIso } from './posOrderMap.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./__fixtures__/toss-order.json', import.meta.url), 'utf8'));
const ctx = { workplaceId: '00000000-0000-0000-0000-000000000001', merchantId: '182323' };

test('toIso: 숫자 epoch ms, ISO 문자열, 빈 값', () => {
  assert.equal(toIso(1791966421918), '2026-10-14T08:27:01.918Z');
  assert.equal(toIso('2026-10-14T17:27:01+09:00'), '2026-10-14T08:27:01.000Z');
  assert.equal(toIso(null), null);
  assert.equal(toIso(undefined), null);
});

test('완료 주문: 주문 행 매핑', () => {
  const { order } = mapOrder(fixture, ctx);
  assert.equal(order.workplace_id, ctx.workplaceId);
  assert.equal(order.merchant_id, '182323');
  assert.equal(order.external_id, String(fixture.id));
  assert.equal(order.order_key, fixture.orderKey);
  assert.equal(order.order_state, fixture.orderState);
  assert.equal(order.charge_total, fixture.chargePrice.totalAmount);
  assert.equal(order.completed_at, toIso(fixture.completedAt));
  assert.deepEqual(order.raw, fixture);
});

test('라인아이템: 순서·수량·단가·옵션', () => {
  const { items } = mapOrder(fixture, ctx);
  assert.equal(items.length, fixture.lineItems.length);
  items.forEach((it, i) => {
    const li = fixture.lineItems[i];
    assert.equal(it.line_no, i);
    assert.equal(it.workplace_id, ctx.workplaceId);
    assert.equal(it.item_title, li.item.title);
    assert.equal(it.item_code, li.item.code ?? null);
    assert.equal(it.item_category, li.item.category ?? null);
    assert.equal(it.quantity, Number(li.quantity));
    assert.equal(it.unit_price, Number(li.itemPrice.priceValue));
    assert.deepEqual(it.options, li.optionChoices ?? []);
    assert.deepEqual(it.discounts, li.appliedDiscounts ?? []);
  });
});

test('취소 주문: order_state CANCELLED, cancelled_at 채움', () => {
  const cancelled = { ...fixture, orderState: 'CANCELLED', cancelledAt: '2026-10-14T10:00:00+09:00', completedAt: null };
  const { order } = mapOrder(cancelled, ctx);
  assert.equal(order.order_state, 'CANCELLED');
  assert.equal(order.cancelled_at, '2026-10-14T01:00:00.000Z');
  assert.equal(order.completed_at, null);
});

test('lineItems 비어도 주문은 생성', () => {
  const { order, items } = mapOrder({ ...fixture, lineItems: [] }, ctx);
  assert.equal(order.external_id, String(fixture.id));
  assert.deepEqual(items, []);
});

test('item.code 없음 → null, 이름 없음 → 대체 텍스트', () => {
  const li = { ...fixture.lineItems[0], item: { title: '', category: 'X' } };
  const { items } = mapOrder({ ...fixture, lineItems: [li] }, ctx);
  assert.equal(items[0].item_code, null);
  assert.equal(items[0].item_title, '(이름 없음)');
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './posOrderMap.js'`

- [ ] **Step 4: 구현**

```js
// src/lib/posOrderMap.js
// 토스플레이스 Order → pos_orders / pos_order_items 행. 순수 함수 (DB·네트워크 없음).

export function toIso(v) {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapOrder(order, { workplaceId, merchantId }) {
  const row = {
    workplace_id: workplaceId,
    merchant_id: String(merchantId),
    external_id: String(order.id),
    order_key: order.orderKey ?? null,
    order_number: order.orderNumber ?? null,
    source: order.source ?? null,
    order_state: order.orderState ?? 'UNDEFINED',
    charge_total: order.chargePrice?.totalAmount ?? null,
    created_at_pos: toIso(order.createdAt),
    updated_at_pos: toIso(order.updatedAt),
    completed_at: toIso(order.completedAt),
    cancelled_at: toIso(order.cancelledAt),
    raw: order,
  };
  const items = (order.lineItems ?? []).map((li, i) => ({
    workplace_id: workplaceId,
    line_no: i,
    item_title: li.item?.title ? String(li.item.title) : '(이름 없음)',
    item_code: li.item?.code ?? null,
    item_category: li.item?.category ?? null,
    quantity: Number(li.quantity ?? 0),
    unit_price: Number(li.itemPrice?.priceValue ?? 0),
    options: li.optionChoices ?? [],
    discounts: li.appliedDiscounts ?? [],
    dining_option: li.diningOption ?? null,
  }));
  return { order: row, items };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: 6 tests pass. 픽스처의 `completedAt` 형식이 ISO가 아니라 epoch라면 `toIso`가 처리하므로 그대로 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
git add package.json src/lib/posOrderMap.js src/lib/posOrderMap.test.js
git commit -m "feat: 토스 주문 → pos_orders/pos_order_items 매핑 함수 + 테스트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `tossPlace` 클라이언트 — 페이지네이션·429 재시도 (TDD)

**Files:**
- Create: `src/lib/server/tossPlace.js`
- Create: `src/lib/server/tossPlace.test.js`

**Interfaces:**
- Produces: `fetchOrders({ merchantId, from, to }, deps?) → Promise<Order[]>`
  - `from`/`to`: `Date` 또는 ISO 문자열. 쿼리에는 ISO 문자열로 보낸다 (Task 0에서 epoch로 확정됐다면 `toQueryTs`만 바꾼다).
  - `deps = { fetch, sleep, env }` 테스트 주입용. 기본값은 전역 `fetch`, `setTimeout`, `process.env`.
  - 실패 시 `Error`를 throw. `error.status`에 HTTP 코드.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './tossPlace.js'`

- [ ] **Step 3: 구현**

```js
// src/lib/server/tossPlace.js
// 토스플레이스 Open API 클라이언트 (서버 전용). 주문 목록 조회만 담당.
// 문서: https://docs.tossplace.com/reference/open-api/order/order-methods.html

const BASE = 'https://open-api.tossplace.com/api-public/openapi/v1';
const PAGE_SIZE = 100;

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
  return Array.isArray(s) ? s : (s?.orders ?? []);
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
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 12 tests pass (Task 2의 6개 + 이 6개).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/tossPlace.js src/lib/server/tossPlace.test.js
git commit -m "feat: 토스플레이스 주문 조회 클라이언트 (페이지네이션·429 재시도) + 테스트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 동기화 라우트 `/api/pos/toss/sync`

**Files:**
- Create: `src/app/api/pos/toss/sync/route.js`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `fetchOrders` (Task 3), `mapOrder` (Task 2), 테이블 (Task 1)
- Produces: `POST /api/pos/toss/sync` — 헤더 `x-sync-secret`, 본문 `{ merchantId?, from?, to?, hours? }`, 응답 `{ ok: boolean, results: [{ merchantId, workplaceId, fetched, upserted, error }] }`

- [ ] **Step 1: 환경변수 예시 추가**

`.env.local.example` 끝에:

```
# 토스플레이스 Open API (개발자센터 → 내 애플리케이션 → 인증 정보)
TOSS_PLACE_ACCESS_KEY=
TOSS_PLACE_SECRET_KEY=
# /api/pos/toss/sync 호출 인증 (pg_cron 헤더 x-sync-secret 와 동일 값)
POS_SYNC_SECRET=
```

- [ ] **Step 2: 라우트 작성**

```js
// src/app/api/pos/toss/sync/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchOrders } from '@/lib/server/tossPlace';
import { mapOrder } from '@/lib/posOrderMap';

// ─────────────────────────────────────────────────────────────────────────
// 토스 POS 주문 폴링 — Supabase pg_cron 이 10분마다(최근 90분) / 매일 04:00 KST(최근 48h) 호출.
// 백필은 from/to 를 직접 넣어 수동 호출.
//   POST { merchantId?, from?, to?, hours? }   헤더 x-sync-secret: POS_SYNC_SECRET
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_HOURS = 1.5;
const CHUNK = 200;

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function resolveWindow({ from, to, hours }) {
  const toD = to ? new Date(to) : new Date();
  const fromD = from ? new Date(from) : new Date(toD.getTime() - (Number(hours) || DEFAULT_HOURS) * 3600_000);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime()) || fromD >= toD) {
    throw new Error('invalid window');
  }
  return { from: fromD, to: toD };
}

// 같은 주문이 여러 페이지에 걸쳐 두 번 오면 updatedAt 이 늦은 것만 남긴다
function dedupe(orders) {
  const m = new Map();
  for (const o of orders) {
    const prev = m.get(String(o.id));
    if (!prev || new Date(o.updatedAt ?? 0) >= new Date(prev.updatedAt ?? 0)) m.set(String(o.id), o);
  }
  return [...m.values()];
}

async function syncWorkplace(svc, wp, window) {
  const { data: log } = await svc.from('pos_sync_log')
    .insert({ workplace_id: wp.id, window_from: window.from.toISOString(), window_to: window.to.toISOString() })
    .select('id').single();

  let fetched = 0, upserted = 0;
  try {
    const orders = dedupe(await fetchOrders({ merchantId: wp.pos_store_code, from: window.from, to: window.to }));
    fetched = orders.length;
    const mapped = orders.map((o) => mapOrder(o, { workplaceId: wp.id, merchantId: wp.pos_store_code }));
    const syncedAt = new Date().toISOString();

    for (let i = 0; i < mapped.length; i += CHUNK) {
      const chunk = mapped.slice(i, i + CHUNK);
      const { data: rows, error: e1 } = await svc.from('pos_orders')
        .upsert(chunk.map((m) => ({ ...m.order, synced_at: syncedAt })), { onConflict: 'workplace_id,external_id' })
        .select('id, external_id');
      if (e1) throw new Error(`pos_orders upsert: ${e1.message}`);
      const idByExt = new Map(rows.map((r) => [r.external_id, r.id]));
      const ids = rows.map((r) => r.id);

      const { error: e2 } = await svc.from('pos_order_items').delete().in('order_id', ids);
      if (e2) throw new Error(`pos_order_items delete: ${e2.message}`);

      const items = chunk.flatMap((m) => m.items.map((it) => ({ ...it, order_id: idByExt.get(m.order.external_id) })));
      if (items.length) {
        const { error: e3 } = await svc.from('pos_order_items').insert(items);
        if (e3) throw new Error(`pos_order_items insert: ${e3.message}`);
      }
      upserted += rows.length;
    }

    await svc.from('pos_sync_log').update({ finished_at: new Date().toISOString(), fetched_count: fetched, upserted_count: upserted }).eq('id', log.id);
    return { merchantId: wp.pos_store_code, workplaceId: wp.id, fetched, upserted, error: null };
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 500);
    console.error('toss sync error', wp.pos_store_code, message);
    await svc.from('pos_sync_log').update({ finished_at: new Date().toISOString(), fetched_count: fetched, upserted_count: upserted, error: message }).eq('id', log.id);
    return { merchantId: wp.pos_store_code, workplaceId: wp.id, fetched, upserted, error: message };
  }
}

export async function POST(request) {
  const secret = process.env.POS_SYNC_SECRET;
  if (!secret || request.headers.get('x-sync-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }

  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  let window;
  try { window = resolveWindow(body); } catch { return NextResponse.json({ error: 'invalid_window' }, { status: 400 }); }

  const svc = getServiceClient();
  let q = svc.from('workplaces').select('id, name, pos_store_code').eq('pos_provider', 'toss').not('pos_store_code', 'is', null);
  if (body.merchantId) q = q.eq('pos_store_code', String(body.merchantId));
  const { data: wps, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!wps?.length) return NextResponse.json({ ok: true, results: [], note: 'no toss workplaces' });

  const results = [];
  for (const wp of wps) results.push(await syncWorkplace(svc, wp, window));

  return NextResponse.json({ ok: results.every((r) => !r.error), window: { from: window.from, to: window.to }, results });
}
```

- [ ] **Step 3: 로컬에서 호출**

`.env.local`에 `POS_SYNC_SECRET`이 있어야 한다. 개발 서버를 `preview_start`(launch.json의 dev 설정)로 띄운 뒤:

```bash
curl -s -X POST http://localhost:3000/api/pos/toss/sync -H "x-sync-secret: $(grep ^POS_SYNC_SECRET .env.local | cut -d= -f2)" -H "Content-Type: application/json" -d '{"merchantId":"182323","hours":24}'
```

Expected: `{"ok":true,"window":{...},"results":[{"merchantId":"182323","fetched":N,"upserted":N,"error":null}]}`. 잘못된 비밀키로 호출하면 401.

- [ ] **Step 4: DB 확인**

```bash
node -e "
const fs=require('fs');const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const {createClient}=require('@supabase/supabase-js');
const s=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
(async()=>{
 console.log((await s.from('pos_sync_log').select('*').order('started_at',{ascending:false}).limit(2)).data);
 console.log((await s.from('pos_product_daily').select('*').order('qty',{ascending:false}).limit(5)).data);
})()"
```

Expected: 로그에 `error: null`, `fetched_count`가 curl 응답과 같음. 뷰에 상품명·수량 행.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/pos/toss/sync/route.js .env.local.example
git commit -m "feat: 토스 POS 주문 동기화 라우트 (/api/pos/toss/sync)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 서버 액션 `getProductSales`

**Files:**
- Modify: `src/app/(app)/sales/actions.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: 뷰 `pos_product_daily`, 테이블 `pos_sync_log`, 기존 `getServiceClient`, `createServerClient`
- Produces: `getProductSales({ workplaceId, from, to }) → { items: [{ item_title, item_code, qty, amount }], lastSyncedAt: string|null } | null`
  - `from`/`to`: `'YYYY-MM-DD'` (양 끝 포함). 권한 없으면 `null`.

- [ ] **Step 1: 액션 추가**

`src/app/(app)/sales/actions.js` 끝에:

```js
/**
 * 상품별 판매 집계 (토스 POS 동기화 데이터). from/to 는 'YYYY-MM-DD' 양 끝 포함.
 * 권한은 getSalesSummary 와 동일 — 해당 매장 멤버 / 본사 / super_admin / 임원.
 */
export async function getProductSales({ workplaceId, from, to }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId || !from || !to) return null;

  const svc = getServiceClient();
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const allowed = (mems ?? []).some((m) => m.workplace_id === workplaceId) || isHQ || prof?.is_super_admin === true || prof?.is_executive === true;
  if (!allowed) return null;

  const [{ data: rows }, { data: lastLog }] = await Promise.all([
    svc.from('pos_product_daily')
      .select('item_title, item_code, qty, amount')
      .eq('workplace_id', workplaceId)
      .gte('sales_date', from)
      .lte('sales_date', to),
    svc.from('pos_sync_log')
      .select('finished_at')
      .eq('workplace_id', workplaceId)
      .is('error', null)
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const agg = new Map();
  for (const r of rows ?? []) {
    const key = `${r.item_title}\u0000${r.item_code ?? ''}`;
    const cur = agg.get(key) ?? { item_title: r.item_title, item_code: r.item_code ?? null, qty: 0, amount: 0 };
    cur.qty += Number(r.qty) || 0;
    cur.amount += Number(r.amount) || 0;
    agg.set(key, cur);
  }
  const items = [...agg.values()].sort((a, b) => b.qty - a.qty);
  return { items, lastSyncedAt: lastLog?.finished_at ?? null };
}
```

- [ ] **Step 2: 수동 확인**

개발 서버에서 브라우저 콘솔로는 서버 액션을 직접 못 부르므로 Task 6의 화면으로 확인한다. 여기서는 lint만:

Run: `npm run lint`
Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(app)/sales/actions.js"
git commit -m "feat: 상품별 판매 집계 서버 액션 getProductSales

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 매출 페이지 "상품별 판매" 카드

**Files:**
- Create: `src/app/(app)/sales/ProductSalesCard.js`
- Modify: `src/app/(app)/sales/page.js` — import 1줄 + 마운트 1줄 (누적 합계 `section` 바로 아래, "매출 올리기 팁" 위)

**Interfaces:**
- Consumes: `getProductSales` (Task 5), `getPageCache`/`setPageCache`, `formatCurrency`, `formatTime`, `ymd`
- Produces: `<ProductSalesCard workplaceId={...} />`

- [ ] **Step 1: 컴포넌트 작성**

```js
// src/app/(app)/sales/ProductSalesCard.js
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import { formatCurrency, formatTime } from '@/lib/format';
import { ymd } from '@/lib/date';
import { getPageCache, setPageCache } from '@/lib/pageCache';
import { getProductSales } from './actions';

const RANGES = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번 주' },
  { key: 'month', label: '이번 달' },
  { key: 'custom', label: '직접 선택' },
];

function rangeDates(key, custom) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (key === 'today') return { from: ymd(today), to: ymd(today) };
  if (key === 'week') {
    const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 월요일
    return { from: ymd(d), to: ymd(today) };
  }
  if (key === 'month') return { from: `${ymd(today).slice(0, 7)}-01`, to: ymd(today) };
  return custom;
}

export default function ProductSalesCard({ workplaceId }) {
  const [range, setRange] = useState('today');
  const [custom, setCustom] = useState(() => ({ from: ymd(new Date()), to: ymd(new Date()) }));
  const { from, to } = rangeDates(range, custom);
  const cacheKey = `productSales:${workplaceId}:${from}:${to}`;
  const [data, setData] = useState(() => getPageCache(cacheKey));
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!workplaceId || !from || !to || from > to) return;
    setLoading(true);
    try {
      const res = await getProductSales({ workplaceId, from, to });
      setData(res);
      setPageCache(cacheKey, res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [workplaceId, from, to, cacheKey]);

  useEffect(() => { setData(getPageCache(cacheKey)); load(); }, [load, cacheKey]);

  const items = data?.items ?? [];

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Package size={18} color="var(--accent-strong)" />
        <h2 className="h3" style={{ flex: 1 }}>상품별 판매</h2>
        <button type="button" className="btn btn-ghost btn-xs" onClick={load} disabled={loading} aria-label="새로고침">
          <RefreshCw size={12} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`btn btn-xs ${range === r.key ? 'btn-primary' : 'btn-soft'}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input type="date" className="input" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <span className="text-muted">~</span>
          <input type="date" className="input" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}

      {loading && !data ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : items.length === 0 ? (
        <div className="empty" style={{ padding: '16px 0' }}>
          <div className="empty-desc">아직 동기화된 주문이 없어요</div>
        </div>
      ) : (
        <div className="stack stack-1">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 90px', gap: 8, fontSize: 11, fontWeight: 700 }} className="text-muted">
            <span>상품</span><span style={{ textAlign: 'right' }}>수량</span><span style={{ textAlign: 'right' }}>금액</span>
          </div>
          {items.map((it) => (
            <div key={`${it.item_title}|${it.item_code ?? ''}`} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 90px', gap: 8, fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.item_title}</span>
              <span className="num" style={{ textAlign: 'right' }}>{formatCurrency(it.qty)}</span>
              <span className="num" style={{ textAlign: 'right' }}>{formatCurrency(it.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-muted" style={{ fontSize: 11, marginTop: 10 }}>
        {data?.lastSyncedAt ? `마지막 동기화 ${formatTime(data.lastSyncedAt)}` : '동기화 전'}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 페이지에 마운트**

`src/app/(app)/sales/page.js`:

import 블록(`import { saveSales, ... } from './actions';` 다음 줄)에 추가:

```js
import ProductSalesCard from './ProductSalesCard';
```

누적 합계 섹션을 닫는 `)}` 바로 다음, `{/* 매출 올리기 팁 ... */}` 주석 바로 앞에 추가:

```jsx
        {/* 상품별 판매 — 토스 POS 동기화 데이터 */}
        {currentWorkplaceId && <ProductSalesCard workplaceId={currentWorkplaceId} />}

```

- [ ] **Step 3: 브라우저 확인**

`preview_start`로 개발 서버를 띄우고 매출 페이지로 이동. 녹턴 매장으로 전환한 뒤:
- "오늘" 칩: Task 4에서 동기화한 당일 주문이 있으면 표가, 없으면 "아직 동기화된 주문이 없어요"와 함께 "마지막 동기화 HH:mm"이 보인다.
- "이번 달" 칩: 표에 상품명·수량·금액. 수량 내림차순.
- "직접 선택": 날짜 두 개 바꾸면 다시 조회.
- 콘솔(`read_console_messages`)에 오류 없음.
- 모바일 폭(`resize_window` mobile)에서 표가 가로 스크롤 없이 들어간다.

- [ ] **Step 4: lint + 테스트**

Run: `npm run lint && npm test`
Expected: 둘 다 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/sales/ProductSalesCard.js" "src/app/(app)/sales/page.js"
git commit -m "feat: 매출 페이지 상품별 판매 카드 (토스 POS 동기화 데이터)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 배포·백필·운영 확인

**Files:** 없음 (운영 작업)

- [ ] **Step 1: Vercel 환경변수 (사용자)**

사용자에게 요청: Vercel 프로젝트 → Settings → Environment Variables에 `TOSS_PLACE_ACCESS_KEY`, `TOSS_PLACE_SECRET_KEY`, `POS_SYNC_SECRET` 추가(Production). 값은 `.env.local`과 동일.

- [ ] **Step 2: 배포**

```bash
git push origin main
```

Vercel 자동 배포 완료 후:

```bash
curl -s -X POST https://counter.mclean21.com/api/pos/toss/sync -H "x-sync-secret: $(grep ^POS_SYNC_SECRET .env.local | cut -d= -f2)" -H "Content-Type: application/json" -d '{"hours":2}'
```

Expected: `ok: true`, 매장 두 개 결과.

- [ ] **Step 3: 백필 (Task 0에서 확정된 범위만큼, 월 단위)**

예: 2026-07부터 10월까지.

```bash
for m in 2026-07 2026-08 2026-09; do
  next=$(date -d "$m-01 +1 month" +%Y-%m 2>/dev/null || echo "")
  curl -s -X POST https://counter.mclean21.com/api/pos/toss/sync -H "x-sync-secret: $(grep ^POS_SYNC_SECRET .env.local | cut -d= -f2)" -H "Content-Type: application/json" -d "{\"from\":\"${m}-01T00:00:00+09:00\",\"to\":\"${next}-01T00:00:00+09:00\"}"; echo
done
curl -s -X POST https://counter.mclean21.com/api/pos/toss/sync -H "x-sync-secret: $(grep ^POS_SYNC_SECRET .env.local | cut -d= -f2)" -H "Content-Type: application/json" -d '{"from":"2026-10-01T00:00:00+09:00"}'
```

Windows Git Bash에서 `date -d`가 안 되면 월별 `from`/`to`를 손으로 적어 호출한다. 한 달에 주문이 수천 건이어도 100건/페이지, 초당 10요청 한도라 수십 초 안에 끝난다.

- [ ] **Step 4: 대시보드 대조**

토스플레이스 대시보드의 지난달 상품별 매출 상위 5개 수량과 카운터 "직접 선택"(지난달 1일~말일) 표를 비교한다. 수량이 같아야 한다. 금액은 옵션·할인 제외라 토스 쪽보다 작거나 같을 수 있다. 수량이 다르면 `pos_orders`에서 해당 날짜 `order_state` 분포를 확인하고 사용자에게 보고한다.

- [ ] **Step 5: 스케줄러 동작 확인**

Supabase SQL Editor에서 (사용자 또는 서비스 롤 스크립트):

```sql
select jobname, schedule, active from cron.job;
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select workplace_id, started_at, finished_at, fetched_count, error from pos_sync_log order by started_at desc limit 6;
```

Expected: 두 작업 `active = true`, 최근 실행 `status = succeeded`, 10분 간격으로 `pos_sync_log` 행이 생기고 `error`가 null.

- [ ] **Step 6: 메모리·스펙 마무리**

스펙 "비목표"에 변경 없음 확인. 메모리 파일 `project_infra_regions.md`에 "토스 POS 폴링은 Supabase pg_cron → /api/pos/toss/sync, 비밀키는 POS_SYNC_SECRET" 한 줄 추가.

---

## Self-Review

**Spec coverage**
- workplaces 매핑, 테이블 3개, 뷰, RLS, 스케줄러 → Task 1
- tossPlace 클라이언트(페이지네이션, 429) → Task 3
- posOrderMap 순수 함수 + 테스트 + 픽스처 → Task 0, 2
- sync 라우트(인증, 창, 매장 순회, upsert, 로그, 매장별 오류 격리) → Task 4
- getProductSales + 상품별 판매 카드 + 캐시 + 마지막 동기화 → Task 5, 6
- 백필, 대시보드 대조, cron 확인 → Task 7
- 미지수 확정 → Task 0

**Type consistency**
- `mapOrder(order, { workplaceId, merchantId })` — Task 2 정의, Task 4 사용 일치.
- `fetchOrders({ merchantId, from, to }, deps)` — Task 3 정의, Task 4 사용 일치.
- `getProductSales({ workplaceId, from, to })` → `{ items, lastSyncedAt }` — Task 5 정의, Task 6 사용 일치.
- 컬럼명 `external_id`, `charge_total`, `completed_at`, `item_title`, `unit_price`, `finished_at` — Task 1 SQL과 Task 2·4·5 코드 일치.

**Known dependency on Task 0**
- `toQueryTs`가 ISO를 보낸다. 스파이크에서 epoch만 통한다면 Task 3 Step 3의 `toQueryTs`를 `String(new Date(v).getTime())`으로 바꾸고 Step 1 첫 테스트의 기대값도 epoch 문자열로 바꾼다.

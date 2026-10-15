# 토스 POS 주문 수집 (1단계) — 설계

날짜: 2026-10-14

## 배경

토스플레이스 대시보드에서만 보던 일별·상품별 매출을 카운터로 가져와, 이후 수요 예측(2·3단계)의
입력으로 쓴다. 토스플레이스 Open API(주문 조회)가 공개돼 있고, 개발자센터에 앱 `mclean-counter`
(회사명 맥클린)를 만들어 액세스 키·시크릿 키를 발급받았다. 실제 매장 merchantId는
나울 166568, 녹턴 182323.

전체 로드맵은 세 사업으로 나눈다. 이 문서는 1단계만 다룬다.

1. **토스 주문 수집** (이 문서) — 주문·라인아이템 적재, 상품별 일 판매량 집계, 화면 표시
2. 메뉴→재고 매핑(BOM) — 레시피 재료를 재고 품목에 연결해 판매량→소진량 환산
3. 예측 + 발주 추천 — 요일 계절성 기반 예측, 리드타임·안전재고 반영 추천 발주량

## 목표

- 10분 이내 지연으로 두 매장의 토스 주문이 카운터 DB에 쌓인다.
- 완료 주문 기준 매장×상품×일 수량·금액을 SQL 뷰 하나로 조회할 수 있다.
- 매출 페이지에서 기간별 상품 판매 표와 마지막 동기화 시각을 볼 수 있다.
- 과거 주문을 같은 경로로 백필할 수 있다.

## 비목표

- 토스 웹훅 수신 (기존 `/api/pos/toss/webhook` 라우트는 손대지 않고 그대로 둔다)
- `sales_daily` 자동 채움 (현금/카드 분리는 결제 API가 필요. 추후 검토)
- 예측·BOM·발주 추천 (2·3단계)
- 결제·할인·고객 분석

## 접근 방식 결정

Vercel Hobby 플랜이라 Vercel Cron은 하루 1회뿐이다. 대신 **Supabase pg_cron + pg_net**이 10분마다
카운터의 동기화 라우트를 호출하고, 라우트가 토스 주문 조회 API를 폴링한다.

- 폴링은 주문 id 기준 upsert라 멱등이다. 취소 주문도 같은 조회(`orderStates` 기본값
  COMPLETED, CANCELLED)에 섞여 오므로 환불 반영이 자동이다.
- 웹훅은 서명 규격·재전송 정책을 아직 모른다. 나중에 필요하면 같은 upsert 위에 얹는다.

## 토스 API 요약 (docs.tossplace.com 기준)

- 기본 URL `https://open-api.tossplace.com/api-public/openapi/v1`
- 인증 헤더 `x-access-key`, `x-secret-key`, `Content-Type: application/json`
- 주문 목록 `GET /merchants/{merchantId}/order/orders`
  - `from`, `to` (timestamp, 결제 변경 시각 기준), `orderStates[]`, `sources[]`,
    `page`(기본 1), `size`(기본 100), `sortOrder`(기본 DESC)
- 주문 모델: `id`, `orderKey`, `orderNumber`, `source`, `orderState`
  (REQUESTED/OPENED/COMPLETED/CANCELLED/UNDEFINED), `createdAt`, `updatedAt`, `completedAt`,
  `cancelledAt`, `lineItems[]`, `chargePrice`, `payments`, `discounts`
- 라인아이템: `item.title`, `item.code`(선택), `item.category`, `quantity`,
  `itemPrice.priceValue`, `optionChoices[]`, `appliedDiscounts[]`, `diningOption`
- 레이트리밋: 매장별 토큰 버킷, 초당 10개 충전, 최대 100. 초과 시 429 +
  `x-ratelimit-reset` 헤더

## 데이터 구조 — 마이그레이션 `20261014_37_toss_pos_orders.sql`

### `workplaces` (기존 컬럼 재사용)

```sql
update workplaces set pos_provider = 'toss', pos_store_code = '166568' where name = '나울';
update workplaces set pos_provider = 'toss', pos_store_code = '182323' where name = '녹턴';
```

### `pos_orders` — 주문 한 건

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid pk | |
| workplace_id | uuid fk workplaces | |
| merchant_id | text | 토스 merchantId |
| external_id | text | 토스 주문 `id` |
| order_key | text | |
| order_number | text null | 고객용 번호 |
| source | text | `POS` 등 |
| order_state | text | COMPLETED / CANCELLED / 기타 |
| charge_total | numeric(14,2) | `chargePrice`에서 최종 금액 |
| created_at_pos | timestamptz | 토스 `createdAt` |
| updated_at_pos | timestamptz | 토스 `updatedAt` |
| completed_at | timestamptz null | |
| cancelled_at | timestamptz null | |
| raw | jsonb | 원본 주문 |
| synced_at | timestamptz | 마지막 upsert 시각 |

유니크 `(workplace_id, external_id)`. 인덱스 `(workplace_id, completed_at desc)`.

### `pos_order_items` — 라인아이템

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid pk | |
| order_id | uuid fk pos_orders on delete cascade | |
| workplace_id | uuid | 조회 편의용 중복 |
| line_no | int | 배열 순서 |
| item_title | text | 상품명 |
| item_code | text null | 상품코드 |
| item_category | text null | |
| quantity | numeric(10,3) | |
| unit_price | numeric(14,2) | `itemPrice.priceValue` |
| options | jsonb | `optionChoices` 원본 |
| discounts | jsonb | `appliedDiscounts` 원본 |
| dining_option | text null | HERE/TOGO/… |

유니크 `(order_id, line_no)`. 인덱스 `(workplace_id, item_title)`.
주문을 다시 받으면 그 주문의 아이템을 모두 지우고 새로 넣는다.

### `pos_sync_log` — 동기화 이력

| 컬럼 | 타입 |
|---|---|
| id | uuid pk |
| workplace_id | uuid |
| started_at / finished_at | timestamptz |
| window_from / window_to | timestamptz |
| fetched_count / upserted_count | int |
| error | text null |

### `pos_product_daily` — 뷰

```sql
create view pos_product_daily as
select o.workplace_id,
       (o.completed_at at time zone 'Asia/Seoul')::date as sales_date,
       i.item_title, i.item_code,
       sum(i.quantity) as qty,
       sum(i.quantity * i.unit_price) as amount
from pos_orders o
join pos_order_items i on i.order_id = o.id
where o.order_state = 'COMPLETED'
group by 1, 2, 3, 4;
```

옵션 추가금과 라인 할인은 1단계 금액 집계에 넣지 않는다. 판매량 예측에는 수량이 핵심이고,
금액은 참고치다. 정확한 매출액은 `pos_orders.charge_total`로 본다.

### RLS

세 테이블 모두 RLS 활성화. SELECT는 `is_member_of(workplace_id)`. 쓰기는 서비스 롤만
(정책 없음). 뷰는 기반 테이블 정책을 따른다.

### 스케줄러 (같은 마이그레이션)

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('toss-pos-sync-10m', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"x-sync-secret": "__POS_SYNC_SECRET__"}'::jsonb,
    body := '{}'::jsonb);
$$);

select cron.schedule('toss-pos-sync-daily', '0 19 * * *', $$   -- KST 04:00
  select net.http_post(
    url := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"x-sync-secret": "__POS_SYNC_SECRET__"}'::jsonb,
    body := '{"hours": 48}'::jsonb);
$$);
```

`__POS_SYNC_SECRET__`은 자리표시자. 마이그레이션을 수동 실행할 때 Vercel에 넣은 값으로
바꿔 넣는다. 비밀키가 `cron.job` 테이블에 평문으로 남지만 DB 접근 자체가 서비스 롤 범위라 허용한다.

## 서버 코드

### 환경변수 (`.env.local.example`에 추가)

- `TOSS_PLACE_ACCESS_KEY`, `TOSS_PLACE_SECRET_KEY` — 개발자센터 발급
- `POS_SYNC_SECRET` — 동기화 라우트 인증용 임의 문자열

### `src/lib/server/tossPlace.js`

- `fetchOrders({ merchantId, from, to })` — 페이지를 끝까지 돌며 주문 배열 반환.
  `size=100`, 응답 길이가 100 미만이면 종료.
- 429 응답 시 `x-ratelimit-reset`만큼 대기 후 한 번 재시도. 그래도 실패면 throw.
- 그 외 4xx/5xx는 상태 코드와 본문 앞 200자를 담아 throw.

### `src/lib/posOrderMap.js` (순수 함수, 테스트 대상)

- `mapOrder(tossOrder, workplaceId)` → `{ order, items }`
  - `order`는 `pos_orders` 행, `items`는 `pos_order_items` 행 배열(`line_no` 0부터)
  - `charge_total`은 `chargePrice`의 최종 금액 필드. 필드명은 테스트 매장 응답으로 확정
  - `lineItems`가 비어도 `order`는 만든다

### `src/app/api/pos/toss/sync/route.js`

- `POST`만. 헤더 `x-sync-secret`이 `POS_SYNC_SECRET`과 다르면 401.
- 본문(JSON, 모두 선택): `merchantId`, `from`, `to`, `hours`
  - `from`/`to` 있으면 그 창. 없으면 `hours`(기본 1.5) 만큼 과거부터 지금까지.
  - `merchantId` 있으면 그 매장만. 없으면 `pos_provider='toss'`이고 `pos_store_code`가 있는
    워크플레이스 전부.
- 매장별로: `pos_sync_log` 시작 행 → `fetchOrders` → 주문마다 `mapOrder` → `pos_orders` upsert
  (`workplace_id,external_id`) → 해당 `order_id` 아이템 delete 후 insert → 로그 완료.
- 한 매장이 실패해도 다음 매장은 계속. 응답은 매장별 `{ merchantId, fetched, upserted, error }`
  배열. 하나라도 실패면 HTTP 207이 아니라 200에 `error` 필드로 표시한다(단순화).
- 서비스 롤 클라이언트 사용(`sales/actions.js`의 `getServiceClient` 패턴).

### 백필

같은 라우트에 `from`/`to`를 월 단위로 넣어 수동 호출한다. 터미널에서:

```bash
curl -X POST https://counter.mclean21.com/api/pos/toss/sync -H "x-sync-secret: $POS_SYNC_SECRET" -H "Content-Type: application/json" -d '{"from":"2026-09-01T00:00:00+09:00","to":"2026-10-01T00:00:00+09:00"}'
```

## 화면

### 서버 액션 `getProductSales({ workplaceId, from, to })` (`sales/actions.js`에 추가)

- `getSalesSummary`와 같은 멤버십 검증. 통과 못 하면 `null`.
- `pos_product_daily`에서 `sales_date` 범위로 조회해 상품별 합산
  `[{ item_title, item_code, qty, amount }]`을 수량 내림차순으로 반환.
- 함께 `pos_sync_log`의 해당 매장 최신 `finished_at`을 `lastSyncedAt`으로 반환.

### 매출 페이지 "상품별 판매" 섹션

- 기존 일 매출 표 아래에 카드 하나 추가.
- 기간 칩: 오늘 / 이번 주 / 이번 달 / 직접 선택(시작·종료 날짜 입력).
- 표: 상품명 · 수량 · 금액. 데이터 없으면 "아직 동기화된 주문이 없어요".
- 카드 하단에 "마지막 동기화 HH:mm". `lastSyncedAt`이 없으면 "동기화 전".
- 기존 `sales:` 페이지 캐시 패턴과 동일하게 `productSales:{workplaceId}:{range}` 키로 캐시.

## 오류 처리

| 상황 | 처리 |
|---|---|
| 토스 429 | 리셋 시각까지 대기 후 1회 재시도 |
| 토스 5xx / 네트워크 | 그 매장 로그에 `error` 기록, 다음 10분 회차의 90분 창이 메움 |
| 뒤늦은 취소(90분 밖) | 매일 KST 04:00 48시간 창 재조회로 상태 갱신 |
| 동기화 라우트 비밀키 불일치 | 401, 로그 없음 |
| `lineItems` 없음 | 주문만 저장, 아이템 0건 |

## 검증

### 자동

- `src/lib/posOrderMap.test.js` — Node 내장 `node --test`. 의존성 추가 없음.
  `package.json`에 `"test": "node --test src/**/*.test.js"` 스크립트 추가.
- 픽스처 `src/lib/__fixtures__/toss-order.json` — 테스트 매장 실제 응답 한 건(개인정보 없음 확인 후).
- 케이스: 완료 주문 매핑, 취소 주문 매핑, 옵션 있는 라인아이템, `lineItems` 빈 배열,
  `item.code` 없음.

### 수동

1. `.env.local`에 세 환경변수 설정 → `curl`로 테스트 매장 1시간 창 동기화 → `pos_orders`에 행 확인.
2. 백필 1개월 → `pos_product_daily`에서 날짜별 행 수가 토스 대시보드 일 건수와 비슷한지 대조.
3. 매출 페이지에서 "이번 달" 상품별 표가 토스 대시보드 상품별 매출과 대략 일치하는지 확인.
4. 마이그레이션 적용 후 `cron.job`에 두 작업이 보이고 10분 뒤 `pos_sync_log`에 행이 생기는지 확인.

## 확정된 사실 (2026-10-15 스파이크, 테스트 매장 182323·166568)

1. `from`/`to`: ISO 8601 문자열(`2026-10-08T00:18:38.079Z`)과 epoch 밀리초 모두 200. epoch 초는 400 ("2022-01-01T00:00:00Z 이후 값"). 클라이언트는 ISO를 보낸다.
2. 과거 조회: 매장 개설(2025-05)부터 전부 돌려준다. 16개월 이상.
3. 테스트 매장으로 불러온 녹턴·나울은 실제 주문을 돌려준다. 빈 샌드박스가 아니다.
4. `chargePrice.totalAmount`가 최종 금액. 예: listPrice 15000, discountAmount -3000, totalAmount 12000.
5. 응답 `success`는 `Order[]` 배열. 총 건수 메타 없음. 길이 < size면 마지막 페이지.
6. 타임스탬프는 ISO 문자열(`2026-10-14T08:52:36Z`). 주문 `id`는 18자리 숫자 문자열.
7. **`item.category`는 문자열이 아니라 `{ title, code }` 객체.** `pos_order_items.item_category`에는 `category.title`을 저장한다.
8. 주문 원본에 개인정보성 필드가 있다: `payments[].cardDetails`(마스킹 카드번호 앞 8자리)·`approvedNo`·`cashReceipt`·`easyPayDetails` 등, 최상위 `memo`·`requestedInfo`. `pos_orders.raw`에는 `payments[]`를 금액·수단·상태·시각 허용 목록만 남기고, `memo`·`requestedInfo`·라인아이템 `memo`를 제거해 저장한다.

## 리뷰 반영 (2026-10-15)

- `pos_product_daily` 뷰는 `security_invoker = true` (마이그레이션 38). 기본 뷰는 소유자 권한이라 RLS를 우회해 anon 키로 조회됐다.
- 상품별 합산은 SQL 함수 `pos_product_sales(workplace_id, from, to)`로 수행한다. 뷰를 직접 읽으면 PostgREST 1000행 제한에 걸린다.
- 라인아이템 교체는 delete 후 insert 가 아니라 `(order_id, line_no)` upsert 후 꼬리(`line_no >= 새 길이`) 삭제. 겹치는 실행이나 중단 시 아이템이 사라지지 않는다.
- 세션 미들웨어 예외는 `/api/pos/toss/sync` 한 경로만. 기존 웹훅 라우트는 `POS_WEBHOOK_SECRET` 미설정 시 검증을 건너뛰므로 노출하지 않는다.

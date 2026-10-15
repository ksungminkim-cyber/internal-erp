# 2단계 — 토스 상품 → 재고 소요량 연결 (BOM) — 설계

날짜: 2026-10-15. 선행: 1단계 주문 수집, 1b 일 매출 자동 채움.

## 목표

1. 매장별로 "토스 상품 1개 = 재고 품목 얼마"를 저장하고 재고 화면에서 관리한다.
2. 판매량 × 소요량으로 매장·품목·일 소진량을 SQL로 낼 수 있다 (3단계 예측 입력).
3. 재고 품목에 리드타임(일)을 둔다. 기본 2일.
4. 나울·녹턴에 원두·우유·컵·시럽(·토스트) 기본 품목을 만든다.

## 비목표

- 예측·추천 발주량·홈 알림·지출결의서 연결 (3단계)
- 판매량으로 재고 자동 차감 (재고 수량은 직접 센 값이 진실)
- 레시피 테이블 구조 변경. 레시피는 소요량 기본값 추천의 참고 자료로만 읽는다.

## 결정

- 연결은 **토스 상품명 → 재고 품목 직접 매핑**. 레시피를 거치지 않는다. 상품명은 매장마다 다르므로 매장 단위.
- 상품 목록은 최근 90일 `pos_product_sales` 결과(판매량 순). 메뉴가 바뀌면 자연히 갱신된다.
- 레시피 기본값 추천: 상품명과 레시피명이 공백·대소문자·ICE/HOT 표기를 무시하고 포함 관계면 그 레시피의 재료 중 품목 키워드(원두↔에스프레소/원두/샷, 우유↔우유, 시럽↔시럽, 토스트↔식빵/토스트, 컵↔없음)에 맞는 재료의 첫 숫자를 제안. 못 찾으면 빈칸.
- 소요량 단위는 재고 품목의 단위. 원두가 "봉"이면 1잔당 0.018봉이 아니라 사용자가 g 단위 품목으로 바꾸거나 소수로 넣는다. 화면에 단위를 함께 표시해 혼동을 줄인다.

## 데이터 — 마이그레이션 `20261015_41_pos_product_usage.sql`

- `inventory_items.lead_time_days integer not null default 2`
- `pos_product_usage`
  | 컬럼 | 타입 |
  |---|---|
  | id | uuid pk |
  | workplace_id | uuid fk |
  | inventory_item_id | uuid fk inventory_items on delete cascade |
  | item_title | text (토스 상품명) |
  | qty_per_unit | numeric(12,3) > 0 |
  | created_at / updated_at | timestamptz |
  유니크 `(inventory_item_id, item_title)`. 인덱스 `(workplace_id, item_title)`.
  RLS: select/all `is_member_of(workplace_id)` (재고 품목과 동일).
- `inventory_daily_usage(p_workplace_id, p_from, p_to)` → `(sales_date, inventory_item_id, usage numeric)`. 완료 주문 라인아이템 × 소요량 합. security invoker, `search_path = public`.
- 기본 품목 시드(이름이 없을 때만): 두 매장 공통 `아이스 컵(개, 비품)`, `핫 컵(개, 비품)`, `바닐라 시럽(병, 음료/시럽)`. 나울 추가 `원두(봉, 식자재)`, `디카페인 원두(봉, 식자재)`, `우유 1L(개, 음료/시럽)`. 녹턴은 원두·우유·프렌치 토스트가 이미 있다. 수량 0, 최소수량 0.

## 서버 액션 (`inventory/actions.js`)

- `getProductUsage({ workplaceId, inventoryItemId })` → `{ products: [{ item_title, qty90 }], links: [{ item_title, qty_per_unit }], recipes: [{ name, ingredients }] , avgDailyUsage: number|null }`
  - `products`: 최근 90일 `pos_product_sales`. `links`: 기존 연결. `recipes`: active 레시피(이름·재료)만. `avgDailyUsage`: 최근 30일 `inventory_daily_usage` 평균(연결이 있을 때).
- `saveProductUsage({ workplaceId, inventoryItemId, rows: [{ item_title, qty_per_unit }] })` → 해당 품목의 연결을 전부 교체(delete + insert). 멤버십 검증은 기존 `saveInventoryItem`과 동일.
- `saveInventoryItem` payload에 `lead_time_days` 허용.

## 화면 (`inventory/page.js`, 신규 `UsageEditor.js`, 순수 `src/lib/usageSuggest.js`)

- `InventoryRow`에 "소요량" 버튼(아이콘 `Link2`). 연결 수가 있으면 "연결 N" 배지.
- `UsageEditor`(BottomSheet): 상단에 품목명·단위, "최근 30일 하루 평균 소진 N 단위" (연결 있을 때). 검색창. 상품 목록은 판매량 순, 각 행에 체크박스 + 소요량 입력(단위 표시) + 레시피 추천값이 있으면 "레시피 180" 칩(누르면 입력). 하단 "선택한 상품에 같은 값 넣기" 입력 + 저장.
- `InventoryEditor`에 리드타임(일) 입력 추가.
- `usageSuggest.js`: `normalizeTitle`, `suggestQty(productTitle, itemName, recipes) → number|null`. 테스트.

## 검증

- `node --test`: `usageSuggest` (정규화, 키워드 매칭, 숫자 파싱, 미매칭 null).
- 마이그레이션 41 후: 시드 품목 생성 확인, `inventory_daily_usage` 빈 결과(연결 전) → 연결 저장 후 값.
- 브라우저: 녹턴 "유타 블렌드 원두"에 아메리카노 ICE/HOT 등 연결 저장 → 평균 소진 표시. 모바일 폭.

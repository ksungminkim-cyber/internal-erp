# 3단계 — 재고 자동 차감·발주 추천·홈 카드·지출결의서 연결 — 설계

날짜: 2026-10-16. 선행: 1·1b(주문 수집·일 매출), 2단계(소요량 연결).

## 목표

1. 토스 판매량 × 소요량으로 재고 현재 수량을 **10분 동기화마다** 자동 차감한다. 이력에는 하루 한 줄.
2. 품목별 권장 발주량을 계산한다: 최근 4주 요일별 평균 소진 × (리드타임 + 안전 2일) − 현재 재고.
3. 홈 상단 경고를 예측 기반 "발주 권장 N품목" 카드로 바꾸고, 재고 페이지 상단에 같은 목록을 둔다.
4. 매니저 이상은 카드에서 "발주 기안 만들기"로 품목·수량·금액이 채워진 지출결의서 새 기안을 연다.

## 사장님 결정

- 알림은 홈 카드만. 안전일수 2일. 기안은 매니저 이상. 자동 차감 원함(실시간). 단가·발주 단위는 선택 항목.

## 비목표

- 카카오·푸시 알림, 자동 발주, 거래처별 주문서, 옵션(샷 추가 등) 소진 반영.

## 결정

- **자동 차감 기준점은 재고 점검**: 직접 센 수량(조정)이 항상 진실. 자동 차감은 점검 사이의 추정치. 과거 판매는 소급하지 않는다(`workplaces.pos_deduct_from` = 마이그레이션 실행일).
- **이력 한 줄 유지**: 품목×날짜마다 `inventory_transactions`에 'use' 한 건. 이후 갱신은 그 행의 `qty_delta`를 바꾸고 `current_qty`엔 차액만 반영(장부 `pos_usage_deductions`).
- **예측**: 최근 28일(어제까지) 날짜 격자에 소진량을 깔고(판매 0인 날 포함) 요일별 평균. 오늘부터 (리드타임+2)일의 요일 평균 합이 예상 소진. 연결 없는 품목은 기존 최소 수량 기준으로 같은 목록에 포함(`basis = 'min_qty'`).
- **권장 수량**: 예상 소진 − 현재 재고가 0보다 크면 그 값을 발주 단위 배수로 올림.
- **기안 연결**: 홈 카드 버튼 → `sessionStorage['approvalPrefill']`에 항목을 넣고 `/approvals/new?prefill=1`로 이동. 새 기안 페이지가 읽어 제목("발주 — 10/16 녹턴")·항목(설명 "품목명 N단위", 카테고리 식자재/비품, 금액 = 단가×수량 또는 빈칸, 거래처)을 채운다. 제출 전 수정 가능.

## 데이터 — 마이그레이션 `20261016_42_pos_deduction_forecast.sql`

- `inventory_items.unit_cost numeric null`, `order_unit numeric null`
- `workplaces.pos_deduct_from date` (토스 매장은 실행일로 설정)
- `pos_usage_deductions(workplace_id, inventory_item_id, sales_date, deducted_qty, transaction_id)` unique(item, date). RLS select 멤버.
- `pos_apply_usage_deductions(wp, from, to) → int` security definer, public/anon/authenticated 실행 회수.
- `inventory_order_suggestions(wp)` → 품목별 `avg_daily_usage, days_left, horizon_days, forecast_usage, suggested_qty, basis` 등. security invoker.

## 서버

- 동기화 라우트: fill 뒤 `pos_apply_usage_deductions(wp, KST(window.from)−1, KST(window.to))` 호출, 응답에 `deducted`.
- `inventory/actions.js`: `getOrderSuggestions({ workplaceId })` → 권장 수량 > 0인 품목 배열(멤버십 검증). `saveInventoryItem`에 `unit_cost`, `order_unit`.

## 화면

- 홈(`HomeClient.js`, `home/page.js`): `lowStock` 대신 `getOrderSuggestions` 결과를 쓴다. 경고 줄의 "발주 N품목" → "발주 권장 N품목". 그 아래 카드: 상위 5개 품목(이름, "약 1.5일분", 권장 N단위), 전체 보기 → 재고 페이지. 매니저 이상에게 "발주 기안 만들기" 버튼.
- 재고 페이지 상단: 같은 추천 목록 카드(접기 가능). 품목 행 보조 텍스트에 "약 N일분"(연결 품목만).
- 품목 편집기: 단가(원), 발주 단위(선택).
- 새 기안 페이지: `?prefill=1`이면 `sessionStorage`에서 읽어 채움.
- 순수 함수 `src/lib/orderDraft.js`: `buildOrderDraft(suggestions, { workplaceName, dateKey })` → `{ title, body, items }`. 테스트.

## 검증

- `node --test`: `buildOrderDraft`(금액 계산, 단가 없음, 거래처, 설명 형식).
- 42 적용 후: 로컬 동기화 → `deducted ≥ 1`, 아이스 컵 `current_qty`가 당일 판매분만큼 감소, 이력에 "POS 판매 자동 차감" 1줄, 재실행 시 중복 없음.
- `inventory_order_suggestions` 결과에서 아이스 컵 `basis='forecast'`, `horizon_days=4`.
- 브라우저: 홈 카드 → 기안 화면 채워짐(매니저 계정). 모바일 폭.

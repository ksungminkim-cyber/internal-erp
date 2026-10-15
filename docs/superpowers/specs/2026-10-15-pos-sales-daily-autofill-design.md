# 토스 POS 1b — 일 매출 자동 채움·날짜 세부·홈 매출 — 설계

날짜: 2026-10-15. 1단계 스펙: `2026-10-14-toss-pos-order-sync-design.md`

## 목표

1. `sales_daily`를 토스 주문으로 자동 채워 수기 입력을 없앤다. 수기 입력된 날과 마감된 월은 보존한다.
2. 매출 페이지에서 날짜를 누르면 그날의 합계(총액·건수·카드·현금·기타)와 상품별 판매를 본다.
3. 상품별 판매 카드에 지난 주·지난 달 범위를 더한다.
4. 홈 "오늘 매출" 칸에 거래 건수와 어제 매출을 함께 보여준다.

## 비목표

- 재고 연결(BOM), 예측, 발주 추천 (2·3단계. 범위: 원두·우유·컵·시럽·토스트부터)
- 홈의 "발주 N품목" 경고 변경 (3단계에서 예측 기반으로 교체)
- 토스 이외 매출(계좌이체 등) 자동 반영 — 수기 입력·메모를 그대로 둔다

## 결정 사항

- 결제 분류: `payments[].sourceType` CARD→카드, CASH→현금, 그 외(BARCODE 간편결제)→기타. 승인(APPROVED)만 합산. 최근 1,000건에서 승인 합계 = 주문 최종금액 100% 일치 확인.
- 총매출은 `charge_total`(할인 반영 최종금액), 거래건수는 완료 주문 수.
- 자동 채움 행의 `source`는 `pos_toss`. 직원이 수정하면 `saveSales`가 `manual`로 바꾸므로 이후 덮어쓰지 않는다.
- 완료 주문 0건인 날은 행을 만들지 않는다(휴무를 0원으로 기록하지 않음).
- 동기화 라우트가 매 실행 후 창(window) 날짜 ±1일을 다시 채운다 → 오늘 매출이 10분 지연으로 갱신.

## 구성 요소

### 마이그레이션 `20261015_39_pos_daily_summary_fill.sql`
- `pos_daily_summary(wp, from, to)` → 날짜별 total/count/card/cash/other (security invoker)
- `pos_fill_sales_daily(wp, from, to)` → `sales_daily` upsert, `source = 'pos_toss'`인 행만 갱신, 마감 월 제외, 영향 행 수 반환 (security definer, anon/authenticated 실행 권한 회수)

### 동기화 라우트 `src/app/api/pos/toss/sync/route.js`
- 매장별 주문 upsert 후 `svc.rpc('pos_fill_sales_daily', { p_workplace_id, p_from: KST(window.from) - 1일, p_to: KST(window.to) })`. 실패는 그 매장의 로그 `error`에 기록하되 주문 적재 결과는 유지.
- 응답 `results[]`에 `filledDays` 추가.

### 서버 액션 `getDaySalesDetail({ workplaceId, date })` (`sales/actions.js`)
- 권한 검증은 `getProductSales`와 동일.
- 반환 `{ summary: { total, count, card, cash, other, source } | null, items: [{ item_title, item_code, qty, amount }] }`
  - `summary`는 `sales_daily` 행(수기든 자동이든 기록된 값). 없으면 `pos_daily_summary(date, date)` 결과, 그것도 없으면 `null`.
  - `items`는 `pos_product_sales(date, date)`.

### 매출 페이지 `sales/page.js` + `DaySalesSheet.js`(신규)
- 30일 추이 막대와 일별 기록 행에 클릭 → `setDetailDate(ymd)`.
- `DaySalesSheet`는 `BottomSheet` 안에 날짜 제목, 합계 4칸(총액·카드·현금·기타)과 건수, 상품 표, 입력방식 배지(수기/POS). 닫기만 있고 편집은 기존 연필 버튼 유지.

### `ProductSalesCard.js`
- 범위 추가: `lastWeek`(지난 월~일), `lastMonth`(지난달 1일~말일).

### 홈 `home/page.js`, `home/HomeClient.js`
- `sales_daily` 조회에 어제 행을 추가(`in('sales_date', [today, yesterday])`), `todayCount`, `yesterdaySales`를 계산.
- 히어로 `bento-sub`: `{매장명} · 거래 N건 · 어제 X원`.

## 검증

- `npm test` 기존 15개 유지. 새 순수 로직(지난 주·지난 달 날짜 계산)은 `rangeDates`를 `src/lib/salesRanges.js`로 분리해 테스트.
- 마이그레이션 39 적용 후: `pos_fill_sales_daily`를 전 기간에 1회 실행 → 수기 137행은 `source='manual'` 그대로, 나머지 날은 `pos_toss`로 생성. 임의 날짜의 total이 `pos_daily_summary`와 같은지 확인.
- 로컬 동기화 호출 후 응답에 `filledDays` ≥ 1, 홈 "오늘 매출"이 0이 아닌 값으로 바뀜.
- 브라우저: 매출 페이지 날짜 클릭 → 시트에 합계·상품 표시. 지난 주·지난 달 칩 동작. 모바일 폭 확인.

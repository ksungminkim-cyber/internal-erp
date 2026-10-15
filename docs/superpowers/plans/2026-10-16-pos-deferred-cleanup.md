# 토스 POS 연동 — 미뤄둔 항목 정리 계획

날짜: 2026-10-16. 1b·2·3단계 리뷰에서 "동작에 영향 없음"으로 미뤄둔 항목을 한 번에 처리한다.

## A. SQL — 마이그레이션 `20261016_44_pos_cleanup.sql`
- [ ] A1 `inventory_order_suggestions`: 오늘 몫 = `greatest(요일평균(오늘) − 오늘 이미 소진, 0)` (이중 계산 제거)
- [ ] A2 같은 함수: 연결 품목도 `min_qty − current_qty` 를 바닥값으로 (`greatest`)
- [ ] A3 `inventory_daily_usage`, `pos_product_sales`, `pos_daily_summary` EXECUTE 를 public/anon 에서 회수 (서버는 서비스 롤)
- [ ] A4 `sales_summary(wp)` RPC: 누적·이번 달 합계·일수 (getSalesSummary 1000행 제한 해소)
- [ ] A5 `inventory_daily_usage` 에 선택 인자 `p_item_id uuid default null`

## B. 매출 페이지 (`sales/page.js`, `ProductSalesCard.js`, `DaySalesSheet.js`, `sales/actions.js`)
- [ ] B1 ProductSalesCard: 직접 선택에서 from > to 또는 빈 날짜면 "기간을 확인하세요" (무한 스켈레톤 제거)
- [ ] B2 ProductSalesCard: 서버 오류/권한 없음은 "불러오지 못했어요"로 구분
- [ ] B3 ProductSalesCard: 마지막 동기화가 오늘이 아니면 날짜 포함 (`formatDateTime`)
- [ ] B4 ProductSalesCard: 새로고침 중 버튼 비활성·회전
- [ ] B5 30일 막대: 열 전체 높이 투명 버튼 안에 막대 (터치 영역), 탭 순서 유지
- [ ] B6 일별 기록: 금액 영역까지 클릭, 편집 버튼은 `Pencil` + `aria-label="편집"`
- [ ] B7 role=button div 의 Space 에 `preventDefault`
- [ ] B8 DaySalesSheet key 에 workplaceId
- [ ] B9 getSalesSummary → `sales_summary` RPC
- [ ] B10 getDaySalesDetail: `pos_daily_summary` 오류를 throw
- [ ] B11 SalesEditor: 오늘·POS 자동 행을 편집할 때 "수정하면 이 날은 자동 갱신이 멈춥니다" 안내

## C. 동기화·토스 클라이언트 (`tossPlace.js`, `sync/route.js`)
- [ ] C1 tossPlace: 최대 페이지 가드(200페이지) — 테스트
- [ ] C2 tossPlace: `success` 가 배열도 `{orders}` 도 아니면 throw — 테스트
- [ ] C3 route: 비밀키 비교 `timingSafeEqual`

## D. 소요량 연결 (`UsageEditor.js`, `inventory/actions.js`)
- [ ] D1 saveProductUsage: upsert 후 목록에 없는 행 삭제 (delete+insert 비원자성 제거)
- [ ] D2 UsageEditor: "최근 90일 판매 없음" 연결을 별도 섹션으로 표시·해제 가능
- [ ] D3 UsageEditor: 일괄 적용은 현재 보이는(검색된) 체크 행에만
- [ ] D4 UsageEditor: 체크박스 터치 영역·단위 폭·저장 성공 토스트
- [ ] D5 getProductUsage: `inventory_daily_usage(p_item_id)` 로 해당 품목만

## E. 재고·홈 (`inventory/page.js`, `home/page.js`, `HomeClient.js`, `OrderSuggestionsCard.js`)
- [ ] E1 재고 카드 접기(기본 펼침, 접힘은 localStorage)
- [ ] E2 홈 SSR `lowStock` 조회·계산 제거
- [ ] E3 재고 ± 시트: 연결 품목이면 "POS 판매는 자동 차감됩니다 — 실제 센 수량은 '조정'으로" 안내
- [ ] E4 OrderSuggestionsCard: 매장명 없으면 제목에서 공백 제거(`buildOrderDraft` 테스트)

## F. 공용
- [ ] F1 BottomSheet: `borderRadius` 와 `borderTopLeftRadius` 혼용 콘솔 경고 제거

## 검증
- `npm test` (C1·C2·E4 추가), lint 변경 파일, 브라우저: 매출 페이지(막대 클릭, 직접 선택 오류 문구), 재고(카드 접기, 소요량 시트 섹션), 홈.

# 토스 POS 1b — 일 매출 자동 채움·날짜 세부·홈 매출 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 토스 주문으로 `sales_daily`를 자동 채우고, 매출 페이지 날짜 세부 시트·지난 주/지난 달 범위·홈 오늘 매출 보강을 추가한다.

**Architecture:** SQL 함수 두 개(합산·채움)를 동기화 라우트가 매 실행 후 호출한다. 화면은 기존 서버 액션 패턴과 `BottomSheet`를 재사용한다.

**Tech Stack:** Next.js 16, Supabase RPC, `node --test`.

스펙: `docs/superpowers/specs/2026-10-15-pos-sales-daily-autofill-design.md`

## Global Constraints
- 1단계 계획의 제약 그대로 (의존성 추가 금지, 서비스 롤 패턴, KST 날짜, 커밋 관례).
- 수기 `sales_daily` 행(`source <> 'pos_toss'`)과 마감 월은 절대 덮어쓰지 않는다.

---

### Task 1: 마이그레이션 39 적용 확인 + 전 기간 채움
- [ ] 사용자가 SQL Editor에서 실행 → `svc.rpc('pos_daily_summary', …)`로 임의 날짜 합계 확인
- [ ] `svc.rpc('pos_fill_sales_daily', { p_from: '2025-05-01', p_to: 오늘 })` 매장별 1회 → `sales_daily` 건수, manual 137행 보존 확인
- [ ] 커밋: `feat: 토스 주문 → 일 매출 합산·자동 채움 함수 (마이그레이션 39)`

### Task 2: 동기화 라우트가 채움 호출
- [ ] `syncWorkplace`에서 upsert 후 `pos_fill_sales_daily` 호출, `filledDays` 응답, 실패 시 로그 error
- [ ] 로컬 `{"hours":24}` 호출 → `filledDays ≥ 1`
- [ ] 커밋: `feat: 동기화 후 sales_daily 자동 채움`

### Task 3: 범위 계산 분리 + 지난 주·지난 달 (TDD)
- [ ] `src/lib/salesRanges.test.js`: today/week/month/lastWeek/lastMonth/custom, 고정 기준일로 검증 → RED
- [ ] `src/lib/salesRanges.js` `rangeDates(key, custom, now)` → GREEN
- [ ] `ProductSalesCard.js`가 lib 사용, 칩 6개
- [ ] 커밋: `feat: 상품별 판매 지난 주·지난 달 범위`

### Task 4: 날짜 세부 시트
- [ ] `getDaySalesDetail` 서버 액션
- [ ] `DaySalesSheet.js` + 매출 페이지 막대/행 클릭 연결
- [ ] 브라우저 확인(데스크톱·모바일), lint
- [ ] 커밋: `feat: 매출 페이지 날짜 클릭 세부 시트`

### Task 5: 홈 오늘 매출 보강
- [ ] `home/page.js`, `HomeClient.js`: 어제 행 조회, `todayCount`·`yesterdaySales`, 히어로 서브라인
- [ ] 브라우저 확인
- [ ] 커밋: `feat: 홈 오늘 매출에 거래 건수·어제 매출 표시`

### Task 6: 배포
- [ ] `npm test`, lint(변경 파일), main 머지·푸시, 프로덕션 GET 405 확인, 10분 후 `sales_daily` 오늘 행 갱신 확인

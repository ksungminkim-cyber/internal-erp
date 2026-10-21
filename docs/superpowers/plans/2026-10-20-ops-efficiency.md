# 운영 효율 묶음 (실사·모니터링·입고 연결·부가) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재고 숫자가 현실과 맞게 유지되도록 (1) 한 화면 실사, (2) 포스·매출 이상 감지, (3) 발주 기안 → 입고 확인 연결을 만들고, 부가로 리드타임 자동 보정·거래처별 발주·홈 "오늘 할 일"·장기 미사용 표시를 붙인다.

**Architecture:** 스키마·SQL 함수·cron 은 마이그레이션 52 한 파일(사장님이 SQL Editor 에서 수동 실행). 서버 액션은 서비스롤 + `loadActorPerms` 멤버 검사 패턴. 순수 로직(실사 거래 계산, 입고 라인 매칭, 초안 거래처 필터)은 `src/lib/*.js` 에 두고 `node --test` 로 검증. UI 는 기존 BottomSheet·card·segment 패턴.

**Tech Stack:** Next.js 16 App Router(JS), Supabase(Postgres, pg_cron, RLS), node:test.

**Spec:** 이 세션 대화에서 사장님이 승인한 설계(2026-10-20). 결정 사항은 아래 Global Constraints 에 옮김.

## Global Constraints

- 실사 입력은 세는 단위 **선택 가능**(품목마다 드롭다운, 기본 = 현재 unit). 단위를 바꾸면 품목 unit 도 그 값으로 저장. g·ml 소진 단위 입력은 없음.
- 실사 저장: 입력한 품목만, `adjust` 거래 `qty_delta = 센 수량 − 현재`, note `실사 MM/DD`. 차이 0 이면 거래 없이 `last_counted_at` 만 갱신. 누구나(매장 멤버) 가능, 사유 강제 없음.
- 모니터링 알림은 기존 `notifications` 테이블(앱 알림함)만. 외부 발송 없음. 기준치: 동기화 40분·6시간 1회, 주문 끊김 "4주 같은 요일·시간대 평균 ≥ 2건인데 최근 60분 0건"·3시간 1회, 매출 급감 "같은 요일 4주 평균 대비 −30% 이하"·KST 23:40 하루 1회. 수신: 동기화 → 본사 멤버, 주문 끊김·매출 급감 → 해당 매장 manager/owner + 본사.
- 입고: 승인된 지출결의서(`doc_type='expense'`, `status='approved'`, `received_at is null`)가 "입고 대기". 확인 시 라인별 재고 품목·받은 수량 → `restock` 거래 note `입고 · <기안 제목>`. 일부만 와도 그 기안은 닫음. 재고 품목 아닌 라인은 제외. 단가 자동 갱신 `unit_cost = amount / qty`(둘 다 > 0). 리드타임 보정 `lead_time_days = round((lead_time_days + 관측일수)/2)`, 관측일수 = 승인일→입고일, 0~30일만 반영.
- 기존 승인 문서는 입고 대기에 쏟아지지 않도록 마이그레이션에서 `received_at = decided_at` 백필.
- 거래처별 발주: 발주 카드에 거래처 칩(거래처 없음 포함). 칩을 고르면 그 거래처 품목만으로 기안 초안. "전체" 기본.
- 홈 "오늘 할 일": 미완 오픈·마감 체크리스트, 미확인 인수인계, 입고 대기, 재고 알림(발주 카드 품목 수), 내 결재 대기 — 한 카드에 한 줄씩, 0건은 숨김. 기존 "긴급 알림" 띠를 대체.
- 장기 미사용: 30일간 재고 거래(자동 차감 포함)가 없는 품목에 "30일 미사용" 태그 + 재고 페이지 필터.
- 마이그레이션 파일명 `supabase/migrations/20261020_52_stock_count_monitor_inbound.sql`. 보류 중인 추적 방식(tracking_mode) 변경은 이 플랜에 **포함하지 않음**.

## Review Focus

- 실사에서 자동 차감 품목을 세는 동안 10분 cron 이 돌아 현재 수량이 바뀐 경우 → 센 수량 기준으로 조정되어야(차이는 저장 시점의 current_qty 로 계산, 서버에서 최신값 재조회). Task 2 테스트 `applyStockCount recomputes delta from fresh current_qty`.
- 입고 라인 설명에 수량이 없을 때("원두" 만) → qty 빈칸으로 두고 사용자가 입력, 0 이면 그 라인은 건너뜀. Task 4 테스트 `parseLineQty returns null when absent`.
- 같은 재고 품목이 두 라인에 있을 때 → 두 번 입고 거래(합산 아님), 리드타임·단가는 마지막 라인 기준. Task 4 테스트 `confirmInbound handles duplicate item lines`.
- 매장에 pos_store_code 가 없는 매장(본사) → 동기화·주문 끊김 모니터링 제외. Task 3 SQL `where pos_store_code is not null`.
- 거래처 칩으로 일부만 기안했을 때 나머지 품목은 다음 로드에서 그대로 남아야 함(기안 생성이 추천을 지우지 않음). Task 5 테스트 `buildOrderDraft vendor filter`.

---

### Task 1: 마이그레이션 52 (스키마·SQL 함수·cron)

**Files:**
- Create: `supabase/migrations/20261020_52_stock_count_monitor_inbound.sql`

**Produces:**
- `inventory_items.last_counted_at timestamptz`
- `expense_items.inventory_item_id uuid null`, `expense_items.qty numeric(14,3) null`
- `approval_requests.received_at timestamptz`, `received_by uuid`
- `monitor_alerts(id, workplace_id, kind, fired_at, detail jsonb)`
- `sales_vs_usual(p_workplace_id uuid) returns table(today_total numeric, usual_avg numeric, pct numeric)` — security invoker, 같은 요일 최근 4주 `sales_daily` 평균(오늘 제외, 0 인 날 제외)
- `monitor_pos_health()` — 매 30분. 동기화 중단 + 주문 끊김. 알림 insert + `monitor_alerts` 기록(중복 억제)
- `monitor_sales_drop()` — 하루 1회. 매출 급감
- `inventory_idle_items(p_workplace_id uuid, p_days int) returns table(inventory_item_id uuid, last_tx_at timestamptz)` — p_days 동안 `inventory_transactions` 없는 품목
- cron `monitor-pos-30m` (`*/30 * * * *`, `select monitor_pos_health()`), `monitor-sales-daily` (`40 14 * * *`, `select monitor_sales_drop()`)
- 백필: `update approval_requests set received_at = decided_at where doc_type='expense' and status='approved' and received_at is null`

- [ ] **Step 1: 파일 작성** (위 산출물 전부, 기존 마이그레이션 헤더 주석 스타일)
- [ ] **Step 2: 사장님께 실행 요청** — 실행 전까지 Task 2 의 순수 로직만 진행
- [ ] **Step 3: 검증** — 실행 후 `select sales_vs_usual('<녹턴 id>')`, `select monitor_pos_health()` 를 서비스롤 RPC 로 호출해 오류 없음 확인, `cron.job` 에 두 job 등록 확인
- [ ] **Step 4: Commit** `feat: 마이그레이션 52 — 실사 시각·입고 연결 컬럼·모니터링 함수·cron`

### Task 2: 재고 실사 모드

**Files:**
- Create: `src/lib/stockCount.js`, `src/lib/stockCount.test.js`, `src/app/(app)/inventory/StockCountSheet.js`
- Modify: `src/app/(app)/inventory/actions.js` (add `applyStockCount`), `src/app/(app)/inventory/page.js` (헤더 "재고 세기" 버튼, 행에 "실사 N일 전")

**Interfaces:**
- `buildCountPlan(lines, items, { dateKey })` in stockCount.js — `lines: [{ itemId, counted: number|'' , unit }]`, `items: [{ id, current_qty, unit }]` → `{ transactions: [{ item_id, type:'adjust', qty_delta, note }], unitChanges: [{ id, unit }], countedIds: string[] }`. 빈 counted 는 건너뜀. qty_delta 0 은 transactions 에 없고 countedIds 에는 포함.
- `formatCountedAgo(lastCountedAt, now)` → `''` | `'실사 오늘'` | `'실사 N일 전'`.
- `applyStockCount({ workplaceId, lines })` server action → `{ ok, adjusted: n }`. 서버에서 items 최신값을 다시 읽어 buildCountPlan 호출(Review Focus 1).

- [ ] **Step 1: 실패 테스트** — `buildCountPlan: 입력한 품목만, 차이만큼 adjust, 0 차이는 countedIds 만`, `buildCountPlan: 단위 바꾼 품목은 unitChanges`, `formatCountedAgo`
- [ ] **Step 2: `node --test src/lib/stockCount.test.js` → FAIL (module not found)**
- [ ] **Step 3: stockCount.js 구현**
- [ ] **Step 4: 테스트 PASS**
- [ ] **Step 5: `applyStockCount` 구현** — bulk insert transactions, `update inventory_items set last_counted_at=now()` in countedIds, unitChanges 개별 update
- [ ] **Step 6: StockCountSheet.js** — BottomSheet, 검색, 정렬(오래된 실사 순/이름), 카테고리 섹션, 행: 이름·현재 수량·unit 드롭다운(COUNT_UNITS + 직접 입력 재사용 → page.js 의 UnitSelect 를 export 하거나 복제)·센 수량 input, 하단 고정 "N품목 저장"
- [ ] **Step 7: page.js** — 헤더에 `ClipboardCheck` "재고 세기" 버튼, InventoryRow 메타에 `formatCountedAgo(item.last_counted_at)`
- [ ] **Step 8: 브라우저 검증** — 2개 품목 세기 저장 → 거래 이력에 `실사 10/20` adjust, last_counted_at 갱신
- [ ] **Step 9: Commit** `feat: 재고 실사 모드 — 한 화면에서 세기·단위 선택·조정 거래 일괄 기록`

### Task 3: 포스·매출 이상 감지 + 홈 "평소 대비"

**Files:**
- Modify: `src/app/(app)/home/page.js` (SSR `sales_vs_usual` rpc), `src/app/(app)/home/HomeClient.js` (오늘 매출 타일에 `평소 대비 ±N%`)
- SQL 은 Task 1 에서 완료.

- [ ] **Step 1: page.js** 에 `supabase.rpc('sales_vs_usual', { p_workplace_id: wpId })` 추가, `initialStats.salesVsUsual = { usualAvg, pct }`
- [ ] **Step 2: HomeClient** 오늘 매출 타일 아래 작은 글씨 `평소(같은 요일) 대비 +12%` / `−18%`(danger 색), usualAvg 0 이면 숨김
- [ ] **Step 3: 모니터 함수 수동 호출** — 서비스롤로 `monitor_pos_health()` 실행 → 정상이면 알림 0건; `pos_sync_log` 를 조건에 맞게 흉내내기 어려우므로 함수 본문의 조건식을 SQL 로 직접 검증(`select ... where finished_at < now()-interval '40 min'`)
- [ ] **Step 4: Commit** `feat: 포스 동기화·주문 끊김·매출 급감 알림, 홈 평소 대비`

### Task 4: 발주 → 입고 연결

**Files:**
- Create: `src/lib/inboundMatch.js`, `src/lib/inboundMatch.test.js`, `src/app/(app)/inventory/InboundCard.js`
- Modify: `src/lib/orderDraft.js` (items 에 `inventory_item_id`, `qty`), `src/app/(app)/approvals/new/page.js` (items state 에 두 필드 보존·전달), `src/app/(app)/approvals/actions.js` (`submitApproval`/`updateApproval` insert 에 두 컬럼), `src/app/(app)/inventory/actions.js` (`getPendingInbound`, `confirmInbound`, `dismissInbound`), `src/app/(app)/inventory/page.js` (InboundCard 마운트)

**Interfaces:**
- `matchInboundLines(expenseItems, inventoryItems)` → `[{ expenseItemId, description, amount, itemId: string|null, qty: number|null, auto: boolean }]`. `inventory_item_id` 가 있으면 그대로(auto=false), 없으면 `normalizeTitle` 포함 매칭 중 가장 긴 이름(auto=true). qty: 저장값 → 없으면 `parseLineQty(description)`.
- `parseLineQty(description)` → 끝의 `숫자+단위`(`원두 3봉`, `우유 1L 12개`) 에서 숫자, 없으면 null.
- `getPendingInbound({ workplaceId })` → `[{ id, title, decided_at, lines: matchInboundLines(...) }]`
- `confirmInbound({ workplaceId, requestId, lines: [{ expenseItemId, itemId, qty, amount }] })` → `{ ok, restocked: n }`
- `dismissInbound({ workplaceId, requestId })` → `{ ok }` (received_at 만)

- [ ] **Step 1: 실패 테스트** — `parseLineQty`, `matchInboundLines: 저장된 품목 우선, 없으면 이름 매칭, 못 찾으면 null`, `buildOrderDraft items carry inventory_item_id/qty`
- [ ] **Step 2: FAIL 확인 → 구현 → PASS**
- [ ] **Step 3: 액션 3개** — confirm: 라인별 restock 거래(note `입고 · 제목`), expense_items 매핑 저장, unit_cost·lead_time_days 보정, request received_at/by. Review Focus 3(중복 라인) 은 라인마다 거래 → 합산 아님.
- [ ] **Step 4: 기안 경로** — new/page items 에 `inventory_item_id`, `qty` 보존(prefill 과 edit 로드 모두), 두 서버 액션 insert 에 포함
- [ ] **Step 5: InboundCard** — 재고 페이지 발주 카드 아래. 기안별 카드: 제목·승인일·라인(품목 select: 자동 매칭은 점선 표시, 수량 input), "입고 확인" / "재고 아님" 버튼
- [ ] **Step 6: 브라우저 검증** — 발주 카드에서 기안 → 승인(테스트 계정 결재선: 본인이 임원이면 1단계) → 입고 대기 표시 → 입고 확인 → restock 거래·unit_cost·received_at 확인 → 기안 취소/정리
- [ ] **Step 7: Commit** `feat: 발주 기안 → 입고 확인 연결, 단가·리드타임 자동 보정`

### Task 5: 거래처별 발주 묶기

**Files:**
- Modify: `src/lib/orderDraft.js` (`buildOrderDraft(suggestions, { ..., vendor })`, `vendorsOf(suggestions)`), `src/lib/orderDraft.test.js`, `src/components/OrderSuggestionsCard.js` (칩)

- [ ] **Step 1: 실패 테스트** — `vendorsOf: 거래처별 건수(없음 포함)`, `buildOrderDraft: vendor 지정 시 그 거래처만, 제목에 거래처명`
- [ ] **Step 2: FAIL → 구현 → PASS**
- [ ] **Step 3: 카드** — purchase 거래처가 2개 이상일 때 기안 버튼 위에 칩(전체 / 거래처 A 3 / 거래처 없음 2). 선택 상태는 카드 로컬.
- [ ] **Step 4: Commit** `feat: 발주 기안 초안 거래처별 묶기`

### Task 6: 홈 "오늘 할 일"

**Files:**
- Create: `src/components/TodayTodoCard.js`
- Modify: `src/app/(app)/home/page.js` (오늘 체크리스트 완료 상태, 입고 대기 수 SSR), `src/app/(app)/home/HomeClient.js` (긴급 알림 띠 → TodayTodoCard, orderCount 전달)

**Interfaces:**
- props `{ inbox, handoverUnresolved, checklists: [{ name, done, total, href }], inboundPending, stockAlerts }` — 0 인 줄은 숨김, 전부 0 이면 카드 자체 숨김.

- [ ] **Step 1: page.js** — `checklist_templates(active, type in open/close)` + 오늘 `checklist_completions` 로 `{name, done, total}`; `approval_requests` count(expense, approved, received_at null)
- [ ] **Step 2: TodayTodoCard + HomeClient 교체**
- [ ] **Step 3: 브라우저 확인**
- [ ] **Step 4: Commit** `feat: 홈 오늘 할 일 카드 — 체크리스트·인수인계·입고 대기·재고 알림·결재`

### Task 7: 장기 미사용 품목

**Files:**
- Modify: `src/app/(app)/inventory/actions.js` (`getIdleItems({ workplaceId, days = 30 })` → `{ [itemId]: lastTxAt|null }`), `src/app/(app)/inventory/page.js` (태그 `30일 미사용`, 필터 칩 `장기 미사용 (N)`)

- [ ] **Step 1: 액션 + 필터·태그**
- [ ] **Step 2: 브라우저 확인**
- [ ] **Step 3: Commit** `feat: 30일 미사용 품목 표시·필터`

### Task 8: 마무리

- [ ] 리뷰 서브에이전트(브랜치 전체) → Critical/Important 수정
- [ ] `npm test`, `npx eslint src` (기존 2건 제외) 통과
- [ ] main 머지·푸시·Vercel Ready 확인, 메모리 갱신

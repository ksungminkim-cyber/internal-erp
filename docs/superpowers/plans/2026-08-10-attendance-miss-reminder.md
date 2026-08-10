# 근태 누락 리마인더 (A안) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시프트에 배치됐는데 출퇴근 기록이 없는 경우를 직원 배너(사전)와 관리자 누락 위젯(사후)으로 잡는다.

**Architecture:** 스케줄 페이지의 계획-실적 매칭 로직을 `src/lib/attendanceMatch.js`로 추출해 공용화. 직원 배너는 `(app)` 레이아웃에 마운트된 클라이언트 컴포넌트가 서버 액션으로 본인 시프트+로그를 받아 판정. 관리자 위젯은 근태 이력 페이지에서 서버 액션(관리자 검증)으로 최근 7일 데이터를 받아 판정하고, 기존 기록 추가 시트를 프리필로 연다. 새 테이블·cron 없음.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase(service role), React 19 클라이언트 컴포넌트.

## Global Constraints

- 테스트 인프라 없음 — 검증은 `npm run lint` + `npm run build` + 브라우저 스모크
- 판정 기준: 로그 매칭 창 ±2h, 결근 유예 30분, 지각 임계 10분 (기존 스케줄 페이지 값 유지)
- 에러는 throw 대신 `{ ok:false, error }` return (기존 액션 관례)
- 서버 액션은 `getServiceClient()` + 본인/관리자 검증 패턴 유지
- UI는 기존 클래스(card, btn, tag, segment 등)와 CSS 변수만 사용

---

### Task 1: 판정 로직 공용화 (`src/lib/attendanceMatch.js`)

**Files:**
- Create: `src/lib/attendanceMatch.js`
- Modify: `src/app/(app)/schedule/page.js:49-108` (로컬 `matchAttendance`·`LATE_THRESHOLD_MIN` 제거, import로 대체)

**Interfaces:**
- Produces: `matchAttendance(shift, logs)` (기존과 동일 동작), `shiftRecordStatus(shift, logs, now = Date.now())` → `{ clockIn, clockOut, started, ended, missingIn, missingOut, graceInPassed, graceOutPassed } | null(취소 시프트)`, 상수 `LOG_WINDOW_MS`

- [ ] **Step 1: lib 파일 작성** — 스케줄 페이지 51-108행 로직을 이동하고 `shiftRecordStatus` 추가 (아래 Task 3/4의 코드가 사용하는 형태 그대로)
- [ ] **Step 2: schedule/page.js에서 로컬 정의 삭제 + `import { matchAttendance } from '@/lib/attendanceMatch';`**
- [ ] **Step 3: `npm run lint` 통과 확인**
- [ ] **Step 4: Commit** `refactor: 계획-실적 매칭 로직 공용 lib로 추출`

### Task 2: 서버 액션 2개 (`attendance/actions.js`)

**Files:**
- Modify: `src/app/(app)/attendance/actions.js` (파일 끝에 추가)

**Interfaces:**
- Produces: `getMyShiftReminders(workplaceId)` → `{ shifts, logs }` (본인 한정, 어제 00:00~내일 00:00 시작 시프트 + 로그), `getMissingAttendance(workplaceId, fromISO, toISO)` → `{ shifts, logs }` (관리자 검증, 시프트에 `user: { name }` enrich)

- [ ] **Step 1: 두 액션 구현** (본인용은 권한 검증 없음/본인 필터, 관리자용은 `isManagerOf` + cancelled 제외 + profiles 이름 enrich, 로그는 기간 ±2h 창 포함)
- [ ] **Step 2: `npm run lint` 통과 확인**
- [ ] **Step 3: Commit** `feat: 근태 리마인더용 조회 액션 추가`

### Task 3: 직원 리마인더 배너

**Files:**
- Create: `src/components/AttendanceReminderBanner.js`
- Modify: `src/app/(app)/layout.js:34` (`app-shell` div 안 children 앞에 마운트)

**Interfaces:**
- Consumes: `getMyShiftReminders`, `recordAttendance`, `shiftRecordStatus`, `LOG_WINDOW_MS`
- 표시 우선순위: 진행 중 출근 누락(원탭 출근) > 종료 +2h 이내 퇴근 누락(원탭 퇴근) > 지난 누락(보정 안내 + `/attendance/history` 링크)
- 닫기: localStorage `att_reminder_dismissed` = `{ "<shiftId>:<kind>": timestamp }`, 7일 지난 키는 정리

- [ ] **Step 1: 배너 컴포넌트 작성** (마운트·사업장 전환 시 로드, 원탭 성공 시 재로드로 배너 소멸)
- [ ] **Step 2: layout.js 마운트**
- [ ] **Step 3: `npm run lint` 통과 확인**
- [ ] **Step 4: Commit** `feat: 근태 미기록 직원 리마인더 배너`

### Task 4: 관리자 누락 위젯 (근태 이력 페이지)

**Files:**
- Modify: `src/app/(app)/attendance/history/page.js` (필터 카드 위에 관리자 전용 "기록 누락" 섹션, `AddSheet`에 optional `initial` prop)

**Interfaces:**
- Consumes: `getMissingAttendance`, `shiftRecordStatus`
- 포함 규칙: `graceInPassed`(출근 누락) 또는 `graceOutPassed`(퇴근 누락), 최근 7일
- "기록 채우기" → `AddSheet`를 `{ userId, eventType('clock_in'|'clock_out'), eventAt(시프트 시작/종료) }` 프리필로 오픈, 저장 후 목록·로그 재조회

- [ ] **Step 1: `AddSheet`에 `initial` prop 추가** (기본값은 기존 동작 유지)
- [ ] **Step 2: 누락 섹션 구현** (isManager && 건수 > 0일 때만 렌더)
- [ ] **Step 3: `npm run lint` 통과 확인**
- [ ] **Step 4: Commit** `feat: 관리자 근태 누락 위젯 + 보정 프리필`

### Task 5: 근태 메인 누락 칩

**Files:**
- Modify: `src/app/(app)/attendance/AttendanceClient.js` (main 상단에 관리자 전용 "최근 7일 누락 N건" 링크 카드)

**Interfaces:**
- Consumes: `getMissingAttendance`, `shiftRecordStatus`

- [ ] **Step 1: isManager일 때 최근 7일 누락 건수 로드 + 0건이면 미표시, N건이면 `/attendance/history` 링크 칩**
- [ ] **Step 2: `npm run lint` 통과 확인**
- [ ] **Step 3: Commit** `feat: 근태 메인에 누락 건수 칩`

### Task 6: 최종 검증

- [ ] **Step 1: `npm run lint`** — 에러 0
- [ ] **Step 2: `npm run build`** — 성공
- [ ] **Step 3: dev 서버 브라우저 스모크** — 배너/위젯 렌더 확인 (시프트 데이터 없으면 미표시 확인)

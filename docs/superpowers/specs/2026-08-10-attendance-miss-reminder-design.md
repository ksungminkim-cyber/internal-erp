# 근태 누락 리마인더 (A안) — 설계

날짜: 2026-08-10

## 문제

시프트 월간 스케줄(`shifts`)에 배치된 직원이 출퇴근 기록(`attendance_logs`)을 안 찍으면
급여 정산·리포트가 부정확해진다. 현재는 관리자가 수동으로 발견해서 보정해야 한다.

## 목표

1. **직원 사전 방지**: 앱 접속 시 "지금 시프트인데 출근 기록 없음 / 시프트 끝났는데 퇴근 기록 없음"을
   배너로 알리고 원탭으로 즉시 기록하게 한다.
2. **관리자 사후 발견**: 최근 7일 누락 목록을 근태 이력 페이지에 보여주고,
   기존 보정 도구(기록 추가 시트)로 바로 채우게 한다.

## 비목표 (제외)

- 웹푸시 / PWA / 카카오 알림톡 / cron 서버 알림 (B안 — 추후 필요 시)
- 새 DB 테이블·마이그레이션 (기존 `shifts` + `attendance_logs` 조회만 사용)

## 판정 기준 (기존 스케줄 페이지 `matchAttendance` 기준 유지)

- 로그 매칭 창: 시프트 시작 −2h ~ 종료 +2h, 본인 로그만
- **출근 누락**: 취소 아님 + 시작 시각 경과 + 매칭 `clock_in` 없음
  - 관리자 위젯은 시작 +30분 경과부터 (기존 결근 판정과 동일)
- **퇴근 누락**: `clock_in` 있음 + 종료 경과 + 매칭 `clock_out` 없음
  - 관리자 위젯은 종료 +2h 경과부터 (아직 일하는 중일 수 있음)

## 구성 요소

### 1. `src/lib/attendanceMatch.js` (신규, 순수 함수)

- `matchAttendance(shift, logs)` — 스케줄 페이지에서 그대로 이동 (지각/조퇴/결근 라벨)
- `shiftRecordStatus(shift, logs, now)` — 배너·위젯 공용 누락 판정
  `{ clockIn, clockOut, missingIn, missingOut, started, ended }` 반환, 취소 시프트는 `null`
- 스케줄 페이지는 이 모듈을 import (동작 변화 없음)

### 2. 직원 배너 `src/components/AttendanceReminderBanner.js` (신규)

- `(app)/layout.js`의 `app-shell` 안, `children` 위에 마운트 → 모든 페이지에서 보임
- 마운트/사업장 전환 시 서버 액션 `getMyShiftReminders`로 내 시프트(어제 00:00~내일 00:00)+내 로그 조회
- 표시 규칙 (우선순위 순, 한 번에 하나만):
  - 출근 누락 & 시프트 진행 중 → "출근 기록이 없어요" + **원탭 출근** (`recordAttendance` 재사용)
  - 퇴근 누락 & 종료 +2h 이내 → "퇴근 기록이 없어요" + **원탭 퇴근**
  - 그 외 지난 누락(어제 등) → "기록 누락 — 관리자에게 보정을 요청하세요" + 근태 이력 링크
- X 닫기 → `localStorage`에 `{shiftId}:{kind}` 저장, 같은 건 다시 안 뜸

### 3. 관리자 누락 위젯 (근태 이력 페이지)

- `isManager`만, 최근 7일 대상, 서버 액션 `getMissingAttendance`(관리자 검증 + 이름 포함) 사용
- 행: 날짜 · 직원명 · 시프트 시간 · 누락 유형(출근/퇴근) · **기록 채우기** 버튼
- 기록 채우기 → 기존 `AddSheet`를 직원·구분·시각 프리필로 오픈 (optional `initial` prop 추가)
- 근태 메인(`AttendanceClient`)에 관리자 전용 "누락 N건" 링크 칩 → 이력 페이지 유도

### 4. 서버 액션 (`attendance/actions.js`에 추가)

- `getMyShiftReminders(workplaceId)` — 본인 시프트+로그만, 권한 검증 불필요(본인 한정)
- `getMissingAttendance(workplaceId, fromISO, toISO)` — `isManagerOf` 검증 후
  시프트(이름 enrich)+로그 반환, 누락 계산은 클라이언트에서 공용 lib로

## 검증

- 프로젝트에 테스트 인프라 없음(관례) → `npm run lint` + `npm run build` + 브라우저 스모크
- 판정 로직은 기존 검증된 코드 이동이 대부분

# Internal ERP

나울·녹턴 카페 통합 사내 ERP. 근태 관리·전자결재·공지사항을 모바일 우선으로 제공합니다.

## 스택

- Next.js 16 (App Router) + React 19
- Supabase (Auth + Postgres + RLS + Realtime + Storage)
- Tailwind 4
- PWA (홈화면 추가 지원)

## 개발

```bash
npm install
npm run dev
```

`.env.local` 에 Supabase 키를 채워주세요. `.env.local.example` 참고.

## Supabase 마이그레이션

`supabase/migrations/` 의 SQL 파일들을 **번호 순서대로** Supabase SQL Editor에서 실행해주세요.

1. `20260521_01_core_schema.sql` — 프로필·사업장·멤버십·RLS 헬퍼
2. `20260521_02_attendance.sql` — 근태 + 실시간
3. `20260521_03_announcements.sql` — 공지사항
4. `20260521_04_approvals.sql` — 전자결재·결재선·항목·첨부 + 자동 진행 트리거
5. `20260521_05_storage.sql` — 영수증 스토리지 버킷

## 최초 셋업 가이드

1. Supabase에서 마이그레이션 실행
2. 사용자 회원가입 (`/login`)
3. Supabase 대시보드에서 `memberships` 테이블에 `(user_id, workplace_id, role='owner')` 행 추가
4. 로그인하면 사용 가능

## 주요 기능 (Phase 1)

- **근태** — 출/퇴근/휴게 버튼, 실시간 매장 현황 보드
- **전자결재** — 다단계 결재선, 지출결의서, 영수증 첨부, 자동 단계 진행
- **공지사항** — 매니저 작성, 직원 읽음 확인
- **모바일 우선** — 하단 탭바, PWA, 안전 영역 대응

## 다음 단계 (Phase 2)

- 시프트 스케줄
- 인수인계 노트
- 오픈/마감 체크리스트
- 재고/발주 관리
- 일 매출 입력

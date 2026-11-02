-- ========================================================================
-- 59. 광고 현황 액션 버튼 실행 기록 (해석과 다음 액션 → 버튼 → 실제 광고 설정 변경)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================
create table if not exists ad_actions (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid references profiles(user_id) on delete set null,
  ch text not null,            -- 네이버 / 구글 / 메타 / 당근
  kind text not null,          -- naver.adLock, google.budget ...
  label text not null,         -- 버튼 문구
  args jsonb not null default '{}',
  ok boolean not null,
  result text                  -- 성공 문장 또는 오류
);
create index if not exists idx_ad_actions_at on ad_actions(at desc);
-- 읽기·쓰기 모두 서비스 롤(서버 액션)만. 정책 없음.
alter table ad_actions enable row level security;

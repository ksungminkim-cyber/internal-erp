-- ========================================================================
-- 진행 중(결재 대기) 기안 수정 — 수정 횟수·시각 기록
-- 수정 시 결재 단계를 모두 지우고 다시 만들어 처음부터 결재를 받는다 (기존 승인 무효).
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

alter table approval_requests
  add column if not exists edit_count integer not null default 0,
  add column if not exists edited_at timestamptz;

comment on column approval_requests.edit_count is '진행 중 수정 횟수 (수정할 때마다 결재 단계 초기화)';
comment on column approval_requests.edited_at is '마지막 수정 시각';

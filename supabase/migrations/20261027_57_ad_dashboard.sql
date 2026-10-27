-- ========================================================================
-- 광고 현황 대시보드 저장소 — 광고 모니터링 팀이 매일 마감 후 완성된 HTML 한 장을 올려 두고,
-- ERP의 /ads 페이지(대표 전용)가 그대로 보여준다.
-- 쓰기: /api/ads/publish (서비스롤 + x-ads-secret). 읽기: /ads 서버액션(서비스롤 + 코드 권한검증).
-- RLS는 켜되 정책을 두지 않아 로그인 사용자 권한으로는 읽고 쓸 수 없다.
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

create table if not exists ad_dashboard (
  id          text primary key,            -- 'nocturne'
  html        text not null,               -- 대시보드 본문 (head/body 없는 조각)
  closed_date date,                        -- 마감 기준일
  built_at    timestamptz,                 -- 생성 시각
  updated_at  timestamptz not null default now()
);

alter table ad_dashboard enable row level security;

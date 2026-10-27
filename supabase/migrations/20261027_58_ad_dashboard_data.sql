-- ========================================================================
-- 광고 현황 — HTML 조각 대신 구조화된 데이터(jsonb)를 저장. /ads 페이지가 ERP 스타일로 직접 그린다.
-- data: { closed, built, days:[{d, naver:{cost,imp,in}, meta:{...}, google:{...}, karrot:{...}}], alerts, ads, funding, comments, naver, meta, google, karrot }
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

alter table ad_dashboard add column if not exists data jsonb;
alter table ad_dashboard alter column html drop not null;

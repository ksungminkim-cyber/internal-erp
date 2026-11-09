-- ========================================================================
-- 60. 광고 일 마감 자동 채움 — 매일 09:35 KST(00:35 UTC) 에 ERP /api/ads/close 를 호출.
-- 데스크톱 앱의 09:30 작업이 안 돌아도 광고 현황의 어제까지 데이터가 채워진다 (토스 POS 폴링과 같은 방식).
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → 실행 전 __POS_SYNC_SECRET__ 을 Vercel 환경변수 POS_SYNC_SECRET 값으로 바꾼 뒤 → Run
-- ========================================================================
select cron.unschedule(jobid) from cron.job where jobname = 'ads-close-daily';

select cron.schedule('ads-close-daily', '35 0 * * *', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/ads/close',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{}'::jsonb);
$$);

-- ========================================================================
-- 트렌드 주간 갱신 cron: pg_net 기본 타임아웃(5초)이 라우트 실행 시간(30~60초)보다 짧아
-- timeout_milliseconds 를 300초로 늘려 재등록. 토스 동기화 cron 도 같은 이유로 60초로 재등록.
-- 실행 전: __POS_SYNC_SECRET__ 을 Vercel 환경변수 POS_SYNC_SECRET 값으로 바꿀 것
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

select cron.unschedule(jobid) from cron.job where jobname in ('trends-weekly', 'toss-pos-sync-10m', 'toss-pos-sync-daily');

select cron.schedule('trends-weekly', '0 20 * * 1', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/trends/refresh',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 300000);
$$);

select cron.schedule('toss-pos-sync-10m', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);

select cron.schedule('toss-pos-sync-daily', '0 19 * * *', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{"hours":48}'::jsonb,
    timeout_milliseconds := 120000);
$$);

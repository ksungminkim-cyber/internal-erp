-- ========================================================================
-- 60. 광고 일 마감 자동 채움 — 매일 09:35 KST(00:35 UTC) 에 ERP /api/ads/close 를 호출.
-- 데스크톱 앱의 09:30 작업이 안 돌아도 광고 현황의 어제까지 데이터가 채워진다 (토스 POS 폴링과 같은 방식).
-- 시크릿은 이미 등록된 toss-pos-sync-10m 잡의 헤더에서 그대로 가져오므로 이 파일에는 값을 적지 않는다.
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================
do $do$
declare s text;
begin
  select substring(command from 'x-sync-secret":"([^"]+)"') into s from cron.job where jobname = 'toss-pos-sync-10m' limit 1;
  if s is null then raise exception 'toss-pos-sync-10m 잡에서 x-sync-secret 을 찾지 못함'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'ads-close-daily';
  perform cron.schedule('ads-close-daily', '35 0 * * *', format($f$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/ads/close',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', %L),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000);
$f$, s));
end $do$;

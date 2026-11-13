-- ========================================================================
-- 61. 광고 시간대 운영 — 매시 정각에 ERP /api/ads/daypart 를 호출.
-- 네이버 「바 저녁_17-23시」 광고그룹을 17~23시(KST)에만 켠다 (플레이스 광고는 요일·시간 타겟이 없음).
-- 시크릿은 이미 등록된 toss-pos-sync-10m 잡의 헤더에서 그대로 가져온다.
-- 멈추려면: select cron.unschedule(jobid) from cron.job where jobname = 'ads-daypart-hourly';
-- ========================================================================
do $do$
declare s text;
begin
  select substring(command from 'x-sync-secret":"([^"]+)"') into s from cron.job where jobname = 'toss-pos-sync-10m' limit 1;
  if s is null then raise exception 'toss-pos-sync-10m 잡에서 x-sync-secret 을 찾지 못함'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'ads-daypart-hourly';
  perform cron.schedule('ads-daypart-hourly', '0 * * * *', format($f$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/ads/daypart',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', %L),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$f$, s));
end $do$;

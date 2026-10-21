-- ========================================================================
-- 주문 끊김 감지 오탐 수정
-- 기존: "지금 시작된 시(hour) 버킷"의 4주 평균 vs "지난 60분" 주문 → 정각 직후(개점 직전)에는 항상 0건이라 오탐.
-- 수정: 지난 60분과 똑같은 시각 창을 과거 4주 같은 요일에서 세어 평균과 비교.
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

create or replace function monitor_pos_health()
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  w record;
  v_last timestamptz;
  v_err text;
  v_avg numeric;
  v_recent int;
  n integer := 0;
begin
  for w in select id, name from workplaces where pos_store_code is not null loop
    -- 마지막으로 "끝난" 동기화 (진행 중인 행은 제외)
    select finished_at, error into v_last, v_err
      from pos_sync_log where workplace_id = w.id and finished_at is not null
      order by started_at desc limit 1;
    if v_last is null or v_last < now() - interval '40 minutes' or v_err is not null then
      if monitor_fire(w.id, 'sync_stale', interval '6 hours', false,
           '포스 동기화 중단',
           w.name || ' · ' || case when v_last is null then '동기화 기록 없음'
                                   when v_err is not null then '오류: ' || left(v_err, 80)
                                   else '마지막 동기화 ' || extract(epoch from (now() - v_last))::int / 60 || '분 전' end,
           '/sales',
           jsonb_build_object('last', v_last, 'error', v_err)) then n := n + 1; end if;
    end if;

    -- 주문 끊김: 지난 60분 창 [now-60m, now) 을 과거 4주 같은 요일 같은 시각에서 세어 평균 ≥ 2건인데 지금은 0건
    select coalesce(avg(c), 0) into v_avg from (
      select g, count(o.id) as c
      from generate_series(1, 4) g
      left join pos_orders o on o.workplace_id = w.id and o.order_state = 'COMPLETED'
        and o.completed_at >= now() - make_interval(days => 7 * g) - interval '60 minutes'
        and o.completed_at <  now() - make_interval(days => 7 * g)
      group by g
    ) x;
    select count(*) into v_recent from pos_orders
      where workplace_id = w.id and order_state = 'COMPLETED' and completed_at >= now() - interval '60 minutes';
    if v_avg >= 2 and v_recent = 0 then
      if monitor_fire(w.id, 'quiet_hours', interval '3 hours', true,
           '주문이 끊겼어요',
           w.name || ' · 평소 이 시간대 ' || round(v_avg, 1) || '건인데 최근 1시간 주문 0건. 포스·네트워크를 확인해 주세요.',
           '/sales',
           jsonb_build_object('avg', v_avg, 'at', now() at time zone 'Asia/Seoul')) then n := n + 1; end if;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function monitor_pos_health() from public, anon, authenticated;

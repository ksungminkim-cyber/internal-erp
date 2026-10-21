-- ========================================================================
-- 평소 대비 매출: 같은 요일 4주 평균을 "지금 시각까지" 누적으로 비교 (하루 중간에도 공정하게)
-- 52 에서는 오늘 누적 vs 하루 전체 평균이라 낮에는 항상 마이너스로 보였음.
-- 기준: pos_orders(COMPLETED) 의 KST 시각이 현재 KST 시각 이하인 주문 합계. 0원인 날은 평균에서 제외.
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

create or replace function sales_vs_usual(p_workplace_id uuid)
returns table (today_total numeric, usual_avg numeric, pct numeric)
language sql stable security invoker
set search_path = public as $$
  with p as (
    select (now() at time zone 'Asia/Seoul')::date as today,
           (now() at time zone 'Asia/Seoul')::time as tod
  ),
  days as (
    select p.today - 7 * g as d, g from p cross join generate_series(0, 4) g   -- g=0 오늘, 1~4 같은 요일 4주
  ),
  sums as (
    select d.g, coalesce(sum(o.charge_total), 0) as v
    from days d
    cross join p
    left join pos_orders o on o.workplace_id = p_workplace_id and o.order_state = 'COMPLETED'
      and o.completed_at >= (d.d::timestamp at time zone 'Asia/Seoul')
      and o.completed_at <  ((d.d + p.tod)::timestamp at time zone 'Asia/Seoul')
    group by d.g
  ),
  t as (select v from sums where g = 0),
  u as (select avg(v) as v from sums where g > 0 and v > 0)
  select t.v, coalesce(u.v, 0),
         case when coalesce(u.v, 0) > 0 then round((t.v - u.v) / u.v * 100) else null end
  from t, u;
$$;

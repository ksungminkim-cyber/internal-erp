-- ========================================================================
-- 토스 POS 연동 — 미뤄둔 항목 정리
-- 1) inventory_daily_usage: 선택 인자 p_item_id (품목 하나만 계산)
-- 2) inventory_order_suggestions: 오늘 몫 이중 계산 제거, 연결 품목도 최소 수량 바닥값
-- 3) sales_summary(): 누적·이번 달 합계를 SQL 에서 (PostgREST 1000행 제한 회피)
-- 4) 조회 함수들의 EXECUTE 를 public/anon 에서 회수 (서버는 서비스 롤, 멤버는 authenticated 로 RLS 하 조회 가능)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

-- 1. 품목 하나만 계산할 수 있게 (기존 호출은 그대로 동작)
drop function if exists inventory_daily_usage(uuid, date, date);
create or replace function inventory_daily_usage(p_workplace_id uuid, p_from date, p_to date, p_item_id uuid default null)
returns table (sales_date date, inventory_item_id uuid, usage numeric)
language sql stable security invoker
set search_path = public as $$
  select (o.completed_at at time zone 'Asia/Seoul')::date as sales_date,
         u.inventory_item_id,
         sum(i.quantity * u.qty_per_unit) as usage
  from pos_orders o
  join pos_order_items i on i.order_id = o.id
  join pos_product_usage u on u.workplace_id = o.workplace_id and u.item_title = i.item_title
  where o.workplace_id = p_workplace_id
    and o.order_state = 'COMPLETED'
    and o.completed_at is not null
    and (o.completed_at at time zone 'Asia/Seoul')::date between p_from and p_to
    and (p_item_id is null or u.inventory_item_id = p_item_id)
  group by 1, 2
  order by 1, 2;
$$;

-- 2. 발주 추천: 오늘 몫은 "오늘 요일 평균 − 오늘 이미 소진(차감됨)" 만큼만, 연결 품목도 최소 수량 바닥값
create or replace function inventory_order_suggestions(p_workplace_id uuid)
returns table (
  inventory_item_id uuid, name text, unit text, category text, vendor text,
  current_qty numeric, min_qty numeric, lead_time_days integer, unit_cost numeric, order_unit numeric,
  avg_daily_usage numeric, days_left numeric, horizon_days integer, forecast_usage numeric, suggested_qty numeric,
  basis text
)
language sql stable security invoker
set search_path = public as $$
  with params as (
    select (now() at time zone 'Asia/Seoul')::date as today, 2 as safety_days
  ),
  items as (
    select i.id, i.name, i.unit, i.category, i.vendor, i.current_qty, i.min_qty, i.lead_time_days, i.unit_cost, i.order_unit
    from inventory_items i
    where i.workplace_id = p_workplace_id and i.archived = false
  ),
  grid as (
    select i.id as item_id, d::date as d
    from params p
    cross join items i
    cross join lateral generate_series(p.today - 28, p.today - 1, interval '1 day') d
    where exists (select 1 from pos_product_usage u where u.inventory_item_id = i.id)
  ),
  usage as (
    select g.item_id, g.d, coalesce(x.usage, 0) as usage, extract(dow from g.d)::int as dow
    from grid g
    left join (
      select inventory_item_id, sales_date, usage
      from inventory_daily_usage(p_workplace_id, (select today - 28 from params), (select today - 1 from params))
    ) x on x.inventory_item_id = g.item_id and x.sales_date = g.d
  ),
  dow_avg as (
    select item_id, dow, avg(usage) as avg_usage from usage group by item_id, dow
  ),
  overall as (
    select item_id, avg(usage) as avg_daily from usage group by item_id
  ),
  -- 오늘 이미 소진(= 이미 차감된) 양
  today_used as (
    select inventory_item_id as item_id, usage
    from inventory_daily_usage(p_workplace_id, (select today from params), (select today from params))
  ),
  horizon as (
    select i.id as item_id, (coalesce(i.lead_time_days, 2) + p.safety_days) as days
    from items i, params p
  ),
  forecast as (
    select h.item_id, h.days,
           sum(
             case when d::date = p.today
               then greatest(coalesce(da.avg_usage, 0) - coalesce(tu.usage, 0), 0)   -- 오늘: 남은 몫만
               else coalesce(da.avg_usage, 0)
             end
           ) as fc
    from params p
    cross join horizon h
    cross join lateral generate_series(p.today, p.today + h.days - 1, interval '1 day') d
    left join dow_avg da on da.item_id = h.item_id and da.dow = extract(dow from d)::int
    left join today_used tu on tu.item_id = h.item_id
    group by h.item_id, h.days
  )
  select i.id, i.name, i.unit, i.category, i.vendor,
         i.current_qty, i.min_qty, i.lead_time_days, i.unit_cost, i.order_unit,
         o.avg_daily                                                         as avg_daily_usage,
         case when o.avg_daily > 0 then round(i.current_qty / o.avg_daily, 1) end as days_left,
         f.days                                                              as horizon_days,
         round(f.fc, 3)                                                      as forecast_usage,
         case
           when o.item_id is not null then
             case when greatest(f.fc, i.min_qty) - i.current_qty > 0
               then ceil((greatest(f.fc, i.min_qty) - i.current_qty) / coalesce(i.order_unit, 1)) * coalesce(i.order_unit, 1)
               else 0 end
           else
             case when i.current_qty < i.min_qty then i.min_qty - i.current_qty else 0 end
         end                                                                 as suggested_qty,
         case when o.item_id is not null then 'forecast' else 'min_qty' end  as basis
  from items i
  left join overall o on o.item_id = i.id
  left join forecast f on f.item_id = i.id
  order by (case when o.item_id is not null then 0 else 1 end), days_left nulls last, i.name;
$$;

-- 3. 매출 합계 (누적 + 이번 달) — sales_daily 행 수와 무관
create or replace function sales_summary(p_workplace_id uuid)
returns table (all_total numeric, all_count integer, month_total numeric, month_count integer, month_label text)
language sql stable security invoker
set search_path = public as $$
  with p as (select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') as ym)
  select coalesce(sum(total_amount), 0),
         count(*)::integer,
         coalesce(sum(case when to_char(sales_date, 'YYYY-MM') = p.ym then total_amount else 0 end), 0),
         count(*) filter (where to_char(sales_date, 'YYYY-MM') = p.ym)::integer,
         p.ym
  from sales_daily, p
  where workplace_id = p_workplace_id
  group by p.ym;
$$;

-- 4. 조회 함수 EXECUTE 정리 — 익명 키로는 호출 불가. 로그인 멤버는 RLS 하에서 호출 가능.
revoke execute on function inventory_daily_usage(uuid, date, date, uuid) from public, anon;
revoke execute on function inventory_order_suggestions(uuid) from public, anon;
revoke execute on function pos_product_sales(uuid, date, date) from public, anon;
revoke execute on function pos_daily_summary(uuid, date, date) from public, anon;
revoke execute on function sales_summary(uuid) from public, anon;
grant execute on function inventory_daily_usage(uuid, date, date, uuid) to authenticated, service_role;
grant execute on function inventory_order_suggestions(uuid) to authenticated, service_role;
grant execute on function pos_product_sales(uuid, date, date) to authenticated, service_role;
grant execute on function pos_daily_summary(uuid, date, date) to authenticated, service_role;
grant execute on function sales_summary(uuid) to authenticated, service_role;

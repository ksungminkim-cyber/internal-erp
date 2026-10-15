-- ========================================================================
-- 발주 추천 보정 (리뷰 반영)
-- 1) 오늘 소진분 차감은 자동 차감이 시작된 매장(pos_deduct_from <= 오늘)에서만
-- 2) 연결 품목이라도 최소 수량 때문에 추천이 생기면 basis = 'min_qty' 로 표시
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

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
    select (now() at time zone 'Asia/Seoul')::date as today, 2 as safety_days,
           exists (select 1 from workplaces w where w.id = p_workplace_id
                     and w.pos_deduct_from is not null
                     and w.pos_deduct_from <= (now() at time zone 'Asia/Seoul')::date) as deducting
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
  -- 오늘 이미 소진(= 이미 차감된) 양. 자동 차감 중인 매장에서만 의미가 있다
  today_used as (
    select inventory_item_id as item_id, usage
    from inventory_daily_usage(p_workplace_id, (select today from params), (select today from params))
    where (select deducting from params)
  ),
  horizon as (
    select i.id as item_id, (coalesce(i.lead_time_days, 2) + p.safety_days) as days
    from items i, params p
  ),
  forecast as (
    select h.item_id, h.days,
           sum(
             case when d::date = p.today
               then greatest(coalesce(da.avg_usage, 0) - coalesce(tu.usage, 0), 0)
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
         case
           when o.item_id is not null and f.fc >= i.min_qty then 'forecast'
           else 'min_qty'
         end                                                                 as basis
  from items i
  left join overall o on o.item_id = i.id
  left join forecast f on f.item_id = i.id
  order by (case when o.item_id is not null then 0 else 1 end), days_left nulls last, i.name;
$$;
revoke execute on function inventory_order_suggestions(uuid) from public, anon;
grant execute on function inventory_order_suggestions(uuid) to authenticated, service_role;

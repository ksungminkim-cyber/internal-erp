-- ========================================================================
-- 소진량·발주 추천 조회 성능
-- 1) 날짜 비교를 (completed_at at time zone 'Asia/Seoul')::date 캐스트 대신 timestamptz 범위로 → 인덱스 사용
-- 2) pos_order_items(item_title) 인덱스: 소요량 연결(item_title) 조인용
-- 3) pos_orders(workplace_id, order_state, completed_at) 인덱스
-- 4) inventory_order_suggestions: 소진량 스캔을 한 번으로 (28일 + 오늘 분리 호출 제거)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

create index if not exists idx_pos_items_title on pos_order_items(item_title, order_id);
create index if not exists idx_pos_orders_wp_state_completed on pos_orders(workplace_id, order_state, completed_at);

-- KST 날짜 범위(양 끝 포함)를 timestamptz 반열림 구간으로
create or replace function kst_range_start(p_date date) returns timestamptz
language sql immutable as $$ select (p_date::timestamp at time zone 'Asia/Seoul') $$;
create or replace function kst_range_end(p_date date) returns timestamptz
language sql immutable as $$ select ((p_date + 1)::timestamp at time zone 'Asia/Seoul') $$;

-- 1. 소진량: 인덱스를 타는 범위 조건으로
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
    and o.completed_at >= kst_range_start(p_from)
    and o.completed_at <  kst_range_end(p_to)
    and (p_item_id is null or u.inventory_item_id = p_item_id)
  group by 1, 2
  order by 1, 2;
$$;

-- 상품별 판매·일 합산도 같은 방식으로
create or replace function pos_product_sales(p_workplace_id uuid, p_from date, p_to date)
returns table (item_title text, item_code text, qty numeric, amount numeric)
language sql stable security invoker
set search_path = public as $$
  select i.item_title, i.item_code,
         sum(i.quantity)                as qty,
         sum(i.quantity * i.unit_price) as amount
  from pos_orders o
  join pos_order_items i on i.order_id = o.id
  where o.workplace_id = p_workplace_id
    and o.order_state = 'COMPLETED'
    and o.completed_at >= kst_range_start(p_from)
    and o.completed_at <  kst_range_end(p_to)
  group by i.item_title, i.item_code
  order by qty desc;
$$;

create or replace function pos_daily_summary(p_workplace_id uuid, p_from date, p_to date)
returns table (sales_date date, total_amount numeric, transaction_count integer, card_amount numeric, cash_amount numeric, other_amount numeric)
language sql stable security invoker
set search_path = public as $$
  with o as (
    select id, charge_total, (completed_at at time zone 'Asia/Seoul')::date as d, raw -> 'payments' as payments
    from pos_orders
    where workplace_id = p_workplace_id
      and order_state = 'COMPLETED'
      and completed_at >= kst_range_start(p_from)
      and completed_at <  kst_range_end(p_to)
  ),
  p as (
    select o.id, o.d,
           coalesce(sum(case when pay->>'state' = 'APPROVED' and pay->>'sourceType' = 'CARD' then (pay->>'amount')::numeric else 0 end), 0) as card,
           coalesce(sum(case when pay->>'state' = 'APPROVED' and pay->>'sourceType' = 'CASH' then (pay->>'amount')::numeric else 0 end), 0) as cash,
           coalesce(sum(case when pay->>'state' = 'APPROVED' and coalesce(pay->>'sourceType', '') not in ('CARD', 'CASH') then (pay->>'amount')::numeric else 0 end), 0) as other
    from o
    left join lateral jsonb_array_elements(coalesce(o.payments, '[]'::jsonb)) as pay on true
    group by o.id, o.d
  )
  select o.d, coalesce(sum(o.charge_total), 0), count(*)::integer,
         coalesce(sum(p.card), 0), coalesce(sum(p.cash), 0), coalesce(sum(p.other), 0)
  from o join p on p.id = o.id
  group by o.d
  order by o.d;
$$;

-- 2. 발주 추천: 소진량을 한 번만 스캔 (어제까지 28일 + 오늘)
create or replace function inventory_order_suggestions(p_workplace_id uuid)
returns table (
  inventory_item_id uuid, name text, unit text, category text, vendor text,
  current_qty numeric, min_qty numeric, lead_time_days integer, unit_cost numeric, order_unit numeric,
  avg_daily_usage numeric, days_left numeric, horizon_days integer, forecast_usage numeric, suggested_qty numeric,
  basis text, supply_type text, usage_unit text, usage_per_unit numeric
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
    select i.id, i.name, i.unit, i.category, i.vendor, i.current_qty, i.min_qty, i.lead_time_days, i.unit_cost, i.order_unit,
           i.supply_type, i.usage_unit, i.usage_per_unit,
           exists (select 1 from pos_product_usage u where u.inventory_item_id = i.id) as linked
    from inventory_items i
    where i.workplace_id = p_workplace_id and i.archived = false
  ),
  -- 한 번의 스캔: 28일 전 ~ 오늘
  all_usage as (
    select inventory_item_id as item_id, sales_date, usage
    from inventory_daily_usage(p_workplace_id, (select today - 28 from params), (select today from params))
  ),
  grid as (
    select i.id as item_id, d::date as d
    from params p
    cross join items i
    cross join lateral generate_series(p.today - 28, p.today - 1, interval '1 day') d
    where i.linked
  ),
  usage as (
    select g.item_id, g.d, coalesce(x.usage, 0) as usage, extract(dow from g.d)::int as dow
    from grid g
    left join all_usage x on x.item_id = g.item_id and x.sales_date = g.d
  ),
  dow_avg as (select item_id, dow, avg(usage) as avg_usage from usage group by item_id, dow),
  overall as (select item_id, avg(usage) as avg_daily from usage group by item_id),
  today_used as (
    select item_id, usage from all_usage, params p
    where sales_date = p.today and p.deducting
  ),
  horizon as (
    select i.id as item_id, (coalesce(i.lead_time_days, 2) + p.safety_days) as days
    from items i, params p where i.linked
  ),
  forecast as (
    select h.item_id, h.days,
           sum(case when d::date = p.today
                 then greatest(coalesce(da.avg_usage, 0) - coalesce(tu.usage, 0), 0)
                 else coalesce(da.avg_usage, 0) end) as fc
    from params p
    cross join horizon h
    cross join lateral generate_series(p.today, p.today + h.days - 1, interval '1 day') d
    left join dow_avg da on da.item_id = h.item_id and da.dow = extract(dow from d)::int
    left join today_used tu on tu.item_id = h.item_id
    group by h.item_id, h.days
  )
  select i.id, i.name, i.unit, i.category, i.vendor,
         i.current_qty, i.min_qty, i.lead_time_days, i.unit_cost, i.order_unit,
         o.avg_daily,
         case when o.avg_daily > 0 then round(i.current_qty / o.avg_daily, 1) end,
         f.days,
         round(f.fc, 3),
         case
           when i.linked then
             case when greatest(coalesce(f.fc, 0), i.min_qty) - i.current_qty > 0
               then ceil((greatest(coalesce(f.fc, 0), i.min_qty) - i.current_qty) / coalesce(i.order_unit, 1)) * coalesce(i.order_unit, 1)
               else 0 end
           else
             case when i.current_qty < i.min_qty then i.min_qty - i.current_qty else 0 end
         end,
         case when i.linked and coalesce(f.fc, 0) >= i.min_qty then 'forecast' else 'min_qty' end,
         i.supply_type, i.usage_unit, i.usage_per_unit
  from items i
  left join overall o on o.item_id = i.id
  left join forecast f on f.item_id = i.id
  order by (case when i.linked then 0 else 1 end), (case when o.avg_daily > 0 then i.current_qty / o.avg_daily end) nulls last, i.name;
$$;

revoke execute on function inventory_daily_usage(uuid, date, date, uuid) from public, anon;
revoke execute on function inventory_order_suggestions(uuid) from public, anon;
revoke execute on function pos_product_sales(uuid, date, date) from public, anon;
revoke execute on function pos_daily_summary(uuid, date, date) from public, anon;
grant execute on function inventory_daily_usage(uuid, date, date, uuid) to authenticated, service_role;
grant execute on function inventory_order_suggestions(uuid) to authenticated, service_role;
grant execute on function pos_product_sales(uuid, date, date) to authenticated, service_role;
grant execute on function pos_daily_summary(uuid, date, date) to authenticated, service_role;

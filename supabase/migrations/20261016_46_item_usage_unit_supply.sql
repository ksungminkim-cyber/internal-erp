-- ========================================================================
-- 재고 품목: 소진 단위(ml/g)와 세는 단위(개/병/봉) 병행, 구매/직접 제조 구분
-- 1) usage_unit, usage_per_unit: 품목 1(세는 단위)당 소진 단위 수량. 예) 우유 1L: 1개 = 1000ml
--    소요량(pos_product_usage.qty_per_unit)은 계속 "세는 단위"로 저장 — 화면에서 ml/g 로 입력하면 환산해 저장
-- 2) supply_type: 'purchase'(구매) | 'made'(매장에서 직접 제조). 제조 품목은 발주 대신 "추가 제조" 로 안내하고 기안에서 제외
-- 3) 기본값 세팅: 우유 1L(1개=1000ml), 유타 블렌드 원두·디카페인 원두·원두(1봉=1000g), 크림·베이스류는 제조
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

alter table inventory_items
  add column if not exists usage_unit text,
  add column if not exists usage_per_unit numeric(14,3) check (usage_per_unit is null or usage_per_unit > 0),
  add column if not exists supply_type text not null default 'purchase'
    check (supply_type in ('purchase', 'made'));

comment on column inventory_items.usage_unit is '소진 단위 (ml, g 등). NULL 이면 세는 단위와 같음';
comment on column inventory_items.usage_per_unit is '품목 1(세는 단위)당 소진 단위 수량. 예) 1개 = 1000ml';
comment on column inventory_items.supply_type is 'purchase: 구매 발주 / made: 매장에서 직접 제조 (발주 대신 추가 제조 안내)';

-- 기본값: 우유 1L
update inventory_items set usage_unit = 'ml', usage_per_unit = 1000
  where name = '우유 1L' and usage_unit is null;
-- 기본값: 원두류 1봉 = 1000g (실제 봉 중량이 다르면 품목 편집에서 수정)
update inventory_items set usage_unit = 'g', usage_per_unit = 1000
  where unit = '봉' and name like '%원두%' and usage_unit is null;
-- 매장에서 직접 만드는 품목
update inventory_items set supply_type = 'made'
  where name in ('스카치 크림', '민트잎 크림', '우유 크림', '흑임자(블랙) 크림', '말차 베이스', '초코 베이스',
                 '레드 피치 베이스', '민트 밀크티 베이스', '토비넛버터 베이스', '마스카포네 크림치즈')
    and supply_type = 'purchase';

-- 발주 추천 결과에 supply_type 포함 (카드에서 구매/제조 분리 표시)
drop function if exists inventory_order_suggestions(uuid);
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
           i.supply_type, i.usage_unit, i.usage_per_unit
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
         end                                                                 as basis,
         i.supply_type, i.usage_unit, i.usage_per_unit
  from items i
  left join overall o on o.item_id = i.id
  left join forecast f on f.item_id = i.id
  order by (case when o.item_id is not null then 0 else 1 end), days_left nulls last, i.name;
$$;
revoke execute on function inventory_order_suggestions(uuid) from public, anon;
grant execute on function inventory_order_suggestions(uuid) to authenticated, service_role;

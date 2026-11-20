-- ========================================================================
-- 봉 수로 직접 관리하는 품목 (원두·설탕·소금·파우더)
-- 1) inventory_items.manual_count: true 면 판매로 자동 차감하지 않고, 봉을 뜯을 때 사람이 −1
-- 2) pos_apply_usage_deductions: manual_count 품목은 건너뜀 (기존 차감 기록도 건드리지 않음)
-- 3) inventory_order_suggestions: manual_count 품목은 메뉴 연결이 있어도 최소 수량 기준으로만 권장
-- 4) 대상 품목 전환 — 녹턴 7개, 나울 2개. 두 번 실행해도 이미 전환된 품목은 건너뜀
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

-- 1. 차감 방식
alter table inventory_items
  add column if not exists manual_count boolean not null default false;
comment on column inventory_items.manual_count is 'true = 판매 자동 차감 없이 개봉할 때 직접 −1 (봉 수 관리)';

-- 2. 자동 차감: manual_count 품목 제외 (43번 함수에 조건 한 줄 추가)
create or replace function pos_apply_usage_deductions(p_workplace_id uuid, p_from date, p_to date)
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  v_start date;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  r record;
  v_delta numeric;
  v_tx uuid;
  n integer := 0;
begin
  -- 같은 매장의 차감은 트랜잭션 단위로 직렬화
  perform pg_advisory_xact_lock(hashtext('pos_deduct:' || p_workplace_id::text));

  select pos_deduct_from into v_start from workplaces where id = p_workplace_id;
  if v_start is null then return 0; end if;
  p_from := greatest(p_from, v_start);
  p_to := least(p_to, v_today);
  if p_from > p_to then return 0; end if;

  for r in
    with u as (
      select sales_date, inventory_item_id, usage from inventory_daily_usage(p_workplace_id, p_from, p_to)
    ),
    keys as (
      select sales_date, inventory_item_id from u
      union
      select sales_date, inventory_item_id from pos_usage_deductions
      where workplace_id = p_workplace_id and sales_date between p_from and p_to
    )
    select k.sales_date, k.inventory_item_id,
           coalesce(u.usage, 0) as usage,
           d.id as ledger_id, d.deducted_qty, d.transaction_id
    from keys k
    left join u on u.sales_date = k.sales_date and u.inventory_item_id = k.inventory_item_id
    left join pos_usage_deductions d on d.inventory_item_id = k.inventory_item_id and d.sales_date = k.sales_date
    -- 직접 세는 품목은 판매로 차감하지 않는다 (전환 전에 차감한 기록도 되돌리지 않음)
    where not exists (select 1 from inventory_items it where it.id = k.inventory_item_id and it.manual_count)
  loop
    v_delta := round(r.usage, 3) - coalesce(r.deducted_qty, 0);
    if abs(v_delta) < 0.0005 then continue; end if;

    if r.ledger_id is null then
      insert into inventory_transactions (item_id, workplace_id, user_id, type, qty_delta, note)
      values (r.inventory_item_id, p_workplace_id, null, 'use', -round(r.usage, 3),
              'POS 판매 자동 차감 ' || to_char(r.sales_date, 'MM/DD'))
      returning id into v_tx;   -- 트리거가 current_qty 차감
      insert into pos_usage_deductions (workplace_id, inventory_item_id, sales_date, deducted_qty, transaction_id)
      values (p_workplace_id, r.inventory_item_id, r.sales_date, round(r.usage, 3), v_tx);
    else
      update inventory_transactions set qty_delta = -round(r.usage, 3)
        where id = r.transaction_id;
      update inventory_items set current_qty = current_qty - v_delta, updated_at = now()
        where id = r.inventory_item_id;
      update pos_usage_deductions set deducted_qty = round(r.usage, 3), updated_at = now()
        where id = r.ledger_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function pos_apply_usage_deductions(uuid, date, date) from public, anon, authenticated;

-- 3. 발주 추천: manual_count 품목은 판매 예측 대상에서 제외 (48번 함수에서 linked 조건만 변경)
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
           (not i.manual_count
             and exists (select 1 from pos_product_usage u where u.inventory_item_id = i.id)) as linked
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
revoke execute on function inventory_order_suggestions(uuid) from public, anon;
grant execute on function inventory_order_suggestions(uuid) to authenticated, service_role;

-- 4. 대상 품목 전환
--  per      : 1단위가 몇 g 인지 (구매 기록 기준). g 로 세던 품목만 — 메뉴 연결·차감 기록을 같은 비율로 환산
--  qty_mode : floor   = 이미 봉 단위, 소수점만 버림 (14.3봉 → 14봉)
--             convert = g 재고를 단위로 환산해 내림 (1200g ÷ 500 → 2봉)
--             keep    = 이미 봉 수로 적혀 있음
--             zero    = g 와 봉 수가 섞여 환산 불가 → 0, 매장에서 세어 입력
--  cost_x   : 단가가 g 당으로 적혀 있어 봉 단가로 환산해야 하는 품목
--  new_min  : 최소 수량 (null = 그대로)
do $$
declare
  r record;
  it inventory_items%rowtype;
  v_target numeric;
begin
  for r in
    select * from (values
      ('2fcf2cd5-0406-42e1-8406-4d64f6062e41'::uuid, '봉', null::numeric, 'floor',   false, null::numeric), -- 녹턴 유타 블렌드 원두 (최소 3 유지)
      ('8609387d-b0f1-4da1-aba9-e044b9f43b9f'::uuid, '봉', null,          'floor',   false, null),          -- 녹턴 디카페인 원두 (최소 2 유지)
      ('9f4960f4-4619-4033-b453-27986f9ef5d6'::uuid, '봉', null,          'floor',   false, null),          -- 나울 원두
      ('23e2c5d5-9466-4e37-bc7f-9dbcf68cea9e'::uuid, '봉', null,          'floor',   false, null),          -- 나울 디카페인 원두
      ('0434bb4a-1874-40d0-be10-963d31c73703'::uuid, '봉', 3000,          'keep',    false, 2),             -- 녹턴 백설탕 3kg (재고·단가 이미 봉 기준)
      ('6effd92c-71cf-4564-a5b8-3052f68c13d1'::uuid, '봉', 1000,          'zero',    false, 2),             -- 녹턴 흑설탕 1kg (g 와 봉 수가 섞임)
      ('3800f583-c7a8-4ab1-be3b-181590d82dce'::uuid, '봉', 500,           'convert', true,  2),             -- 녹턴 요거트 파우더 500g
      ('5b3a5875-36df-408c-8fab-b8a803f81e90'::uuid, '통', 570,           'convert', true,  2),             -- 녹턴 소금 (말돈 570g 통)
      ('5ebf13d9-401f-47b0-bb6f-deaae7b295d0'::uuid, '봉', null,          'zero',    false, 2)              -- 녹턴 말차 (한 봉 g 미확인 — 메뉴 연결 환산 안 함)
    ) as t(id, new_unit, per, qty_mode, cost_x, new_min)
  loop
    select * into it from inventory_items where id = r.id and not manual_count for update;
    if not found then continue; end if;

    -- g 로 세던 품목: 메뉴 연결(1잔당 g)과 지난 차감 기록을 새 단위로 환산
    if r.per is not null and it.usage_unit is null then
      update pos_product_usage set qty_per_unit = round(qty_per_unit / r.per, 6), updated_at = now()
        where inventory_item_id = it.id;
      update pos_usage_deductions set deducted_qty = round(deducted_qty / r.per, 3), updated_at = now()
        where inventory_item_id = it.id;
    end if;

    v_target := case r.qty_mode
      when 'floor'   then greatest(floor(it.current_qty), 0)
      when 'convert' then greatest(floor(it.current_qty / r.per), 0)
      when 'keep'    then it.current_qty
      else 0 end;

    update inventory_items set
      unit = r.new_unit,
      usage_unit     = case when r.per is not null and it.usage_unit is null then it.unit else usage_unit end,
      usage_per_unit = case when r.per is not null and it.usage_unit is null then r.per else usage_per_unit end,
      unit_cost      = case when r.cost_x and unit_cost is not null then round(unit_cost * r.per, 2) else unit_cost end,
      min_qty        = coalesce(r.new_min, min_qty),
      manual_count   = true,
      updated_at     = now()
    where id = it.id;

    -- 수량 맞춤은 조정 거래로 남긴다 (트리거가 current_qty 반영)
    if v_target <> it.current_qty then
      insert into inventory_transactions (item_id, workplace_id, user_id, type, qty_delta, note)
      values (it.id, it.workplace_id, null, 'adjust', v_target - it.current_qty,
              case when it.unit <> r.new_unit
                then '봉 수 관리로 전환 (이전 기록은 ' || it.unit || ' 기준)'
                else '봉 수 관리로 전환 — 소수점 정리' end);
    end if;
  end loop;
end $$;

-- 확인용: 전환된 품목
select w.name as 매장, i.name as 품목, i.current_qty as 수량, i.unit as 단위, i.min_qty as 최소, i.unit_cost as 단가,
       i.usage_per_unit as "1단위 g"
from inventory_items i join workplaces w on w.id = i.workplace_id
where i.manual_count order by w.name, i.name;

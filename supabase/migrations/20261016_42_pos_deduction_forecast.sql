-- ========================================================================
-- 3단계: 재고 자동 차감(실시간) + 발주 추천
-- 1) inventory_items.unit_cost(단가, 선택), order_unit(발주 단위 수량, 선택)
-- 2) workplaces.pos_deduct_from: 이 날짜 이후 판매분만 자동 차감 (과거 소급 금지). NULL 이면 차감 안 함
-- 3) pos_usage_deductions: 품목×날짜별 "지금까지 뺀 양" 장부 + 재고 이력 1줄 연결
-- 4) pos_apply_usage_deductions(): 동기화 때마다 호출 — 소진량과 장부의 차액만 반영
-- 5) inventory_order_suggestions(): 요일별 평균(최근 4주) × (리드타임 + 안전 2일) − 현재 재고 = 권장 발주량
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

alter table inventory_items
  add column if not exists unit_cost numeric(14,2),
  add column if not exists order_unit numeric(12,3) check (order_unit is null or order_unit > 0);
comment on column inventory_items.unit_cost is '단가(원, 선택) — 발주 기안 금액 계산용';
comment on column inventory_items.order_unit is '발주 단위 수량(선택) — 권장 발주량을 이 배수로 올림';

alter table workplaces
  add column if not exists pos_deduct_from date;
comment on column workplaces.pos_deduct_from is 'POS 판매 기반 재고 자동 차감 시작일(KST). NULL = 차감 안 함';

-- 오늘(KST)부터 차감 시작. 과거 판매는 소급하지 않는다.
update workplaces
  set pos_deduct_from = (now() at time zone 'Asia/Seoul')::date
  where pos_provider = 'toss' and pos_store_code is not null and pos_deduct_from is null;

create table if not exists pos_usage_deductions (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  sales_date date not null,
  deducted_qty numeric(14,3) not null default 0,
  transaction_id uuid references inventory_transactions(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, sales_date)
);
create index if not exists idx_pos_deduct_wp_date on pos_usage_deductions(workplace_id, sales_date desc);
alter table pos_usage_deductions enable row level security;
drop policy if exists "pos_deduct_select" on pos_usage_deductions;
create policy "pos_deduct_select" on pos_usage_deductions for select using (is_member_of(workplace_id));

-- ------------------------------------------------------------------------
-- 자동 차감 적용. 반환: 반영한 (품목×날짜) 수.
--  - 첫 반영: inventory_transactions 에 'use' 1건 insert (트리거가 current_qty 차감)
--  - 이후: 그 거래 행의 qty_delta 를 갱신하고 current_qty 에는 차액만 반영 (이력은 하루 한 줄 유지)
--  - 판매가 전부 취소돼 소진량이 0이 되면 qty_delta 0 으로 갱신 (행은 남김)
-- ------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------
-- 발주 추천. 연결(소요량)이 있는 품목: 최근 28일 요일별 평균 소진 × (리드타임 + 안전 2일).
-- 연결이 없는 품목: 기존 최소 수량 기준 (현재 < 최소 → 최소 − 현재).
-- ------------------------------------------------------------------------
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
  -- 최근 28일(어제까지) 소진량. 판매 0인 날도 요일 평균의 분모에 넣기 위해 날짜 격자를 만든다
  grid as (
    select i.id as item_id, d::date as d
    from items i, params p, generate_series(p.today - 28, p.today - 1, interval '1 day') d
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
  horizon as (
    select i.id as item_id, (coalesce(i.lead_time_days, 2) + p.safety_days) as days
    from items i, params p
  ),
  forecast as (
    select h.item_id, h.days,
           sum(coalesce(da.avg_usage, 0)) as fc
    from horizon h, params p
    cross join lateral generate_series(p.today, p.today + h.days - 1, interval '1 day') d
    left join dow_avg da on da.item_id = h.item_id and da.dow = extract(dow from d)::int
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
             case when f.fc - i.current_qty > 0
               then ceil((f.fc - i.current_qty) / coalesce(i.order_unit, 1)) * coalesce(i.order_unit, 1)
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

-- ========================================================================
-- 2단계: 토스 상품 → 재고 소요량 연결 (BOM)
-- 1) inventory_items.lead_time_days (발주 리드타임, 기본 2일)
-- 2) pos_product_usage: 매장별 토스 상품명 × 재고 품목 × 1개당 소요량
-- 3) inventory_daily_usage(): 판매량 × 소요량 = 매장·품목·일 소진량
-- 4) 기본 품목 시드 (원두·우유·컵·시럽) — 같은 이름이 없을 때만
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

alter table inventory_items
  add column if not exists lead_time_days integer not null default 2;
comment on column inventory_items.lead_time_days is '발주 후 입고까지 걸리는 일수 (발주 추천 계산용)';

create table if not exists pos_product_usage (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  item_title text not null,                        -- 토스 상품명 (pos_order_items.item_title)
  qty_per_unit numeric(12,3) not null check (qty_per_unit > 0),  -- 상품 1개당 소요량 (품목 단위)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, item_title)
);
create index if not exists idx_pos_usage_wp_title on pos_product_usage(workplace_id, item_title);

alter table pos_product_usage enable row level security;
drop policy if exists "pos_usage_select" on pos_product_usage;
create policy "pos_usage_select" on pos_product_usage
  for select using (is_member_of(workplace_id));
drop policy if exists "pos_usage_modify" on pos_product_usage;
create policy "pos_usage_modify" on pos_product_usage
  for all using (is_member_of(workplace_id))
  with check (is_member_of(workplace_id));

-- 매장·품목·일 소진량 (완료 주문만, KST 날짜)
create or replace function inventory_daily_usage(p_workplace_id uuid, p_from date, p_to date)
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
  group by 1, 2
  order by 1, 2;
$$;

-- 기본 품목 시드 — 이름이 없을 때만
do $$
declare
  wp record;
begin
  for wp in select id, name from workplaces where name in ('나울', '녹턴') loop
    insert into inventory_items (workplace_id, name, category, unit)
    select wp.id, v.name, v.category, v.unit
    from (values
      ('아이스 컵', '비품', '개'),
      ('핫 컵', '비품', '개'),
      ('바닐라 시럽', '음료/시럽', '병')
    ) as v(name, category, unit)
    where not exists (select 1 from inventory_items x where x.workplace_id = wp.id and x.name = v.name and x.archived = false);

    if wp.name = '나울' then
      insert into inventory_items (workplace_id, name, category, unit)
      select wp.id, v.name, v.category, v.unit
      from (values
        ('원두', '식자재', '봉'),
        ('디카페인 원두', '식자재', '봉'),
        ('우유 1L', '음료/시럽', '개')
      ) as v(name, category, unit)
      where not exists (select 1 from inventory_items x where x.workplace_id = wp.id and x.name = v.name and x.archived = false);
    end if;
  end loop;
end $$;

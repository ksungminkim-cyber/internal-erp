-- ========================================================================
-- 토스 POS 주문 수집 (1단계)
-- pos_orders / pos_order_items / pos_sync_log + 뷰 pos_product_daily + pg_cron 폴링
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- 실행 전: 아래 두 곳의 __POS_SYNC_SECRET__ 을 Vercel 환경변수 POS_SYNC_SECRET 값으로 바꿀 것
-- ========================================================================

-- 1. 매장 ↔ 토스 merchantId 매핑 (기존 컬럼 재사용)
update workplaces set pos_provider = 'toss', pos_store_code = '166568' where name = '나울';
update workplaces set pos_provider = 'toss', pos_store_code = '182323' where name = '녹턴';

-- 2. 주문
create table if not exists pos_orders (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  merchant_id text not null,
  external_id text not null,                -- 토스 주문 id
  order_key text,
  order_number text,
  source text,                              -- 'POS' 등
  order_state text not null,                -- COMPLETED / CANCELLED / ...
  charge_total numeric(14,2),               -- chargePrice.totalAmount
  created_at_pos timestamptz,
  updated_at_pos timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (workplace_id, external_id)
);
create index if not exists idx_pos_orders_wp_completed on pos_orders(workplace_id, completed_at desc);

-- 3. 라인아이템
create table if not exists pos_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references pos_orders(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  line_no int not null,
  item_title text not null,
  item_code text,
  item_category text,
  quantity numeric(10,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  options jsonb not null default '[]',
  discounts jsonb not null default '[]',
  dining_option text,
  unique (order_id, line_no)
);
create index if not exists idx_pos_items_wp_title on pos_order_items(workplace_id, item_title);

-- 4. 동기화 로그
create table if not exists pos_sync_log (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  window_from timestamptz not null,
  window_to timestamptz not null,
  fetched_count int not null default 0,
  upserted_count int not null default 0,
  error text
);
create index if not exists idx_pos_sync_log_wp on pos_sync_log(workplace_id, started_at desc);

-- 5. 상품별 일 집계 뷰 (완료 주문만, KST 날짜)
create or replace view pos_product_daily as
select o.workplace_id,
       (o.completed_at at time zone 'Asia/Seoul')::date as sales_date,
       i.item_title,
       i.item_code,
       sum(i.quantity)                as qty,
       sum(i.quantity * i.unit_price) as amount
from pos_orders o
join pos_order_items i on i.order_id = o.id
where o.order_state = 'COMPLETED' and o.completed_at is not null
group by 1, 2, 3, 4;

-- 6. RLS — 읽기는 멤버, 쓰기는 서비스 롤만 (정책 없음)
alter table pos_orders enable row level security;
alter table pos_order_items enable row level security;
alter table pos_sync_log enable row level security;

drop policy if exists "pos_orders_select" on pos_orders;
create policy "pos_orders_select" on pos_orders for select using (is_member_of(workplace_id));
drop policy if exists "pos_items_select" on pos_order_items;
create policy "pos_items_select" on pos_order_items for select using (is_member_of(workplace_id));
drop policy if exists "pos_sync_log_select" on pos_sync_log;
create policy "pos_sync_log_select" on pos_sync_log for select using (is_member_of(workplace_id));

-- 7. 스케줄러 — 10분마다 최근 90분, 매일 KST 04:00(UTC 19:00) 최근 48시간
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('toss-pos-sync-10m', 'toss-pos-sync-daily');

select cron.schedule('toss-pos-sync-10m', '*/10 * * * *', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{}'::jsonb);
$$);

select cron.schedule('toss-pos-sync-daily', '0 19 * * *', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/pos/toss/sync',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{"hours":48}'::jsonb);
$$);

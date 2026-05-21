-- ========================================================================
-- 카페 운영 기능 (시프트/인수인계/체크리스트/재고/매출)
-- ========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. SHIFTS — 시프트 스케줄
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  user_id uuid not null references profiles(user_id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  role_label text,                       -- '오픈', '미들', '마감', '홀' 등
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'swap_requested', 'cancelled')),
  notes text,
  created_by uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shifts_workplace_time on shifts(workplace_id, start_at);
create index if not exists idx_shifts_user_time on shifts(user_id, start_at);

alter table shifts enable row level security;

drop policy if exists "shifts_select_workplace" on shifts;
create policy "shifts_select_workplace" on shifts
  for select using (is_member_of(workplace_id));

drop policy if exists "shifts_insert_manager" on shifts;
create policy "shifts_insert_manager" on shifts
  for insert with check (is_manager_of(workplace_id));

drop policy if exists "shifts_update_manager" on shifts;
create policy "shifts_update_manager" on shifts
  for update using (is_manager_of(workplace_id))
  with check (is_manager_of(workplace_id));

drop policy if exists "shifts_delete_manager" on shifts;
create policy "shifts_delete_manager" on shifts
  for delete using (is_manager_of(workplace_id));

alter publication supabase_realtime add table shifts;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. HANDOVER NOTES — 인수인계
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists handover_notes (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  author_id uuid not null references profiles(user_id) on delete set null,
  shift_type text not null
    check (shift_type in ('open', 'mid', 'close')),
  note_date date not null default current_date,
  content text not null,
  flags text[] not null default '{}',    -- 'stock_low', 'equipment_issue', 'customer', 'cash', 'cleaning'
  resolved boolean not null default false,
  resolved_by uuid references profiles(user_id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_handover_workplace_date on handover_notes(workplace_id, note_date desc, created_at desc);

alter table handover_notes enable row level security;

drop policy if exists "handover_select_workplace" on handover_notes;
create policy "handover_select_workplace" on handover_notes
  for select using (is_member_of(workplace_id));

drop policy if exists "handover_insert_member" on handover_notes;
create policy "handover_insert_member" on handover_notes
  for insert with check (
    is_member_of(workplace_id) and author_id = auth.uid()
  );

drop policy if exists "handover_update_author_or_manager" on handover_notes;
create policy "handover_update_author_or_manager" on handover_notes
  for update using (
    author_id = auth.uid() or is_manager_of(workplace_id)
  )
  with check (
    author_id = auth.uid() or is_manager_of(workplace_id)
  );

alter publication supabase_realtime add table handover_notes;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. CHECKLISTS — 오픈/마감 체크리스트
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  name text not null,
  type text not null default 'open'
    check (type in ('open', 'close', 'weekly', 'custom')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  text text not null,
  order_idx integer not null default 0,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

-- 일일 완료 (template × date 당 한 행, items 는 jsonb 로 체크상태 누적)
create table if not exists checklist_completions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  completion_date date not null default current_date,
  items jsonb not null default '{}',     -- { "<item_id>": { checked: true, by: "<user_id>", at: "<ts>", note: "" } }
  completed_count integer not null default 0,
  total_count integer not null default 0,
  last_updated_by uuid references profiles(user_id),
  last_updated_at timestamptz not null default now(),
  unique (template_id, completion_date)
);

create index if not exists idx_cl_templates_workplace on checklist_templates(workplace_id);
create index if not exists idx_cl_items_template on checklist_items(template_id, order_idx);
create index if not exists idx_cl_comp_workplace_date on checklist_completions(workplace_id, completion_date desc);

alter table checklist_templates enable row level security;
alter table checklist_items enable row level security;
alter table checklist_completions enable row level security;

-- templates
drop policy if exists "cl_tpl_select" on checklist_templates;
create policy "cl_tpl_select" on checklist_templates
  for select using (is_member_of(workplace_id));
drop policy if exists "cl_tpl_modify_manager" on checklist_templates;
create policy "cl_tpl_modify_manager" on checklist_templates
  for all using (is_manager_of(workplace_id))
  with check (is_manager_of(workplace_id));

-- items
drop policy if exists "cl_item_select" on checklist_items;
create policy "cl_item_select" on checklist_items
  for select using (
    exists (select 1 from checklist_templates t
            where t.id = checklist_items.template_id
              and is_member_of(t.workplace_id))
  );
drop policy if exists "cl_item_modify_manager" on checklist_items;
create policy "cl_item_modify_manager" on checklist_items
  for all using (
    exists (select 1 from checklist_templates t
            where t.id = checklist_items.template_id
              and is_manager_of(t.workplace_id))
  )
  with check (
    exists (select 1 from checklist_templates t
            where t.id = checklist_items.template_id
              and is_manager_of(t.workplace_id))
  );

-- completions: 사업장 멤버 누구나 read/write
drop policy if exists "cl_comp_select" on checklist_completions;
create policy "cl_comp_select" on checklist_completions
  for select using (is_member_of(workplace_id));
drop policy if exists "cl_comp_insert" on checklist_completions;
create policy "cl_comp_insert" on checklist_completions
  for insert with check (is_member_of(workplace_id));
drop policy if exists "cl_comp_update" on checklist_completions;
create policy "cl_comp_update" on checklist_completions
  for update using (is_member_of(workplace_id))
  with check (is_member_of(workplace_id));

alter publication supabase_realtime add table checklist_completions;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. INVENTORY — 재고
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  name text not null,
  category text,                          -- '식자재', '비품', '컵', '시럽' ...
  unit text not null default '개',        -- '개', 'kg', 'L', '봉', '박스'
  current_qty numeric(14,3) not null default 0,
  min_qty numeric(14,3) not null default 0,
  vendor text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  user_id uuid references profiles(user_id) on delete set null,
  type text not null
    check (type in ('restock', 'use', 'adjust', 'discard')),
  qty_delta numeric(14,3) not null,        -- + for in, - for out
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inv_workplace on inventory_items(workplace_id, archived);
create index if not exists idx_inv_tx_item on inventory_transactions(item_id, created_at desc);
create index if not exists idx_inv_tx_workplace on inventory_transactions(workplace_id, created_at desc);

-- 거래 등록 → 재고 현재량 자동 갱신
create or replace function apply_inventory_transaction()
returns trigger language plpgsql security definer as $$
begin
  update inventory_items
  set current_qty = current_qty + new.qty_delta,
      updated_at = now()
  where id = new.item_id;
  return new;
end;
$$;

drop trigger if exists trg_inv_apply on inventory_transactions;
create trigger trg_inv_apply
  after insert on inventory_transactions
  for each row execute function apply_inventory_transaction();

alter table inventory_items enable row level security;
alter table inventory_transactions enable row level security;

drop policy if exists "inv_select_workplace" on inventory_items;
create policy "inv_select_workplace" on inventory_items
  for select using (is_member_of(workplace_id));
drop policy if exists "inv_modify_member" on inventory_items;
create policy "inv_modify_member" on inventory_items
  for all using (is_member_of(workplace_id))
  with check (is_member_of(workplace_id));

drop policy if exists "inv_tx_select" on inventory_transactions;
create policy "inv_tx_select" on inventory_transactions
  for select using (is_member_of(workplace_id));
drop policy if exists "inv_tx_insert" on inventory_transactions;
create policy "inv_tx_insert" on inventory_transactions
  for insert with check (
    is_member_of(workplace_id) and (user_id = auth.uid() or user_id is null)
  );

alter publication supabase_realtime add table inventory_items;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. SALES — 매출
-- ─────────────────────────────────────────────────────────────────────────
-- 일 매출 요약 (수동 입력 또는 POS 자동 집계)
create table if not exists sales_daily (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  sales_date date not null,
  total_amount numeric(14,2) not null default 0,
  transaction_count integer not null default 0,
  cash_amount numeric(14,2) not null default 0,
  card_amount numeric(14,2) not null default 0,
  other_amount numeric(14,2) not null default 0,
  source text not null default 'manual'
    check (source in ('manual', 'pos_toss', 'pos_csv', 'pos_other')),
  notes text,
  recorded_by uuid references profiles(user_id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workplace_id, sales_date)
);

-- 실시간 거래 (POS Webhook 수신용 — 토스 POS B2B 연동 가능 시 사용)
create table if not exists sales_transactions (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  external_id text,                         -- POS 측 거래 ID
  source text not null default 'pos_toss'
    check (source in ('manual', 'pos_toss', 'pos_csv', 'pos_other')),
  amount numeric(14,2) not null,
  payment_method text,                      -- 'card', 'cash', 'transfer', ...
  occurred_at timestamptz not null,
  items jsonb,                              -- 주문 항목 (옵션)
  raw_payload jsonb,                        -- 원본 webhook payload
  created_at timestamptz not null default now(),
  unique (workplace_id, source, external_id)
);

create index if not exists idx_sales_daily_wp_date on sales_daily(workplace_id, sales_date desc);
create index if not exists idx_sales_tx_wp_time on sales_transactions(workplace_id, occurred_at desc);

alter table sales_daily enable row level security;
alter table sales_transactions enable row level security;

drop policy if exists "sales_daily_select" on sales_daily;
create policy "sales_daily_select" on sales_daily
  for select using (is_member_of(workplace_id));
drop policy if exists "sales_daily_modify_manager" on sales_daily;
create policy "sales_daily_modify_manager" on sales_daily
  for all using (is_manager_of(workplace_id))
  with check (is_manager_of(workplace_id));

drop policy if exists "sales_tx_select" on sales_transactions;
create policy "sales_tx_select" on sales_transactions
  for select using (is_member_of(workplace_id));

-- sales_transactions 의 INSERT 는 service_role 만 (webhook 서버 라우트에서만)
-- 일반 사용자는 직접 못 넣게 함

alter publication supabase_realtime add table sales_daily;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. sales_transactions → sales_daily 자동 집계
-- ─────────────────────────────────────────────────────────────────────────
create or replace function aggregate_sales_daily()
returns trigger language plpgsql security definer as $$
declare
  d date;
  amt numeric;
  cash numeric;
  card numeric;
  other numeric;
  cnt integer;
begin
  d := (new.occurred_at at time zone 'Asia/Seoul')::date;
  select
    coalesce(sum(amount), 0),
    coalesce(sum(case when payment_method = 'cash' then amount else 0 end), 0),
    coalesce(sum(case when payment_method = 'card' then amount else 0 end), 0),
    coalesce(sum(case when payment_method not in ('cash','card') or payment_method is null then amount else 0 end), 0),
    count(*)
  into amt, cash, card, other, cnt
  from sales_transactions
  where workplace_id = new.workplace_id
    and (occurred_at at time zone 'Asia/Seoul')::date = d;

  insert into sales_daily (workplace_id, sales_date, total_amount, transaction_count,
                            cash_amount, card_amount, other_amount, source, recorded_at, updated_at)
  values (new.workplace_id, d, amt, cnt, cash, card, other, new.source, now(), now())
  on conflict (workplace_id, sales_date) do update
    set total_amount = excluded.total_amount,
        transaction_count = excluded.transaction_count,
        cash_amount = excluded.cash_amount,
        card_amount = excluded.card_amount,
        other_amount = excluded.other_amount,
        source = excluded.source,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sales_aggregate on sales_transactions;
create trigger trg_sales_aggregate
  after insert on sales_transactions
  for each row execute function aggregate_sales_daily();

-- ─────────────────────────────────────────────────────────────────────────
-- 7. SEED — 기본 체크리스트 템플릿 (각 사업장에 오픈/마감 1개씩)
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare
  wp record;
  tpl_id uuid;
begin
  for wp in select id from workplaces loop
    -- 오픈
    insert into checklist_templates (workplace_id, name, type)
    values (wp.id, '오픈 체크리스트', 'open')
    on conflict do nothing
    returning id into tpl_id;
    if tpl_id is not null then
      insert into checklist_items (template_id, text, order_idx, required) values
        (tpl_id, '매장 조명·간판 ON', 0, true),
        (tpl_id, '에스프레소 머신 예열·세팅', 1, true),
        (tpl_id, '원두 그라인더 잔량 확인 / 세팅', 2, true),
        (tpl_id, '냉장고·쇼케이스 온도 확인', 3, true),
        (tpl_id, '우유·시럽 재고 점검', 4, true),
        (tpl_id, '매장·테이블 청소', 5, true),
        (tpl_id, 'POS·시재 준비 (잔돈 확인)', 6, true),
        (tpl_id, '화장실 비품 점검', 7, false);
    end if;

    -- 마감
    tpl_id := null;
    insert into checklist_templates (workplace_id, name, type)
    values (wp.id, '마감 체크리스트', 'close')
    on conflict do nothing
    returning id into tpl_id;
    if tpl_id is not null then
      insert into checklist_items (template_id, text, order_idx, required) values
        (tpl_id, '머신 청소 (역류·물빼기)', 0, true),
        (tpl_id, '그라인더·드립퍼 청소', 1, true),
        (tpl_id, '냉장고·쇼케이스 정리', 2, true),
        (tpl_id, '폐기물 분리수거', 3, true),
        (tpl_id, '매장 바닥·테이블 마감 청소', 4, true),
        (tpl_id, '내일 발주 필요 항목 메모', 5, false),
        (tpl_id, '시재 마감 / 매출 정산', 6, true),
        (tpl_id, '조명·전원·간판 OFF', 7, true);
    end if;
  end loop;
end$$;

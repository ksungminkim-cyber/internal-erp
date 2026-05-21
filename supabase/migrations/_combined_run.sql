-- 9, 10, 11, 15 통합 적용 (멱등성·중복 안전)
-- ALTER PUBLICATION 만 DO 블록 + EXCEPTION 으로 wrap

-- ============================== 09 ==============================
create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  user_id uuid not null references profiles(user_id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  role_label text,
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
create policy "shifts_select_workplace" on shifts for select using (is_member_of(workplace_id));
drop policy if exists "shifts_insert_manager" on shifts;
create policy "shifts_insert_manager" on shifts for insert with check (is_manager_of(workplace_id));
drop policy if exists "shifts_update_manager" on shifts;
create policy "shifts_update_manager" on shifts for update using (is_manager_of(workplace_id)) with check (is_manager_of(workplace_id));
drop policy if exists "shifts_delete_manager" on shifts;
create policy "shifts_delete_manager" on shifts for delete using (is_manager_of(workplace_id));

do $$ begin alter publication supabase_realtime add table shifts; exception when others then null; end $$;

create table if not exists handover_notes (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  author_id uuid not null references profiles(user_id) on delete set null,
  shift_type text not null check (shift_type in ('open', 'mid', 'close')),
  note_date date not null default current_date,
  content text not null,
  flags text[] not null default '{}',
  resolved boolean not null default false,
  resolved_by uuid references profiles(user_id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_handover_workplace_date on handover_notes(workplace_id, note_date desc, created_at desc);
alter table handover_notes enable row level security;
drop policy if exists "handover_select_workplace" on handover_notes;
create policy "handover_select_workplace" on handover_notes for select using (is_member_of(workplace_id));
drop policy if exists "handover_insert_member" on handover_notes;
create policy "handover_insert_member" on handover_notes for insert with check (is_member_of(workplace_id) and author_id = auth.uid());
drop policy if exists "handover_update_author_or_manager" on handover_notes;
create policy "handover_update_author_or_manager" on handover_notes for update using (author_id = auth.uid() or is_manager_of(workplace_id)) with check (author_id = auth.uid() or is_manager_of(workplace_id));
do $$ begin alter publication supabase_realtime add table handover_notes; exception when others then null; end $$;

create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  name text not null,
  type text not null default 'open' check (type in ('open', 'close', 'weekly', 'custom')),
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
create table if not exists checklist_completions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  completion_date date not null default current_date,
  items jsonb not null default '{}',
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
drop policy if exists "cl_tpl_select" on checklist_templates;
create policy "cl_tpl_select" on checklist_templates for select using (is_member_of(workplace_id));
drop policy if exists "cl_tpl_modify_manager" on checklist_templates;
create policy "cl_tpl_modify_manager" on checklist_templates for all using (is_manager_of(workplace_id)) with check (is_manager_of(workplace_id));
drop policy if exists "cl_item_select" on checklist_items;
create policy "cl_item_select" on checklist_items for select using (exists (select 1 from checklist_templates t where t.id = checklist_items.template_id and is_member_of(t.workplace_id)));
drop policy if exists "cl_item_modify_manager" on checklist_items;
create policy "cl_item_modify_manager" on checklist_items for all using (exists (select 1 from checklist_templates t where t.id = checklist_items.template_id and is_manager_of(t.workplace_id))) with check (exists (select 1 from checklist_templates t where t.id = checklist_items.template_id and is_manager_of(t.workplace_id)));
drop policy if exists "cl_comp_select" on checklist_completions;
create policy "cl_comp_select" on checklist_completions for select using (is_member_of(workplace_id));
drop policy if exists "cl_comp_insert" on checklist_completions;
create policy "cl_comp_insert" on checklist_completions for insert with check (is_member_of(workplace_id));
drop policy if exists "cl_comp_update" on checklist_completions;
create policy "cl_comp_update" on checklist_completions for update using (is_member_of(workplace_id)) with check (is_member_of(workplace_id));
do $$ begin alter publication supabase_realtime add table checklist_completions; exception when others then null; end $$;

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  name text not null,
  category text,
  unit text not null default '개',
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
  type text not null check (type in ('restock', 'use', 'adjust', 'discard')),
  qty_delta numeric(14,3) not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_inv_workplace on inventory_items(workplace_id, archived);
create index if not exists idx_inv_tx_item on inventory_transactions(item_id, created_at desc);
create index if not exists idx_inv_tx_workplace on inventory_transactions(workplace_id, created_at desc);
create or replace function apply_inventory_transaction()
returns trigger language plpgsql security definer as $$
begin
  update inventory_items
  set current_qty = current_qty + new.qty_delta, updated_at = now()
  where id = new.item_id;
  return new;
end;
$$;
drop trigger if exists trg_inv_apply on inventory_transactions;
create trigger trg_inv_apply after insert on inventory_transactions for each row execute function apply_inventory_transaction();
alter table inventory_items enable row level security;
alter table inventory_transactions enable row level security;
drop policy if exists "inv_select_workplace" on inventory_items;
create policy "inv_select_workplace" on inventory_items for select using (is_member_of(workplace_id));
drop policy if exists "inv_modify_member" on inventory_items;
create policy "inv_modify_member" on inventory_items for all using (is_member_of(workplace_id)) with check (is_member_of(workplace_id));
drop policy if exists "inv_tx_select" on inventory_transactions;
create policy "inv_tx_select" on inventory_transactions for select using (is_member_of(workplace_id));
drop policy if exists "inv_tx_insert" on inventory_transactions;
create policy "inv_tx_insert" on inventory_transactions for insert with check (is_member_of(workplace_id) and (user_id = auth.uid() or user_id is null));
do $$ begin alter publication supabase_realtime add table inventory_items; exception when others then null; end $$;

create table if not exists sales_daily (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  sales_date date not null,
  total_amount numeric(14,2) not null default 0,
  transaction_count integer not null default 0,
  cash_amount numeric(14,2) not null default 0,
  card_amount numeric(14,2) not null default 0,
  other_amount numeric(14,2) not null default 0,
  source text not null default 'manual' check (source in ('manual', 'pos_toss', 'pos_csv', 'pos_other')),
  notes text,
  recorded_by uuid references profiles(user_id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workplace_id, sales_date)
);
create table if not exists sales_transactions (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  external_id text,
  source text not null default 'pos_toss' check (source in ('manual', 'pos_toss', 'pos_csv', 'pos_other')),
  amount numeric(14,2) not null,
  payment_method text,
  occurred_at timestamptz not null,
  items jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (workplace_id, source, external_id)
);
create index if not exists idx_sales_daily_wp_date on sales_daily(workplace_id, sales_date desc);
create index if not exists idx_sales_tx_wp_time on sales_transactions(workplace_id, occurred_at desc);
alter table sales_daily enable row level security;
alter table sales_transactions enable row level security;
drop policy if exists "sales_daily_select" on sales_daily;
create policy "sales_daily_select" on sales_daily for select using (is_member_of(workplace_id));
drop policy if exists "sales_daily_modify_manager" on sales_daily;
create policy "sales_daily_modify_manager" on sales_daily for all using (is_manager_of(workplace_id)) with check (is_manager_of(workplace_id));
drop policy if exists "sales_tx_select" on sales_transactions;
create policy "sales_tx_select" on sales_transactions for select using (is_member_of(workplace_id));
do $$ begin alter publication supabase_realtime add table sales_daily; exception when others then null; end $$;

create or replace function aggregate_sales_daily()
returns trigger language plpgsql security definer as $$
declare
  d date; amt numeric; cash numeric; card numeric; other numeric; cnt integer;
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
  insert into sales_daily (workplace_id, sales_date, total_amount, transaction_count, cash_amount, card_amount, other_amount, source, recorded_at, updated_at)
  values (new.workplace_id, d, amt, cnt, cash, card, other, new.source, now(), now())
  on conflict (workplace_id, sales_date) do update
    set total_amount = excluded.total_amount, transaction_count = excluded.transaction_count,
        cash_amount = excluded.cash_amount, card_amount = excluded.card_amount,
        other_amount = excluded.other_amount, source = excluded.source, updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_sales_aggregate on sales_transactions;
create trigger trg_sales_aggregate after insert on sales_transactions for each row execute function aggregate_sales_daily();

-- seed 체크리스트 (없으면 추가)
do $$
declare wp record; tpl_id uuid;
begin
  for wp in select id from workplaces loop
    insert into checklist_templates (workplace_id, name, type)
    values (wp.id, '오픈 체크리스트', 'open')
    on conflict do nothing returning id into tpl_id;
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
    tpl_id := null;
    insert into checklist_templates (workplace_id, name, type)
    values (wp.id, '마감 체크리스트', 'close')
    on conflict do nothing returning id into tpl_id;
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

-- ============================== 10 ==============================
alter table workplaces
  add column if not exists pos_store_code text unique,
  add column if not exists pos_provider text;

-- ============================== 11 ==============================
create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  name text not null,
  category text,
  model text,
  serial_no text,
  purchased_at date,
  warranty_until date,
  vendor text,
  status text not null default 'ok' check (status in ('ok', 'warning', 'broken', 'retired')),
  next_check_at date,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists equipment_logs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  user_id uuid references profiles(user_id) on delete set null,
  log_type text not null check (log_type in ('check', 'maintenance', 'issue', 'repair', 'replace')),
  title text not null,
  description text,
  cost numeric(14,2),
  performed_at timestamptz not null default now(),
  next_check_at date,
  attachments jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_equipment_workplace on equipment(workplace_id, archived);
create index if not exists idx_equipment_logs_equip on equipment_logs(equipment_id, performed_at desc);
create or replace function apply_equipment_log()
returns trigger language plpgsql security definer as $$
begin
  update equipment
  set next_check_at = coalesce(new.next_check_at, next_check_at),
      status = case when new.log_type = 'repair' then 'ok'
                    when new.log_type = 'issue' then 'warning'
                    when new.log_type = 'replace' then 'ok'
                    else status end,
      updated_at = now()
  where id = new.equipment_id;
  return new;
end;
$$;
drop trigger if exists trg_equipment_log on equipment_logs;
create trigger trg_equipment_log after insert on equipment_logs for each row execute function apply_equipment_log();
alter table equipment enable row level security;
alter table equipment_logs enable row level security;
drop policy if exists "equip_select" on equipment;
create policy "equip_select" on equipment for select using (is_member_of(workplace_id));
drop policy if exists "equip_modify_member" on equipment;
create policy "equip_modify_member" on equipment for all using (is_member_of(workplace_id)) with check (is_member_of(workplace_id));
drop policy if exists "equip_log_select" on equipment_logs;
create policy "equip_log_select" on equipment_logs for select using (is_member_of(workplace_id));
drop policy if exists "equip_log_insert" on equipment_logs;
create policy "equip_log_insert" on equipment_logs for insert with check (is_member_of(workplace_id) and (user_id = auth.uid() or user_id is null));
do $$ begin alter publication supabase_realtime add table equipment; exception when others then null; end $$;

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  serving_size text,
  ingredients jsonb not null default '[]',
  steps jsonb not null default '[]',
  cost numeric(14,2),
  sell_price numeric(14,2),
  image_url text,
  notes text,
  active boolean not null default true,
  created_by uuid references profiles(user_id) on delete set null,
  updated_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_recipes_category on recipes(category) where active = true;
alter table recipes enable row level security;
drop policy if exists "recipes_select_member" on recipes;
create policy "recipes_select_member" on recipes for select using (exists (select 1 from memberships where user_id = auth.uid() and active = true));
drop policy if exists "recipes_modify_manager" on recipes;
create policy "recipes_modify_manager" on recipes for all using (exists (select 1 from memberships where user_id = auth.uid() and active = true and role in ('manager', 'owner'))) with check (exists (select 1 from memberships where user_id = auth.uid() and active = true and role in ('manager', 'owner')));
do $$ begin alter publication supabase_realtime add table recipes; exception when others then null; end $$;

create table if not exists customer_complaints (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  reporter_id uuid references profiles(user_id) on delete set null,
  occurred_at timestamptz not null default now(),
  channel text not null default 'in_person' check (channel in ('in_person', 'phone', 'kakao', 'review', 'sns', 'other')),
  customer_label text,
  customer_contact text,
  category text not null default 'other' check (category in ('taste', 'service', 'hygiene', 'billing', 'wait', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  summary text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_complaints_workplace on customer_complaints(workplace_id, occurred_at desc);
create index if not exists idx_complaints_status on customer_complaints(workplace_id, status);
alter table customer_complaints enable row level security;
drop policy if exists "complaints_select_workplace" on customer_complaints;
create policy "complaints_select_workplace" on customer_complaints for select using (is_member_of(workplace_id));
drop policy if exists "complaints_insert_member" on customer_complaints;
create policy "complaints_insert_member" on customer_complaints for insert with check (is_member_of(workplace_id) and (reporter_id = auth.uid() or reporter_id is null));
drop policy if exists "complaints_update_workplace" on customer_complaints;
create policy "complaints_update_workplace" on customer_complaints for update using (is_member_of(workplace_id)) with check (is_member_of(workplace_id));
do $$ begin alter publication supabase_realtime add table customer_complaints; exception when others then null; end $$;

insert into recipes (name, category, serving_size, ingredients, steps, sell_price, notes)
select '아메리카노', '에스프레소', '레귤러 350ml',
       '[{"name":"에스프레소","qty":2,"unit":"샷","note":""},{"name":"물","qty":300,"unit":"ml","note":"뜨거운 물"}]'::jsonb,
       '["20초 더블 샷 추출","300ml 뜨거운 물 컵에 따르기","샷 위로 가볍게 부어 layer 만들기"]'::jsonb,
       4500,
       '얼음 아메리카노는 얼음 7개 + 물 200ml로 조정'
where not exists (select 1 from recipes where name = '아메리카노');

-- ============================== 15 ==============================
alter table approval_requests drop constraint if exists approval_requests_doc_type_check;
alter table approval_requests
  add constraint approval_requests_doc_type_check
  check (doc_type in ('expense', 'general', 'schedule'));

alter table approval_requests
  add column if not exists period_year integer,
  add column if not exists period_month integer
    check (period_month is null or (period_month between 1 and 12));

alter table shifts
  add column if not exists approval_request_id uuid references approval_requests(id) on delete set null;

create index if not exists idx_shifts_approval on shifts(approval_request_id);

create or replace function on_approval_decided()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'approved' and (old.status is null or old.status <> 'approved') then
    update shifts set status = 'confirmed', updated_at = now()
    where approval_request_id = new.id and status = 'scheduled';
  elsif new.status = 'rejected' and (old.status is null or old.status <> 'rejected') then
    update shifts set status = 'cancelled', updated_at = now()
    where approval_request_id = new.id and status = 'scheduled';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_approval_decided on approval_requests;
create trigger trg_approval_decided
  after update of status on approval_requests
  for each row execute function on_approval_decided();

create table if not exists sales_tips (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  content text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sales_tips_wp on sales_tips(workplace_id, sort_order);
alter table sales_tips enable row level security;
drop policy if exists "sales_tips_select" on sales_tips;
create policy "sales_tips_select" on sales_tips for select using (is_member_of(workplace_id));
drop policy if exists "sales_tips_modify_manager" on sales_tips;
create policy "sales_tips_modify_manager" on sales_tips for all using (is_manager_of(workplace_id)) with check (is_manager_of(workplace_id));

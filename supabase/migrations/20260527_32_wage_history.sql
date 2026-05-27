-- ============================================================
-- 시급 변경 이력 — profiles.hourly_wage 변경 시 자동 기록
-- ============================================================

create table if not exists wage_history (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  old_wage      numeric,
  new_wage      numeric not null,
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now(),
  note          text
);

create index if not exists idx_wage_history_user on wage_history(user_id, changed_at desc);

alter table wage_history enable row level security;

-- 본인 또는 관리자(super_admin/owner)만 조회 가능
drop policy if exists "wage_history_select" on wage_history;
create policy "wage_history_select" on wage_history
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles
      where user_id = auth.uid() and is_super_admin = true
    )
    or exists (
      select 1 from memberships
      where user_id = auth.uid() and role = 'owner' and active = true
    )
  );

-- INSERT: 트리거에서만 (서비스 롤은 RLS 우회)
drop policy if exists "wage_history_insert" on wage_history;
create policy "wage_history_insert" on wage_history
  for insert with check (true);

-- 트리거: profiles.hourly_wage 변경 시 자동 기록
create or replace function log_wage_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if (old.hourly_wage is distinct from new.hourly_wage) then
    insert into wage_history(user_id, old_wage, new_wage, changed_by)
    values (new.user_id, old.hourly_wage, new.hourly_wage, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_wage_change on profiles;
create trigger trg_log_wage_change
  after update of hourly_wage on profiles
  for each row execute function log_wage_change();

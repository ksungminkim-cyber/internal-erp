-- ============================================================================
-- 통합 마이그레이션 — 한 번에 실행하세요
-- ============================================================================
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복사 붙여넣기 → Run
-- 한 번에 6개 마이그레이션 (29~34)을 모두 적용합니다.
-- 이미 적용된 항목은 IF NOT EXISTS / OR REPLACE로 안전하게 스킵됩니다.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 29. super_admin 전 매장 접근 허용                                 ║
-- ╚══════════════════════════════════════════════════════════════════╝

create or replace function is_member_of(wp_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid()
      and workplace_id = wp_id
      and active = true
  )
  or exists (
    select 1 from profiles
    where user_id = auth.uid()
      and is_super_admin = true
  );
$$;

create or replace function is_manager_of(wp_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid()
      and workplace_id = wp_id
      and active = true
      and role in ('manager', 'owner')
  )
  or exists (
    select 1 from profiles
    where user_id = auth.uid()
      and is_super_admin = true
  );
$$;

drop policy if exists "profiles_select_self_or_coworker" on profiles;
create policy "profiles_select_self_or_coworker" on profiles
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles p2
      where p2.user_id = auth.uid()
        and p2.is_super_admin = true
    )
    or exists (
      select 1 from memberships m1
      join memberships m2 on m1.workplace_id = m2.workplace_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.user_id
        and m1.active = true and m2.active = true
    )
  );

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 30. null 이름 복구 + 본사 멤버 is_super_admin 일괄 부여            ║
-- ╚══════════════════════════════════════════════════════════════════╝

UPDATE profiles
SET
  name       = COALESCE(
                 NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
                 split_part(u.email, '@', 1)
               ),
  updated_at = now()
FROM auth.users u
WHERE profiles.user_id = u.id
  AND (profiles.name IS NULL OR TRIM(profiles.name) = '');

UPDATE profiles
SET
  is_super_admin = true,
  updated_at     = now()
WHERE user_id IN (
  SELECT m.user_id
  FROM   memberships m
  JOIN   workplaces  w ON w.id = m.workplace_id
  WHERE  w.name     = '본사'
    AND  m.active   = true
);

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 31. 본사 멤버십 자동 super_admin 트리거                            ║
-- ╚══════════════════════════════════════════════════════════════════╝

create or replace function sync_super_admin_from_hq()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.active = true then
    update profiles
    set
      is_super_admin = true,
      updated_at     = now()
    where user_id = new.user_id
      and exists (
        select 1 from workplaces
        where id   = new.workplace_id
          and name = '본사'
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hq_super_admin on memberships;
create trigger trg_hq_super_admin
  after insert or update of active on memberships
  for each row execute function sync_super_admin_from_hq();

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 32. 시급 변경 이력 (wage_history)                                  ║
-- ╚══════════════════════════════════════════════════════════════════╝

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

drop policy if exists "wage_history_insert" on wage_history;
create policy "wage_history_insert" on wage_history
  for insert with check (true);

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

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 33. 직원 퇴사 처리 + 월 마감 잠금 + 시프트 충돌 검증                ║
-- ╚══════════════════════════════════════════════════════════════════╝

alter table profiles
  add column if not exists retired_at  timestamptz,
  add column if not exists retired_reason text;

create or replace function on_retire_disable_memberships()
returns trigger
language plpgsql
security definer
as $$
begin
  if (old.retired_at is null and new.retired_at is not null) then
    update memberships
    set active = false
    where user_id = new.user_id
      and active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_on_retire_disable_memberships on profiles;
create trigger trg_on_retire_disable_memberships
  after update of retired_at on profiles
  for each row execute function on_retire_disable_memberships();

alter table month_closings
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references auth.users(id) on delete set null;

create or replace function check_month_locked()
returns trigger
language plpgsql
security definer
as $$
declare
  v_workplace uuid;
  v_year int;
  v_month int;
  v_ts timestamptz;
  v_row jsonb;
begin
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  v_workplace := (v_row->>'workplace_id')::uuid;
  v_ts := case tg_table_name
    when 'attendance_logs'   then (v_row->>'event_at')::timestamptz
    when 'sales_daily'       then (v_row->>'sales_date')::timestamptz
    when 'approval_requests' then (v_row->>'submitted_at')::timestamptz
    else now()
  end;
  v_year  := extract(year from v_ts);
  v_month := extract(month from v_ts);

  if exists (
    select 1 from month_closings
    where workplace_id = v_workplace
      and year = v_year
      and month = v_month
      and (locked = true or locked_at is not null)
  ) then
    raise exception '% 년 % 월은 마감 잠금됨 - 변경 불가', v_year, v_month;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_check_month_locked_logs on attendance_logs;
create trigger trg_check_month_locked_logs
  before insert or update or delete on attendance_logs
  for each row execute function check_month_locked();

drop trigger if exists trg_check_month_locked_sales on sales_daily;
create trigger trg_check_month_locked_sales
  before insert or update or delete on sales_daily
  for each row execute function check_month_locked();

create or replace function check_shift_conflict()
returns trigger
language plpgsql
security definer
as $$
begin
  if exists (
    select 1 from shifts s
    where s.user_id = new.user_id
      and s.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(s.start_at, s.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception '시프트 충돌 — 동일 시간대에 다른 시프트가 이미 있음';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_shift_conflict on shifts;
create trigger trg_check_shift_conflict
  before insert or update of start_at, end_at, user_id on shifts
  for each row execute function check_shift_conflict();

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 34. 결재 재기안 + 위임 + 감사 로그                                 ║
-- ╚══════════════════════════════════════════════════════════════════╝

alter table approval_requests
  add column if not exists revision_of uuid references approval_requests(id) on delete set null,
  add column if not exists revision_count int not null default 0;

create index if not exists idx_approval_revision_of on approval_requests(revision_of);

create table if not exists approval_delegations (
  id            bigserial primary key,
  delegator_id  uuid not null references auth.users(id) on delete cascade,
  delegate_id   uuid not null references auth.users(id) on delete cascade,
  workplace_id  uuid references workplaces(id) on delete cascade,
  reason        text,
  start_at      date not null default current_date,
  end_at        date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (delegator_id <> delegate_id)
);

create index if not exists idx_delegations_delegator on approval_delegations(delegator_id, active);
create index if not exists idx_delegations_delegate  on approval_delegations(delegate_id,  active);

alter table approval_delegations enable row level security;

drop policy if exists "delegations_select" on approval_delegations;
create policy "delegations_select" on approval_delegations
  for select using (
    delegator_id = auth.uid()
    or delegate_id = auth.uid()
    or exists (select 1 from profiles where user_id = auth.uid() and is_super_admin = true)
    or (workplace_id is null or is_manager_of(workplace_id))
  );

drop policy if exists "delegations_insert" on approval_delegations;
create policy "delegations_insert" on approval_delegations
  for insert with check (delegator_id = auth.uid());

drop policy if exists "delegations_update" on approval_delegations;
create policy "delegations_update" on approval_delegations
  for update using (delegator_id = auth.uid())
  with check (delegator_id = auth.uid());

drop policy if exists "delegations_delete" on approval_delegations;
create policy "delegations_delete" on approval_delegations
  for delete using (delegator_id = auth.uid());

create or replace function get_effective_approver(p_step_approver uuid, p_workplace_id uuid)
returns uuid
language sql
stable
as $$
  select coalesce(
    (
      select delegate_id from approval_delegations
      where delegator_id = p_step_approver
        and active = true
        and start_at <= current_date
        and (end_at is null or end_at >= current_date)
        and (workplace_id is null or workplace_id = p_workplace_id)
      order by created_at desc
      limit 1
    ),
    p_step_approver
  );
$$;

create table if not exists audit_logs (
  id            bigserial primary key,
  user_id       uuid references auth.users(id) on delete set null,
  user_email    text,
  action        text not null,
  entity        text not null,
  entity_id     text,
  workplace_id  uuid references workplaces(id) on delete set null,
  changes       jsonb,
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_audit_logs_user_id    on audit_logs(user_id, created_at desc);
create index if not exists idx_audit_logs_entity     on audit_logs(entity, entity_id, created_at desc);
create index if not exists idx_audit_logs_action     on audit_logs(action, created_at desc);
create index if not exists idx_audit_logs_workplace  on audit_logs(workplace_id, created_at desc);

alter table audit_logs enable row level security;

drop policy if exists "audit_logs_select" on audit_logs;
create policy "audit_logs_select" on audit_logs
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and is_super_admin = true)
    or exists (select 1 from memberships where user_id = auth.uid() and role = 'owner' and active = true)
  );

drop policy if exists "audit_logs_insert" on audit_logs;
create policy "audit_logs_insert" on audit_logs
  for insert with check (true);

create or replace function log_audit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_action text;
  v_entity_id text;
  v_workplace uuid;
  v_changes jsonb;
begin
  v_action := lower(tg_op);
  v_entity_id := case tg_op
    when 'DELETE' then coalesce(old.id::text, '')
    else coalesce(new.id::text, '')
  end;
  v_workplace := case
    when tg_table_name = 'profiles' then null
    else coalesce(
      case tg_op when 'DELETE' then null else (to_jsonb(new) ->> 'workplace_id')::uuid end,
      case tg_op when 'INSERT' then null else (to_jsonb(old) ->> 'workplace_id')::uuid end
    )
  end;

  if tg_op = 'UPDATE' then
    v_changes := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  elsif tg_op = 'INSERT' then
    v_changes := jsonb_build_object('after', to_jsonb(new));
  else
    v_changes := jsonb_build_object('before', to_jsonb(old));
  end if;

  insert into audit_logs(user_id, action, entity, entity_id, workplace_id, changes)
  values (auth.uid(), v_action, tg_table_name, v_entity_id, v_workplace, v_changes);

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_profiles on profiles;
create trigger trg_audit_profiles
  after insert or update or delete on profiles
  for each row execute function log_audit();

drop trigger if exists trg_audit_memberships on memberships;
create trigger trg_audit_memberships
  after insert or update or delete on memberships
  for each row execute function log_audit();

drop trigger if exists trg_audit_approvals on approval_requests;
create trigger trg_audit_approvals
  after insert or update or delete on approval_requests
  for each row execute function log_audit();

drop trigger if exists trg_audit_month_closings on month_closings;
create trigger trg_audit_month_closings
  after insert or update or delete on month_closings
  for each row execute function log_audit();

-- ============================================================================
-- 끝 — 모두 적용됨
-- ============================================================================

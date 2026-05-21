-- ========================================================================
-- 본사(HQ) workplace + 자동 권한 / 체크리스트 주기 / 건의함 / KPI/OPI / 온보딩
-- ========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. 본사 workplace 시드 + 자동 super_admin 트리거
-- ─────────────────────────────────────────────────────────────────────────
insert into workplaces (name) values ('본사')
on conflict (name) do nothing;

-- 본사 멤버십이 추가/갱신/삭제될 때 profiles.is_super_admin 자동 동기화
create or replace function sync_hq_super_admin()
returns trigger language plpgsql security definer as $$
declare
  hq_id uuid;
  target_user uuid;
  is_hq_member boolean;
begin
  select id into hq_id from workplaces where name = '본사' limit 1;
  if hq_id is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    target_user := old.user_id;
  else
    target_user := new.user_id;
  end if;

  -- 해당 사용자의 본사 active 멤버십 존재 여부
  is_hq_member := exists (
    select 1 from memberships
    where user_id = target_user
      and workplace_id = hq_id
      and active = true
  );

  -- 본사 멤버면 super_admin true 강제
  -- 본사에서 빠지면 — 강제로 false 하지 않음 (수동 super_admin 유지 가능)
  if is_hq_member then
    update profiles set is_super_admin = true where user_id = target_user;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_membership on memberships;
create trigger trg_hq_membership
  after insert or update or delete on memberships
  for each row execute function sync_hq_super_admin();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. 체크리스트 주기 옵션
-- ─────────────────────────────────────────────────────────────────────────
alter table checklist_templates
  add column if not exists frequency text not null default 'daily'
    check (frequency in ('daily', 'weekly', 'monthly', 'custom')),
  add column if not exists day_of_week integer
    check (day_of_week is null or day_of_week between 0 and 6),    -- 0=일, 6=토
  add column if not exists day_of_month integer
    check (day_of_month is null or day_of_month between 1 and 31);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. 건의함 (suggestions)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  workplace_id uuid references workplaces(id) on delete set null,
  category text not null default 'general'
    check (category in ('general', 'environment', 'process', 'welfare', 'other')),
  title text not null,
  body text not null,
  anonymous boolean not null default false,
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'declined')),
  response text,
  responded_by uuid references profiles(user_id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_suggestions_status on suggestions(status, created_at desc);
create index if not exists idx_suggestions_user on suggestions(user_id, created_at desc);

alter table suggestions enable row level security;

-- 본인 + super_admin(=본사) 조회 가능
drop policy if exists "suggestions_select" on suggestions;
create policy "suggestions_select" on suggestions
  for select using (user_id = auth.uid() or is_super_admin());

-- 본인만 INSERT
drop policy if exists "suggestions_insert" on suggestions;
create policy "suggestions_insert" on suggestions
  for insert with check (user_id = auth.uid());

-- 본사만 UPDATE
drop policy if exists "suggestions_update_hq" on suggestions;
create policy "suggestions_update_hq" on suggestions
  for update using (is_super_admin())
  with check (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 4. KPI / OPI
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists kpis (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid references workplaces(id) on delete cascade,  -- null = 전사
  category text not null default 'opi'
    check (category in ('kpi', 'opi')),
  name text not null,
  target_value numeric(14,2),
  unit text,                                                       -- '원', '%', '건', '명' 등
  period text not null default 'monthly'
    check (period in ('weekly', 'monthly', 'quarterly', 'annual')),
  description text,
  approval_request_id uuid references approval_requests(id) on delete set null,
  approved boolean not null default false,
  active boolean not null default true,
  created_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists kpi_records (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references kpis(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  actual_value numeric(14,2),
  notes text,
  recorded_by uuid references profiles(user_id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_kpis_workplace on kpis(workplace_id, active);
create index if not exists idx_kpi_records_kpi on kpi_records(kpi_id, period_end desc);

alter table kpis enable row level security;
alter table kpi_records enable row level security;

drop policy if exists "kpi_select" on kpis;
create policy "kpi_select" on kpis for select using (
  (workplace_id is null and exists (select 1 from memberships where user_id = auth.uid() and active = true))
  or is_member_of(workplace_id)
);

drop policy if exists "kpi_modify_manager" on kpis;
create policy "kpi_modify_manager" on kpis for all using (
  is_super_admin()
  or (workplace_id is not null and is_manager_of(workplace_id))
) with check (
  is_super_admin()
  or (workplace_id is not null and is_manager_of(workplace_id))
);

drop policy if exists "kpi_records_select" on kpi_records;
create policy "kpi_records_select" on kpi_records for select using (
  exists (
    select 1 from kpis k where k.id = kpi_records.kpi_id and (
      (k.workplace_id is null and exists (select 1 from memberships where user_id = auth.uid() and active = true))
      or is_member_of(k.workplace_id)
    )
  )
);

drop policy if exists "kpi_records_modify" on kpi_records;
create policy "kpi_records_modify" on kpi_records for all using (
  exists (select 1 from kpis k where k.id = kpi_records.kpi_id and (
    is_super_admin() or (k.workplace_id is not null and is_manager_of(k.workplace_id))
  ))
) with check (
  exists (select 1 from kpis k where k.id = kpi_records.kpi_id and (
    is_super_admin() or (k.workplace_id is not null and is_manager_of(k.workplace_id))
  ))
);

-- approval doc_type 에 'kpi' 추가
alter table approval_requests drop constraint if exists approval_requests_doc_type_check;
alter table approval_requests
  add constraint approval_requests_doc_type_check
  check (doc_type in ('expense', 'general', 'schedule', 'kpi'));

-- KPI 결재 승인 시 자동 active
create or replace function on_kpi_approval_decided()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'approved' and (old.status is null or old.status <> 'approved') then
    update kpis set approved = true, updated_at = now()
    where approval_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kpi_approval on approval_requests;
create trigger trg_kpi_approval
  after update of status on approval_requests
  for each row when (new.doc_type = 'kpi')
  execute function on_kpi_approval_decided();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. 온보딩
-- ─────────────────────────────────────────────────────────────────────────
alter table profiles
  add column if not exists onboarded_at timestamptz;

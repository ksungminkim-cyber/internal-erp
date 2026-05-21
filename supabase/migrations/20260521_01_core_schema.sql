-- ========================================================================
-- Internal ERP — Phase 1 core schema
-- 사업장(workplaces) · 멤버십(memberships) · 프로필(profiles)
-- ========================================================================

-- 1. profiles : auth.users 1:1 확장
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. workplaces : 사업장 (나울 / 녹턴)
create table if not exists workplaces (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  created_at timestamptz not null default now()
);

-- seed 데이터
insert into workplaces (name) values ('나울'), ('녹턴')
on conflict (name) do nothing;

-- 3. memberships : 사용자 × 사업장 × 역할
-- role: 'staff' (직원), 'manager' (매니저), 'owner' (대표)
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  role text not null default 'staff' check (role in ('staff', 'manager', 'owner')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, workplace_id)
);

create index if not exists idx_memberships_user on memberships(user_id);
create index if not exists idx_memberships_workplace on memberships(workplace_id);

-- ========================================================================
-- 자동 프로필 생성 트리거
-- ========================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ========================================================================
-- 헬퍼 함수 — RLS에서 재사용
-- ========================================================================

-- 현재 사용자가 해당 사업장의 멤버인지
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
  );
$$;

-- 현재 사용자가 해당 사업장의 매니저/대표인지
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
  );
$$;

-- ========================================================================
-- RLS
-- ========================================================================
alter table profiles enable row level security;
alter table workplaces enable row level security;
alter table memberships enable row level security;

-- profiles: 본인 + 같은 사업장 동료 조회 가능, 본인만 수정
drop policy if exists "profiles_select_self_or_coworker" on profiles;
create policy "profiles_select_self_or_coworker" on profiles
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from memberships m1
      join memberships m2 on m1.workplace_id = m2.workplace_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.user_id
        and m1.active = true and m2.active = true
    )
  );

drop policy if exists "profiles_upsert_self" on profiles;
create policy "profiles_upsert_self" on profiles
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- workplaces: 멤버만 조회
drop policy if exists "workplaces_select_member" on workplaces;
create policy "workplaces_select_member" on workplaces
  for select using (is_member_of(id));

-- memberships: 같은 사업장 멤버 모두 조회 가능 (누가 우리 매장 직원인지 알아야 함)
drop policy if exists "memberships_select_workplace" on memberships;
create policy "memberships_select_workplace" on memberships
  for select using (is_member_of(workplace_id));

-- ============================================================
-- 본사 직원(is_super_admin) 전 매장 데이터 접근 허용
-- is_member_of / is_manager_of 함수에 super_admin 예외 추가
-- profiles SELECT 정책도 동일하게 갱신
-- ============================================================

-- 1. is_member_of : super_admin이면 어느 workplace든 member로 간주
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

-- 2. is_manager_of : super_admin이면 어느 workplace든 manager로 간주
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

-- 3. profiles SELECT : super_admin은 전체 프로필 조회 가능
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

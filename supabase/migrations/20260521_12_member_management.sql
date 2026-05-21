-- ========================================================================
-- 앱 내 직원 관리를 위한 RLS 보강
-- - super_admin 은 미배정 사용자 포함 모든 profiles 조회 가능
-- - owner / super_admin 은 memberships INSERT / UPDATE / DELETE 가능
-- ========================================================================

-- 현재 사용자가 super_admin 인지
create or replace function is_super_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce((select is_super_admin from profiles where user_id = auth.uid()), false);
$$;

-- profiles: super_admin 은 모든 행 조회 (배정 안 된 사람도 보여야 함)
drop policy if exists "profiles_select_super_admin" on profiles;
create policy "profiles_select_super_admin" on profiles
  for select using (is_super_admin());

-- profiles: super_admin 은 다른 사람 프로필도 수정 가능 (이름 정리 등)
drop policy if exists "profiles_update_super_admin" on profiles;
create policy "profiles_update_super_admin" on profiles
  for update using (is_super_admin())
  with check (is_super_admin());

-- memberships: owner / super_admin 만 INSERT
drop policy if exists "memberships_insert_owner" on memberships;
create policy "memberships_insert_owner" on memberships
  for insert with check (
    is_super_admin()
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.workplace_id = memberships.workplace_id
        and m.active = true
        and m.role = 'owner'
    )
  );

-- memberships: owner / super_admin 만 UPDATE (role / active 변경)
drop policy if exists "memberships_update_owner" on memberships;
create policy "memberships_update_owner" on memberships
  for update using (
    is_super_admin()
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.workplace_id = memberships.workplace_id
        and m.active = true
        and m.role = 'owner'
    )
  )
  with check (
    is_super_admin()
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.workplace_id = memberships.workplace_id
        and m.active = true
        and m.role = 'owner'
    )
  );

-- memberships: owner / super_admin 만 DELETE
drop policy if exists "memberships_delete_owner" on memberships;
create policy "memberships_delete_owner" on memberships
  for delete using (
    is_super_admin()
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.workplace_id = memberships.workplace_id
        and m.active = true
        and m.role = 'owner'
    )
  );

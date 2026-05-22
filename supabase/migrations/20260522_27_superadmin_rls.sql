-- ========================================================================
-- 27. super_admin RLS SELECT 정책 보완
--
-- 문제: memberships / workplaces 테이블에 super_admin SELECT 정책이 없어서
--       /members 페이지에서 모든 데이터를 조회하지 못함
-- ========================================================================

-- memberships: super_admin 전체 조회
drop policy if exists "memberships_select_super_admin" on memberships;
create policy "memberships_select_super_admin" on memberships
  for select using (is_super_admin());

-- workplaces: super_admin 전체 조회
drop policy if exists "workplaces_select_super_admin" on workplaces;
create policy "workplaces_select_super_admin" on workplaces
  for select using (is_super_admin());

-- profiles: super_admin 전체 조회 (혹시 누락된 경우 대비 재생성)
drop policy if exists "profiles_select_super_admin" on profiles;
create policy "profiles_select_super_admin" on profiles
  for select using (is_super_admin());

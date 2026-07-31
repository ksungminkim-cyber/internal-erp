-- ========================================================================
-- 35. profiles RLS 무한 재귀 수정
--
-- 문제: 29번 마이그레이션의 profiles_select_self_or_coworker 정책이
--       super_admin 체크를 위해 profiles 자신을 인라인 서브쿼리로 조회
--       → 정책 평가가 다시 정책 평가를 유발
--       → "infinite recursion detected in policy for relation profiles"
--       → 클라이언트(anon key) 측 profiles 조회 전부 실패
--         (시프트 결재자 후보 목록이 항상 비는 원인)
--
-- 해결: 인라인 서브쿼리를 security definer 함수 is_super_admin()으로 교체.
--       security definer는 소유자 권한으로 실행되어 RLS를 타지 않으므로
--       재귀가 발생하지 않음. (12번 마이그레이션에서 이미 생성된 함수)
-- ========================================================================

drop policy if exists "profiles_select_self_or_coworker" on profiles;
create policy "profiles_select_self_or_coworker" on profiles
  for select using (
    user_id = auth.uid()
    or is_super_admin()
    or exists (
      select 1 from memberships m1
      join memberships m2 on m1.workplace_id = m2.workplace_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.user_id
        and m1.active = true and m2.active = true
    )
  );

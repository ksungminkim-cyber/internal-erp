-- ========================================================================
-- 레시피 — 직원도 자유롭게 수정 가능
-- (체크리스트와 동일한 접근법: manager → member)
-- ========================================================================

drop policy if exists "recipes_modify_manager" on recipes;
drop policy if exists "recipes_modify_member" on recipes;

create policy "recipes_modify_member" on recipes
  for all using (
    is_super_admin()
    -- 전사 공유 레시피는 멤버 누구나
    or (workplace_id is null and exists (
      select 1 from memberships m
      where m.user_id = auth.uid() and m.active = true
    ))
    -- 사업장별 레시피는 해당 사업장 멤버
    or is_member_of(workplace_id)
  )
  with check (
    is_super_admin()
    or (workplace_id is null and exists (
      select 1 from memberships m
      where m.user_id = auth.uid() and m.active = true
    ))
    or is_member_of(workplace_id)
  );

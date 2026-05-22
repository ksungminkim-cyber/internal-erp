-- ========================================================================
-- 레시피 사업장별 분리
-- recipes.workplace_id: NULL = 전사 공유, 값 있음 = 해당 사업장 전용
-- ========================================================================

alter table recipes
  add column if not exists workplace_id uuid references workplaces(id) on delete cascade;

create index if not exists idx_recipes_workplace
  on recipes(workplace_id, active);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS 갱신
-- ─────────────────────────────────────────────────────────────────────────

-- SELECT
drop policy if exists "recipes_select_member" on recipes;
create policy "recipes_select_member" on recipes
  for select using (
    -- 전사 공유 (workplace_id NULL) 는 멤버 누구나
    (workplace_id is null and exists (
      select 1 from memberships m where m.user_id = auth.uid() and m.active = true
    ))
    -- 사업장별은 해당 사업장 멤버만
    or is_member_of(workplace_id)
  );

-- INSERT / UPDATE / DELETE
drop policy if exists "recipes_modify_manager" on recipes;
create policy "recipes_modify_manager" on recipes
  for all using (
    is_super_admin()
    -- 전사 공유는 매니저/대표 누구나
    or (workplace_id is null and exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.active = true
        and m.role in ('manager', 'owner')
    ))
    -- 사업장별은 그 사업장의 매니저/대표
    or (workplace_id is not null and is_manager_of(workplace_id))
  )
  with check (
    is_super_admin()
    or (workplace_id is null and exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.active = true
        and m.role in ('manager', 'owner')
    ))
    or (workplace_id is not null and is_manager_of(workplace_id))
  );

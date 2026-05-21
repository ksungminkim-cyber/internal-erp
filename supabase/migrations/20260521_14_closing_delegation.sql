-- ========================================================================
-- 월 마감 권한 위임
-- 대표가 지정한 직원도 마감 확정/해제 가능하도록 profiles.can_close_books 추가
-- ========================================================================

alter table profiles
  add column if not exists can_close_books boolean not null default false;

-- closings 정책 확장: owner / super_admin / can_close_books=true 모두 허용
drop policy if exists "closings_modify_owner" on month_closings;
create policy "closings_modify_authorized" on month_closings
  for all using (
    is_super_admin()
    or coalesce((select can_close_books from profiles where user_id = auth.uid()), false)
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.workplace_id = month_closings.workplace_id
        and m.active = true
        and m.role = 'owner'
    )
  )
  with check (
    is_super_admin()
    or coalesce((select can_close_books from profiles where user_id = auth.uid()), false)
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.workplace_id = month_closings.workplace_id
        and m.active = true
        and m.role = 'owner'
    )
  );

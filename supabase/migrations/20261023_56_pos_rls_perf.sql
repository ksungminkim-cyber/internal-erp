-- ========================================================================
-- 포스 테이블 RLS 성능 — 행마다 is_member_of() 함수를 부르던 정책을 "한 번 계산하는 서브쿼리" 형태로
-- 증상: 로그인 사용자 권한으로 pos_orders(2.6만 행)를 읽는 함수가 3~7초 (홈 "평소 대비" 3초, 발주 추천 7초).
--       서비스롤(RLS 우회)로는 0.2초. 정책의 is_member_of(workplace_id) 가 행마다 memberships/profiles 를 조회한 탓.
-- 수정: workplace_id in (select ... where user_id = (select auth.uid())) 형태 → 플래너가 서브쿼리를 1회만 평가.
--       pos_orders / pos_order_items / pos_sync_log 세 테이블만 (큰 테이블). 권한 의미는 동일(멤버 또는 super_admin).
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

drop policy if exists "pos_orders_select" on pos_orders;
create policy "pos_orders_select" on pos_orders for select using (
  workplace_id in (select m.workplace_id from memberships m where m.user_id = (select auth.uid()) and m.active = true)
  or exists (select 1 from profiles p where p.user_id = (select auth.uid()) and p.is_super_admin = true)
);

drop policy if exists "pos_items_select" on pos_order_items;
create policy "pos_items_select" on pos_order_items for select using (
  workplace_id in (select m.workplace_id from memberships m where m.user_id = (select auth.uid()) and m.active = true)
  or exists (select 1 from profiles p where p.user_id = (select auth.uid()) and p.is_super_admin = true)
);

drop policy if exists "pos_sync_log_select" on pos_sync_log;
create policy "pos_sync_log_select" on pos_sync_log for select using (
  workplace_id in (select m.workplace_id from memberships m where m.user_id = (select auth.uid()) and m.active = true)
  or exists (select 1 from profiles p where p.user_id = (select auth.uid()) and p.is_super_admin = true)
);

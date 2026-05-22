-- ============================================================
-- 20260522_28_staff_full_edit.sql
-- 전 직원 시프트·매출 편집 허용
-- 사유: 소규모 팀 운영에서 직원도 시프트 등록·매출 입력 필요
-- ============================================================

-- ── shifts: staff도 INSERT/UPDATE/DELETE 허용 ─────────────────
-- 기존에는 is_manager_of 이상만 가능했음

drop policy if exists "shifts_insert_manager" on shifts;
drop policy if exists "shifts_update_manager" on shifts;
drop policy if exists "shifts_delete_manager" on shifts;

-- INSERT: 같은 사업장 활성 멤버면 가능
create policy "shifts_insert_member" on shifts
  for insert with check (
    is_super_admin()
    or is_member_of(workplace_id)
  );

-- UPDATE: 결재로 묶이지 않은 시프트만 수정 가능 (결재 묶인 건은 승인 흐름으로만)
create policy "shifts_update_member" on shifts
  for update using (
    is_super_admin()
    or (is_member_of(workplace_id) and approval_request_id is null)
  );

-- DELETE: 결재로 묶이지 않은 시프트만 삭제 가능
create policy "shifts_delete_member" on shifts
  for delete using (
    is_super_admin()
    or (is_member_of(workplace_id) and approval_request_id is null)
  );

-- ── sales_daily: staff도 INSERT/UPDATE/DELETE 허용 ────────────
drop policy if exists "sales_daily_insert_manager" on sales_daily;
drop policy if exists "sales_daily_update_manager" on sales_daily;
drop policy if exists "sales_daily_delete_manager" on sales_daily;

create policy "sales_daily_insert_member" on sales_daily
  for insert with check (
    is_super_admin()
    or is_member_of(workplace_id)
  );

create policy "sales_daily_update_member" on sales_daily
  for update using (
    is_super_admin()
    or is_member_of(workplace_id)
  );

create policy "sales_daily_delete_member" on sales_daily
  for delete using (
    is_super_admin()
    or is_member_of(workplace_id)
  );

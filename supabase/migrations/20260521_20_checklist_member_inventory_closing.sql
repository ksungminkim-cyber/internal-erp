-- ========================================================================
-- 체크리스트 — 직원도 자유 수정 가능
-- + 월별 재고 마감 (inventory_closings)
-- ========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. 체크리스트 권한 완화: manager → member
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "cl_tpl_modify_manager" on checklist_templates;
drop policy if exists "cl_tpl_modify_member" on checklist_templates;
create policy "cl_tpl_modify_member" on checklist_templates
  for all using (is_member_of(workplace_id))
  with check (is_member_of(workplace_id));

drop policy if exists "cl_item_modify_manager" on checklist_items;
drop policy if exists "cl_item_modify_member" on checklist_items;
create policy "cl_item_modify_member" on checklist_items
  for all using (
    exists (select 1 from checklist_templates t
            where t.id = checklist_items.template_id
              and is_member_of(t.workplace_id))
  )
  with check (
    exists (select 1 from checklist_templates t
            where t.id = checklist_items.template_id
              and is_member_of(t.workplace_id))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. 월별 재고 마감 (스냅샷)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists inventory_closings (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  item_count integer not null default 0,
  total_qty_estimate numeric(14, 3),     -- 합계 수량 (단위 다른 경우 참고용)
  low_stock_count integer not null default 0,  -- 임계치 미만 품목 수
  snapshot jsonb,                         -- [{ id, name, category, unit, qty, min_qty, vendor }]
  notes text,
  closed_by uuid references profiles(user_id) on delete set null,
  closed_at timestamptz not null default now(),
  unique (workplace_id, year, month)
);

create index if not exists idx_inv_closings_workplace_period
  on inventory_closings(workplace_id, year desc, month desc);

alter table inventory_closings enable row level security;

drop policy if exists "inv_closings_select" on inventory_closings;
create policy "inv_closings_select" on inventory_closings
  for select using (is_member_of(workplace_id));

-- 사업장 멤버 누구나 마감 가능 (체크리스트와 동일하게 유연)
drop policy if exists "inv_closings_modify" on inventory_closings;
create policy "inv_closings_modify" on inventory_closings
  for all using (is_member_of(workplace_id))
  with check (is_member_of(workplace_id));

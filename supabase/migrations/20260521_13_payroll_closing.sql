-- ========================================================================
-- 인건비 계산 + 월 마감 스냅샷
-- ========================================================================

-- profiles 에 시급 추가 (사업장 무관 공통 — 보통 같은 사람은 같은 시급)
alter table profiles
  add column if not exists hourly_wage numeric(10,2) not null default 0;

-- ─────────────────────────────────────────────────────────────────────────
-- 월 마감 스냅샷
-- 마감을 확정하면 매출/인건비/지출/순익을 그 시점 데이터로 freeze.
-- 마감 후 데이터가 바뀌어도 스냅샷은 유지 (회계 정합성).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists month_closings (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),

  -- 합계
  total_revenue numeric(14,2) not null default 0,
  total_labor   numeric(14,2) not null default 0,
  total_expense numeric(14,2) not null default 0,
  net_profit    numeric(14,2) not null default 0,

  -- 상세 (직원별 인건비 / 카테고리별 지출 / 일별 매출)
  labor_breakdown   jsonb,
  expense_breakdown jsonb,
  revenue_breakdown jsonb,

  notes text,
  locked boolean not null default true,
  closed_by uuid references profiles(user_id) on delete set null,
  closed_at timestamptz not null default now(),

  unique (workplace_id, year, month)
);

create index if not exists idx_closings_workplace_period
  on month_closings(workplace_id, year desc, month desc);

alter table month_closings enable row level security;

drop policy if exists "closings_select_workplace" on month_closings;
create policy "closings_select_workplace" on month_closings
  for select using (is_member_of(workplace_id));

-- 마감 생성/수정/삭제는 owner 또는 super_admin 만
drop policy if exists "closings_modify_owner" on month_closings;
create policy "closings_modify_owner" on month_closings
  for all using (
    is_super_admin()
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
    or exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.workplace_id = month_closings.workplace_id
        and m.active = true
        and m.role = 'owner'
    )
  );

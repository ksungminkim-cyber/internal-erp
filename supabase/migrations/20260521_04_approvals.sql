-- ========================================================================
-- 전자결재 — 지출결의서 (Approvals / Expense Requests)
-- 다단계 결재선, 영수증 첨부, 반려/승인 흐름
-- ========================================================================

-- 결재 문서 (지출결의서를 우선 지원, 향후 휴가신청 등 확장)
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  drafter_id uuid not null references auth.users(id) on delete set null,
  doc_type text not null default 'expense' check (doc_type in ('expense', 'leave', 'general')),
  title text not null,
  body text,
  total_amount numeric(14, 2),
  currency text not null default 'KRW',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  current_step integer not null default 1,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_approval_workplace_status on approval_requests(workplace_id, status, submitted_at desc);
create index if not exists idx_approval_drafter on approval_requests(drafter_id, submitted_at desc);

-- 결재 단계
create table if not exists approval_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references approval_requests(id) on delete cascade,
  step_order integer not null,
  approver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'rejected', 'skipped')),
  comment text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, step_order)
);

create index if not exists idx_steps_approver_waiting on approval_steps(approver_id, status);

-- 지출 항목 (라인 아이템)
create table if not exists expense_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references approval_requests(id) on delete cascade,
  description text not null,
  category text,
  amount numeric(14, 2) not null,
  vendor text,
  created_at timestamptz not null default now()
);

create index if not exists idx_items_request on expense_items(request_id);

-- 영수증 첨부
create table if not exists approval_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references approval_requests(id) on delete cascade,
  file_path text not null,
  file_name text,
  mime_type text,
  size_bytes integer,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_attachments_request on approval_attachments(request_id);

-- ========================================================================
-- 자동 진행 트리거
-- 한 단계가 approved 되면 current_step 증가, 다음 단계가 없으면 문서 최종 승인
-- 단계가 rejected 되면 문서 전체 반려
-- ========================================================================
create or replace function advance_approval()
returns trigger
language plpgsql
security definer
as $$
declare
  next_step integer;
  has_next boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'rejected' then
    update approval_requests
    set status = 'rejected', decided_at = now(), updated_at = now()
    where id = new.request_id;
    new.decided_at := now();
    return new;
  end if;

  if new.status = 'approved' then
    new.decided_at := now();
    next_step := new.step_order + 1;
    select exists (
      select 1 from approval_steps
      where request_id = new.request_id and step_order = next_step
    ) into has_next;

    if has_next then
      update approval_requests
      set current_step = next_step, updated_at = now()
      where id = new.request_id;
    else
      update approval_requests
      set status = 'approved', decided_at = now(), updated_at = now()
      where id = new.request_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_advance_approval on approval_steps;
create trigger trg_advance_approval
  before update on approval_steps
  for each row execute function advance_approval();

-- ========================================================================
-- RLS
-- ========================================================================
alter table approval_requests enable row level security;
alter table approval_steps enable row level security;
alter table expense_items enable row level security;
alter table approval_attachments enable row level security;

-- 같은 사업장 멤버 모두 SELECT (전체 가시화 — 자체 감시 효과)
drop policy if exists "approval_select_workplace" on approval_requests;
create policy "approval_select_workplace" on approval_requests
  for select using (is_member_of(workplace_id));

-- 기안: 본인만 작성
drop policy if exists "approval_insert_self" on approval_requests;
create policy "approval_insert_self" on approval_requests
  for insert with check (
    drafter_id = auth.uid() and is_member_of(workplace_id)
  );

-- 기안자만 자기 pending 문서 취소/수정
drop policy if exists "approval_update_drafter_pending" on approval_requests;
create policy "approval_update_drafter_pending" on approval_requests
  for update using (
    drafter_id = auth.uid() and status = 'pending'
  ) with check (drafter_id = auth.uid());

-- approval_steps: 사업장 멤버 SELECT
drop policy if exists "steps_select_workplace" on approval_steps;
create policy "steps_select_workplace" on approval_steps
  for select using (
    exists (
      select 1 from approval_requests r
      where r.id = approval_steps.request_id and is_member_of(r.workplace_id)
    )
  );

-- 기안 시 결재선 INSERT — 본인이 만든 문서의 단계만
drop policy if exists "steps_insert_drafter" on approval_steps;
create policy "steps_insert_drafter" on approval_steps
  for insert with check (
    exists (
      select 1 from approval_requests r
      where r.id = approval_steps.request_id
        and r.drafter_id = auth.uid()
    )
  );

-- 결재자만 자기 차례에 본인 단계 UPDATE
drop policy if exists "steps_update_approver_current" on approval_steps;
create policy "steps_update_approver_current" on approval_steps
  for update using (
    approver_id = auth.uid()
    and status = 'waiting'
    and exists (
      select 1 from approval_requests r
      where r.id = approval_steps.request_id
        and r.current_step = approval_steps.step_order
        and r.status = 'pending'
    )
  ) with check (approver_id = auth.uid());

-- expense_items: 같은 사업장 SELECT, 기안자만 INSERT/UPDATE/DELETE(pending 중)
drop policy if exists "items_select_workplace" on expense_items;
create policy "items_select_workplace" on expense_items
  for select using (
    exists (
      select 1 from approval_requests r
      where r.id = expense_items.request_id and is_member_of(r.workplace_id)
    )
  );

drop policy if exists "items_modify_drafter" on expense_items;
create policy "items_modify_drafter" on expense_items
  for all using (
    exists (
      select 1 from approval_requests r
      where r.id = expense_items.request_id
        and r.drafter_id = auth.uid()
        and r.status = 'pending'
    )
  ) with check (
    exists (
      select 1 from approval_requests r
      where r.id = expense_items.request_id
        and r.drafter_id = auth.uid()
    )
  );

-- attachments: 동일 정책
drop policy if exists "attach_select_workplace" on approval_attachments;
create policy "attach_select_workplace" on approval_attachments
  for select using (
    exists (
      select 1 from approval_requests r
      where r.id = approval_attachments.request_id and is_member_of(r.workplace_id)
    )
  );

drop policy if exists "attach_modify_drafter" on approval_attachments;
create policy "attach_modify_drafter" on approval_attachments
  for all using (
    exists (
      select 1 from approval_requests r
      where r.id = approval_attachments.request_id
        and r.drafter_id = auth.uid()
        and r.status = 'pending'
    )
  ) with check (uploaded_by = auth.uid());

-- realtime
alter publication supabase_realtime add table approval_requests;
alter publication supabase_realtime add table approval_steps;

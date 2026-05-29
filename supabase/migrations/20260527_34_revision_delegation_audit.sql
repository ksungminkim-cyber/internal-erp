-- ============================================================
-- 결재 재기안 + 결재 위임/대리 + 감사 로그
-- ============================================================

-- ─── 1. 결재 재기안 ───────────────────────────────────────
alter table approval_requests
  add column if not exists revision_of uuid references approval_requests(id) on delete set null,
  add column if not exists revision_count int not null default 0;

create index if not exists idx_approval_revision_of on approval_requests(revision_of);

-- ─── 2. 결재 위임/대리 ───────────────────────────────────
-- 위임: 특정 기간 동안 내 결재 권한을 다른 직원에게 위임
create table if not exists approval_delegations (
  id            bigserial primary key,
  delegator_id  uuid not null references auth.users(id) on delete cascade,
  delegate_id   uuid not null references auth.users(id) on delete cascade,
  workplace_id  uuid references workplaces(id) on delete cascade,
  reason        text,
  start_at      date not null default current_date,
  end_at        date,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (delegator_id <> delegate_id)
);

create index if not exists idx_delegations_delegator on approval_delegations(delegator_id, active);
create index if not exists idx_delegations_delegate  on approval_delegations(delegate_id,  active);

alter table approval_delegations enable row level security;

-- 본인이 위임자/피위임자이거나 관리자만 조회
drop policy if exists "delegations_select" on approval_delegations;
create policy "delegations_select" on approval_delegations
  for select using (
    delegator_id = auth.uid()
    or delegate_id = auth.uid()
    or exists (select 1 from profiles where user_id = auth.uid() and is_super_admin = true)
    or (workplace_id is null or is_manager_of(workplace_id))
  );

-- 본인이 위임자일 때만 생성 가능
drop policy if exists "delegations_insert" on approval_delegations;
create policy "delegations_insert" on approval_delegations
  for insert with check (delegator_id = auth.uid());

drop policy if exists "delegations_update" on approval_delegations;
create policy "delegations_update" on approval_delegations
  for update using (delegator_id = auth.uid())
  with check (delegator_id = auth.uid());

drop policy if exists "delegations_delete" on approval_delegations;
create policy "delegations_delete" on approval_delegations
  for delete using (delegator_id = auth.uid());

-- 활성 위임 조회 helper
create or replace function get_effective_approver(p_step_approver uuid, p_workplace_id uuid)
returns uuid
language sql
stable
as $$
  -- 위임이 활성이면 피위임자 반환, 아니면 본래 결재자
  select coalesce(
    (
      select delegate_id from approval_delegations
      where delegator_id = p_step_approver
        and active = true
        and start_at <= current_date
        and (end_at is null or end_at >= current_date)
        and (workplace_id is null or workplace_id = p_workplace_id)
      order by created_at desc
      limit 1
    ),
    p_step_approver
  );
$$;

-- ─── 3. 감사 로그 ───────────────────────────────────────
create table if not exists audit_logs (
  id            bigserial primary key,
  user_id       uuid references auth.users(id) on delete set null,
  user_email    text,
  action        text not null,                -- 'login', 'update', 'delete', 'insert'
  entity        text not null,                 -- 'profiles', 'approval_requests', 'memberships', ...
  entity_id     text,
  workplace_id  uuid references workplaces(id) on delete set null,
  changes       jsonb,                         -- before/after snapshot for updates
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_audit_logs_user_id    on audit_logs(user_id, created_at desc);
create index if not exists idx_audit_logs_entity     on audit_logs(entity, entity_id, created_at desc);
create index if not exists idx_audit_logs_action     on audit_logs(action, created_at desc);
create index if not exists idx_audit_logs_workplace  on audit_logs(workplace_id, created_at desc);

alter table audit_logs enable row level security;

-- super_admin 또는 owner만 조회
drop policy if exists "audit_logs_select" on audit_logs;
create policy "audit_logs_select" on audit_logs
  for select using (
    exists (select 1 from profiles where user_id = auth.uid() and is_super_admin = true)
    or exists (select 1 from memberships where user_id = auth.uid() and role = 'owner' and active = true)
  );

-- INSERT는 트리거 또는 서비스 롤로만
drop policy if exists "audit_logs_insert" on audit_logs;
create policy "audit_logs_insert" on audit_logs
  for insert with check (true);

-- 트리거 — 핵심 테이블 변경 자동 기록
create or replace function log_audit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_action text;
  v_entity_id text;
  v_workplace uuid;
  v_changes jsonb;
  v_new jsonb;
  v_old jsonb;
begin
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
  v_action := lower(tg_op);

  -- id 컬럼 없는 테이블(profiles=user_id PK) 대응: id 우선, 없으면 user_id
  v_entity_id := coalesce(
    (coalesce(v_new, v_old) ->> 'id'),
    (coalesce(v_new, v_old) ->> 'user_id'),
    ''
  );
  v_workplace := nullif(coalesce(v_new ->> 'workplace_id', v_old ->> 'workplace_id'), '')::uuid;

  if tg_op = 'UPDATE' then
    v_changes := jsonb_build_object('before', v_old, 'after', v_new);
  elsif tg_op = 'INSERT' then
    v_changes := jsonb_build_object('after', v_new);
  else
    v_changes := jsonb_build_object('before', v_old);
  end if;

  insert into audit_logs(user_id, action, entity, entity_id, workplace_id, changes)
  values (auth.uid(), v_action, tg_table_name, v_entity_id, v_workplace, v_changes);

  return coalesce(new, old);
end;
$$;

-- 핵심 테이블에 트리거 적용 (민감 데이터)
drop trigger if exists trg_audit_profiles on profiles;
create trigger trg_audit_profiles
  after insert or update or delete on profiles
  for each row execute function log_audit();

drop trigger if exists trg_audit_memberships on memberships;
create trigger trg_audit_memberships
  after insert or update or delete on memberships
  for each row execute function log_audit();

drop trigger if exists trg_audit_approvals on approval_requests;
create trigger trg_audit_approvals
  after insert or update or delete on approval_requests
  for each row execute function log_audit();

drop trigger if exists trg_audit_month_closings on month_closings;
create trigger trg_audit_month_closings
  after insert or update or delete on month_closings
  for each row execute function log_audit();

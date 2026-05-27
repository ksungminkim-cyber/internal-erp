-- ========================================================================
-- 임원(대표) 권한 분리 — 결재 최종 라인
-- 본사 active owner 멤버십을 가진 사용자만 profiles.is_executive = true
-- 본사 매니저/직원은 super_admin (모든 매장 owner) 유지 — 매장 관리 권한
-- 본사 대표만 결재선 마지막 단계로 지정 가능 — 최종 승인 권한
-- ========================================================================

alter table profiles
  add column if not exists is_executive boolean not null default false;

-- 본사 owner 멤버십 ↔ is_executive 동기화
create or replace function sync_hq_executive()
returns trigger language plpgsql security definer as $$
declare
  hq_id uuid;
  target_user uuid;
  is_hq_owner boolean;
begin
  select id into hq_id from workplaces where name = '본사' limit 1;
  if hq_id is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    target_user := old.user_id;
  else
    target_user := new.user_id;
  end if;

  is_hq_owner := exists (
    select 1 from memberships
    where user_id = target_user
      and workplace_id = hq_id
      and role = 'owner'
      and active = true
  );

  update profiles
  set is_executive = is_hq_owner, updated_at = now()
  where user_id = target_user
    and is_executive is distinct from is_hq_owner;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_executive on memberships;
create trigger trg_hq_executive
  after insert or update or delete on memberships
  for each row execute function sync_hq_executive();

-- 백필
update profiles p
set is_executive = exists (
  select 1 from memberships m
  join workplaces w on w.id = m.workplace_id
  where m.user_id = p.user_id
    and w.name = '본사'
    and m.role = 'owner'
    and m.active = true
);

-- 현재 사용자가 임원인지
create or replace function is_executive()
returns boolean
language sql security definer stable
as $$
  select coalesce((select is_executive from profiles where user_id = auth.uid()), false);
$$;

-- ------------------------------------------------------------------------
-- 결재선 마지막 단계 = 임원 강제
-- 작성자 본인이 임원이면 면제 (자기 결재이므로 어차피 본인 권한)
-- DEFERRABLE — 다단계 결재선 INSERT 가 끝난 후 COMMIT 시점에 검증
-- ------------------------------------------------------------------------
create or replace function enforce_approval_final_executive()
returns trigger language plpgsql security definer as $$
declare
  drafter_is_exec boolean;
  final_approver uuid;
  final_is_exec boolean;
begin
  select coalesce(p.is_executive, false) into drafter_is_exec
  from approval_requests r
  left join profiles p on p.user_id = r.drafter_id
  where r.id = new.request_id;

  if drafter_is_exec then
    return new;
  end if;

  select s.approver_id into final_approver
  from approval_steps s
  where s.request_id = new.request_id
  order by s.step_order desc
  limit 1;

  if final_approver is null then
    return new;
  end if;

  select coalesce(is_executive, false) into final_is_exec
  from profiles where user_id = final_approver;

  if not coalesce(final_is_exec, false) then
    raise exception '결재선의 마지막 단계는 임원(본사 대표)이어야 합니다. 임원을 결재선 마지막에 추가해주세요.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_approval_final_executive on approval_steps;
create constraint trigger trg_approval_final_executive
  after insert on approval_steps
  deferrable initially deferred
  for each row execute function enforce_approval_final_executive();

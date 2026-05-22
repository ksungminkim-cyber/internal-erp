-- ========================================================================
-- 25 + 26 통합 마이그레이션 (SQL Editor에서 이 파일 하나만 실행)
--
-- 확정 역할 구조:
--   본사: owner(대표·임원) / manager(본사 관리자) / staff(본사 직원)
--   나울·녹턴: manager(매니저) / staff(직원) — owner 없음
--
-- profiles 컬럼:
--   is_super_admin  : 본사 소속 여부 (모든 매장 데이터 접근)
--   hq_role         : 본사 내 원래 역할 (owner/manager/staff)
--   is_executive    : 임원 여부 (본사 owner만 true → 결재 최종 승인 가능)
-- ========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. 컬럼 추가
-- ─────────────────────────────────────────────────────────────────────────
alter table profiles
  add column if not exists is_executive boolean not null default false;

alter table profiles
  add column if not exists hq_role text
    check (hq_role in ('owner', 'manager', 'staff'));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. sync_hq_super_admin: 본사 멤버 → is_super_admin=true + hq_role 동기화
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sync_hq_super_admin()
returns trigger language plpgsql security definer as $$
declare
  hq_id       uuid;
  target_user uuid;
  best_role   text;
begin
  select id into hq_id from workplaces where name = '본사' limit 1;
  if hq_id is null then return coalesce(new, old); end if;

  target_user := case tg_op when 'DELETE' then old.user_id else new.user_id end;

  select role into best_role
  from memberships
  where user_id    = target_user
    and workplace_id = hq_id
    and active     = true
  order by case role when 'owner' then 1 when 'manager' then 2 else 3 end
  limit 1;

  if best_role is not null then
    update profiles
    set is_super_admin = true,
        hq_role        = best_role,
        updated_at     = now()
    where user_id = target_user;
  else
    update profiles
    set hq_role    = null,
        updated_at = now()
    where user_id = target_user;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_membership on memberships;
create trigger trg_hq_membership
  after insert or update or delete on memberships
  for each row execute function sync_hq_super_admin();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. sync_super_admin_memberships: 본사 대표(hq_role='owner')만
--    전체 사업장 manager 멤버십 자동 부여
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sync_super_admin_memberships()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(new.hq_role, '') = 'owner'
     and coalesce(old.hq_role, '') <> 'owner' then
    insert into memberships (user_id, workplace_id, role, active)
    select new.user_id, w.id, 'manager', true
    from workplaces w
    on conflict (user_id, workplace_id) do update
      set active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profile_super_admin on profiles;
create trigger trg_profile_super_admin
  after update of hq_role on profiles
  for each row execute function sync_super_admin_memberships();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. sync_hq_executive: 본사 owner만 is_executive=true
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sync_hq_executive()
returns trigger language plpgsql security definer as $$
declare
  hq_id        uuid;
  target_user  uuid;
  is_hq_owner  boolean;
begin
  select id into hq_id from workplaces where name = '본사' limit 1;
  if hq_id is null then return coalesce(new, old); end if;

  target_user := case tg_op when 'DELETE' then old.user_id else new.user_id end;

  is_hq_owner := exists (
    select 1 from memberships
    where user_id      = target_user
      and workplace_id = hq_id
      and role         = 'owner'
      and active       = true
  );

  update profiles
  set is_executive = is_hq_owner,
      updated_at   = now()
  where user_id = target_user
    and is_executive is distinct from is_hq_owner;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_executive on memberships;
create trigger trg_hq_executive
  after insert or update or delete on memberships
  for each row execute function sync_hq_executive();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. is_executive() 헬퍼 함수
-- ─────────────────────────────────────────────────────────────────────────
create or replace function is_executive()
returns boolean language sql security definer stable as $$
  select coalesce((select is_executive from profiles where user_id = auth.uid()), false);
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. 결재선 최종 단계 = 임원 강제 트리거
-- ─────────────────────────────────────────────────────────────────────────
create or replace function enforce_approval_final_executive()
returns trigger language plpgsql security definer as $$
declare
  drafter_is_exec boolean;
  final_approver  uuid;
  final_is_exec   boolean;
begin
  select coalesce(p.is_executive, false) into drafter_is_exec
  from approval_requests r
  left join profiles p on p.user_id = r.drafter_id
  where r.id = new.request_id;

  if drafter_is_exec then return new; end if;

  select s.approver_id into final_approver
  from approval_steps s
  where s.request_id = new.request_id
  order by s.step_order desc
  limit 1;

  if final_approver is null then return new; end if;

  select coalesce(is_executive, false) into final_is_exec
  from profiles where user_id = final_approver;

  if not coalesce(final_is_exec, false) then
    raise exception '결재선의 마지막 단계는 임원(본사 대표)이어야 합니다.'
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

-- ─────────────────────────────────────────────────────────────────────────
-- 7. 백필
-- ─────────────────────────────────────────────────────────────────────────

-- hq_role 채우기
update profiles p
set hq_role = (
  select m.role
  from memberships m
  join workplaces w on w.id = m.workplace_id
  where m.user_id  = p.user_id
    and w.name     = '본사'
    and m.active   = true
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end
  limit 1
);

-- 나울·녹턴에서 is_super_admin 사용자의 owner 멤버십 → manager 로 교정
-- (본사 대표는 제외, 본사 workplace 자체도 제외)
update memberships m
set role = 'manager'
from profiles p, workplaces w
where m.user_id      = p.user_id
  and m.workplace_id = w.id
  and m.role         = 'owner'
  and m.active       = true
  and w.name        <> '본사'
  and p.is_super_admin = true
  and coalesce(p.hq_role, '') <> 'owner';

-- is_executive 재계산: 본사 owner만 true
update profiles p
set is_executive = exists (
  select 1
  from memberships m
  join workplaces w on w.id = m.workplace_id
  where m.user_id  = p.user_id
    and w.name     = '본사'
    and m.role     = 'owner'
    and m.active   = true
);

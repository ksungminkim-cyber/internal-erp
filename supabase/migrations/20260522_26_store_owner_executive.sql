-- ========================================================================
-- 26. 역할 시스템 정리
--
-- 확정된 구조:
--   본사: owner(대표·임원) / manager(본사 관리자) / staff(본사 직원)
--   나울·녹턴: manager(매니저) / staff(직원) — owner 없음
--
-- 변경 내용:
--   A. profiles.hq_role: 본사 원래 역할 추적 (owner/manager/staff)
--   B. sync_hq_super_admin: hq_role 동시 동기화
--   C. sync_super_admin_memberships: hq_role='owner'(본사 대표)만
--      전체 사업장 manager 멤버십 자동 부여 (owner → manager로 변경)
--      본사 매니저/직원은 is_super_admin=true 로 RLS 접근만 유지
--   D. sync_hq_executive: 본사 owner만 is_executive=true (원래 설계 유지)
--   E. 백필: 기존 auto-assigned owner 멤버십 정리
-- ========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- A. 본사 역할 추적 컬럼
-- ─────────────────────────────────────────────────────────────────────────
alter table profiles
  add column if not exists hq_role text
    check (hq_role in ('owner', 'manager', 'staff'));

-- ─────────────────────────────────────────────────────────────────────────
-- B. sync_hq_super_admin: hq_role 동시 동기화
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

  -- 본사 active 멤버십 중 최상위 역할 (owner > manager > staff)
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
    -- 본사에서 제거: hq_role null (is_super_admin은 수동 유지 가능)
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
-- C. sync_super_admin_memberships: 본사 대표(hq_role='owner')만
--    전체 사업장에 manager 멤버십 자동 부여
--    (나울·녹턴에 owner 역할 불필요 — 접근 권한은 is_super_admin RLS로 처리)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sync_super_admin_memberships()
returns trigger language plpgsql security definer as $$
begin
  -- hq_role이 owner가 된 경우 전 사업장 manager 자동 배정
  if coalesce(new.hq_role, '') = 'owner'
     and coalesce(old.hq_role, '') <> 'owner' then
    insert into memberships (user_id, workplace_id, role, active)
    select new.user_id, w.id, 'manager', true
    from workplaces w
    on conflict (user_id, workplace_id) do update
      set active = true;
      -- role은 덮어쓰지 않음 (본사 = owner 유지)
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profile_super_admin on profiles;
create trigger trg_profile_super_admin
  after update of hq_role on profiles
  for each row execute function sync_super_admin_memberships();

-- ─────────────────────────────────────────────────────────────────────────
-- D. sync_hq_executive: 본사 owner만 is_executive=true (원래 설계)
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

create or replace function is_executive()
returns boolean language sql security definer stable as $$
  select coalesce((select is_executive from profiles where user_id = auth.uid()), false);
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- E. 백필
-- ─────────────────────────────────────────────────────────────────────────

-- 1) hq_role 채우기
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

-- 2) 나울·녹턴에서 is_super_admin 사용자의 owner 멤버십 → role을 manager로 교정
--    (본사 workplace 자체는 건드리지 않음)
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

-- 3) is_executive 재계산: 본사 owner만 true
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

-- 4) enforce_approval_final_executive 트리거: 기안자 본인이 임원이면 면제 그대로 유지
--    나울·녹턴 매니저가 기안 → 본사 대표(임원)가 최종 결재 구조 유지됨

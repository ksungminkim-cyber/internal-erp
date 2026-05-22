-- ========================================================================
-- 26. 나울·녹턴 대표 = 임원(is_executive) 동일 처리
--     + 본사 관리자(매니저/직원)와 본사 대표 역할 분리
--
-- 문제:
--   ① sync_hq_executive 가 본사 owner 만 체크 → 나울/녹턴 대표 is_executive=false
--   ② sync_super_admin_memberships 가 본사 매니저에게도 전 사업장 owner 자동 부여
--      → 본사 매니저도 is_executive=true 가 되어 '본사 관리자' 라벨이 나타나지 않음
--
-- 해결:
--   A. profiles.hq_role 컬럼으로 본사 내 원래 역할(owner/manager/staff) 추적
--   B. sync_hq_super_admin 에서 hq_role 함께 동기화
--   C. sync_super_admin_memberships 를 hq_role='owner' 일 때만 전 사업장 owner 자동 부여로 변경
--   D. sync_hq_executive 를 모든 사업장 owner 보유 여부로 변경
--   E. 기존 데이터 백필
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

  -- 본사 active 멤버십 중 가장 높은 역할 선택 (owner > manager > staff)
  select role into best_role
  from memberships
  where user_id = target_user
    and workplace_id = hq_id
    and active = true
  order by case role when 'owner' then 1 when 'manager' then 2 else 3 end
  limit 1;

  if best_role is not null then
    -- 본사 소속: super_admin=true, hq_role 갱신
    update profiles
    set is_super_admin = true,
        hq_role        = best_role,
        updated_at     = now()
    where user_id = target_user;
  else
    -- 본사에서 제거: hq_role null (is_super_admin 은 수동 유지 가능)
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
-- C. sync_super_admin_memberships: 본사 대표(hq_role='owner')만 전 사업장 owner 자동 부여
--    본사 매니저/직원은 is_super_admin=true 로 데이터 접근은 유지하되 owner 자동 부여 안 함
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sync_super_admin_memberships()
returns trigger language plpgsql security definer as $$
begin
  -- hq_role 이 owner 로 바뀔 때만 전 사업장 owner 멤버십 생성
  if coalesce(new.hq_role, '') = 'owner'
     and coalesce(old.hq_role, '') <> 'owner' then
    insert into memberships (user_id, workplace_id, role, active)
    select new.user_id, w.id, 'owner', true
    from workplaces w
    on conflict (user_id, workplace_id) do update
      set role = 'owner', active = true;
  end if;
  return new;
end;
$$;

-- 트리거: is_super_admin 대신 hq_role 변경 시 발동
drop trigger if exists trg_profile_super_admin on profiles;
create trigger trg_profile_super_admin
  after update of hq_role on profiles
  for each row execute function sync_super_admin_memberships();

-- ─────────────────────────────────────────────────────────────────────────
-- D. sync_hq_executive: 모든 사업장(본사·나울·녹턴) owner 보유 시 is_executive=true
-- ─────────────────────────────────────────────────────────────────────────
create or replace function sync_hq_executive()
returns trigger language plpgsql security definer as $$
declare
  target_user  uuid;
  is_any_owner boolean;
begin
  target_user := case tg_op when 'DELETE' then old.user_id else new.user_id end;

  is_any_owner := exists (
    select 1 from memberships
    where user_id = target_user
      and role    = 'owner'
      and active  = true
  );

  update profiles
  set is_executive = is_any_owner,
      updated_at   = now()
  where user_id = target_user
    and is_executive is distinct from is_any_owner;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_executive on memberships;
create trigger trg_hq_executive
  after insert or update or delete on memberships
  for each row execute function sync_hq_executive();

-- is_executive() 헬퍼 함수 (RLS 등 재사용)
create or replace function is_executive()
returns boolean language sql security definer stable as $$
  select coalesce((select is_executive from profiles where user_id = auth.uid()), false);
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- E. 백필
-- ─────────────────────────────────────────────────────────────────────────

-- 1) hq_role: 본사 멤버십 역할로 채우기
update profiles p
set hq_role = (
  select m.role
  from memberships m
  join workplaces w on w.id = m.workplace_id
  where m.user_id = p.user_id
    and w.name   = '본사'
    and m.active = true
  order by case m.role when 'owner' then 1 when 'manager' then 2 else 3 end
  limit 1
);

-- 2) 본사 대표가 아닌 is_super_admin 사용자의 나울·녹턴 auto-owner 멤버십을 manager로 다운그레이드
--    (본사 owner 인 경우·본사 workplace 자체는 제외)
update memberships m
set role = 'manager'
from profiles p, workplaces w
where m.user_id      = p.user_id
  and m.workplace_id = w.id
  and m.role         = 'owner'
  and m.active       = true
  and w.name        <> '본사'
  and p.is_super_admin = true
  and coalesce(p.hq_role, '') <> 'owner';  -- 본사 대표 제외

-- 3) is_executive: 모든 사업장 owner 여부로 재계산
update profiles p
set is_executive = exists (
  select 1 from memberships m
  where m.user_id = p.user_id
    and m.role   = 'owner'
    and m.active = true
);

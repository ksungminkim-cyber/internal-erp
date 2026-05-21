-- ========================================================================
-- super_admin (대표/총괄)
-- 이 플래그가 켜진 사용자는 모든 사업장에 자동으로 owner 멤버십 부여
-- 새 사업장이 추가되어도 자동으로 멤버십 생성됨
-- ========================================================================

alter table profiles
  add column if not exists is_super_admin boolean not null default false;

-- ------------------------------------------------------------------------
-- 새 사업장 INSERT 시 → 모든 super_admin 에게 owner 멤버십 자동 부여
-- ------------------------------------------------------------------------
create or replace function add_super_admin_memberships_on_workplace()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into memberships (user_id, workplace_id, role, active)
  select p.user_id, new.id, 'owner', true
  from profiles p
  where p.is_super_admin = true
  on conflict (user_id, workplace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_workplace_super_admins on workplaces;
create trigger trg_workplace_super_admins
  after insert on workplaces
  for each row execute function add_super_admin_memberships_on_workplace();

-- ------------------------------------------------------------------------
-- profiles.is_super_admin 이 true 로 변경되면 → 모든 사업장 owner 멤버십 자동 생성
-- false 로 변경되면 → super_admin 으로 자동 생성됐던 멤버십 제거(active=false)
-- ------------------------------------------------------------------------
create or replace function sync_super_admin_memberships()
returns trigger
language plpgsql
security definer
as $$
begin
  if coalesce(new.is_super_admin, false) = true
     and coalesce(old.is_super_admin, false) = false then
    insert into memberships (user_id, workplace_id, role, active)
    select new.user_id, w.id, 'owner', true
    from workplaces w
    on conflict (user_id, workplace_id) do update
      set role = 'owner', active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profile_super_admin on profiles;
create trigger trg_profile_super_admin
  after update of is_super_admin on profiles
  for each row execute function sync_super_admin_memberships();

-- ------------------------------------------------------------------------
-- 기존 super_admin 사용자가 있다면 일괄 동기화 (이번이 처음이라 보통은 비어있음)
-- ------------------------------------------------------------------------
insert into memberships (user_id, workplace_id, role, active)
select p.user_id, w.id, 'owner', true
from profiles p
cross join workplaces w
where p.is_super_admin = true
on conflict (user_id, workplace_id) do update
  set role = 'owner', active = true;

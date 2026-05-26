-- ============================================================
-- 본사 멤버십 활성화 시 is_super_admin 자동 부여 트리거
-- ============================================================

-- 트리거 함수: 본사 workplace에 active=true로 배정되면 is_super_admin = true
create or replace function sync_super_admin_from_hq()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.active = true then
    update profiles
    set
      is_super_admin = true,
      updated_at     = now()
    where user_id = new.user_id
      and exists (
        select 1 from workplaces
        where id   = new.workplace_id
          and name = '본사'
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hq_super_admin on memberships;
create trigger trg_hq_super_admin
  after insert or update of active on memberships
  for each row execute function sync_super_admin_from_hq();

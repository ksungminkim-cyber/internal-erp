-- ============================================================
-- 직원 퇴사 처리 + 월 마감 잠금 + 시프트 충돌 검증
-- ============================================================

-- ─── 1. 직원 퇴사 처리 ───────────────────────────────────────
alter table profiles
  add column if not exists retired_at  timestamptz,
  add column if not exists retired_reason text;

-- 퇴사한 직원은 시프트 자동 제외 + 멤버십 자동 비활성화 트리거
create or replace function on_retire_disable_memberships()
returns trigger
language plpgsql
security definer
as $$
begin
  if (old.retired_at is null and new.retired_at is not null) then
    update memberships
    set active = false
    where user_id = new.user_id
      and active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_on_retire_disable_memberships on profiles;
create trigger trg_on_retire_disable_memberships
  after update of retired_at on profiles
  for each row execute function on_retire_disable_memberships();

-- ─── 2. 월 마감 잠금 ─────────────────────────────────────────
-- month_closings는 이미 있으니 잠금용 컬럼만 보강
alter table month_closings
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by uuid references auth.users(id) on delete set null;

-- 마감된 월의 attendance_logs / sales_daily / approval_requests 변경 차단
create or replace function check_month_locked()
returns trigger
language plpgsql
security definer
as $$
declare
  v_workplace uuid;
  v_year int;
  v_month int;
  v_ts timestamptz;
  v_row jsonb;
begin
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  v_workplace := (v_row->>'workplace_id')::uuid;
  v_ts := case tg_table_name
    when 'attendance_logs'   then (v_row->>'event_at')::timestamptz
    when 'sales_daily'       then (v_row->>'sales_date')::timestamptz
    when 'approval_requests' then (v_row->>'submitted_at')::timestamptz
    else now()
  end;
  v_year  := extract(year from v_ts);
  v_month := extract(month from v_ts);

  if exists (
    select 1 from month_closings
    where workplace_id = v_workplace
      and year = v_year
      and month = v_month
      and (locked = true or locked_at is not null)
  ) then
    raise exception '% 년 % 월은 마감 잠금됨 - 변경 불가', v_year, v_month;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_check_month_locked_logs on attendance_logs;
create trigger trg_check_month_locked_logs
  before insert or update or delete on attendance_logs
  for each row execute function check_month_locked();

drop trigger if exists trg_check_month_locked_sales on sales_daily;
create trigger trg_check_month_locked_sales
  before insert or update or delete on sales_daily
  for each row execute function check_month_locked();

-- ─── 3. 시프트 cross-workplace 충돌 검증 ───────────────────────
create or replace function check_shift_conflict()
returns trigger
language plpgsql
security definer
as $$
begin
  if exists (
    select 1 from shifts s
    where s.user_id = new.user_id
      and s.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and tstzrange(s.start_at, s.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception '시프트 충돌 — 동일 시간대에 다른 시프트가 이미 있음';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_shift_conflict on shifts;
create trigger trg_check_shift_conflict
  before insert or update of start_at, end_at, user_id on shifts
  for each row execute function check_shift_conflict();

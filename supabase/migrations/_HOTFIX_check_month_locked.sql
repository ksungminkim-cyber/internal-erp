-- ============================================================================
-- 핫픽스 — check_month_locked 트리거 함수 (출근/퇴근 오류 fix)
-- ============================================================================
-- 증상: 출근/퇴근 누를 때 "record new has no field sales_date" 오류
-- 원인: PL/pgSQL이 CASE 모든 분기를 컴파일 타임에 검증해서
--       attendance_logs 트리거에서 new.sales_date 참조하면 에러
-- 해결: jsonb로 캐스팅해 동적 컬럼 참조
--
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- (3초 안에 적용됨, 추가 작업 없음)
-- ============================================================================

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

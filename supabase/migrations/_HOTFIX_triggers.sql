-- ============================================================================
-- 핫픽스 — 트리거 함수 2개 교체 (출퇴근 + 직원배정 오류 해결)
-- ============================================================================
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run (3초)
--
-- 증상1: 출근/퇴근 시 "record new has no field sales_date"
-- 증상2: 직원 배정 수정 저장 시 Server Components 에러
-- 원인: PL/pgSQL이 CASE/필드를 컴파일 타임에 검증 →
--       해당 컬럼 없는 테이블(attendance_logs엔 sales_date 없음,
--       profiles엔 id 없음=user_id PK)에서 트리거 실행 시 에러
-- 해결: to_jsonb로 동적 키 추출 (없는 컬럼은 null)
-- ============================================================================

-- ① 월 마감 잠금 체크 트리거
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

-- ② 감사 로그 트리거 (profiles는 id 없음 → user_id fallback)
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

-- ========================================================================
-- 운영 효율 묶음 (2026-10-20)
--  1) 재고 실사: inventory_items.last_counted_at
--  2) 발주 → 입고 연결: expense_items.inventory_item_id/qty, approval_requests.received_at/by (기존 승인 문서는 백필)
--  3) 모니터링: monitor_alerts(중복 억제) + monitor_pos_health()(동기화 중단·주문 끊김, 30분) + monitor_sales_drop()(매출 급감, KST 23:40)
--     + sales_vs_usual() (홈 "평소 대비") + inventory_idle_items() (장기 미사용)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

-- 1) 실사 시각
alter table inventory_items add column if not exists last_counted_at timestamptz;
comment on column inventory_items.last_counted_at is '마지막 재고 실사(세기) 시각';

-- 2) 입고 연결
alter table expense_items
  add column if not exists inventory_item_id uuid references inventory_items(id) on delete set null,
  add column if not exists qty numeric(14,3);
comment on column expense_items.inventory_item_id is '발주 라인이 가리키는 재고 품목 (입고 확인 시 restock)';
comment on column expense_items.qty is '발주 수량 (세는 단위)';

alter table approval_requests
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references profiles(user_id) on delete set null;
comment on column approval_requests.received_at is '입고 확인(또는 재고 아님 처리) 시각 — null 이면 입고 대기';

-- 기존 승인 문서가 전부 "입고 대기"로 쏟아지지 않도록
update approval_requests set received_at = decided_at
 where doc_type = 'expense' and status = 'approved' and received_at is null;

create index if not exists idx_approval_inbound_pending
  on approval_requests(workplace_id, decided_at desc)
  where doc_type = 'expense' and status = 'approved' and received_at is null;

-- 3) 모니터링 — 중복 억제 기록
create table if not exists monitor_alerts (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  kind text not null,                      -- 'sync_stale' | 'quiet_hours' | 'sales_drop'
  fired_at timestamptz not null default now(),
  detail jsonb
);
create index if not exists idx_monitor_alerts_wp_kind on monitor_alerts(workplace_id, kind, fired_at desc);
alter table monitor_alerts enable row level security;   -- 함수(security definer)만 쓴다

-- 수신자: 본사 멤버 (+ 옵션으로 해당 매장 manager/owner)
create or replace function monitor_recipients(p_workplace_id uuid, p_include_managers boolean)
returns setof uuid
language sql stable
set search_path = public as $$
  select distinct m.user_id
  from memberships m
  join workplaces w on w.id = m.workplace_id
  where m.active = true
    and (w.name = '본사'
         or (p_include_managers and m.workplace_id = p_workplace_id and m.role in ('manager', 'owner')))
$$;

-- 알림 발송 + 중복 억제 (같은 매장·종류는 p_cooldown 안에 한 번만)
create or replace function monitor_fire(p_workplace_id uuid, p_kind text, p_cooldown interval,
                                        p_include_managers boolean, p_title text, p_body text, p_link text, p_detail jsonb)
returns boolean
language plpgsql
set search_path = public as $$
begin
  if exists (select 1 from monitor_alerts
              where workplace_id = p_workplace_id and kind = p_kind and fired_at > now() - p_cooldown) then
    return false;
  end if;
  insert into monitor_alerts (workplace_id, kind, detail) values (p_workplace_id, p_kind, p_detail);
  insert into notifications (user_id, type, title, body, link)
  select u, 'monitor_' || p_kind, p_title, p_body, p_link
  from monitor_recipients(p_workplace_id, p_include_managers) u;
  return true;
end;
$$;

-- 3-a) 동기화 중단 + 주문 끊김 (30분마다)
create or replace function monitor_pos_health()
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  w record;
  v_last timestamptz;
  v_err text;
  v_now_kst timestamp := now() at time zone 'Asia/Seoul';
  v_dow int := extract(dow from (now() at time zone 'Asia/Seoul'))::int;
  v_hour int := extract(hour from (now() at time zone 'Asia/Seoul'))::int;
  v_avg numeric;
  v_recent int;
  n integer := 0;
begin
  for w in select id, name from workplaces where pos_store_code is not null loop
    -- 마지막 동기화
    select finished_at, error into v_last, v_err
      from pos_sync_log where workplace_id = w.id order by started_at desc limit 1;
    if v_last is null or v_last < now() - interval '40 minutes' or v_err is not null then
      if monitor_fire(w.id, 'sync_stale', interval '6 hours', false,
           '포스 동기화 중단',
           w.name || ' · ' || case when v_last is null then '동기화 기록 없음'
                                   when v_err is not null then '오류: ' || left(v_err, 80)
                                   else '마지막 동기화 ' || extract(epoch from (now() - v_last))::int / 60 || '분 전' end,
           '/sales',
           jsonb_build_object('last', v_last, 'error', v_err)) then n := n + 1; end if;
    end if;

    -- 주문 끊김: 최근 4주 같은 요일·같은 시(hour) 평균 주문 ≥ 2건인데 최근 60분 주문 0건
    select coalesce(avg(c), 0) into v_avg from (
      select d, count(o.id) as c
      from generate_series(1, 4) g
      cross join lateral (select ((now() at time zone 'Asia/Seoul')::date - 7 * g) as d) dd
      left join pos_orders o on o.workplace_id = w.id and o.order_state = 'COMPLETED'
        and o.completed_at >= (dd.d + make_interval(hours => v_hour))::timestamp at time zone 'Asia/Seoul'
        and o.completed_at <  (dd.d + make_interval(hours => v_hour + 1))::timestamp at time zone 'Asia/Seoul'
      group by d
    ) x;
    select count(*) into v_recent from pos_orders
      where workplace_id = w.id and order_state = 'COMPLETED' and completed_at >= now() - interval '60 minutes';
    if v_avg >= 2 and v_recent = 0 then
      if monitor_fire(w.id, 'quiet_hours', interval '3 hours', true,
           '주문이 끊겼어요',
           w.name || ' · 평소 이 시간대 ' || round(v_avg, 1) || '건인데 최근 1시간 주문 0건. 포스·네트워크를 확인해 주세요.',
           '/sales',
           jsonb_build_object('avg', v_avg, 'hour', v_hour, 'dow', v_dow)) then n := n + 1; end if;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function monitor_pos_health() from public, anon, authenticated;

-- 평소(같은 요일 최근 4주, 오늘 제외, 매출 0 인 날 제외) 대비 오늘 매출
create or replace function sales_vs_usual(p_workplace_id uuid)
returns table (today_total numeric, usual_avg numeric, pct numeric)
language sql stable security invoker
set search_path = public as $$
  with p as (select (now() at time zone 'Asia/Seoul')::date as today),
  t as (
    select coalesce(sum(total_amount), 0) as v from sales_daily, p
    where workplace_id = p_workplace_id and sales_date = p.today
  ),
  u as (
    select avg(total_amount) as v from sales_daily, p
    where workplace_id = p_workplace_id
      and sales_date in (p.today - 7, p.today - 14, p.today - 21, p.today - 28)
      and total_amount > 0
  )
  select t.v, coalesce(u.v, 0),
         case when coalesce(u.v, 0) > 0 then round((t.v - u.v) / u.v * 100) else null end
  from t, u;
$$;
revoke execute on function sales_vs_usual(uuid) from public, anon;
grant execute on function sales_vs_usual(uuid) to authenticated, service_role;

-- 3-b) 매출 급감 (하루 1회, KST 23:40): 평소 대비 −30% 이하
create or replace function monitor_sales_drop()
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  w record; r record; n integer := 0;
begin
  for w in select id, name from workplaces where pos_store_code is not null loop
    select * into r from sales_vs_usual(w.id);
    if r.pct is not null and r.pct <= -30 then
      if monitor_fire(w.id, 'sales_drop', interval '20 hours', true,
           '오늘 매출이 평소보다 낮아요',
           w.name || ' · 오늘 ' || to_char(r.today_total, 'FM999,999,999') || '원, 같은 요일 평균 '
             || to_char(r.usual_avg, 'FM999,999,999') || '원 (' || r.pct || '%)',
           '/sales',
           jsonb_build_object('today', r.today_total, 'usual', r.usual_avg, 'pct', r.pct)) then n := n + 1; end if;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function monitor_sales_drop() from public, anon, authenticated;

-- 장기 미사용: p_days 동안 재고 거래(자동 차감 포함)가 없는 품목
create or replace function inventory_idle_items(p_workplace_id uuid, p_days integer default 30)
returns table (inventory_item_id uuid, last_tx_at timestamptz)
language sql stable security invoker
set search_path = public as $$
  select i.id, max(t.created_at)
  from inventory_items i
  left join inventory_transactions t on t.item_id = i.id
  where i.workplace_id = p_workplace_id and i.archived = false
  group by i.id
  having max(t.created_at) is null or max(t.created_at) < now() - make_interval(days => p_days);
$$;
revoke execute on function inventory_idle_items(uuid, integer) from public, anon;
grant execute on function inventory_idle_items(uuid, integer) to authenticated, service_role;

-- cron (pg_cron 내부 SQL — HTTP 호출 없음)
select cron.unschedule(jobid) from cron.job where jobname in ('monitor-pos-30m', 'monitor-sales-daily');
select cron.schedule('monitor-pos-30m', '*/30 * * * *', $$ select monitor_pos_health(); $$);
select cron.schedule('monitor-sales-daily', '40 14 * * *', $$ select monitor_sales_drop(); $$);

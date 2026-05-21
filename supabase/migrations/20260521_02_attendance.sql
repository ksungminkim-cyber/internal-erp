-- ========================================================================
-- 근태 (Attendance)
-- 출/퇴근/휴게 이벤트 로그 — 단순 append-only
-- ========================================================================

create table if not exists attendance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  event_type text not null check (event_type in ('clock_in', 'clock_out', 'break_start', 'break_end')),
  event_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_user_date on attendance_logs(user_id, event_at desc);
create index if not exists idx_attendance_workplace_date on attendance_logs(workplace_id, event_at desc);

-- ========================================================================
-- 뷰: 현재 매장 상태 (각 사용자의 가장 최근 이벤트 기반)
-- ========================================================================
create or replace view attendance_current_status as
with latest as (
  select distinct on (user_id, workplace_id)
    user_id,
    workplace_id,
    event_type,
    event_at
  from attendance_logs
  where event_at >= now() - interval '24 hours'
  order by user_id, workplace_id, event_at desc
)
select
  l.user_id,
  l.workplace_id,
  l.event_type,
  l.event_at,
  case
    when l.event_type = 'clock_in' then 'working'
    when l.event_type = 'break_start' then 'on_break'
    when l.event_type = 'break_end' then 'working'
    when l.event_type = 'clock_out' then 'off'
    else 'off'
  end as status,
  p.name,
  p.avatar_url
from latest l
left join profiles p on p.user_id = l.user_id;

-- ========================================================================
-- RLS
-- ========================================================================
alter table attendance_logs enable row level security;

-- 본인 + 같은 사업장 동료 기록 조회 가능 (자체 감시 효과)
drop policy if exists "attendance_select_workplace" on attendance_logs;
create policy "attendance_select_workplace" on attendance_logs
  for select using (is_member_of(workplace_id));

-- 본인 기록만 작성 가능
drop policy if exists "attendance_insert_self" on attendance_logs;
create policy "attendance_insert_self" on attendance_logs
  for insert with check (
    user_id = auth.uid()
    and is_member_of(workplace_id)
  );

-- 본인 기록만 수정/삭제 (note 수정용)
drop policy if exists "attendance_update_self" on attendance_logs;
create policy "attendance_update_self" on attendance_logs
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- realtime publication
alter publication supabase_realtime add table attendance_logs;

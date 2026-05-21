-- ========================================================================
-- 알림 (in-app notifications)
-- 결재 승인/반려, 새 결재 도착, 건의 응답, 공지 등록 등
-- ========================================================================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  type text not null,                    -- 'approval_decided', 'approval_assigned', 'suggestion_response', 'announcement_new'
  title text not null,
  body text,
  link text,                             -- 클릭 시 이동할 경로
  ref_id uuid,                           -- 관련 리소스 id (결재 id 등)
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notif_user_read on notifications(user_id, read_at, created_at desc);
create index if not exists idx_notif_user_created on notifications(user_id, created_at desc);

alter table notifications enable row level security;

drop policy if exists "notif_select_self" on notifications;
create policy "notif_select_self" on notifications
  for select using (user_id = auth.uid());

drop policy if exists "notif_update_self" on notifications;
create policy "notif_update_self" on notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- INSERT는 함수(security definer)에서만 — 사용자가 직접 알림 만드는 건 차단

-- realtime publication
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when others then null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 트리거: approval_requests.status 가 approved/rejected/cancelled 로 바뀌면
-- 기안자 + 같은 사업장 owner들에게 알림
-- ─────────────────────────────────────────────────────────────────────────
create or replace function notify_approval_decided()
returns trigger language plpgsql security definer as $$
declare
  msg text;
  link text;
  body_text text;
begin
  if new.status not in ('approved', 'rejected', 'cancelled') then return new; end if;
  if new.status = (old.status) then return new; end if;

  msg := case new.status
    when 'approved'  then '결재 최종 승인'
    when 'rejected'  then '결재 반려'
    when 'cancelled' then '결재 취소'
  end;
  link := '/approvals/' || new.id::text;
  body_text := new.title;

  -- 기안자에게 알림
  insert into notifications (user_id, type, title, body, link, ref_id)
  values (new.drafter_id, 'approval_decided', msg, body_text, link, new.id);

  -- 사업장 owner 들에게도 (기안자 본인 제외)
  insert into notifications (user_id, type, title, body, link, ref_id)
  select m.user_id, 'approval_decided', msg, body_text, link, new.id
  from memberships m
  where m.workplace_id = new.workplace_id
    and m.active = true
    and m.role = 'owner'
    and m.user_id <> new.drafter_id;

  return new;
end;
$$;

drop trigger if exists trg_notify_approval_decided on approval_requests;
create trigger trg_notify_approval_decided
  after update of status on approval_requests
  for each row execute function notify_approval_decided();

-- ─────────────────────────────────────────────────────────────────────────
-- 결재선의 내 차례가 됐을 때 알림 (approval_steps.status='waiting' + 현재 단계)
-- approval_request 의 current_step 이 바뀔 때 알림
-- ─────────────────────────────────────────────────────────────────────────
create or replace function notify_approval_assigned()
returns trigger language plpgsql security definer as $$
declare
  approver_uid uuid;
  req_title text;
begin
  -- current_step 이 변경됐을 때만
  if old.current_step = new.current_step then return new; end if;
  if new.status <> 'pending' then return new; end if;

  -- 새 current_step의 approver 찾기
  select s.approver_id, new.title into approver_uid, req_title
  from approval_steps s
  where s.request_id = new.id
    and s.step_order = new.current_step
    and s.status = 'waiting'
  limit 1;

  if approver_uid is null then return new; end if;

  insert into notifications (user_id, type, title, body, link, ref_id)
  values (approver_uid, 'approval_assigned', '결재 요청', req_title, '/approvals/' || new.id::text, new.id);

  return new;
end;
$$;

drop trigger if exists trg_notify_approval_assigned on approval_requests;
create trigger trg_notify_approval_assigned
  after update of current_step on approval_requests
  for each row execute function notify_approval_assigned();

-- 신규 결재 생성 시 첫 단계 approver 에게 알림
create or replace function notify_approval_new()
returns trigger language plpgsql security definer as $$
declare
  approver_uid uuid;
begin
  -- 잠깐 후에 approval_steps 도 INSERT 되므로, 신규 단계가 들어오면 알림
  if new.step_order = 1 and new.status = 'waiting' then
    insert into notifications (user_id, type, title, body, link, ref_id)
    select new.approver_id, 'approval_assigned', '결재 요청',
           r.title, '/approvals/' || r.id::text, r.id
    from approval_requests r where r.id = new.request_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_approval_new on approval_steps;
create trigger trg_notify_approval_new
  after insert on approval_steps
  for each row execute function notify_approval_new();

-- ─────────────────────────────────────────────────────────────────────────
-- 건의 응답 시 작성자에게 알림
-- ─────────────────────────────────────────────────────────────────────────
create or replace function notify_suggestion_response()
returns trigger language plpgsql security definer as $$
begin
  if new.response is not null and (old.response is null or old.response <> new.response) then
    insert into notifications (user_id, type, title, body, link, ref_id)
    values (new.user_id, 'suggestion_response',
            '본사에서 응답이 도착했어요', new.title, '/suggestions', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_suggestion on suggestions;
create trigger trg_notify_suggestion
  after update of response on suggestions
  for each row execute function notify_suggestion_response();

-- ─────────────────────────────────────────────────────────────────────────
-- 공지사항 새로 작성 시 같은 사업장 멤버 전원에게
-- ─────────────────────────────────────────────────────────────────────────
create or replace function notify_announcement_new()
returns trigger language plpgsql security definer as $$
begin
  insert into notifications (user_id, type, title, body, link, ref_id)
  select m.user_id, 'announcement_new',
         '새 공지: ' || new.title,
         left(coalesce(new.body, ''), 80),
         '/announcements', new.id
  from memberships m
  where m.workplace_id = new.workplace_id
    and m.active = true
    and m.user_id <> new.author_id;
  return new;
end;
$$;

drop trigger if exists trg_notify_announcement on announcements;
create trigger trg_notify_announcement
  after insert on announcements
  for each row execute function notify_announcement_new();

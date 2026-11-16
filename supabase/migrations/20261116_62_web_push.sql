-- ========================================================================
-- 62. 웹 푸시 — 알림(notifications)이 생기면 휴대폰·PC 로 푸시
--  1) push_subscriptions: 기기별 푸시 구독 (기기마다 "알림 켜기" 한 번)
--  2) trg_push_notify: notifications 에 행이 들어오면 pg_net 으로 /api/push/send 호출 (묶음 insert 는 한 번에)
--     시크릿은 이미 등록된 toss-pos-sync-10m 잡의 헤더에서 가져온다 (값을 여기 적지 않음).
--     구독한 사람이 없으면 호출하지 않고, 호출이 실패해도 알림 저장은 막지 않는다.
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- 멈추려면: drop trigger trg_push_notify on notifications;
-- ========================================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists idx_push_subs_user on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;
-- 쓰기는 서버 액션(서비스롤)만. 본인 구독 조회만 허용
drop policy if exists "push_subs_select_self" on push_subscriptions;
create policy "push_subs_select_self" on push_subscriptions for select using (user_id = (select auth.uid()));

create or replace function push_notify_new()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  s text;
  v_ids jsonb;
begin
  -- 구독 기기가 있는 사람의 알림만
  select jsonb_agg(n.id) into v_ids
    from new_rows n
   where exists (select 1 from push_subscriptions p where p.user_id = n.user_id);
  if v_ids is null then return null; end if;

  select substring(command from 'x-sync-secret":"([^"]+)"') into s
    from cron.job where jobname = 'toss-pos-sync-10m' limit 1;
  if s is null then return null; end if;

  perform net.http_post(
    url     := 'https://counter.mclean21.com/api/push/send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', s),
    body    := jsonb_build_object('ids', v_ids),
    timeout_milliseconds := 20000);
  return null;
exception when others then
  return null; -- 푸시 호출 문제로 알림 insert 가 실패하면 안 된다
end;
$$;

drop trigger if exists trg_push_notify on notifications;
create trigger trg_push_notify
  after insert on notifications
  referencing new table as new_rows
  for each statement execute function push_notify_new();

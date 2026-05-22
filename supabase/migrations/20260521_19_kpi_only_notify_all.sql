-- ========================================================================
-- KPI만 사용 (OKR 제거) + KPI 결재 승인 시 전 멤버 알림
-- ========================================================================

-- 1) 기존 'okr' 데이터 → 'kpi'
update kpis set category = 'kpi' where category = 'okr';

-- 2) CHECK constraint 갱신 — kpi 만
alter table kpis drop constraint if exists kpis_category_check;
alter table kpis
  add constraint kpis_category_check
  check (category = 'kpi');

-- 3) KPI 결재 승인 시 사업장 멤버 전원에게 알림
-- 전사 KPI(workplace_id IS NULL)면 모든 멤버
create or replace function notify_kpi_approved()
returns trigger language plpgsql security definer as $$
declare
  k record;
begin
  if new.status <> 'approved' or new.doc_type <> 'kpi' then return new; end if;
  if old.status = 'approved' then return new; end if;

  -- 묶인 KPI 정보 가져오기
  select k.* into k from kpis k where k.approval_request_id = new.id limit 1;
  if not found then return new; end if;

  if k.workplace_id is null then
    -- 전사 KPI — 모든 active 멤버
    insert into notifications (user_id, type, title, body, link, ref_id)
    select distinct m.user_id, 'kpi_approved',
           '신규 KPI 확정',
           k.name || (case when k.target_value is not null
                          then ' · 목표 ' || k.target_value::text || coalesce(k.unit, '')
                          else '' end),
           '/kpis', k.id
    from memberships m
    where m.active = true;
  else
    -- 사업장 KPI — 해당 사업장 active 멤버
    insert into notifications (user_id, type, title, body, link, ref_id)
    select m.user_id, 'kpi_approved',
           '신규 KPI 확정',
           k.name,
           '/kpis', k.id
    from memberships m
    where m.workplace_id = k.workplace_id and m.active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_kpi_approved on approval_requests;
create trigger trg_notify_kpi_approved
  after update of status on approval_requests
  for each row execute function notify_kpi_approved();

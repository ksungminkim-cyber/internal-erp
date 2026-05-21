-- ========================================================================
-- 시프트(근무 스케줄) 결재 흐름
-- 매니저가 다음달 시프트를 모아 결재로 올리고, 승인되면 confirmed 처리
-- ========================================================================

-- 1) approval_requests.doc_type 에 'schedule' 추가
alter table approval_requests drop constraint if exists approval_requests_doc_type_check;
alter table approval_requests
  add constraint approval_requests_doc_type_check
  check (doc_type in ('expense', 'general', 'schedule'));

-- 2) schedule 결재의 대상 연도/월 (월별 시프트 묶음)
alter table approval_requests
  add column if not exists period_year integer,
  add column if not exists period_month integer
    check (period_month is null or (period_month between 1 and 12));

-- 3) 어느 시프트가 어느 결재에 묶여 있는지
alter table shifts
  add column if not exists approval_request_id uuid references approval_requests(id) on delete set null;

create index if not exists idx_shifts_approval on shifts(approval_request_id);

-- 4) 결재 승인 시 묶인 시프트들 자동 confirmed
-- (이미 있는 advance_approval 트리거를 확장하지 않고 별도 트리거로 분리해 단순화)
create or replace function on_approval_decided()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'approved' and (old.status is null or old.status <> 'approved') then
    update shifts
    set status = 'confirmed', updated_at = now()
    where approval_request_id = new.id and status = 'scheduled';
  elsif new.status = 'rejected' and (old.status is null or old.status <> 'rejected') then
    update shifts
    set status = 'cancelled', updated_at = now()
    where approval_request_id = new.id and status = 'scheduled';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_approval_decided on approval_requests;
create trigger trg_approval_decided
  after update of status on approval_requests
  for each row execute function on_approval_decided();

-- ========================================================================
-- 지출 회계 분류 추가 + 월 마감 결재 흐름
-- ========================================================================

-- 1) 지출 항목에 회계 분류 (kind)
-- cogs:      매출원가 (식자재·음료·주류)
-- opex:      일반관리비 (비품·소모품·수리·마케팅)
-- utilities: 공과잡비 (전기·수도·가스·통신·임차료·보험·세금)
alter table expense_items
  add column if not exists kind text not null default 'cogs'
    check (kind in ('cogs', 'opex', 'utilities'));

-- 카테고리 → 기본 kind 매핑 (기존 데이터 자동 분류)
update expense_items
set kind = case
  when category in ('식자재', '음료/시럽', '주류') then 'cogs'
  when category in ('전기', '수도', '가스', '통신', '임차료', '보험', '세금', '공과잡비') then 'utilities'
  else 'opex'
end
where kind is null or kind = 'cogs';  -- default였던 것만 재분류

-- 2) approval_requests.doc_type 에 'closing' 추가 (월 마감 결재)
alter table approval_requests drop constraint if exists approval_requests_doc_type_check;
alter table approval_requests
  add constraint approval_requests_doc_type_check
  check (doc_type in ('expense', 'general', 'schedule', 'kpi', 'closing'));

-- 3) month_closings 에 approval_request_id 연결 + closed_with 식별
alter table month_closings
  add column if not exists approval_request_id uuid references approval_requests(id) on delete set null;

create index if not exists idx_closings_approval on month_closings(approval_request_id);

-- 4) 월 마감 결재 승인 시 month_closings.locked = true 강제
create or replace function on_closing_approval_decided()
returns trigger language plpgsql security definer as $$
begin
  if new.doc_type <> 'closing' then return new; end if;
  if new.status = 'approved' and (old.status is null or old.status <> 'approved') then
    update month_closings
    set locked = true
    where approval_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_closing_approval on approval_requests;
create trigger trg_closing_approval
  after update of status on approval_requests
  for each row execute function on_closing_approval_decided();

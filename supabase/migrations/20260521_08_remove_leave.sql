-- ========================================================================
-- 결재 종류에서 'leave' (휴가) 제거
-- ========================================================================

alter table approval_requests drop constraint if exists approval_requests_doc_type_check;
alter table approval_requests
  add constraint approval_requests_doc_type_check
  check (doc_type in ('expense', 'general'));

-- 혹시 기존 'leave' 데이터가 있다면 'general' 로 변경
update approval_requests set doc_type = 'general' where doc_type = 'leave';

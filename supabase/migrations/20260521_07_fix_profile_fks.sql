-- ========================================================================
-- 프로필 외래키 정리
-- PostgREST 임베드 (e.g. profiles!approval_requests_drafter_id_fkey)
-- 가 동작하려면 FK가 profiles.user_id 를 가리켜야 함
-- profiles 자체는 auth.users(id) 에 ON DELETE CASCADE 로 연결되어 있어 안전
-- ========================================================================

-- approval_requests.drafter_id
alter table approval_requests drop constraint if exists approval_requests_drafter_id_fkey;
alter table approval_requests
  add constraint approval_requests_drafter_id_fkey
  foreign key (drafter_id) references profiles(user_id) on delete set null;

-- approval_steps.approver_id
alter table approval_steps drop constraint if exists approval_steps_approver_id_fkey;
alter table approval_steps
  add constraint approval_steps_approver_id_fkey
  foreign key (approver_id) references profiles(user_id) on delete cascade;

-- approval_attachments.uploaded_by
alter table approval_attachments drop constraint if exists approval_attachments_uploaded_by_fkey;
alter table approval_attachments
  add constraint approval_attachments_uploaded_by_fkey
  foreign key (uploaded_by) references profiles(user_id) on delete set null;

-- announcements.author_id
alter table announcements drop constraint if exists announcements_author_id_fkey;
alter table announcements
  add constraint announcements_author_id_fkey
  foreign key (author_id) references profiles(user_id) on delete set null;

-- attendance_logs.user_id
alter table attendance_logs drop constraint if exists attendance_logs_user_id_fkey;
alter table attendance_logs
  add constraint attendance_logs_user_id_fkey
  foreign key (user_id) references profiles(user_id) on delete cascade;

-- memberships.user_id  (approvals/new 페이지에서 profiles 임베드 사용)
alter table memberships drop constraint if exists memberships_user_id_fkey;
alter table memberships
  add constraint memberships_user_id_fkey
  foreign key (user_id) references profiles(user_id) on delete cascade;

-- announcement_reads.user_id
alter table announcement_reads drop constraint if exists announcement_reads_user_id_fkey;
alter table announcement_reads
  add constraint announcement_reads_user_id_fkey
  foreign key (user_id) references profiles(user_id) on delete cascade;

-- PostgREST 스키마 캐시 리로드
notify pgrst, 'reload schema';

-- ========================================================================
-- 공지사항 (Announcements)
-- ========================================================================

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcements_workplace on announcements(workplace_id, created_at desc);

-- 읽음 기록
create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- ========================================================================
-- RLS
-- ========================================================================
alter table announcements enable row level security;
alter table announcement_reads enable row level security;

-- 사업장 멤버 모두 조회
drop policy if exists "announcements_select_member" on announcements;
create policy "announcements_select_member" on announcements
  for select using (is_member_of(workplace_id));

-- 매니저/대표만 작성·수정·삭제
drop policy if exists "announcements_insert_manager" on announcements;
create policy "announcements_insert_manager" on announcements
  for insert with check (
    is_manager_of(workplace_id)
    and author_id = auth.uid()
  );

drop policy if exists "announcements_update_manager" on announcements;
create policy "announcements_update_manager" on announcements
  for update using (is_manager_of(workplace_id))
  with check (is_manager_of(workplace_id));

drop policy if exists "announcements_delete_manager" on announcements;
create policy "announcements_delete_manager" on announcements
  for delete using (is_manager_of(workplace_id));

-- 읽음: 본인 것만 INSERT, 같은 사업장 멤버는 SELECT (읽은 사람 표시)
drop policy if exists "reads_select_member" on announcement_reads;
create policy "reads_select_member" on announcement_reads
  for select using (
    exists (
      select 1 from announcements a
      where a.id = announcement_reads.announcement_id
        and is_member_of(a.workplace_id)
    )
  );

drop policy if exists "reads_insert_self" on announcement_reads;
create policy "reads_insert_self" on announcement_reads
  for insert with check (user_id = auth.uid());

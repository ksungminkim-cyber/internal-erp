-- ========================================================================
-- Storage bucket: receipts
-- 영수증·첨부파일 저장. 경로 규칙: {workplace_id}/{request_id}/{file}
-- ========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false,
  10485760, -- 10MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 본인이 멤버인 사업장의 객체만 SELECT
drop policy if exists "receipts_select_member" on storage.objects;
create policy "receipts_select_member" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.active = true
        and m.workplace_id::text = (storage.foldername(name))[1]
    )
  );

-- 본인이 멤버인 사업장에만 INSERT
drop policy if exists "receipts_insert_member" on storage.objects;
create policy "receipts_insert_member" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and auth.uid() is not null
    and exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.active = true
        and m.workplace_id::text = (storage.foldername(name))[1]
    )
  );

-- 본인이 업로드한 파일만 DELETE
drop policy if exists "receipts_delete_owner" on storage.objects;
create policy "receipts_delete_owner" on storage.objects
  for delete using (
    bucket_id = 'receipts'
    and owner = auth.uid()
  );

-- 오늘,우리는 — private storage bucket and object policies for visit photos.
--
-- Kept in its own migration because creating policies on storage.objects needs
-- ownership of that table. If the role running the migration lacks it, only this
-- file fails and the schema from the previous migration is already in place; see
-- supabase/README.md for the fallback.
--
-- Object path convention, which is what the policies key off:
--
--     visit-photos/<couple_id>/<visit_id>/<photo_id><extension>
--
-- Segment 1 is the couple, so a single path check scopes an object to the
-- caller's active couple without a join.

-- file_size_limit and allowed_mime_types stay null on purpose.
-- EXTERNAL GATE: both are operating values still to be agreed with the user, and
-- they belong here in the bucket settings rather than in SQL constraints.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, null, null)
on conflict (id) do nothing;

drop policy if exists visit_photos_objects_select on storage.objects;
create policy visit_photos_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'visit-photos'
    and app.try_uuid((storage.foldername(name))[1]) = app.current_couple_id()
  );

drop policy if exists visit_photos_objects_insert on storage.objects;
create policy visit_photos_objects_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'visit-photos'
    and app.try_uuid((storage.foldername(name))[1]) = app.current_couple_id()
  );

-- Needed for a resumable or overwriting upload of an object the couple owns.
drop policy if exists visit_photos_objects_update on storage.objects;
create policy visit_photos_objects_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'visit-photos'
    and app.try_uuid((storage.foldername(name))[1]) = app.current_couple_id()
  )
  with check (
    bucket_id = 'visit-photos'
    and app.try_uuid((storage.foldername(name))[1]) = app.current_couple_id()
  );

-- Delete is uploader only, decided by the metadata row rather than by the path.
-- The client therefore deletes the object first and the visit_photos row second;
-- once the row is gone the object is no longer deletable by a client and is left
-- to the purge worker.
drop policy if exists visit_photos_objects_delete on storage.objects;
create policy visit_photos_objects_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'visit-photos'
    and app.try_uuid((storage.foldername(name))[1]) = app.current_couple_id()
    and exists (
      select 1
        from public.visit_photos p
       where p.storage_bucket = 'visit-photos'
         and p.storage_path = objects.name
         and p.uploader_id = auth.uid()
    )
  );

-- 오늘,우리는 — private storage bucket and object policies for visit photos.
--
-- Kept in its own migration because creating policies on storage.objects needs
-- ownership of that table. If the role running the migration lacks it, only this
-- file fails and the schema from the previous migration is already in place; see
-- supabase/README.md for the fallback.
--
-- Object path convention, which is what the policies key off:
--
--     visit-photos/<couple_id>/<visit_id>/<filename>
--
-- Segment 1 is the couple and segment 2 is the visit, so the policies can check
-- both without a join, and public.register_visit_photo validates the same three
-- segments against the target visit before it writes a metadata row.

-- The conflict path forces public = false so an existing bucket cannot stay
-- world readable, and touches nothing else: file_size_limit and
-- allowed_mime_types are configured outside SQL and must survive a re-run.
-- EXTERNAL GATE: both are still to be agreed with the user, which is why the
-- insert leaves them null rather than inventing a limit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('visit-photos', 'visit-photos', false, null, null)
on conflict (id) do update
   set public = false;

drop policy if exists visit_photos_objects_select on storage.objects;
create policy visit_photos_objects_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'visit-photos'
    and app.try_uuid((storage.foldername(name))[1]) = app.current_couple_id()
    and app.can_read_visit(app.try_uuid((storage.foldername(name))[2]))
  );

-- Both segments are required: the caller's active couple, and a visit inside it
-- that the caller can read. A non-canonical path has no second folder segment, so
-- can_read_visit(null) is false and the write is refused.
drop policy if exists visit_photos_objects_insert on storage.objects;
create policy visit_photos_objects_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'visit-photos'
    and app.try_uuid((storage.foldername(name))[1]) = app.current_couple_id()
    and app.can_read_visit(app.try_uuid((storage.foldername(name))[2]))
  );

-- Overwriting an object is uploader only, decided by the uploader recorded on the
-- metadata row. Without this a member could replace the bytes of the partner's
-- photo while leaving the partner's metadata row in place.
--
-- Consequence worth knowing: an object uploaded but never registered has no
-- metadata row, so no client can overwrite or delete it. Clients therefore use a
-- fresh filename per upload attempt, and orphans are removed by the purge worker.
drop policy if exists visit_photos_objects_update on storage.objects;
create policy visit_photos_objects_update
  on storage.objects
  for update
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
  )
  with check (
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

-- Delete is uploader only on the same basis. The client deletes the object first
-- and the visit_photos row second; once the row is gone the object is no longer
-- deletable by a client and is left to the purge worker.
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

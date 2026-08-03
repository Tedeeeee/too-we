-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Security regression: register_visit_photo is not the only writer of
-- public.visit_photos. The browser holds a direct insert grant and an insert
-- policy that asks only for its own uploader_id and a readable visit, so a
-- member could register a metadata row naming any bucket and any object path.
--
-- That row is not inert. disconnect_couple snapshots storage_bucket and
-- storage_path into app.purge_job_objects, and the service-role purge worker is
-- later handed that list. A forged value therefore decides what a privileged
-- process is asked to delete, and a value the worker refuses strands the job --
-- which is the couple's own 24 hour deletion guarantee.
--
-- So the canonical path has to hold at the table, for every writer -- and to the
-- standard the worker applies, not merely the RPC's. validPath() in purge.js
-- refuses a '.' or '..' segment, a backslash, a control character and a path
-- longer than 1024 UTF-16 code units, and it matches the couple prefix byte for
-- byte. Anything it refuses
-- must never reach a metadata row, because the refusal it cannot report is
-- precisely what strands the job.

begin;
select plan(14);

create extension if not exists pgtap;

-- Test-only setup. Couple creation fails closed until the invite lifetime is
-- resolved, so this rolled-back scenario supplies a value without changing the
-- production seed.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('99999999-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('99999999-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

/* ---------- A creates a couple and one visit ---------- */

select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('A', null, 'req-photo-a-create');
select public.create_visit(
  '{"name":"성수동 블루보틀","provider":"kakao"}'::jsonb,
  '2026-05-03T10:00:00+09:00'::timestamptz,
  'req-photo-a-visit'
);
reset role;

/* ---------- B creates a separate couple that must never be referenced ---------- */

select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('B', null, 'req-photo-b-create');
reset role;

create temporary table photo_path_ctx as
select
  v.id as visit_id,
  v.couple_id as couple_id,
  (
    select m.couple_id
      from public.couple_members m
     where m.user_id = '99999999-0000-0000-0000-000000000002'
       and m.left_at is null
  ) as other_couple_id
from public.visits v
join public.couple_members m on m.couple_id = v.couple_id
where m.user_id = '99999999-0000-0000-0000-000000000001'
  and m.left_at is null
limit 1;

select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

/* ---------- the canonical registration still works ---------- */

select lives_ok(
  format(
    $$select public.register_visit_photo(%L, %L, '{}'::jsonb, 'req-photo-a-register')$$,
    (select visit_id from photo_path_ctx),
    (select couple_id || '/' || visit_id || '/first.webp' from photo_path_ctx)
  ),
  'the uploader may register an object inside its own visit folder'
);
select is(
  (select count(*)::int from public.visit_photos where visit_id = (select visit_id from photo_path_ctx)),
  1,
  'the canonical registration is persisted'
);

/* ---------- a direct insert may not name another couple's folder ---------- */

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 2, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select other_couple_id || '/' || visit_id || '/stolen.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a direct insert cannot point a metadata row at another couple''s folder'
);

/* ---------- nor another bucket ---------- */

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 3, 'other-bucket', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || visit_id || '/elsewhere.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a direct insert cannot move the object reference to another bucket'
);

/* ---------- nor a path outside the three segment convention ---------- */

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 4, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || visit_id || '/nested/deeper.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a direct insert cannot escape the three segment path convention'
);

/* ---------- nor a sibling visit of the same couple ---------- */

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 5, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || other_couple_id || '/wrong-visit.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'the visit segment has to be the row''s own visit'
);

/* ---------- nor a spelling of the couple uuid the worker would not match ---------- */

-- app.try_uuid treats an uppercase uuid as the same value, but the worker tests
-- the `<couple_id>/` prefix byte for byte, so the segments are pinned as
-- canonical text.
select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 2, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select upper(couple_id::text) || '/' || visit_id || '/uppercase.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'the couple segment has to be the canonical lowercase uuid text'
);

/* ---------- nor any path the privileged purge worker would refuse ---------- */

-- Each of the four below is rejected by validPath() in
-- supabase/functions/purge-couple-data/purge.js. Accepting them here would let a
-- member queue an object the worker cannot process, and the unreportable refusal
-- is what strands the job past its 24 hour deletion deadline.

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 2, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || visit_id || '/..' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a traversal filename is refused'
);

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 2, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || visit_id || '/' || e'back\\slash.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a backslash in the filename is refused'
);

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 2, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || visit_id || '/' || e'control\nchar.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a control character in the filename is refused'
);

select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 2, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || visit_id || '/' || repeat('a', 1200) || '.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a path past the length the worker accepts is refused'
);

-- The bound has to be measured in a unit that is never smaller than the worker's.
-- 600 emoji are 600 characters, so char_length would wave this through, but they
-- are 1200 UTF-16 code units and the worker refuses anything over 1024.
select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_bucket, storage_path)
      values (%L, %L, 2, 'visit-photos', %L)$$,
    (select visit_id from photo_path_ctx),
    '99999999-0000-0000-0000-000000000001',
    (select couple_id || '/' || visit_id || '/' || repeat('🌸', 600) || '.webp' from photo_path_ctx)
  ),
  'TW003',
  null,
  'a non-BMP filename the worker would count as over length is refused'
);

select is(
  (select count(*)::int from public.visit_photos where visit_id = (select visit_id from photo_path_ctx)),
  1,
  'every rejected insert left the metadata table untouched'
);

reset role;

/* ---------- so the purge snapshot can only ever describe this couple ---------- */

select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.disconnect_couple('req-photo-a-disconnect');
reset role;

select is_empty(
  format(
    $$select o.object_path
        from app.purge_job_objects o
        join app.purge_jobs j on j.id = o.job_id
       where j.couple_id = %L
         and (o.bucket_id <> 'visit-photos' or o.object_path not like %L)$$,
    (select couple_id from photo_path_ctx),
    (select couple_id || '/%' from photo_path_ctx)
  ),
  'the queued purge objects stay inside the disconnected couple and its bucket'
);

select * from finish();
rollback;

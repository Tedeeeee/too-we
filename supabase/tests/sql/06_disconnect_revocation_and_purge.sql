-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: disconnect blocks both users immediately, queues one purge job with a
-- 24 hour target and a snapshot of the objects to delete, and the purge itself
-- removes the couple data. Acceptance scenario 12 of the functional spec.

begin;
select plan(14);

create extension if not exists pgtap;

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('ffffffff-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

select set_config('request.jwt.claims', json_build_object('sub', 'ffffffff-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('F1', null, 'req-f-create');
select public.create_visit(
  jsonb_build_object('name', '성수동 블루보틀'),
  now(),
  'req-f-visit',
  'rose',
  array['# 창가 자리', '# 사진 굿']
);
select public.upsert_my_visit_entry((select id from public.visits limit 1), 'F1의 한 줄', 4::smallint);
select public.register_visit_photo((select id from public.visits limit 1), 'f/p1');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'ffffffff-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.join_couple_with_code(
  (select code from public.couple_invites where status = 'active'),
  'req-f-join',
  'F2'
);
select public.upsert_my_visit_entry((select id from public.visits limit 1), 'F2의 한 줄', 5::smallint);
insert into public.wishlist_places (couple_id, created_by, place_name)
values (
  (select couple_id from public.couple_members where user_id = 'ffffffff-0000-0000-0000-000000000002'),
  'ffffffff-0000-0000-0000-000000000002',
  '뚝섬 한강공원'
);

select is((select count(*)::int from public.visit_entries), 2, 'both entries exist before the disconnect');

/* ---------- F2 disconnects ---------- */

select ok((public.disconnect_couple('req-f-disconnect') -> 'ok')::boolean, 'the disconnect succeeds');

-- Access is gone in the same transaction, for the requester...
select is((select count(*)::int from public.visits), 0, 'the requester loses the shared visits at once');
select is((select count(*)::int from public.visit_entries), 0, 'the requester loses the entries at once');
select is((select count(*)::int from public.wishlist_places), 0, 'the requester loses the wishlist at once');
select is((select count(*)::int from public.couples), 0, 'the couple is no longer visible');
reset role;

-- ...and for the other member.
select set_config('request.jwt.claims', json_build_object('sub', 'ffffffff-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.visits), 0, 'the other member loses access at once');
select is(
  (select count(*)::int from public.profiles where id = 'ffffffff-0000-0000-0000-000000000002'),
  0,
  'the partner profile is no longer readable'
);

-- A repeated disconnect is idempotent rather than an error.
select is(
  (public.disconnect_couple('req-f-disconnect-again') -> 'data' ->> 'already_disconnected'),
  'true',
  'a repeated disconnect reports the existing state'
);
reset role;

/* ---------- the queued purge job ---------- */

select is((select count(*)::int from app.purge_jobs where status = 'queued'), 1, 'exactly one purge job is queued');
select ok(
  (
    select due_at <= requested_at + interval '24 hours'
      from app.purge_jobs
     limit 1
  ),
  'the purge is due within 24 hours'
);
select ok(
  (select count(*) from app.purge_job_objects where deleted_at is null) >= 2,
  'the photo object and the couple prefix are queued for deletion'
);

/* ---------- the worker runs the purge ---------- */

set local role service_role;
select ok(
  (
    public.purge_couple_data((select id from app.purge_jobs limit 1)) -> 'ok'
  )::boolean,
  'the worker purges the couple data'
);
reset role;

select is(
  (
    select
      (select count(*) from public.visits)
      + (select count(*) from public.visit_entries)
      + (select count(*) from public.visit_photos)
      + (select count(*) from public.visit_tags)
      + (select count(*) from public.wishlist_places)
      + (select count(*) from public.couple_members)
  )::int,
  0,
  'no couple scoped row survives the purge'
);

select * from finish();
rollback;

-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: disconnect blocks both users immediately, queues one purge job that is
-- claimable at once with a 24 hour completion target, and the job cannot be closed
-- until the database purge and every queued object deletion are recorded.
-- Acceptance scenario 12 of the functional spec.

begin;
select plan(19);

create extension if not exists pgtap;

-- Test-only setup; see 04 for why this is not a default the migration invents.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('ffffffff-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('ffffffff-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

select set_config('request.jwt.claims', json_build_object('sub', 'ffffffff-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('F1', null, 'req-f-create');

-- A visit is created empty and enriched afterwards, which is the only shape the
-- RPC surface allows.
select public.create_visit(jsonb_build_object('name', '성수동 블루보틀'), now(), 'req-f-visit');
reset role;

create temporary table ctx as
select v.id as visit_id, v.couple_id as couple_id, v.couple_id::text || '/' || v.id::text || '/' as prefix
from public.visits v
limit 1;

set local role authenticated;
select is(
  (select flower_key from public.visits where id = (select visit_id from ctx)),
  null,
  'a new visit starts with no flower'
);
select is(
  (select count(*)::int from public.visit_tags where visit_id = (select visit_id from ctx)),
  0,
  'a new visit starts with no tag'
);

update public.visits set flower_key = 'rose' where id = (select visit_id from ctx);
select public.set_visit_tags((select visit_id from ctx), array['# 창가 자리', '# 사진 굿']);
select public.upsert_my_visit_entry((select visit_id from ctx), 'F1의 한 줄', 4::smallint);
select public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p1.bin');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'ffffffff-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.join_couple_with_code(
  (select code from public.couple_invites where status = 'active'),
  'req-f-join',
  'F2'
);
select public.upsert_my_visit_entry((select visit_id from ctx), 'F2의 한 줄', 5::smallint);
insert into public.wishlist_places (couple_id, created_by, place_name)
values ((select couple_id from ctx), 'ffffffff-0000-0000-0000-000000000002', '뚝섬 한강공원');

select is((select count(*)::int from public.visit_entries), 2, 'both entries exist before the disconnect');

-- A client cannot route around create_visit, so the empty-visit invariant holds.
select throws_ok(
  format(
    $$insert into public.visits (couple_id, visited_at, place_name, created_by)
      values (%L, now(), 'x', 'ffffffff-0000-0000-0000-000000000002')$$,
    (select couple_id from ctx)
  ),
  '42501',
  null,
  'a direct visit insert is refused even inside your own couple'
);

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
  (select due_at <= requested_at + interval '24 hours' from app.purge_jobs limit 1),
  'the purge is due within 24 hours'
);
select ok(
  (select count(*) from app.purge_job_objects where deleted_at is null) >= 2,
  'the photo object and the couple prefix are queued for deletion'
);

set local role service_role;

-- Queue eligibility is immediate: due_at is a completion target, not a delay.
select is(
  jsonb_array_length(public.claim_purge_jobs(10) -> 'data' -> 'jobs'),
  1,
  'the job is claimable straight away'
);

create temporary table job as select id from app.purge_jobs limit 1;

/* ---------- a job cannot be closed before the work is recorded ---------- */

select is(
  (public.complete_purge_job((select id from job), true) -> 'error' ->> 'code'),
  'purge_incomplete',
  'a job with no database purge yet cannot be marked succeeded'
);

select ok((public.purge_couple_data((select id from job)) -> 'ok')::boolean, 'the worker purges the couple data');

select is(
  (public.complete_purge_job((select id from job), true) -> 'error' ->> 'code'),
  'purge_incomplete',
  'a job with objects still queued cannot be marked succeeded'
);

select is(
  (select status from app.purge_jobs where id = (select id from job)),
  'queued',
  'an incomplete job stays queued and retryable'
);

-- The worker deletes the files, records them, and only then closes the job.
select public.mark_purge_objects_deleted(
  (select id from job),
  (select array_agg(object_path) from app.purge_job_objects where job_id = (select id from job))
);
select is(
  (public.complete_purge_job((select id from job), true) -> 'data' ->> 'status'),
  'succeeded',
  'the job closes once the purge and every object are recorded'
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

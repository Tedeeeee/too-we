-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Regression: a purge job runs up to 24 hours after the disconnect that queued it,
-- so by the time it executes either user may already have a new couple, a new
-- profile name, new idempotency keys and new invite attempts. The purge must reach
-- only rows owned by the couple named on the job.
--
-- This is what the first cut got wrong: it deleted app.idempotency_keys and
-- app.invite_attempts by member user_id and cleared profiles.display_name, all of
-- which are user wide. Purging an old couple therefore un-replay-protected and
-- un-rate-limited the user's *new* couple and wiped a name they had just entered.

begin;

-- The linked CLI enables pgTAP on a `set session role postgres` connection, but
-- pg_prove connects as the temp login in PGUSER, which holds no usage on the
-- extensions schema. Grant and search_path are transaction only: the rollback
-- at the end of this file removes both, so no lasting privilege changes.
create extension if not exists pgtap with schema extensions;
set local role postgres;
grant usage on schema extensions to public;
reset role;
set local search_path = extensions, public, pg_catalog;

select plan(15);

-- Test-only setup; see 04 for why this is not a default the migration invents.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('99999999-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('99999999-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('99999999-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

/* ---------- the old couple, with content ---------- */

select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('G1 old name', null, 'req-g-old-create');
select public.create_visit(jsonb_build_object('name', '옛 장소'), now(), 'req-g-old-visit');
select public.upsert_my_visit_entry((select id from public.visits limit 1), 'G1의 옛 한 줄', 3::smallint);
reset role;

create temporary table old_ctx as
select v.id as visit_id, v.couple_id as couple_id, v.couple_id::text || '/' || v.id::text || '/' as prefix
from public.visits v
limit 1;

set local role authenticated;
select public.register_visit_photo((select visit_id from old_ctx), (select prefix from old_ctx) || 'old.bin');
insert into public.wishlist_places (couple_id, created_by, place_name)
values ((select couple_id from old_ctx), '99999999-0000-0000-0000-000000000001', '옛 위시리스트');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.join_couple_with_code(
  (select code from public.couple_invites where status = 'active'),
  'req-g-old-join',
  'G2 old name'
);

/* ---------- G2 disconnects, which queues the purge ---------- */

select ok((public.disconnect_couple('req-g-disconnect') -> 'ok')::boolean, 'the old couple is disconnected');
reset role;

create temporary table job as
select id from app.purge_jobs where couple_id = (select couple_id from old_ctx);

select is((select count(*)::int from job), 1, 'one purge job is queued for the old couple');

/* ---------- before the job runs, both users move on ---------- */

-- G1 starts a brand new couple with a brand new name.
select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(
  (public.create_couple('G1 new name', null, 'req-g-new-create') -> 'ok')::boolean,
  'G1 can start a new couple before the old purge runs'
);
select public.create_visit(jsonb_build_object('name', '새 장소'), now(), 'req-g-new-visit');
reset role;

-- G2 fails an invite guess, which is what the rate limiter counts.
select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.join_couple_with_code('000000', 'req-g-bad-guess');
reset role;

create temporary table new_ctx as
select couple_id from public.couple_members
where user_id = '99999999-0000-0000-0000-000000000001' and left_at is null;

select isnt(
  (select couple_id from new_ctx),
  (select couple_id from old_ctx),
  'the new couple is a different couple'
);

/* ---------- now the worker purges the OLD job ---------- */

set local role service_role;
select ok((public.purge_couple_data((select id from job)) -> 'ok')::boolean, 'the old couple is purged');
reset role;

/* ---------- the old couple is gone ---------- */

select is(
  (select count(*)::int from public.visits where couple_id = (select couple_id from old_ctx)),
  0,
  'the old visits are gone'
);
select is(
  (select count(*)::int from public.couple_members where couple_id = (select couple_id from old_ctx)),
  0,
  'the old memberships are gone'
);
select is(
  (select count(*)::int from public.wishlist_places where couple_id = (select couple_id from old_ctx)),
  0,
  'the old wishlist is gone'
);
select isnt(
  (select purged_at from public.couples where id = (select couple_id from old_ctx)),
  null,
  'the old couple row is anonymised and stamped'
);

/* ---------- and the new state survived it ---------- */

select is(
  (select count(*)::int from public.visits where couple_id = (select couple_id from new_ctx)),
  1,
  'the new couple keeps its visit'
);
select is(
  (select count(*)::int from public.couple_members where couple_id = (select couple_id from new_ctx) and left_at is null),
  1,
  'the new membership survives'
);

-- The personal name belongs to the person, not to the purged couple.
select is(
  (select display_name from public.profiles where id = '99999999-0000-0000-0000-000000000001'),
  'G1 new name',
  'the name G1 just entered is untouched'
);

-- Idempotency keys are user wide. Deleting them would let a retried request run
-- its side effect a second time against the new couple.
select is(
  (
    select count(*)::int
      from app.idempotency_keys
     where user_id = '99999999-0000-0000-0000-000000000001'
       and request_key in ('req-g-new-create', 'req-g-new-visit')
  ),
  2,
  'the new-couple idempotency keys survive the old purge'
);

select set_config('request.jwt.claims', json_build_object('sub', '99999999-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (public.create_couple('G1 new name', null, 'req-g-new-create') ->> 'replayed'),
  'true',
  'the surviving key still replays instead of creating a second new couple'
);
reset role;

-- Invite attempts are user wide too, and they are the rate limiter's memory.
select is(
  (
    select count(*)::int
      from app.invite_attempts
     where user_id = '99999999-0000-0000-0000-000000000002'
       and outcome <> 'joined'
  ),
  1,
  'the failed invite attempt survives, so the rate limit is not reset by a purge'
);

select * from finish();
rollback;

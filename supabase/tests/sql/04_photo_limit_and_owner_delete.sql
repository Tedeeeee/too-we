-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: the canonical object path is enforced against the target visit, a
-- visit holds at most five photos, both members may reorder, only the uploader
-- may delete, and nothing but the ordinal may change on a registered row.
-- Acceptance scenario 9 of the functional spec.

begin;

-- The linked CLI enables pgTAP on a `set session role postgres` connection, but
-- pg_prove connects as the temp login in PGUSER, which holds no usage on the
-- extensions, app or auth schemas. So stay postgres for fixture setup, and hand
-- back from a role block with `set local role postgres;` -- never `reset role;`,
-- which restores that login. Transaction only: the rollback removes the grant.
create extension if not exists pgtap with schema extensions;
set local role postgres;
grant usage on schema extensions to public;
set local search_path = extensions, public, pg_catalog;

select plan(17);

-- Test-only setup. The production seed leaves invite_ttl_seconds unresolved on
-- purpose and app.issue_invite fails closed until it is set; resolving it inside
-- this rolled-back transaction is test setup, not a default the migration invents.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('dddddddd-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

select set_config('request.jwt.claims', json_build_object('sub', 'dddddddd-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('D1', null, 'req-d-create');
select public.create_visit(jsonb_build_object('name', '어라운드 성수'), now(), 'req-d-visit');
set local role postgres;

-- Canonical object path: <couple_id>/<visit_id>/<filename>
create temporary table ctx as
select
  v.id as visit_id,
  v.couple_id as couple_id,
  v.couple_id::text || '/' || v.id::text || '/' as prefix
from public.visits v
limit 1;
-- postgres owns this context table; authenticated needs read access to use it. Rolled back.
grant select on ctx to authenticated;

set local role authenticated;

/* ---------- the path has to describe this visit ---------- */

select is(
  (
    public.register_visit_photo((select visit_id from ctx), 'p1.bin') -> 'error' ->> 'code'
  ),
  'validation_error',
  'a bare filename is not a canonical path'
);

select is(
  (
    public.register_visit_photo(
      (select visit_id from ctx),
      (select couple_id from ctx)::text || '/' || gen_random_uuid()::text || '/p1.bin'
    ) -> 'error' ->> 'code'
  ),
  'validation_error',
  'a path pointing at another visit is refused'
);

select is(
  (
    public.register_visit_photo(
      (select visit_id from ctx),
      gen_random_uuid()::text || '/' || (select visit_id from ctx)::text || '/p1.bin'
    ) -> 'error' ->> 'code'
  ),
  'validation_error',
  'a path pointing at another couple is refused'
);

select is(
  (
    public.register_visit_photo(
      (select visit_id from ctx),
      (select prefix from ctx) || 'deeper/p1.bin'
    ) -> 'error' ->> 'code'
  ),
  'validation_error',
  'a deeper path than couple/visit/filename is refused'
);

/* ---------- four photos from the first member ---------- */

select is(
  (
    public.register_visit_photo(
      (select visit_id from ctx),
      (select prefix from ctx) || 'p1.bin',
      jsonb_build_object('byte_size', 1024, 'width', 800, 'height', 600, 'checksum', 'aaa')
    ) -> 'data' ->> 'ordinal'
  ),
  '1',
  'the first photo takes ordinal 1'
);

select public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p2.bin');
select public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p3.bin');
select public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p4.bin');

-- Registering the same object twice is an idempotent replay, not a new slot.
select is(
  (
    public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p4.bin')
      ->> 'replayed'
  ),
  'true',
  'the same stored object registers once'
);
select is((select count(*)::int from public.visit_photos), 4, 'four photos so far');
set local role postgres;

/* ---------- the partner adds the fifth and is refused the sixth ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'dddddddd-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
-- The joiner is not a member yet, so RLS hides the invite from them. Capture the
-- code while postgres and hand it over transaction-locally.
select set_config('test.invite_code', (select code from public.couple_invites where status = 'active'), true);
set local role authenticated;
select public.join_couple_with_code(
  current_setting('test.invite_code'),
  'req-d-join',
  'D2'
);

select ok(
  (
    public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p5.bin')
      -> 'ok'
  )::boolean,
  'the partner may add a photo too'
);

select is(
  (
    public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p6.bin')
      -> 'error' ->> 'code'
  ),
  'photo_limit_reached',
  'the sixth photo is refused with its own outcome'
);

-- Even a direct insert cannot exceed five, because ordinal is 1..5 and unique.
--
-- This one is about the table CHECK, and two things answer ahead of it: the row
-- policy, and the BEFORE INSERT guard that rejects any path outside
-- couple_id/visit_id/ for every role, postgres included. So the probe runs as
-- postgres and carries a canonical path, leaving the constraint as the only thing
-- left to refuse it. RLS on this table has its own assertions above and below.
set local role postgres;
select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_path)
      values (%L, 'dddddddd-0000-0000-0000-000000000002', 6, %L)$$,
    (select visit_id from ctx),
    (select prefix from ctx) || 'p6.bin'
  ),
  '23514',
  null,
  'ordinal 6 violates the check constraint'
);
set local role authenticated;

/* ---------- the shared reorder really moves a row ---------- */

-- The partner frees ordinal 5 by deleting their own photo first.
delete from public.visit_photos where storage_path = (select prefix from ctx) || 'p5.bin';
select is(
  (select count(*)::int from public.visit_photos),
  4,
  'the uploader can delete their own photo'
);

-- Now the partner moves a photo they did NOT upload into the freed slot. This has
-- to change a real row: a no-op update would prove nothing about the policy.
update public.visit_photos
   set ordinal = 5
 where storage_path = (select prefix from ctx) || 'p1.bin';

select is(
  (select ordinal from public.visit_photos where storage_path = (select prefix from ctx) || 'p1.bin'),
  5::smallint,
  'the partner reordered a photo they did not upload'
);

/* ---------- and may change nothing else on that row ---------- */

select throws_ok(
  format(
    $$update public.visit_photos set storage_path = %L where storage_path = %L$$,
    (select prefix from ctx) || 'stolen.bin',
    (select prefix from ctx) || 'p2.bin'
  ),
  'TW003',
  null,
  'storage_path is immutable after registration'
);

select throws_ok(
  format(
    $$update public.visit_photos set checksum = 'bbb' where storage_path = %L$$,
    (select prefix from ctx) || 'p1.bin'
  ),
  'TW003',
  null,
  'content metadata is immutable after registration'
);

select throws_ok(
  format(
    $$update public.visit_photos
        set uploader_id = 'dddddddd-0000-0000-0000-000000000002'
      where storage_path = %L$$,
    (select prefix from ctx) || 'p1.bin'
  ),
  'TW003',
  null,
  'uploader_id cannot be reassigned'
);

/* ---------- delete stays uploader only ---------- */

delete from public.visit_photos where storage_path = (select prefix from ctx) || 'p2.bin';
select is(
  (select count(*)::int from public.visit_photos where storage_path = (select prefix from ctx) || 'p2.bin'),
  1,
  'the partner cannot delete a photo they did not upload'
);

-- Freed ordinals are reused by the next registration: 1 was vacated by the
-- reorder, so the next photo takes it.
select is(
  (
    public.register_visit_photo((select visit_id from ctx), (select prefix from ctx) || 'p8.bin')
      -> 'data' ->> 'ordinal'
  ),
  '1',
  'the freed ordinal is reused'
);

set local role postgres;
select * from finish();
rollback;

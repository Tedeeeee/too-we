-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: the partner's 한 줄 and 별점 are readable but not writable, and
-- clearing your own line puts you back into the waiting state.
-- Acceptance scenarios 3, 4 and 5 of the functional spec.

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

select plan(9);

-- Test-only setup. The production seed leaves invite_ttl_seconds unresolved on
-- purpose and app.issue_invite fails closed until it is set; resolving it inside
-- this rolled-back transaction is test setup, not a default the migration invents.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('cccccccc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('cccccccc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

select set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('C1', null, 'req-c-create');
select public.create_visit(jsonb_build_object('name', '뚝섬 한강공원'), now(), 'req-c-visit');
select public.upsert_my_visit_entry((select id from public.visits limit 1), 'A의 한 줄', 4::smallint);
set local role postgres;

select set_config('request.jwt.claims', json_build_object('sub', 'cccccccc-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
-- The joiner is not a member yet, so RLS hides the invite from them. Capture the
-- code while postgres and hand it over transaction-locally.
select set_config('test.invite_code', (select code from public.couple_invites where status = 'active'), true);
set local role authenticated;
select public.join_couple_with_code(
  current_setting('test.invite_code'),
  'req-c-join',
  'C2'
);

/* ---------- B can read A's entry but cannot change it ---------- */

select is(
  (select note from public.visit_entries where author_id = 'cccccccc-0000-0000-0000-000000000001'),
  'A의 한 줄',
  'B reads the partner line'
);

-- RLS makes the update affect zero rows rather than raising.
update public.visit_entries set note = '조작' where author_id = 'cccccccc-0000-0000-0000-000000000001';
select is(
  (select note from public.visit_entries where author_id = 'cccccccc-0000-0000-0000-000000000001'),
  'A의 한 줄',
  'the update policy keeps the partner line unchanged'
);

delete from public.visit_entries where author_id = 'cccccccc-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.visit_entries where author_id = 'cccccccc-0000-0000-0000-000000000001'),
  1,
  'the delete policy keeps the partner entry'
);

-- Inserting an entry attributed to the partner is refused.
select throws_ok(
  format(
    $$insert into public.visit_entries (visit_id, author_id, note)
      values (%L, 'cccccccc-0000-0000-0000-000000000001', 'forged')$$,
    (select id from public.visits limit 1)
  ),
  '42501',
  null,
  'an entry cannot be attributed to the partner'
);

/* ---------- B writes their own entry ---------- */

select ok(
  (public.upsert_my_visit_entry((select id from public.visits limit 1), 'B의 한 줄', 5::smallint) -> 'ok')::boolean,
  'B writes their own entry'
);
select is(
  (select count(*)::int from public.visit_entries),
  2,
  'one entry per visit and author'
);

-- Second write for the same visit and author updates rather than duplicating.
select public.upsert_my_visit_entry((select id from public.visits limit 1), 'B의 수정된 한 줄', 3::smallint);
select is(
  (select count(*)::int from public.visit_entries where author_id = 'cccccccc-0000-0000-0000-000000000002'),
  1,
  'the entry is unique per visit and author'
);

/* ---------- clearing the line goes back to waiting ---------- */

select is(
  (public.upsert_my_visit_entry((select id from public.visits limit 1), '   ', 3::smallint) -> 'data' ->> 'pending'),
  'true',
  'a whitespace only line is stored as null and the user is waiting again'
);

-- Rating on its own does not satisfy the waiting rule.
select is(
  (select rating from public.visit_entries where author_id = 'cccccccc-0000-0000-0000-000000000002'),
  3::smallint,
  'the rating survives a cleared line'
);

set local role postgres;
select * from finish();
rollback;

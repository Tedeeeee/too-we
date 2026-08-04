-- NOT EXECUTED IN THIS WORKSPACE.
-- The Supabase CLI and the Docker daemon are unavailable here, so this pgTAP
-- script has never been run. Run it with `supabase test db` once a local stack
-- exists. See supabase/README.md.
--
-- Scenario: two anonymous users in one active couple both read the shared visit
-- and each other's entry, and both may edit the shared visit fields.

begin;

-- A pg_prove session does not see pgTAP in the extensions schema on its own.
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(12);

-- Test-only setup. The production seed leaves invite_ttl_seconds unresolved on
-- purpose and app.issue_invite fails closed until it is set; resolving it inside
-- this rolled-back transaction is test setup, not a default the migration invents.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

-- Two anonymous auth users.
insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

/* ---------- A creates the couple ---------- */

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select ok(
  (public.create_couple('지은', null, 'req-create-1') -> 'ok')::boolean,
  'A creates a couple'
);

select is(
  (public.create_couple('지은', null, 'req-create-1') ->> 'replayed'),
  'true',
  'the same request key replays instead of creating a second couple'
);

reset role;
select is(
  (select count(*)::int from public.couples),
  1,
  'exactly one couple exists after the replayed request'
);

/* ---------- B joins with the code ---------- */

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select ok(
  (
    public.join_couple_with_code(
      (select code from public.couple_invites where status = 'active'),
      'req-join-1',
      '태식'
    ) -> 'ok'
  )::boolean,
  'B joins with the active code'
);

reset role;
select is(
  (select count(*)::int from public.couple_members where left_at is null),
  2,
  'the couple now has two active members'
);
select is(
  (select status from public.couple_invites),
  'consumed',
  'the code is consumed after a successful join'
);

/* ---------- shared visit ---------- */

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select ok(
  (
    public.create_visit(
      jsonb_build_object('name', '성수동 블루보틀', 'category', '카페', 'provider_id', 'kakao-1'),
      '2026-05-03T10:14:00+09'::timestamptz,
      'req-visit-1'
    ) -> 'ok'
  )::boolean,
  'A records an empty visit'
);

-- A writes their 한 줄.
select ok(
  (
    public.upsert_my_visit_entry(
      (select id from public.visits limit 1),
      '케이크가 좋았다',
      4::smallint
    ) -> 'ok'
  )::boolean,
  'A writes their own entry'
);

/* ---------- B sees the shared data ---------- */

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

select is(
  (select count(*)::int from public.visits),
  1,
  'B sees the shared visit'
);
select is(
  (select count(*)::int from public.visit_entries),
  1,
  'B sees the partner entry'
);

-- Both members may change the shared fields.
select lives_ok(
  $$update public.visits set flower_key = 'rose', visited_at = '2026-05-04T10:00:00+09'$$,
  'B updates the shared flower and time'
);

-- The partner name is visible through the shared-couple profile policy.
select is(
  (select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  '지은',
  'B reads the partner display name'
);

reset role;
select * from finish();
rollback;

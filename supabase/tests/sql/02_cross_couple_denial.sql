-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: knowing an identifier from another couple grants nothing. Acceptance
-- scenario 11 of the functional spec.

begin;
select plan(10);

create extension if not exists pgtap;

-- Test-only setup. The production seed leaves invite_ttl_seconds unresolved on
-- purpose and app.issue_invite fails closed until it is set; resolving it inside
-- this rolled-back transaction is test setup, not a default the migration invents.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

/* ---------- couple A with a visit, a photo and a wishlist place ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('A1', null, 'req-a-create');
select public.create_visit(
  jsonb_build_object('name', '서울숲 카페거리'),
  '2025-10-19T15:20:00+09'::timestamptz,
  'req-a-visit'
);
select public.upsert_my_visit_entry((select id from public.visits limit 1), '단풍이 좋았다', 5::smallint);
reset role;

-- Second member of couple A, so the couple is full.
select set_config('request.jwt.claims', json_build_object('sub', 'aaaaaaaa-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.join_couple_with_code(
  (select code from public.couple_invites where status = 'active'),
  'req-a-join',
  'A2'
);
insert into public.wishlist_places (couple_id, created_by, place_name)
values (
  (select couple_id from public.couple_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'aaaaaaaa-0000-0000-0000-000000000002',
  '어라운드 성수'
);
reset role;

/* ---------- an outsider with their own couple ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'bbbbbbbb-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('B1', null, 'req-b-create');

select is((select count(*)::int from public.visits), 0, 'outsider sees no visit of the other couple');
select is((select count(*)::int from public.visit_entries), 0, 'outsider sees no entry of the other couple');
select is((select count(*)::int from public.wishlist_places), 0, 'outsider sees no wishlist place of the other couple');
select is((select count(*)::int from public.couples), 1, 'outsider sees only their own couple');
select is((select count(*)::int from public.couple_invites), 1, 'outsider sees only their own invite code');
select is(
  (select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'outsider cannot read a profile outside their couple'
);

reset role;
-- Capture the other couple's identifiers, then hand them to the outsider.
create temporary table leaked as
select
  (select id from public.visits limit 1) as visit_id,
  (select couple_id from public.couple_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' limit 1) as couple_id,
  (select code from public.couple_invites where status = 'consumed' limit 1) as used_code;

set local role authenticated;

select is(
  (public.upsert_my_visit_entry((select visit_id from leaked), 'hijack', 3::smallint) -> 'error' ->> 'code'),
  'not_found',
  'writing an entry on a foreign visit is reported as not_found'
);

select is(
  (public.register_visit_photo((select visit_id from leaked), 'x/y/z.bin') -> 'error' ->> 'code'),
  'not_found',
  'registering a photo on a foreign visit is reported as not_found'
);

-- A direct insert cannot borrow the other couple's identifier either. There is no
-- insert policy on visits at all, so this is refused for any couple id: create_visit
-- is the only way in.
select throws_ok(
  format(
    $$insert into public.visits (couple_id, visited_at, place_name, created_by)
      values (%L, now(), 'x', 'bbbbbbbb-0000-0000-0000-000000000001')$$,
    (select couple_id from leaked)
  ),
  '42501',
  null,
  'a direct visit insert is refused, foreign couple id or not'
);

select is(
  (
    public.join_couple_with_code((select used_code from leaked), 'req-b-steal') -> 'error' ->> 'code'
  ),
  'active_membership_conflict',
  'a user who already has an active couple cannot join another'
);

reset role;
select * from finish();
rollback;

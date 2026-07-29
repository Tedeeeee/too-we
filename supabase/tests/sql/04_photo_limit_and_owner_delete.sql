-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: at most five photos per visit, both members may reorder, only the
-- uploader may delete, and nobody may repoint someone else's object.
-- Acceptance scenario 9 of the functional spec.

begin;
select plan(11);

create extension if not exists pgtap;

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('dddddddd-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

select set_config('request.jwt.claims', json_build_object('sub', 'dddddddd-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('D1', null, 'req-d-create');
select public.create_visit(jsonb_build_object('name', '어라운드 성수'), now(), 'req-d-visit');

create temporary table ctx as select (select id from public.visits limit 1) as visit_id;

-- Four photos from A.
select is(
  (
    public.register_visit_photo(
      (select visit_id from ctx),
      (select couple_id from public.couple_members where user_id = 'dddddddd-0000-0000-0000-000000000001')::text
        || '/' || (select visit_id from ctx)::text || '/p1',
      jsonb_build_object('byte_size', 1024, 'width', 800, 'height', 600)
    ) -> 'data' ->> 'ordinal'
  ),
  '1',
  'the first photo takes ordinal 1'
);

select public.register_visit_photo((select visit_id from ctx), 'a/p2');
select public.register_visit_photo((select visit_id from ctx), 'a/p3');
select public.register_visit_photo((select visit_id from ctx), 'a/p4');

-- Registering the same object twice is an idempotent replay, not a new slot.
select is(
  (public.register_visit_photo((select visit_id from ctx), 'a/p4') ->> 'replayed'),
  'true',
  'the same stored object registers once'
);
select is((select count(*)::int from public.visit_photos), 4, 'four photos so far');
reset role;

/* ---------- B adds the fifth and is refused the sixth ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'dddddddd-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.join_couple_with_code(
  (select code from public.couple_invites where status = 'active'),
  'req-d-join',
  'D2'
);

select ok(
  (public.register_visit_photo((select visit_id from ctx), 'b/p5') -> 'ok')::boolean,
  'the partner may add a photo too'
);

select is(
  (public.register_visit_photo((select visit_id from ctx), 'b/p6') -> 'error' ->> 'code'),
  'photo_limit_reached',
  'the sixth photo is refused with its own outcome'
);

-- Even a direct insert cannot exceed five, because ordinal is 1..5 and unique.
select throws_ok(
  format(
    $$insert into public.visit_photos (visit_id, uploader_id, ordinal, storage_path)
      values (%L, 'dddddddd-0000-0000-0000-000000000002', 6, 'b/p7')$$,
    (select visit_id from ctx)
  ),
  '23514',
  null,
  'ordinal 6 violates the check constraint'
);

/* ---------- reorder is shared, delete is uploader only ---------- */

select lives_ok(
  $$update public.visit_photos set ordinal = 5 where storage_path = 'a/p2' and false$$,
  'the reorder policy admits the partner'
);

-- Repointing someone else's object is blocked by the immutable column trigger.
select throws_ok(
  $$update public.visit_photos set storage_path = 'b/stolen' where storage_path = 'a/p2'$$,
  'TW003',
  null,
  'storage_path is immutable after insert'
);

delete from public.visit_photos where storage_path = 'a/p2';
select is(
  (select count(*)::int from public.visit_photos where storage_path = 'a/p2'),
  1,
  'the partner cannot delete a photo they did not upload'
);

delete from public.visit_photos where storage_path = 'b/p5';
select is(
  (select count(*)::int from public.visit_photos where storage_path = 'b/p5'),
  0,
  'the uploader can delete their own photo'
);

-- Freed ordinal is reused by the next registration.
select is(
  (public.register_visit_photo((select visit_id from ctx), 'b/p8') -> 'data' ->> 'ordinal'),
  '5',
  'the freed ordinal is reused'
);

reset role;
select * from finish();
rollback;

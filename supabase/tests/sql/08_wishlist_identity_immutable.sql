-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Security regression: both active members may edit shared wishlist content,
-- but neither a browser client nor a raw REST update may rewrite the original
-- picker or move the row to another couple.

begin;

-- A pg_prove session does not see pgTAP in the extensions schema on its own.
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

-- Test-only setup. Couple creation fails closed until the invite lifetime is
-- resolved, so this rolled-back scenario supplies a value without changing the
-- production seed.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('88888888-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('88888888-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('88888888-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

/* ---------- A creates the shared row ---------- */

select set_config('request.jwt.claims', json_build_object('sub', '88888888-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('A', null, 'req-wishlist-a-create');
insert into public.wishlist_places (couple_id, created_by, place_name, place_category)
values (
  (select couple_id from public.couple_members where user_id = '88888888-0000-0000-0000-000000000001' and left_at is null),
  '88888888-0000-0000-0000-000000000001',
  '어라운드 성수',
  '카페'
);
reset role;

create temporary table wishlist_identity_ctx as
select
  w.id as wishlist_id,
  w.couple_id as source_couple_id,
  i.code as invite_code,
  null::uuid as target_couple_id
from public.wishlist_places w
join public.couple_invites i on i.couple_id = w.couple_id and i.status = 'active'
limit 1;

/* ---------- B joins and may edit shared place content ---------- */

select set_config('request.jwt.claims', json_build_object('sub', '88888888-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.join_couple_with_code(
  (select invite_code from wishlist_identity_ctx),
  'req-wishlist-b-join',
  'B'
);
reset role;

/* ---------- C creates a different couple that must never receive the row ---------- */

select set_config('request.jwt.claims', json_build_object('sub', '88888888-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('C', null, 'req-wishlist-c-create');
reset role;

update wishlist_identity_ctx
set target_couple_id = (
  select couple_id
  from public.couple_members
  where user_id = '88888888-0000-0000-0000-000000000003' and left_at is null
);

select set_config('request.jwt.claims', json_build_object('sub', '88888888-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  format(
    $$update public.wishlist_places
         set place_name = %L,
             place_category = %L,
             place_snapshot = %L::jsonb,
             place_snapshot_at = now()
       where id = %L$$,
    '서울숲',
    '공원',
    '{"name":"서울숲","category":"공원"}',
    (select wishlist_id from wishlist_identity_ctx)
  ),
  'the partner may update supported shared wishlist content'
);
select is(
  (select place_name from public.wishlist_places where id = (select wishlist_id from wishlist_identity_ctx)),
  '서울숲',
  'the permitted content update is persisted'
);

select throws_ok(
  format(
    $$update public.wishlist_places set created_by = %L where id = %L$$,
    '88888888-0000-0000-0000-000000000002',
    (select wishlist_id from wishlist_identity_ctx)
  ),
  'TW003',
  null,
  'the partner cannot forge who originally picked the place'
);
select is(
  (select created_by::text from public.wishlist_places where id = (select wishlist_id from wishlist_identity_ctx)),
  '88888888-0000-0000-0000-000000000001',
  'the original picker remains unchanged after the rejected update'
);

select throws_ok(
  format(
    $$update public.wishlist_places set couple_id = %L where id = %L$$,
    (select target_couple_id from wishlist_identity_ctx),
    (select wishlist_id from wishlist_identity_ctx)
  ),
  'TW003',
  null,
  'the partner cannot move the wishlist row to another couple'
);
select is(
  (select couple_id::text from public.wishlist_places where id = (select wishlist_id from wishlist_identity_ctx)),
  (select source_couple_id::text from wishlist_identity_ctx),
  'the wishlist row remains with its original couple'
);

reset role;
select * from finish();
rollback;

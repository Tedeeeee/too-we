-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: invite lifecycle and the distinctions the client has to branch on —
-- unknown, expired, consumed, capacity, own couple, rate limited — plus the
-- declarative guards that hold even without the RPC.
--
-- The genuinely concurrent case (two joiners racing on one code) needs two
-- sessions and cannot be expressed in a single pgTAP transaction. It is covered
-- structurally instead: see the "invite concurrency" note in supabase/README.md
-- for the two-session pgbench recipe.

begin;
select plan(12);

create extension if not exists pgtap;

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('eeeeeeee-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('eeeeeeee-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

/* ---------- declarative guards ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.create_couple('E1', null, 'req-e-create');
create temporary table ctx as
select
  (select couple_id from public.couple_members where user_id = 'eeeeeeee-0000-0000-0000-000000000001') as couple_id,
  (select code from public.couple_invites where status = 'active') as code;

select is(
  (public.create_couple('E1 again', null, 'req-e-create-2') -> 'error' ->> 'code'),
  'active_membership_conflict',
  'a user already in an active couple cannot create another'
);

select is(
  (public.join_couple_with_code((select code from ctx), 'req-e-self') -> 'error' ->> 'code'),
  'invite_own_couple',
  'joining your own code is its own outcome'
);

select is(
  (public.join_couple_with_code('000000', 'req-e-unknown') -> 'error' ->> 'code'),
  'invite_not_found',
  'an unknown code is distinguished from a used one'
);

select is(
  (public.join_couple_with_code('12345', 'req-e-short') -> 'error' ->> 'code'),
  'validation_error',
  'a malformed code is a validation error, not a lookup'
);
reset role;

-- One active invite per couple: reissuing revokes the old one.
select is((select count(*)::int from public.couple_invites where status = 'active'), 1, 'one active invite');
select throws_ok(
  format(
    $$insert into public.couple_invites (couple_id, code) values (%L, '999999')$$,
    (select couple_id from ctx)
  ),
  '23505',
  null,
  'a second active invite for the same couple violates the partial unique index'
);

-- One active couple per user, enforced without the RPC.
select throws_ok(
  format(
    $$insert into public.couple_members (couple_id, user_id, slot)
      values (%L, 'eeeeeeee-0000-0000-0000-000000000001', 2)$$,
    (select couple_id from ctx)
  ),
  '23505',
  null,
  'a user cannot hold two active memberships'
);

/* ---------- expiry is distinguished from consumption ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
reset role;

update public.couple_invites set expires_at = now() - interval '1 minute' where status = 'active';

set local role authenticated;
select is(
  (public.join_couple_with_code((select code from ctx), 'req-e-expired') -> 'error' ->> 'code'),
  'invite_expired',
  'an expired code is its own outcome'
);
reset role;

-- The expired attempt revoked the code, so the couple reissues.
select set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok((public.reissue_couple_invite('req-e-reissue') -> 'ok')::boolean, 'the couple reissues a code');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(
  (
    public.join_couple_with_code(
      (select code from public.couple_invites where status = 'active'),
      'req-e-join'
    ) -> 'ok'
  )::boolean,
  'the second member joins on the reissued code'
);
reset role;

/* ---------- a full couple and a used code ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (
    public.join_couple_with_code(
      (select code from public.couple_invites where status = 'consumed' limit 1),
      'req-e-third'
    ) -> 'error' ->> 'code'
  ),
  'invite_consumed',
  'a consumed code is distinguished from an expired one'
);
reset role;

-- Slot uniqueness caps the couple at two even if a code were reused.
select throws_ok(
  format(
    $$insert into public.couple_members (couple_id, user_id, slot)
      values (%L, 'eeeeeeee-0000-0000-0000-000000000003', 1)$$,
    (select couple_id from ctx)
  ),
  '23505',
  null,
  'a third active member cannot take an occupied slot'
);

select * from finish();
rollback;

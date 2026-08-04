-- NOT EXECUTED IN THIS WORKSPACE. See supabase/README.md.
--
-- Scenario: the invite lifecycle fails closed when its lifetime is unconfigured,
-- and every rejection the client has to branch on is distinguishable — unknown,
-- expired, consumed, own couple, capacity, membership conflict — including on a
-- repeated attempt with the same code.
--
-- The genuinely concurrent case (two joiners racing on one code) needs two
-- sessions and cannot be expressed in a single pgTAP transaction. It is covered
-- structurally instead: see the "invite concurrency" note in supabase/README.md
-- for the two-session pgbench recipe.

begin;

-- A pg_prove session does not see pgTAP in the extensions schema on its own.
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(19);

insert into auth.users (id, instance_id, aud, role, is_anonymous)
values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('eeeeeeee-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true),
  ('eeeeeeee-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true);

/* ---------- fail closed while the lifetime is unconfigured ---------- */

select set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- The production seed ships invite_ttl_seconds unresolved, so nothing is
-- issuable until the external gate sets it.
select throws_ok(
  $$select public.create_couple('E1', null, 'req-e-unset')$$,
  'TW014',
  null,
  'an unresolved invite lifetime refuses to issue a code'
);
reset role;

update app.config set value = to_jsonb(0), resolved = true where key = 'invite_ttl_seconds';
set local role authenticated;
select throws_ok(
  $$select public.create_couple('E1', null, 'req-e-zero')$$,
  'TW014',
  null,
  'a zero lifetime is refused'
);
reset role;

update app.config set value = to_jsonb(-60), resolved = true where key = 'invite_ttl_seconds';
set local role authenticated;
select throws_ok(
  $$select public.create_couple('E1', null, 'req-e-negative')$$,
  'TW014',
  null,
  'a negative lifetime is refused'
);
reset role;

select is(
  (select count(*)::int from public.couple_invites),
  0,
  'no code was inserted while the lifetime was invalid'
);

-- Test-only resolution of the operating value.
update app.config set value = to_jsonb(3600), resolved = true where key = 'invite_ttl_seconds';

/* ---------- declarative guards ---------- */

set local role authenticated;
select public.create_couple('E1', null, 'req-e-create');
reset role;

create temporary table ctx as
select
  (select couple_id from public.couple_members where user_id = 'eeeeeeee-0000-0000-0000-000000000001') as couple_id,
  (select code from public.couple_invites where status = 'active') as code;

select isnt(
  (select expires_at from public.couple_invites where status = 'active'),
  null,
  'an issued code always carries an expiry'
);

set local role authenticated;
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
    $$insert into public.couple_invites (couple_id, code, expires_at)
      values (%L, '999999', now() + interval '1 hour')$$,
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

/* ---------- expiry stays distinguishable from revocation ---------- */

update public.couple_invites set expires_at = now() - interval '1 minute' where status = 'active';

select set_config('request.jwt.claims', json_build_object('sub', 'eeeeeeee-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (public.join_couple_with_code((select code from ctx), 'req-e-expired') -> 'error' ->> 'code'),
  'invite_expired',
  'an expired code is its own outcome'
);

-- The regression: the first attempt retires the code, and a second attempt on the
-- same code must still say expired rather than degrading to revoked.
select is(
  (public.join_couple_with_code((select code from ctx), 'req-e-expired-2') -> 'error' ->> 'code'),
  'invite_expired',
  'a repeated attempt on an expired code still reports expiry'
);
reset role;

select is(
  (select status from public.couple_invites where code = (select code from ctx)),
  'expired',
  'expiry is a terminal status of its own, not a flavour of revoked'
);

-- The couple reissues, and the freshly revoked code reports revocation, not expiry.
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

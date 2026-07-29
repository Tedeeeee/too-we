-- 오늘,우리는 — MVP schema, RLS and RPC contract.
--
-- Spec: docs/specs/2026-07-29-mvp-functional-spec.md
--
-- Model in one line: two anonymous auth users form one active couple; a visit is
-- shared couple data, a visit entry (한 줄 + 별점) is per-user data, photos and
-- tags hang off the visit, and a wishlist place is independent of visits.
--
-- Security posture
--   * Every table created here has RLS enabled.
--   * All client policies target the `authenticated` role only. Anonymous
--     Supabase sessions are `authenticated` with is_anonymous = true; the `anon`
--     role (no JWT) is granted nothing.
--   * Couple scoping is decided by narrow SECURITY DEFINER helpers in the `app`
--     schema with a fixed empty search_path. They are definer so a policy on
--     couple_members can consult couple_members without recursing.
--   * The `app` schema is not exposed to PostgREST; the internal tables in it
--     have RLS on and no policies, and privileges revoked from client roles.
--   * No browser flow needs the service role. Only the purge worker RPCs are
--     granted to service_role, and they are revoked from anon/authenticated.
--
-- Deferred operating values live in app.config, marked resolved = false. See
-- supabase/README.md for the external gate list.

/* ------------------------------------------------------------------ */
/* 0. internal schema                                                  */
/* ------------------------------------------------------------------ */

create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated;
grant usage on schema app to service_role;

/* ------------------------------------------------------------------ */
/* 1. profiles — additive, never destructive                           */
/* ------------------------------------------------------------------ */

-- profiles may already exist in a Supabase project, so every step here is
-- conditional and nothing is ever dropped or narrowed.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade
);

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- NOT VALID so a pre-existing row with an untrimmed name cannot fail the
-- migration; the constraint still applies to every new write.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_display_name_trimmed'
  ) then
    alter table public.profiles
      add constraint profiles_display_name_trimmed
      check (
        display_name is null
        or (
          btrim(display_name) = display_name
          and char_length(display_name) between 1 and 60
        )
      )
      not valid;
  end if;
end
$$;

/* ------------------------------------------------------------------ */
/* 2. couple, membership, invites                                      */
/* ------------------------------------------------------------------ */

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'disconnected')),
  created_by uuid references public.profiles (id) on delete set null,
  started_on date,
  connected_at timestamptz,
  disconnected_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couples_status_matches_timestamp check (
    (status = 'active' and disconnected_at is null)
    or (status = 'disconnected' and disconnected_at is not null)
  )
);

comment on table public.couples is
  'One active couple per user, at most two active members. Disconnect keeps the row so a purge job can be audited.';

-- `slot` is what makes "at most two active members" declarative: the slot is
-- 1 or 2 and unique per couple among the active rows.
create table public.couple_members (
  couple_id uuid not null references public.couples (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (couple_id, user_id)
);

create table public.couple_invites (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{6}$'),
  status text not null default 'active'
    check (status in ('active', 'consumed', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  expired_at timestamptz,
  constraint couple_invites_consumed_stamp check (status <> 'consumed' or consumed_at is not null),
  constraint couple_invites_revoked_stamp check (status <> 'revoked' or revoked_at is not null),
  constraint couple_invites_expired_stamp check (status <> 'expired' or expired_at is not null)
);

comment on column public.couple_invites.expires_at is
  'Never null. A code with no lifetime is not issuable: app.issue_invite fails closed when invite_ttl_seconds is unresolved.';

comment on column public.couple_invites.expired_at is
  'Expiry is its own terminal status, not a flavour of revoked, so a repeated attempt on the same code still answers invite_expired.';

/* ------------------------------------------------------------------ */
/* 3. flower bookmarks — the seven keys the app already ships           */
/* ------------------------------------------------------------------ */

-- Keys must stay 1:1 with FLOWERS in src/data/fixtures.js. Display name, 꽃말
-- and colour stay in the frontend tokens; only the key is a database concern.
create table public.flowers (
  key text primary key check (btrim(key) = key and char_length(key) between 1 and 40),
  sort_order smallint not null,
  created_at timestamptz not null default now()
);

insert into public.flowers (key, sort_order) values
  ('rose', 1),
  ('marigold', 2),
  ('calla', 3),
  ('clover', 4),
  ('forgetmenot', 5),
  ('lilac', 6),
  ('jasmine', 7)
on conflict (key) do nothing;

/* ------------------------------------------------------------------ */
/* 4. visits — shared couple data with a Kakao place snapshot           */
/* ------------------------------------------------------------------ */

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  visited_at timestamptz not null,
  place_provider text not null default 'kakao' check (place_provider in ('kakao', 'manual')),
  place_provider_id text,
  place_name text not null check (
    btrim(place_name) = place_name and char_length(place_name) between 1 and 200
  ),
  place_category text,
  place_address text,
  place_road_address text,
  place_phone text,
  place_url text,
  place_lat double precision check (place_lat is null or place_lat between -90 and 90),
  place_lng double precision check (place_lng is null or place_lng between -180 and 180),
  place_snapshot jsonb not null default '{}'::jsonb,
  place_snapshot_at timestamptz not null default now(),
  flower_key text references public.flowers (key) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.visits.place_snapshot is
  'Raw external place payload captured at record time so a later Kakao change cannot rewrite history.';

-- Per-user 한 줄 and 별점. `note` is optional; when present it is already
-- trimmed and non-empty, so "cleared the line" is exactly note is null.
create table public.visit_entries (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  note text check (
    note is null
    or (btrim(note) = note and char_length(note) >= 1 and char_length(note) <= 1000)
  ),
  rating smallint check (rating is null or rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.visit_entries.note is
  'Maps to entries[].text in the app data shape. Named note to avoid using the type name text as a column name.';

create table public.visit_tags (
  visit_id uuid not null references public.visits (id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 20),
  label text not null check (
    btrim(label) = label and char_length(label) between 1 and 200
  ),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (visit_id, ordinal)
);

-- ordinal 1..5 plus unique (visit_id, ordinal) is the declarative "at most five
-- photos per visit". No file size or MIME constraint here on purpose: those are
-- storage bucket settings and are still blocked on the external gate.
create table public.visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 5),
  storage_bucket text not null default 'visit-photos',
  storage_path text not null check (
    btrim(storage_path) = storage_path and char_length(storage_path) >= 1
  ),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* 5. wishlist places — independent of visits                          */
/* ------------------------------------------------------------------ */

create table public.wishlist_places (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  place_provider text not null default 'kakao' check (place_provider in ('kakao', 'manual')),
  place_provider_id text,
  place_name text not null check (
    btrim(place_name) = place_name and char_length(place_name) between 1 and 200
  ),
  place_category text,
  place_address text,
  place_road_address text,
  place_url text,
  place_lat double precision check (place_lat is null or place_lat between -90 and 90),
  place_lng double precision check (place_lng is null or place_lng between -180 and 180),
  place_snapshot jsonb not null default '{}'::jsonb,
  place_snapshot_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.wishlist_places is
  'MVP never auto-completes a wishlist place into a visit; there is deliberately no visit foreign key.';

/* ------------------------------------------------------------------ */
/* 6. internal tables (app schema, no client access)                   */
/* ------------------------------------------------------------------ */

create table app.config (
  key text primary key,
  value jsonb,
  resolved boolean not null default false,
  description text not null,
  updated_at timestamptz not null default now(),
  constraint config_resolved_needs_value check (resolved = false or value is not null)
);

-- EXTERNAL GATE: every row below is resolved = false. The values that are still
-- null have no safe default and must be set with the user before launch; the
-- ones carrying a number are provisional and tunable without a migration.
insert into app.config (key, value, resolved, description) values
  ('invite_ttl_seconds', null, false,
   'EXTERNAL GATE: invite code lifetime in seconds. While unresolved, app.issue_invite refuses to issue and couple creation fails closed; there is no fallback lifetime.'),
  ('invite_attempt_max', '10'::jsonb, false,
   'EXTERNAL GATE (provisional): failed invite attempts allowed per user per window.'),
  ('invite_attempt_window_seconds', '600'::jsonb, false,
   'EXTERNAL GATE (provisional): rate limit window in seconds for invite attempts.'),
  ('photo_max_bytes', null, false,
   'EXTERNAL GATE: per file upload cap. Enforced by the storage bucket setting, never in SQL.'),
  ('photo_allowed_mime_types', null, false,
   'EXTERNAL GATE: accepted upload types. Enforced by the storage bucket setting, never in SQL.'),
  ('purge_max_attempts', '10'::jsonb, false,
   'EXTERNAL GATE (provisional): purge retries before a job is parked as failed for operator follow up.')
on conflict (key) do nothing;

-- Rate limiting for repeated invite guesses. Referencing auth.users rather than
-- profiles because an attempt can precede profile creation.
create table app.invite_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code text,
  outcome text not null check (
    outcome in (
      'joined', 'invalid', 'not_found', 'expired', 'consumed',
      'revoked', 'capacity', 'conflict', 'own_couple', 'rate_limited'
    )
  ),
  attempted_at timestamptz not null default now()
);

create table app.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  operation text not null check (btrim(operation) = operation and char_length(operation) >= 1),
  request_key text not null check (
    btrim(request_key) = request_key and char_length(request_key) between 1 and 200
  ),
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table app.idempotency_keys is
  'A row with a null response is a claim held by an in-flight request; the stored response is what a replay returns.';

create table app.purge_jobs (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples (id) on delete cascade,
  reason text not null default 'disconnect' check (reason in ('disconnect')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '24 hours'),
  attempts integer not null default 0,
  last_error text,
  started_at timestamptz,
  db_purged_at timestamptz,
  objects_purged_at timestamptz,
  completed_at timestamptz
);

comment on column app.purge_jobs.due_at is
  'Spec target: permanent deletion within 24 hours of the disconnect request.';

-- Object paths are snapshotted at disconnect time, because the metadata rows are
-- gone by the time the worker deletes the files.
create table app.purge_job_objects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references app.purge_jobs (id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  is_prefix boolean not null default false,
  deleted_at timestamptz
);

/* ------------------------------------------------------------------ */
/* 7. indexes and uniqueness rules                                     */
/* ------------------------------------------------------------------ */

-- one active couple per user
create unique index couple_members_one_active_couple_per_user
  on public.couple_members (user_id)
  where left_at is null;

-- at most two active members per couple
create unique index couple_members_active_slot
  on public.couple_members (couple_id, slot)
  where left_at is null;

create index couple_members_active_couple_idx
  on public.couple_members (couple_id)
  where left_at is null;

-- one active invite per couple, and an unambiguous active code lookup
create unique index couple_invites_one_active_per_couple
  on public.couple_invites (couple_id)
  where status = 'active';

create unique index couple_invites_active_code
  on public.couple_invites (code)
  where status = 'active';

create index couple_invites_couple_idx on public.couple_invites (couple_id);

create index visits_couple_visited_idx on public.visits (couple_id, visited_at desc);
create index visits_place_idx on public.visits (couple_id, place_provider, place_provider_id);

-- one entry per visit and author
create unique index visit_entries_one_per_author
  on public.visit_entries (visit_id, author_id);

create index visit_entries_author_idx on public.visit_entries (author_id);

-- at most five photos per visit, and one metadata row per stored object
create unique index visit_photos_ordinal on public.visit_photos (visit_id, ordinal);
create unique index visit_photos_object on public.visit_photos (storage_bucket, storage_path);
create index visit_photos_uploader_idx on public.visit_photos (uploader_id);

create index wishlist_places_couple_idx on public.wishlist_places (couple_id, created_at desc);

create unique index flowers_sort_order on public.flowers (sort_order);

create unique index idempotency_keys_request
  on app.idempotency_keys (user_id, operation, request_key);

create index invite_attempts_user_idx on app.invite_attempts (user_id, attempted_at desc);

-- one open purge job per couple
create unique index purge_jobs_open_per_couple
  on app.purge_jobs (couple_id)
  where status in ('queued', 'running');

create index purge_jobs_due_idx on app.purge_jobs (status, due_at);

create index purge_job_objects_pending_idx
  on app.purge_job_objects (job_id)
  where deleted_at is null;

/* ------------------------------------------------------------------ */
/* 8. error taxonomy                                                   */
/* ------------------------------------------------------------------ */

-- Custom SQLSTATE class TW: the first two characters avoid the ranges reserved
-- by the SQL standard and by PostgreSQL, so a client can branch on the code
-- without string matching the message.
create or replace function app.error_sqlstate(p_code text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_code
    when 'validation_error' then 'TW001'
    when 'not_found' then 'TW002'
    when 'forbidden' then 'TW003'
    when 'rate_limited' then 'TW004'
    when 'invite_not_found' then 'TW005'
    when 'invite_expired' then 'TW006'
    when 'invite_consumed' then 'TW007'
    when 'invite_revoked' then 'TW008'
    when 'invite_own_couple' then 'TW009'
    when 'couple_capacity_reached' then 'TW010'
    when 'active_membership_conflict' then 'TW011'
    when 'photo_limit_reached' then 'TW012'
    when 'conflict' then 'TW013'
    when 'config_unresolved' then 'TW014'
    when 'purge_incomplete' then 'TW015'
    else 'TW099'
  end
$fn$;

-- Hard failure: aborts the transaction. Used for a missing session and for
-- invariant violations, never for an outcome that must be recorded.
create or replace function app.raise_error(p_code text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception '%', p_code
    using errcode = app.error_sqlstate(p_code),
          hint = p_code,
          detail = coalesce(p_details, '{}'::jsonb)::text;
end
$fn$;

create or replace function app.ok_result(p_data jsonb, p_replayed boolean default false)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'ok', true,
    'replayed', coalesce(p_replayed, false),
    'data', coalesce(p_data, '{}'::jsonb)
  )
$fn$;

-- Soft failure: returns a discriminated envelope so the transaction commits and
-- anything already written in it (an invite attempt row, for instance) survives.
-- Releases the idempotency claim so the caller may legitimately retry.
create or replace function app.error_result(
  p_code text,
  p_details jsonb default '{}'::jsonb,
  p_user_id uuid default null,
  p_operation text default null,
  p_request_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_user_id is not null and p_operation is not null and p_request_key is not null then
    delete from app.idempotency_keys
     where user_id = p_user_id
       and operation = p_operation
       and request_key = p_request_key
       and response is null;
  end if;

  return jsonb_build_object(
    'ok', false,
    'replayed', false,
    'error', jsonb_build_object(
      'code', p_code,
      'sqlstate', app.error_sqlstate(p_code),
      'details', coalesce(p_details, '{}'::jsonb)
    )
  );
end
$fn$;

/* ------------------------------------------------------------------ */
/* 9. configuration and casting helpers                                */
/* ------------------------------------------------------------------ */

create or replace function app.config_value(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.value from app.config c where c.key = p_key
$fn$;

create or replace function app.config_int(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select (c.value #>> '{}')::integer
    from app.config c
   where c.key = p_key
     and c.value is not null
     and jsonb_typeof(c.value) = 'number'
$fn$;

-- Fails closed. An operating value that was never agreed at the external gate
-- stops the flow with a named error instead of turning into an invented default,
-- which is how a "no expiry" invite code could otherwise be issued.
create or replace function app.require_config_seconds(p_key text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_row app.config;
  v_seconds numeric;
begin
  select * into v_row from app.config c where c.key = p_key;

  if not found then
    perform app.raise_error(
      'config_unresolved', jsonb_build_object('key', p_key, 'reason', 'missing')
    );
  end if;

  if not v_row.resolved or v_row.value is null then
    perform app.raise_error(
      'config_unresolved', jsonb_build_object('key', p_key, 'reason', 'unresolved')
    );
  end if;

  if jsonb_typeof(v_row.value) <> 'number' then
    perform app.raise_error(
      'config_unresolved', jsonb_build_object('key', p_key, 'reason', 'not_a_number')
    );
  end if;

  v_seconds := (v_row.value #>> '{}')::numeric;

  -- Zero and negative are rejected, and the upper bound is the integer limit
  -- rather than an invented maximum lifetime.
  if v_seconds < 1 or v_seconds > 2147483647 then
    perform app.raise_error(
      'config_unresolved',
      jsonb_build_object('key', p_key, 'reason', 'not_positive', 'value', v_row.value)
    );
  end if;

  return floor(v_seconds)::integer;
end
$fn$;

create or replace function app.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  return p_value::uuid;
exception
  when others then
    return null;
end
$fn$;

create or replace function app.try_double(p_value text)
returns double precision
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  return p_value::double precision;
exception
  when others then
    return null;
end
$fn$;

create or replace function app.try_bigint(p_value text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  return p_value::bigint;
exception
  when others then
    return null;
end
$fn$;

create or replace function app.user_lock_key(p_user_id uuid)
returns bigint
language sql
immutable
set search_path = ''
as $fn$
  select hashtextextended(coalesce(p_user_id::text, ''), 0)
$fn$;

/* ------------------------------------------------------------------ */
/* 10. membership helpers used by the policies                         */
/* ------------------------------------------------------------------ */

-- Definer so a policy on couple_members can consult couple_members without
-- recursing, and so a disconnected couple disappears from every scope at once.
create or replace function app.current_couple_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.couple_id
    from public.couple_members m
    join public.couples c on c.id = m.couple_id
   where m.user_id = auth.uid()
     and m.left_at is null
     and c.status = 'active'
   limit 1
$fn$;

create or replace function app.is_active_member(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.couple_members m
      join public.couples c on c.id = m.couple_id
     where m.couple_id = p_couple_id
       and m.user_id = auth.uid()
       and m.left_at is null
       and c.status = 'active'
  )
$fn$;

create or replace function app.shares_active_couple(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.couple_members mine
      join public.couples c on c.id = mine.couple_id
      join public.couple_members theirs
        on theirs.couple_id = mine.couple_id
       and theirs.left_at is null
     where mine.user_id = auth.uid()
       and mine.left_at is null
       and c.status = 'active'
       and theirs.user_id = p_user_id
  )
$fn$;

create or replace function app.can_read_visit(p_visit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.visits v
      join public.couple_members m on m.couple_id = v.couple_id
      join public.couples c on c.id = v.couple_id
     where v.id = p_visit_id
       and m.user_id = auth.uid()
       and m.left_at is null
       and c.status = 'active'
  )
$fn$;

/* ------------------------------------------------------------------ */
/* 11. trigger functions                                               */
/* ------------------------------------------------------------------ */

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

-- Blank text means "no 한 줄 yet", which is what puts the visit back on the
-- waiting card for that user.
create or replace function app.normalize_visit_entry()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  return new;
end
$fn$;

-- The shared reorder is the only thing a member may change on a photo metadata
-- row. Everything else — id, visit_id, uploader_id, bucket, path, content
-- metadata, checksum, created_at, and any column added later — is immutable once
-- the object is registered. An allow-list rather than a deny-list, so a new
-- column is immutable by default instead of silently writable.
create or replace function app.guard_visit_photo_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (to_jsonb(old) - 'ordinal' - 'updated_at')
     is distinct from (to_jsonb(new) - 'ordinal' - 'updated_at') then
    perform app.raise_error(
      'forbidden', jsonb_build_object('reason', 'only_ordinal_is_mutable')
    );
  end if;
  return new;
end
$fn$;

-- Identity columns of the other shared tables stay fixed after insert.
--
-- Definer because it calls app.raise_error, and a nested call from an invoker
-- function would be privilege checked against the client role.
create or replace function app.guard_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_column text;
begin
  foreach v_column in array tg_argv loop
    if (v_old ->> v_column) is distinct from (v_new ->> v_column) then
      perform app.raise_error(
        'forbidden',
        jsonb_build_object('column', v_column, 'reason', 'immutable')
      );
    end if;
  end loop;
  return new;
end
$fn$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

create trigger couples_set_updated_at
  before update on public.couples
  for each row execute function app.set_updated_at();

create trigger visits_set_updated_at
  before update on public.visits
  for each row execute function app.set_updated_at();

create trigger visit_entries_normalize
  before insert or update on public.visit_entries
  for each row execute function app.normalize_visit_entry();

create trigger visit_entries_set_updated_at
  before update on public.visit_entries
  for each row execute function app.set_updated_at();

create trigger visit_photos_set_updated_at
  before update on public.visit_photos
  for each row execute function app.set_updated_at();

create trigger visit_photos_guard_columns
  before update on public.visit_photos
  for each row execute function app.guard_visit_photo_columns();

create trigger visit_entries_guard_immutable
  before update on public.visit_entries
  for each row execute function app.guard_immutable_columns('visit_id', 'author_id');

create trigger visits_guard_immutable
  before update on public.visits
  for each row execute function app.guard_immutable_columns('couple_id');

create trigger wishlist_places_set_updated_at
  before update on public.wishlist_places
  for each row execute function app.set_updated_at();

/* ------------------------------------------------------------------ */
/* 12. invite helpers                                                  */
/* ------------------------------------------------------------------ */

-- Six digits drawn from gen_random_uuid so the code is not predictable from a
-- session seeded PRNG. The code is shareable, not secret; guessing is bounded by
-- the attempt limit and by there being at most one active code per couple.
create or replace function app.new_invite_code()
returns text
language sql
volatile
set search_path = ''
as $fn$
  select lpad(
    (
      mod(
        ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))::bit(28)::integer,
        1000000
      )
    )::text,
    6,
    '0'
  )
$fn$;

create or replace function app.invite_public_json(p_invite public.couple_invites)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'code', p_invite.code,
    'status', p_invite.status,
    'expires_at', p_invite.expires_at
  )
$fn$;

-- Revokes the previous active invite, so "one active invite per couple" holds
-- and a code that was already handed out cannot be reused.
create or replace function app.issue_invite(p_couple_id uuid, p_created_by uuid)
returns public.couple_invites
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ttl integer;
  v_expires timestamptz;
  v_invite public.couple_invites;
  v_attempt integer := 0;
begin
  -- First, and before any write: an unconfigured lifetime must not silently
  -- become a code that never expires, and a rejected configuration must not have
  -- already revoked the couple's working code.
  v_ttl := app.require_config_seconds('invite_ttl_seconds');
  v_expires := now() + make_interval(secs => v_ttl);

  update public.couple_invites
     set status = 'revoked',
         revoked_at = now()
   where couple_id = p_couple_id
     and status = 'active';

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.couple_invites (couple_id, code, expires_at, created_by)
      values (p_couple_id, app.new_invite_code(), v_expires, p_created_by)
      returning * into v_invite;
      return v_invite;
    exception
      when unique_violation then
        if v_attempt >= 12 then
          perform app.raise_error('conflict', jsonb_build_object('reason', 'invite_code_exhausted'));
        end if;
    end;
  end loop;
end
$fn$;

create or replace function app.log_invite_attempt(p_user_id uuid, p_code text, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into app.invite_attempts (user_id, code, outcome)
  values (p_user_id, nullif(btrim(coalesce(p_code, '')), ''), p_outcome);
end
$fn$;

/* ------------------------------------------------------------------ */
/* 13. idempotency helpers                                             */
/* ------------------------------------------------------------------ */

-- Returns null when the caller owns the claim and should do the work, or the
-- stored response marked as a replay. A concurrent duplicate blocks on the
-- unique index until the first request commits and then replays its answer.
create or replace function app.begin_idempotent(p_user_id uuid, p_operation text, p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
  v_response jsonb;
begin
  if p_request_key is null then
    return null;
  end if;

  insert into app.idempotency_keys (user_id, operation, request_key)
  values (p_user_id, p_operation, p_request_key)
  on conflict (user_id, operation, request_key) do nothing
  returning id into v_id;

  if v_id is not null then
    return null;
  end if;

  select k.response into v_response
    from app.idempotency_keys k
   where k.user_id = p_user_id
     and k.operation = p_operation
     and k.request_key = p_request_key
   for update;

  if not found then
    -- The competing transaction rolled back and released the key.
    perform app.raise_error('conflict', jsonb_build_object('reason', 'idempotency_race'));
  end if;

  if v_response is null then
    perform app.raise_error('conflict', jsonb_build_object('reason', 'request_in_progress'));
  end if;

  return v_response || jsonb_build_object('replayed', true);
end
$fn$;

create or replace function app.finish_idempotent(
  p_user_id uuid,
  p_operation text,
  p_request_key text,
  p_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_request_key is null then
    return;
  end if;

  update app.idempotency_keys
     set response = p_response,
         completed_at = now()
   where user_id = p_user_id
     and operation = p_operation
     and request_key = p_request_key;
end
$fn$;

/* ------------------------------------------------------------------ */
/* 14. row level security                                             */
/* ------------------------------------------------------------------ */

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.couple_invites enable row level security;
alter table public.flowers enable row level security;
alter table public.visits enable row level security;
alter table public.visit_entries enable row level security;
alter table public.visit_tags enable row level security;
alter table public.visit_photos enable row level security;
alter table public.wishlist_places enable row level security;
alter table app.config enable row level security;
alter table app.invite_attempts enable row level security;
alter table app.idempotency_keys enable row level security;
alter table app.purge_jobs enable row level security;
alter table app.purge_job_objects enable row level security;

-- profiles: own row plus the partner of the active couple.
drop policy if exists profiles_select_self_or_partner on public.profiles;
create policy profiles_select_self_or_partner
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or app.shares_active_couple(id));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- couples, memberships and invites are read only for clients. Every change goes
-- through an RPC that can take the right locks and record the right outcome.
drop policy if exists couples_select_member on public.couples;
create policy couples_select_member
  on public.couples
  for select
  to authenticated
  using (app.is_active_member(id));

drop policy if exists couple_members_select_member on public.couple_members;
create policy couple_members_select_member
  on public.couple_members
  for select
  to authenticated
  using (app.is_active_member(couple_id));

drop policy if exists couple_invites_select_member on public.couple_invites;
create policy couple_invites_select_member
  on public.couple_invites
  for select
  to authenticated
  using (app.is_active_member(couple_id));

drop policy if exists flowers_select_all on public.flowers;
create policy flowers_select_all
  on public.flowers
  for select
  to authenticated
  using (true);

-- visits: shared data. Place, date and time, tags and flower are editable by
-- both active members. Deleting a visit is not an MVP behaviour and has no
-- client policy.
--
-- There is deliberately no insert policy. public.create_visit is the only way in,
-- so the empty-visit invariant and the idempotency boundary cannot be bypassed by
-- a direct insert from the client.
drop policy if exists visits_select_member on public.visits;
create policy visits_select_member
  on public.visits
  for select
  to authenticated
  using (app.is_active_member(couple_id));

drop policy if exists visits_insert_member on public.visits;

drop policy if exists visits_update_member on public.visits;
create policy visits_update_member
  on public.visits
  for update
  to authenticated
  using (app.is_active_member(couple_id))
  with check (app.is_active_member(couple_id));

-- visit entries: readable by both, writable only by their author.
drop policy if exists visit_entries_select_member on public.visit_entries;
create policy visit_entries_select_member
  on public.visit_entries
  for select
  to authenticated
  using (app.can_read_visit(visit_id));

drop policy if exists visit_entries_insert_author on public.visit_entries;
create policy visit_entries_insert_author
  on public.visit_entries
  for insert
  to authenticated
  with check (author_id = auth.uid() and app.can_read_visit(visit_id));

drop policy if exists visit_entries_update_author on public.visit_entries;
create policy visit_entries_update_author
  on public.visit_entries
  for update
  to authenticated
  using (author_id = auth.uid() and app.can_read_visit(visit_id))
  with check (author_id = auth.uid() and app.can_read_visit(visit_id));

drop policy if exists visit_entries_delete_author on public.visit_entries;
create policy visit_entries_delete_author
  on public.visit_entries
  for delete
  to authenticated
  using (author_id = auth.uid() and app.can_read_visit(visit_id));

-- tags are shared, so both members may add, reorder and remove them.
drop policy if exists visit_tags_select_member on public.visit_tags;
create policy visit_tags_select_member
  on public.visit_tags
  for select
  to authenticated
  using (app.can_read_visit(visit_id));

drop policy if exists visit_tags_insert_member on public.visit_tags;
create policy visit_tags_insert_member
  on public.visit_tags
  for insert
  to authenticated
  with check (app.can_read_visit(visit_id));

drop policy if exists visit_tags_update_member on public.visit_tags;
create policy visit_tags_update_member
  on public.visit_tags
  for update
  to authenticated
  using (app.can_read_visit(visit_id))
  with check (app.can_read_visit(visit_id));

drop policy if exists visit_tags_delete_member on public.visit_tags;
create policy visit_tags_delete_member
  on public.visit_tags
  for delete
  to authenticated
  using (app.can_read_visit(visit_id));

-- photos: both members may reorder, only the uploader may delete. The immutable
-- column trigger keeps a reorder from repointing someone else's object.
drop policy if exists visit_photos_select_member on public.visit_photos;
create policy visit_photos_select_member
  on public.visit_photos
  for select
  to authenticated
  using (app.can_read_visit(visit_id));

drop policy if exists visit_photos_insert_uploader on public.visit_photos;
create policy visit_photos_insert_uploader
  on public.visit_photos
  for insert
  to authenticated
  with check (uploader_id = auth.uid() and app.can_read_visit(visit_id));

drop policy if exists visit_photos_update_member on public.visit_photos;
create policy visit_photos_update_member
  on public.visit_photos
  for update
  to authenticated
  using (app.can_read_visit(visit_id))
  with check (app.can_read_visit(visit_id));

drop policy if exists visit_photos_delete_uploader on public.visit_photos;
create policy visit_photos_delete_uploader
  on public.visit_photos
  for delete
  to authenticated
  using (uploader_id = auth.uid() and app.can_read_visit(visit_id));

-- wishlist: shared couple data with no author restriction in the spec.
drop policy if exists wishlist_places_select_member on public.wishlist_places;
create policy wishlist_places_select_member
  on public.wishlist_places
  for select
  to authenticated
  using (app.is_active_member(couple_id));

drop policy if exists wishlist_places_insert_member on public.wishlist_places;
create policy wishlist_places_insert_member
  on public.wishlist_places
  for insert
  to authenticated
  with check (app.is_active_member(couple_id) and created_by = auth.uid());

drop policy if exists wishlist_places_update_member on public.wishlist_places;
create policy wishlist_places_update_member
  on public.wishlist_places
  for update
  to authenticated
  using (app.is_active_member(couple_id))
  with check (app.is_active_member(couple_id));

drop policy if exists wishlist_places_delete_member on public.wishlist_places;
create policy wishlist_places_delete_member
  on public.wishlist_places
  for delete
  to authenticated
  using (app.is_active_member(couple_id));

/* ------------------------------------------------------------------ */
/* 15. table privileges                                                */
/* ------------------------------------------------------------------ */

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

revoke all on table public.couples from anon, authenticated;
grant select on table public.couples to authenticated;

revoke all on table public.couple_members from anon, authenticated;
grant select on table public.couple_members to authenticated;

revoke all on table public.couple_invites from anon, authenticated;
grant select on table public.couple_invites to authenticated;

revoke all on table public.flowers from anon, authenticated;
grant select on table public.flowers to authenticated;

revoke all on table public.visits from anon, authenticated;
-- No insert: public.create_visit is the only entry point.
grant select, update on table public.visits to authenticated;

revoke all on table public.visit_entries from anon, authenticated;
grant select, insert, update, delete on table public.visit_entries to authenticated;

revoke all on table public.visit_tags from anon, authenticated;
grant select, insert, update, delete on table public.visit_tags to authenticated;

revoke all on table public.visit_photos from anon, authenticated;
grant select, insert, update, delete on table public.visit_photos to authenticated;

revoke all on table public.wishlist_places from anon, authenticated;
grant select, insert, update, delete on table public.wishlist_places to authenticated;

-- Internal tables: no client reach at all.
revoke all on table app.config from anon, authenticated;
revoke all on table app.invite_attempts from anon, authenticated;
revoke all on table app.idempotency_keys from anon, authenticated;
revoke all on table app.purge_jobs from anon, authenticated;
revoke all on table app.purge_job_objects from anon, authenticated;

grant select on table app.purge_jobs to service_role;
grant select on table app.purge_job_objects to service_role;
grant select on table app.config to service_role;

/* ------------------------------------------------------------------ */
/* 16. client RPCs                                                     */
/* ------------------------------------------------------------------ */

-- Definer, and safe because the only row it ever touches is auth.uid()'s own.
-- It needs to be definer to reach the app helpers, which stay unreachable from a
-- client role.
create or replace function public.upsert_my_profile(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_row public.profiles;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');
  if p_display_name is not null and v_name is null then
    return app.error_result('validation_error', jsonb_build_object('field', 'p_display_name'));
  end if;

  insert into public.profiles as p (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do update
     set display_name = coalesce(excluded.display_name, p.display_name)
  returning * into v_row;

  return app.ok_result(
    jsonb_build_object('user_id', v_row.id, 'display_name', v_row.display_name)
  );
end
$fn$;

-- "시작하기" branch: create the couple, take slot 1, issue the first invite.
create or replace function public.create_couple(
  p_display_name text default null,
  p_started_on date default null,
  p_request_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_replay jsonb;
  v_couple public.couples;
  v_invite public.couple_invites;
  v_result jsonb;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;

  v_replay := app.begin_idempotent(v_uid, 'create_couple', p_request_key);
  if v_replay is not null then
    return v_replay;
  end if;

  perform pg_advisory_xact_lock(app.user_lock_key(v_uid));

  if exists (
    select 1
      from public.couple_members m
      join public.couples c on c.id = m.couple_id
     where m.user_id = v_uid
       and m.left_at is null
       and c.status = 'active'
  ) then
    return app.error_result(
      'active_membership_conflict', '{}'::jsonb, v_uid, 'create_couple', p_request_key
    );
  end if;

  insert into public.profiles as p (id, display_name)
  values (v_uid, nullif(btrim(coalesce(p_display_name, '')), ''))
  on conflict (id) do update
     set display_name = coalesce(excluded.display_name, p.display_name);

  insert into public.couples (created_by, started_on)
  values (v_uid, p_started_on)
  returning * into v_couple;

  insert into public.couple_members (couple_id, user_id, slot)
  values (v_couple.id, v_uid, 1);

  v_invite := app.issue_invite(v_couple.id, v_uid);

  v_result := app.ok_result(
    jsonb_build_object(
      'couple_id', v_couple.id,
      'slot', 1,
      'invite', app.invite_public_json(v_invite)
    )
  );
  perform app.finish_idempotent(v_uid, 'create_couple', p_request_key, v_result);
  return v_result;
end
$fn$;

-- Needed because a code can expire or be revoked while still unclaimed.
create or replace function public.reissue_couple_invite(p_request_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_couple_id uuid;
  v_replay jsonb;
  v_invite public.couple_invites;
  v_result jsonb;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;

  v_couple_id := app.current_couple_id();
  if v_couple_id is null then
    return app.error_result('forbidden', jsonb_build_object('reason', 'no_active_couple'));
  end if;

  v_replay := app.begin_idempotent(v_uid, 'reissue_invite', p_request_key);
  if v_replay is not null then
    return v_replay;
  end if;

  perform 1 from public.couples where id = v_couple_id for update;

  if exists (
    select 1
      from public.couple_members m
     where m.couple_id = v_couple_id
       and m.left_at is null
     group by m.couple_id
    having count(*) >= 2
  ) then
    return app.error_result(
      'couple_capacity_reached', '{}'::jsonb, v_uid, 'reissue_invite', p_request_key
    );
  end if;

  v_invite := app.issue_invite(v_couple_id, v_uid);

  v_result := app.ok_result(
    jsonb_build_object('couple_id', v_couple_id, 'invite', app.invite_public_json(v_invite))
  );
  perform app.finish_idempotent(v_uid, 'reissue_invite', p_request_key, v_result);
  return v_result;
end
$fn$;

-- "초대코드를 받았어요" branch.
--
-- Every rejection returns an envelope rather than raising, because a raise would
-- roll back the invite_attempts row and the attempt limit would never count.
create or replace function public.join_couple_with_code(
  p_code text,
  p_request_key text,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_code text := btrim(coalesce(p_code, ''));
  v_replay jsonb;
  v_invite public.couple_invites;
  v_couple public.couples;
  v_active integer;
  v_slot smallint;
  v_max integer;
  v_window integer;
  v_failures integer;
  v_result jsonb;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;
  if p_request_key is null then
    perform app.raise_error('validation_error', jsonb_build_object('field', 'p_request_key'));
  end if;

  v_replay := app.begin_idempotent(v_uid, 'join_couple', p_request_key);
  if v_replay is not null then
    return v_replay;
  end if;

  v_max := app.config_int('invite_attempt_max');
  v_window := app.config_int('invite_attempt_window_seconds');
  if v_max is not null and v_window is not null then
    select count(*) into v_failures
      from app.invite_attempts a
     where a.user_id = v_uid
       and a.outcome <> 'joined'
       and a.attempted_at > now() - make_interval(secs => v_window);

    if v_failures >= v_max then
      perform app.log_invite_attempt(v_uid, v_code, 'rate_limited');
      return app.error_result(
        'rate_limited',
        jsonb_build_object('retry_after_seconds', v_window),
        v_uid, 'join_couple', p_request_key
      );
    end if;
  end if;

  if v_code !~ '^[0-9]{6}$' then
    perform app.log_invite_attempt(v_uid, v_code, 'invalid');
    return app.error_result(
      'validation_error', jsonb_build_object('field', 'p_code'), v_uid, 'join_couple', p_request_key
    );
  end if;

  -- Serialise this caller against their own concurrent requests, then take the
  -- invite row so two joiners of the same code cannot both pass the capacity
  -- check.
  perform pg_advisory_xact_lock(app.user_lock_key(v_uid));

  select * into v_invite
    from public.couple_invites
   where code = v_code
     and status = 'active'
   for update;

  if not found then
    select * into v_invite
      from public.couple_invites
     where code = v_code
     order by created_at desc
     limit 1;

    if not found then
      perform app.log_invite_attempt(v_uid, v_code, 'not_found');
      return app.error_result(
        'invite_not_found', '{}'::jsonb, v_uid, 'join_couple', p_request_key
      );
    end if;

    -- Three distinct terminal states, so a repeated attempt on the same code
    -- keeps answering the same thing it answered the first time.
    if v_invite.status = 'consumed' then
      perform app.log_invite_attempt(v_uid, v_code, 'consumed');
      return app.error_result(
        'invite_consumed',
        jsonb_build_object('consumed_at', v_invite.consumed_at),
        v_uid, 'join_couple', p_request_key
      );
    end if;

    if v_invite.status = 'expired' then
      perform app.log_invite_attempt(v_uid, v_code, 'expired');
      return app.error_result(
        'invite_expired',
        jsonb_build_object('expired_at', v_invite.expires_at),
        v_uid, 'join_couple', p_request_key
      );
    end if;

    perform app.log_invite_attempt(v_uid, v_code, 'revoked');
    return app.error_result('invite_revoked', '{}'::jsonb, v_uid, 'join_couple', p_request_key);
  end if;

  if v_invite.expires_at <= now() then
    -- Expiry gets its own terminal status. Folding it into revoked would make the
    -- second attempt on the same code report invite_revoked instead.
    update public.couple_invites
       set status = 'expired',
           expired_at = now()
     where id = v_invite.id;

    perform app.log_invite_attempt(v_uid, v_code, 'expired');
    return app.error_result(
      'invite_expired',
      jsonb_build_object('expired_at', v_invite.expires_at),
      v_uid, 'join_couple', p_request_key
    );
  end if;

  select * into v_couple from public.couples where id = v_invite.couple_id for update;
  if not found or v_couple.status <> 'active' then
    perform app.log_invite_attempt(v_uid, v_code, 'not_found');
    return app.error_result('invite_not_found', '{}'::jsonb, v_uid, 'join_couple', p_request_key);
  end if;

  if exists (
    select 1
      from public.couple_members m
     where m.couple_id = v_couple.id
       and m.user_id = v_uid
       and m.left_at is null
  ) then
    perform app.log_invite_attempt(v_uid, v_code, 'own_couple');
    return app.error_result('invite_own_couple', '{}'::jsonb, v_uid, 'join_couple', p_request_key);
  end if;

  if exists (
    select 1
      from public.couple_members m
      join public.couples c on c.id = m.couple_id
     where m.user_id = v_uid
       and m.left_at is null
       and c.status = 'active'
  ) then
    perform app.log_invite_attempt(v_uid, v_code, 'conflict');
    return app.error_result(
      'active_membership_conflict', '{}'::jsonb, v_uid, 'join_couple', p_request_key
    );
  end if;

  select count(*) into v_active
    from public.couple_members m
   where m.couple_id = v_couple.id
     and m.left_at is null;

  if v_active >= 2 then
    perform app.log_invite_attempt(v_uid, v_code, 'capacity');
    return app.error_result(
      'couple_capacity_reached', '{}'::jsonb, v_uid, 'join_couple', p_request_key
    );
  end if;

  insert into public.profiles as p (id, display_name)
  values (v_uid, nullif(btrim(coalesce(p_display_name, '')), ''))
  on conflict (id) do update
     set display_name = coalesce(excluded.display_name, p.display_name);

  select coalesce(min(s.slot), 1) into v_slot
    from (values (1::smallint), (2::smallint)) as s (slot)
   where not exists (
     select 1
       from public.couple_members m
      where m.couple_id = v_couple.id
        and m.slot = s.slot
        and m.left_at is null
   );

  -- The slot index is the last line of defence if two joiners somehow got past
  -- the row locks; report it as capacity rather than as an unhandled failure.
  begin
    insert into public.couple_members (couple_id, user_id, slot)
    values (v_couple.id, v_uid, v_slot);
  exception
    when unique_violation then
      perform app.log_invite_attempt(v_uid, v_code, 'capacity');
      return app.error_result(
        'couple_capacity_reached', jsonb_build_object('reason', 'slot_taken'),
        v_uid, 'join_couple', p_request_key
      );
  end;

  update public.couple_invites
     set status = 'consumed',
         consumed_at = now(),
         consumed_by = v_uid
   where id = v_invite.id;

  -- Korean product, so the "함께한지 N일째" counter starts on the local date.
  update public.couples
     set connected_at = coalesce(connected_at, now()),
         started_on = coalesce(started_on, (now() at time zone 'Asia/Seoul')::date)
   where id = v_couple.id;

  perform app.log_invite_attempt(v_uid, v_code, 'joined');

  v_result := app.ok_result(jsonb_build_object('couple_id', v_couple.id, 'slot', v_slot));
  perform app.finish_idempotent(v_uid, 'join_couple', p_request_key, v_result);
  return v_result;
end
$fn$;

-- Empty visit creation, and only that. A new record starts with no flower, no
-- tag, no entry and no photo; those arrive later through their own RPCs. The
-- request key is mandatory so a double submit returns the first visit.
create or replace function public.create_visit(
  p_place jsonb,
  p_visited_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_couple_id uuid;
  v_replay jsonb;
  v_visit public.visits;
  v_name text;
  v_provider text;
  v_lat double precision;
  v_lng double precision;
  v_result jsonb;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;
  if p_request_key is null then
    perform app.raise_error('validation_error', jsonb_build_object('field', 'p_request_key'));
  end if;

  v_couple_id := app.current_couple_id();
  if v_couple_id is null then
    return app.error_result('forbidden', jsonb_build_object('reason', 'no_active_couple'));
  end if;

  v_replay := app.begin_idempotent(v_uid, 'create_visit', p_request_key);
  if v_replay is not null then
    return v_replay;
  end if;

  v_name := nullif(btrim(coalesce(p_place ->> 'name', '')), '');
  if v_name is null or p_visited_at is null then
    return app.error_result(
      'validation_error',
      jsonb_build_object('fields', jsonb_build_array('place.name', 'visited_at')),
      v_uid, 'create_visit', p_request_key
    );
  end if;

  -- Validate the payload here so a malformed place snapshot is a named outcome
  -- rather than a check constraint violation surfacing as an unhandled failure.
  v_provider := coalesce(nullif(btrim(coalesce(p_place ->> 'provider', '')), ''), 'kakao');
  if v_provider not in ('kakao', 'manual') then
    return app.error_result(
      'validation_error', jsonb_build_object('field', 'place.provider'),
      v_uid, 'create_visit', p_request_key
    );
  end if;

  v_lat := app.try_double(p_place ->> 'lat');
  v_lng := app.try_double(p_place ->> 'lng');
  if (v_lat is not null and v_lat not between -90 and 90)
     or (v_lng is not null and v_lng not between -180 and 180) then
    return app.error_result(
      'validation_error',
      jsonb_build_object('fields', jsonb_build_array('place.lat', 'place.lng')),
      v_uid, 'create_visit', p_request_key
    );
  end if;

  -- flower_key is deliberately absent from this list: a new visit is empty.
  insert into public.visits (
    couple_id, visited_at, place_provider, place_provider_id, place_name,
    place_category, place_address, place_road_address, place_phone, place_url,
    place_lat, place_lng, place_snapshot, place_snapshot_at, created_by
  )
  values (
    v_couple_id,
    p_visited_at,
    v_provider,
    nullif(btrim(coalesce(p_place ->> 'provider_id', '')), ''),
    v_name,
    nullif(btrim(coalesce(p_place ->> 'category', '')), ''),
    nullif(btrim(coalesce(p_place ->> 'address', '')), ''),
    nullif(btrim(coalesce(p_place ->> 'road_address', '')), ''),
    nullif(btrim(coalesce(p_place ->> 'phone', '')), ''),
    nullif(btrim(coalesce(p_place ->> 'url', '')), ''),
    v_lat,
    v_lng,
    coalesce(p_place, '{}'::jsonb),
    now(),
    v_uid
  )
  returning * into v_visit;

  v_result := app.ok_result(
    jsonb_build_object('visit_id', v_visit.id, 'couple_id', v_couple_id)
  );
  perform app.finish_idempotent(v_uid, 'create_visit', p_request_key, v_result);
  return v_result;
end
$fn$;

-- A visit the caller cannot see is reported as not_found, so an identifier from
-- another couple leaks nothing about whether it exists.
create or replace function public.upsert_my_visit_entry(
  p_visit_id uuid,
  p_text text default null,
  p_rating smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_note text;
  v_entry public.visit_entries;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;

  if not app.can_read_visit(p_visit_id) then
    return app.error_result('not_found', jsonb_build_object('resource', 'visit'));
  end if;

  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    return app.error_result('validation_error', jsonb_build_object('field', 'p_rating'));
  end if;

  v_note := nullif(btrim(coalesce(p_text, '')), '');

  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into public.visit_entries as e (visit_id, author_id, note, rating)
  values (p_visit_id, v_uid, v_note, p_rating)
  on conflict (visit_id, author_id) do update
     set note = excluded.note,
         rating = excluded.rating
  returning * into v_entry;

  return app.ok_result(
    jsonb_build_object(
      'entry_id', v_entry.id,
      'visit_id', v_entry.visit_id,
      'note', v_entry.note,
      'rating', v_entry.rating,
      'pending', v_entry.note is null
    )
  );
end
$fn$;

create or replace function public.set_visit_tags(p_visit_id uuid, p_labels text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_label text;
  v_ordinal smallint := 0;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;

  if not app.can_read_visit(p_visit_id) then
    return app.error_result('not_found', jsonb_build_object('resource', 'visit'));
  end if;

  perform 1 from public.visits where id = p_visit_id for update;

  delete from public.visit_tags where visit_id = p_visit_id;

  if p_labels is not null then
    foreach v_label in array p_labels loop
      v_label := nullif(btrim(coalesce(v_label, '')), '');
      continue when v_label is null;
      v_ordinal := v_ordinal + 1;
      exit when v_ordinal > 20;
      insert into public.visit_tags (visit_id, ordinal, label, created_by)
      values (p_visit_id, v_ordinal, v_label, v_uid);
    end loop;
  end if;

  return app.ok_result(jsonb_build_object('visit_id', p_visit_id, 'tag_count', v_ordinal));
end
$fn$;

-- Assigns the next free slot under a lock on the parent visit, so two parallel
-- uploads cannot claim the same ordinal or overshoot five.
create or replace function public.register_visit_photo(
  p_visit_id uuid,
  p_storage_path text,
  p_metadata jsonb default '{}'::jsonb,
  p_request_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_bucket text := 'visit-photos';
  v_path text;
  v_segments text[];
  v_couple_id uuid;
  v_replay jsonb;
  v_photo public.visit_photos;
  v_count integer;
  v_ordinal smallint;
  v_byte_size bigint;
  v_width bigint;
  v_height bigint;
  v_result jsonb;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;

  if not app.can_read_visit(p_visit_id) then
    return app.error_result('not_found', jsonb_build_object('resource', 'visit'));
  end if;

  v_path := nullif(btrim(coalesce(p_storage_path, '')), '');
  if v_path is null then
    return app.error_result('validation_error', jsonb_build_object('field', 'p_storage_path'));
  end if;

  -- The object path is the only thing the storage policies can key off, so the
  -- metadata row is not allowed to describe a path outside this visit's folder.
  -- Canonical form: <couple_id>/<visit_id>/<filename> in the visit-photos bucket.
  select v.couple_id into v_couple_id from public.visits v where v.id = p_visit_id;

  v_segments := string_to_array(v_path, '/');
  if array_length(v_segments, 1) <> 3
     or app.try_uuid(v_segments[1]) is distinct from v_couple_id
     or app.try_uuid(v_segments[2]) is distinct from p_visit_id
     or nullif(btrim(coalesce(v_segments[3], '')), '') is null then
    return app.error_result(
      'validation_error',
      jsonb_build_object(
        'field', 'p_storage_path',
        'bucket', v_bucket,
        'expected', 'couple_id/visit_id/filename'
      )
    );
  end if;

  v_replay := app.begin_idempotent(v_uid, 'register_visit_photo', p_request_key);
  if v_replay is not null then
    return v_replay;
  end if;

  perform 1 from public.visits where id = p_visit_id for update;

  -- Natural key replay: the same uploaded object registered twice.
  select * into v_photo
    from public.visit_photos
   where storage_bucket = v_bucket
     and storage_path = v_path;

  if found then
    if v_photo.uploader_id <> v_uid or v_photo.visit_id <> p_visit_id then
      return app.error_result(
        'conflict', jsonb_build_object('reason', 'object_already_registered'),
        v_uid, 'register_visit_photo', p_request_key
      );
    end if;

    v_result := app.ok_result(
      jsonb_build_object('photo_id', v_photo.id, 'ordinal', v_photo.ordinal), true
    );
    perform app.finish_idempotent(v_uid, 'register_visit_photo', p_request_key, v_result);
    return v_result;
  end if;

  select count(*) into v_count from public.visit_photos where visit_id = p_visit_id;
  if v_count >= 5 then
    return app.error_result(
      'photo_limit_reached', jsonb_build_object('max_photos', 5),
      v_uid, 'register_visit_photo', p_request_key
    );
  end if;

  select coalesce(min(s.ordinal), 1) into v_ordinal
    from generate_series(1, 5) as s (ordinal)
   where not exists (
     select 1
       from public.visit_photos p
      where p.visit_id = p_visit_id
        and p.ordinal = s.ordinal
   );

  -- Metadata is advisory. Anything unparsable or out of range is stored as null
  -- rather than aborting a successful upload. No size or type limit is applied
  -- here; those are bucket settings and are still at the external gate.
  v_byte_size := app.try_bigint(p_metadata ->> 'byte_size');
  v_width := app.try_bigint(p_metadata ->> 'width');
  v_height := app.try_bigint(p_metadata ->> 'height');
  if v_byte_size is not null and v_byte_size < 1 then
    v_byte_size := null;
  end if;
  if v_width is not null and v_width not between 1 and 2147483647 then
    v_width := null;
  end if;
  if v_height is not null and v_height not between 1 and 2147483647 then
    v_height := null;
  end if;

  insert into public.visit_photos (
    visit_id, uploader_id, ordinal, storage_bucket, storage_path,
    content_type, byte_size, width, height, checksum
  )
  values (
    p_visit_id,
    v_uid,
    v_ordinal,
    v_bucket,
    v_path,
    nullif(btrim(coalesce(p_metadata ->> 'content_type', '')), ''),
    v_byte_size,
    v_width::integer,
    v_height::integer,
    nullif(btrim(coalesce(p_metadata ->> 'checksum', '')), '')
  )
  returning * into v_photo;

  v_result := app.ok_result(
    jsonb_build_object('photo_id', v_photo.id, 'ordinal', v_photo.ordinal)
  );
  perform app.finish_idempotent(v_uid, 'register_visit_photo', p_request_key, v_result);
  return v_result;
end
$fn$;

-- Disconnect revokes access in the same transaction and queues the purge. The
-- UI takes the two explicit confirmations before it gets here.
create or replace function public.disconnect_couple(p_request_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_couple_id uuid;
  v_couple public.couples;
  v_replay jsonb;
  v_job_id uuid;
  v_due_at timestamptz;
  v_result jsonb;
begin
  if v_uid is null then
    perform app.raise_error('forbidden', jsonb_build_object('reason', 'no_session'));
  end if;

  v_replay := app.begin_idempotent(v_uid, 'disconnect_couple', p_request_key);
  if v_replay is not null then
    return v_replay;
  end if;

  select m.couple_id into v_couple_id
    from public.couple_members m
   where m.user_id = v_uid
   order by m.joined_at desc
   limit 1;

  if v_couple_id is null then
    return app.error_result(
      'not_found', jsonb_build_object('resource', 'couple'),
      v_uid, 'disconnect_couple', p_request_key
    );
  end if;

  select * into v_couple from public.couples where id = v_couple_id for update;

  if v_couple.status = 'disconnected' then
    v_result := app.ok_result(
      jsonb_build_object('couple_id', v_couple.id, 'already_disconnected', true), true
    );
    perform app.finish_idempotent(v_uid, 'disconnect_couple', p_request_key, v_result);
    return v_result;
  end if;

  update public.couples
     set status = 'disconnected',
         disconnected_at = now()
   where id = v_couple.id;

  update public.couple_members
     set left_at = now()
   where couple_id = v_couple.id
     and left_at is null;

  update public.couple_invites
     set status = 'revoked',
         revoked_at = now()
   where couple_id = v_couple.id
     and status = 'active';

  insert into app.purge_jobs (couple_id, requested_by)
  values (v_couple.id, v_uid)
  on conflict (couple_id) where status in ('queued', 'running') do nothing
  returning id, due_at into v_job_id, v_due_at;

  if v_job_id is null then
    select j.id, j.due_at into v_job_id, v_due_at
      from app.purge_jobs j
     where j.couple_id = v_couple.id
       and j.status in ('queued', 'running')
     limit 1;
  else
    -- Snapshot the objects to delete while the metadata rows still exist.
    insert into app.purge_job_objects (job_id, bucket_id, object_path, is_prefix)
    select v_job_id, p.storage_bucket, p.storage_path, false
      from public.visit_photos p
      join public.visits v on v.id = p.visit_id
     where v.couple_id = v_couple.id;

    insert into app.purge_job_objects (job_id, bucket_id, object_path, is_prefix)
    values (v_job_id, 'visit-photos', v_couple.id::text || '/', true);
  end if;

  v_result := app.ok_result(
    jsonb_build_object(
      'couple_id', v_couple.id,
      'purge_job_id', v_job_id,
      'purge_due_at', v_due_at
    )
  );
  perform app.finish_idempotent(v_uid, 'disconnect_couple', p_request_key, v_result);
  return v_result;
end
$fn$;

/* ------------------------------------------------------------------ */
/* 17. purge worker RPCs (backend only)                                */
/* ------------------------------------------------------------------ */

create or replace function public.claim_purge_jobs(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_jobs jsonb;
begin
  -- skip locked so several workers can claim in parallel without blocking.
  for v_id in
    select j.id
      from app.purge_jobs j
     where j.status = 'queued'
     order by j.requested_at
     limit greatest(coalesce(p_limit, 10), 1)
     for update skip locked
  loop
    v_ids := array_append(v_ids, v_id);
  end loop;

  if array_length(v_ids, 1) is null then
    return app.ok_result(jsonb_build_object('jobs', '[]'::jsonb));
  end if;

  update app.purge_jobs j
     set status = 'running',
         started_at = now(),
         attempts = j.attempts + 1
   where j.id = any (v_ids);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'job_id', j.id,
        'couple_id', j.couple_id,
        'due_at', j.due_at,
        'attempts', j.attempts,
        'objects', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'bucket_id', o.bucket_id,
                'object_path', o.object_path,
                'is_prefix', o.is_prefix
              )
            ),
            '[]'::jsonb
          )
            from app.purge_job_objects o
           where o.job_id = j.id
             and o.deleted_at is null
        )
      )
    ),
    '[]'::jsonb
  )
  into v_jobs
  from app.purge_jobs j
  where j.id = any (v_ids);

  return app.ok_result(jsonb_build_object('jobs', v_jobs));
end
$fn$;

create or replace function public.purge_couple_data(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job app.purge_jobs;
  v_visits integer;
begin
  select * into v_job from app.purge_jobs where id = p_job_id for update;
  if not found then
    perform app.raise_error('not_found', jsonb_build_object('resource', 'purge_job'));
  end if;

  -- Strictly couple scoped. The job can run up to 24 hours after the disconnect,
  -- and by then either user may already have created a new couple, a new profile
  -- name and new idempotency keys. Nothing keyed by user_id may be touched here:
  --   * profiles.display_name belongs to the person, not to the couple
  --   * app.idempotency_keys and app.invite_attempts are user wide, and deleting
  --     them would replay-unprotect and un-rate-limit the user's new couple
  -- visits cascade to entries, tags and photo metadata.
  delete from public.visits where couple_id = v_job.couple_id;
  get diagnostics v_visits = row_count;

  delete from public.wishlist_places where couple_id = v_job.couple_id;
  delete from public.couple_invites where couple_id = v_job.couple_id;
  delete from public.couple_members where couple_id = v_job.couple_id;

  update public.couples
     set created_by = null,
         started_on = null,
         purged_at = now()
   where id = v_job.couple_id;

  update app.purge_jobs
     set db_purged_at = now(),
         requested_by = null
   where id = p_job_id;

  return app.ok_result(
    jsonb_build_object(
      'job_id', p_job_id,
      'couple_id', v_job.couple_id,
      'visits_deleted', v_visits
    )
  );
end
$fn$;

create or replace function public.mark_purge_objects_deleted(p_job_id uuid, p_object_paths text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_marked integer;
begin
  update app.purge_job_objects o
     set deleted_at = now()
   where o.job_id = p_job_id
     and o.object_path = any (coalesce(p_object_paths, '{}'::text[]))
     and o.deleted_at is null;

  get diagnostics v_marked = row_count;

  if not exists (
    select 1
      from app.purge_job_objects o
     where o.job_id = p_job_id
       and o.deleted_at is null
  ) then
    update app.purge_jobs set objects_purged_at = now() where id = p_job_id;
  end if;

  return app.ok_result(jsonb_build_object('job_id', p_job_id, 'marked', v_marked));
end
$fn$;

-- A failure goes back on the queue with the error recorded, and is parked as
-- failed for operator follow up once the attempt budget is spent.
create or replace function public.complete_purge_job(
  p_job_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_job app.purge_jobs;
  v_max integer := app.config_int('purge_max_attempts');
  v_pending integer;
  v_status text;
begin
  select * into v_job from app.purge_jobs where id = p_job_id for update;
  if not found then
    perform app.raise_error('not_found', jsonb_build_object('resource', 'purge_job'));
  end if;

  if p_succeeded then
    -- A job may only be closed once the database purge and every queued object
    -- deletion are recorded. Otherwise it goes back on the queue with the reason
    -- attached, so nothing is silently reported as deleted.
    select count(*) into v_pending
      from app.purge_job_objects o
     where o.job_id = p_job_id
       and o.deleted_at is null;

    if v_job.db_purged_at is null or v_pending > 0 then
      -- completed_at is cleared with the requeue: a queued job carrying a
      -- completion timestamp would read as finished to anything inspecting the
      -- table directly.
      update app.purge_jobs
         set status = 'queued',
             completed_at = null,
             last_error = 'purge_incomplete: db_purged='
                          || (v_job.db_purged_at is not null)::text
                          || ' pending_objects=' || v_pending::text
       where id = p_job_id;

      return app.error_result(
        'purge_incomplete',
        jsonb_build_object(
          'job_id', p_job_id,
          'db_purged', v_job.db_purged_at is not null,
          'pending_objects', v_pending
        )
      );
    end if;

    v_status := 'succeeded';
  elsif v_max is not null and v_job.attempts >= v_max then
    v_status := 'failed';
  else
    v_status := 'queued';
  end if;

  update app.purge_jobs
     set status = v_status,
         completed_at = case when v_status = 'succeeded' then now() else null end,
         last_error = case when p_succeeded then null else p_error end
   where id = p_job_id;

  return app.ok_result(jsonb_build_object('job_id', p_job_id, 'status', v_status));
end
$fn$;

/* ------------------------------------------------------------------ */
/* 18. function privileges                                             */
/* ------------------------------------------------------------------ */

-- PostgreSQL grants EXECUTE to PUBLIC on every new function, so each one is
-- revoked and then granted back only where it is needed.
revoke all on function app.error_sqlstate(text) from public, anon, authenticated;
revoke all on function app.raise_error(text, jsonb) from public, anon, authenticated;
revoke all on function app.ok_result(jsonb, boolean) from public, anon, authenticated;
revoke all on function app.error_result(text, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function app.config_value(text) from public, anon, authenticated;
revoke all on function app.config_int(text) from public, anon, authenticated;
revoke all on function app.require_config_seconds(text) from public, anon, authenticated;
revoke all on function app.try_uuid(text) from public, anon, authenticated;
revoke all on function app.try_double(text) from public, anon, authenticated;
revoke all on function app.try_bigint(text) from public, anon, authenticated;
revoke all on function app.user_lock_key(uuid) from public, anon, authenticated;
revoke all on function app.current_couple_id() from public, anon, authenticated;
revoke all on function app.is_active_member(uuid) from public, anon, authenticated;
revoke all on function app.shares_active_couple(uuid) from public, anon, authenticated;
revoke all on function app.can_read_visit(uuid) from public, anon, authenticated;
revoke all on function app.set_updated_at() from public, anon, authenticated;
revoke all on function app.normalize_visit_entry() from public, anon, authenticated;
revoke all on function app.guard_immutable_columns() from public, anon, authenticated;
revoke all on function app.guard_visit_photo_columns() from public, anon, authenticated;
revoke all on function app.new_invite_code() from public, anon, authenticated;
revoke all on function app.invite_public_json(public.couple_invites) from public, anon, authenticated;
revoke all on function app.issue_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function app.log_invite_attempt(uuid, text, text) from public, anon, authenticated;
revoke all on function app.begin_idempotent(uuid, text, text) from public, anon, authenticated;
revoke all on function app.finish_idempotent(uuid, text, text, jsonb) from public, anon, authenticated;

revoke all on function public.upsert_my_profile(text) from public, anon, authenticated;
revoke all on function public.create_couple(text, date, text) from public, anon, authenticated;
revoke all on function public.reissue_couple_invite(text) from public, anon, authenticated;
revoke all on function public.join_couple_with_code(text, text, text) from public, anon, authenticated;
revoke all on function public.create_visit(jsonb, timestamptz, text) from public, anon, authenticated;
revoke all on function public.upsert_my_visit_entry(uuid, text, smallint) from public, anon, authenticated;
revoke all on function public.set_visit_tags(uuid, text[]) from public, anon, authenticated;
revoke all on function public.register_visit_photo(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.disconnect_couple(text) from public, anon, authenticated;
revoke all on function public.claim_purge_jobs(integer) from public, anon, authenticated;
revoke all on function public.purge_couple_data(uuid) from public, anon, authenticated;
revoke all on function public.mark_purge_objects_deleted(uuid, text[]) from public, anon, authenticated;
revoke all on function public.complete_purge_job(uuid, boolean, text) from public, anon, authenticated;

-- Policy helpers: a policy expression is evaluated as the querying role, so the
-- role needs EXECUTE on the helpers the policies call.
grant execute on function app.current_couple_id() to authenticated;
grant execute on function app.is_active_member(uuid) to authenticated;
grant execute on function app.shares_active_couple(uuid) to authenticated;
grant execute on function app.can_read_visit(uuid) to authenticated;
grant execute on function app.try_uuid(text) to authenticated;

grant execute on function public.upsert_my_profile(text) to authenticated;
grant execute on function public.create_couple(text, date, text) to authenticated;
grant execute on function public.reissue_couple_invite(text) to authenticated;
grant execute on function public.join_couple_with_code(text, text, text) to authenticated;
grant execute on function public.create_visit(jsonb, timestamptz, text) to authenticated;
grant execute on function public.upsert_my_visit_entry(uuid, text, smallint) to authenticated;
grant execute on function public.set_visit_tags(uuid, text[]) to authenticated;
grant execute on function public.register_visit_photo(uuid, text, jsonb, text) to authenticated;
grant execute on function public.disconnect_couple(text) to authenticated;

-- Backend worker only. No browser session can reach these.
grant execute on function public.claim_purge_jobs(integer) to service_role;
grant execute on function public.purge_couple_data(uuid) to service_role;
grant execute on function public.mark_purge_objects_deleted(uuid, text[]) to service_role;
grant execute on function public.complete_purge_job(uuid, boolean, text) to service_role;

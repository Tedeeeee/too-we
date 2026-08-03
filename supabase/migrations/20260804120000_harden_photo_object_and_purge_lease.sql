-- 오늘,우리는 — two additive security fixes found in the W6 audit.
--
-- Both concern the same trust boundary: what a browser session is able to put in
-- front of the service-role purge worker.
--
-- 1. public.visit_photos accepted a non-canonical object reference.
--
--    public.register_visit_photo validates that storage_path is
--    <couple_id>/<visit_id>/<filename> in the visit-photos bucket, and the
--    storage.objects policies are written on the assumption that the metadata row
--    can be trusted to describe a path inside its own visit folder. But the RPC is
--    not the only writer: `authenticated` holds a direct insert grant, and
--    visit_photos_insert_uploader asks for nothing beyond `uploader_id =
--    auth.uid()` and a readable visit. So a member could insert a row naming any
--    bucket and any path.
--
--    That row is not inert. public.disconnect_couple snapshots storage_bucket and
--    storage_path verbatim into app.purge_job_objects, which is the work list the
--    service-role worker is handed. The worker refuses anything outside the
--    couple's own prefix and bucket, so nothing foreign is deleted — but the
--    refusal aborted the job, and a job already moved to 'running' by
--    claim_purge_jobs was never reconsidered. One forged row before a disconnect
--    was therefore enough to keep a couple's data past the 24 hour deletion
--    guarantee, and to strand the unrelated couples that shared the batch.
--
--    Fixed at the table, so the invariant holds for every writer rather than for
--    the one that happens to check.
--
-- 2. A job left in 'running' by a worker that never reported back was never
--    retried.
--
--    claim_purge_jobs moves a job to 'running' before the worker touches
--    anything, and only ever selected `status = 'queued'`. A worker that exits
--    without calling complete_purge_job — a crash, a function timeout, or the
--    worker's own `unsettled` outcome — left the row 'running' with nothing to
--    move it again. The spec requires a failed deletion to be retried and to stay
--    operationally traceable.
--
--    EXTERNAL GATE: reclaiming needs a staleness threshold, and no such duration
--    exists in the spec or anywhere in this schema. Rather than invent one, the
--    mechanism reads app.config.purge_lease_seconds and stays inert while that key
--    is unresolved — identical behaviour to today until the value is agreed with
--    the user. See supabase/README.md.

/* ------------------------------------------------------------------ */
/* 1. canonical object reference, enforced for every writer            */
/* ------------------------------------------------------------------ */

-- Definer for two reasons: it has to read the visit's true couple_id past RLS,
-- and app.raise_error is not executable by a client role.
--
-- The bar is not "what register_visit_photo checks" but "what the privileged
-- worker will accept". validPath() in
-- supabase/functions/purge-couple-data/purge.js refuses a path longer than 1024
-- UTF-16 code units, one containing a backslash or a control character, and a '.'
-- or '..' segment.
-- A path the worker refuses is exactly the input that strands a job, so the two
-- sides have to agree: anything the worker would reject must never reach a
-- metadata row in the first place.
create or replace function app.guard_visit_photo_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_couple_id uuid;
  v_segments text[];
  v_filename text;
begin
  if new.storage_bucket is distinct from 'visit-photos' then
    perform app.raise_error(
      'forbidden',
      jsonb_build_object(
        'column', 'storage_bucket',
        'reason', 'not_the_visit_photo_bucket'
      )
    );
  end if;

  -- Mirror of the worker's whole-string tests. Checked against the entire path
  -- rather than a single segment, which is how validPath() reads it.
  --
  -- octet_length, not char_length: the worker's bound is `value.length`, which
  -- counts UTF-16 code units, while char_length counts characters. 600 emoji are
  -- 600 characters but 1200 code units, so a char_length bound would accept a path
  -- the worker then refuses. UTF-8 octets are >= UTF-16 code units for every
  -- character (1 vs 1 for ASCII, 2-3 vs 1 below U+10000, 4 vs 2 above), so an
  -- octet bound is never more permissive than the worker's.
  if octet_length(new.storage_path) > 1024
     or strpos(new.storage_path, e'\\') > 0
     or new.storage_path ~ '[[:cntrl:]]' then
    perform app.raise_error(
      'forbidden',
      jsonb_build_object(
        'column', 'storage_path',
        'reason', 'rejected_by_purge_worker',
        'max_octets', 1024
      )
    );
  end if;

  select v.couple_id into v_couple_id
    from public.visits v
   where v.id = new.visit_id;

  v_segments := string_to_array(new.storage_path, '/');
  v_filename := nullif(btrim(coalesce(v_segments[3], '')), '');

  -- The couple and visit segments are compared as canonical uuid *text*, not as
  -- uuid values. app.try_uuid accepts braces, uppercase and a hyphenless form —
  -- all of which are the same uuid to Postgres but do not match the worker's
  -- byte-wise `<couple_id>/` prefix test, so a uuid-valued comparison would let
  -- a path through here that the worker then refuses.
  --
  -- A missing visit leaves v_couple_id null, which no text can equal, so an
  -- insert racing ahead of its foreign key check fails closed rather than through.
  if array_length(v_segments, 1) <> 3
     or v_segments[1] is distinct from v_couple_id::text
     or v_segments[2] is distinct from new.visit_id::text
     or v_filename is null
     or v_filename in ('.', '..') then
    perform app.raise_error(
      'forbidden',
      jsonb_build_object(
        'column', 'storage_path',
        'reason', 'outside_visit_folder',
        'expected', 'couple_id/visit_id/filename'
      )
    );
  end if;

  return new;
end
$fn$;

-- Update is already restricted to `ordinal` by app.guard_visit_photo_columns, so
-- on that path this only re-affirms an unchanged value. It is listed anyway: if
-- that allow-list is ever widened, the path stays guarded by default.
create trigger visit_photos_guard_object
  before insert or update on public.visit_photos
  for each row execute function app.guard_visit_photo_object();

/* ------------------------------------------------------------------ */
/* 2. reclaiming a purge job whose worker never reported back          */
/* ------------------------------------------------------------------ */

-- EXTERNAL GATE: null and unresolved. While it stays that way claim_purge_jobs
-- behaves exactly as before and picks up queued jobs only.
insert into app.config (key, value, resolved, description) values
  ('purge_lease_seconds', null, false,
   'EXTERNAL GATE: how long a purge job may sit in status = running before another worker may reclaim it. While unresolved, claim_purge_jobs never reclaims and a job whose worker died stays running for an operator to see; there is no invented lease.')
on conflict (key) do nothing;

-- app.config_int deliberately ignores `resolved`, because the provisional values
-- are meant to work. This gate is the other kind: the mechanism must stay off
-- until someone agrees the number, so the reader requires resolved = true and
-- returns null otherwise.
--
-- plpgsql rather than a single SQL select, so the checks are strictly sequential.
-- In a flattened SQL query the planner is free to evaluate the numeric cast for a
-- row whose type or range qual has not been applied yet, and `'1.5'::integer`
-- raises 22P02 rather than rounding. A raise here would abort claim_purge_jobs and
-- take the whole worker down, so a value that cannot be used is reported as
-- absent instead.
create or replace function app.config_resolved_seconds(p_key text)
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

  if not found
     or not v_row.resolved
     or v_row.value is null
     or jsonb_typeof(v_row.value) <> 'number' then
    return null;
  end if;

  v_seconds := (v_row.value #>> '{}')::numeric;

  -- Fail closed rather than interpret. A fractional or out of range lease is a
  -- number nobody agreed to the meaning of, so the reclaim stays inert exactly as
  -- it does while the key is unresolved.
  if v_seconds < 1
     or v_seconds > 2147483647
     or v_seconds <> floor(v_seconds) then
    return null;
  end if;

  return v_seconds::integer;
end
$fn$;

-- Replaces the W1 definition. Only the candidate set changes: a queued job as
-- before, plus a running job whose claim is older than the lease. Everything
-- after the loop is unchanged, so a reclaimed job takes the same attempts
-- increment and is parked as 'failed' by complete_purge_job once
-- purge_max_attempts is spent, which is what keeps it traceable.
--
-- due_at is still never a condition here: it is the completion target, not a
-- delay before the work may start.
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
  v_lease integer := app.config_resolved_seconds('purge_lease_seconds');
  v_stale_before timestamptz;
begin
  if v_lease is not null then
    v_stale_before := now() - make_interval(secs => v_lease);
  end if;

  -- skip locked so several workers can claim in parallel without blocking.
  for v_id in
    select j.id
      from app.purge_jobs j
     where j.status = 'queued'
        or (
          j.status = 'running'
          and v_stale_before is not null
          and j.started_at is not null
          and j.started_at < v_stale_before
        )
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

/* ------------------------------------------------------------------ */
/* 3. privileges                                                       */
/* ------------------------------------------------------------------ */

-- CREATE OR REPLACE keeps an existing ACL, so claim_purge_jobs retains the W1
-- grants. Restated so this file is correct on its own too.
revoke all on function app.guard_visit_photo_object() from public, anon, authenticated;
revoke all on function app.config_resolved_seconds(text) from public, anon, authenticated;
revoke all on function public.claim_purge_jobs(integer) from public, anon, authenticated;

grant execute on function public.claim_purge_jobs(integer) to service_role;

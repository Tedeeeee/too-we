/**
 * Executable migration contract for the MVP schema and RLS.
 *
 * WHY A STATIC CONTRACT: the Supabase CLI and the Docker daemon are not
 * available in this workspace, so the migrations cannot be applied to a real
 * Postgres instance here. The behavioural database tests live next door as
 * pgTAP scripts (`supabase/tests/sql/`) and are documented as NOT EXECUTED.
 * This Vitest suite is the part that *does* run on every `npm test`: it asserts
 * that the migration SQL actually declares the tables, constraints, RLS
 * policies, RPC error taxonomy, locking and privilege revocations that the MVP
 * functional spec requires — and that the operating values which are still
 * blocked on the external gate are not hardcoded.
 *
 * Spec: docs/specs/2026-07-29-mvp-functional-spec.md
 */
import { describe, expect, it } from 'vitest';

import { FLOWERS } from '../../src/data/fixtures.js';
import {
  createTables,
  createdTableNames,
  functions,
  functionsNamed,
  grants,
  indexes,
  inserts,
  migrationFiles,
  policies,
  policiesFor,
  rawSql,
  revokes,
  rlsEnabledTables,
  sqlTestFiles,
  statements,
  tableColumns,
  tableSql,
} from './helpers/sql-contract.js';

/* ------------------------------------------------------------------ */
/* contract constants                                                  */
/* ------------------------------------------------------------------ */

/** Couple-scoped tables the browser talks to. Every one needs RLS + policies. */
const EXPOSED_TABLES = [
  'public.profiles',
  'public.couples',
  'public.couple_members',
  'public.couple_invites',
  'public.flowers',
  'public.visits',
  'public.visit_entries',
  'public.visit_tags',
  'public.visit_photos',
  'public.wishlist_places',
];

/** Internal tables: no client policies at all, privileges revoked. */
const INTERNAL_TABLES = [
  'app.config',
  'app.invite_attempts',
  'app.idempotency_keys',
  'app.purge_jobs',
  'app.purge_job_objects',
];

const CLIENT_ROLES = ['anon', 'authenticated'];

/** Error taxonomy the RPC contract must be able to distinguish. */
const REQUIRED_ERROR_CODES = [
  'validation_error',
  'not_found',
  'forbidden',
  'rate_limited',
  'invite_not_found',
  'invite_expired',
  'invite_consumed',
  'couple_capacity_reached',
  'active_membership_conflict',
  'photo_limit_reached',
];

const USER_RPCS = [
  'public.upsert_my_profile',
  'public.create_couple',
  'public.reissue_couple_invite',
  'public.join_couple_with_code',
  'public.create_visit',
  'public.upsert_my_visit_entry',
  'public.set_visit_tags',
  'public.register_visit_photo',
  'public.disconnect_couple',
];

/** Backend-worker only. Must never be reachable from a browser session. */
const SERVICE_RPCS = [
  'public.claim_purge_jobs',
  'public.purge_couple_data',
  'public.mark_purge_objects_deleted',
  'public.complete_purge_job',
];

/** Operating values that are still blocked on the external gate. */
const UNRESOLVED_CONFIG_KEYS = [
  'invite_ttl_seconds',
  'photo_max_bytes',
  'photo_allowed_mime_types',
];

const hasIndex = (predicate) => indexes().some(predicate);

const sameColumns = (index, cols) =>
  index.columns.length === cols.length &&
  index.columns.every((c, i) => c.replace(/"/g, '') === cols[i]);

/* ------------------------------------------------------------------ */

describe('supabase migrations exist', () => {
  it('ships at least one timestamped migration file', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });

  it('parses into statements without an unterminated block', () => {
    expect(statements().length).toBeGreaterThan(50);
    // A dropped dollar-quote terminator swallows the rest of the file into one
    // giant statement; this catches that class of typo.
    for (const st of statements()) {
      expect(st.code.length).toBeLessThan(20000);
    }
  });

  it('never drops or truncates existing objects', () => {
    for (const st of statements()) {
      expect(st.code).not.toMatch(/^\s*drop\s+table\b/i);
      expect(st.code).not.toMatch(/^\s*drop\s+schema\b/i);
      expect(st.code).not.toMatch(/\balter\s+table\s+[\s\S]*\bdrop\s+column\b/i);
      expect(st.code).not.toMatch(/^\s*truncate\b/i);
    }
  });
});

describe('profiles is extended additively', () => {
  it('creates profiles only if absent and adds columns idempotently', () => {
    const sql = tableSql('public.profiles');
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+public\.profiles/i);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+display_name/i);
  });

  it('keys profiles to the anonymous auth user', () => {
    const sql = tableSql('public.profiles');
    expect(sql).toMatch(/references\s+auth\.users\s*\(\s*id\s*\)/i);
    expect(tableColumns('public.profiles').has('id')).toBe(true);
  });

  it('re-creates its policies idempotently', () => {
    const dropped = statements().filter((st) =>
      /^drop\s+policy\s+if\s+exists[\s\S]*on\s+public\.profiles/i.test(st.code),
    );
    expect(dropped.length).toBeGreaterThan(0);
  });
});

describe('couple model', () => {
  it('tracks couple lifecycle status', () => {
    const cols = tableColumns('public.couples');
    for (const col of ['id', 'status', 'created_by', 'started_on', 'disconnected_at']) {
      expect(cols.has(col)).toBe(true);
    }
    expect(tableSql('public.couples')).toMatch(/'active'[\s\S]*'disconnected'/i);
  });

  it('allows one active couple per user', () => {
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'public.couple_members' &&
          sameColumns(ix, ['user_id']) &&
          /left_at\s+is\s+null/i.test(ix.where || ''),
      ),
    ).toBe(true);
  });

  it('caps a couple at two active members with a declarative slot index', () => {
    const slotDef = tableColumns('public.couple_members').get('slot');
    expect(slotDef).toBeDefined();
    expect(slotDef).toMatch(/check\s*\(\s*slot\s+in\s*\(\s*1\s*,\s*2\s*\)\s*\)/i);
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'public.couple_members' &&
          sameColumns(ix, ['couple_id', 'slot']) &&
          /left_at\s+is\s+null/i.test(ix.where || ''),
      ),
    ).toBe(true);
  });

  it('records membership exit instead of deleting the row', () => {
    expect(tableColumns('public.couple_members').has('left_at')).toBe(true);
  });
});

describe('invite codes', () => {
  it('stores a six digit code with a lifecycle status', () => {
    const cols = tableColumns('public.couple_invites');
    for (const col of ['code', 'status', 'expires_at', 'consumed_at', 'consumed_by']) {
      expect(cols.has(col)).toBe(true);
    }
    expect(cols.get('code')).toMatch(/\^\[0-9\]\{6\}\$/);
  });

  it('keeps exactly one active invite per couple and a unique active code', () => {
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'public.couple_invites' &&
          sameColumns(ix, ['couple_id']) &&
          /status\s*=\s*'active'/i.test(ix.where || ''),
      ),
    ).toBe(true);
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'public.couple_invites' &&
          sameColumns(ix, ['code']) &&
          /status\s*=\s*'active'/i.test(ix.where || ''),
      ),
    ).toBe(true);
  });

  it('records join attempts so repeated guesses can be throttled', () => {
    const cols = tableColumns('app.invite_attempts');
    for (const col of ['user_id', 'outcome', 'attempted_at']) {
      expect(cols.has(col)).toBe(true);
    }
    expect(tableSql('app.invite_attempts')).toMatch(/'rate_limited'/);
  });

  it('derives invite expiry from configuration instead of a literal interval', () => {
    const invitePath = functions().filter((f) => /invite/i.test(f.name));
    expect(invitePath.length).toBeGreaterThan(0);
    const issuer = invitePath.find((f) => /issue_invite/i.test(f.name));
    expect(issuer).toBeDefined();
    expect(issuer.body).toMatch(/invite_ttl_seconds/);
    // No baked-in lifetime anywhere on the invite path.
    for (const fn of invitePath) {
      expect(fn.body).not.toMatch(/interval\s+'[^']*(day|hour|minute|week)/i);
    }
  });
});

describe('visits carry the Kakao place snapshot', () => {
  it('requires couple, visited_at and a place name', () => {
    const cols = tableColumns('public.visits');
    expect(cols.get('couple_id')).toMatch(/not\s+null/i);
    expect(cols.get('visited_at')).toMatch(/not\s+null/i);
    expect(cols.get('place_name')).toMatch(/not\s+null/i);
  });

  it('snapshots the external place payload', () => {
    const cols = tableColumns('public.visits');
    for (const col of [
      'place_provider',
      'place_provider_id',
      'place_category',
      'place_address',
      'place_lat',
      'place_lng',
      'place_snapshot',
      'place_snapshot_at',
    ]) {
      expect(cols.has(col)).toBe(true);
    }
    expect(cols.get('place_snapshot')).toMatch(/jsonb/i);
  });
});

describe('per-user visit entries', () => {
  it('is unique per visit and author', () => {
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'public.visit_entries' &&
          sameColumns(ix, ['visit_id', 'author_id']),
      ),
    ).toBe(true);
  });

  it('keeps text optional, trimmed and never blank', () => {
    const sql = tableSql('public.visit_entries');
    expect(tableColumns('public.visit_entries').get('note')).not.toMatch(/not\s+null/i);
    expect(sql).toMatch(/btrim\s*\(\s*note\s*\)\s*=\s*note/i);
    expect(sql).toMatch(/char_length\s*\(\s*note\s*\)\s*>=\s*1/i);
    const normalizer = functions().find((f) => /normalize_visit_entry/i.test(f.name));
    expect(normalizer).toBeDefined();
    expect(normalizer.body).toMatch(/nullif\s*\(\s*btrim/i);
  });

  it('accepts a null rating or 1 through 5', () => {
    const def = tableColumns('public.visit_entries').get('rating');
    expect(def).not.toMatch(/not\s+null/i);
    expect(def).toMatch(/rating\s+between\s+1\s+and\s+5/i);
  });
});

describe('shared tags and flower', () => {
  it('orders tags by position within a visit', () => {
    const cols = tableColumns('public.visit_tags');
    expect(cols.has('ordinal')).toBe(true);
    expect(cols.get('label')).toMatch(/not\s+null/i);
    expect(
      hasIndex(
        (ix) =>
          ix.unique && ix.table === 'public.visit_tags' && sameColumns(ix, ['visit_id', 'ordinal']),
      ) || /primary\s+key\s*\(\s*visit_id\s*,\s*ordinal\s*\)/i.test(tableSql('public.visit_tags')),
    ).toBe(true);
  });

  it('constrains the shared flower to the seven keys the app already ships', () => {
    expect(createTables().has('public.flowers')).toBe(true);
    const seed = inserts().find((i) => i.table === 'public.flowers');
    expect(seed).toBeDefined();
    for (const flower of FLOWERS) {
      expect(seed.code).toContain(`'${flower.key}'`);
    }
    const seededKeys = [...seed.code.matchAll(/'([a-z-]+)'/g)]
      .map((m) => m[1])
      .filter((k) => k !== 'active');
    expect(new Set(seededKeys).size).toBe(FLOWERS.length);

    const flowerCol = tableColumns('public.visits').get('flower_key');
    expect(flowerCol).not.toMatch(/not\s+null/i);
    expect(flowerCol).toMatch(/references\s+public\.flowers\s*\(\s*key\s*\)/i);
  });
});

describe('visit photos', () => {
  it('records uploader, order and private bucket metadata', () => {
    const cols = tableColumns('public.visit_photos');
    for (const col of [
      'uploader_id',
      'ordinal',
      'storage_bucket',
      'storage_path',
      'content_type',
      'byte_size',
    ]) {
      expect(cols.has(col)).toBe(true);
    }
    expect(cols.get('uploader_id')).toMatch(/not\s+null/i);
  });

  it('caps a visit at five photos declaratively', () => {
    expect(tableColumns('public.visit_photos').get('ordinal')).toMatch(/between\s+1\s+and\s+5/i);
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'public.visit_photos' &&
          sameColumns(ix, ['visit_id', 'ordinal']),
      ),
    ).toBe(true);
  });

  it('does not bake in file size or MIME restrictions', () => {
    const sql = rawSql();
    expect(sql).not.toMatch(/image\/(jpeg|png|webp|heic)/i);
    expect(tableSql('public.visit_photos')).not.toMatch(/byte_size[\s\S]{0,40}<=?\s*\d/i);
    expect(tableSql('public.visit_photos')).not.toMatch(/content_type[\s\S]{0,40}\bin\s*\(/i);
  });

  it('stores photo objects in a private bucket with unresolved limits', () => {
    const bucket = inserts().find((i) => i.table === 'storage.buckets');
    expect(bucket).toBeDefined();
    expect(bucket.code).toMatch(/'visit-photos'/);
    expect(bucket.code).toMatch(/\bfalse\b/);
    expect(bucket.code).toMatch(/file_size_limit/i);
    expect(bucket.code).toMatch(/allowed_mime_types/i);
    expect(bucket.code).not.toMatch(/image\//i);
  });

  it('protects the photo identity columns from the other member', () => {
    const guard = functions().find((f) => /guard_immutable_columns/i.test(f.name));
    expect(guard).toBeDefined();
    const trigger = statements().find(
      (st) =>
        /create\s+trigger/i.test(st.code) &&
        /public\.visit_photos/i.test(st.code) &&
        /guard_immutable_columns/i.test(st.code),
    );
    expect(trigger).toBeDefined();
    expect(trigger.code).toMatch(/storage_path/);
    expect(trigger.code).toMatch(/uploader_id/);
  });
});

describe('wishlist places are independent of visits', () => {
  it('is couple scoped and remembers who picked it', () => {
    const cols = tableColumns('public.wishlist_places');
    expect(cols.get('couple_id')).toMatch(/not\s+null/i);
    expect(cols.get('created_by')).toMatch(/not\s+null/i);
    expect(cols.has('place_name')).toBe(true);
  });

  it('carries no visit foreign key', () => {
    expect(tableSql('public.wishlist_places')).not.toMatch(/references\s+public\.visits/i);
  });
});

describe('idempotency records', () => {
  it('is unique per user, operation and request key', () => {
    const cols = tableColumns('app.idempotency_keys');
    for (const col of ['user_id', 'operation', 'request_key', 'response']) {
      expect(cols.has(col)).toBe(true);
    }
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'app.idempotency_keys' &&
          sameColumns(ix, ['user_id', 'operation', 'request_key']),
      ),
    ).toBe(true);
  });

  it('is required by the join and visit creation RPCs', () => {
    for (const name of ['public.join_couple_with_code', 'public.create_visit']) {
      const [fn] = functionsNamed(name);
      expect(fn, `${name} missing`).toBeDefined();
      expect(fn.args).toMatch(/p_request_key\s+text/i);
      expect(fn.body).toMatch(/begin_idempotent/i);
      expect(fn.body).toMatch(/finish_idempotent/i);
    }
  });

  it('reports a replay instead of repeating the side effect', () => {
    const begin = functions().find((f) => /begin_idempotent/i.test(f.name));
    expect(begin).toBeDefined();
    expect(begin.body).toMatch(/'replayed'\s*,\s*true/i);
  });
});

describe('disconnect and purge', () => {
  it('queues a purge job with a 24 hour completion target', () => {
    const cols = tableColumns('app.purge_jobs');
    for (const col of ['couple_id', 'status', 'requested_at', 'due_at', 'attempts', 'last_error']) {
      expect(cols.has(col)).toBe(true);
    }
    expect(cols.get('due_at')).toMatch(/interval\s+'24\s+hours'/i);
    expect(
      hasIndex(
        (ix) =>
          ix.unique &&
          ix.table === 'app.purge_jobs' &&
          sameColumns(ix, ['couple_id']) &&
          /queued/i.test(ix.where || ''),
      ),
    ).toBe(true);
  });

  it('snapshots the storage objects to delete before the rows go away', () => {
    const cols = tableColumns('app.purge_job_objects');
    for (const col of ['job_id', 'bucket_id', 'object_path', 'deleted_at']) {
      expect(cols.has(col)).toBe(true);
    }
    const [disconnect] = functionsNamed('public.disconnect_couple');
    expect(disconnect).toBeDefined();
    expect(disconnect.body).toMatch(/app\.purge_job_objects/i);
    expect(disconnect.body).toMatch(/app\.purge_jobs/i);
  });

  it('revokes access at disconnect time rather than at purge time', () => {
    const [disconnect] = functionsNamed('public.disconnect_couple');
    expect(disconnect.body).toMatch(/status\s*=\s*'disconnected'/i);
    expect(disconnect.body).toMatch(/left_at\s*=/i);
    // Every couple-scoped read helper insists the couple is still active.
    const helper = functions().find((f) => f.name === 'app.current_couple_id');
    expect(helper).toBeDefined();
    expect(helper.body).toMatch(/status\s*=\s*'active'/i);
    expect(helper.body).toMatch(/left_at\s+is\s+null/i);
  });
});

describe('row level security', () => {
  it('is enabled on every table the migrations create', () => {
    const enabled = rlsEnabledTables();
    for (const table of createdTableNames()) {
      expect(enabled.has(table), `RLS not enabled on ${table}`).toBe(true);
    }
    for (const table of [...EXPOSED_TABLES, ...INTERNAL_TABLES]) {
      expect(enabled.has(table), `RLS not enabled on ${table}`).toBe(true);
    }
  });

  it('grants nothing to the anon role', () => {
    for (const grant of grants()) {
      expect(grant.roles, `anon granted by: ${grant.code}`).not.toContain('anon');
    }
    const revokedFromAnon = revokes().some((r) => r.roles.includes('anon'));
    expect(revokedFromAnon).toBe(true);
  });

  it('targets the authenticated role in every policy', () => {
    expect(policies().length).toBeGreaterThan(0);
    for (const policy of policies()) {
      expect(policy.roles, `${policy.name} has no role list`).toContain('authenticated');
      expect(policy.roles, `${policy.name} exposes anon`).not.toContain('anon');
      expect(policy.roles, `${policy.name} leans on service_role`).not.toContain('service_role');
    }
  });

  it('leaves the internal tables with no client policy at all', () => {
    for (const table of INTERNAL_TABLES) {
      expect(policiesFor(table).length, `${table} should have no policy`).toBe(0);
      const revoked = revokes().some(
        (r) => r.code.includes(table) && CLIENT_ROLES.every((role) => r.roles.includes(role)),
      );
      expect(revoked, `${table} privileges not revoked from client roles`).toBe(true);
    }
  });

  it('scopes every couple-owned table read to an active membership', () => {
    for (const table of [
      'public.couples',
      'public.couple_members',
      'public.couple_invites',
      'public.visits',
      'public.wishlist_places',
    ]) {
      const selects = policiesFor(table, 'select');
      expect(selects.length, `${table} has no select policy`).toBeGreaterThan(0);
      for (const policy of selects) {
        expect(policy.expression, `${policy.name} is not membership scoped`).toMatch(
          /app\.(is_active_member|current_couple_id)/i,
        );
      }
    }
    for (const table of ['public.visit_entries', 'public.visit_tags', 'public.visit_photos']) {
      const selects = policiesFor(table, 'select');
      expect(selects.length, `${table} has no select policy`).toBeGreaterThan(0);
      for (const policy of selects) {
        expect(policy.expression).toMatch(/app\.can_read_visit/i);
      }
    }
  });

  it('lets only the entry author change their own line and rating', () => {
    for (const command of ['update', 'delete']) {
      const found = policiesFor('public.visit_entries', command);
      expect(found.length, `visit_entries ${command} policy missing`).toBeGreaterThan(0);
      for (const policy of found) {
        expect(policy.expression, `${policy.name} is not author scoped`).toMatch(
          /author_id\s*=\s*auth\.uid\(\)/i,
        );
      }
    }
  });

  it('lets only the uploader delete a photo but both members reorder', () => {
    const del = policiesFor('public.visit_photos', 'delete');
    expect(del.length).toBeGreaterThan(0);
    for (const policy of del) {
      expect(policy.expression).toMatch(/uploader_id\s*=\s*auth\.uid\(\)/i);
    }
    const upd = policiesFor('public.visit_photos', 'update');
    expect(upd.length).toBeGreaterThan(0);
    for (const policy of upd) {
      expect(policy.expression).toMatch(/app\.can_read_visit/i);
    }
  });

  it('lets both active members update the shared visit fields', () => {
    const upd = policiesFor('public.visits', 'update');
    expect(upd.length).toBeGreaterThan(0);
    for (const policy of upd) {
      expect(policy.expression).toMatch(/app\.is_active_member\s*\(\s*couple_id\s*\)/i);
      expect(policy.expression).toMatch(/with\s+check/i);
    }
  });

  it('never lets a client write couples, memberships or invites directly', () => {
    for (const table of ['public.couples', 'public.couple_members', 'public.couple_invites']) {
      for (const command of ['insert', 'update', 'delete']) {
        expect(
          policiesFor(table, command).filter((p) => p.command === command).length,
          `${table} must not expose ${command}`,
        ).toBe(0);
      }
    }
  });

  it('protects photo storage objects with a couple scoped path check', () => {
    const storage = policies().filter((p) => p.table === 'storage.objects');
    expect(storage.length).toBeGreaterThanOrEqual(3);
    for (const policy of storage) {
      expect(policy.expression).toMatch(/bucket_id\s*=\s*'visit-photos'/i);
      expect(policy.expression).toMatch(/storage\.foldername/i);
    }
    const del = storage.find((p) => p.command === 'delete');
    expect(del).toBeDefined();
    expect(del.expression).toMatch(/uploader_id\s*=\s*auth\.uid\(\)/i);
  });
});

describe('security definer hygiene', () => {
  it('pins search_path on every definer function', () => {
    const definers = functions().filter((f) => f.securityDefiner);
    expect(definers.length).toBeGreaterThan(5);
    for (const fn of definers) {
      expect(fn.searchPath, `${fn.name} has no fixed search_path`).toBe("''");
    }
  });

  it('pins search_path on every function, definer or not', () => {
    for (const fn of functions()) {
      expect(fn.searchPath, `${fn.name} has no fixed search_path`).toBe("''");
    }
  });

  it('revokes the default public execute grant on every function', () => {
    for (const fn of functions()) {
      const revoked = revokes().some(
        (r) => r.code.includes(fn.name) && r.roles.includes('public'),
      );
      expect(revoked, `execute on ${fn.name} not revoked from public`).toBe(true);
    }
  });

  it('exposes the user RPCs to authenticated sessions only', () => {
    for (const name of USER_RPCS) {
      expect(functionsNamed(name).length, `${name} missing`).toBeGreaterThan(0);
      const granted = grants().some(
        (g) => g.code.includes(name) && g.roles.includes('authenticated'),
      );
      expect(granted, `${name} not granted to authenticated`).toBe(true);
    }
  });

  it('keeps the purge worker RPCs out of reach of the browser', () => {
    for (const name of SERVICE_RPCS) {
      expect(functionsNamed(name).length, `${name} missing`).toBeGreaterThan(0);
      const granted = grants().filter((g) => g.code.includes(name));
      expect(granted.length).toBeGreaterThan(0);
      for (const grant of granted) {
        expect(grant.roles, `${name} exposed to a client role`).not.toContain('authenticated');
        expect(grant.roles).not.toContain('anon');
      }
      const revoked = revokes().some(
        (r) => r.code.includes(name) && CLIENT_ROLES.every((role) => r.roles.includes(role)),
      );
      expect(revoked, `${name} not revoked from client roles`).toBe(true);
    }
  });

  it('never asks the browser to hold a service role key', () => {
    const sql = rawSql();
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(sql).not.toMatch(/service_role_key/i);
    expect(sql).not.toMatch(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
    // service_role may only appear in privilege statements, never in policy or
    // function logic that a user session executes.
    for (const st of statements()) {
      if (!/service_role/i.test(st.code)) continue;
      expect(st.code, 'service_role referenced outside a grant/revoke').toMatch(
        /^\s*(grant|revoke)\b/i,
      );
    }
  });
});

describe('RPC error and replay contract', () => {
  it('maps every required outcome to its own sqlstate', () => {
    const mapper = functions().find((f) => /error_sqlstate/i.test(f.name));
    expect(mapper).toBeDefined();
    const codes = new Map();
    for (const m of mapper.body.matchAll(/when\s+'([a-z_]+)'\s+then\s+'([A-Z0-9]{5})'/g)) {
      codes.set(m[1], m[2]);
    }
    for (const code of REQUIRED_ERROR_CODES) {
      expect(codes.has(code), `error code ${code} not mapped`).toBe(true);
    }
    // Distinct sqlstates, so a client can branch without string matching.
    expect(new Set(codes.values()).size).toBe(codes.size);
    // User defined sqlstate classes must avoid the reserved ranges.
    for (const [code, sqlstate] of codes) {
      expect(sqlstate, `${code} uses a reserved sqlstate class`).toMatch(/^[5-9I-Z][0-9A-Z]{4}$/);
    }
  });

  it('separates an expired invite from a used one', () => {
    const [join] = functionsNamed('public.join_couple_with_code');
    expect(join).toBeDefined();
    expect(join.body).toMatch(/invite_expired/);
    expect(join.body).toMatch(/invite_consumed/);
    expect(join.body).toMatch(/invite_not_found/);
    expect(join.body).toMatch(/couple_capacity_reached/);
    expect(join.body).toMatch(/active_membership_conflict/);
    expect(join.body).toMatch(/rate_limited/);
  });

  it('returns failed join attempts instead of raising, so the attempt is recorded', () => {
    const [join] = functionsNamed('public.join_couple_with_code');
    expect(join.body).toMatch(/app\.error_result/i);
    expect(join.body).toMatch(/app\.log_invite_attempt/i);
    // A raise would roll the attempt log back and defeat the rate limit.
    expect(join.body).not.toMatch(/app\.raise_error\s*\(\s*'invite_/i);
    expect(join.body).not.toMatch(/app\.raise_error\s*\(\s*'rate_limited'/i);
  });

  it('rejects a visit that is not visible as not_found rather than forbidden', () => {
    const [entry] = functionsNamed('public.upsert_my_visit_entry');
    expect(entry).toBeDefined();
    expect(entry.body).toMatch(/'not_found'/);
  });

  it('reports the photo cap as its own outcome', () => {
    const [photo] = functionsNamed('public.register_visit_photo');
    expect(photo).toBeDefined();
    expect(photo.body).toMatch(/photo_limit_reached/);
  });
});

describe('concurrency control', () => {
  it('serialises couple joins on the invite and couple rows', () => {
    const [join] = functionsNamed('public.join_couple_with_code');
    expect(join.body).toMatch(/for\s+update/i);
    expect(join.body).toMatch(/pg_advisory_xact_lock/i);
  });

  it('serialises couple creation per user', () => {
    const [create] = functionsNamed('public.create_couple');
    expect(create).toBeDefined();
    expect(create.body).toMatch(/pg_advisory_xact_lock/i);
  });

  it('serialises photo slot assignment on the parent visit', () => {
    const [photo] = functionsNamed('public.register_visit_photo');
    expect(photo.body).toMatch(/for\s+update/i);
  });

  it('serialises disconnect on the couple row', () => {
    const [disconnect] = functionsNamed('public.disconnect_couple');
    expect(disconnect.body).toMatch(/for\s+update/i);
  });
});

describe('operating values deferred to the external gate', () => {
  it('reads tunable values from app.config instead of literals', () => {
    const cols = tableColumns('app.config');
    for (const col of ['key', 'value', 'resolved', 'description']) {
      expect(cols.has(col)).toBe(true);
    }
    const reader = functions().find((f) => /config_int/i.test(f.name));
    expect(reader).toBeDefined();
    expect(reader.body).toMatch(/app\.config/i);
  });

  it('seeds the unresolved keys with a null value and resolved = false', () => {
    const seed = inserts().find((i) => i.table === 'app.config');
    expect(seed).toBeDefined();
    for (const key of UNRESOLVED_CONFIG_KEYS) {
      expect(seed.code, `${key} not seeded`).toContain(`'${key}'`);
    }
    expect(seed.code).toMatch(/false/);
    expect(seed.code).toMatch(/null/i);
  });

  it('flags the pending values in a comment the reviewer will see', () => {
    expect(rawSql()).toMatch(/EXTERNAL GATE/);
  });

  it('never falls back to a hardcoded invite lifetime', () => {
    for (const fn of functions()) {
      if (!/invite/i.test(fn.name)) continue;
      expect(fn.body).not.toMatch(/\b\d{3,}\s*\)?\s*::\s*int/);
    }
  });
});

describe('database scenario tests are present as SQL', () => {
  it('ships pgTAP scripts for the required scenarios', () => {
    const files = sqlTestFiles();
    expect(files.length).toBeGreaterThanOrEqual(6);
    const joined = files.join(' ');
    for (const topic of [
      'two_user',
      'cross_couple',
      'entry_author',
      'photo',
      'invite',
      'disconnect',
    ]) {
      expect(joined, `no SQL scenario covers ${topic}`).toContain(topic);
    }
  });
});

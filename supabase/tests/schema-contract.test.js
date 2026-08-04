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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FLOWERS } from '../../src/data/fixtures.js';
import {
  SUPABASE_DIR,
  countPgTapPlan,
  createTables,
  createdTableNames,
  effectiveFunction,
  functions,
  functionsNamed,
  grants,
  indexes,
  inserts,
  migrationFiles,
  policies,
  policiesFor,
  rawSql,
  readSqlTest,
  revokes,
  rlsEnabledTables,
  splitTopLevel,
  sqlTestFiles,
  sqlTestPlan,
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
  // An operating value that was never agreed at the external gate must stop the
  // flow with its own name, not fall back to an invented default.
  'config_unresolved',
  // A purge job whose work is not fully recorded must not be closed.
  'purge_incomplete',
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

  /* -- fail closed on an unconfigured lifetime ---------------------------- */

  it('cannot store a code without an expiry', () => {
    expect(tableColumns('public.couple_invites').get('expires_at')).toMatch(/not\s+null/i);
  });

  it('rejects a missing, unresolved, zero or negative lifetime by name', () => {
    const guard = functions().find((f) => /require_config_seconds/i.test(f.name));
    expect(guard, 'no configuration guard helper').toBeDefined();
    expect(guard.body).toMatch(/config_unresolved/);
    // Each rejected shape has to be distinguishable in the raised detail.
    for (const reason of ['missing', 'unresolved', 'not_a_number', 'not_positive']) {
      expect(guard.body, `${reason} not handled`).toContain(`'${reason}'`);
    }
    expect(guard.body).toMatch(/\bresolved\b/);
    expect(guard.body).toMatch(/<=\s*0|<\s*1/);
  });

  it('refuses to issue before it revokes or inserts anything', () => {
    const [issuer] = functionsNamed('app.issue_invite');
    expect(issuer).toBeDefined();
    expect(issuer.body).toMatch(/require_config_seconds/);
    // Order matters: a failed configuration check must not have already revoked
    // the couple's working code.
    const check = issuer.body.search(/require_config_seconds/);
    const revoke = issuer.body.search(/'revoked'/);
    const insert = issuer.body.search(/insert\s+into\s+public\.couple_invites/i);
    expect(check).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(check);
    expect(insert).toBeGreaterThan(check);
    // No conditional fallback that would leave expires_at null.
    expect(issuer.body).not.toMatch(/if\s+v_ttl\s+is\s+not\s+null/i);
  });

  it('never invents a lifetime in the production seed', () => {
    const seed = inserts().find((i) => i.table === 'app.config');
    expect(seed.code).toMatch(/'invite_ttl_seconds'\s*,\s*null\s*,\s*false/i);
  });

  it('describes the unset lifetime as fail closed, not as a code without expiry', () => {
    const seed = inserts().find((i) => i.table === 'app.config');
    const row = seed.code.slice(seed.code.indexOf("'invite_ttl_seconds'"));
    const description = row.slice(0, row.indexOf('),'));
    // The description is what an operator reads before setting the value; it must
    // not still promise the behaviour that was removed.
    expect(description, 'the seed still advertises non-expiring invites').not.toMatch(
      /no expiry|never expires?|non.?expiring/i,
    );
    expect(description).toMatch(/refuse|reject|fail|blocked?/i);
    // And it must not smuggle in a suggested lifetime.
    expect(description).not.toMatch(/\b\d{2,}\b/);
  });

  it('stops advertising an unresolved ttl that can no longer happen', () => {
    const [json] = functionsNamed('app.invite_public_json');
    expect(json).toBeDefined();
    expect(json.body).not.toMatch(/ttl_unresolved/);
  });

  it('keeps expiry distinguishable from revocation on a repeated attempt', () => {
    // A repeated attempt on the same code has to still say "expired". Folding
    // expiry into the revoked status would answer invite_revoked the second time.
    expect(tableSql('public.couple_invites')).toMatch(/'expired'/);
    expect(tableColumns('public.couple_invites').has('expired_at')).toBe(true);

    const [join] = functionsNamed('public.join_couple_with_code');
    expect(join.body).toMatch(/set\s+status\s*=\s*'expired'/i);
    expect(join.body).not.toMatch(/expires_at[\s\S]{0,80}status\s*=\s*'revoked'/i);
    // The lookup branch that runs when no active row matched must fork three ways.
    const fallback = join.body.slice(join.body.search(/order\s+by\s+created_at\s+desc/i));
    for (const code of ['invite_consumed', 'invite_expired', 'invite_revoked']) {
      expect(fallback, `${code} unreachable on a repeated attempt`).toContain(code);
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

describe('a new visit starts genuinely empty', () => {
  it('accepts only the place snapshot, the time and the request key', () => {
    const [create] = functionsNamed('public.create_visit');
    expect(create).toBeDefined();
    const params = splitTopLevel(create.args, ',').map((p) => p.trim());
    expect(params.length, `create_visit takes ${params.length} parameters`).toBe(3);
    expect(params[0]).toMatch(/^p_place\s+jsonb$/i);
    expect(params[1]).toMatch(/^p_visited_at\s+timestamptz$/i);
    // Mandatory: no default, so a caller cannot skip the idempotency boundary.
    expect(params[2]).toMatch(/^p_request_key\s+text$/i);
    expect(create.args).not.toMatch(/p_flower_key|p_tags/i);
  });

  it('creates no flower and no tag of its own', () => {
    const [create] = functionsNamed('public.create_visit');
    expect(create.body).not.toMatch(/flower_key/i);
    expect(create.body).not.toMatch(/visit_tags/i);
    expect(create.body).not.toMatch(/\bforeach\b/i);
  });

  it('leaves the shared flower nullable so it can be chosen later', () => {
    expect(tableColumns('public.visits').get('flower_key')).not.toMatch(/not\s+null/i);
  });

  it('gives a client no way to insert a visit around the RPC', () => {
    expect(
      policiesFor('public.visits', 'insert').filter((p) => p.command === 'insert').length,
      'a direct insert policy would bypass the idempotency boundary',
    ).toBe(0);
    for (const grant of grants()) {
      if (!/\btable\s+public\.visits\b/i.test(grant.code)) continue;
      expect(grant.code, 'insert on visits must not be granted').not.toMatch(/\binsert\b/i);
    }
  });

  it('still lets both members update the visit and set tags through the RPC', () => {
    expect(policiesFor('public.visits', 'update').length).toBeGreaterThan(0);
    expect(functionsNamed('public.set_visit_tags').length).toBe(1);
    const tagGrant = grants().some(
      (g) => g.code.includes('public.set_visit_tags') && g.roles.includes('authenticated'),
    );
    expect(tagGrant).toBe(true);
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

  it('keeps a generic immutable column guard for the other shared tables', () => {
    const guard = functions().find((f) => /guard_immutable_columns/i.test(f.name));
    expect(guard).toBeDefined();
    for (const [table, column] of [
      ['public.visits', 'couple_id'],
      ['public.visit_entries', 'author_id'],
    ]) {
      const trigger = statements().find(
        (st) =>
          /create\s+trigger/i.test(st.code) &&
          new RegExp(`before\\s+update\\s+on\\s+${table}\\b`, 'i').test(st.code) &&
          /guard_immutable_columns/i.test(st.code),
      );
      expect(trigger, `${table} has no immutable column guard`).toBeDefined();
      expect(trigger.code).toContain(column);
    }
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

  it('keeps the couple and original picker immutable after insert', () => {
    const trigger = statements().find(
      (st) =>
        /create\s+trigger/i.test(st.code) &&
        /before\s+update\s+on\s+public\.wishlist_places\b/i.test(st.code) &&
        /guard_immutable_columns/i.test(st.code),
    );
    expect(trigger, 'wishlist_places has no immutable identity guard').toBeDefined();
    expect(trigger.code).toMatch(
      /guard_immutable_columns\s*\(\s*'couple_id'\s*,\s*'created_by'\s*\)/i,
    );
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

  it('makes a queued job eligible immediately, not at its due date', () => {
    // The effective definition, not the first: claim_purge_jobs is replaced by a
    // later migration, and it is the live one that has to hold this property.
    const claim = effectiveFunction('public.claim_purge_jobs');
    expect(claim).toBeDefined();
    expect(claim.body).toMatch(/status\s*=\s*'queued'/i);
    // due_at is the completion target, never a gate on picking the job up.
    expect(claim.body).not.toMatch(/due_at\s*(<|<=|>|>=)/);
  });

  it('can reclaim a job left running by a worker that never reported back', () => {
    // claim_purge_jobs moves a job to running before the worker touches anything.
    // If that process exits without calling complete_purge_job — a crash, a
    // function timeout, or the worker's own `unsettled` outcome — the row keeps
    // status = 'running' and nothing moves it again, because the claim only ever
    // looked at queued rows. The spec requires a failed deletion to be retried
    // and to stay operationally traceable, so a stranded job has to become
    // claimable again.
    const claim = effectiveFunction('public.claim_purge_jobs');
    expect(claim).toBeDefined();
    expect(claim.body, 'a stranded running job is never reconsidered').toMatch(/'running'/);
    expect(claim.body, 'staleness is measured from the claim, not the completion target').toMatch(
      /started_at/,
    );
    // The lease length is an operating value. A literal here would be an invented
    // policy, exactly what app.config exists to avoid.
    expect(claim.body, 'a hardcoded lease length is an invented operating value').not.toMatch(
      /interval\s+'\d/i,
    );
    expect(claim.body).toMatch(/purge_lease_seconds/);
  });

  it('leaves the reclaim lease at the external gate instead of inventing one', () => {
    // Same rule as every other deferred value: unresolved means the mechanism
    // stays inert rather than running on a number nobody agreed to.
    const seeds = inserts().filter((i) => i.table === 'app.config');
    expect(seeds.length).toBeGreaterThan(0);
    const seed = seeds.find((s) => s.code.includes("'purge_lease_seconds'"));
    expect(seed, 'purge_lease_seconds is not seeded in app.config').toBeDefined();
    expect(seed.code).toMatch(/EXTERNAL GATE/i);

    // And the reader must honour `resolved`, not just a present value.
    const reader = functions().find((f) => /config_resolved_seconds/i.test(f.name));
    expect(reader, 'no reader that requires resolved = true').toBeDefined();
    expect(reader.body).toMatch(/resolved/);

    // A resolved but unusable value must read as absent, not raise and not be
    // silently reinterpreted. `'1.5'::integer` raises 22P02 rather than rounding,
    // and a raise inside claim_purge_jobs takes the whole worker down with it.
    expect(reader.body, 'a fractional lease is not rejected').toMatch(/floor/i);
    expect(reader.body, 'an unusable value is not reported as absent').toMatch(
      /return\s+null/i,
    );
    // Sequential checks, so the numeric cast cannot be evaluated for a row whose
    // type or range test has not been applied.
    expect(reader.language).toBe('plpgsql');
  });

  /* -- a purge must not reach past the couple it belongs to ---------------- */

  it('touches nothing that outlives the disconnected couple', () => {
    const [purge] = functionsNamed('public.purge_couple_data');
    expect(purge).toBeDefined();
    // Either user may already have a new couple by the time the job runs.
    expect(purge.body, 'a personal profile name is not couple data').not.toMatch(
      /display_name/i,
    );
    expect(purge.body, 'idempotency keys are user wide, not couple scoped').not.toMatch(
      /delete\s+from\s+app\.idempotency_keys/i,
    );
    expect(purge.body, 'invite attempts are user wide, not couple scoped').not.toMatch(
      /delete\s+from\s+app\.invite_attempts/i,
    );
    // And nothing may be keyed off the member list, which is what leaked before.
    expect(purge.body).not.toMatch(/user_id\s*=\s*any/i);
  });

  it('scopes every delete it does perform to the job couple', () => {
    const [purge] = functionsNamed('public.purge_couple_data');
    const deletes = [...purge.body.matchAll(/delete\s+from\s+([a-z_.]+)([^;]*);/gi)];
    expect(deletes.length).toBeGreaterThanOrEqual(4);
    for (const [stmt, table] of deletes) {
      expect(stmt, `${table} delete is not couple scoped`).toMatch(
        /couple_id\s*=\s*v_job\.couple_id/i,
      );
    }
    for (const table of [
      'public.visits',
      'public.wishlist_places',
      'public.couple_invites',
      'public.couple_members',
    ]) {
      expect(purge.body, `${table} not purged`).toContain(table);
    }
  });

  it('closes a job only once the database purge and every object are recorded', () => {
    const [complete] = functionsNamed('public.complete_purge_job');
    expect(complete).toBeDefined();
    expect(complete.body).toMatch(/db_purged_at\s+is\s+null/i);
    expect(complete.body).toMatch(/deleted_at\s+is\s+null/i);
    expect(complete.body).toMatch(/purge_incomplete/);
    // An unfinished job goes back on the queue instead of being closed.
    const succeeded = complete.body.search(/'succeeded'/);
    const incomplete = complete.body.search(/purge_incomplete/);
    expect(incomplete).toBeGreaterThan(-1);
    expect(incomplete).toBeLessThan(succeeded);
    expect(complete.body).toMatch(/last_error/);
  });

  it('keeps a failed job retryable and visible', () => {
    const [complete] = functionsNamed('public.complete_purge_job');
    expect(complete.body).toMatch(/'queued'/);
    expect(complete.body).toMatch(/'failed'/);
    expect(complete.body).toMatch(/purge_max_attempts/);
  });

  it('clears completed_at when it requeues an incomplete job', () => {
    const [complete] = functionsNamed('public.complete_purge_job');
    // The requeue branch: p_succeeded was true but the work is not all recorded.
    const start = complete.body.search(/db_purged_at\s+is\s+null\s+or\s+v_pending\s*>\s*0/i);
    expect(start, 'requeue branch not found').toBeGreaterThan(-1);
    const branch = complete.body.slice(start, complete.body.indexOf('purge_incomplete', start));
    expect(branch).toMatch(/status\s*=\s*'queued'/i);
    // A queued job carrying a completion timestamp is internally inconsistent.
    expect(branch, 'requeue leaves a stale completed_at behind').toMatch(
      /completed_at\s*=\s*null/i,
    );
    expect(branch).toMatch(/last_error/);
  });
});

describe('README states ownership and blast radius accurately', () => {
  const readme = () => readFileSync(join(SUPABASE_DIR, 'README.md'), 'utf8');

  it('attributes the repository mapping to the wave that owns it', () => {
    const text = readme();
    expect(text, 'the mapping owner is W1-C, not W1-B').not.toMatch(/\bW1-B\b/);
    expect(text).toMatch(/\bW1-C\b/);
  });

  it('scopes the unresolved TTL to couple creation and invite issuance', () => {
    const text = readme();
    // The failure is confined to the onboarding calls that issue a code. Saying
    // the app or the session does not start overstates it: every other screen,
    // read and RPC is unaffected.
    expect(text, 'overstates the blast radius as app or session startup').not.toMatch(
      /앱이\s*시작되지\s*않는다|세션.{0,6}시작되지\s*않는다|app (does not|cannot) start/i,
    );
    expect(text).toMatch(/커플 생성/);
    expect(text).toMatch(/초대 코드 발급|초대코드 발급/);
  });
});

describe('photo path and ownership contract', () => {
  it('validates the canonical path against the target visit', () => {
    const [photo] = functionsNamed('public.register_visit_photo');
    expect(photo).toBeDefined();
    // Three segments: couple, visit, filename.
    expect(photo.body).toMatch(/string_to_array|storage\.foldername/i);
    expect(photo.body).toMatch(/array_length\s*\([\s\S]{0,40}<>\s*3|=\s*3/);
    expect(photo.body, 'the couple segment is unchecked').toMatch(/v_couple_id/);
    expect(photo.body, 'the visit segment is unchecked').toMatch(
      /\[\s*2\s*\][\s\S]{0,60}p_visit_id|p_visit_id[\s\S]{0,60}\[\s*2\s*\]/,
    );
    expect(photo.body).toMatch(/validation_error/);
    expect(photo.body).toMatch(/'visit-photos'/);
  });

  it('enforces the canonical object reference on the table, not only in the RPC', () => {
    // register_visit_photo is not the only writer: the browser holds a direct
    // insert grant plus an insert policy that asks for nothing but its own
    // uploader_id and a readable visit. So a member can write a metadata row
    // naming any bucket and any path, and the RPC's own path validation never
    // runs. That row is not inert — disconnect_couple snapshots exactly these
    // two columns into app.purge_job_objects for the service-role worker, so an
    // unchecked value here decides what a privileged process is later asked to
    // delete.
    const clientInsert = grants().some(
      (g) =>
        /\binsert\b/i.test(g.code) &&
        /\bpublic\.visit_photos\b/i.test(g.code) &&
        g.roles.includes('authenticated'),
    );
    expect(clientInsert, 'no direct client insert, so the RPC really is the only writer').toBe(
      true,
    );

    const guard = functions().find((f) => /guard_visit_photo_object/i.test(f.name));
    expect(guard, 'no table level guard on the object reference').toBeDefined();
    // Definer: it has to read the visit's true couple_id past RLS, and raise_error
    // is not executable by a client role.
    expect(guard.securityDefiner).toBe(true);
    expect(guard.body, 'the bucket is unpinned').toMatch(/'visit-photos'/);
    expect(guard.body).toMatch(/string_to_array/i);
    expect(guard.body).toMatch(/array_length\s*\([\s\S]{0,40}(<>|=)\s*3/);
    expect(guard.body, 'the couple segment is unchecked').toMatch(/couple_id/);
    expect(guard.body, 'the visit segment is unchecked').toMatch(
      /\[\s*2\s*\][\s\S]{0,80}visit_id|visit_id[\s\S]{0,80}\[\s*2\s*\]/,
    );

    const trigger = statements().find(
      (st) =>
        /create\s+trigger/i.test(st.code) &&
        /before\s+insert[\s\S]{0,24}on\s+public\.visit_photos\b/i.test(st.code) &&
        /guard_visit_photo_object/i.test(st.code),
    );
    expect(trigger, 'the object guard is not wired to visit_photos inserts').toBeDefined();
  });

  it('rejects every path shape the privileged worker would refuse', () => {
    // The bar is not the RPC's check, it is what the service-role worker accepts.
    // A path the worker refuses is exactly what strands a job — it cannot delete
    // it and the refusal costs the couple its 24 hour deletion guarantee — so
    // anything validPath() rejects must never reach a metadata row.
    const guard = functions().find((f) => /guard_visit_photo_object/i.test(f.name));
    expect(guard, 'no table level guard on the object reference').toBeDefined();

    expect(guard.body, 'control characters are accepted').toMatch(/\[\[:cntrl:\]\]/);
    expect(guard.body, 'backslashes are accepted').toMatch(
      /strpos\s*\(\s*new\.storage_path/i,
    );
    expect(guard.body, "'.' and '..' filenames are accepted").toMatch(
      /'\.'[\s\S]{0,24}'\.\.'/,
    );

    // Canonical text, not a uuid-valued comparison: app.try_uuid treats braces,
    // uppercase and a hyphenless form as the same uuid, but the worker compares
    // the `<couple_id>/` prefix byte for byte.
    expect(guard.body).toMatch(/v_couple_id::text/);
    expect(guard.body).toMatch(/visit_id::text/);
    expect(
      guard.body,
      'a uuid-valued segment test lets an uppercase or hyphenless prefix through',
    ).not.toMatch(/try_uuid/);

    // The length bound is read off the worker rather than restated, so the two
    // cannot drift apart silently.
    const worker = readFileSync(
      join(SUPABASE_DIR, 'functions', 'purge-couple-data', 'purge.js'),
      'utf8',
    );
    const bound = /value\.length\s*>\s*(\d+)/.exec(worker);
    expect(bound, 'purge.js no longer bounds the object path length').not.toBeNull();
    // octet_length, not char_length. The worker bounds `value.length`, which is a
    // count of UTF-16 code units; char_length counts characters, so 600 emoji pass
    // a char_length bound of 1024 and then fail the worker's at 1200. UTF-8 octets
    // are never fewer than UTF-16 code units, so an octet bound cannot be looser.
    expect(
      guard.body,
      `the worker refuses a path over ${bound?.[1]} UTF-16 units; an octet bound is the safe mirror`,
    ).toMatch(new RegExp(`octet_length\\s*\\(\\s*new\\.storage_path\\s*\\)\\s*>\\s*${bound[1]}`));
    expect(
      guard.body,
      'char_length counts characters, so it is looser than the worker for non-BMP text',
    ).not.toMatch(/char_length\s*\(\s*new\.storage_path/);

    // And the worker side must still be the thing being mirrored.
    expect(worker, 'the worker stopped rejecting backslashes').toMatch(/includes\('\\\\'\)/);
    expect(worker, 'the worker stopped rejecting control characters').toMatch(
      /\[\\u0000-\\u001f\\u007f\]/,
    );
    expect(worker, 'the worker stopped rejecting . and .. segments').toMatch(
      /segment === '\.'\s*\|\|\s*segment === '\.\.'/,
    );
  });

  it('requires both the couple and a readable visit to write an object', () => {
    const insert = policies().find(
      (p) => p.table === 'storage.objects' && p.command === 'insert',
    );
    expect(insert).toBeDefined();
    expect(insert.expression).toMatch(/app\.current_couple_id/);
    expect(insert.expression, 'the visit path segment is unchecked').toMatch(
      /app\.can_read_visit[\s\S]{0,80}\[\s*2\s*\]/,
    );
  });

  it('stops a partner overwriting an object they did not upload', () => {
    const update = policies().find(
      (p) => p.table === 'storage.objects' && p.command === 'update',
    );
    expect(update).toBeDefined();
    expect(update.expression, 'update is not gated on uploader ownership').toMatch(
      /uploader_id\s*=\s*auth\.uid\(\)/i,
    );
    expect(update.expression).toMatch(/public\.visit_photos/);
  });

  it('permits a shared reorder and nothing else on the metadata row', () => {
    const guard = functions().find((f) => /guard_visit_photo_columns/i.test(f.name));
    expect(guard, 'no metadata update guard').toBeDefined();
    // Allow-list rather than deny-list, so a column added later is immutable by
    // default instead of silently writable.
    expect(guard.body).toMatch(/'ordinal'/);
    expect(guard.body).toMatch(/'updated_at'/);
    expect(guard.body).toMatch(/is\s+distinct\s+from/i);
    for (const column of ['id', 'visit_id', 'uploader_id', 'storage_path', 'checksum']) {
      expect(guard.body, `${column} must not be named as mutable`).not.toContain(
        `'${column}'`,
      );
    }
    const trigger = statements().find(
      (st) =>
        /create\s+trigger/i.test(st.code) &&
        /before\s+update\s+on\s+public\.visit_photos/i.test(st.code) &&
        /guard_visit_photo_columns/i.test(st.code),
    );
    expect(trigger, 'the guard is not wired to visit_photos').toBeDefined();
  });

  it('forces the bucket private without discarding configured limits', () => {
    const bucket = inserts().find((i) => i.table === 'storage.buckets');
    expect(bucket).toBeDefined();
    expect(bucket.code, 'an existing public bucket would stay public').not.toMatch(
      /on\s+conflict[\s\S]*do\s+nothing/i,
    );
    expect(bucket.code).toMatch(/on\s+conflict\s*\(\s*id\s*\)\s*do\s+update/i);
    const doUpdate = bucket.code.slice(bucket.code.search(/do\s+update/i));
    expect(doUpdate).toMatch(/public\s*=\s*false/i);
    // Size and MIME are set outside SQL; the conflict path must leave them alone.
    expect(doUpdate, 'the conflict path overwrites file_size_limit').not.toMatch(
      /file_size_limit/i,
    );
    expect(doUpdate, 'the conflict path overwrites allowed_mime_types').not.toMatch(
      /allowed_mime_types/i,
    );
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
    expect(files.length).toBeGreaterThanOrEqual(7);
    const joined = files.join(' ');
    for (const topic of [
      'two_user',
      'cross_couple',
      'entry_author',
      'photo',
      'invite',
      'disconnect',
      // Regression: an old couple's purge must not touch new-couple state.
      'purge_isolation',
      'wishlist_identity',
    ]) {
      expect(joined, `no SQL scenario covers ${topic}`).toContain(topic);
    }
  });

  it('contains no assertion that is predicated to never match a row', () => {
    for (const file of sqlTestFiles()) {
      const sql = readSqlTest(file);
      expect(sql, `${file} has a statement that cannot affect a row`).not.toMatch(
        /\b(and|where)\s+false\b/i,
      );
    }
  });

  it('asserts the partner reorder actually moved a row', () => {
    const file = sqlTestFiles().find((f) => /photo/i.test(f));
    expect(file).toBeDefined();
    const sql = readSqlTest(file);
    const reorder = sql.slice(sql.search(/reorder/i));
    expect(reorder).toMatch(/update\s+public\.visit_photos\s+set\s+ordinal\s*=/i);
    // A lives_ok on a no-op update proves nothing; the new value has to be read back.
    expect(reorder).toMatch(/\bis\s*\(|\bselect\s+is\b/i);
    expect(reorder).toMatch(/select\s+ordinal\s+from\s+public\.visit_photos/i);
  });

  it('resolves the invite lifetime in test setup rather than relying on a default', () => {
    for (const file of sqlTestFiles()) {
      const sql = readSqlTest(file);
      if (!/create_couple|issue_invite/i.test(sql)) continue;
      expect(sql, `${file} calls create_couple without resolving the ttl`).toMatch(
        /update\s+app\.config[\s\S]{0,200}invite_ttl_seconds/i,
      );
    }
  });

  it('states plainly that these scripts have not been run', () => {
    for (const file of sqlTestFiles()) {
      expect(readSqlTest(file).slice(0, 400)).toMatch(/NOT EXECUTED/);
    }
  });

  /* -- the declared plan has to match what the file actually asserts -------- */

  it('declares a plan count equal to its top-level assertions', () => {
    // A wrong plan makes pgTAP report a bad run as good, or a good run as bad,
    // and nothing else in this suite would notice. These scripts cannot be
    // executed here, so this arithmetic is the only check they get.
    const mismatched = [];
    for (const file of sqlTestFiles()) {
      const plan = sqlTestPlan(file);
      if (plan.declared !== plan.counted) mismatched.push(plan);
    }
    expect(
      mismatched.map((p) => `${p.file}: plan(${p.declared}) but ${p.counted} assertions`),
    ).toEqual([]);
  });

  it('declares a plan at all', () => {
    for (const file of sqlTestFiles()) {
      expect(sqlTestPlan(file).declared, `${file} has no select plan(n)`).toBeTypeOf('number');
    }
  });

  it('recognises every top-level call, so the count cannot silently undershoot', () => {
    // If a script starts using a pgTAP assertion the counter does not know, the
    // total would be too low and the plan check would pass for the wrong reason.
    const unknown = [];
    for (const file of sqlTestFiles()) {
      const plan = sqlTestPlan(file);
      for (const fn of plan.unrecognised) unknown.push(`${file}: ${fn}()`);
    }
    expect(unknown, 'extend PGTAP_ASSERTIONS or PGTAP_NON_ASSERTIONS').toEqual([]);
  });

  it('counts what pgTAP would count, not raw text matches', () => {
    // A unit test on the counter itself, so the plan check above cannot pass
    // because the counter is broken in the same direction as the files.
    const sample = [
      'select plan(3);',
      "select ok(true, 'counted');",
      "  select is(1, 1, 'counted even when indented');",
      "select diag('is(1, 1, ''not an assertion'') inside a string');",
      "select throws_ok($$update t set c = 1 where ok(false)$$, 'TW003', null, 'counted once');",
      'select public.some_rpc(1);',
      "select set_config('x', 'y', true);",
      'select * from finish();',
    ].join('\n');

    const plan = countPgTapPlan(sample);
    expect(plan.declared).toBe(3);
    expect(plan.counted).toBe(3);
    expect(plan.unrecognised).toEqual([]);
  });

  it('reports a top-level call it does not know rather than skipping it', () => {
    const plan = countPgTapPlan("select plan(1);\nselect col_is_unique('t', 'c', 'x');");
    expect(plan.unrecognised).toEqual(['col_is_unique']);
    expect(plan.counted).toBe(0);
  });

  /* -- each script has to bring pgTAP's own visibility with it --------------- */

  /**
   * pgTAP is installed in the `extensions` schema, and the linked CLI enables it
   * on a connection that has already run `set session role postgres` — while
   * pg_prove connects separately as the temp login named in PGUSER, which holds no
   * usage on that schema. So visibility is two problems, not one: the schema has
   * to be reachable *and* on the search_path, before the first plan() call. A
   * script that calls plan() first dies on statement one and reports zero
   * assertions instead of a failure anyone can read.
   *
   * The grant is transaction scoped like everything else here; the rollback at the
   * end of each file removes it, so no file changes a lasting privilege.
   *
   * The bootstrap then *stays* as postgres, because the temp login cannot reach
   * the app or auth schemas the fixtures write. `reset role` is what returns that
   * login, so it is banned outright — a block under authenticated or service_role
   * hands back with an explicit `set local role postgres;` instead.
   */
  const BOOTSTRAP = [
    'begin;',
    'create extension if not exists pgtap with schema extensions;',
    'set local role postgres;',
    'grant usage on schema extensions to public;',
    'set local search_path = extensions, public, pg_catalog;',
  ];

  /**
   * The role in force for each statement line. Only `set local role` moves it, so
   * `reset role` shows up as the temp login the CLI connected with.
   */
  const roleTimeline = (sql) => {
    let role = 'the temp login';
    return codeLines(sql).map((line) => {
      const set = /^set local role ([a-z_]+);$/.exec(line);
      if (set) role = set[1];
      else if (/^reset\s+role\b/i.test(line)) role = 'the temp login';
      return { line, role };
    });
  };

  /**
   * Statement lines, with blanks and comments dropped. A mistake here makes the
   * exact comparisons below fail rather than pass, so it needs no test of its own.
   */
  const codeLines = (sql) =>
    sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('--'));

  it('opens every scenario with the exact pgTAP bootstrap, in order', () => {
    expect(sqlTestFiles().length).toBeGreaterThanOrEqual(9);
    const wrong = [];
    for (const file of sqlTestFiles()) {
      const lines = codeLines(readSqlTest(file));
      const head = lines.slice(0, BOOTSTRAP.length);
      // Exact text and exact position, so a missing pg_catalog, a reordered or
      // extra schema, a dropped grant, and a session-wide SET or SET ROLE in place
      // of the SET LOCAL forms all fail here.
      if (head.join(' ') !== BOOTSTRAP.join(' ')) {
        wrong.push(`${file}: opens with ${head.join(' ') || '(nothing)'}`);
      } else if (!/^select plan\(\d+\);$/.test(lines[BOOTSTRAP.length] ?? '')) {
        wrong.push(
          `${file}: statement ${BOOTSTRAP.length + 1} is ${
            lines[BOOTSTRAP.length] ?? '(nothing)'
          }, not select plan(n)`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it('touches search_path and privileges nowhere else, so nothing outlives the rollback', () => {
    // pg_prove reuses one connection for the whole file list, so anything that
    // survives the rollback would decide what the next script sees. A second grant,
    // or one aimed at a role or a default privilege, would do exactly that.
    const wrong = [];
    for (const file of sqlTestFiles()) {
      const lines = codeLines(readSqlTest(file));
      const once = (label, re) => {
        const hits = lines.filter((l) => re.test(l));
        if (hits.length !== 1) wrong.push(`${file}: ${hits.length} ${label} statements`);
      };
      once('search_path', /search_path/i);
      once('grant', /^grant\b/i);
      for (const line of lines) {
        if (/^alter\s+(role|user|database|default\s+privileges)\b/i.test(line)) {
          wrong.push(`${file}: ${line}`);
        }
        // Only the pgTAP schema may be opened up, and only to get plan() resolved.
        if (/^grant\b/i.test(line) && line !== 'grant usage on schema extensions to public;') {
          wrong.push(`${file}: ${line}`);
        }
        // Session-wide forms outlive the rollback and reach the next script.
        if (/^set\s+(role|session)\b/i.test(line)) wrong.push(`${file}: ${line}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('never hands the session back to the CLI temp login', () => {
    // What the linked run died on: `reset role` restores the temp login named in
    // PGUSER, which holds no usage on app or auth, so the next fixture statement
    // fails with permission denied and the file stops before its first assertion.
    const wrong = [];
    for (const file of sqlTestFiles()) {
      const timeline = roleTimeline(readSqlTest(file));
      for (const { line } of timeline) {
        if (/^reset\s+role\b/i.test(line)) wrong.push(`${file}: ${line}`);
      }
      // finish() and the rollback have to land privileged too, which also means
      // every authenticated or service_role block has an explicit way back.
      const last = timeline.filter(({ line }) => /^set local role /.test(line)).at(-1);
      if (last?.role !== 'postgres') {
        wrong.push(`${file}: last role is ${last?.role ?? '(none)'}, not postgres`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('runs privileged fixture setup as postgres', () => {
    // The exact two statements the remote refused: seeding app.config and inserting
    // the anonymous auth users. Reads of app.* under authenticated or service_role
    // are left alone — the migrations grant those roles usage on that schema.
    const wrong = [];
    for (const file of sqlTestFiles()) {
      for (const { line, role } of roleTimeline(readSqlTest(file))) {
        if (/^(insert into auth\.|update app\.)/i.test(line) && role !== 'postgres') {
          wrong.push(`${file}: as ${role}: ${line.slice(0, 52)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps each scenario in one transaction it rolls back', () => {
    const wrong = [];
    for (const file of sqlTestFiles()) {
      const lines = codeLines(readSqlTest(file));
      const count = (re) => lines.filter((l) => re.test(l)).length;
      if (count(/^begin;$/) !== 1) wrong.push(`${file}: ${count(/^begin;$/)} BEGIN`);
      if (count(/^rollback;$/) !== 1) wrong.push(`${file}: ${count(/^rollback;$/)} ROLLBACK`);
      if (count(/^commit\b/i) > 0) wrong.push(`${file}: commits instead of rolling back`);
      if (lines.at(-1) !== 'rollback;') wrong.push(`${file}: ends with ${lines.at(-1)}`);
    }
    expect(wrong).toEqual([]);
  });
});

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPurgeHandler } from './purge.js';

const PROJECT_ORIGIN = 'https://project-ref.supabase.co';
const FUNCTION_URL = `${PROJECT_ORIGIN}/functions/v1/purge-couple-data`;
const AUTHORIZATION = 'Bearer server-scheduler-token';
const COUPLE_A = '11111111-1111-4111-8111-111111111111';
const COUPLE_B = '22222222-2222-4222-8222-222222222222';
const JOB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ok = (data) => ({ ok: true, replayed: false, data });
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const rpcName = (url) => new URL(url).pathname.split('/').at(-1);
const requestBody = (init) => JSON.parse(init.body);
const request = ({ authorization = AUTHORIZATION, url = FUNCTION_URL, method = 'POST' } = {}) =>
  new Request(url, {
    method,
    headers: authorization ? { authorization } : {},
  });

const handlerFor = (fetchImpl, options = {}) =>
  createPurgeHandler({
    fetchImpl,
    getEnv: (name) => (name === 'SUPABASE_URL' ? PROJECT_ORIGIN : undefined),
    ...options,
  });

const job = ({
  jobId = JOB_A,
  coupleId = COUPLE_A,
  objects = [],
} = {}) => ({
  job_id: jobId,
  couple_id: coupleId,
  due_at: '2026-08-04T00:00:00.000Z',
  attempts: 1,
  objects,
});

describe('purge-couple-data worker', () => {
  it('provides a separately testable purge module', () => {
    const modulePath = resolve('supabase/functions/purge-couple-data/purge.js');

    expect(existsSync(modulePath)).toBe(true);
    expect(createPurgeHandler).toBeTypeOf('function');
  });

  it('succeeds without storage work when the bounded claim is empty', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(new URL(url).origin).toBe(PROJECT_ORIGIN);
      expect(new URL(url).pathname).toBe('/rest/v1/rpc/claim_purge_jobs');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.headers.authorization).toBe(AUTHORIZATION);
      expect(init.headers.apikey).toBe('server-scheduler-token');
      expect(requestBody(init)).toEqual({ p_limit: 10 });
      return jsonResponse(ok({ jobs: [] }));
    });

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      claimed: 0,
      succeeded: 0,
      requeued: 0,
      failed: 0,
      unsettled: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('deletes and marks an exact queued photo before purging and completing its job', async () => {
    const exactPath = `${COUPLE_A}/visit-a/photo.webp`;
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const body = requestBody(init);
      calls.push({ pathname: parsed.pathname, method: init.method, body });

      if (rpcName(url) === 'claim_purge_jobs') {
        return jsonResponse(ok({
          jobs: [job({ objects: [{ bucket_id: 'visit-photos', object_path: exactPath, is_prefix: false }] })],
        }));
      }
      if (parsed.pathname === '/storage/v1/object/visit-photos') {
        expect(init.method).toBe('DELETE');
        return jsonResponse([{ name: exactPath }]);
      }
      if (rpcName(url) === 'mark_purge_objects_deleted') {
        return jsonResponse(ok({ job_id: JOB_A, marked: 1 }));
      }
      if (rpcName(url) === 'purge_couple_data') {
        return jsonResponse(ok({ job_id: JOB_A, couple_id: COUPLE_A, visits_deleted: 1 }));
      }
      if (rpcName(url) === 'complete_purge_job') {
        return jsonResponse(ok({ job_id: JOB_A, status: 'succeeded' }));
      }
      throw new Error(`unexpected request: ${parsed.pathname}`);
    });

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 1, succeeded: 1, requeued: 0 });
    expect(calls).toEqual([
      expect.objectContaining({ pathname: '/rest/v1/rpc/claim_purge_jobs' }),
      expect.objectContaining({
        pathname: '/storage/v1/object/visit-photos',
        method: 'DELETE',
        body: { prefixes: [exactPath] },
      }),
      expect.objectContaining({
        pathname: '/rest/v1/rpc/mark_purge_objects_deleted',
        body: { p_job_id: JOB_A, p_object_paths: [exactPath] },
      }),
      expect.objectContaining({
        pathname: '/rest/v1/rpc/purge_couple_data',
        body: { p_job_id: JOB_A },
      }),
      expect.objectContaining({
        pathname: '/rest/v1/rpc/complete_purge_job',
        body: { p_job_id: JOB_A, p_succeeded: true, p_error: null },
      }),
    ]);
  });

  it('recursively lists paginated prefix contents and deletes every discovered object', async () => {
    const prefix = `${COUPLE_A}/`;
    const fileOne = `${prefix}visit-a/one.webp`;
    const fileTwo = `${prefix}visit-b/two.webp`;
    const nested = `${prefix}visit-a/thumbs/nested.webp`;
    const deleted = [];
    const listed = [];
    let verificationStarted = false;

    const fetchImpl = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const body = requestBody(init);
      if (rpcName(url) === 'claim_purge_jobs') {
        return jsonResponse(ok({
          jobs: [job({ objects: [{ bucket_id: 'visit-photos', object_path: prefix, is_prefix: true }] })],
        }));
      }
      if (parsed.pathname === '/storage/v1/object/list/visit-photos') {
        listed.push({ prefix: body.prefix, offset: body.offset });
        if (verificationStarted) return jsonResponse([]);
        if (body.prefix === prefix && body.offset === 0) {
          return jsonResponse([
            { name: 'visit-a', id: null, metadata: null },
            { name: 'visit-b', id: null, metadata: null },
          ]);
        }
        if (body.prefix === prefix && body.offset === 2) return jsonResponse([]);
        if (body.prefix === `${prefix}visit-a/` && body.offset === 0) {
          return jsonResponse([
            { name: 'one.webp', id: 'file-1', metadata: {} },
            { name: 'thumbs', id: null, metadata: null },
          ]);
        }
        if (body.prefix === `${prefix}visit-a/` && body.offset === 2) return jsonResponse([]);
        if (body.prefix === `${prefix}visit-a/thumbs/` && body.offset === 0) {
          return jsonResponse([{ name: 'nested.webp', id: 'file-3', metadata: {} }]);
        }
        if (body.prefix === `${prefix}visit-b/` && body.offset === 0) {
          return jsonResponse([{ name: 'two.webp', id: 'file-2', metadata: {} }]);
        }
        throw new Error(`unexpected list: ${body.prefix} @ ${body.offset}`);
      }
      if (parsed.pathname === '/storage/v1/object/visit-photos') {
        deleted.push(...body.prefixes);
        if (deleted.length === 3) verificationStarted = true;
        return jsonResponse(body.prefixes.map((name) => ({ name })));
      }
      if (rpcName(url) === 'mark_purge_objects_deleted') {
        expect(body.p_object_paths).toEqual([prefix]);
        return jsonResponse(ok({ job_id: JOB_A, marked: 1 }));
      }
      if (rpcName(url) === 'purge_couple_data') {
        return jsonResponse(ok({ job_id: JOB_A, couple_id: COUPLE_A, visits_deleted: 2 }));
      }
      if (rpcName(url) === 'complete_purge_job') {
        return jsonResponse(ok({ job_id: JOB_A, status: 'succeeded' }));
      }
      throw new Error(`unexpected request: ${parsed.pathname}`);
    });

    const response = await handlerFor(fetchImpl, {
      listPageSize: 2,
      deleteBatchSize: 2,
    })(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(new Set(deleted)).toEqual(new Set([fileOne, fileTwo, nested]));
    expect(listed).toEqual(expect.arrayContaining([
      { prefix, offset: 0 },
      { prefix, offset: 2 },
      { prefix: `${prefix}visit-a/`, offset: 0 },
      { prefix: `${prefix}visit-a/`, offset: 2 },
      { prefix: `${prefix}visit-a/thumbs/`, offset: 0 },
      { prefix: `${prefix}visit-b/`, offset: 0 },
    ]));
  });

  it('records an already-missing exact object as deleted', async () => {
    const exactPath = `${COUPLE_A}/visit-a/already-gone.webp`;
    const marked = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const body = requestBody(init);
      if (rpcName(url) === 'claim_purge_jobs') {
        return jsonResponse(ok({ jobs: [job({ objects: [
          { bucket_id: 'visit-photos', object_path: exactPath, is_prefix: false },
        ] })] }));
      }
      if (parsed.pathname === '/storage/v1/object/visit-photos') {
        return jsonResponse({ message: 'not found' }, 404);
      }
      if (rpcName(url) === 'mark_purge_objects_deleted') {
        marked.push(...body.p_object_paths);
        return jsonResponse(ok({ job_id: JOB_A, marked: 1 }));
      }
      if (rpcName(url) === 'purge_couple_data') {
        return jsonResponse(ok({ job_id: JOB_A, couple_id: COUPLE_A, visits_deleted: 0 }));
      }
      if (rpcName(url) === 'complete_purge_job') {
        return jsonResponse(ok({ job_id: JOB_A, status: 'succeeded' }));
      }
      throw new Error(`unexpected request: ${parsed.pathname}`);
    });

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(200);
    expect(marked).toEqual([exactPath]);
    expect(await response.json()).toMatchObject({ succeeded: 1 });
  });

  it('marks only completed deletions and requeues a partially failed job', async () => {
    const exactPath = `${COUPLE_A}/visit-a/deleted.webp`;
    const prefix = `${COUPLE_A}/`;
    const marked = [];
    const rpcCalls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const body = requestBody(init);
      if (parsed.pathname.startsWith('/rest/v1/rpc/')) rpcCalls.push({ name: rpcName(url), body });
      if (rpcName(url) === 'claim_purge_jobs') {
        return jsonResponse(ok({ jobs: [job({ objects: [
          { bucket_id: 'visit-photos', object_path: exactPath, is_prefix: false },
          { bucket_id: 'visit-photos', object_path: prefix, is_prefix: true },
        ] })] }));
      }
      if (parsed.pathname === '/storage/v1/object/list/visit-photos') {
        return jsonResponse([{ name: 'orphan.webp', id: 'orphan', metadata: {} }]);
      }
      if (parsed.pathname === '/storage/v1/object/visit-photos') {
        if (body.prefixes[0] === exactPath) return jsonResponse([{ name: exactPath }]);
        return jsonResponse({ message: 'service-role-secret at https://internal.invalid' }, 500);
      }
      if (rpcName(url) === 'mark_purge_objects_deleted') {
        marked.push(...body.p_object_paths);
        return jsonResponse(ok({ job_id: JOB_A, marked: 1 }));
      }
      if (rpcName(url) === 'complete_purge_job') {
        expect(body).toEqual({
          p_job_id: JOB_A,
          p_succeeded: false,
          p_error: 'storage_delete_failed',
        });
        return jsonResponse(ok({ job_id: JOB_A, status: 'queued' }));
      }
      throw new Error(`unexpected request: ${parsed.pathname}`);
    });

    const response = await handlerFor(fetchImpl)(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ claimed: 1, succeeded: 0, requeued: 1 });
    expect(JSON.stringify(body)).not.toContain('service-role-secret');
    expect(marked).toEqual([exactPath]);
    expect(rpcCalls.map((call) => call.name)).not.toContain('purge_couple_data');
  });

  it('continues with later jobs after one job fails', async () => {
    const firstPath = `${COUPLE_A}/visit-a/first.webp`;
    const secondPath = `${COUPLE_B}/visit-b/second.webp`;
    const completed = [];
    const purged = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const body = requestBody(init);
      if (rpcName(url) === 'claim_purge_jobs') {
        return jsonResponse(ok({ jobs: [
          job({ objects: [{ bucket_id: 'visit-photos', object_path: firstPath, is_prefix: false }] }),
          job({ jobId: JOB_B, coupleId: COUPLE_B, objects: [
            { bucket_id: 'visit-photos', object_path: secondPath, is_prefix: false },
          ] }),
        ] }));
      }
      if (parsed.pathname === '/storage/v1/object/visit-photos') {
        if (body.prefixes[0] === firstPath) return jsonResponse({ message: 'temporary' }, 503);
        return jsonResponse([{ name: secondPath }]);
      }
      if (rpcName(url) === 'mark_purge_objects_deleted') {
        return jsonResponse(ok({ job_id: body.p_job_id, marked: 1 }));
      }
      if (rpcName(url) === 'purge_couple_data') {
        purged.push(body.p_job_id);
        return jsonResponse(ok({ job_id: JOB_B, couple_id: COUPLE_B, visits_deleted: 1 }));
      }
      if (rpcName(url) === 'complete_purge_job') {
        completed.push(body);
        return jsonResponse(ok({
          job_id: body.p_job_id,
          status: body.p_succeeded ? 'succeeded' : 'queued',
        }));
      }
      throw new Error(`unexpected request: ${parsed.pathname}`);
    });

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 2, succeeded: 1, requeued: 1 });
    expect(completed).toEqual([
      { p_job_id: JOB_A, p_succeeded: false, p_error: 'storage_delete_failed' },
      { p_job_id: JOB_B, p_succeeded: true, p_error: null },
    ]);
    expect(purged).toEqual([JOB_B]);
  });

  it('requires a bearer token before making any same-project request', async () => {
    const fetchImpl = vi.fn();
    const response = await handlerFor(fetchImpl)(request({ authorization: null }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'unauthorized' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a configured origin that is not the invoked Supabase project', async () => {
    const fetchImpl = vi.fn();
    const handler = createPurgeHandler({
      fetchImpl,
      getEnv: () => 'https://other-project.supabase.co',
    });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'invalid_server_config' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards a browser JWT unchanged and redacts the service-only RPC rejection', async () => {
    const browserAuthorization = 'Bearer browser-user-jwt-secret';
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers.authorization).toBe(browserAuthorization);
      expect(init.headers.apikey).toBe('browser-user-jwt-secret');
      return jsonResponse({
        message: 'permission denied with browser-user-jwt-secret and postgres://private-host',
      }, 403);
    });

    const response = await handlerFor(fetchImpl)(request({ authorization: browserAuthorization }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe('{"ok":false,"error":{"code":"purge_worker_unavailable"}}');
    expect(body).not.toContain('browser-user-jwt-secret');
    expect(body).not.toContain('private-host');
  });

  it('rejects malformed claim envelopes without issuing storage or purge calls', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ok({ jobs: [{ job_id: 'not-a-uuid' }] })));

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'purge_worker_unavailable' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('settles a job whose queued object escapes its couple instead of stranding the batch', async () => {
    // claim_purge_jobs has already moved every claimed row to running. Rejecting a
    // job without reporting it back leaves that row running for good, because a
    // claim only ever looks at queued rows — so the couple is never purged, and
    // neither is any healthy job that happened to share the batch.
    const foreign = `${COUPLE_B}/visit-b/not-mine.webp`;
    const healthy = `${COUPLE_B}/visit-b/second.webp`;
    const completed = [];
    const storagePaths = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const parsed = new URL(url);
      const body = requestBody(init);
      if (rpcName(url) === 'claim_purge_jobs') {
        return jsonResponse(ok({ jobs: [
          // Job A belongs to couple A but carries an object under couple B.
          job({ objects: [{ bucket_id: 'visit-photos', object_path: foreign, is_prefix: false }] }),
          job({ jobId: JOB_B, coupleId: COUPLE_B, objects: [
            { bucket_id: 'visit-photos', object_path: healthy, is_prefix: false },
          ] }),
        ] }));
      }
      if (parsed.pathname.startsWith('/storage/v1/object')) {
        storagePaths.push(...(body.prefixes ?? [body.prefix]));
        return jsonResponse([{ name: healthy }]);
      }
      if (rpcName(url) === 'mark_purge_objects_deleted') {
        return jsonResponse(ok({ job_id: body.p_job_id, marked: 1 }));
      }
      if (rpcName(url) === 'purge_couple_data') {
        return jsonResponse(ok({ job_id: JOB_B, couple_id: COUPLE_B, visits_deleted: 1 }));
      }
      if (rpcName(url) === 'complete_purge_job') {
        completed.push(body);
        return jsonResponse(ok({
          job_id: body.p_job_id,
          status: body.p_succeeded ? 'succeeded' : 'queued',
        }));
      }
      throw new Error(`unexpected request: ${parsed.pathname}`);
    });

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claimed: 2,
      succeeded: 1,
      requeued: 1,
      unsettled: 0,
    });
    // The rejected job is reported, so it goes back on the queue rather than
    // sitting in running forever...
    expect(completed).toEqual([
      { p_job_id: JOB_A, p_succeeded: false, p_error: 'invalid_job_envelope' },
      { p_job_id: JOB_B, p_succeeded: true, p_error: null },
    ]);
    // ...and nothing outside its own couple was deleted on its behalf.
    expect(storagePaths).toEqual([healthy]);
    // ...and the batch companion still completed.
    expect(storagePaths).not.toContain(foreign);
  });

  it('reports every claimed job so none is left running without an outcome', async () => {
    const completed = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const body = requestBody(init);
      if (rpcName(url) === 'claim_purge_jobs') {
        return jsonResponse(ok({ jobs: [
          // A bucket the worker was never meant to touch.
          job({ objects: [
            { bucket_id: 'other-bucket', object_path: `${COUPLE_A}/visit-a/x.webp`, is_prefix: false },
          ] }),
          // A prefix sweep disguised as an exact object.
          job({ jobId: JOB_B, coupleId: COUPLE_B, objects: [
            { bucket_id: 'visit-photos', object_path: `${COUPLE_B}/`, is_prefix: false },
          ] }),
        ] }));
      }
      if (rpcName(url) === 'complete_purge_job') {
        completed.push(body);
        return jsonResponse(ok({ job_id: body.p_job_id, status: 'failed' }));
      }
      throw new Error(`unexpected request: ${new URL(url).pathname}`);
    });

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 2, failed: 2, unsettled: 0 });
    expect(completed.map((call) => call.p_job_id)).toEqual([JOB_A, JOB_B]);
    for (const call of completed) {
      expect(call).toMatchObject({ p_succeeded: false, p_error: 'invalid_job_envelope' });
    }
  });

  it('rejects a claim response larger than the requested batch bound', async () => {
    const oversized = Array.from({ length: 11 }, (_, index) => job({
      jobId: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    }));
    const fetchImpl = vi.fn(async () => jsonResponse(ok({ jobs: oversized })));

    const response = await handlerFor(fetchImpl)(request());

    expect(response.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

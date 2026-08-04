// Server-only purge worker implementation. Kept separate from the Deno entrypoint
// so every network interaction can be tested with an injected fetch function.

const VISIT_PHOTO_BUCKET = 'visit-photos';
const RPC_NAMES = new Set([
  'claim_purge_jobs',
  'mark_purge_objects_deleted',
  'purge_couple_data',
  'complete_purge_job',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPABASE_HOST_PATTERN = /^[a-z0-9-]+\.supabase\.co$/i;
const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

class PurgeFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'PurgeFailure';
    this.code = code;
  }
}

const fail = (code) => {
  throw new PurgeFailure(code);
};

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const boundedInteger = (value, fallback, maximum) => {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 1) return fallback;
  return Math.min(integer, maximum);
};

const jsonResponse = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });

const errorResponse = (status, code) =>
  jsonResponse({ ok: false, error: { code } }, status);

const parseBearer = (request) => {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) return null;
  return { authorization, token: match[1] };
};

// The inbound request URL is deliberately not an input here. The URL a hosted
// invocation reaches the worker on can differ from the project origin, so
// requiring the two to match turned that difference into invalid_server_config
// for the scheduled run we reproduced. It must not become an input again either:
// request.url is caller-controlled, and letting it pick the outbound origin would
// turn this worker into an SSRF relay for its own bearer token. Every outbound
// REST and Storage destination is built from the origin returned here, which comes
// only from the configured value.
const validatedOrigin = (configuredUrl) => {
  let configured;
  try {
    configured = new URL(configuredUrl);
  } catch {
    fail('invalid_server_config');
  }

  // new URL() erases a port that equals the scheme default, so a configured
  // '...supabase.co:443' parses with an empty .port and an origin identical to the
  // bare host — a parsed no-port check alone accepts it. Requiring the configured
  // text to already be the normalized origin closes that: any port, credential,
  // path, query, or fragment the parser had to strip or move makes the two differ.
  // A non-default port survives into .origin, so the .port check below carries it.
  const normalized = String(configuredUrl).trim().toLowerCase();
  const isOriginText =
    normalized === configured.origin || normalized === `${configured.origin}/`;

  const isBareProjectOrigin =
    isOriginText &&
    configured.protocol === 'https:' &&
    SUPABASE_HOST_PATTERN.test(configured.hostname) &&
    configured.port === '' &&
    configured.username === '' &&
    configured.password === '' &&
    (configured.pathname === '' || configured.pathname === '/') &&
    configured.search === '' &&
    configured.hash === '';

  if (!isBareProjectOrigin) fail('invalid_server_config');

  return configured.origin;
};

const safeJson = async (response, code) => {
  let text;
  try {
    text = await response.text();
  } catch {
    fail(code);
  }
  if (!text) fail(code);
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
};

const validUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

const validPath = (value) => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 1024 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value.split('/').every((segment, index, segments) => {
    if (segment === '.' || segment === '..') return false;
    return segment !== '' || index === segments.length - 1;
  });
};

const validateQueuedObject = (value, coupleId) => {
  if (
    !isRecord(value) ||
    value.bucket_id !== VISIT_PHOTO_BUCKET ||
    typeof value.is_prefix !== 'boolean' ||
    !validPath(value.object_path) ||
    !value.object_path.startsWith(`${coupleId}/`)
  ) {
    fail('invalid_job_envelope');
  }
  if (value.is_prefix !== value.object_path.endsWith('/')) {
    fail('invalid_job_envelope');
  }
  return {
    bucketId: value.bucket_id,
    objectPath: value.object_path,
    isPrefix: value.is_prefix,
  };
};

const validateJob = (value) => {
  if (
    !isRecord(value) ||
    !validUuid(value.job_id) ||
    !validUuid(value.couple_id) ||
    typeof value.due_at !== 'string' ||
    !Number.isFinite(Date.parse(value.due_at)) ||
    !Number.isInteger(value.attempts) ||
    value.attempts < 1 ||
    !Array.isArray(value.objects)
  ) {
    fail('invalid_job_envelope');
  }
  // The object list is checked later, per job, inside processJob. Rejecting it
  // here would abort the whole claimed batch: claim_purge_jobs has already moved
  // every job in it to 'running', and a claim only ever reconsiders 'queued', so
  // an unreported rejection strands the job and its batch companions for good.
  // A job whose scalars are this well formed has a job_id we can settle with.
  return {
    jobId: value.job_id,
    coupleId: value.couple_id,
    objects: value.objects,
  };
};

const validateClaim = (envelope) => {
  if (!isRecord(envelope) || envelope.ok !== true || !isRecord(envelope.data)) {
    fail('invalid_claim_envelope');
  }
  if (!Array.isArray(envelope.data.jobs)) fail('invalid_claim_envelope');
  return envelope.data.jobs.map(validateJob);
};

const validateRpcResult = (envelope, jobId, kind, succeeded) => {
  if (!isRecord(envelope) || envelope.ok !== true || !isRecord(envelope.data)) {
    fail(`${kind}_rpc_failed`);
  }
  if (envelope.data.job_id !== jobId) fail(`${kind}_rpc_failed`);

  if (kind === 'mark') {
    if (!Number.isInteger(envelope.data.marked) || envelope.data.marked < 0) {
      fail('mark_rpc_failed');
    }
  } else if (kind === 'purge') {
    if (!validUuid(envelope.data.couple_id)) fail('purge_rpc_failed');
  } else if (kind === 'complete') {
    const allowed = succeeded ? ['succeeded'] : ['queued', 'failed'];
    if (!allowed.includes(envelope.data.status)) fail('complete_rpc_failed');
  }

  return envelope.data;
};

const validListName = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 255 &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !/[\u0000-\u001f\u007f]/.test(value);

const validateListPage = (value) => {
  if (!Array.isArray(value)) fail('storage_list_failed');
  return value.map((entry) => {
    if (!isRecord(entry) || !validListName(entry.name)) fail('storage_list_failed');
    const isFolder = entry.id === null && entry.metadata == null;
    if (!isFolder && (typeof entry.id !== 'string' || entry.id.length === 0)) {
      fail('storage_list_failed');
    }
    return { name: entry.name, isFolder };
  });
};

const chunks = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const safeFailureCode = (error) => {
  const code = error instanceof PurgeFailure ? error.code : 'purge_job_failed';
  return FAILURE_CODE_PATTERN.test(code) ? code : 'purge_job_failed';
};

export function createPurgeHandler({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  getEnv = () => undefined,
  claimLimit = 10,
  listPageSize = 1000,
  deleteBatchSize = 100,
  prefixSweepLimit = 3,
} = {}) {
  const boundedClaimLimit = boundedInteger(claimLimit, 10, 50);
  const boundedListPageSize = boundedInteger(listPageSize, 1000, 1000);
  const boundedDeleteBatchSize = boundedInteger(deleteBatchSize, 100, 1000);
  const boundedPrefixSweepLimit = boundedInteger(prefixSweepLimit, 3, 10);

  return async function purgeCoupleData(request) {
    if (request.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed');
    }

    const bearer = parseBearer(request);
    if (!bearer) return errorResponse(401, 'unauthorized');

    let origin;
    try {
      origin = validatedOrigin(getEnv('SUPABASE_URL'));
    } catch {
      return errorResponse(500, 'invalid_server_config');
    }

    if (typeof fetchImpl !== 'function') {
      return errorResponse(500, 'invalid_server_config');
    }

    const apiFetch = async (path, method, body, failureCode) => {
      let response;
      try {
        response = await fetchImpl(`${origin}${path}`, {
          method,
          redirect: 'error',
          headers: {
            authorization: bearer.authorization,
            apikey: bearer.token,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch {
        fail(failureCode);
      }
      return response;
    };

    const rpc = async (name, body, failureCode) => {
      if (!RPC_NAMES.has(name)) fail(failureCode);
      const response = await apiFetch(`/rest/v1/rpc/${name}`, 'POST', body, failureCode);
      if (!response.ok) fail(failureCode);
      return safeJson(response, failureCode);
    };

    const deleteObjects = async (bucketId, paths) => {
      if (paths.length === 0) return;
      const response = await apiFetch(
        `/storage/v1/object/${encodeURIComponent(bucketId)}`,
        'DELETE',
        { prefixes: paths },
        'storage_delete_failed',
      );
      if (response.status === 404) return;
      if (!response.ok) fail('storage_delete_failed');
      if (response.status === 204) return;
      const result = await safeJson(response, 'storage_delete_failed');
      if (!Array.isArray(result)) fail('storage_delete_failed');
    };

    const listObjects = async (bucketId, rootPrefix) => {
      const pendingFolders = [rootPrefix];
      const seenFolders = new Set();
      const paths = new Set();

      while (pendingFolders.length > 0) {
        const prefix = pendingFolders.shift();
        if (seenFolders.has(prefix)) continue;
        seenFolders.add(prefix);

        let offset = 0;
        while (true) {
          const response = await apiFetch(
            `/storage/v1/object/list/${encodeURIComponent(bucketId)}`,
            'POST',
            {
              prefix,
              limit: boundedListPageSize,
              offset,
              sortBy: { column: 'name', order: 'asc' },
            },
            'storage_list_failed',
          );
          if (!response.ok) fail('storage_list_failed');
          const page = validateListPage(await safeJson(response, 'storage_list_failed'));

          for (const entry of page) {
            const path = `${prefix}${entry.name}`;
            if (!validPath(path) || !path.startsWith(rootPrefix)) {
              fail('storage_list_failed');
            }
            if (entry.isFolder) pendingFolders.push(`${path}/`);
            else paths.add(path);
          }

          if (page.length < boundedListPageSize) break;
          offset += page.length;
        }
      }

      return [...paths];
    };

    const markDeleted = async (jobId, objectPath) => {
      const envelope = await rpc(
        'mark_purge_objects_deleted',
        { p_job_id: jobId, p_object_paths: [objectPath] },
        'mark_rpc_failed',
      );
      validateRpcResult(envelope, jobId, 'mark');
    };

    const deletePrefix = async (jobId, object) => {
      for (let sweep = 0; sweep <= boundedPrefixSweepLimit; sweep += 1) {
        const paths = await listObjects(object.bucketId, object.objectPath);
        if (paths.length === 0) {
          await markDeleted(jobId, object.objectPath);
          return;
        }
        if (sweep === boundedPrefixSweepLimit) fail('storage_prefix_not_empty');
        for (const batch of chunks(paths, boundedDeleteBatchSize)) {
          await deleteObjects(object.bucketId, batch);
        }
      }
    };

    const completeJob = async (jobId, succeeded, errorCode = null) => {
      const envelope = await rpc(
        'complete_purge_job',
        {
          p_job_id: jobId,
          p_succeeded: succeeded,
          p_error: errorCode,
        },
        'complete_rpc_failed',
      );
      return validateRpcResult(envelope, jobId, 'complete', succeeded);
    };

    const processJob = async (job) => {
      try {
        // Validated inside the try so a rejected object is reported against this
        // job — requeued, or parked as failed once the attempt budget is spent —
        // instead of leaving it in 'running' with no outcome. Validated before any
        // deletion so a job carrying one bad reference deletes nothing at all.
        const objects = job.objects.map((object) =>
          validateQueuedObject(object, job.coupleId),
        );

        for (const object of objects) {
          if (object.isPrefix) {
            await deletePrefix(job.jobId, object);
          } else {
            await deleteObjects(object.bucketId, [object.objectPath]);
            await markDeleted(job.jobId, object.objectPath);
          }
        }

        const purgeEnvelope = await rpc(
          'purge_couple_data',
          { p_job_id: job.jobId },
          'purge_rpc_failed',
        );
        const purge = validateRpcResult(purgeEnvelope, job.jobId, 'purge');
        if (purge.couple_id !== job.coupleId) fail('purge_rpc_failed');

        await completeJob(job.jobId, true);
        return 'succeeded';
      } catch (error) {
        try {
          const completion = await completeJob(job.jobId, false, safeFailureCode(error));
          return completion.status === 'queued' ? 'requeued' : 'failed';
        } catch {
          return 'unsettled';
        }
      }
    };

    let jobs;
    try {
      const claim = await rpc(
        'claim_purge_jobs',
        { p_limit: boundedClaimLimit },
        'claim_rpc_failed',
      );
      jobs = validateClaim(claim);
      if (jobs.length > boundedClaimLimit) fail('invalid_claim_envelope');
    } catch {
      return errorResponse(502, 'purge_worker_unavailable');
    }

    const summary = {
      ok: true,
      claimed: jobs.length,
      succeeded: 0,
      requeued: 0,
      failed: 0,
      unsettled: 0,
    };

    for (const job of jobs) {
      const outcome = await processJob(job);
      summary[outcome] += 1;
    }

    return jsonResponse(summary, 200);
  };
}

/**
 * 테스트용 대역 Supabase 클라이언트.
 *
 * 네트워크도, 자격 증명도, 실제 `@supabase/supabase-js`도 쓰지 않는다.
 * `from()`/`rpc()`/`auth`만 흉내내고 **호출 내용을 기록**하므로, 저장소가
 * 어떤 테이블·컬럼·정렬·인자로 질의했는지 단정할 수 있다.
 *
 * 이 파일은 `*.test.js`가 아니라 테스트 도우미다. 프로덕션 코드가 절대 import하지 않는다.
 */

/** `.single()`이 0행을 만났을 때 PostgREST가 주는 오류 형태 */
export const NO_ROWS_ERROR = Object.freeze({
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
  details: null,
  hint: null,
});

/** RPC 성공 봉투 (`app.ok_result`) */
export const okEnvelope = (data = {}, replayed = false) => ({ ok: true, replayed, data });

/** RPC 도메인 실패 봉투 (`app.error_result`) — 예외가 아니라 값으로 돌아온다 */
export const errorEnvelope = (code, details = {}) => ({
  ok: false,
  replayed: false,
  error: { code, sqlstate: SQLSTATE_BY_CODE[code] ?? 'TW099', details },
});

/** `app.error_sqlstate()`와 같은 표 — 봉투를 만들 때만 쓴다 */
const SQLSTATE_BY_CODE = {
  validation_error: 'TW001',
  not_found: 'TW002',
  forbidden: 'TW003',
  rate_limited: 'TW004',
  invite_not_found: 'TW005',
  invite_expired: 'TW006',
  invite_consumed: 'TW007',
  invite_revoked: 'TW008',
  invite_own_couple: 'TW009',
  couple_capacity_reached: 'TW010',
  active_membership_conflict: 'TW011',
  photo_limit_reached: 'TW012',
  conflict: 'TW013',
  config_unresolved: 'TW014',
  purge_incomplete: 'TW015',
};

/** 전송 계층 실패 (supabase-js가 `{ data: null, error }`로 돌려주는 형태) */
export const transportFailure = (error) => ({ data: null, error });

/** `raise`된 도메인 오류가 PostgREST를 통해 오는 형태 */
export const raisedError = (sqlstate, hint, details = {}) => ({
  code: sqlstate,
  message: hint,
  hint,
  details: JSON.stringify(details),
});

class FakeQuery {
  constructor(table, respond) {
    this.respond = respond;
    this.query = {
      table,
      op: 'select',
      columns: '*',
      payload: undefined,
      filters: [],
      orders: [],
      limit: null,
      cardinality: 'many',
    };
  }

  select(columns = '*') {
    this.query.columns = columns;
    return this;
  }

  update(payload) {
    this.query.op = 'update';
    this.query.payload = payload;
    return this;
  }

  insert(payload) {
    this.query.op = 'insert';
    this.query.payload = payload;
    return this;
  }

  delete() {
    this.query.op = 'delete';
    return this;
  }

  eq(column, value) {
    this.query.filters.push(['eq', column, value]);
    return this;
  }

  neq(column, value) {
    this.query.filters.push(['neq', column, value]);
    return this;
  }

  is(column, value) {
    this.query.filters.push(['is', column, value]);
    return this;
  }

  in(column, value) {
    this.query.filters.push(['in', column, value]);
    return this;
  }

  order(column, options) {
    this.query.orders.push([column, options ?? null]);
    return this;
  }

  limit(count) {
    this.query.limit = count;
    return this;
  }

  maybeSingle() {
    this.query.cardinality = 'maybe';
    return this;
  }

  single() {
    this.query.cardinality = 'one';
    return this;
  }

  then(onFulfilled, onRejected) {
    return this.#settle().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.#settle().catch(onRejected);
  }

  finally(onFinally) {
    return this.#settle().finally(onFinally);
  }

  async #settle() {
    return this.respond(this.query);
  }
}

const asRows = (value) => {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * @param {{
 *   userId?: string|null,
 *   session?: object|null,
 *   getSessionError?: unknown,
 *   signInUserId?: string,
 *   signInResult?: () => object,
 *   tables?: Record<string, unknown>,
 *   rpc?: Record<string, unknown>,
 *   storage?: Record<string, Record<string, unknown>>,
 * }} [config]
 */
export function createFakeSupabaseClient(config = {}) {
  const {
    userId = null,
    session = userId ? { user: { id: userId } } : null,
    getSessionError = null,
    signInUserId = 'anon-user',
    signInResult = null,
    tables = {},
    rpc = {},
    storage = {},
  } = config;

  const calls = { queries: [], rpc: [], auth: [], storage: [] };

  const respond = (query) => {
    calls.queries.push(query);

    const handler = tables[query.table];
    if (handler === undefined) {
      throw new Error(`fake supabase: no handler for table "${query.table}"`);
    }

    const raw = typeof handler === 'function' ? handler(query) : handler;
    const result = Array.isArray(raw) || raw == null ? { data: raw, error: null } : raw;
    if (result.error) return { data: null, error: result.error };

    const rows = asRows(result.data);
    if (query.cardinality === 'many') return { data: rows, error: null };
    if (rows.length === 0) {
      return query.cardinality === 'maybe'
        ? { data: null, error: null }
        : { data: null, error: NO_ROWS_ERROR };
    }
    return { data: rows[0], error: null };
  };

  return {
    calls,

    from(table) {
      return new FakeQuery(table, respond);
    },

    async rpc(name, args) {
      calls.rpc.push({ name, args });

      const handler = rpc[name];
      if (handler === undefined) {
        throw new Error(`fake supabase: no handler for rpc "${name}"`);
      }

      const raw = typeof handler === 'function' ? handler(args) : handler;
      if (raw && typeof raw === 'object' && !Object.hasOwn(raw, 'ok')) {
        // `{ data, error }` 형태를 그대로 통과시킨다 (전송 실패 흉내).
        return raw;
      }
      return { data: raw, error: null };
    },

    storage: {
      from(bucket) {
        const bucketHandlers = storage[bucket];
        if (bucketHandlers === undefined) {
          throw new Error(`fake supabase: no storage handler for bucket "${bucket}"`);
        }

        const invoke = async (method, args) => {
          calls.storage.push({ bucket, method, ...args });
          const handler = bucketHandlers[method];
          if (handler === undefined) {
            throw new Error(`fake supabase: no storage handler for method "${method}"`);
          }
          const raw = typeof handler === 'function' ? await handler(args) : handler;
          if (raw && typeof raw === 'object' && (Object.hasOwn(raw, 'data') || Object.hasOwn(raw, 'error'))) {
            return raw;
          }
          return { data: raw ?? null, error: null };
        };

        return {
          upload(path, body, options) {
            return invoke('upload', { path, body, options });
          },
          createSignedUrl(path, expiresIn) {
            return invoke('createSignedUrl', { path, expiresIn });
          },
          remove(paths) {
            return invoke('remove', { paths });
          },
        };
      },
    },

    auth: {
      async getSession() {
        calls.auth.push('getSession');
        if (getSessionError) return { data: { session: null }, error: getSessionError };
        return { data: { session }, error: null };
      },

      async signInAnonymously() {
        calls.auth.push('signInAnonymously');
        if (signInResult) return signInResult();
        return { data: { session: { user: { id: signInUserId } } }, error: null };
      },
    },
  };
}

/** 호출된 RPC 이름만 뽑는다 */
export const rpcNames = (client) => client.calls.rpc.map((call) => call.name);

/** 마지막으로 호출된 특정 RPC의 인자 */
export const lastRpcArgs = (client, name) =>
  client.calls.rpc.filter((call) => call.name === name).at(-1)?.args ?? null;

/** 특정 테이블에 대한 질의 기록 */
export const queriesFor = (client, table) =>
  client.calls.queries.filter((query) => query.table === table);

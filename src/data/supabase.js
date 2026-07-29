/**
 * 브라우저용 Supabase 클라이언트.
 *
 * 브라우저 번들에는 **publishable key만** 들어간다. service role 키는 서버 전용이고
 * 이 모듈은 그 값을 읽지도, 대체값으로 쓰지도 않는다 (`assertPublishableKey`가 차단).
 *
 * 설정은 import 시점이 아니라 `getSupabaseClient()` 호출 시점에 읽는다.
 * 환경변수가 없어도 모듈 로딩만으로는 터지지 않아서, 테스트가 가짜 설정을 주입할 수 있다.
 */
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { AppError, ERROR_CODES } from './errors';

export const SUPABASE_URL_ENV = 'VITE_SUPABASE_URL';
export const PUBLISHABLE_KEY_ENV = 'VITE_SUPABASE_PUBLISHABLE_KEY';

/** localStorage 키. 같은 호스트의 다른 앱과 세션이 섞이지 않게 고정한다. */
export const AUTH_STORAGE_KEY = 'today-we-are.auth';

/**
 * 설정 오류.
 *
 * 사용자에게는 표준 configuration 문구만 보여주고, 어떤 변수가 문제인지는 `cause`에 남긴다.
 * 키 값 자체는 detail에도 넣지 않는다 — 오류 문구는 화면과 로그 양쪽으로 흘러갈 수 있다.
 */
const configError = (detail) =>
  new AppError(ERROR_CODES.configuration, { cause: new Error(detail) });

const readEnv = (env, name) => {
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
};

const defaultEnv = () => {
  try {
    return import.meta.env ?? {};
  } catch {
    return {};
  }
};

const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** JWT payload를 서명 검증 없이 들여다본다 — 키 종류 판별에만 쓴다. */
function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded))?.role ?? null;
  } catch {
    return null;
  }
}

/** 브라우저에 노출해도 되는 키인지 확인한다. 새 형식(`sb_secret_`)과 레거시 JWT 양쪽을 본다. */
function assertPublishableKey(key) {
  if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    throw configError('service role key must never reach browser code');
  }
}

/**
 * 환경변수에서 브라우저용 설정을 읽는다.
 *
 * @param {Record<string, string>} [env] 기본값은 `import.meta.env`
 * @returns {{ url: string, publishableKey: string }}
 * @throws {AppError} code `configuration` (재시도 불가)
 */
export function readSupabaseConfig(env = defaultEnv()) {
  const url = readEnv(env, SUPABASE_URL_ENV);
  const publishableKey = readEnv(env, PUBLISHABLE_KEY_ENV);

  if (!url) throw configError(`${SUPABASE_URL_ENV} is missing`);
  if (!isHttpUrl(url)) throw configError(`${SUPABASE_URL_ENV} is not an http(s) URL`);
  if (!publishableKey) throw configError(`${PUBLISHABLE_KEY_ENV} is missing`);

  assertPublishableKey(publishableKey);

  return { url, publishableKey };
}

/**
 * 클라이언트 팩토리. 설정과 `createClient` 구현을 모두 주입할 수 있어 테스트가
 * 실제 네트워크 없이 옵션을 검증할 수 있다.
 *
 * `signInAnonymously()` 세션이 새로고침 뒤에도 살아 있어야 하므로 세션 저장과
 * 토큰 자동 갱신을 켠다. MVP에는 OAuth 리다이렉트가 없어 URL 파싱은 끈다.
 *
 * @param {{
 *   url?: string,
 *   publishableKey?: string,
 *   env?: Record<string, string>,
 *   createClient?: Function,
 *   options?: object,
 * }} [deps]
 */
export function createSupabaseClient({
  url,
  publishableKey,
  env,
  createClient = createSupabaseJsClient,
  options = {},
} = {}) {
  // 직접 넘긴 값이 환경변수를 덮되, 검증 경로는 readSupabaseConfig 하나로 유지한다.
  const config = readSupabaseConfig({
    ...(env ?? defaultEnv()),
    ...(url === undefined ? {} : { [SUPABASE_URL_ENV]: url }),
    ...(publishableKey === undefined ? {} : { [PUBLISHABLE_KEY_ENV]: publishableKey }),
  });

  return createClient(config.url, config.publishableKey, {
    ...options,
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
      ...options.auth,
    },
  });
}

let client = null;

/**
 * 지연 생성되는 싱글턴. 설정 오류는 캐시하지 않으므로 설정이 채워지면 다음 호출에서 살아난다.
 *
 * @param {Parameters<typeof createSupabaseClient>[0]} [deps]
 * @throws {AppError} code `configuration`
 */
export function getSupabaseClient(deps) {
  if (!client) client = createSupabaseClient(deps);
  return client;
}

/** 테스트/데모용 — 대역 클라이언트 주입 */
export function __setSupabaseClient(nextClient) {
  client = nextClient;
}

/** 테스트/데모용 — 싱글턴 초기화 */
export function __resetSupabaseClient() {
  client = null;
}

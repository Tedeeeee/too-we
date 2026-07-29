/**
 * 애플리케이션 오류 모델.
 *
 * 화면·스토어는 raw 오류를 직접 읽지 않고 `toAppError()`로 정규화한 뒤
 * `code`(분기용), `message`(사용자 노출용), `retryable`(재시도 버튼 노출용)만 본다.
 * 백엔드가 바뀌어도 이 세 값의 의미는 유지한다.
 *
 * 원칙:
 * - `message`는 사용자에게 그대로 보여줄 수 있는 한국어 문구만 담는다.
 *   기술 메시지(SQL, URL, 키 문자열)는 절대 여기로 오지 않고 `cause`에만 남는다.
 * - 로그로 내보낼 때는 `toLogSafe()`를 쓴다. 원본 message/URL은 apikey 같은
 *   키 재료를 품을 수 있어서 로그 페이로드에서 제외한다.
 */

/** 안정적인 오류 코드. 값은 키와 같아서 직렬화·저장해도 의미가 바뀌지 않는다. */
export const ERROR_CODES = {
  configuration: 'configuration',
  auth: 'auth',
  validation: 'validation',
  conflict: 'conflict',
  not_found: 'not_found',
  forbidden: 'forbidden',
  rate_limited: 'rate_limited',
  network: 'network',
  unknown: 'unknown',
};

/**
 * 자동 재시도가 의미 있는 코드.
 *
 * `network`는 전송 실패·중단·5xx를 함께 담는다(잠시 뒤 같은 요청이 성공할 수 있다).
 * `unknown`은 분류하지 못한 실패라 자동 재시도하지 않는다 — 쓰기 요청이었다면
 * 중복 저장이 될 수 있다. 사용자가 직접 다시 시도하는 것은 화면 판단에 맡긴다.
 */
export const RETRYABLE_ERROR_CODES = [ERROR_CODES.network, ERROR_CODES.rate_limited];

/** 사용자에게 그대로 노출하는 문구. */
export const USER_MESSAGES = {
  configuration: '앱 설정에 문제가 있어요. 잠시 뒤에도 같으면 문의해 주세요.',
  auth: '로그인 정보가 만료됐어요. 앱을 다시 열어 주세요.',
  validation: '입력한 내용을 다시 확인해 주세요.',
  conflict: '방금 다른 곳에서 내용이 바뀌었어요. 최신 내용을 확인해 주세요.',
  not_found: '찾을 수 없는 내용이에요.',
  forbidden: '접근 권한이 없어요.',
  rate_limited: '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.',
  network: '네트워크 연결이 불안정해요. 다시 시도해 주세요.',
  unknown: '문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.',
};

const normalizeCode = (code) =>
  Object.hasOwn(ERROR_CODES, code) ? ERROR_CODES[code] : ERROR_CODES.unknown;

/** 코드에 대응하는 사용자 문구. 모르는 코드는 unknown 문구를 준다. */
export function userMessage(code) {
  return USER_MESSAGES[normalizeCode(code)];
}

export class AppError extends Error {
  /**
   * @param {string} code ERROR_CODES 중 하나 (모르는 값은 unknown으로 정규화)
   * @param {{ message?: string, cause?: unknown, retryable?: boolean, status?: number|null }} [options]
   */
  constructor(code, { message, cause, retryable, status } = {}) {
    const normalized = normalizeCode(code);
    super(message || USER_MESSAGES[normalized], cause === undefined ? undefined : { cause });

    this.name = 'AppError';
    this.code = normalized;
    this.retryable =
      typeof retryable === 'boolean' ? retryable : RETRYABLE_ERROR_CODES.includes(normalized);
    this.status = status ?? null;
    // super(..., { cause }) 는 cause가 falsy(빈 문자열 등)면 값을 잃을 수 있어 직접 보존한다.
    if (cause !== undefined) this.cause = cause;
  }
}

/* ---------- 매핑 ---------- */

const statusToCode = (status) => {
  if (status >= 500) return ERROR_CODES.network;
  switch (status) {
    case 400:
    case 422:
      return ERROR_CODES.validation;
    case 401:
      return ERROR_CODES.auth;
    case 403:
      return ERROR_CODES.forbidden;
    case 404:
      return ERROR_CODES.not_found;
    case 409:
      return ERROR_CODES.conflict;
    case 429:
      return ERROR_CODES.rate_limited;
    default:
      return null;
  }
};

/** Auth 엔드포인트는 400/403도 자격 증명 문제라 forbidden/validation이 아니라 auth다. */
const authStatusToCode = (status) => {
  if (status >= 500) return ERROR_CODES.network;
  switch (status) {
    case 400:
    case 401:
    case 403:
      return ERROR_CODES.auth;
    case 422:
      return ERROR_CODES.validation;
    case 429:
      return ERROR_CODES.rate_limited;
    default:
      return ERROR_CODES.auth;
  }
};

/**
 * PostgREST가 돌려주는 Postgres SQLSTATE와 PGRST 코드.
 * 23503(FK 위반)은 참조 대상이 그 사이에 바뀐 상황이라 conflict로 본다.
 */
const PG_CODE_MAP = {
  '22P02': ERROR_CODES.validation, // invalid_text_representation
  23502: ERROR_CODES.validation, // not_null_violation
  23503: ERROR_CODES.conflict, // foreign_key_violation
  23505: ERROR_CODES.conflict, // unique_violation
  23514: ERROR_CODES.validation, // check_violation
  40001: ERROR_CODES.network, // serialization_failure — 재시도하면 성공한다
  '40P01': ERROR_CODES.network, // deadlock_detected
  42501: ERROR_CODES.forbidden, // insufficient_privilege (RLS)
  '42P01': ERROR_CODES.configuration, // undefined_table — 마이그레이션 누락
  57014: ERROR_CODES.network, // query_canceled (timeout)
  PGRST116: ERROR_CODES.not_found, // 결과 행이 없음 (.single())
  PGRST202: ERROR_CODES.configuration, // 함수 없음 — 스키마 캐시 불일치
  PGRST204: ERROR_CODES.configuration, // 컬럼 없음 — 스키마 캐시 불일치
  PGRST301: ERROR_CODES.auth, // JWT 만료·무효
};

const NETWORK_MESSAGE_RE = /failed to fetch|networkerror|network request failed|load failed/i;

const isAbort = (error) =>
  error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 20;

const isNetworkish = (error) =>
  error?.name === 'AuthRetryableFetchError' ||
  error?.name === 'FunctionsFetchError' ||
  (error instanceof TypeError && NETWORK_MESSAGE_RE.test(error.message || '')) ||
  NETWORK_MESSAGE_RE.test(error?.message || '');

/** supabase-js AuthError는 `__isAuthError` 를 달고 온다. */
const isAuthError = (error) => error?.__isAuthError === true || error?.name === 'AuthApiError';

const readStatus = (error) => {
  const raw = error?.status ?? error?.statusCode ?? error?.originalStatus;
  const status = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  return Number.isInteger(status) && status > 0 ? status : null;
};

/**
 * 아무 오류나 AppError로 정규화한다. 이미 AppError면 그대로 돌려준다.
 *
 * @param {unknown} error
 * @param {{ fallback?: string }} [options] 분류 실패 시 쓸 코드 (기본 unknown)
 * @returns {AppError}
 */
export function toAppError(error, { fallback = ERROR_CODES.unknown } = {}) {
  if (error instanceof AppError) return error;

  const status = readStatus(error);
  const code = classify(error, status);

  return new AppError(code ?? fallback, { cause: error, status });
}

function classify(error, status) {
  if (!error || typeof error !== 'object') return null;

  // 중단된 요청은 서버 판단이 없다 — 전송 계층 실패로 본다.
  if (isAbort(error)) return ERROR_CODES.network;
  if (isNetworkish(error) && !status) return ERROR_CODES.network;

  if (isAuthError(error)) {
    return status ? authStatusToCode(status) : ERROR_CODES.auth;
  }

  const pgCode = typeof error.code === 'string' ? error.code : null;
  if (pgCode && Object.hasOwn(PG_CODE_MAP, pgCode)) return PG_CODE_MAP[pgCode];

  if (status) return statusToCode(status);
  if (isNetworkish(error)) return ERROR_CODES.network;

  return null;
}

/** AppError 여부와 무관하게 자동 재시도 가능한지 판단한다. */
export function isRetryable(error) {
  if (!error) return false;
  if (error instanceof AppError) return error.retryable;
  return toAppError(error).retryable;
}

/**
 * 로그·모니터링으로 내보낼 최소 페이로드.
 *
 * 원본 message와 URL은 apikey 쿼리스트링이나 키 문자열을 품을 수 있어 제외한다.
 * 여기서 나가는 값은 코드·상태·원본 오류 이름뿐이다.
 */
export function toLogSafe(error) {
  const appError = toAppError(error);
  const cause = appError.cause;
  const causeName =
    cause && typeof cause === 'object' ? cause.name || cause.constructor?.name || null : null;

  return {
    code: appError.code,
    retryable: appError.retryable,
    status: appError.status,
    causeName: causeName ?? null,
  };
}

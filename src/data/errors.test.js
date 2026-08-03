import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_CODES,
  RETRYABLE_ERROR_CODES,
  USER_MESSAGES,
  isRetryable,
  toAppError,
  toLogSafe,
  userMessage,
} from './errors';

/** 로그·메시지 유출 검사에 쓰는 가짜 키. 실제 키가 아니다. */
const FAKE_PUBLISHABLE = 'sb_publishable_FAKE1234567890';
const FAKE_SECRET = 'sb_secret_FAKE0987654321';

describe('ERROR_CODES', () => {
  it('안정적인 9개 코드를 노출한다', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([
      'auth',
      'configuration',
      'conflict',
      'forbidden',
      'network',
      'not_found',
      'rate_limited',
      'unknown',
      'validation',
    ]);
  });

  it('코드 값은 키와 같은 문자열이다 (직렬화해도 안정적)', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it('모든 코드에 비어 있지 않은 한국어 메시지가 있다', () => {
    for (const code of Object.keys(ERROR_CODES)) {
      const message = userMessage(code);
      expect(message).toBeTypeOf('string');
      expect(message.trim().length).toBeGreaterThan(0);
      expect(message).toMatch(/[가-힣]/);
      expect(USER_MESSAGES[code]).toBe(message);
    }
  });
});

describe('재시도 정책', () => {
  it.each([
    ['configuration', false],
    ['auth', false],
    ['validation', false],
    ['conflict', false],
    ['not_found', false],
    ['forbidden', false],
    ['rate_limited', true],
    ['network', true],
    ['unknown', false],
  ])('%s 코드의 retryable은 %s다', (code, retryable) => {
    expect(new AppError(code).retryable).toBe(retryable);
    expect(isRetryable(new AppError(code))).toBe(retryable);
    expect(RETRYABLE_ERROR_CODES.includes(code)).toBe(retryable);
  });
});

describe('AppError', () => {
  it('코드·사용자 메시지·retryable·cause를 담는다', () => {
    const cause = new Error('column "x" does not exist');
    const error = new AppError(ERROR_CODES.conflict, { cause, status: 409 });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('conflict');
    expect(error.message).toBe(userMessage('conflict'));
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(409);
    expect(error.cause).toBe(cause);
  });

  it('알 수 없는 코드는 unknown으로 정규화한다', () => {
    expect(new AppError('nope').code).toBe('unknown');
  });

  it('retryable을 명시하면 코드 기본값보다 우선한다', () => {
    expect(new AppError('network', { retryable: false }).retryable).toBe(false);
    expect(new AppError('unknown', { retryable: true }).retryable).toBe(true);
  });

  it('message를 넘기면 그 문구를 쓴다', () => {
    expect(new AppError('validation', { message: '초대코드는 숫자 6자리예요.' }).message).toBe(
      '초대코드는 숫자 6자리예요.',
    );
  });

  it('isRetryable은 AppError가 아닌 값에도 안전하다', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('toAppError — 통과와 기본값', () => {
  it('이미 AppError면 그대로 돌려준다', () => {
    const error = new AppError('auth');
    expect(toAppError(error)).toBe(error);
  });

  it('정체를 알 수 없는 오류는 unknown이고 cause를 보존한다', () => {
    const cause = new Error('boom');
    const error = toAppError(cause);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('unknown');
    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(cause);
  });

  it('fallback 코드를 지정할 수 있다', () => {
    expect(toAppError(new Error('boom'), { fallback: 'configuration' }).code).toBe('configuration');
  });

  it('Error가 아닌 값도 감싼다', () => {
    const error = toAppError('그냥 문자열');
    expect(error.code).toBe('unknown');
    expect(error.cause).toBe('그냥 문자열');
  });

  it('사용자 메시지에 원본 기술 메시지를 노출하지 않는다', () => {
    const error = toAppError(new Error(`invalid key ${FAKE_PUBLISHABLE} for project`));
    expect(error.message).not.toContain(FAKE_PUBLISHABLE);
    expect(error.message).toBe(userMessage('unknown'));
  });
});

describe('toAppError — 네트워크와 중단', () => {
  it('fetch 실패(TypeError)는 network 재시도 가능이다', () => {
    const error = toAppError(new TypeError('Failed to fetch'));
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('Safari의 "Load failed"도 network로 본다', () => {
    expect(toAppError(new TypeError('Load failed')).code).toBe('network');
  });

  it('supabase-js AuthRetryableFetchError는 network다', () => {
    const raw = Object.assign(new Error('Failed to fetch'), {
      name: 'AuthRetryableFetchError',
      __isAuthError: true,
      status: 0,
    });
    const error = toAppError(raw);
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('AbortError는 완료되지 않은 요청이라 network로 본다', () => {
    const error = toAppError(new DOMException('The operation was aborted.', 'AbortError'));
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('name만 AbortError인 오류도 같게 처리한다', () => {
    const raw = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(toAppError(raw).code).toBe('network');
  });
});

describe('toAppError — Supabase Auth 오류', () => {
  const authError = (status, message = 'auth failed') =>
    Object.assign(new Error(message), {
      name: 'AuthApiError',
      __isAuthError: true,
      status,
    });

  it.each([
    [400, 'auth'],
    [401, 'auth'],
    [403, 'auth'],
    [422, 'validation'],
    [429, 'rate_limited'],
    [500, 'network'],
    [503, 'network'],
  ])('status %i는 %s로 매핑된다', (status, code) => {
    const error = toAppError(authError(status));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('429는 재시도 가능이다', () => {
    expect(toAppError(authError(429)).retryable).toBe(true);
  });

  it('401은 재시도 불가다', () => {
    expect(toAppError(authError(401)).retryable).toBe(false);
  });
});

describe('toAppError — PostgREST / Postgres 오류', () => {
  const postgrestError = (code, extra = {}) => ({
    code,
    message: 'postgrest failure',
    details: null,
    hint: null,
    ...extra,
  });

  it.each([
    ['23505', 'conflict'],
    ['23503', 'conflict'],
    ['23502', 'validation'],
    ['23514', 'validation'],
    ['22P02', 'validation'],
    ['42501', 'forbidden'],
    ['PGRST116', 'not_found'],
    ['PGRST301', 'auth'],
    ['PGRST204', 'configuration'],
  ])('SQLSTATE/PGRST %s는 %s로 매핑된다', (code, expected) => {
    const error = toAppError(postgrestError(code));
    expect(error.code).toBe(expected);
    expect(error.cause).toBeTruthy();
  });

  it('RLS 위반(42501)은 재시도 불가 forbidden이다', () => {
    expect(toAppError(postgrestError('42501')).retryable).toBe(false);
  });

  it('중복 저장(23505)은 재시도 불가 conflict다', () => {
    expect(toAppError(postgrestError('23505')).retryable).toBe(false);
  });

  it('알 수 없는 SQLSTATE는 status로 판단한다', () => {
    const error = toAppError(postgrestError('XX000', { status: 503 }));
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('코드가 없고 status만 있으면 status로 판단한다', () => {
    expect(toAppError({ status: 404, message: 'not found' }).code).toBe('not_found');
    expect(toAppError({ status: 409, message: 'conflict' }).code).toBe('conflict');
    expect(toAppError({ status: 429, message: 'slow down' }).retryable).toBe(true);
  });

  it('Storage 오류의 statusCode 문자열도 읽는다', () => {
    const raw = Object.assign(new Error('Object not found'), {
      name: 'StorageApiError',
      status: 404,
      statusCode: '404',
    });
    expect(toAppError(raw).code).toBe('not_found');
  });
});

describe('toLogSafe', () => {
  it('코드와 재시도 여부만 남기고 키 재료를 흘리지 않는다', () => {
    const raw = Object.assign(
      new Error(`request to https://x.supabase.co?apikey=${FAKE_PUBLISHABLE} failed`),
      { name: 'AuthApiError', __isAuthError: true, status: 401 },
    );

    const payload = toLogSafe(raw);
    const serialized = JSON.stringify(payload);

    expect(payload.code).toBe('auth');
    expect(payload.retryable).toBe(false);
    expect(payload.status).toBe(401);
    expect(payload.causeName).toBe('AuthApiError');
    expect(serialized).not.toContain(FAKE_PUBLISHABLE);
    expect(serialized).not.toContain('supabase.co');
    expect(serialized).not.toContain('apikey');
  });

  it('service role처럼 보이는 값도 로그로 나가지 않는다', () => {
    const payload = toLogSafe(new Error(`bad key ${FAKE_SECRET}`));
    expect(JSON.stringify(payload)).not.toContain(FAKE_SECRET);
  });

  it('AppError를 그대로 넘겨도 동작한다', () => {
    const payload = toLogSafe(new AppError('rate_limited', { status: 429 }));
    expect(payload).toEqual({
      code: 'rate_limited',
      retryable: true,
      status: 429,
      causeName: null,
    });
  });
});

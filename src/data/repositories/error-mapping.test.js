import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../errors';
import {
  DOMAIN_ERROR_CODES,
  SQLSTATE_DOMAIN_CODES,
  domainErrorCode,
  envelopeToError,
  isErrorEnvelope,
  toRepositoryError,
} from './error-mapping';
import { errorEnvelope, okEnvelope, raisedError } from './__fixtures__/fake-supabase';

/** 실제 키가 아니다 — 오류 메시지 유출 검사용 가짜 값 */
const FAKE_KEY = 'sb_publishable_FAKE1234567890';

describe('도메인 코드 표', () => {
  it('마이그레이션의 app.error_sqlstate()와 같은 15개 코드를 덮는다', () => {
    expect(Object.keys(DOMAIN_ERROR_CODES).sort()).toEqual([
      'active_membership_conflict',
      'config_unresolved',
      'conflict',
      'couple_capacity_reached',
      'forbidden',
      'invite_consumed',
      'invite_expired',
      'invite_not_found',
      'invite_own_couple',
      'invite_revoked',
      'not_found',
      'photo_limit_reached',
      'purge_incomplete',
      'rate_limited',
      'validation_error',
    ]);
  });

  it('SQLSTATE 표는 도메인 코드 표와 1:1이다', () => {
    expect(Object.values(SQLSTATE_DOMAIN_CODES).sort()).toEqual(Object.keys(DOMAIN_ERROR_CODES).sort());
    expect(Object.keys(SQLSTATE_DOMAIN_CODES).every((state) => /^TW0\d\d$/.test(state))).toBe(true);
  });

  it('모든 도메인 코드가 안정 오류 코드로만 매핑된다', () => {
    for (const code of Object.values(DOMAIN_ERROR_CODES)) {
      expect(Object.values(ERROR_CODES)).toContain(code);
    }
  });

  it('필수 구분을 유지한다 — 인증·설정·검증·충돌·없음·권한·레이트리밋', () => {
    expect(domainErrorCode('config_unresolved')).toBe(ERROR_CODES.configuration);
    expect(domainErrorCode('validation_error')).toBe(ERROR_CODES.validation);
    expect(domainErrorCode('not_found')).toBe(ERROR_CODES.not_found);
    expect(domainErrorCode('invite_not_found')).toBe(ERROR_CODES.not_found);
    expect(domainErrorCode('forbidden')).toBe(ERROR_CODES.forbidden);
    expect(domainErrorCode('rate_limited')).toBe(ERROR_CODES.rate_limited);
    expect(domainErrorCode('couple_capacity_reached')).toBe(ERROR_CODES.conflict);
    expect(domainErrorCode('active_membership_conflict')).toBe(ERROR_CODES.conflict);
  });

  it('모르는 도메인 코드는 unknown이다', () => {
    expect(domainErrorCode('something_new')).toBe(ERROR_CODES.unknown);
  });
});

describe('isErrorEnvelope', () => {
  it('ok:false 봉투만 실패로 본다', () => {
    expect(isErrorEnvelope(errorEnvelope('invite_expired'))).toBe(true);
    expect(isErrorEnvelope(okEnvelope({ couple_id: 'c1' }))).toBe(false);
    expect(isErrorEnvelope(null)).toBe(false);
    expect(isErrorEnvelope({ ok: false })).toBe(true);
  });
});

describe('envelopeToError', () => {
  it('도메인 코드를 AppError 코드로 바꾸고 원래 코드를 함께 남긴다', () => {
    const error = envelopeToError(errorEnvelope('invite_consumed', { consumed_at: 'x' }));

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ERROR_CODES.conflict);
    expect(error.domainCode).toBe('invite_consumed');
    expect(error.details).toEqual({ consumed_at: 'x' });
  });

  it('rate_limited는 재시도 가능으로 표시된다', () => {
    const error = envelopeToError(errorEnvelope('rate_limited', { retry_after_seconds: 600 }));

    expect(error.code).toBe(ERROR_CODES.rate_limited);
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ retry_after_seconds: 600 });
  });

  it('초대 실패 갈래를 domainCode로 구분할 수 있다', () => {
    const codes = ['invite_not_found', 'invite_expired', 'invite_consumed', 'invite_revoked', 'couple_capacity_reached'];
    const seen = codes.map((code) => envelopeToError(errorEnvelope(code)).domainCode);

    expect(seen).toEqual(codes);
  });

  it('사용자 메시지에 기술 문구를 담지 않는다', () => {
    const error = envelopeToError(errorEnvelope('validation_error', { field: 'p_code' }));

    expect(error.message).not.toContain('p_code');
    expect(error.message).not.toContain('validation_error');
  });
});

describe('toRepositoryError', () => {
  it('raise된 TW SQLSTATE를 해당 코드로 옮긴다', () => {
    const error = toRepositoryError(raisedError('TW003', 'forbidden', { reason: 'no_session' }));

    expect(error.code).toBe(ERROR_CODES.forbidden);
    expect(error.domainCode).toBe('forbidden');
    expect(error.details).toEqual({ reason: 'no_session' });
  });

  it('설정 미해결(TW014)은 configuration이고 재시도 불가다', () => {
    const error = toRepositoryError(raisedError('TW014', 'config_unresolved', { key: 'invite_ttl_seconds' }));

    expect(error.code).toBe(ERROR_CODES.configuration);
    expect(error.retryable).toBe(false);
  });

  it('JSON이 아닌 detail도 잃지 않는다', () => {
    const error = toRepositoryError({ code: 'TW001', message: 'validation_error', details: 'not json' });

    expect(error.code).toBe(ERROR_CODES.validation);
    expect(error.details).toBe('not json');
  });

  it('JWT 만료는 auth다', () => {
    expect(toRepositoryError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe(ERROR_CODES.auth);
  });

  it('전송 실패는 network이고 재시도 가능하다', () => {
    const error = toRepositoryError(new TypeError('Failed to fetch'));

    expect(error.code).toBe(ERROR_CODES.network);
    expect(error.retryable).toBe(true);
  });

  it('5xx도 재시도 가능한 network다', () => {
    expect(toRepositoryError({ status: 503, message: 'unavailable' }).code).toBe(ERROR_CODES.network);
  });

  it('429는 rate_limited다', () => {
    expect(toRepositoryError({ status: 429, message: 'too many' }).code).toBe(ERROR_CODES.rate_limited);
  });

  it('RLS 거부(42501)는 forbidden이다', () => {
    expect(toRepositoryError({ code: '42501', message: 'permission denied' }).code).toBe(ERROR_CODES.forbidden);
  });

  it('이미 AppError면 그대로 돌려준다', () => {
    const original = new AppError(ERROR_CODES.validation);
    expect(toRepositoryError(original)).toBe(original);
  });

  it('fallback 코드를 지정할 수 있다', () => {
    expect(toRepositoryError({ message: '분류 불가' }, { fallback: ERROR_CODES.auth }).code).toBe(ERROR_CODES.auth);
  });

  it('원본 메시지에 키가 있어도 사용자 메시지로 새지 않는다', () => {
    const error = toRepositoryError(new Error(`apikey=${FAKE_KEY} rejected`));

    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.cause.message).toContain(FAKE_KEY);
  });
});

import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { onboardingError } from './onboarding-errors';

function domainError(domainCode, code = ERROR_CODES.unknown) {
  const error = new AppError(code, {
    message: 'postgres://secret.example.invalid?apikey=do-not-show',
  });
  error.domainCode = domainCode;
  return error;
}

describe('onboardingError', () => {
  it.each([
    ['invite_not_found', ERROR_CODES.not_found, '초대 코드를 찾을 수 없어요. 여섯 자리를 확인하고 다시 시도해 주세요.'],
    ['invite_expired', ERROR_CODES.validation, '초대 코드가 만료됐어요. 초대한 사람에게 새 코드를 요청해 주세요.'],
    ['invite_consumed', ERROR_CODES.conflict, '이미 사용된 초대 코드예요. 초대한 사람에게 새 코드를 요청해 주세요.'],
    ['invite_revoked', ERROR_CODES.validation, '더 이상 사용할 수 없는 초대 코드예요. 초대한 사람에게 새 코드를 요청해 주세요.'],
    ['invite_own_couple', ERROR_CODES.conflict, '내 커플의 초대 코드는 사용할 수 없어요. 다른 초대 코드를 입력해 주세요.'],
    ['couple_capacity_reached', ERROR_CODES.conflict, '이미 두 명이 연결된 커플이에요. 다른 초대 코드를 확인해 주세요.'],
    ['active_membership_conflict', ERROR_CODES.conflict, '이미 연결된 커플이 있어요. 앱을 다시 열어 현재 연결 상태를 확인해 주세요.'],
  ])('%s 도메인 오류를 실행 가능한 한국어 안내로 바꾼다', (domainCode, code, message) => {
    expect(onboardingError(domainError(domainCode, code), 'join')).toEqual({
      code,
      domainCode,
      message,
      retryable: false,
    });
  });

  it.each([
    [ERROR_CODES.network, '네트워크 연결을 확인하고 다시 시도해 주세요.'],
    [ERROR_CODES.rate_limited, '요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.'],
  ])('%s 오류는 명시적인 재시도 안내를 제공한다', (code, message) => {
    expect(onboardingError(new AppError(code), 'join')).toEqual({
      code,
      domainCode: null,
      message,
      retryable: true,
    });
  });

  it.each([
    ['start', '커플을 시작하지 못했어요. 잠시 뒤에 다시 시도해 주세요.'],
    ['join', '초대 코드로 연결하지 못했어요. 여섯 자리를 확인하고 다시 시도해 주세요.'],
    ['name', '이름을 저장하지 못했어요. 1~12자로 입력했는지 확인해 주세요.'],
    ['complete', '온보딩을 마치지 못했어요. 다시 시도해 주세요.'],
    ['reissue', '새 초대 코드를 만들지 못했어요. 다시 시도해 주세요.'],
  ])('%s의 분류되지 않은 원본 오류를 절대 노출하지 않는다', (operation, message) => {
    const result = onboardingError(new Error('apikey=do-not-show'), operation);

    expect(result.message).toBe(message);
    expect(result.message).not.toContain('apikey');
    expect(result.retryable).toBe(false);
  });
});

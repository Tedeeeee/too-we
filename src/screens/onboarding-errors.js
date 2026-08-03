import { ERROR_CODES, toAppError } from '@/data/errors';

const DOMAIN_MESSAGES = Object.freeze({
  invite_not_found: '초대 코드를 찾을 수 없어요. 여섯 자리를 확인하고 다시 시도해 주세요.',
  invite_expired: '초대 코드가 만료됐어요. 초대한 사람에게 새 코드를 요청해 주세요.',
  invite_consumed: '이미 사용된 초대 코드예요. 초대한 사람에게 새 코드를 요청해 주세요.',
  invite_revoked: '더 이상 사용할 수 없는 초대 코드예요. 초대한 사람에게 새 코드를 요청해 주세요.',
  invite_own_couple: '내 커플의 초대 코드는 사용할 수 없어요. 다른 초대 코드를 입력해 주세요.',
  couple_capacity_reached: '이미 두 명이 연결된 커플이에요. 다른 초대 코드를 확인해 주세요.',
  active_membership_conflict: '이미 연결된 커플이 있어요. 앱을 다시 열어 현재 연결 상태를 확인해 주세요.',
});

const OPERATION_MESSAGES = Object.freeze({
  start: '커플을 시작하지 못했어요. 잠시 뒤에 다시 시도해 주세요.',
  join: '초대 코드로 연결하지 못했어요. 여섯 자리를 확인하고 다시 시도해 주세요.',
  name: '이름을 저장하지 못했어요. 1~12자로 입력했는지 확인해 주세요.',
  complete: '온보딩을 마치지 못했어요. 다시 시도해 주세요.',
  reissue: '새 초대 코드를 만들지 못했어요. 다시 시도해 주세요.',
});

const CODE_MESSAGES = Object.freeze({
  [ERROR_CODES.network]: '네트워크 연결을 확인하고 다시 시도해 주세요.',
  [ERROR_CODES.rate_limited]: '요청이 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.',
});

export function onboardingError(error, operation) {
  const appError = toAppError(error);
  const domainCode = typeof appError.domainCode === 'string' ? appError.domainCode : null;
  const retryable =
    appError.code === ERROR_CODES.network || appError.code === ERROR_CODES.rate_limited;

  return {
    code: appError.code,
    domainCode,
    message:
      DOMAIN_MESSAGES[domainCode] ??
      CODE_MESSAGES[appError.code] ??
      OPERATION_MESSAGES[operation] ??
      OPERATION_MESSAGES.complete,
    retryable,
  };
}

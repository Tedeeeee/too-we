import { AppError, ERROR_CODES, toAppError } from '../errors';

export const DOMAIN_ERROR_CODES = Object.freeze({
  validation_error: ERROR_CODES.validation,
  not_found: ERROR_CODES.not_found,
  forbidden: ERROR_CODES.forbidden,
  rate_limited: ERROR_CODES.rate_limited,
  invite_not_found: ERROR_CODES.not_found,
  invite_expired: ERROR_CODES.validation,
  invite_consumed: ERROR_CODES.conflict,
  invite_revoked: ERROR_CODES.validation,
  invite_own_couple: ERROR_CODES.conflict,
  couple_capacity_reached: ERROR_CODES.conflict,
  active_membership_conflict: ERROR_CODES.conflict,
  photo_limit_reached: ERROR_CODES.conflict,
  conflict: ERROR_CODES.conflict,
  config_unresolved: ERROR_CODES.configuration,
  purge_incomplete: ERROR_CODES.conflict,
});

export const SQLSTATE_DOMAIN_CODES = Object.freeze({
  TW001: 'validation_error',
  TW002: 'not_found',
  TW003: 'forbidden',
  TW004: 'rate_limited',
  TW005: 'invite_not_found',
  TW006: 'invite_expired',
  TW007: 'invite_consumed',
  TW008: 'invite_revoked',
  TW009: 'invite_own_couple',
  TW010: 'couple_capacity_reached',
  TW011: 'active_membership_conflict',
  TW012: 'photo_limit_reached',
  TW013: 'conflict',
  TW014: 'config_unresolved',
  TW015: 'purge_incomplete',
});

export function domainErrorCode(code) {
  return DOMAIN_ERROR_CODES[code] ?? ERROR_CODES.unknown;
}

export function isErrorEnvelope(value) {
  return value?.ok === false;
}

const readDetails = (details) => {
  if (typeof details !== 'string') return details ?? {};
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
};

const withDomain = (code, details, cause) => {
  const error = new AppError(domainErrorCode(code), { cause });
  error.domainCode = code;
  error.details = readDetails(details);
  return error;
};

export function envelopeToError(envelope) {
  const code = envelope?.error?.code;
  return withDomain(code, envelope?.error?.details, envelope);
}

export function toRepositoryError(error, { fallback = ERROR_CODES.unknown } = {}) {
  if (error instanceof AppError) return error;

  const domainCode = SQLSTATE_DOMAIN_CODES[error?.code];
  if (domainCode) return withDomain(domainCode, error?.details, error);

  return toAppError(error, { fallback });
}

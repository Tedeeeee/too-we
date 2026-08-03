import { AppError, ERROR_CODES } from '../errors';
import { envelopeToError, isErrorEnvelope, toRepositoryError } from './error-mapping';

export function unwrap(result, { fallback = ERROR_CODES.unknown } = {}) {
  if (result?.error) throw toRepositoryError(result.error, { fallback });
  return result?.data ?? null;
}

export async function runQuery(query, options) {
  try {
    return unwrap(await query, options);
  } catch (error) {
    throw toRepositoryError(error, options);
  }
}

export async function callRpc(client, name, args) {
  let envelope;
  try {
    envelope = unwrap(await client.rpc(name, args));
  } catch (error) {
    throw toRepositoryError(error);
  }

  if (isErrorEnvelope(envelope)) throw envelopeToError(envelope);
  if (!envelope || envelope.ok !== true) {
    throw new AppError(ERROR_CODES.unknown, { cause: envelope });
  }

  return {
    data: envelope.data ?? null,
    replayed: envelope.replayed === true,
  };
}

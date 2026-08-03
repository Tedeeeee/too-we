import { AppError, ERROR_CODES } from '../errors';
import { toRepositoryError } from './error-mapping';

export function createSessionRepository({ getClient }) {
  let userId = null;
  let pending = null;

  const acquireUserId = async () => {
    let client;
    try {
      client = getClient();
    } catch (error) {
      throw toRepositoryError(error, { fallback: ERROR_CODES.configuration });
    }

    let current;
    try {
      current = await client.auth.getSession();
    } catch (error) {
      throw toRepositoryError(error, { fallback: ERROR_CODES.auth });
    }
    if (current?.error) {
      throw toRepositoryError(current.error, { fallback: ERROR_CODES.auth });
    }

    const existingId = current?.data?.session?.user?.id;
    if (existingId) {
      userId = existingId;
      return userId;
    }

    let signedIn;
    try {
      signedIn = await client.auth.signInAnonymously();
    } catch (error) {
      throw toRepositoryError(error, { fallback: ERROR_CODES.auth });
    }
    if (signedIn?.error) {
      throw toRepositoryError(signedIn.error, { fallback: ERROR_CODES.auth });
    }

    const signedInId = signedIn?.data?.session?.user?.id;
    if (!signedInId) {
      throw new AppError(ERROR_CODES.auth, { cause: signedIn });
    }

    userId = signedInId;
    return userId;
  };

  return {
    ensureUserId() {
      if (userId) return Promise.resolve(userId);
      if (pending) return pending;

      pending = acquireUserId().finally(() => {
        pending = null;
      });
      return pending;
    },

    reset() {
      userId = null;
      pending = null;
    },
  };
}

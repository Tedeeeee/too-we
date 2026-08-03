import { AppError, ERROR_CODES } from '../errors';
import { toRepositoryError } from './error-mapping';

export function createSessionRepository({ getClient }) {
  let activeClient = null;
  let userId = null;
  let pending = null;
  let generation = 0;

  const acquireUserId = async (client) => {
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
    if (existingId) return existingId;

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

    return signedInId;
  };

  const ensureUserId = () => {
    let client;
    try {
      client = getClient();
    } catch (error) {
      return Promise.reject(
        toRepositoryError(error, { fallback: ERROR_CODES.configuration }),
      );
    }

    if (client !== activeClient) {
      activeClient = client;
      userId = null;
      pending = null;
      generation += 1;
    }
    if (userId) return Promise.resolve(userId);
    if (pending) return pending;

    const currentGeneration = generation;
    let acquisition;
    acquisition = acquireUserId(client)
      .then((acquiredUserId) => {
        if (generation !== currentGeneration || activeClient !== client) {
          if (pending === acquisition) pending = null;
          return ensureUserId();
        }
        userId = acquiredUserId;
        return userId;
      })
      .finally(() => {
        if (pending === acquisition) pending = null;
      });
    pending = acquisition;
    return pending;
  };

  return {
    ensureUserId,

    reset() {
      activeClient = null;
      userId = null;
      pending = null;
      generation += 1;
    },
  };
}

import { AppError, ERROR_CODES } from '../errors';
import { createCouplesRepository } from './couples';
import { createPlaceSearchRepository } from './places';
import { createSessionRepository } from './session';
import { createSettingsRepository } from './settings';
import { createVisitsRepository } from './visits';
import { createWishlistRepository } from './wishlist';

const defaultRequestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function createRepositories({
  client,
  getClient,
  placeSearchAdapter,
  newRequestKey = defaultRequestKey,
  now = () => new Date(),
} = {}) {
  const resolveClient =
    getClient ??
    (() => {
      if (!client) throw new AppError(ERROR_CODES.configuration);
      return client;
    });
  const requestKey = (provided) =>
    typeof provided === 'string' && provided.trim() ? provided : newRequestKey();
  const session = createSessionRepository({ getClient: resolveClient });
  const places = createPlaceSearchRepository({ adapter: placeSearchAdapter });

  return {
    session,
    couples: createCouplesRepository({ getClient: resolveClient, session, requestKey }),
    visits: createVisitsRepository({
      getClient: resolveClient,
      session,
      requestKey,
      now,
      places,
    }),
    places,
    wishlist: createWishlistRepository({ getClient: resolveClient, session }),
    settings: createSettingsRepository(),
  };
}

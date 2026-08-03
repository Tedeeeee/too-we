import { toRepositoryError } from './error-mapping';

export function createPlaceSearchRepository({ adapter } = {}) {
  return {
    async getNearbyPlaces(query) {
      if (typeof adapter?.searchPlaces !== 'function') return [];
      try {
        const places = await adapter.searchPlaces(query);
        return Array.isArray(places) ? places : [];
      } catch (error) {
        throw toRepositoryError(error);
      }
    },

    async getPlace(placeId) {
      if (!placeId || typeof adapter?.getPlace !== 'function') return null;
      try {
        return (await adapter.getPlace(placeId)) ?? null;
      } catch (error) {
        throw toRepositoryError(error);
      }
    },
  };
}

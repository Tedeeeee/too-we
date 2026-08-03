import { AppError, ERROR_CODES } from '../errors';
import { toRepositoryError } from './error-mapping';

export function createPlaceSearchRepository({ adapter } = {}) {
  const snapshots = new Map();
  const copy = (place) =>
    place && typeof place === 'object' && !Array.isArray(place) ? { ...place } : place;
  const cache = (place) => {
    const id = typeof place?.id === 'string' ? place.id.trim() : '';
    if (id) snapshots.set(id, { ...place, id });
  };
  const normalizeQuery = (query) => {
    if (typeof query === 'string') return query.trim();
    if (query === undefined || query === null) return '';
    if (typeof query !== 'object' || Array.isArray(query)) {
      throw new AppError(ERROR_CODES.validation, { cause: { field: 'query' } });
    }
    if (Object.hasOwn(query, 'keyword') && typeof query.keyword !== 'string') {
      throw new AppError(ERROR_CODES.validation, { cause: { field: 'keyword' } });
    }
    return {
      ...query,
      ...(query.options && typeof query.options === 'object' && !Array.isArray(query.options)
        ? { options: { ...query.options } }
        : {}),
      keyword: typeof query.keyword === 'string' ? query.keyword.trim() : '',
    };
  };

  return {
    async getNearbyPlaces(query) {
      const normalizedQuery = normalizeQuery(query);
      const keyword =
        typeof normalizedQuery === 'string' ? normalizedQuery : normalizedQuery.keyword;
      if (!keyword) return [];
      if (typeof adapter?.searchPlaces !== 'function') return [];
      try {
        const places = await adapter.searchPlaces(normalizedQuery);
        if (!Array.isArray(places)) return [];
        places.forEach(cache);
        return places.map(copy);
      } catch (error) {
        throw toRepositoryError(error);
      }
    },

    async getPlace(placeId) {
      const id = typeof placeId === 'string' ? placeId.trim() : '';
      if (!id) return null;
      if (snapshots.has(id)) return copy(snapshots.get(id));
      if (typeof adapter?.getPlace !== 'function') return null;
      try {
        const place = (await adapter.getPlace(id)) ?? null;
        cache(place);
        return copy(place);
      } catch (error) {
        throw toRepositoryError(error);
      }
    },
  };
}

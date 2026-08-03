import { AppError, ERROR_CODES, toAppError } from './errors';
import { loadKakaoMapsSdk } from './kakao-maps';

const MAX_RADIUS_METERS = 20_000;
const MAX_PAGE = 45;
const MAX_PAGE_SIZE = 15;

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');
const validationError = (field) =>
  new AppError(ERROR_CODES.validation, { cause: { field } });
const configurationError = (detail) =>
  new AppError(ERROR_CODES.configuration, { cause: new Error(detail) });

const present = (value) => value !== undefined && value !== null && value !== '';

const finiteNumber = (value, field) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw validationError(field);
  return number;
};

const rangedInteger = (value, field, min, max) => {
  const number = finiteNumber(value, field);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw validationError(field);
  }
  return number;
};

const readInput = (query) => {
  if (typeof query === 'string') return { keyword: query };
  if (query === undefined || query === null) return { keyword: '' };
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw validationError('query');
  }
  return query;
};

const normalizeSearch = (query) => {
  const input = readInput(query);
  const nested =
    input.options && typeof input.options === 'object' && !Array.isArray(input.options)
      ? input.options
      : {};
  const option = (key) => (Object.hasOwn(input, key) ? input[key] : nested[key]);
  const keyword = cleanString(input.keyword);
  if (!keyword) return { keyword: '', options: {} };

  const rawLat = option('lat');
  const rawLng = option('lng');
  const hasLat = present(rawLat);
  const hasLng = present(rawLng);
  if (hasLat !== hasLng) throw validationError('location');

  const options = {};
  if (hasLat) {
    const lat = finiteNumber(rawLat, 'lat');
    const lng = finiteNumber(rawLng, 'lng');
    if (lat < -90 || lat > 90) throw validationError('lat');
    if (lng < -180 || lng > 180) throw validationError('lng');
    options.location = { lat, lng };
  }

  const rawRadius = option('radius');
  if (present(rawRadius)) {
    if (!hasLat) throw validationError('radius');
    options.radius = rangedInteger(rawRadius, 'radius', 1, MAX_RADIUS_METERS);
  }

  const rawPage = option('page');
  if (present(rawPage)) options.page = rangedInteger(rawPage, 'page', 1, MAX_PAGE);

  const rawSize = option('size');
  if (present(rawSize)) options.size = rangedInteger(rawSize, 'size', 1, MAX_PAGE_SIZE);

  const rawSort = option('sort');
  if (present(rawSort)) {
    const sort = cleanString(rawSort).toLowerCase();
    if (!['accuracy', 'distance'].includes(sort)) throw validationError('sort');
    if (sort === 'distance' && !hasLat) throw validationError('sort');
    options.sort = sort;
  }

  const rawCategory = option('category');
  if (present(rawCategory)) {
    const category = cleanString(rawCategory).toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(category)) throw validationError('category');
    options.category_group_code = category;
  }

  return { keyword, options };
};

const toSdkOptions = (options, maps) => {
  const sdkOptions = { ...options };
  if (options.location) {
    if (typeof maps?.LatLng !== 'function') {
      throw configurationError('Kakao Maps SDK LatLng is unavailable');
    }
    sdkOptions.location = new maps.LatLng(options.location.lat, options.location.lng);
  }
  if (options.sort) {
    const sortValue = maps?.services?.SortBy?.[options.sort.toUpperCase()];
    if (!sortValue) throw configurationError('Kakao Places SortBy is unavailable');
    sdkOptions.sort = sortValue;
  }
  return sdkOptions;
};

const normalizePlace = (place) => {
  const id = cleanString(place?.id);
  const name = cleanString(place?.place_name);
  const rawLat = place?.y;
  const rawLng = place?.x;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (
    !id ||
    !name ||
    !present(rawLat) ||
    !present(rawLng) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  return {
    id,
    name,
    category: cleanString(place.category_name),
    address: cleanString(place.address_name),
    roadAddress: cleanString(place.road_address_name),
    phone: cleanString(place.phone),
    url: cleanString(place.place_url),
    lat,
    lng,
    provider: 'kakao',
  };
};

const statusError = (status, maps) => {
  const value = String(status ?? '').toUpperCase();
  if (status === maps?.services?.Status?.ERROR || value === 'ERROR') {
    return new AppError(ERROR_CODES.network, { cause: { provider: 'kakao', status: 'ERROR' } });
  }
  if (/RATE|LIMIT|QUOTA|429/.test(value)) {
    return new AppError(ERROR_CODES.rate_limited, {
      cause: { provider: 'kakao', status: 'RATE_LIMITED' },
    });
  }
  if (/INVALID|BAD_REQUEST|400/.test(value)) {
    return new AppError(ERROR_CODES.validation, {
      cause: { provider: 'kakao', status: 'INVALID_REQUEST' },
    });
  }
  return new AppError(ERROR_CODES.unknown, { cause: { provider: 'kakao' } });
};

const copyPlace = (place) => (place ? { ...place } : null);

export function createKakaoPlacesAdapter({ loadSdk = loadKakaoMapsSdk } = {}) {
  const cache = new Map();

  return {
    async searchPlaces(query) {
      let maps;
      try {
        // Parse the keyword first so an empty search never reads configuration or touches the SDK.
        const input = normalizeSearch(query);
        if (!input.keyword) return [];
        maps = await loadSdk();
        const keyword = input.keyword;
        const options = toSdkOptions(input.options, maps);

        const places = await new Promise((resolve, reject) => {
          if (typeof maps?.services?.Places !== 'function') {
            reject(configurationError('Kakao Places service is unavailable'));
            return;
          }

          try {
            const service = new maps.services.Places();
            if (typeof service?.keywordSearch !== 'function') {
              reject(configurationError('Kakao Places keywordSearch is unavailable'));
              return;
            }
            service.keywordSearch(
              keyword,
              (rows, status) => {
                if (status === maps.services.Status?.ZERO_RESULT || status === 'ZERO_RESULT') {
                  resolve([]);
                  return;
                }
                if (status !== maps.services.Status?.OK && status !== 'OK') {
                  reject(statusError(status, maps));
                  return;
                }

                const normalized = (Array.isArray(rows) ? rows : [])
                  .map(normalizePlace)
                  .filter(Boolean);
                for (const place of normalized) cache.set(place.id, { ...place });
                resolve(normalized.map(copyPlace));
              },
              options,
            );
          } catch (error) {
            reject(error);
          }
        });

        return places;
      } catch (error) {
        throw toAppError(error);
      }
    },

    async getPlace(placeId) {
      const id = cleanString(placeId);
      return copyPlace(id ? cache.get(id) : null);
    },
  };
}

export const kakaoPlacesAdapter = createKakaoPlacesAdapter();

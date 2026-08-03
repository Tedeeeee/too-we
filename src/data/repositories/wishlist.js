import { AppError, ERROR_CODES } from '../errors';
import { mapWishlistPlace, toPlacePayload } from './mappers';
import { runQuery } from './rpc';

const WISHLIST_COLUMNS = [
  'id',
  'couple_id',
  'created_by',
  'place_provider',
  'place_provider_id',
  'place_name',
  'place_category',
  'place_address',
  'place_road_address',
  'place_url',
  'place_lat',
  'place_lng',
  'place_snapshot',
  'place_snapshot_at',
  'created_at',
  'updated_at',
].join(',');

const validationError = (cause) => new AppError(ERROR_CODES.validation, { cause });
const notFoundError = (cause) => new AppError(ERROR_CODES.not_found, { cause });
const PLACE_TEXT_INPUT_KEYS = [
  'id',
  'providerId',
  'provider_id',
  'name',
  'provider',
  'category',
  'address',
  'roadAddress',
  'road_address',
  'url',
];

const validateWishlistId = (wishlistId) => {
  if (typeof wishlistId !== 'string' || !wishlistId.trim()) {
    throw validationError({ field: 'wishlistId' });
  }
  return wishlistId.trim();
};

const normalizeWishlistPlace = (place) => {
  if (!place || typeof place !== 'object' || Array.isArray(place)) {
    throw validationError({ field: 'place' });
  }
  const hasInvalidTextField = PLACE_TEXT_INPUT_KEYS.some(
    (key) => Object.hasOwn(place, key) && place[key] != null && typeof place[key] !== 'string',
  );
  const hasInvalidCoordinate = ['lat', 'lng'].some(
    (key) =>
      Object.hasOwn(place, key) &&
      place[key] != null &&
      (typeof place[key] !== 'number' || !Number.isFinite(place[key])),
  );
  if (hasInvalidTextField || hasInvalidCoordinate) {
    throw validationError({ field: 'place' });
  }

  const payload = toPlacePayload(place);
  if (!payload || !['kakao', 'manual'].includes(payload.provider)) {
    throw validationError({ field: 'place' });
  }
  if (
    (payload.lat !== undefined && (payload.lat < -90 || payload.lat > 90)) ||
    (payload.lng !== undefined && (payload.lng < -180 || payload.lng > 180))
  ) {
    throw validationError({ field: 'place' });
  }

  // wishlist_places에는 전화번호 컬럼이 없다. 지원되는 스냅샷 필드만 새 객체로
  // 골라 caller 객체와 방문 기록용 place payload를 변경하지 않는다.
  const { phone: _unsupportedPhone, ...supported } = payload;
  return supported;
};

const toWishlistWrite = (place, snapshotAt) => ({
  place_provider: place.provider,
  place_provider_id: place.provider_id ?? null,
  place_name: place.name,
  place_category: place.category ?? null,
  place_address: place.address ?? null,
  place_road_address: place.road_address ?? null,
  place_url: place.url ?? null,
  place_lat: place.lat ?? null,
  place_lng: place.lng ?? null,
  place_snapshot: { ...place },
  place_snapshot_at: snapshotAt,
});

export function createWishlistRepository({ getClient, session, now = () => new Date() }) {
  const profileNames = async () => {
    const profiles = await runQuery(getClient().from('profiles').select('id,display_name'));
    return new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name ?? '']));
  };

  const mapRow = async (row) => mapWishlistPlace(row, await profileNames());

  const snapshotTime = () => {
    const value = now();
    const timestamp = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(timestamp.getTime())) throw validationError({ field: 'snapshotAt' });
    return timestamp.toISOString();
  };

  return {
    async getWishlist() {
      await session.ensureUserId();
      const client = getClient();
      const rows = await runQuery(
        client
          .from('wishlist_places')
          .select(WISHLIST_COLUMNS)
          .order('created_at', { ascending: false }),
      );
      if (!rows?.length) return [];

      const nameById = await profileNames();
      return rows.map((row) => mapWishlistPlace(row, nameById));
    },

    async createWishlistPlace(input) {
      const place = normalizeWishlistPlace(input);
      const userId = await session.ensureUserId();
      const client = getClient();
      const couple = await runQuery(
        client.from('couples').select('id').eq('status', 'active').maybeSingle(),
      );
      if (!couple) throw notFoundError({ resource: 'couple' });

      const row = await runQuery(
        client
          .from('wishlist_places')
          .insert({
            couple_id: couple.id,
            created_by: userId,
            ...toWishlistWrite(place, snapshotTime()),
          })
          .select(WISHLIST_COLUMNS)
          .single(),
      );
      return mapRow(row);
    },

    async updateWishlistPlace(wishlistId, input) {
      const id = validateWishlistId(wishlistId);
      const place = normalizeWishlistPlace(input);
      await session.ensureUserId();
      const row = await runQuery(
        getClient()
          .from('wishlist_places')
          .update(toWishlistWrite(place, snapshotTime()))
          .eq('id', id)
          .select(WISHLIST_COLUMNS)
          .maybeSingle(),
      );
      if (!row) throw notFoundError({ resource: 'wishlist_place' });
      return mapRow(row);
    },

    async deleteWishlistPlace(wishlistId) {
      const id = validateWishlistId(wishlistId);
      await session.ensureUserId();
      const row = await runQuery(
        getClient()
          .from('wishlist_places')
          .delete()
          .eq('id', id)
          .select('id')
          .maybeSingle(),
      );
      if (!row) throw notFoundError({ resource: 'wishlist_place' });
      return { id: row.id };
    },
  };
}

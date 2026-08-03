import { AppError, ERROR_CODES } from '../errors';
import {
  mapVisit,
  normalizeEntryText,
  normalizeRating,
  normalizeTags,
  toPlacePayload,
} from './mappers';
import { callRpc, runQuery } from './rpc';

const VISIT_COLUMNS = [
  'id',
  'couple_id',
  'visited_at',
  'place_provider',
  'place_provider_id',
  'place_name',
  'place_category',
  'place_address',
  'place_road_address',
  'place_phone',
  'place_url',
  'place_lat',
  'place_lng',
  'flower_key',
  'visit_entries(author_id,note,rating,created_at)',
  'visit_tags(ordinal,label)',
  'visit_photos(id,uploader_id,ordinal,storage_bucket,storage_path)',
].join(',');

const SUPPORTED_PATCH_KEYS = new Set(['tags', 'text', 'rating', 'flower', 'date', 'place']);
const FORBIDDEN_ENTRY_WRITE_KEYS = new Set([
  'entries',
  'authorId',
  'author_id',
  'memberId',
  'member_id',
]);
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
  'phone',
  'url',
];

const validationError = (cause) => new AppError(ERROR_CODES.validation, { cause });
const notFoundError = (cause) => new AppError(ERROR_CODES.not_found, { cause });

const normalizeDate = (value) => {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    !(value instanceof Date || typeof value === 'string' || typeof value === 'number')
  ) {
    throw validationError({ field: 'date' });
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError({ field: 'date' });
  return date.toISOString();
};

const rejectEntryOwnershipKeys = (value) => {
  const forbiddenKey = Object.keys(value).find((key) => FORBIDDEN_ENTRY_WRITE_KEYS.has(key));
  if (forbiddenKey) throw validationError({ field: forbiddenKey });
};

const normalizeEntryTextInput = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw validationError({ field: 'text' });
  return normalizeEntryText(value);
};

const normalizeRatingInput = (value) => {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw validationError({ field: 'rating' });
  }
  const rating = normalizeRating(value);
  if (rating === null) throw validationError({ field: 'rating' });
  return rating;
};

const normalizeTagsInput = (value) => {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    throw validationError({ field: 'tags' });
  }
  return normalizeTags(value);
};

const normalizeFlowerInput = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw validationError({ field: 'flower' });
  const flower = value.trim();
  if (!flower) throw validationError({ field: 'flower' });
  return flower;
};

const normalizePlaceInput = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError({ field: 'place' });
  }
  const hasInvalidTextField = PLACE_TEXT_INPUT_KEYS.some(
    (key) => Object.hasOwn(value, key) && value[key] != null && typeof value[key] !== 'string',
  );
  const hasInvalidCoordinate = ['lat', 'lng'].some(
    (key) =>
      Object.hasOwn(value, key) &&
      value[key] != null &&
      (typeof value[key] !== 'number' || !Number.isFinite(value[key])),
  );
  if (hasInvalidTextField || hasInvalidCoordinate) {
    throw validationError({ field: 'place' });
  }
  const place = toPlacePayload(value);
  if (!place || !['kakao', 'manual'].includes(place.provider)) {
    throw validationError({ field: 'place' });
  }
  if (
    (place.lat !== undefined && (place.lat < -90 || place.lat > 90)) ||
    (place.lng !== undefined && (place.lng < -180 || place.lng > 180))
  ) {
    throw validationError({ field: 'place' });
  }
  return place;
};

const toSharedPlaceUpdate = (place, snapshotAt) => ({
  place_provider: place.provider,
  place_provider_id: place.provider_id ?? null,
  place_name: place.name,
  place_category: place.category ?? null,
  place_address: place.address ?? null,
  place_road_address: place.road_address ?? null,
  place_phone: place.phone ?? null,
  place_url: place.url ?? null,
  place_lat: place.lat ?? null,
  place_lng: place.lng ?? null,
  place_snapshot: place,
  place_snapshot_at: snapshotAt,
});

const validateRecordId = (recordId) => {
  if (typeof recordId !== 'string' || !recordId.trim()) {
    throw validationError({ field: 'recordId' });
  }
  return recordId.trim();
};

export function createVisitsRepository({ getClient, session, requestKey, now, places, photos }) {
  const getRecords = async () => {
    const userId = await session.ensureUserId();
    const rows = await runQuery(
      getClient().from('visits').select(VISIT_COLUMNS).order('visited_at', { ascending: false }),
    );
    return photos.attachSignedUrls((rows ?? []).map((row) => mapVisit(row, userId)));
  };

  const getRecord = async (recordId) => {
    const id = validateRecordId(recordId);
    const userId = await session.ensureUserId();
    const row = await runQuery(
      getClient().from('visits').select(VISIT_COLUMNS).eq('id', id).maybeSingle(),
    );
    const record = mapVisit(row, userId);
    if (!record) return null;
    const [signedRecord] = await photos.attachSignedUrls([record]);
    return signedRecord;
  };

  const updateSharedVisit = async (recordId, payload) => {
    const row = await runQuery(
      getClient().from('visits').update(payload).eq('id', recordId).select('id').maybeSingle(),
    );
    if (!row) throw notFoundError({ resource: 'visit' });
  };

  return {
    getRecords,
    getRecord,

    async saveFiveSecondRecord(input = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw validationError({ field: 'input' });
      }
      rejectEntryOwnershipKeys(input);
      const recordId = typeof input.recordId === 'string' ? input.recordId.trim() : '';

      if (recordId) {
        const text = normalizeEntryTextInput(input.text);
        const rating = normalizeRatingInput(input.rating);
        await session.ensureUserId();
        await callRpc(getClient(), 'upsert_my_visit_entry', {
          p_visit_id: recordId,
          p_text: text,
          p_rating: rating,
        });
        return getRecord(recordId);
      }

      let place = input.place;
      if (!place && input.placeId) place = await places.getPlace(input.placeId);
      if (!place && input.placeId) throw notFoundError({ resource: 'place' });
      if (!place) throw validationError({ field: 'place' });

      const placePayload = toPlacePayload(place);
      if (!placePayload) throw validationError({ field: 'place' });
      const visitedAt = normalizeDate(input.date ?? now());

      await session.ensureUserId();
      const created = await callRpc(getClient(), 'create_visit', {
        p_place: placePayload,
        p_visited_at: visitedAt,
        p_request_key: requestKey(input.requestKey),
      });
      const visitId = created.data?.visit_id;
      if (!visitId) throw new AppError(ERROR_CODES.unknown, { cause: created });

      return getRecord(visitId);
    },

    async setRecordFlower(recordId, flowerKey) {
      const id = validateRecordId(recordId);
      const flower = normalizeFlowerInput(flowerKey);

      await session.ensureUserId();
      await updateSharedVisit(id, { flower_key: flower });
      return getRecord(id);
    },

    async updateRecord(recordId, patch = {}) {
      const id = validateRecordId(recordId);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw validationError({ field: 'patch' });
      }
      const keys = Object.keys(patch);
      if (keys.some((key) => !SUPPORTED_PATCH_KEYS.has(key))) {
        throw validationError({ field: 'patch' });
      }

      const normalized = {};
      if (Object.hasOwn(patch, 'tags')) normalized.tags = normalizeTagsInput(patch.tags);
      if (Object.hasOwn(patch, 'text')) {
        if (patch.text === undefined) throw validationError({ field: 'text' });
        normalized.text = normalizeEntryTextInput(patch.text);
      }
      if (Object.hasOwn(patch, 'rating')) {
        if (patch.rating === undefined) throw validationError({ field: 'rating' });
        normalized.rating = normalizeRatingInput(patch.rating);
      }
      if (Object.hasOwn(patch, 'flower')) {
        if (patch.flower === undefined) throw validationError({ field: 'flower' });
        normalized.flower = normalizeFlowerInput(patch.flower);
      }
      if (Object.hasOwn(patch, 'date')) normalized.date = normalizeDate(patch.date);
      if (Object.hasOwn(patch, 'place')) normalized.place = normalizePlaceInput(patch.place);

      const current = await getRecord(id);
      if (!current) throw notFoundError({ resource: 'visit' });
      if (keys.length === 0) return current;

      if (Object.hasOwn(patch, 'tags')) {
        await callRpc(getClient(), 'set_visit_tags', {
          p_visit_id: id,
          p_labels: normalized.tags,
        });
      }

      const shared = {};
      if (Object.hasOwn(patch, 'flower')) {
        shared.flower_key = normalized.flower;
      }
      if (Object.hasOwn(patch, 'date')) shared.visited_at = normalized.date;
      if (Object.hasOwn(patch, 'place')) {
        Object.assign(shared, toSharedPlaceUpdate(normalized.place, normalizeDate(now())));
      }
      if (Object.keys(shared).length) await updateSharedVisit(id, shared);

      if (Object.hasOwn(patch, 'text') || Object.hasOwn(patch, 'rating')) {
        const myEntry = current.entries.find((entry) => entry.memberId === 'me');
        await callRpc(getClient(), 'upsert_my_visit_entry', {
          p_visit_id: id,
          p_text: Object.hasOwn(patch, 'text') ? normalized.text : (myEntry?.text ?? null),
          p_rating: Object.hasOwn(patch, 'rating') ? normalized.rating : normalizeRating(current.rating),
        });
      }

      return getRecord(id);
    },
  };
}

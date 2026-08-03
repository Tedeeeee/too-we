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
  'place_url',
  'place_lat',
  'place_lng',
  'flower_key',
  'visit_entries(author_id,note,rating,created_at)',
  'visit_tags(ordinal,label)',
  'visit_photos(id,ordinal,storage_bucket,storage_path)',
].join(',');

const SUPPORTED_PATCH_KEYS = new Set(['tags', 'text', 'rating', 'flower', 'date']);

const validationError = (cause) => new AppError(ERROR_CODES.validation, { cause });
const notFoundError = (cause) => new AppError(ERROR_CODES.not_found, { cause });

const normalizeDate = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError({ field: 'date' });
  return date.toISOString();
};

const validateRecordId = (recordId) => {
  if (typeof recordId !== 'string' || !recordId.trim()) {
    throw validationError({ field: 'recordId' });
  }
  return recordId.trim();
};

export function createVisitsRepository({ getClient, session, requestKey, now, places }) {
  const getRecords = async () => {
    const userId = await session.ensureUserId();
    const rows = await runQuery(
      getClient().from('visits').select(VISIT_COLUMNS).order('visited_at', { ascending: false }),
    );
    return (rows ?? []).map((row) => mapVisit(row, userId));
  };

  const getRecord = async (recordId) => {
    const id = validateRecordId(recordId);
    const userId = await session.ensureUserId();
    const row = await runQuery(
      getClient().from('visits').select(VISIT_COLUMNS).eq('id', id).maybeSingle(),
    );
    return mapVisit(row, userId);
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
      const recordId = typeof input.recordId === 'string' ? input.recordId.trim() : '';
      const text = normalizeEntryText(input.text);
      const rating = normalizeRating(input.rating);

      if (recordId) {
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

      if (text !== null || rating !== null) {
        await callRpc(getClient(), 'upsert_my_visit_entry', {
          p_visit_id: visitId,
          p_text: text,
          p_rating: rating,
        });
      }

      return getRecord(visitId);
    },

    async setRecordFlower(recordId, flowerKey) {
      const id = validateRecordId(recordId);
      const flower = flowerKey == null ? null : String(flowerKey).trim();
      if (flowerKey != null && !flower) throw validationError({ field: 'flower' });

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

      const current = await getRecord(id);
      if (!current) throw notFoundError({ resource: 'visit' });
      if (keys.length === 0) return current;

      if (Object.hasOwn(patch, 'tags')) {
        await callRpc(getClient(), 'set_visit_tags', {
          p_visit_id: id,
          p_labels: normalizeTags(patch.tags),
        });
      }

      const shared = {};
      if (Object.hasOwn(patch, 'flower')) {
        const flower = patch.flower == null ? null : String(patch.flower).trim();
        if (patch.flower != null && !flower) throw validationError({ field: 'flower' });
        shared.flower_key = flower;
      }
      if (Object.hasOwn(patch, 'date')) shared.visited_at = normalizeDate(patch.date);
      if (Object.keys(shared).length) await updateSharedVisit(id, shared);

      if (Object.hasOwn(patch, 'text') || Object.hasOwn(patch, 'rating')) {
        const myEntry = current.entries.find((entry) => entry.memberId === 'me');
        await callRpc(getClient(), 'upsert_my_visit_entry', {
          p_visit_id: id,
          p_text: Object.hasOwn(patch, 'text') ? normalizeEntryText(patch.text) : (myEntry?.text ?? null),
          p_rating: Object.hasOwn(patch, 'rating') ? normalizeRating(patch.rating) : normalizeRating(current.rating),
        });
      }

      return getRecord(id);
    },
  };
}

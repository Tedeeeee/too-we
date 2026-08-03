import { AppError, ERROR_CODES } from '../errors';
import { callRpc, runQuery } from './rpc';
import { toRepositoryError } from './error-mapping';

export const VISIT_PHOTO_BUCKET = 'visit-photos';
export const VISIT_PHOTO_URL_TTL_SECONDS = 600;

const failedState = (state, error) => ({
  ...state,
  status: 'failed',
  error: toRepositoryError(error),
});

const validationError = (field) => new AppError(ERROR_CODES.validation, { cause: { field } });

const validateRecord = (record) => {
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.id !== 'string' ||
    !record.id.trim() ||
    typeof record.coupleId !== 'string' ||
    !record.coupleId.trim()
  ) {
    throw validationError('record');
  }
  return { id: record.id.trim(), coupleId: record.coupleId.trim() };
};

const isFileLike = (value) =>
  value && typeof value === 'object' && typeof value.size === 'number';

const uploadErrorStatus = (error) => {
  const status = Number(error?.status ?? error?.statusCode ?? error?.originalStatus);
  return Number.isInteger(status) && status > 0 ? status : null;
};

const isUploadOutcomeUnknown = (error) =>
  uploadErrorStatus(error) === null &&
  toRepositoryError(error).code === ERROR_CODES.network;

const safeId = (value) => {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
  return normalized || 'photo';
};

export function createPhotosRepository({
  getClient,
  session,
  requestKey,
  now,
  processPhotoFile,
  newPhotoId,
}) {
  const inFlightUploads = new Map();
  const inFlightDeletes = new Map();

  const normalizeUpload = (input) => {
    const previous = input?.file && typeof input === 'object' ? input : null;
    const source = previous?.file ?? input;
    if (!isFileLike(source)) throw validationError('files');

    const clientId = previous?.clientId || safeId(newPhotoId());
    return {
      clientId,
      file: source,
      status: previous?.status === 'succeeded' ? 'succeeded' : 'pending',
      error: null,
      requestKey: requestKey(previous?.requestKey),
      path: previous?.path ?? null,
      prepared: previous?.prepared ?? null,
      uploadAttempted: previous?.uploadAttempted === true,
      uploadReplayEligible:
        previous?.status === 'failed' &&
        previous?.uploadAttempted === true &&
        previous?.objectUploaded !== true &&
        previous?.uploadReplayEligible === true,
      objectUploaded: previous?.objectUploaded === true,
      photo: previous?.photo ?? null,
    };
  };

  const uploadOne = async (record, initial) => {
    if (initial.status === 'succeeded') return { ...initial };
    let state = { ...initial, status: 'processing', error: null };

    try {
      const userId = await session.ensureUserId();
      const prepared = state.prepared ?? (await processPhotoFile(state.file));
      const path = state.path ?? `${record.coupleId}/${record.id}/${safeId(state.clientId)}.${prepared.extension}`;
      state = { ...state, prepared, path };

      if (!state.objectUploaded) {
        const canReplayConflict = state.uploadReplayEligible;
        state = {
          ...state,
          status: 'uploading',
          uploadAttempted: true,
          uploadReplayEligible: false,
        };
        let upload;
        try {
          upload = await getClient()
            .storage.from(VISIT_PHOTO_BUCKET)
            .upload(path, prepared.blob, {
              cacheControl: '3600',
              contentType: prepared.contentType,
              upsert: false,
            });
        } catch (error) {
          state = { ...state, uploadReplayEligible: isUploadOutcomeUnknown(error) };
          throw error;
        }
        if (upload?.error) {
          const isStablePathReplay =
            canReplayConflict && uploadErrorStatus(upload.error) === 409;
          if (!isStablePathReplay) {
            state = {
              ...state,
              uploadReplayEligible: isUploadOutcomeUnknown(upload.error),
            };
            throw upload.error;
          }
        }
        state = { ...state, objectUploaded: true, uploadReplayEligible: false };
      }

      state = { ...state, status: 'registering' };
      const registered = await callRpc(getClient(), 'register_visit_photo', {
        p_visit_id: record.id,
        p_storage_path: state.path,
        p_metadata: {
          content_type: state.prepared.contentType,
          byte_size: state.prepared.byteSize,
          width: state.prepared.width,
          height: state.prepared.height,
        },
        p_request_key: state.requestKey,
      });
      const photoId = registered.data?.photo_id;
      const ordinal = registered.data?.ordinal;
      if (!photoId || !Number.isInteger(Number(ordinal))) {
        throw new AppError(ERROR_CODES.unknown, { cause: registered });
      }

      return {
        ...state,
        status: 'succeeded',
        error: null,
        photo: {
          id: photoId,
          ordinal: Number(ordinal),
          order: Number(ordinal),
          bucket: VISIT_PHOTO_BUCKET,
          path: state.path,
          uploaderId: userId,
          ownedByMe: true,
        },
      };
    } catch (error) {
      return failedState(state, error);
    }
  };

  const uploadVisitPhotos = async (recordInput, inputs) => {
    const record = validateRecord(recordInput);
    if (!Array.isArray(inputs)) throw validationError('files');
    const attempts = inputs.map(normalizeUpload);

    return Promise.all(
      attempts.map((attempt) => {
        const key = `${record.id}:${attempt.clientId}`;
        const pending = inFlightUploads.get(key);
        if (pending) return pending;
        const next = uploadOne(record, attempt).finally(() => inFlightUploads.delete(key));
        inFlightUploads.set(key, next);
        return next;
      }),
    );
  };

  const attachSignedUrls = async (records) => {
    if (!Array.isArray(records)) throw validationError('records');
    const hasPhotos = records.some((record) => Array.isArray(record?.photos) && record.photos.length);
    if (!hasPhotos) return records.map((record) => ({ ...record, photos: record?.photos ?? [] }));
    await session.ensureUserId();

    const expiresAt = new Date(now().getTime() + VISIT_PHOTO_URL_TTL_SECONDS * 1000).toISOString();
    return Promise.all(
      records.map(async (record) => ({
        ...record,
        photos: await Promise.all(
          (Array.isArray(record?.photos) ? record.photos : []).map(async (photo) => {
            if (
              photo?.bucket !== VISIT_PHOTO_BUCKET ||
              typeof photo.path !== 'string' ||
              !photo.path
            ) {
              throw validationError('photo');
            }
            let result;
            try {
              result = await getClient()
                .storage.from(VISIT_PHOTO_BUCKET)
                .createSignedUrl(photo.path, VISIT_PHOTO_URL_TTL_SECONDS);
            } catch (error) {
              throw toRepositoryError(error);
            }
            if (result?.error) throw toRepositoryError(result.error);
            const url = result?.data?.signedUrl;
            if (!url) throw new AppError(ERROR_CODES.unknown, { cause: result });
            return { ...photo, url, urlExpiresAt: expiresAt };
          }),
        ),
      })),
    );
  };

  const deleteOne = async (photo, previous = {}) => {
    let state = {
      photoId: photo?.id ?? null,
      status: 'deleting',
      error: null,
      objectDeleted: previous?.objectDeleted === true,
    };

    try {
      if (!photo || typeof photo.id !== 'string' || !photo.id) throw validationError('photo');
      if (photo.ownedByMe !== true) throw new AppError(ERROR_CODES.forbidden);
      if (photo.bucket !== VISIT_PHOTO_BUCKET || typeof photo.path !== 'string' || !photo.path) {
        throw validationError('photo');
      }
      await session.ensureUserId();

      if (!state.objectDeleted) {
        const removed = await getClient().storage.from(VISIT_PHOTO_BUCKET).remove([photo.path]);
        if (removed?.error) throw removed.error;
        state = { ...state, objectDeleted: true };
      }

      await runQuery(
        getClient()
          .from('visit_photos')
          .delete()
          .eq('id', photo.id)
          .select('id')
          .maybeSingle(),
      );
      return { ...state, status: 'succeeded', error: null };
    } catch (error) {
      return failedState(state, error);
    }
  };

  const deleteVisitPhoto = (photo, previous) => {
    const key = `delete:${photo?.id ?? 'invalid'}`;
    const pending = inFlightDeletes.get(key);
    if (pending) return pending;
    const next = deleteOne(photo, previous).finally(() => inFlightDeletes.delete(key));
    inFlightDeletes.set(key, next);
    return next;
  };

  return { uploadVisitPhotos, attachSignedUrls, deleteVisitPhoto };
}

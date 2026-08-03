import { useEffect, useMemo, useRef, useState } from 'react';
import { fonts, palette } from '@/styles/tokens';
import { toAppError, userMessage } from '@/data/errors';

const MAX_PHOTOS = 5;

const safeMessage = (error) => userMessage(toAppError(error).code);

const uploadLabel = (attempt) => {
  if (attempt.status === 'succeeded') return '업로드 완료';
  if (attempt.status === 'failed') return safeMessage(attempt.result?.error);
  return '압축·업로드 중…';
};

const uploadFileName = (attempt) => attempt.result?.file?.name || attempt.file?.name || '선택한 사진';

const mergeStoreUploads = (current, incoming) => {
  if (!Array.isArray(incoming) || incoming.length === 0) return current;
  const next = current.slice();
  let changed = false;
  for (const result of incoming) {
    if (!result?.clientId) continue;
    const position = next.findIndex((attempt) => attempt.result?.clientId === result.clientId);
    if (position >= 0) {
      if (next[position].result !== result) {
        next[position] = { ...next[position], status: result.status, result };
        changed = true;
      }
    } else {
      next.push({ uiKey: `store-${result.clientId}`, file: result.file, status: result.status, result });
      changed = true;
    }
  }
  return changed ? next : current;
};

export default function VisitPhotoManager({
  recordId,
  photos = [],
  uploads = [],
  deleteStates = {},
  addPhotos,
  deletePhoto,
  retryDeletePhoto,
  disabled = false,
  label = '사진 추가',
  style,
}) {
  const inputRef = useRef(null);
  const uploadInFlightRef = useRef(false);
  const retryingUploadsRef = useRef(new Set());
  const deletingRef = useRef(new Set());
  const localKeyRef = useRef(0);
  const [attempts, setAttempts] = useState(() => mergeStoreUploads([], uploads));
  const [uploading, setUploading] = useState(false);
  const [limitError, setLimitError] = useState('');
  const [localDeleteStates, setLocalDeleteStates] = useState(deleteStates);
  const [deletedPhotoIds, setDeletedPhotoIds] = useState(() => new Set());

  useEffect(() => setAttempts((current) => mergeStoreUploads(current, uploads)), [uploads]);
  useEffect(() => {
    if (!deleteStates || Object.keys(deleteStates).length === 0) return;
    setLocalDeleteStates((current) => ({ ...current, ...deleteStates }));
  }, [deleteStates]);

  const visiblePhotos = useMemo(
    () => (Array.isArray(photos) ? photos : [])
      .filter((photo) => photo?.id && !deletedPhotoIds.has(photo.id))
      .slice()
      .sort((a, b) => Number(a?.order ?? a?.ordinal ?? 0) - Number(b?.order ?? b?.ordinal ?? 0)),
    [deletedPhotoIds, photos],
  );
  const visiblePhotoIds = new Set(visiblePhotos.map((photo) => photo.id));
  const reservedAttempts = attempts.filter((attempt) => {
    const uploadedPhotoId = attempt.result?.photo?.id;
    return !uploadedPhotoId || !visiblePhotoIds.has(uploadedPhotoId);
  });
  const occupiedCount = Math.min(MAX_PHOTOS, visiblePhotos.length + reservedAttempts.length);

  const replaceAttempt = (uiKey, result) => {
    setAttempts((current) => current.map((attempt) => (
      attempt.uiKey === uiKey
        ? { ...attempt, status: result?.status || 'failed', result: result || { status: 'failed' } }
        : attempt
    )));
  };

  const selectFiles = async (event) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selected.length || uploadInFlightRef.current || typeof addPhotos !== 'function') return;

    const remaining = Math.max(0, MAX_PHOTOS - occupiedCount);
    const accepted = selected.slice(0, remaining);
    setLimitError(selected.length > remaining ? '사진은 방문 기록마다 최대 5장까지 추가할 수 있어요.' : '');
    if (!accepted.length) return;

    const localAttempts = accepted.map((file) => ({
      uiKey: `local-${++localKeyRef.current}`,
      file,
      status: 'processing',
      result: null,
    }));
    setAttempts((current) => [...current, ...localAttempts]);
    uploadInFlightRef.current = true;
    setUploading(true);
    try {
      const results = await addPhotos(recordId, accepted);
      localAttempts.forEach((attempt, index) => replaceAttempt(
        attempt.uiKey,
        results?.[index] || {
          file: attempt.file,
          status: 'failed',
          error: new Error('missing upload result'),
        },
      ));
    } catch (error) {
      localAttempts.forEach((attempt) => replaceAttempt(attempt.uiKey, {
        file: attempt.file,
        status: 'failed',
        error: toAppError(error),
      }));
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
    }
  };

  const retryUpload = async (attempt) => {
    const result = attempt.result;
    if (
      attempt.status !== 'failed'
      || !result
      || retryingUploadsRef.current.has(attempt.uiKey)
      || typeof addPhotos !== 'function'
    ) return;
    retryingUploadsRef.current.add(attempt.uiKey);
    setAttempts((current) => current.map((item) => (
      item.uiKey === attempt.uiKey ? { ...item, status: 'processing' } : item
    )));
    try {
      const [retried] = await addPhotos(recordId, [result]);
      replaceAttempt(attempt.uiKey, retried || { ...result, status: 'failed' });
    } catch (error) {
      replaceAttempt(attempt.uiKey, { ...result, status: 'failed', error: toAppError(error) });
    } finally {
      retryingUploadsRef.current.delete(attempt.uiKey);
    }
  };

  const saveDeleteState = (photoId, result) => {
    setLocalDeleteStates((current) => ({ ...current, [photoId]: result }));
    if (result?.status === 'succeeded') {
      setDeletedPhotoIds((current) => new Set(current).add(photoId));
    }
  };

  const runDelete = async (photo, retry = false) => {
    if (!photo?.ownedByMe || deletingRef.current.has(photo.id)) return;
    const action = retry ? retryDeletePhoto : deletePhoto;
    if (typeof action !== 'function') return;
    deletingRef.current.add(photo.id);
    saveDeleteState(photo.id, { photoId: photo.id, status: 'deleting', error: null });
    try {
      const result = retry
        ? await action(recordId, photo.id)
        : await action(recordId, photo);
      saveDeleteState(photo.id, result);
    } catch (error) {
      saveDeleteState(photo.id, {
        photoId: photo.id,
        status: 'failed',
        error: toAppError(error),
      });
    } finally {
      deletingRef.current.delete(photo.id);
    }
  };

  const galleryItems = visiblePhotos.length + reservedAttempts.length;

  return (
    <div
      style={{
        position: 'absolute',
        borderRadius: 24,
        background: palette.beige,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ position: 'absolute', left: 14, top: 12, fontFamily: fonts.hand, fontSize: 16, color: palette.textMuted }}>
        사진 {occupiedCount}/5
      </div>
      <span style={{ position: 'absolute', right: 18, top: 14, fontFamily: fonts.hand, fontSize: 15, color: palette.textMuted }}>
        {occupiedCount}/5
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        aria-label="사진 추가"
        disabled={disabled || uploading || occupiedCount >= MAX_PHOTOS}
        onChange={selectFiles}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <button
        type="button"
        disabled={disabled || uploading || occupiedCount >= MAX_PHOTOS}
        onClick={() => inputRef.current?.click()}
        style={{
          position: 'absolute',
          left: 14,
          top: 38,
          minWidth: 112,
          height: 40,
          padding: '0 16px',
          background: palette.card,
          borderRadius: 999,
          fontFamily: fonts.sans,
          fontSize: 15,
          fontWeight: 500,
          color: palette.textMuted,
          cursor: 'pointer',
        }}
      >
        {uploading ? '사진 올리는 중…' : label}
      </button>

      {limitError && (
        <p role="alert" style={{ position: 'absolute', left: 138, right: 12, top: 39, margin: 0, fontFamily: fonts.hand, fontSize: 14, lineHeight: 1.3, color: palette.text }}>
          {limitError}
        </p>
      )}

      <div className="sheet-scroll" style={{ position: 'absolute', left: 12, right: 12, top: 86, bottom: 10, display: 'flex', alignItems: 'stretch', gap: 8, overflowX: 'auto' }}>
        {galleryItems === 0 && (
          <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.hand, fontSize: 17, color: palette.textMuted }}>
            아직 올린 사진이 없어요.
          </div>
        )}

        {visiblePhotos.map((photo) => {
          const deleteState = localDeleteStates?.[photo.id];
          const failedDelete = deleteState?.status === 'failed';
          return (
            <div
              key={photo.id}
              aria-label={photo.ownedByMe ? `${photo.id} 사진` : `${photo.id} 사진 (짝궁 업로드, 읽기 전용)`}
              style={{ position: 'relative', width: 104, minWidth: 104, height: '100%', borderRadius: 14, overflow: 'hidden', background: palette.card }}
            >
              {photo.url ? (
                <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.hand, color: palette.textMuted }}>사진</span>
              )}
              {photo.ownedByMe && !deleteState && (
                <button
                  type="button"
                  aria-label={`${photo.id} 사진 삭제`}
                  disabled={disabled}
                  onClick={() => runDelete(photo)}
                  style={{ position: 'absolute', right: 5, top: 5, width: 28, height: 28, borderRadius: '50%', background: palette.card, color: palette.text, fontFamily: fonts.sans, cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
              {deleteState && deleteState.status !== 'succeeded' && (
                <div
                  aria-label={`${photo.id} 사진 상태`}
                  style={{ position: 'absolute', inset: 4, padding: 6, borderRadius: 10, background: 'rgba(255,252,244,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: fonts.hand, fontSize: 13, color: palette.text }}
                >
                  {deleteState.status === 'deleting' ? '삭제 중…' : safeMessage(deleteState.error)}
                  {failedDelete && (
                    <button type="button" aria-label={`${photo.id} 사진 삭제 다시 시도`} onClick={() => runDelete(photo, true)} style={{ marginTop: 5, padding: '4px 7px', borderRadius: 999, background: palette.olive, color: palette.onOlive, fontFamily: fonts.sans, fontSize: 11 }}>
                      다시 시도
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {reservedAttempts.map((attempt) => {
          const fileName = uploadFileName(attempt);
          return (
            <div
              key={attempt.uiKey}
              aria-label={`${fileName} 업로드 상태`}
              style={{ width: 116, minWidth: 116, height: '100%', padding: 10, boxSizing: 'border-box', borderRadius: 14, background: palette.card, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: fonts.hand, fontSize: 14, color: palette.text, overflow: 'hidden' }}
            >
              <span style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: palette.textMuted }}>{fileName}</span>
              <span style={{ marginTop: 6, lineHeight: 1.25 }}>{uploadLabel(attempt)}</span>
              {attempt.status === 'failed' && (
                <button type="button" aria-label={`${fileName} 다시 시도`} disabled={disabled} onClick={() => retryUpload(attempt)} style={{ marginTop: 7, padding: '4px 8px', borderRadius: 999, background: palette.olive, color: palette.onOlive, fontFamily: fonts.sans, fontSize: 11 }}>
                  다시 시도
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

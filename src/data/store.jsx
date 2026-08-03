/**
 * 앱 전역 상태 (mock 데이터 레이어 위의 React Context).
 * 화면은 useApp()으로 상태/액션을 쓰고, 데이터 접근은 전부 api.js를 경유한다.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as api from './api';
import { AppError, ERROR_CODES, toAppError } from './errors';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [couple, setCouple] = useState(null);
  const [records, setRecords] = useState([]);
  const [bootstrapStatus, setBootstrapStatus] = useState('loading');
  const [bootstrapError, setBootstrapError] = useState(null);
  const [photoUploadsByRecord, setPhotoUploadsByRecord] = useState({});
  const [photoDeletesByRecord, setPhotoDeletesByRecord] = useState({});
  const mountedRef = useRef(false);
  const bootstrapAttemptRef = useRef(0);
  const recordsRef = useRef(records);
  const photoUploadsRef = useRef(photoUploadsByRecord);
  const photoDeletesRef = useRef(photoDeletesByRecord);
  const photoUploadInFlightRef = useRef(new Map());
  const photoDeleteInFlightRef = useRef(new Map());

  recordsRef.current = records;
  photoUploadsRef.current = photoUploadsByRecord;
  photoDeletesRef.current = photoDeletesByRecord;

  const bootstrap = useCallback(async () => {
    const attempt = bootstrapAttemptRef.current + 1;
    bootstrapAttemptRef.current = attempt;
    setBootstrapError(null);
    setBootstrapStatus('loading');

    try {
      const [nextCouple, nextRecords] = await Promise.all([
        api.getCouple(),
        api.getRecords(),
      ]);
      if (!mountedRef.current || attempt !== bootstrapAttemptRef.current) return;

      setCouple(nextCouple);
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      setBootstrapStatus('ready');
    } catch (error) {
      if (!mountedRef.current || attempt !== bootstrapAttemptRef.current) return;

      setBootstrapError(toAppError(error));
      setBootstrapStatus('error');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    bootstrap();

    return () => {
      mountedRef.current = false;
      bootstrapAttemptRef.current += 1;
    };
  }, [bootstrap]);

  const retryBootstrap = useCallback(() => bootstrap(), [bootstrap]);

  const refreshRecords = useCallback(async () => {
    const nextRecords = await api.getRecords();
    if (mountedRef.current) {
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
    }
  }, []);

  const recordForPhotoAction = useCallback((recordId) => {
    const record = recordsRef.current.find((item) => item.id === recordId);
    if (!record) throw new AppError(ERROR_CODES.not_found, { cause: { resource: 'visit' } });
    return record;
  }, []);

  const mergePhotoUploads = useCallback((recordId, results) => {
    setPhotoUploadsByRecord((current) => {
      const merged = [...(current[recordId] ?? [])];
      const positionById = new Map(merged.map((item, index) => [item.clientId, index]));
      for (const result of results) {
        const position = positionById.get(result.clientId);
        if (position === undefined) {
          positionById.set(result.clientId, merged.length);
          merged.push(result);
        } else {
          merged[position] = result;
        }
      }
      const next = { ...current, [recordId]: merged };
      photoUploadsRef.current = next;
      return next;
    });
  }, []);

  const runPhotoUploads = useCallback(
    (recordId, inputs) => {
      const pending = photoUploadInFlightRef.current.get(recordId);
      if (pending) return pending;
      const record = recordForPhotoAction(recordId);
      const identity = { id: record.id, coupleId: record.coupleId };
      const operation = (async () => {
        const results = await api.uploadVisitPhotos(identity, inputs);
        mergePhotoUploads(recordId, results);
        if (results.some((result) => result.status === 'succeeded')) await refreshRecords();
        return results;
      })().finally(() => photoUploadInFlightRef.current.delete(recordId));
      photoUploadInFlightRef.current.set(recordId, operation);
      return operation;
    },
    [mergePhotoUploads, recordForPhotoAction, refreshRecords],
  );

  const savePhotoDeleteState = useCallback((recordId, photoId, result) => {
    setPhotoDeletesByRecord((current) => {
      const next = {
        ...current,
        [recordId]: { ...(current[recordId] ?? {}), [photoId]: result },
      };
      photoDeletesRef.current = next;
      return next;
    });
  }, []);

  const runPhotoDelete = useCallback(
    (recordId, photo, previous) => {
      const key = `${recordId}:${photo?.id ?? 'invalid'}`;
      const pending = photoDeleteInFlightRef.current.get(key);
      if (pending) return pending;
      const operation = (async () => {
        const result = await api.deleteVisitPhoto(photo, previous);
        savePhotoDeleteState(recordId, photo.id, result);
        if (result.status === 'succeeded') await refreshRecords();
        return result;
      })().finally(() => photoDeleteInFlightRef.current.delete(key));
      photoDeleteInFlightRef.current.set(key, operation);
      return operation;
    },
    [refreshRecords, savePhotoDeleteState],
  );

  const actions = useMemo(
    () => ({
      async startNewCouple(options) {
        const nextCouple = await api.createCouple(options);
        if (mountedRef.current) setCouple(nextCouple);
      },
      async connectWithCode(code, options) {
        const nextCouple = await api.connectWithCode(code, options);
        if (mountedRef.current) setCouple(nextCouple);
      },
      async setMyName(name) {
        const nextCouple = await api.setMyName(name);
        if (mountedRef.current) setCouple(nextCouple);
      },
      async completeOnboarding() {
        const nextCouple = await api.completeOnboarding();
        if (mountedRef.current) setCouple(nextCouple);
      },
      async reissueCoupleInvite(options) {
        const nextCouple = await api.reissueCoupleInvite(options);
        if (mountedRef.current) setCouple(nextCouple);
      },
      async saveFiveSecondRecord(input) {
        const rec = await api.saveFiveSecondRecord(input);
        await refreshRecords();
        return rec;
      },
      async setRecordFlower(recordId, flowerKey) {
        const rec = await api.setRecordFlower(recordId, flowerKey);
        await refreshRecords();
        return rec;
      },
      async updateRecord(recordId, patch) {
        const rec = await api.updateRecord(recordId, patch);
        await refreshRecords();
        return rec;
      },
      addVisitPhotos(recordId, files) {
        return runPhotoUploads(recordId, files);
      },
      retryVisitPhotoUploads(recordId) {
        const existing = photoUploadsRef.current[recordId] ?? [];
        const failed = existing.filter((upload) => upload.status === 'failed');
        if (!failed.length) {
          if (existing.some((upload) => upload.status === 'succeeded')) {
            return refreshRecords().then(() => existing);
          }
          return Promise.resolve(existing);
        }
        return runPhotoUploads(recordId, failed);
      },
      deleteVisitPhoto(recordId, requestedPhoto) {
        const record = recordForPhotoAction(recordId);
        const photo = record.photos?.find((item) => item.id === requestedPhoto?.id) ?? requestedPhoto;
        const previous = photoDeletesRef.current[recordId]?.[photo?.id];
        return runPhotoDelete(recordId, photo, previous);
      },
      retryDeleteVisitPhoto(recordId, photoId) {
        const record = recordForPhotoAction(recordId);
        const photo = record.photos?.find((item) => item.id === photoId);
        if (!photo) {
          return Promise.reject(
            new AppError(ERROR_CODES.not_found, { cause: { resource: 'photo' } }),
          );
        }
        const previous = photoDeletesRef.current[recordId]?.[photoId];
        return runPhotoDelete(recordId, photo, previous);
      },
    }),
    [recordForPhotoAction, refreshRecords, runPhotoDelete, runPhotoUploads],
  );

  const ready = bootstrapStatus === 'ready';
  const value = useMemo(
    () => ({
      ready,
      couple,
      records,
      bootstrapStatus,
      bootstrapError,
      retryBootstrap,
      photoUploadsByRecord,
      photoDeletesByRecord,
      ...actions,
    }),
    [
      ready,
      couple,
      records,
      bootstrapStatus,
      bootstrapError,
      retryBootstrap,
      photoUploadsByRecord,
      photoDeletesByRecord,
      actions,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp은 AppProvider 안에서만 사용할 수 있어요.');
  return ctx;
}

/** id로 기록 찾기 (없으면 null) */
export function useRecord(recordId) {
  const { records } = useApp();
  return records.find((r) => r.id === recordId) || null;
}

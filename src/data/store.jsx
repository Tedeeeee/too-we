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

const newRequestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const cleanWishlistIntentText = (value) =>
  typeof value === 'string' ? (value.trim() || null) : null;

const cleanWishlistIntentCoordinate = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const wishlistCreateIntentKey = (input) => {
  const place = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const providerIdValue = Object.hasOwn(place, 'providerId')
    ? place.providerId
    : Object.hasOwn(place, 'provider_id')
      ? place.provider_id
      : place.id;
  const providerId = cleanWishlistIntentText(providerIdValue);
  const provider = cleanWishlistIntentText(place.provider) || (providerId ? 'kakao' : 'manual');
  const snapshot = [
    provider,
    providerId,
    cleanWishlistIntentText(place.name),
    cleanWishlistIntentText(place.category),
    cleanWishlistIntentText(place.address),
    cleanWishlistIntentText(place.roadAddress ?? place.road_address),
    cleanWishlistIntentText(place.url),
    cleanWishlistIntentCoordinate(place.lat),
    cleanWishlistIntentCoordinate(place.lng),
  ];
  return `create:${JSON.stringify(snapshot)}`;
};

export function AppProvider({ children }) {
  const [couple, setCouple] = useState(null);
  const [records, setRecords] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [wishlistStatus, setWishlistStatus] = useState('loading');
  const [wishlistError, setWishlistError] = useState(null);
  const [bootstrapStatus, setBootstrapStatus] = useState('loading');
  const [bootstrapError, setBootstrapError] = useState(null);
  const [photoUploadsByRecord, setPhotoUploadsByRecord] = useState({});
  const [photoDeletesByRecord, setPhotoDeletesByRecord] = useState({});
  const mountedRef = useRef(false);
  const bootstrapAttemptRef = useRef(0);
  const recordsAttemptRef = useRef(0);
  const wishlistAttemptRef = useRef(0);
  const sharedDataEpochRef = useRef(0);
  const successfulBootstrapRef = useRef(false);
  const coupleRef = useRef(couple);
  const recordsRef = useRef(records);
  const wishlistRef = useRef(wishlist);
  const photoUploadsRef = useRef(photoUploadsByRecord);
  const photoDeletesRef = useRef(photoDeletesByRecord);
  const photoUploadInFlightRef = useRef(new Map());
  const photoDeleteInFlightRef = useRef(new Map());
  const wishlistMutationInFlightRef = useRef(new Map());
  const profileMutationInFlightRef = useRef(null);
  const disconnectInFlightRef = useRef(null);
  const disconnectRetryOptionsRef = useRef(null);

  recordsRef.current = records;
  wishlistRef.current = wishlist;
  photoUploadsRef.current = photoUploadsByRecord;
  photoDeletesRef.current = photoDeletesByRecord;

  const commitCouple = useCallback((nextCouple) => {
    coupleRef.current = nextCouple;
    setCouple(nextCouple);
  }, []);

  const advanceSharedDataEpoch = useCallback(() => {
    sharedDataEpochRef.current += 1;
    wishlistMutationInFlightRef.current.clear();
    photoUploadInFlightRef.current.clear();
    photoDeleteInFlightRef.current.clear();
    profileMutationInFlightRef.current = null;
    disconnectInFlightRef.current = null;
    disconnectRetryOptionsRef.current = null;
    return sharedDataEpochRef.current;
  }, []);

  const clearSharedData = useCallback((nextWishlistStatus = 'ready') => {
    recordsRef.current = [];
    wishlistRef.current = [];
    photoUploadsRef.current = {};
    photoDeletesRef.current = {};
    setRecords([]);
    setWishlist([]);
    setWishlistStatus(nextWishlistStatus);
    setWishlistError(null);
    setPhotoUploadsByRecord({});
    setPhotoDeletesByRecord({});
  }, []);

  const refreshWishlist = useCallback(async (expectedEpoch = sharedDataEpochRef.current) => {
    const attempt = wishlistAttemptRef.current + 1;
    wishlistAttemptRef.current = attempt;
    if (mountedRef.current && expectedEpoch === sharedDataEpochRef.current) {
      setWishlistStatus('loading');
      setWishlistError(null);
    }

    try {
      const nextWishlist = await api.getWishlist();
      if (
        mountedRef.current &&
        attempt === wishlistAttemptRef.current &&
        expectedEpoch === sharedDataEpochRef.current
      ) {
        wishlistRef.current = nextWishlist;
        setWishlist(nextWishlist);
        setWishlistStatus('ready');
      }
      return nextWishlist;
    } catch (error) {
      const appError = toAppError(error);
      if (
        mountedRef.current &&
        attempt === wishlistAttemptRef.current &&
        expectedEpoch === sharedDataEpochRef.current
      ) {
        setWishlistError(appError);
        setWishlistStatus('error');
      }
      throw appError;
    }
  }, []);

  const bootstrap = useCallback(async () => {
    const attempt = bootstrapAttemptRef.current + 1;
    const recordsAttempt = recordsAttemptRef.current + 1;
    const epoch = sharedDataEpochRef.current;
    bootstrapAttemptRef.current = attempt;
    recordsAttemptRef.current = recordsAttempt;
    setBootstrapError(null);
    setBootstrapStatus('loading');

    try {
      const [nextCouple, nextRecords] = await Promise.all([
        api.getCouple(),
        api.getRecords(),
      ]);
      if (
        !mountedRef.current ||
        attempt !== bootstrapAttemptRef.current ||
        epoch !== sharedDataEpochRef.current
      ) return;

      const previousCoupleId = coupleRef.current?.coupleId ?? null;
      const nextCoupleId = nextCouple?.coupleId ?? null;
      const coupleChanged =
        successfulBootstrapRef.current && previousCoupleId !== nextCoupleId;
      let activeEpoch = epoch;

      if (!nextCoupleId || coupleChanged) {
        activeEpoch = advanceSharedDataEpoch();
        clearSharedData(nextCoupleId ? 'loading' : 'ready');
      }

      successfulBootstrapRef.current = true;
      commitCouple(nextCouple);
      if (nextCoupleId && recordsAttempt === recordsAttemptRef.current) {
        recordsRef.current = nextRecords;
        setRecords(nextRecords);
      }
      setBootstrapStatus('ready');

      if (coupleChanged && nextCoupleId) {
        refreshWishlist(activeEpoch).catch(() => {});
      }
    } catch (error) {
      if (
        !mountedRef.current ||
        attempt !== bootstrapAttemptRef.current ||
        epoch !== sharedDataEpochRef.current
      ) return;

      setBootstrapError(toAppError(error));
      setBootstrapStatus('error');
    }
  }, [advanceSharedDataEpoch, clearSharedData, commitCouple, refreshWishlist]);

  useEffect(() => {
    mountedRef.current = true;
    bootstrap();
    refreshWishlist().catch(() => {});

    return () => {
      mountedRef.current = false;
      bootstrapAttemptRef.current += 1;
      recordsAttemptRef.current += 1;
      wishlistAttemptRef.current += 1;
      sharedDataEpochRef.current += 1;
    };
  }, [bootstrap, refreshWishlist]);

  const retryBootstrap = useCallback(() => bootstrap(), [bootstrap]);
  const retryWishlist = useCallback(() => refreshWishlist(), [refreshWishlist]);

  const refreshRecords = useCallback(async (expectedEpoch = sharedDataEpochRef.current) => {
    if (!mountedRef.current || expectedEpoch !== sharedDataEpochRef.current) {
      return recordsRef.current;
    }
    const attempt = recordsAttemptRef.current + 1;
    recordsAttemptRef.current = attempt;
    const nextRecords = await api.getRecords();
    if (
      mountedRef.current &&
      attempt === recordsAttemptRef.current &&
      expectedEpoch === sharedDataEpochRef.current
    ) {
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
    }
    return nextRecords;
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
      const epoch = sharedDataEpochRef.current;
      const operation = (async () => {
        const results = await api.uploadVisitPhotos(identity, inputs);
        if (epoch === sharedDataEpochRef.current) {
          mergePhotoUploads(recordId, results);
          if (results.some((result) => result.status === 'succeeded')) {
            await refreshRecords(epoch);
          }
        }
        return results;
      })().finally(() => {
        if (photoUploadInFlightRef.current.get(recordId) === operation) {
          photoUploadInFlightRef.current.delete(recordId);
        }
      });
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
      const epoch = sharedDataEpochRef.current;
      const operation = (async () => {
        const result = await api.deleteVisitPhoto(photo, previous);
        if (epoch === sharedDataEpochRef.current) {
          savePhotoDeleteState(recordId, photo.id, result);
          if (result.status === 'succeeded') await refreshRecords(epoch);
        }
        return result;
      })().finally(() => {
        if (photoDeleteInFlightRef.current.get(key) === operation) {
          photoDeleteInFlightRef.current.delete(key);
        }
      });
      photoDeleteInFlightRef.current.set(key, operation);
      return operation;
    },
    [refreshRecords, savePhotoDeleteState],
  );

  const runMyNameUpdate = useCallback((name) => {
    const pending = profileMutationInFlightRef.current;
    if (pending) return pending;
    const epoch = sharedDataEpochRef.current;

    const operation = (async () => {
      const nextCouple = await api.setMyName(name);
      if (mountedRef.current && epoch === sharedDataEpochRef.current) commitCouple(nextCouple);
      return nextCouple;
    })().finally(() => {
      if (profileMutationInFlightRef.current === operation) {
        profileMutationInFlightRef.current = null;
      }
    });
    profileMutationInFlightRef.current = operation;
    return operation;
  }, [commitCouple]);

  const runWishlistMutation = useCallback(
    (key, mutation) => {
      const pending = wishlistMutationInFlightRef.current.get(key);
      if (pending) return pending;
      const epoch = sharedDataEpochRef.current;

      const operation = (async () => {
        try {
          const result = await mutation();
          if (epoch === sharedDataEpochRef.current) await refreshWishlist(epoch);
          return result;
        } catch (error) {
          const appError = toAppError(error);
          if (mountedRef.current && epoch === sharedDataEpochRef.current) {
            setWishlistError(appError);
            setWishlistStatus('error');
          }
          throw appError;
        }
      })().finally(() => {
        if (wishlistMutationInFlightRef.current.get(key) === operation) {
          wishlistMutationInFlightRef.current.delete(key);
        }
      });
      wishlistMutationInFlightRef.current.set(key, operation);
      return operation;
    },
    [refreshWishlist],
  );

  const runDisconnect = useCallback((options) => {
    const pending = disconnectInFlightRef.current;
    if (pending) return pending;
    const epoch = sharedDataEpochRef.current;

    const callerKey =
      options && typeof options === 'object' && typeof options.requestKey === 'string'
        ? options.requestKey.trim()
        : '';
    const safeOptions = callerKey
      ? options
      : (disconnectRetryOptionsRef.current ?? Object.freeze({ requestKey: newRequestKey() }));
    disconnectRetryOptionsRef.current = safeOptions;

    const operation = (async () => {
      try {
        const result = await api.disconnectCouple(safeOptions);
        if (mountedRef.current && epoch === sharedDataEpochRef.current) {
          advanceSharedDataEpoch();
          bootstrapAttemptRef.current += 1;
          commitCouple(null);
          clearSharedData();
          setBootstrapStatus('ready');
          setBootstrapError(null);
        }
        if (disconnectInFlightRef.current === operation) {
          disconnectRetryOptionsRef.current = null;
        }
        return result;
      } catch (error) {
        throw toAppError(error);
      }
    })().finally(() => {
      if (disconnectInFlightRef.current === operation) disconnectInFlightRef.current = null;
    });
    disconnectInFlightRef.current = operation;
    return operation;
  }, [advanceSharedDataEpoch, clearSharedData, commitCouple]);

  const actions = useMemo(
    () => ({
      async startNewCouple(options) {
        const epoch = sharedDataEpochRef.current;
        const nextCouple = await api.createCouple(options);
        if (mountedRef.current && epoch === sharedDataEpochRef.current) commitCouple(nextCouple);
      },
      async connectWithCode(code, options) {
        const epoch = sharedDataEpochRef.current;
        const nextCouple = await api.connectWithCode(code, options);
        if (mountedRef.current && epoch === sharedDataEpochRef.current) commitCouple(nextCouple);
      },
      setMyName(name) {
        return runMyNameUpdate(name);
      },
      async completeOnboarding() {
        const epoch = sharedDataEpochRef.current;
        const nextCouple = await api.completeOnboarding();
        if (mountedRef.current && epoch === sharedDataEpochRef.current) commitCouple(nextCouple);
      },
      async reissueCoupleInvite(options) {
        const epoch = sharedDataEpochRef.current;
        const nextCouple = await api.reissueCoupleInvite(options);
        if (mountedRef.current && epoch === sharedDataEpochRef.current) commitCouple(nextCouple);
      },
      async saveFiveSecondRecord(input) {
        const epoch = sharedDataEpochRef.current;
        const rec = await api.saveFiveSecondRecord(input);
        await refreshRecords(epoch);
        return rec;
      },
      async setRecordFlower(recordId, flowerKey) {
        const epoch = sharedDataEpochRef.current;
        const rec = await api.setRecordFlower(recordId, flowerKey);
        await refreshRecords(epoch);
        return rec;
      },
      async updateRecord(recordId, patch) {
        const epoch = sharedDataEpochRef.current;
        const rec = await api.updateRecord(recordId, patch);
        await refreshRecords(epoch);
        return rec;
      },
      createWishlistPlace(input) {
        return runWishlistMutation(
          wishlistCreateIntentKey(input),
          () => api.createWishlistPlace(input),
        );
      },
      updateWishlistPlace(wishlistId, input) {
        return runWishlistMutation(
          `update:${wishlistId}`,
          () => api.updateWishlistPlace(wishlistId, input),
        );
      },
      deleteWishlistPlace(wishlistId) {
        return runWishlistMutation(
          `delete:${wishlistId}`,
          () => api.deleteWishlistPlace(wishlistId),
        );
      },
      disconnectCouple(options) {
        return runDisconnect(options);
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
    [
      recordForPhotoAction,
      commitCouple,
      refreshRecords,
      runDisconnect,
      runMyNameUpdate,
      runPhotoDelete,
      runPhotoUploads,
      runWishlistMutation,
    ],
  );

  const ready = bootstrapStatus === 'ready';
  const value = useMemo(
    () => ({
      ready,
      couple,
      records,
      wishlist,
      wishlistStatus,
      wishlistError,
      bootstrapStatus,
      bootstrapError,
      retryBootstrap,
      retryWishlist,
      photoUploadsByRecord,
      photoDeletesByRecord,
      ...actions,
    }),
    [
      ready,
      couple,
      records,
      wishlist,
      wishlistStatus,
      wishlistError,
      bootstrapStatus,
      bootstrapError,
      retryBootstrap,
      retryWishlist,
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

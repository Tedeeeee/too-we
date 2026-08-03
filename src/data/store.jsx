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
import { toAppError } from './errors';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [couple, setCouple] = useState(null);
  const [records, setRecords] = useState([]);
  const [bootstrapStatus, setBootstrapStatus] = useState('loading');
  const [bootstrapError, setBootstrapError] = useState(null);
  const mountedRef = useRef(false);
  const bootstrapAttemptRef = useRef(0);

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
    if (mountedRef.current) setRecords(nextRecords);
  }, []);

  const actions = useMemo(
    () => ({
      async startNewCouple() {
        const nextCouple = await api.createCouple();
        if (mountedRef.current) setCouple(nextCouple);
      },
      async connectWithCode(code) {
        const nextCouple = await api.connectWithCode(code);
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
    }),
    [refreshRecords],
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
      ...actions,
    }),
    [
      ready,
      couple,
      records,
      bootstrapStatus,
      bootstrapError,
      retryBootstrap,
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

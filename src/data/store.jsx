/**
 * 앱 전역 상태 (mock 데이터 레이어 위의 React Context).
 * 화면은 useApp()으로 상태/액션을 쓰고, 데이터 접근은 전부 api.js를 경유한다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from './api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [couple, setCouple] = useState(null);
  const [records, setRecords] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([api.getCouple(), api.getRecords()]).then(([c, r]) => {
      setCouple(c);
      setRecords(r);
      setReady(true);
    });
  }, []);

  const refreshRecords = useCallback(async () => {
    setRecords(await api.getRecords());
  }, []);

  const actions = useMemo(
    () => ({
      async startNewCouple() {
        setCouple(await api.createCouple());
      },
      async connectWithCode(code) {
        setCouple(await api.connectWithCode(code));
      },
      async setMyName(name) {
        setCouple(await api.setMyName(name));
      },
      async completeOnboarding() {
        setCouple(await api.completeOnboarding());
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

  const value = useMemo(
    () => ({ ready, couple, records, ...actions }),
    [ready, couple, records, actions],
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

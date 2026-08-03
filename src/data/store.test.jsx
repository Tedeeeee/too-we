import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from './errors';
import { AppProvider, useApp } from './store';
import * as api from './api';

vi.mock('./api', () => ({
  getCouple: vi.fn(),
  getRecords: vi.fn(),
  createCouple: vi.fn(),
  reissueCoupleInvite: vi.fn(),
  connectWithCode: vi.fn(),
  setMyName: vi.fn(),
  completeOnboarding: vi.fn(),
  saveFiveSecondRecord: vi.fn(),
  setRecordFlower: vi.fn(),
  updateRecord: vi.fn(),
}));

const NO_COUPLE = {
  coupleId: null,
  connected: false,
  onboarded: false,
  inviteCode: '',
  me: { id: 'me', userId: 'anon-1', name: '' },
  partner: { id: 'partner', userId: null, name: '' },
};

const RESTORED_COUPLE = {
  ...NO_COUPLE,
  coupleId: 'couple-1',
  connected: true,
  onboarded: true,
  me: { id: 'me', userId: 'anon-1', name: '지은' },
  partner: { id: 'partner', userId: 'anon-2', name: '민수' },
};

const RESTORED_RECORDS = [{ id: 'record-1', placeName: '성수동 공원' }];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

let appState;

function StateProbe() {
  appState = useApp();
  return null;
}

function renderProvider() {
  return render(
    <AppProvider>
      <StateProbe />
    </AppProvider>,
  );
}

beforeEach(() => {
  appState = undefined;
  vi.resetAllMocks();
});

describe('AppProvider bootstrap', () => {
  it('첫 실행에는 데이터를 만들지 않고 명시적인 로딩 상태를 노출한다', () => {
    api.getCouple.mockReturnValue(deferred().promise);
    api.getRecords.mockReturnValue(deferred().promise);

    renderProvider();

    expect(appState).toMatchObject({
      ready: false,
      couple: null,
      records: [],
      bootstrapStatus: 'loading',
      bootstrapError: null,
    });
    expect(api.getCouple).toHaveBeenCalledTimes(1);
    expect(api.getRecords).toHaveBeenCalledTimes(1);
  });

  it('복원된 익명 사용자와 커플 및 기록을 한 번의 준비 단계로 공개한다', async () => {
    api.getCouple.mockResolvedValue(RESTORED_COUPLE);
    api.getRecords.mockResolvedValue(RESTORED_RECORDS);

    renderProvider();

    await waitFor(() => expect(appState.ready).toBe(true));
    expect(appState).toMatchObject({
      bootstrapStatus: 'ready',
      bootstrapError: null,
      couple: RESTORED_COUPLE,
      records: RESTORED_RECORDS,
    });
  });

  it('활성 커플이 없는 복원 결과도 그대로 준비 완료 상태로 보존한다', async () => {
    api.getCouple.mockResolvedValue(NO_COUPLE);
    api.getRecords.mockResolvedValue([]);

    renderProvider();

    await waitFor(() => expect(appState.ready).toBe(true));
    expect(appState.couple).toEqual(NO_COUPLE);
    expect(appState.records).toEqual([]);
  });

  it('재시도는 bootstrap 오류만 지우고 같은 API 조회를 다시 수행해 복구한다', async () => {
    const networkError = new AppError(ERROR_CODES.network);
    api.getCouple
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(RESTORED_COUPLE);
    api.getRecords.mockResolvedValue(RESTORED_RECORDS);

    renderProvider();

    await waitFor(() => expect(appState.bootstrapStatus).toBe('error'));
    expect(appState.bootstrapError).toBe(networkError);
    expect(appState.ready).toBe(false);

    await act(async () => {
      await appState.retryBootstrap();
    });

    expect(appState).toMatchObject({
      ready: true,
      bootstrapStatus: 'ready',
      bootstrapError: null,
      couple: RESTORED_COUPLE,
      records: RESTORED_RECORDS,
    });
    expect(api.getCouple).toHaveBeenCalledTimes(2);
    expect(api.getRecords).toHaveBeenCalledTimes(2);
  });

  it('느리게 끝난 이전 bootstrap 시도가 더 새 복원 결과를 덮어쓰지 않는다', async () => {
    const oldCouple = deferred();
    const oldRecords = deferred();
    const newerCouple = { ...RESTORED_COUPLE, coupleId: 'couple-newer' };
    const newerRecords = [{ id: 'record-newer' }];
    api.getCouple
      .mockReturnValueOnce(oldCouple.promise)
      .mockResolvedValueOnce(newerCouple);
    api.getRecords
      .mockReturnValueOnce(oldRecords.promise)
      .mockResolvedValueOnce(newerRecords);

    renderProvider();
    await waitFor(() => expect(api.getCouple).toHaveBeenCalledTimes(1));

    await act(async () => {
      await appState.retryBootstrap();
    });
    expect(appState.couple).toEqual(newerCouple);
    expect(appState.records).toEqual(newerRecords);

    await act(async () => {
      oldCouple.resolve({ ...RESTORED_COUPLE, coupleId: 'couple-stale' });
      oldRecords.resolve([{ id: 'record-stale' }]);
      await oldCouple.promise;
      await oldRecords.promise;
    });

    expect(appState.couple).toEqual(newerCouple);
    expect(appState.records).toEqual(newerRecords);
    expect(appState.bootstrapStatus).toBe('ready');
  });
});

describe('AppProvider actions', () => {
  async function renderReadyProvider() {
    api.getCouple.mockResolvedValue(RESTORED_COUPLE);
    api.getRecords.mockResolvedValue(RESTORED_RECORDS);
    renderProvider();
    await waitFor(() => expect(appState.ready).toBe(true));
  }

  it('커플 action이 실패하면 마지막으로 성공한 커플 상태를 유지한다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    api.setMyName.mockRejectedValue(networkError);

    await expect(appState.setMyName('새 이름')).rejects.toBe(networkError);

    expect(appState.couple).toEqual(RESTORED_COUPLE);
  });

  it('기록 저장 뒤 새 목록 조회가 실패해도 이전 기록을 비우거나 바꾸지 않는다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    api.saveFiveSecondRecord.mockResolvedValue({ id: 'record-2' });
    api.getRecords.mockRejectedValueOnce(networkError);

    await expect(appState.saveFiveSecondRecord({ place: { name: '새 장소' } })).rejects.toBe(
      networkError,
    );

    expect(appState.records).toEqual(RESTORED_RECORDS);
  });

  it('승인된 초대 재발급 facade를 action으로 노출하고 성공 결과만 반영한다', async () => {
    await renderReadyProvider();
    const reissued = { ...RESTORED_COUPLE, inviteCode: '731904' };
    api.reissueCoupleInvite.mockResolvedValue(reissued);

    await act(async () => {
      await appState.reissueCoupleInvite({ requestKey: 'retry-invite-1' });
    });

    expect(api.reissueCoupleInvite).toHaveBeenCalledWith({ requestKey: 'retry-invite-1' });
    expect(appState.couple).toEqual(reissued);
  });
});

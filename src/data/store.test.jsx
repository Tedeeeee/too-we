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
  uploadVisitPhotos: vi.fn(),
  deleteVisitPhoto: vi.fn(),
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
  async function renderReadyProvider(restoredRecords = RESTORED_RECORDS) {
    api.getCouple.mockResolvedValue(RESTORED_COUPLE);
    api.getRecords.mockResolvedValue(restoredRecords);
    renderProvider();
    await waitFor(() => expect(appState.ready).toBe(true));
  }

  it('커플 생성 실패 시 같은 options 객체를 facade에 전달하고 기존 상태를 유지한다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    const options = Object.freeze({ requestKey: 'create-couple-attempt-1' });
    api.createCouple.mockRejectedValue(networkError);

    await expect(appState.startNewCouple(options)).rejects.toBe(networkError);

    expect(api.createCouple.mock.calls[0][0]).toBe(options);
    expect(appState.couple).toEqual(RESTORED_COUPLE);
  });

  it('초대 연결 실패 시 코드와 같은 options 객체를 facade에 전달하고 기존 상태를 유지한다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    const options = Object.freeze({ requestKey: 'join-couple-attempt-1' });
    api.connectWithCode.mockRejectedValue(networkError);

    await expect(appState.connectWithCode('731904', options)).rejects.toBe(networkError);

    expect(api.connectWithCode.mock.calls[0]).toEqual(['731904', options]);
    expect(api.connectWithCode.mock.calls[0][1]).toBe(options);
    expect(appState.couple).toEqual(RESTORED_COUPLE);
  });

  it('커플 action이 실패하면 마지막으로 성공한 커플 상태를 유지한다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    api.setMyName.mockRejectedValue(networkError);

    await expect(appState.setMyName('새 이름')).rejects.toBe(networkError);

    expect(appState.couple).toEqual(RESTORED_COUPLE);
  });

  it('불확실한 기록 쓰기 실패는 이전 목록을 보존하고 같은 입력·키 재시도로 수렴한다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    const input = Object.freeze({
      place: Object.freeze({ id: 'kakao-2', name: '새 장소', provider: 'kakao' }),
      date: '2026-05-04T10:00:00Z',
      requestKey: 'visit-intent-write-retry',
    });
    const convergedRecords = [...RESTORED_RECORDS, { id: 'record-2', pending: true }];
    api.saveFiveSecondRecord
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ id: 'record-2' });

    await expect(appState.saveFiveSecondRecord(input)).rejects.toBe(networkError);

    expect(appState.records).toEqual(RESTORED_RECORDS);
    expect(api.getRecords).toHaveBeenCalledTimes(1);

    api.getRecords.mockResolvedValue(convergedRecords);
    await act(async () => {
      await appState.saveFiveSecondRecord(input);
    });

    expect(api.saveFiveSecondRecord).toHaveBeenNthCalledWith(1, input);
    expect(api.saveFiveSecondRecord).toHaveBeenNthCalledWith(2, input);
    expect(appState.records).toEqual(convergedRecords);
  });

  it('기존 기록 수정 쓰기가 실패하면 refresh하지 않고 마지막 목록을 보존한다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    const patch = Object.freeze({
      text: '  다시 쓴 한 줄  ',
      rating: 5,
      tags: Object.freeze(['# 데이트']),
    });
    api.updateRecord.mockRejectedValue(networkError);

    await expect(appState.updateRecord('record-1', patch)).rejects.toBe(networkError);

    expect(api.updateRecord).toHaveBeenCalledWith('record-1', patch);
    expect(api.getRecords).toHaveBeenCalledTimes(1);
    expect(appState.records).toEqual(RESTORED_RECORDS);
  });

  it('기존 기록 수정이 성공한 뒤에만 서버 목록을 다시 불러온다', async () => {
    await renderReadyProvider();
    const patch = Object.freeze({ place: Object.freeze({ name: '새 장소' }) });
    const latestRecords = [{ id: 'record-1', placeName: '새 장소' }];
    api.updateRecord.mockResolvedValue({ id: 'record-1' });
    api.getRecords.mockResolvedValue(latestRecords);

    await act(async () => {
      await appState.updateRecord('record-1', patch);
    });

    expect(api.updateRecord).toHaveBeenCalledWith('record-1', patch);
    expect(api.getRecords).toHaveBeenCalledTimes(2);
    expect(appState.records).toEqual(latestRecords);
  });

  it('기록 저장 뒤 새 목록 조회 실패도 이전 목록을 보존하고 같은 입력·키 재시도로 수렴한다', async () => {
    await renderReadyProvider();
    const networkError = new AppError(ERROR_CODES.network);
    const input = Object.freeze({
      place: Object.freeze({ id: 'kakao-2', name: '새 장소', provider: 'kakao' }),
      date: '2026-05-04T10:00:00Z',
      requestKey: 'visit-intent-refresh-retry',
    });
    const convergedRecords = [...RESTORED_RECORDS, { id: 'record-2', pending: true }];
    api.saveFiveSecondRecord.mockResolvedValue({ id: 'record-2' });
    api.getRecords.mockRejectedValueOnce(networkError);

    await expect(appState.saveFiveSecondRecord(input)).rejects.toBe(networkError);

    expect(appState.records).toEqual(RESTORED_RECORDS);

    api.getRecords.mockResolvedValue(convergedRecords);
    await act(async () => {
      await appState.saveFiveSecondRecord(input);
    });

    expect(api.saveFiveSecondRecord).toHaveBeenNthCalledWith(1, input);
    expect(api.saveFiveSecondRecord).toHaveBeenNthCalledWith(2, input);
    expect(appState.records).toEqual(convergedRecords);
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

  it('여러 사진 중 성공과 실패를 함께 보존하고 재시도 때 실패한 파일만 보낸다', async () => {
    const record = { id: 'record-1', coupleId: 'couple-1', photos: [] };
    await renderReadyProvider([record]);
    const firstFile = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const secondFile = new File(['b'], 'b.jpg', { type: 'image/jpeg' });
    const files = Object.freeze([firstFile, secondFile]);
    const succeeded = {
      clientId: 'upload-a',
      file: firstFile,
      status: 'succeeded',
      photo: { id: 'photo-a' },
    };
    const failed = {
      clientId: 'upload-b',
      file: secondFile,
      status: 'failed',
      objectUploaded: true,
      requestKey: 'stable-b',
      path: 'couple-1/record-1/b.webp',
      error: new AppError(ERROR_CODES.network),
    };
    const retried = { ...failed, status: 'succeeded', error: null, photo: { id: 'photo-b' } };
    api.uploadVisitPhotos
      .mockResolvedValueOnce([succeeded, failed])
      .mockResolvedValueOnce([retried]);
    api.getRecords.mockResolvedValue([record]);

    await act(async () => {
      await appState.addVisitPhotos('record-1', files);
    });

    expect(api.uploadVisitPhotos).toHaveBeenNthCalledWith(
      1,
      { id: 'record-1', coupleId: 'couple-1' },
      files,
    );
    expect(appState.photoUploadsByRecord['record-1']).toEqual([succeeded, failed]);

    await act(async () => {
      await appState.retryVisitPhotoUploads('record-1');
    });

    expect(api.uploadVisitPhotos).toHaveBeenNthCalledWith(
      2,
      { id: 'record-1', coupleId: 'couple-1' },
      [failed],
    );
    expect(appState.photoUploadsByRecord['record-1']).toEqual([succeeded, retried]);
  });

  it('사진 추가 버튼을 동시에 두 번 눌러도 같은 in-flight 작업만 수행한다', async () => {
    const record = { id: 'record-1', coupleId: 'couple-1', photos: [] };
    await renderReadyProvider([record]);
    const pending = deferred();
    const source = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const files = Object.freeze([source]);
    const failed = [{
      clientId: 'upload-a',
      file: source,
      status: 'failed',
      error: new AppError(ERROR_CODES.network),
    }];
    api.uploadVisitPhotos.mockReturnValue(pending.promise);

    let first;
    let second;
    await act(async () => {
      first = appState.addVisitPhotos('record-1', files);
      second = appState.addVisitPhotos('record-1', files);
      pending.resolve(failed);
      await Promise.all([first, second]);
    });

    expect(api.uploadVisitPhotos).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(failed);
    await expect(second).resolves.toBe(failed);
    expect(appState.photoUploadsByRecord['record-1']).toEqual(failed);
  });

  it('업로드 성공 뒤 signed record 새로고침이 실패해도 성공 상태를 재업로드하지 않는다', async () => {
    const record = { id: 'record-1', coupleId: 'couple-1', photos: [] };
    await renderReadyProvider([record]);
    const source = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const succeeded = [{
      clientId: 'upload-a',
      file: source,
      status: 'succeeded',
      photo: { id: 'photo-a' },
    }];
    const networkError = new AppError(ERROR_CODES.network);
    api.uploadVisitPhotos.mockResolvedValue(succeeded);
    api.getRecords.mockRejectedValueOnce(networkError);

    let caught;
    await act(async () => {
      caught = await appState.addVisitPhotos('record-1', [source]).catch((error) => error);
    });

    expect(caught).toBe(networkError);
    expect(appState.photoUploadsByRecord['record-1']).toEqual(succeeded);
    const refreshed = [{ ...record, photos: [{ id: 'photo-a', url: 'https://signed.invalid/a' }] }];
    api.getRecords.mockResolvedValue(refreshed);
    await act(async () => {
      await expect(appState.retryVisitPhotoUploads('record-1')).resolves.toEqual(succeeded);
    });
    expect(api.uploadVisitPhotos).toHaveBeenCalledTimes(1);
    expect(api.getRecords).toHaveBeenCalledTimes(3);
    expect(appState.records).toEqual(refreshed);
  });

  it('삭제 실패 단계와 object 삭제 여부를 보존하고 재시도에 그대로 전달한다', async () => {
    const photo = {
      id: 'photo-a',
      bucket: 'visit-photos',
      path: 'couple-1/record-1/a.webp',
      ownedByMe: true,
    };
    const record = { id: 'record-1', coupleId: 'couple-1', photos: [photo] };
    await renderReadyProvider([record]);
    const failed = {
      photoId: 'photo-a',
      status: 'failed',
      objectDeleted: true,
      error: new AppError(ERROR_CODES.network),
    };
    const succeeded = { ...failed, status: 'succeeded', error: null };
    api.deleteVisitPhoto
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(succeeded);
    api.getRecords.mockResolvedValue([{ ...record, photos: [] }]);

    await act(async () => {
      await appState.deleteVisitPhoto('record-1', photo);
    });

    expect(appState.photoDeletesByRecord['record-1']['photo-a']).toEqual(failed);

    await act(async () => {
      await appState.retryDeleteVisitPhoto('record-1', 'photo-a');
    });

    expect(api.deleteVisitPhoto).toHaveBeenNthCalledWith(1, photo, undefined);
    expect(api.deleteVisitPhoto).toHaveBeenNthCalledWith(2, photo, failed);
    expect(appState.photoDeletesByRecord['record-1']['photo-a']).toEqual(succeeded);
    expect(appState.records[0].photos).toEqual([]);
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp, useRecord } from '@/data/store';
import RecordNew from './RecordNew';

vi.mock('@/data/store', () => ({ useApp: vi.fn(), useRecord: vi.fn() }));

const PLACE = Object.freeze({
  id: '28720295',
  name: '블루보틀 성수 카페',
  category: '음식점 > 카페',
  address: '서울 성동구 성수동1가 656-439',
  roadAddress: '서울 성동구 아차산로 7',
  phone: '02-6212-6998',
  url: 'https://place.map.kakao.com/28720295',
  lat: 37.5446137523921,
  lng: 127.055978290073,
  provider: 'kakao',
});

let destinationLocation;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Destination() {
  destinationLocation = useLocation();
  return <div>목적지 화면</div>;
}

function renderRecord(state, saveFiveSecondRecord = vi.fn()) {
  useApp.mockReturnValue({ saveFiveSecondRecord });

  return render(
    <MemoryRouter initialEntries={[{ pathname: '/record', state }]}>
      <Routes>
        <Route path="/record" element={<RecordNew />} />
        <Route path="/map" element={<Destination />} />
        <Route path="/pick" element={<Destination />} />
        <Route path="/" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setVisitIntent(date = '2026-08-05', time = '14:35') {
  fireEvent.change(screen.getByLabelText('방문 날짜'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('방문 시간'), { target: { value: time } });
}

beforeEach(() => {
  vi.resetAllMocks();
  destinationLocation = null;
  useRecord.mockReturnValue(null);
});

describe('RecordNew blank visit form', () => {
  it('전체 장소 스냅샷과 로컬 날짜·시간, requestKey만 저장하고 홈으로 간다', async () => {
    const user = userEvent.setup();
    const saveFiveSecondRecord = vi.fn().mockResolvedValue({ id: 'visit-1' });
    renderRecord({ place: PLACE }, saveFiveSecondRecord);

    expect(screen.getByLabelText('방문 날짜').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByLabelText('방문 시간').value).toMatch(/^\d{2}:\d{2}$/);
    setVisitIntent();
    await user.click(screen.getByRole('button', { name: '빈 방문 저장' }));

    expect(saveFiveSecondRecord).toHaveBeenCalledTimes(1);
    const payload = saveFiveSecondRecord.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['date', 'place', 'requestKey']);
    expect(payload).toEqual({
      place: PLACE,
      date: new Date(2026, 7, 5, 14, 35, 0, 0).toISOString(),
      requestKey: expect.any(String),
    });
    expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
    expect(destinationLocation.pathname).toBe('/');
  });

  it.each([ERROR_CODES.network, ERROR_CODES.rate_limited])(
    '%s 실패를 재시도할 때 같은 requestKey를 유지한다',
    async (code) => {
      const user = userEvent.setup();
      const saveFiveSecondRecord = vi
        .fn()
        .mockRejectedValueOnce(new AppError(code))
        .mockResolvedValueOnce({ id: 'visit-1' });
      renderRecord({ place: PLACE }, saveFiveSecondRecord);
      setVisitIntent();

      await user.click(screen.getByRole('button', { name: '빈 방문 저장' }));
      await screen.findByRole('alert');
      const firstRequestKey = saveFiveSecondRecord.mock.calls[0][0].requestKey;

      await user.click(screen.getByRole('button', { name: '다시 저장' }));

      expect(saveFiveSecondRecord).toHaveBeenCalledTimes(2);
      expect(saveFiveSecondRecord.mock.calls[1][0].requestKey).toBe(firstRequestKey);
      expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
    },
  );

  it('결과를 확정할 수 없는 실패도 같은 방문 생성 의도로 재시도한다', async () => {
    const user = userEvent.setup();
    const saveFiveSecondRecord = vi
      .fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.unknown))
      .mockResolvedValueOnce({ id: 'visit-1' });
    renderRecord({ place: PLACE }, saveFiveSecondRecord);
    setVisitIntent('2026-08-05', '14:35');

    await user.click(screen.getByRole('button', { name: '빈 방문 저장' }));
    await screen.findByRole('alert');
    const firstPayload = saveFiveSecondRecord.mock.calls[0][0];

    await user.click(screen.getByRole('button', { name: '다시 저장' }));

    expect(saveFiveSecondRecord).toHaveBeenCalledTimes(2);
    expect(firstPayload).toEqual({
      place: PLACE,
      date: new Date(2026, 7, 5, 14, 35, 0, 0).toISOString(),
      requestKey: expect.any(String),
    });
    expect(saveFiveSecondRecord.mock.calls[1][0]).toEqual(firstPayload);
    expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
  });

  it('재시도 가능한 실패 뒤 날짜·시간 의도를 고치면 새 requestKey를 만든다', async () => {
    const user = userEvent.setup();
    const saveFiveSecondRecord = vi
      .fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network))
      .mockResolvedValueOnce({ id: 'visit-1' });
    renderRecord({ place: PLACE }, saveFiveSecondRecord);
    setVisitIntent();

    await user.click(screen.getByRole('button', { name: '빈 방문 저장' }));
    await screen.findByRole('alert');
    const firstRequestKey = saveFiveSecondRecord.mock.calls[0][0].requestKey;

    fireEvent.change(screen.getByLabelText('방문 시간'), { target: { value: '15:10' } });
    await user.click(screen.getByRole('button', { name: '빈 방문 저장' }));

    expect(saveFiveSecondRecord.mock.calls[1][0].requestKey).not.toBe(firstRequestKey);
    expect(saveFiveSecondRecord.mock.calls[1][0].date).toBe(
      new Date(2026, 7, 5, 15, 10, 0, 0).toISOString(),
    );
  });

  it('처리 중 연속 탭을 한 요청으로 억제하고 상태와 비활성화를 표시한다', async () => {
    const pending = deferred();
    const saveFiveSecondRecord = vi.fn().mockReturnValue(pending.promise);
    renderRecord({ place: PLACE }, saveFiveSecondRecord);
    setVisitIntent();

    const saveButton = screen.getByRole('button', { name: '빈 방문 저장' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(saveFiveSecondRecord).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('저장하고 있어요');
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();

    await act(async () => pending.resolve({ id: 'visit-1' }));
    expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
  });

  it('실패해도 장소·날짜·시간을 유지하고 원본 오류는 숨긴다', async () => {
    const user = userEvent.setup();
    const raw = 'postgres://secret.invalid?apikey=do-not-show';
    const saveFiveSecondRecord = vi.fn().mockRejectedValue(
      new AppError(ERROR_CODES.network, { message: raw }),
    );
    renderRecord({ place: PLACE }, saveFiveSecondRecord);
    setVisitIntent('2026-08-07', '19:45');

    await user.click(screen.getByRole('button', { name: '빈 방문 저장' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('네트워크 연결이 불안정해요');
    expect(alert).not.toHaveTextContent(raw);
    expect(screen.getByText(PLACE.name)).toBeInTheDocument();
    expect(screen.getByLabelText('방문 날짜')).toHaveValue('2026-08-07');
    expect(screen.getByLabelText('방문 시간')).toHaveValue('19:45');
    expect(screen.getByRole('button', { name: '다시 저장' })).toBeEnabled();
  });
});

describe('RecordNew route recovery', () => {
  it.each([
    ['state 없음', undefined],
    ['place 없음', {}],
    ['정규화되지 않은 place', { place: { id: 'partial', name: '좌표 없음' } }],
  ])('%s이면 new-record 지도 intent로 복구한다', async (_caseName, state) => {
    renderRecord(state);

    expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
    expect(destinationLocation.pathname).toBe('/map');
    expect(destinationLocation.state).toEqual({ intent: 'new-record' });
  });
});

describe('RecordNew pending completion variant', () => {
  it('recordId 화면은 기존 한 줄 저장과 꽃갈피 경로를 유지한다', async () => {
    const user = userEvent.setup();
    const saveFiveSecondRecord = vi.fn().mockResolvedValue({ id: 'visit-pending' });
    useRecord.mockReturnValue({
      id: 'visit-pending',
      placeName: '기다리는 장소',
      date: '2026-08-03T03:00:00.000Z',
    });
    renderRecord({ recordId: 'visit-pending' }, saveFiveSecondRecord);

    await user.type(screen.getByPlaceholderText('오늘 우리가 머문 곳에 한 줄을 남겨주세요!'), '내 한 줄');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(saveFiveSecondRecord).toHaveBeenCalledWith({
      recordId: 'visit-pending',
      placeId: undefined,
      text: '내 한 줄',
      rating: 3,
      date: expect.any(String),
    });
    await waitFor(() => expect(destinationLocation?.pathname).toBe('/pick'));
  });
});

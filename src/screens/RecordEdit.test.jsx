import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp, useRecord } from '@/data/store';
import RecordEdit from './RecordEdit';

vi.mock('@/data/store', () => ({ useApp: vi.fn(), useRecord: vi.fn() }));

const PLACE = {
  id: 'old-place',
  providerId: 'old-place',
  provider: 'kakao',
  name: '기존 장소',
  category: '카페',
  address: '서울 성동구 기존길 1',
  roadAddress: '서울 성동구 기존로 1',
  phone: '02-000-0000',
  url: 'https://place.map.kakao.com/old-place',
  lat: 37.5,
  lng: 127.0,
};

const NEW_PLACE = {
  ...PLACE,
  id: 'new-place',
  providerId: 'new-place',
  name: '새 장소',
  address: '서울 성동구 새길 2',
  roadAddress: '서울 성동구 새로 2',
  lat: 37.55,
  lng: 127.05,
};

const RECORD = {
  id: 'visit-1',
  placeId: 'old-place',
  placeName: '기존 장소',
  place: PLACE,
  date: '2026-08-03T09:25:00.000Z',
  rating: 4,
  flower: 'rose',
  tags: ['# 첫째', '# 둘째'],
  photos: [],
  entries: [
    { memberId: 'me', text: '기존 내 한 줄', rating: 4, readOnly: false },
    { memberId: 'partner', text: '짝궁 비공개 수정값', rating: 2, readOnly: true },
  ],
};

let destinationLocation;

function Destination() {
  destinationLocation = useLocation();
  return <div>목적지</div>;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function renderEdit({ state, updateRecord = vi.fn().mockResolvedValue(RECORD), app = {} } = {}) {
  useApp.mockReturnValue({
    ready: true,
    updateRecord,
    addVisitPhotos: vi.fn().mockResolvedValue([]),
    deleteVisitPhoto: vi.fn(),
    retryDeleteVisitPhoto: vi.fn(),
    photoUploadsByRecord: {},
    photoDeletesByRecord: {},
    ...app,
  });
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/place/visit-1/edit', state }]}>
      <Routes>
        <Route path="/place/:recordId/edit" element={<RecordEdit />} />
        <Route path="/map" element={<Destination />} />
        <Route path="/place/:recordId" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  destinationLocation = null;
  useRecord.mockReturnValue(RECORD);
});

describe('RecordEdit restoration and rights', () => {
  it('내 개인 값과 모든 공동 필드를 복원하고 짝궁 개인 값은 읽기 전용으로 둔다', () => {
    renderEdit();

    expect(screen.getByLabelText('장소')).toHaveTextContent('기존 장소');
    expect(screen.getByLabelText('방문 날짜')).toHaveValue('2026-08-03');
    expect(screen.getByLabelText('방문 시간')).toHaveValue('18:25');
    expect(screen.getByLabelText('꽃갈피')).toHaveValue('rose');
    expect(screen.getByLabelText('내 한 줄')).toHaveValue('기존 내 한 줄');
    expect(screen.getByRole('button', { name: '4점' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('# 첫째')).toBeInTheDocument();
    expect(screen.getByText('# 둘째')).toBeInTheDocument();
    expect(screen.getByLabelText('짝궁 기록 (읽기 전용)')).toHaveTextContent('짝궁 비공개 수정값');
    expect(screen.getByLabelText('짝궁 기록 (읽기 전용)')).toHaveTextContent('2점');
    expect(screen.queryByDisplayValue('짝궁 비공개 수정값')).not.toBeInTheDocument();
  });

  it('restores the current member rating from their private entry', () => {
    useRecord.mockReturnValue({
      ...RECORD,
      rating: 1,
      entries: RECORD.entries.map((entry) => (
        entry.memberId === 'me' ? { ...entry, rating: 4 } : entry
      )),
    });

    renderEdit();

    expect(screen.getByRole('button', { name: '4점' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1점' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('새 장소 intent를 열고 돌아온 장소 스냅샷을 공동 필드로만 저장한다', async () => {
    const user = userEvent.setup();
    const updateRecord = vi.fn().mockResolvedValue(RECORD);
    const { unmount } = renderEdit({ updateRecord });

    await user.click(screen.getByLabelText('장소'));
    expect(await screen.findByText('목적지')).toBeInTheDocument();
    expect(destinationLocation.state).toEqual({ intent: 'edit-record-place', recordId: 'visit-1' });
    unmount();

    renderEdit({ state: { place: NEW_PLACE } , updateRecord });
    expect(screen.getByLabelText('장소')).toHaveTextContent('새 장소');

    fireEvent.change(screen.getByLabelText('방문 날짜'), { target: { value: '2026-08-08' } });
    fireEvent.change(screen.getByLabelText('방문 시간'), { target: { value: '20:40' } });
    await user.selectOptions(screen.getByLabelText('꽃갈피'), 'lilac');
    await user.clear(screen.getByLabelText('내 한 줄'));
    await user.type(screen.getByLabelText('내 한 줄'), '새 내 한 줄');
    await user.click(screen.getByRole('button', { name: '5점' }));
    await user.click(screen.getByRole('button', { name: '# 둘째 태그 삭제' }));
    await user.click(screen.getByRole('button', { name: '태그 추가' }));
    await user.type(screen.getByLabelText('새 태그'), '# 셋째');
    await user.click(screen.getByRole('button', { name: '태그 넣기' }));
    await user.click(screen.getByRole('button', { name: '수정하기' }));

    expect(updateRecord).toHaveBeenCalledTimes(1);
    const [recordId, payload] = updateRecord.mock.calls[0];
    expect(recordId).toBe('visit-1');
    expect(payload).toEqual({
      place: NEW_PLACE,
      date: new Date(2026, 7, 8, 20, 40, 0, 0).toISOString(),
      flower: 'lilac',
      tags: ['# 첫째', '# 셋째'],
      text: '새 내 한 줄',
      rating: 5,
    });
    expect(JSON.stringify(payload)).not.toContain('짝궁 비공개 수정값');
    expect(payload).not.toHaveProperty('entries');
  });

  it('저장 실패는 전체 draft를 유지하고 안전한 오류로 같은 값만 재시도한다', async () => {
    const user = userEvent.setup();
    const updateRecord = vi.fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network, { message: 'secret-path' }))
      .mockResolvedValueOnce(RECORD);
    renderEdit({ updateRecord });

    await user.clear(screen.getByLabelText('내 한 줄'));
    await user.type(screen.getByLabelText('내 한 줄'), '실패해도 남는 값');
    fireEvent.change(screen.getByLabelText('방문 시간'), { target: { value: '21:10' } });
    await user.click(screen.getByRole('button', { name: '수정하기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 연결이 불안정해요');
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret-path');
    expect(screen.getByLabelText('내 한 줄')).toHaveValue('실패해도 남는 값');
    expect(screen.getByLabelText('방문 시간')).toHaveValue('21:10');

    await user.click(screen.getByRole('button', { name: '다시 저장' }));
    expect(updateRecord).toHaveBeenCalledTimes(2);
    expect(updateRecord.mock.calls[1]).toEqual(updateRecord.mock.calls[0]);
  });

  it('저장 중 연속 클릭을 한 번으로 막는다', async () => {
    const pending = deferred();
    const updateRecord = vi.fn().mockReturnValue(pending.promise);
    renderEdit({ updateRecord });

    const save = screen.getByRole('button', { name: '수정하기' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(updateRecord).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('기록을 저장하고 있어요');
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();

    await act(async () => pending.resolve(RECORD));
    await waitFor(() => expect(destinationLocation?.pathname).toBe('/place/visit-1'));
  });
});

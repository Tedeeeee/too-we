import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp, useRecord } from '@/data/store';
import BookmarkPick from './BookmarkPick';

vi.mock('@/data/store', () => ({ useApp: vi.fn(), useRecord: vi.fn() }));

let destinationLocation;

function Destination() {
  destinationLocation = useLocation();
  return <div>목적지 화면</div>;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderPicker(setRecordFlower = vi.fn()) {
  useApp.mockReturnValue({ ready: true, setRecordFlower });
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/pick', state: { recordId: 'visit-1' } }]}>
      <Routes>
        <Route path="/pick" element={<BookmarkPick />} />
        <Route path="/place/:recordId" element={<Destination />} />
        <Route path="/" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  destinationLocation = null;
  useRecord.mockReturnValue({ id: 'visit-1', flower: 'rose', pending: true });
});

describe('BookmarkPick shared flower save', () => {
  it('서버 꽃을 복원하고 같은 꽃을 탭한 null 선택을 확정한다', async () => {
    const user = userEvent.setup();
    const setRecordFlower = vi.fn().mockResolvedValue({ id: 'visit-1', flower: null });
    renderPicker(setRecordFlower);

    const rose = screen.getByRole('button', { name: '장미 꽃갈피' });
    expect(rose).toHaveAttribute('aria-pressed', 'true');
    await user.click(rose);
    expect(rose).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: '선택하기' }));

    expect(setRecordFlower).toHaveBeenCalledWith('visit-1', null);
    await waitFor(() => expect(destinationLocation?.pathname).toBe('/place/visit-1'));
  });

  it('실패해도 선택을 유지하고 원본 오류를 숨긴 채 같은 값으로 재시도한다', async () => {
    const user = userEvent.setup();
    const raw = 'https://secret.invalid/?apikey=do-not-show';
    const setRecordFlower = vi
      .fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network, { message: raw }))
      .mockResolvedValueOnce({ id: 'visit-1', flower: 'lilac' });
    renderPicker(setRecordFlower);

    await user.click(screen.getByRole('button', { name: '라일락 꽃갈피' }));
    await user.click(screen.getByRole('button', { name: '선택하기' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('네트워크 연결이 불안정해요');
    expect(alert).not.toHaveTextContent(raw);
    expect(screen.getByRole('button', { name: '라일락 꽃갈피' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(setRecordFlower).toHaveBeenNthCalledWith(1, 'visit-1', 'lilac');
    expect(setRecordFlower).toHaveBeenNthCalledWith(2, 'visit-1', 'lilac');
    await waitFor(() => expect(destinationLocation?.pathname).toBe('/place/visit-1'));
  });

  it('저장 중 이중 클릭을 한 번으로 막고 접근 가능한 진행 상태를 표시한다', async () => {
    const pending = deferred();
    const setRecordFlower = vi.fn().mockReturnValue(pending.promise);
    renderPicker(setRecordFlower);

    const confirm = screen.getByRole('button', { name: '선택하기' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(setRecordFlower).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('꽃갈피를 저장하고 있어요');

    await act(async () => pending.resolve({ id: 'visit-1', flower: 'rose' }));
    await waitFor(() => expect(destinationLocation?.pathname).toBe('/place/visit-1'));
  });

  it('닫기는 서버 꽃을 변경하지 않는다', async () => {
    const user = userEvent.setup();
    const setRecordFlower = vi.fn();
    renderPicker(setRecordFlower);

    await user.click(screen.getByRole('button', { name: '꽃갈피 선택 닫기' }));

    expect(setRecordFlower).not.toHaveBeenCalled();
  });
});

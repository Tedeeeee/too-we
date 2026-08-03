import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import VisitPhotoManager from './VisitPhotoManager';

const file = (name) => new File([name], name, { type: 'image/jpeg' });

const photo = (id, ownedByMe, order = 1) => ({
  id,
  ownedByMe,
  order,
  uploaderId: ownedByMe ? 'me-user' : 'partner-user',
  bucket: 'visit-photos',
  path: `couple/visit/${id}.webp`,
  url: `https://signed.invalid/${id}`,
});

const succeeded = (source, clientId, id) => ({
  clientId,
  file: source,
  status: 'succeeded',
  error: null,
  photo: photo(id, true),
});

const failed = (source, clientId, error = new AppError(ERROR_CODES.network)) => ({
  clientId,
  file: source,
  status: 'failed',
  error,
  requestKey: `${clientId}-request`,
  prepared: { compressed: true },
  uploadAttempted: true,
  uploadReplayEligible: true,
  objectUploaded: false,
  photo: null,
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const renderManager = (props = {}) => {
  const defaults = {
    recordId: 'visit-1',
    photos: [],
    uploads: [],
    deleteStates: {},
    addPhotos: vi.fn().mockResolvedValue([]),
    deletePhoto: vi.fn(),
    retryDeletePhoto: vi.fn(),
  };
  return render(<VisitPhotoManager {...defaults} {...props} />);
};

describe('VisitPhotoManager uploads', () => {
  it('기존 사진과 실패 대기분을 포함해 최대 5장만 받고 초과 파일은 액션에 넘기지 않는다', async () => {
    const addPhotos = vi.fn().mockResolvedValue([]);
    renderManager({
      photos: [photo('p1', true, 1), photo('p2', false, 2), photo('p3', true, 3), photo('p4', false, 4)],
      addPhotos,
    });
    const first = file('first.jpg');
    const over = file('over.jpg');

    fireEvent.change(screen.getByLabelText('사진 추가'), { target: { files: [first, over] } });

    await waitFor(() => expect(addPhotos).toHaveBeenCalledWith('visit-1', [first]));
    expect(screen.getByRole('alert')).toHaveTextContent('최대 5장');
    expect(screen.getByText('5/5')).toBeInTheDocument();
  });

  it('일부 실패 시 성공 카드는 유지하고 파일별 안전한 오류와 개별 재시도를 제공한다', async () => {
    const user = userEvent.setup();
    const a = file('a.jpg');
    const b = file('b.jpg');
    const raw = 'https://storage.invalid/private/path?apikey=secret';
    const failedB = failed(b, 'client-b', new AppError(ERROR_CODES.network, { message: raw }));
    const addPhotos = vi.fn()
      .mockResolvedValueOnce([succeeded(a, 'client-a', 'photo-a'), failedB])
      .mockResolvedValueOnce([succeeded(b, 'client-b', 'photo-b')]);
    renderManager({ addPhotos });

    fireEvent.change(screen.getByLabelText('사진 추가'), { target: { files: [a, b] } });

    expect(await screen.findByLabelText('a.jpg 업로드 상태')).toHaveTextContent('업로드 완료');
    const failedStatus = screen.getByLabelText('b.jpg 업로드 상태');
    expect(failedStatus).toHaveTextContent('네트워크 연결이 불안정해요');
    expect(failedStatus).not.toHaveTextContent(raw);

    await user.click(screen.getByRole('button', { name: 'b.jpg 다시 시도' }));

    expect(addPhotos).toHaveBeenCalledTimes(2);
    expect(addPhotos.mock.calls[1]).toEqual(['visit-1', [failedB]]);
    expect(screen.getByLabelText('a.jpg 업로드 상태')).toHaveTextContent('업로드 완료');
    expect(await screen.findByLabelText('b.jpg 업로드 상태')).toHaveTextContent('업로드 완료');
  });

  it('업로드 중 연속 선택을 한 번으로 막고 각 파일 진행 상태를 유지한다', async () => {
    const pending = deferred();
    const addPhotos = vi.fn().mockReturnValue(pending.promise);
    renderManager({ addPhotos });
    const a = file('a.jpg');

    const input = screen.getByLabelText('사진 추가');
    fireEvent.change(input, { target: { files: [a] } });
    fireEvent.change(input, { target: { files: [a] } });

    expect(addPhotos).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('a.jpg 업로드 상태')).toHaveTextContent('압축·업로드 중');
    expect(screen.getByRole('button', { name: '사진 올리는 중…' })).toBeDisabled();

    await act(async () => pending.resolve([succeeded(a, 'client-a', 'photo-a')]));
    expect(await screen.findByLabelText('a.jpg 업로드 상태')).toHaveTextContent('업로드 완료');
  });

  it('replaces a successful upload status card with refreshed server photo truth', () => {
    const a = file('a.jpg');
    const upload = succeeded(a, 'client-a', 'photo-a');
    const view = renderManager({ uploads: [upload] });

    expect(screen.getByLabelText('a.jpg 업로드 상태')).toBeInTheDocument();

    view.rerender(
      <VisitPhotoManager
        recordId="visit-1"
        photos={[photo('photo-a', true)]}
        uploads={[upload]}
        deleteStates={{}}
        addPhotos={vi.fn().mockResolvedValue([])}
        deletePhoto={vi.fn()}
        retryDeletePhoto={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('photo-a 사진')).toBeInTheDocument();
    expect(screen.queryByLabelText('a.jpg 업로드 상태')).not.toBeInTheDocument();
  });
});

describe('VisitPhotoManager delete rights', () => {
  it('내 사진에만 삭제 제어를 보이고 파트너 사진은 읽기 전용으로 둔다', () => {
    renderManager({ photos: [photo('mine', true, 1), photo('partner', false, 2)] });

    expect(screen.getByRole('button', { name: 'mine 사진 삭제' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'partner 사진 삭제' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('partner 사진 (짝궁 업로드, 읽기 전용)')).toBeInTheDocument();
  });

  it('이 세션에서 업로드한 내 사진을 삭제하면 성공 기록도 숨기고 5장 용량을 다시 비운다', async () => {
    const user = userEvent.setup();
    const uploaded = file('uploaded.jpg');
    const upload = succeeded(uploaded, 'client-uploaded', 'photo-uploaded');
    const replacements = Array.from({ length: 5 }, (_, index) => file(`replacement-${index + 1}.jpg`));
    const addPhotos = vi.fn().mockImplementation(async (_recordId, files) => (
      files.map((source, index) => succeeded(source, `replacement-${index + 1}`, `photo-${index + 1}`))
    ));
    const deletePhoto = vi.fn().mockResolvedValue({
      photoId: 'photo-uploaded',
      status: 'succeeded',
      error: null,
    });
    renderManager({
      photos: [photo('photo-uploaded', true)],
      uploads: [upload],
      addPhotos,
      deletePhoto,
    });

    await user.click(screen.getByRole('button', { name: 'photo-uploaded 사진 삭제' }));

    await waitFor(() => {
      expect(screen.queryByLabelText('photo-uploaded 사진')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('uploaded.jpg 업로드 상태')).not.toBeInTheDocument();
      expect(screen.getByText('0/5')).toBeInTheDocument();
    });

    const input = screen.getByLabelText('사진 추가');
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { files: replacements } });

    await waitFor(() => expect(addPhotos).toHaveBeenCalledWith('visit-1', replacements));
  });

  it('삭제 연속 클릭을 억제하고 실패한 내 사진만 안전하게 재시도한다', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const mine = photo('mine', true, 1);
    const failedDelete = {
      photoId: 'mine',
      status: 'failed',
      error: new AppError(ERROR_CODES.network, { message: 'private/storage/path' }),
      objectDeleted: true,
    };
    const deletePhoto = vi.fn().mockReturnValue(pending.promise);
    const retryDeletePhoto = vi.fn().mockResolvedValue({ photoId: 'mine', status: 'succeeded', error: null });
    renderManager({ photos: [mine], deletePhoto, retryDeletePhoto });

    const remove = screen.getByRole('button', { name: 'mine 사진 삭제' });
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(deletePhoto).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('mine 사진 상태')).toHaveTextContent('삭제 중');

    await act(async () => pending.resolve(failedDelete));
    expect(await screen.findByLabelText('mine 사진 상태')).toHaveTextContent('네트워크 연결이 불안정해요');
    expect(screen.getByLabelText('mine 사진 상태')).not.toHaveTextContent('private/storage/path');

    await user.click(screen.getByRole('button', { name: 'mine 사진 삭제 다시 시도' }));
    expect(retryDeletePhoto).toHaveBeenCalledWith('visit-1', 'mine');
    await waitFor(() => expect(screen.queryByLabelText('mine 사진 상태')).not.toBeInTheDocument());
  });
});

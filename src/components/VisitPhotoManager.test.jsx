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

  it('업로드 중에는 실패분 재시도를 막아 진행 중인 배치 결과로 성공 처리하지 않는다', async () => {
    const a = file('a.jpg');
    const b = file('b.jpg');
    const failedB = failed(b, 'client-b');
    const pending = deferred();
    // 스토어는 기록당 업로드를 하나만 돌린다. 이미 진행 중이면 넘긴 입력을 무시하고
    // 먼저 시작한 배치의 promise를 그대로 돌려준다(store.jsx runPhotoUploads).
    // 그래서 재시도를 눌리게 두면 올리지 않은 파일이 남의 결과로 성공 처리된다.
    const addPhotos = vi.fn().mockReturnValue(pending.promise);
    renderManager({ uploads: [failedB], addPhotos });

    fireEvent.change(screen.getByLabelText('사진 추가'), { target: { files: [a] } });
    expect(addPhotos).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'b.jpg 다시 시도' })).toBeDisabled();

    await act(async () => pending.resolve([succeeded(a, 'client-a', 'photo-a')]));

    expect(addPhotos).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('a.jpg 업로드 상태')).toHaveTextContent('업로드 완료');
    const retriedB = screen.getByLabelText('b.jpg 업로드 상태');
    expect(retriedB).not.toHaveTextContent('업로드 완료');
    expect(retriedB).toHaveTextContent('네트워크 연결이 불안정해요');
    expect(screen.getByRole('button', { name: 'b.jpg 다시 시도' })).not.toBeDisabled();
  });

  it('재시도가 진행되는 동안 사진 추가와 다른 재시도를 busy 상태로 막고 진행분을 유지한다', async () => {
    const user = userEvent.setup();
    const b = file('b.jpg');
    const c = file('c.jpg');
    const failedB = failed(b, 'client-b');
    const failedC = failed(c, 'client-c');
    const pending = deferred();
    const addPhotos = vi.fn().mockReturnValue(pending.promise);
    renderManager({ uploads: [failedB, failedC], addPhotos });

    await user.click(screen.getByRole('button', { name: 'b.jpg 다시 시도' }));
    expect(addPhotos).toHaveBeenCalledTimes(1);

    // 재시도도 같은 업로드 슬롯을 쓴다. 추가 경로를 열어 두면 고른 파일이 조용히 버려진다.
    expect(screen.getByLabelText('사진 추가')).toBeDisabled();
    expect(screen.getByRole('button', { name: '사진 올리는 중…' })).toBeDisabled();
    // 다른 실패분의 재시도도 같은 게이트에 막히므로 눌리는 것처럼 보이면 안 된다.
    expect(screen.getByRole('button', { name: 'c.jpg 다시 시도' })).toBeDisabled();
    // 막는 동안에도 각 파일의 진행 상태는 그대로 남는다.
    expect(screen.getByLabelText('b.jpg 업로드 상태')).toHaveTextContent('압축·업로드 중');
    expect(screen.getByLabelText('c.jpg 업로드 상태')).toHaveTextContent('네트워크 연결이 불안정해요');

    await act(async () => pending.resolve([succeeded(b, 'client-b', 'photo-b')]));

    expect(await screen.findByLabelText('b.jpg 업로드 상태')).toHaveTextContent('업로드 완료');
    expect(screen.getByLabelText('사진 추가')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'c.jpg 다시 시도' })).not.toBeDisabled();
  });

  it('재시도 결과를 clientId로 대조해 다른 파일의 결과로 성공 처리하지 않는다', async () => {
    const user = userEvent.setup();
    const b = file('b.jpg');
    const failedB = failed(b, 'client-b');
    // 이 재시도의 clientId가 없는 배치가 돌아오면 확정된 것이 아니다.
    const addPhotos = vi.fn().mockResolvedValue([succeeded(file('a.jpg'), 'client-a', 'photo-a')]);
    renderManager({ uploads: [failedB], addPhotos });

    await user.click(screen.getByRole('button', { name: 'b.jpg 다시 시도' }));

    const retriedB = await screen.findByLabelText('b.jpg 업로드 상태');
    expect(retriedB).not.toHaveTextContent('업로드 완료');
    expect(retriedB).toHaveTextContent('네트워크 연결이 불안정해요');
    expect(screen.getByRole('button', { name: 'b.jpg 다시 시도' })).not.toBeDisabled();
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

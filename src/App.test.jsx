import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { AppProvider } from '@/data/store';
import * as api from '@/data/api';
import App from './App';

vi.mock('@/data/api', () => ({
  getCouple: vi.fn(),
  getRecords: vi.fn(),
  getWishlist: vi.fn(),
  createCouple: vi.fn(),
  reissueCoupleInvite: vi.fn(),
  connectWithCode: vi.fn(),
  setMyName: vi.fn(),
  completeOnboarding: vi.fn(),
  saveFiveSecondRecord: vi.fn(),
  setRecordFlower: vi.fn(),
  updateRecord: vi.fn(),
  disconnectCouple: vi.fn(),
}));

vi.mock('@/screens/OnboardingIntro', () => ({
  default: () => <div>온보딩 화면</div>,
}));
vi.mock('@/screens/OnboardingCode', () => ({ default: () => <div>코드 화면</div> }));
vi.mock('@/screens/OnboardingName', () => ({ default: () => <div>이름 화면</div> }));
vi.mock('@/screens/OnboardingShare', () => ({ default: () => <div>공유 화면</div> }));
vi.mock('@/screens/Home', () => ({ default: () => <div>홈 화면</div> }));
vi.mock('@/screens/MapSelect', () => ({ default: () => <div>지도 화면</div> }));
vi.mock('@/screens/RecordNew', () => ({ default: () => <div>기록 화면</div> }));
vi.mock('@/screens/BookmarkPick', () => ({ default: () => <div>꽃갈피 화면</div> }));
vi.mock('@/screens/PlaceDetailScreen', () => ({ default: () => <div>상세 화면</div> }));
vi.mock('@/screens/RecordEdit', () => ({ default: () => <div>수정 화면</div> }));
vi.mock('@/screens/MyPage', async () => {
  const { useApp } = await import('@/data/store');
  return {
    default: () => {
      const { disconnectCouple } = useApp();
      return (
        <div>
          <span>마이페이지 화면</span>
          <button type="button" onClick={() => disconnectCouple()}>
            테스트 연결 해제
          </button>
        </div>
      );
    },
  };
});
vi.mock('@/screens/Wishlist', () => ({ default: () => <div>위시리스트 화면</div> }));

const NO_COUPLE = {
  coupleId: null,
  connected: false,
  onboarded: false,
  me: { id: 'me', userId: 'anon-1', name: '' },
};

const ONBOARDED_COUPLE = {
  ...NO_COUPLE,
  coupleId: 'couple-1',
  connected: true,
  onboarded: true,
  me: { id: 'me', userId: 'anon-1', name: '지은' },
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderApp(path = '/') {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getWishlist.mockResolvedValue([]);
});

describe('startup routing', () => {
  it('첫 실행 데이터를 모두 복원할 때까지 접근 가능한 로딩 화면을 표시한다', () => {
    api.getCouple.mockReturnValue(deferred().promise);
    api.getRecords.mockReturnValue(deferred().promise);
    api.getWishlist.mockReturnValue(deferred().promise);

    renderApp();

    expect(screen.getByRole('status')).toHaveTextContent('앱을 준비하고 있어요');
    expect(screen.queryByText('홈 화면')).not.toBeInTheDocument();
    expect(screen.queryByText('온보딩 화면')).not.toBeInTheDocument();
  });

  it('복원된 온보딩 완료 사용자는 기록 복원 뒤 홈으로 진입한다', async () => {
    api.getCouple.mockResolvedValue(ONBOARDED_COUPLE);
    api.getRecords.mockResolvedValue([{ id: 'record-1' }]);

    renderApp();

    expect(await screen.findByText('홈 화면')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('활성 커플이 없는 사용자는 준비 완료 뒤 온보딩으로 진입한다', async () => {
    api.getCouple.mockResolvedValue(NO_COUPLE);
    api.getRecords.mockResolvedValue([]);

    renderApp('/map');

    expect(await screen.findByText('온보딩 화면')).toBeInTheDocument();
    expect(screen.queryByText('지도 화면')).not.toBeInTheDocument();
  });
});

describe('startup error recovery', () => {
  it.each([ERROR_CODES.network, ERROR_CODES.rate_limited])(
    '%s bootstrap 오류에는 재시도를 제공하고 성공하면 홈으로 복구한다',
    async (code) => {
      const user = userEvent.setup();
      api.getCouple
        .mockRejectedValueOnce(new AppError(code))
        .mockResolvedValueOnce(ONBOARDED_COUPLE);
      api.getRecords.mockResolvedValue([]);

      renderApp();

      const retry = await screen.findByRole('button', { name: '다시 시도' });
      await user.click(retry);

      expect(await screen.findByText('홈 화면')).toBeInTheDocument();
      expect(api.getCouple).toHaveBeenCalledTimes(2);
      expect(api.getRecords).toHaveBeenCalledTimes(2);
    },
  );

  it.each([ERROR_CODES.configuration, ERROR_CODES.auth])(
    '%s bootstrap 오류는 원시 메시지 대신 재시작 및 문의 안내를 표시한다',
    async (code) => {
      const rawMessage = 'postgres://secret.example.invalid?apikey=do-not-show';
      api.getCouple.mockRejectedValue(
        new AppError(code, { cause: new Error(rawMessage) }),
      );
      api.getRecords.mockResolvedValue([]);

      renderApp();

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('앱을 다시 열어');
      expect(alert).toHaveTextContent('문의');
      expect(alert).not.toHaveTextContent(rawMessage);
      expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
    },
  );

  it('재시도를 누르면 이전 오류를 숨기고 다시 로딩 상태를 표시한다', async () => {
    const user = userEvent.setup();
    const retryCouple = deferred();
    const retryRecords = deferred();
    api.getCouple
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network))
      .mockReturnValueOnce(retryCouple.promise);
    api.getRecords.mockResolvedValueOnce([]).mockReturnValueOnce(retryRecords.promise);

    renderApp();
    await user.click(await screen.findByRole('button', { name: '다시 시도' }));

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('disconnect routing', () => {
  it('store가 연결을 철회하면 현재 mypage 접근을 즉시 온보딩으로 되돌린다', async () => {
    const user = userEvent.setup();
    api.getCouple.mockResolvedValue(ONBOARDED_COUPLE);
    api.getRecords.mockResolvedValue([]);
    api.disconnectCouple.mockResolvedValue({ disconnected: true, coupleId: 'couple-1' });

    renderApp('/mypage');

    await user.click(await screen.findByRole('button', { name: '테스트 연결 해제' }));

    expect(await screen.findByText('온보딩 화면')).toBeInTheDocument();
    expect(api.disconnectCouple).toHaveBeenCalledTimes(1);
  });
});

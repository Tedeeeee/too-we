import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp } from '@/data/store';
import * as api from '@/data/api';
import MyPage from './MyPage';

vi.mock('@/data/store', () => ({ useApp: vi.fn() }));
vi.mock('@/data/api', () => ({
  getSettings: vi.fn(),
  getWishlist: vi.fn(),
}));

const COUPLE = {
  coupleId: 'couple-1',
  connected: true,
  onboarded: true,
  startDate: '2026-05-03',
  me: { id: 'me', userId: 'anon-me', name: '지은', initial: '지' },
  partner: { id: 'partner', userId: 'anon-partner', name: '태식', initial: '태' },
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function appState(overrides = {}) {
  return {
    couple: COUPLE,
    wishlist: [{ id: 'w1' }, { id: 'w2' }],
    wishlistStatus: 'ready',
    setMyName: vi.fn().mockResolvedValue(undefined),
    disconnectCouple: vi.fn().mockResolvedValue({ disconnected: true }),
    ...overrides,
  };
}

function renderMyPage(app = appState()) {
  useApp.mockReturnValue(app);
  render(
    <MemoryRouter initialEntries={['/mypage']}>
      <MyPage />
    </MemoryRouter>,
  );
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getWishlist.mockResolvedValue([]);
});

describe('MyPage restored data', () => {
  it('복원된 커플과 wishlist를 즉시 표시하고 settings 로딩과 빈 값을 구분한다', async () => {
    const settings = deferred();
    api.getSettings.mockReturnValue(settings.promise);

    renderMyPage();

    expect(screen.getByRole('heading', { name: '마이페이지' })).toBeInTheDocument();
    expect(screen.getByText(/지은과\(와\) 태식이 함께한지/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /가고 싶은 곳 2곳/ })).toBeInTheDocument();
    expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
    expect(api.getWishlist).not.toHaveBeenCalled();

    await act(async () => settings.resolve({ recordAlert: '' }));

    expect(screen.getByText('사용 안 함')).toBeInTheDocument();
  });

  it('settings 실패에 안전한 안내를 표시하고 기존 화면을 유지한 채 재시도한다', async () => {
    const user = userEvent.setup();
    api.getSettings
      .mockRejectedValueOnce(
        new AppError(ERROR_CODES.network, { message: 'postgres://secret?apikey=hide' }),
      )
      .mockResolvedValueOnce({ recordAlert: '오후 8시' });

    renderMyPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('설정을 불러오지 못했어요');
    expect(alert).not.toHaveTextContent('apikey');
    expect(screen.getByText(/지은과\(와\) 태식이 함께한지/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '설정 다시 시도' }));

    expect(await screen.findByText('오후 8시')).toBeInTheDocument();
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('복원된 프로필 이름이 비어 있어도 빈 상태를 표시하고 본인 입력만 연다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue({ recordAlert: '' });
    renderMyPage(appState({
      couple: {
        ...COUPLE,
        me: { ...COUPLE.me, name: '' },
        partner: { ...COUPLE.partner, name: '' },
      },
    }));

    expect(await screen.findByText('사용 안 함')).toBeInTheDocument();
    expect(screen.getByText(/이름 없음과\(와\) 이름 없음이 함께한지/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '내 정보 수정하기' }));
    expect(screen.getByRole('textbox', { name: '내 이름' })).toHaveValue('');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });
});

describe('MyPage disconnect confirmations', () => {
  it('프로필 시트의 연결해제 진입도 동일한 첫 확인으로 이어진다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue({ recordAlert: '' });
    renderMyPage();

    await user.click(screen.getByRole('button', { name: '내 정보 수정하기' }));
    expect(screen.getByRole('dialog', { name: '내 정보 수정하기' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '연결해제' }));

    expect(screen.queryByRole('dialog', { name: '내 정보 수정하기' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '커플 연결 해제 확인' })).toBeInTheDocument();
  });

  it('첫 확인은 즉시 접근 차단을, 두 번째 확인은 24시간 내 영구 삭제를 명시한다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue({ recordAlert: '' });
    const app = renderMyPage();

    await user.click(screen.getByRole('button', { name: '커플 연결해제' }));

    expect(screen.getByRole('dialog', { name: '커플 연결 해제 확인' })).toBeInTheDocument();
    expect(screen.getByText(/두 사람 모두.*즉시 접근할 수 없어요/)).toBeInTheDocument();
    expect(app.disconnectCouple).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '계속하기' }));

    expect(screen.getByRole('dialog', { name: '커플 데이터 영구 삭제 확인' })).toBeInTheDocument();
    expect(screen.getByText(/24시간 안에 영구 삭제/)).toBeInTheDocument();
    expect(screen.getByText(/복구할 수 없어요/)).toBeInTheDocument();
    expect(app.disconnectCouple).not.toHaveBeenCalled();
  });

  it('최종 확인 연속 제출을 하나의 store disconnect 작업으로 막는다', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    api.getSettings.mockResolvedValue({ recordAlert: '' });
    const disconnectCouple = vi.fn().mockReturnValue(pending.promise);
    renderMyPage(appState({ disconnectCouple }));

    await user.click(screen.getByRole('button', { name: '커플 연결해제' }));
    await user.click(screen.getByRole('button', { name: '계속하기' }));
    const confirm = screen.getByRole('button', { name: '커플 연결 해제하기' });

    act(() => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(disconnectCouple).toHaveBeenCalledTimes(1);
    expect(disconnectCouple).toHaveBeenCalledWith();
    expect(screen.getByRole('button', { name: '연결 해제 중…' })).toBeDisabled();

    await act(async () => pending.resolve({ disconnected: true }));
  });

  it('해제 실패 시 커플과 wishlist 맥락을 보존하고 raw 오류 없이 같은 store 작업을 재시도한다', async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue({ recordAlert: '' });
    const disconnectCouple = vi
      .fn()
      .mockRejectedValueOnce(
        new AppError(ERROR_CODES.network, { message: 'postgres://secret-do-not-show' }),
      )
      .mockResolvedValueOnce({ disconnected: true });
    renderMyPage(appState({ disconnectCouple }));

    await user.click(screen.getByRole('button', { name: '커플 연결해제' }));
    await user.click(screen.getByRole('button', { name: '계속하기' }));
    await user.click(screen.getByRole('button', { name: '커플 연결 해제하기' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('현재 연결과 데이터는 그대로예요');
    expect(alert).not.toHaveTextContent('postgres://secret');
    expect(screen.getByText(/지은과\(와\) 태식이 함께한지/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /가고 싶은 곳 2곳/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(disconnectCouple).toHaveBeenCalledTimes(2);
    expect(disconnectCouple).toHaveBeenNthCalledWith(1);
    expect(disconnectCouple).toHaveBeenNthCalledWith(2);
    expect(screen.queryByRole('dialog', { name: '커플 데이터 영구 삭제 확인' })).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp } from '@/data/store';
import OnboardingShare from './OnboardingShare';

vi.mock('@/data/store', () => ({ useApp: vi.fn() }));

const CREATOR = {
  coupleId: 'couple-1',
  connected: false,
  onboarded: true,
  inviteCode: '482195',
  inviteExpiresAt: '2099-01-01T00:00:00.000Z',
  me: { name: '지은' },
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setNavigatorApi(name, value) {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

function Destination() {
  const location = useLocation();
  return <div data-testid="destination">{`${location.pathname}:${String(location.state?.invited)}`}</div>;
}

function renderScreen(app = {}) {
  useApp.mockReturnValue({
    couple: CREATOR,
    reissueCoupleInvite: vi.fn(),
    completeOnboarding: vi.fn(),
    ...app,
  });

  return render(
    <MemoryRouter initialEntries={['/onboarding/share']}>
      <Routes>
        <Route path="/onboarding/share" element={<OnboardingShare />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  setNavigatorApi('clipboard', undefined);
  setNavigatorApi('share', undefined);
  delete document.execCommand;
});

afterEach(() => {
  delete document.execCommand;
});

describe('OnboardingShare invite actions', () => {
  it('복원된 이름과 만료되지 않은 여섯 자리 코드만 공유 가능하게 표시한다', () => {
    renderScreen();

    expect(screen.getByText('지은님이 당신을 기다리고 있어요')).toBeInTheDocument();
    expect(screen.getByText('482 195')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '코드복사' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '공유하기' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '새 코드 받기' })).not.toBeInTheDocument();
  });

  it('클립보드 복사를 한 번만 실행하고 로딩 및 성공 상태를 표시한다', async () => {
    const pending = deferred();
    const writeText = vi.fn().mockReturnValue(pending.promise);
    setNavigatorApi('clipboard', { writeText });
    renderScreen();

    const button = screen.getByRole('button', { name: '코드복사' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('482195');
    expect(screen.getByRole('button', { name: '복사 중…' })).toBeDisabled();

    pending.resolve();
    expect(await screen.findByRole('status')).toHaveTextContent('코드를 복사했어요.');
    expect(screen.getByRole('button', { name: '복사됨!' })).toBeEnabled();
  });

  it('Clipboard API가 없으면 선택 복사 fallback을 사용한다', async () => {
    document.execCommand = vi.fn().mockReturnValue(true);
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: '코드복사' }));

    expect(await screen.findByRole('status')).toHaveTextContent('코드를 복사했어요.');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('모든 복사 수단이 실패하면 수동 복사 안내만 표시한다', async () => {
    const user = userEvent.setup();
    setNavigatorApi('clipboard', {
      writeText: vi.fn().mockRejectedValue(new Error('apikey=do-not-show')),
    });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderScreen();

    await user.click(screen.getByRole('button', { name: '코드복사' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('코드를 길게 눌러 직접 복사해 주세요.');
    expect(alert).not.toHaveTextContent('apikey');
    expect(screen.getByText('482 195')).toBeInTheDocument();
  });

  it('Web Share 성공을 표시하고 정확한 코드만 보낸다', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigatorApi('share', share);
    renderScreen();

    await user.click(screen.getByRole('button', { name: '공유하기' }));

    expect(share).toHaveBeenCalledWith({
      title: '오늘,우리는',
      text: '오늘,우리는 — 지은님의 초대 코드: 482195',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('초대 코드를 공유했어요.');
  });

  it('사용자의 공유 취소를 연결 실패로 표시하지 않는다', async () => {
    const user = userEvent.setup();
    setNavigatorApi('share', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
    renderScreen();

    await user.click(screen.getByRole('button', { name: '공유하기' }));

    expect(await screen.findByRole('status')).toHaveTextContent('공유를 취소했어요.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Web Share가 없으면 코드를 복사해 붙여넣기 안내를 표시한다', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorApi('clipboard', { writeText });
    renderScreen();

    await user.click(screen.getByRole('button', { name: '공유하기' }));

    expect(writeText).toHaveBeenCalledWith('482195');
    expect(await screen.findByRole('status')).toHaveTextContent(
      '코드를 복사했어요. 원하는 곳에 붙여넣어 주세요.',
    );
  });

  it.each([
    [{ ...CREATOR, inviteCode: '', inviteExpiresAt: null }, '새 초대 코드가 필요해요.'],
    [{ ...CREATOR, inviteExpiresAt: '2000-01-01T00:00:00.000Z' }, '초대 코드가 만료됐어요.'],
    [{ ...CREATOR, inviteCode: '12345', inviteExpiresAt: '2099-01-01T00:00:00.000Z' }, '새 초대 코드가 필요해요.'],
  ])('없거나 만료된 코드는 공유를 막고 재발급 action을 제공한다', (couple, message) => {
    renderScreen({ couple });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: '코드복사' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '공유하기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '새 코드 받기' })).toBeEnabled();
  });

  it('재발급 중 연속 탭을 한 operation으로 막는다', async () => {
    const pending = deferred();
    const reissueCoupleInvite = vi.fn().mockReturnValue(pending.promise);
    renderScreen({
      couple: { ...CREATOR, inviteCode: '', inviteExpiresAt: null },
      reissueCoupleInvite,
    });

    const button = screen.getByRole('button', { name: '새 코드 받기' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(reissueCoupleInvite).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '만드는 중…' })).toBeDisabled();

    pending.resolve();
    expect(await screen.findByRole('status')).toHaveTextContent('새 초대 코드를 만들었어요.');
  });

  it('재발급 네트워크 실패 뒤 같은 request key로 명시적으로 재시도한다', async () => {
    const user = userEvent.setup();
    const reissueCoupleInvite = vi
      .fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network))
      .mockResolvedValueOnce(undefined);
    renderScreen({
      couple: { ...CREATOR, inviteCode: '', inviteExpiresAt: null },
      reissueCoupleInvite,
    });

    await user.click(screen.getByRole('button', { name: '새 코드 받기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('다시 시도');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(reissueCoupleInvite).toHaveBeenCalledTimes(2);
    expect(reissueCoupleInvite.mock.calls[0][0]).toEqual(reissueCoupleInvite.mock.calls[1][0]);
    expect(reissueCoupleInvite.mock.calls[0][0].requestKey).toEqual(expect.any(String));
    expect(await screen.findByRole('status')).toHaveTextContent('새 초대 코드를 만들었어요.');
  });
});

describe('OnboardingShare completion and reload recovery', () => {
  it('시작하기 연속 탭을 한 완료 작업으로 막고 홈으로 이동한다', async () => {
    const pending = deferred();
    const completeOnboarding = vi.fn().mockReturnValue(pending.promise);
    renderScreen({ completeOnboarding });

    const button = screen.getByRole('button', { name: '시작하기' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '시작하는 중…' })).toBeDisabled();

    pending.resolve();
    await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent('/'));
  });

  it.each([ERROR_CODES.network, ERROR_CODES.rate_limited])(
    '%s 완료 실패에 원본 오류 대신 재시도를 제공한다',
    async (code) => {
      const user = userEvent.setup();
      const completeOnboarding = vi
        .fn()
        .mockRejectedValueOnce(new AppError(code, { message: 'apikey=do-not-show' }))
        .mockResolvedValueOnce(undefined);
      renderScreen({ completeOnboarding });

      await user.click(screen.getByRole('button', { name: '시작하기' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('다시 시도');
      expect(alert).not.toHaveTextContent('apikey');
      await user.click(screen.getByRole('button', { name: '다시 시도' }));

      expect(completeOnboarding).toHaveBeenCalledTimes(2);
      expect(await screen.findByTestId('destination')).toHaveTextContent('/');
    },
  );

  it.each([
    [{ coupleId: null, connected: false, onboarded: false, inviteCode: '', me: { name: '' } }, '/onboarding:undefined'],
    [{ ...CREATOR, onboarded: false, me: { name: '' } }, '/onboarding/name:false'],
    [{ ...CREATOR, connected: true }, '/:undefined'],
  ])('deep link를 복원된 store 상태에 맞는 경로로 돌려보낸다', async (couple, destination) => {
    renderScreen({ couple });

    expect(await screen.findByTestId('destination')).toHaveTextContent(destination);
  });
});

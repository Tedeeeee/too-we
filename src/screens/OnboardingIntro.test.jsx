import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp } from '@/data/store';
import OnboardingIntro from './OnboardingIntro';

vi.mock('@/data/store', () => ({ useApp: vi.fn() }));

const NO_COUPLE = {
  coupleId: null,
  connected: false,
  onboarded: false,
  inviteCode: '',
  me: { name: '' },
};

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
  const location = useLocation();
  return <div data-testid="destination">{`${location.pathname}:${String(location.state?.invited)}`}</div>;
}

function renderScreen(app = {}, path = '/onboarding') {
  useApp.mockReturnValue({
    couple: NO_COUPLE,
    startNewCouple: vi.fn(),
    ...app,
  });

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingIntro />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('OnboardingIntro creator flow', () => {
  it('새 커플을 한 번 만들고 creator 이름 경로로 이동한다', async () => {
    const user = userEvent.setup();
    const startNewCouple = vi.fn().mockResolvedValue(undefined);
    renderScreen({ startNewCouple });

    await user.click(screen.getByRole('button', { name: '시작하기' }));

    expect(startNewCouple).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('destination')).toHaveTextContent('/onboarding/name:false');
  });

  it('처리 중 연속 탭을 한 작업으로 막고 버튼을 비활성화한다', async () => {
    const pending = deferred();
    const startNewCouple = vi.fn().mockReturnValue(pending.promise);
    renderScreen({ startNewCouple });

    const button = screen.getByRole('button', { name: '시작하기' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(startNewCouple).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '시작하는 중…' })).toBeDisabled();

    pending.resolve();
    await waitFor(() => expect(screen.getByTestId('destination')).toBeInTheDocument());
  });

  it('네트워크 실패에 원본 오류 대신 재시도 안내를 표시한다', async () => {
    const user = userEvent.setup();
    const raw = 'postgres://secret.invalid?apikey=do-not-show';
    const startNewCouple = vi.fn().mockRejectedValue(
      new AppError(ERROR_CODES.network, { message: raw }),
    );
    renderScreen({ startNewCouple });

    await user.click(screen.getByRole('button', { name: '시작하기' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('네트워크 연결을 확인하고 다시 시도해 주세요.');
    expect(alert).not.toHaveTextContent(raw);
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeEnabled();
  });

  it.each([
    [
      { ...NO_COUPLE, coupleId: 'couple-1', inviteCode: '482195' },
      '/onboarding/name:false',
    ],
    [
      {
        ...NO_COUPLE,
        coupleId: 'couple-1',
        connected: true,
        me: { name: '' },
      },
      '/onboarding/name:true',
    ],
    [
      {
        ...NO_COUPLE,
        coupleId: 'couple-1',
        onboarded: true,
        inviteCode: '482195',
        me: { name: '지은' },
      },
      '/onboarding/share:undefined',
    ],
    [
      {
        ...NO_COUPLE,
        coupleId: 'couple-1',
        onboarded: true,
        inviteCode: '',
        me: { name: '지은' },
      },
      '/onboarding/share:undefined',
    ],
    [
      {
        ...NO_COUPLE,
        coupleId: 'couple-1',
        connected: true,
        onboarded: true,
        me: { name: '지은' },
      },
      '/:undefined',
    ],
  ])('복원된 커플 상태에서 올바른 경로로 복구한다', async (couple, destination) => {
    renderScreen({ couple });

    expect(await screen.findByTestId('destination')).toHaveTextContent(destination);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp } from '@/data/store';
import OnboardingName from './OnboardingName';

vi.mock('@/data/store', () => ({ useApp: vi.fn() }));

const CREATOR = {
  coupleId: 'couple-1',
  connected: false,
  onboarded: false,
  inviteCode: '482195',
  me: { name: '' },
};

const JOINER = {
  ...CREATOR,
  connected: true,
  inviteCode: '',
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function Destination() {
  const location = useLocation();
  return <div data-testid="destination">{location.pathname}</div>;
}

function renderScreen({ app = {}, state } = {}) {
  useApp.mockReturnValue({
    couple: CREATOR,
    setMyName: vi.fn(),
    completeOnboarding: vi.fn(),
    ...app,
  });

  const entry = { pathname: '/onboarding/name' };
  if (state !== undefined) entry.state = state;

  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/onboarding/name" element={<OnboardingName />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('OnboardingName persistence and routing', () => {
  it('creator 이름을 store에 저장하고 공유 경로로 이동한다', async () => {
    const user = userEvent.setup();
    const setMyName = vi.fn().mockResolvedValue(undefined);
    const completeOnboarding = vi.fn();
    renderScreen({ app: { setMyName, completeOnboarding }, state: { invited: false } });

    await user.type(screen.getByRole('textbox', { name: '이름' }), '  지은  ');
    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(setMyName).toHaveBeenCalledWith('지은');
    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(await screen.findByTestId('destination')).toHaveTextContent('/onboarding/share');
  });

  it('joiner 이름을 저장하고 온보딩을 완료한 뒤 홈으로 이동한다', async () => {
    const user = userEvent.setup();
    const setMyName = vi.fn().mockResolvedValue(undefined);
    const completeOnboarding = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      app: { couple: JOINER, setMyName, completeOnboarding },
      state: { invited: true },
    });

    await user.type(screen.getByRole('textbox', { name: '이름' }), '민수');
    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(setMyName).toHaveBeenCalledWith('민수');
    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('destination')).toHaveTextContent('/');
  });

  it.each([
    [CREATOR, '/onboarding/share'],
    [JOINER, '/'],
  ])('location state가 없어도 복원된 역할로 제출 경로를 결정한다', async (couple, destination) => {
    const user = userEvent.setup();
    const setMyName = vi.fn().mockResolvedValue(undefined);
    const completeOnboarding = vi.fn().mockResolvedValue(undefined);
    renderScreen({ app: { couple, setMyName, completeOnboarding } });

    await user.type(screen.getByRole('textbox', { name: '이름' }), '다정');
    await user.click(screen.getByRole('button', { name: '다음' }));

    expect(await screen.findByTestId('destination')).toHaveTextContent(destination);
    expect(completeOnboarding).toHaveBeenCalledTimes(couple.connected ? 1 : 0);
  });

  it.each([
    [{ ...CREATOR, onboarded: true, me: { name: '지은' } }, '/onboarding/share'],
    [{ ...JOINER, onboarded: true, me: { name: '민수' } }, '/'],
    [{ coupleId: null, connected: false, onboarded: false, inviteCode: '', me: { name: '' } }, '/onboarding'],
  ])('새로고침 뒤 저장된 store 상태에서 필요한 화면으로 복구한다', async (couple, destination) => {
    renderScreen({ app: { couple } });

    expect(await screen.findByTestId('destination')).toHaveTextContent(destination);
  });

  it('이름을 1~12자로 제한하고 공백만 있는 제출은 비활성화한다', () => {
    renderScreen();

    const input = screen.getByRole('textbox', { name: '이름' });
    const button = screen.getByRole('button', { name: '다음' });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: '            ' } });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: '가나다라마바사아자차카타파' } });
    expect(input).toHaveValue('가나다라마바사아자차카타');
    expect(screen.getByText('12/12')).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('처리 중 연속 탭을 한 이름 저장 작업으로 막는다', async () => {
    const pending = deferred();
    const setMyName = vi.fn().mockReturnValue(pending.promise);
    renderScreen({ app: { setMyName }, state: { invited: false } });
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), {
      target: { value: '지은' },
    });

    const button = screen.getByRole('button', { name: '다음' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(setMyName).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '저장하는 중…' })).toBeDisabled();

    pending.resolve();
    await waitFor(() => expect(screen.getByTestId('destination')).toBeInTheDocument());
  });

  it.each([ERROR_CODES.network, ERROR_CODES.rate_limited])(
    '%s 이름 저장 실패 뒤 입력을 유지하고 재시도한다',
    async (code) => {
      const user = userEvent.setup();
      const setMyName = vi
        .fn()
        .mockRejectedValueOnce(new AppError(code, { message: 'apikey=do-not-show' }))
        .mockResolvedValueOnce(undefined);
      renderScreen({ app: { setMyName }, state: { invited: false } });

      const input = screen.getByRole('textbox', { name: '이름' });
      await user.type(input, '지은');
      await user.click(screen.getByRole('button', { name: '다음' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('다시 시도');
      expect(input).toHaveValue('지은');
      expect(screen.queryByText(/apikey/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: '다시 시도' }));

      expect(setMyName).toHaveBeenCalledTimes(2);
      expect(await screen.findByTestId('destination')).toHaveTextContent('/onboarding/share');
    },
  );

  it('joiner 완료 단계만 실패하면 재시도에서 이미 저장한 이름을 다시 쓰지 않는다', async () => {
    const user = userEvent.setup();
    const setMyName = vi.fn().mockResolvedValue(undefined);
    const completeOnboarding = vi
      .fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network))
      .mockResolvedValueOnce(undefined);
    renderScreen({
      app: { couple: JOINER, setMyName, completeOnboarding },
      state: { invited: true },
    });

    const input = screen.getByRole('textbox', { name: '이름' });
    await user.type(input, '민수');
    await user.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('다시 시도');
    expect(input).toHaveValue('민수');

    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(setMyName).toHaveBeenCalledTimes(1);
    expect(completeOnboarding).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId('destination')).toHaveTextContent('/');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp } from '@/data/store';
import OnboardingCode from './OnboardingCode';

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
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function joinError(domainCode, code) {
  const error = new AppError(code, { message: 'SQL apikey=do-not-show' });
  error.domainCode = domainCode;
  return error;
}

function Destination() {
  const location = useLocation();
  return <div data-testid="destination">{`${location.pathname}:${String(location.state?.invited)}`}</div>;
}

function renderScreen(app = {}) {
  useApp.mockReturnValue({
    couple: NO_COUPLE,
    connectWithCode: vi.fn(),
    ...app,
  });

  return render(
    <MemoryRouter initialEntries={['/onboarding/code']}>
      <Routes>
        <Route path="/onboarding/code" element={<OnboardingCode />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPersistentScreen(app = {}) {
  useApp.mockReturnValue({
    couple: NO_COUPLE,
    connectWithCode: vi.fn(),
    ...app,
  });

  return render(
    <MemoryRouter initialEntries={['/onboarding/code']}>
      <OnboardingCode />
      <Destination />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('OnboardingCode joiner flow', () => {
  it('fabricated inviter 없이 숫자 여섯 자리만 받아 연결하고 이름 경로로 이동한다', async () => {
    const user = userEvent.setup();
    const connectWithCode = vi.fn().mockResolvedValue(undefined);
    renderScreen({ connectWithCode });

    expect(screen.getByText('초대한 사람이 당신을 기다리고 있어요')).toBeInTheDocument();
    expect(screen.queryByText(/지은님이/)).not.toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: '초대 코드' });
    await user.type(input, '48a21-95');
    expect(input).toHaveValue('482195');
    await user.click(screen.getByRole('button', { name: '연결하기' }));

    expect(connectWithCode).toHaveBeenCalledTimes(1);
    expect(connectWithCode).toHaveBeenCalledWith('482195', {
      requestKey: expect.any(String),
    });
    expect(connectWithCode.mock.calls[0][1].requestKey).not.toBe('');
    expect(await screen.findByTestId('destination')).toHaveTextContent('/onboarding/name:true');
  });

  it('여섯 자리가 아니면 연결 버튼을 비활성화한다', async () => {
    const user = userEvent.setup();
    renderScreen();

    const button = screen.getByRole('button', { name: '연결하기' });
    expect(button).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: '초대 코드' }), '12345');
    expect(button).toBeDisabled();
  });

  it('처리 중 연속 탭을 한 연결 작업으로 막는다', async () => {
    const pending = deferred();
    const connectWithCode = vi.fn().mockReturnValue(pending.promise);
    renderScreen({ connectWithCode });
    fireEvent.change(screen.getByRole('textbox', { name: '초대 코드' }), {
      target: { value: '482195' },
    });

    const button = screen.getByRole('button', { name: '연결하기' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(connectWithCode).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '연결하는 중…' })).toBeDisabled();

    pending.resolve();
    await waitFor(() => expect(screen.getByTestId('destination')).toBeInTheDocument());
  });

  it.each([
    ['invite_not_found', ERROR_CODES.not_found, '초대 코드를 찾을 수 없어요'],
    ['invite_expired', ERROR_CODES.validation, '초대 코드가 만료됐어요'],
    ['invite_consumed', ERROR_CODES.conflict, '이미 사용된 초대 코드예요'],
    ['invite_revoked', ERROR_CODES.validation, '더 이상 사용할 수 없는 초대 코드예요'],
    ['invite_own_couple', ERROR_CODES.conflict, '내 커플의 초대 코드는 사용할 수 없어요'],
    ['couple_capacity_reached', ERROR_CODES.conflict, '이미 두 명이 연결된 커플이에요'],
    ['active_membership_conflict', ERROR_CODES.conflict, '이미 연결된 커플이 있어요'],
  ])('%s 오류를 안내하면서 입력한 여섯 자리를 유지한다', async (domainCode, code, message) => {
    const user = userEvent.setup();
    const connectWithCode = vi.fn().mockRejectedValue(joinError(domainCode, code));
    renderScreen({ connectWithCode });

    const input = screen.getByRole('textbox', { name: '초대 코드' });
    await user.type(input, '482195');
    await user.click(screen.getByRole('button', { name: '연결하기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('textbox', { name: '초대 코드' })).toHaveValue('482195');
    expect(screen.queryByText(/apikey/)).not.toBeInTheDocument();
  });

  it.each([ERROR_CODES.network, ERROR_CODES.rate_limited])(
    '%s 실패 뒤 여섯 자리를 유지하고 명시적으로 재시도한다',
    async (code) => {
      const user = userEvent.setup();
      const connectWithCode = vi
        .fn()
        .mockRejectedValueOnce(new AppError(code))
        .mockResolvedValueOnce(undefined);
      renderScreen({ connectWithCode });

      const input = screen.getByRole('textbox', { name: '초대 코드' });
      await user.type(input, '482195');
      await user.click(screen.getByRole('button', { name: '연결하기' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('다시 시도');
      expect(input).toHaveValue('482195');
      const firstRequestKey = connectWithCode.mock.calls[0][1].requestKey;
      expect(firstRequestKey).toEqual(expect.any(String));
      expect(firstRequestKey).not.toBe('');
      await user.click(screen.getByRole('button', { name: '다시 시도' }));

      expect(connectWithCode).toHaveBeenCalledTimes(2);
      expect(connectWithCode.mock.calls[1][1]).toEqual({ requestKey: firstRequestKey });
      expect(await screen.findByTestId('destination')).toHaveTextContent('/onboarding/name:true');
    },
  );

  it('실패 뒤 코드를 편집하면 새 join requestKey를 만든다', async () => {
    const user = userEvent.setup();
    const connectWithCode = vi
      .fn()
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network))
      .mockResolvedValueOnce(undefined);
    renderScreen({ connectWithCode });

    const input = screen.getByRole('textbox', { name: '초대 코드' });
    await user.type(input, '482195');
    await user.click(screen.getByRole('button', { name: '연결하기' }));
    await screen.findByRole('alert');
    const firstRequestKey = connectWithCode.mock.calls[0][1].requestKey;

    await user.clear(input);
    await user.type(input, '731904');
    await user.click(screen.getByRole('button', { name: '연결하기' }));

    expect(connectWithCode).toHaveBeenCalledTimes(2);
    expect(connectWithCode.mock.calls[1][0]).toBe('731904');
    expect(connectWithCode.mock.calls[1][1].requestKey).not.toBe(firstRequestKey);
  });

  it('성공한 join intent를 지우고 다음 연결에는 새 requestKey를 만든다', async () => {
    const user = userEvent.setup();
    const connectWithCode = vi.fn().mockResolvedValue(undefined);
    renderPersistentScreen({ connectWithCode });

    const input = screen.getByRole('textbox', { name: '초대 코드' });
    await user.type(input, '482195');
    await user.click(screen.getByRole('button', { name: '연결하기' }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/onboarding/name:true');
    const firstRequestKey = connectWithCode.mock.calls[0][1].requestKey;

    await user.click(screen.getByRole('button', { name: '연결하기' }));

    expect(connectWithCode).toHaveBeenCalledTimes(2);
    expect(connectWithCode.mock.calls[1][1].requestKey).not.toBe(firstRequestKey);
  });

  it.each([
    [
      { ...NO_COUPLE, coupleId: 'couple-1', connected: true },
      '/onboarding/name:true',
    ],
    [
      { ...NO_COUPLE, coupleId: 'couple-1', inviteCode: '482195' },
      '/onboarding/name:false',
    ],
    [
      {
        ...NO_COUPLE,
        coupleId: 'couple-1',
        onboarded: true,
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
  ])('새로고침으로 복원된 역할에 맞는 경로로 이동한다', async (couple, destination) => {
    renderScreen({ couple });

    expect(await screen.findByTestId('destination')).toHaveTextContent(destination);
  });
});

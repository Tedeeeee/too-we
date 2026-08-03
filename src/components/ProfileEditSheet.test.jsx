import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import ProfileEditSheet from './ProfileEditSheet';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderSheet(overrides = {}) {
  const props = {
    name: '지은',
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn(),
    ...overrides,
  };

  render(<ProfileEditSheet {...props} />);
  return props;
}

describe('ProfileEditSheet accessibility and permissions', () => {
  it('현재 사용자 이름만 편집해 문자열 payload로 저장하고 카메라는 비활성 안내로 남긴다', async () => {
    const user = userEvent.setup();
    const props = renderSheet();

    expect(screen.getByRole('dialog', { name: '내 정보 수정하기' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    const camera = screen.getByRole('button', { name: '프로필 사진 변경은 아직 지원하지 않아요' });
    expect(camera).toBeDisabled();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByDisplayValue('태식')).not.toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: '내 이름' });
    await user.clear(input);
    await user.type(input, '  새 이름  ');
    await user.click(screen.getByRole('button', { name: '수정하기' }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith('새 이름');
  });

  it('복원된 이름이 비어 있으면 빈 프로필을 알리고 유효한 이름 전까지 저장하지 않는다', () => {
    const props = renderSheet({ name: '' });

    expect(screen.getByRole('img', { name: '등록된 이름 없음' })).toHaveTextContent('?');
    expect(screen.getByRole('textbox', { name: '내 이름' })).toHaveValue('');
    expect(screen.getByRole('button', { name: '수정하기' })).toBeDisabled();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});

describe('ProfileEditSheet save recovery', () => {
  it('저장 실패 뒤 입력을 유지하고 raw 오류 없이 같은 이름을 재시도한다', async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(
        new AppError(ERROR_CODES.network, { message: 'apikey=do-not-show' }),
      )
      .mockResolvedValueOnce(undefined);
    renderSheet({ onSave });

    const input = screen.getByRole('textbox', { name: '내 이름' });
    await user.clear(input);
    await user.type(input, '새 이름');
    await user.click(screen.getByRole('button', { name: '수정하기' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('이름을 저장하지 못했어요');
    expect(alert).not.toHaveTextContent('apikey');
    expect(input).toHaveValue('새 이름');

    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenNthCalledWith(1, '새 이름');
    expect(onSave).toHaveBeenNthCalledWith(2, '새 이름');
  });

  it('저장 중 연속 제출을 한 번으로 막고 처리 상태를 알린다', async () => {
    const pending = deferred();
    const onSave = vi.fn().mockReturnValue(pending.promise);
    renderSheet({ onSave });

    fireEvent.change(screen.getByRole('textbox', { name: '내 이름' }), {
      target: { value: '새 이름' },
    });
    const save = screen.getByRole('button', { name: '수정하기' });
    act(() => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();

    await act(async () => pending.resolve());
  });
});

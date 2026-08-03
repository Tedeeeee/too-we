import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import BottomNav from './BottomNav';

describe('BottomNav actions', () => {
  it('가운데 더하기는 새 기록 동작만 호출한다', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onMap = vi.fn();

    render(<BottomNav onAdd={onAdd} onMap={onMap} onHome={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '새 기록' }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onMap).not.toHaveBeenCalled();
  });

  it('지도 아이콘은 둘러보기 동작만 호출한다', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onMap = vi.fn();

    render(<BottomNav onAdd={onAdd} onMap={onMap} onHome={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '지도' }));

    expect(onMap).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

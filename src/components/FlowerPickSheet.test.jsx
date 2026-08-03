import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FlowerPickSheet from './FlowerPickSheet';

describe('FlowerPickSheet', () => {
  it('서버 선택을 접근 가능하게 표시하고 같은 꽃을 다시 누르면 null을 선택한다', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FlowerPickSheet selected="rose" onSelect={onSelect} onConfirm={vi.fn()} />,
    );

    const rose = screen.getByRole('button', { name: '장미 꽃갈피' });
    expect(rose).toHaveAttribute('aria-pressed', 'true');

    await user.click(rose);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('선택 없음도 확정할 수 있고 저장 중에는 상태와 비활성화를 알린다', () => {
    const { rerender } = render(
      <FlowerPickSheet selected={null} onSelect={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: '선택하기' })).toBeEnabled();

    rerender(
      <FlowerPickSheet selected={null} onSelect={vi.fn()} onConfirm={vi.fn()} saving />,
    );
    expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('꽃갈피를 저장하고 있어요');
  });
});

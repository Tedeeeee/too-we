import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FlowerRating from './FlowerRating';

describe('FlowerRating optional selection', () => {
  it('선택 없음에서 점수를 고르고 같은 점수를 다시 눌러 해제한다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <FlowerRating value={0} onChange={onChange} allowClear />,
    );

    const three = screen.getByRole('button', { name: '3점' });
    expect(three).toHaveAttribute('aria-pressed', 'false');

    await user.click(three);
    expect(onChange).toHaveBeenLastCalledWith(3);

    rerender(<FlowerRating value={3} onChange={onChange} allowClear />);
    expect(screen.getByRole('button', { name: '3점' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '3점' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('읽기 전용 별점은 수정 버튼을 만들지 않는다', () => {
    render(<FlowerRating value={2} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

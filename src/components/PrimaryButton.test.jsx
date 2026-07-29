import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PrimaryButton from './PrimaryButton';

describe('PrimaryButton', () => {
  it('renders its label and handles a click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<PrimaryButton label="시작하기" onClick={onClick} />);

    const button = screen.getByRole('button', { name: '시작하기' });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

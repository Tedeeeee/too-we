import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Placeholder from './Placeholder';

describe('Placeholder image state', () => {
  it('private signed URL image를 렌더하고 로드 실패를 안전한 fallback으로 바꾼다', () => {
    const onImageError = vi.fn();
    render(
      <Placeholder
        src="https://signed.invalid/photo-1"
        alt="장소 사진 1"
        label="사진을 불러오지 못했어요"
        width={402}
        height={280}
        onImageError={onImageError}
      />,
    );

    const image = screen.getByRole('img', { name: '장소 사진 1' });
    expect(image).toHaveAttribute('src', 'https://signed.invalid/photo-1');
    expect(screen.queryByText('사진을 불러오지 못했어요')).not.toBeInTheDocument();

    fireEvent.error(image);

    expect(onImageError).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img', { name: '장소 사진 1' })).not.toBeInTheDocument();
    expect(screen.getByText('사진을 불러오지 못했어요')).toBeInTheDocument();
  });

  it('retryKey가 바뀌면 같은 signed URL도 다시 시도한다', () => {
    const { rerender } = render(
      <Placeholder
        src="https://signed.invalid/photo-1"
        alt="장소 사진 1"
        label="사진 오류"
        retryKey={0}
        width={402}
        height={280}
      />,
    );
    fireEvent.error(screen.getByRole('img', { name: '장소 사진 1' }));
    expect(screen.getByText('사진 오류')).toBeInTheDocument();

    rerender(
      <Placeholder
        src="https://signed.invalid/photo-1"
        alt="장소 사진 1"
        label="사진 오류"
        retryKey={1}
        width={402}
        height={280}
      />,
    );

    expect(screen.getByRole('img', { name: '장소 사진 1' })).toBeInTheDocument();
  });
});

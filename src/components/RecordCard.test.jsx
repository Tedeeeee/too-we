import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RecordCard from './RecordCard';

const record = (overrides = {}) => ({
  id: 'visit-1',
  placeName: '성수 카페',
  category: '카페',
  date: '2026-08-03T03:00:00.000Z',
  rating: 4,
  flower: null,
  tags: [],
  photos: [],
  ...overrides,
});

describe('RecordCard photo thumbnail', () => {
  it('ordinal이 가장 빠른 repository signedUrl 사진을 표시한다', () => {
    render(
      <RecordCard
        record={record({
          photos: [
            { id: 'later', ordinal: 2, url: 'https://signed.invalid/later' },
            { id: 'first', ordinal: 1, signedUrl: 'https://signed.invalid/first' },
          ],
        })}
        top={0}
      />,
    );

    expect(screen.getByRole('img', { name: '성수 카페 사진' })).toHaveAttribute(
      'src',
      'https://signed.invalid/first',
    );
  });

  it('repository URL 없이 storage path만 있으면 기존 시각 placeholder를 유지한다', () => {
    const { container } = render(
      <RecordCard
        record={record({
          photos: [{ id: 'private-path', ordinal: 1, path: 'couple/visit/private.webp' }],
        })}
        top={0}
      />,
    );

    expect(screen.queryByRole('img', { name: '성수 카페 사진' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-record-photo-placeholder]')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('couple/visit/private.webp');
  });

  it('signed photo 로드가 실패하면 기존 시각 placeholder로 교체한다', () => {
    const { container } = render(
      <RecordCard
        record={record({
          photos: [{ id: 'photo-1', ordinal: 1, url: 'https://signed.invalid/broken' }],
        })}
        top={0}
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: '성수 카페 사진' }));

    expect(screen.queryByRole('img', { name: '성수 카페 사진' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-record-photo-placeholder]')).toBeInTheDocument();
  });
});

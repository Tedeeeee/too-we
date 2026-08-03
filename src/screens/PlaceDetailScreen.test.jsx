import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp, useRecord } from '@/data/store';
import PlaceDetailScreen from './PlaceDetailScreen';

vi.mock('@/data/store', () => ({ useApp: vi.fn(), useRecord: vi.fn() }));

const RECORD = {
  id: 'visit-1',
  placeName: '사진 장소',
  date: '2026-08-03T09:25:00.000Z',
  rating: 4,
  flower: null,
  tags: [],
  photos: [
    { id: 'late', order: 2, url: 'https://signed.invalid/late' },
    { id: 'first', order: 1, url: 'https://signed.invalid/first' },
  ],
  entries: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  useApp.mockReturnValue({
    ready: true,
    retryBootstrap: vi.fn().mockResolvedValue(undefined),
    couple: {
      me: { name: '나', initial: '나' },
      partner: { name: '짝궁', initial: '짝' },
    },
  });
  useRecord.mockReturnValue(RECORD);
});

describe('PlaceDetailScreen photo carousel', () => {
  it('정렬된 실제 사진을 순환하고 개수 표기를 맞춘다', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/place/visit-1']}>
        <Routes>
          <Route path="/place/:recordId" element={<PlaceDetailScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '사진 장소 사진 1/2' })).toHaveAttribute(
      'src',
      'https://signed.invalid/first',
    );

    await user.click(screen.getByRole('button', { name: '다음 사진' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '사진 장소 사진 2/2' })).toHaveAttribute(
      'src',
      'https://signed.invalid/late',
    );
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEASONS } from '@/styles/tokens';
import { useApp, useRecord } from '@/data/store';
import PlaceDetailScreen from './PlaceDetailScreen';

const seasonBg = (key) => SEASONS.find((season) => season.key === key).bg;

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

describe('PlaceDetailScreen season from the visit month', () => {
  // 시안의 봄/여름/가을/겨울 4화면은 배경색만 다르다. 계절은 기상학적 3개월 묶음
  // (3~5 봄 / 6~8 여름 / 9~11 가을 / 12·1·2 겨울)이고 겨울만 해를 넘어간다.
  // 날짜는 월 중순으로 골라 실행 환경의 시간대가 월을 넘기지 못하게 한다.
  it.each([
    ['2026-03-15T03:00:00.000Z', 'spring'],
    ['2026-07-15T03:00:00.000Z', 'summer'],
    ['2026-10-15T03:00:00.000Z', 'autumn'],
    ['2026-12-15T03:00:00.000Z', 'winter'],
    ['2026-01-15T03:00:00.000Z', 'winter'],
    ['2026-02-15T03:00:00.000Z', 'winter'],
  ])('%s 기록은 %s 배경으로 연다', (date, expectedSeason) => {
    useRecord.mockReturnValue({ ...RECORD, date });

    const { container } = render(
      <MemoryRouter initialEntries={['/place/visit-1']}>
        <Routes>
          <Route path="/place/:recordId" element={<PlaceDetailScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(container.firstChild).toHaveStyle({ background: seasonBg(expectedSeason) });
  });

  it('12월과 이듬해 1월을 같은 겨울 배경으로 유지한다', () => {
    const backgrounds = ['2025-12-20T03:00:00.000Z', '2026-01-05T03:00:00.000Z'].map((date) => {
      useRecord.mockReturnValue({ ...RECORD, date });
      const { container, unmount } = render(
        <MemoryRouter initialEntries={['/place/visit-1']}>
          <Routes>
            <Route path="/place/:recordId" element={<PlaceDetailScreen />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(container.firstChild).toHaveStyle({ background: seasonBg('winter') });
      const { background } = container.firstChild.style;
      unmount();
      return background;
    });

    expect(new Set(backgrounds).size).toBe(1);
  });
});

describe('PlaceDetailScreen unreachable record', () => {
  it('커플 기록에 없는 id로 들어오면 상세를 그리지 않고 홈으로 되돌린다', () => {
    useRecord.mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={['/place/other-couple-visit']}>
        <Routes>
          <Route path="/" element={<div>홈 화면</div>} />
          <Route path="/place/:recordId" element={<PlaceDetailScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('홈 화면')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /사진/ })).not.toBeInTheDocument();
  });

  it('아직 준비되지 않은 상태에서는 홈으로 되돌리지 않고 기다린다', () => {
    useApp.mockReturnValue({
      ready: false,
      retryBootstrap: vi.fn(),
      couple: null,
    });
    useRecord.mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={['/place/visit-1']}>
        <Routes>
          <Route path="/" element={<div>홈 화면</div>} />
          <Route path="/place/:recordId" element={<PlaceDetailScreen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('홈 화면')).not.toBeInTheDocument();
  });
});

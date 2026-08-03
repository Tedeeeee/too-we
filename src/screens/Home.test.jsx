import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '@/data/store';
import Home from './Home';

vi.mock('@/data/store', () => ({ useApp: vi.fn() }));

const COUPLE = {
  me: { initial: '나', color: '#E4D2BA' },
  partner: { initial: '너', color: '#F3BCBC' },
};

const record = (overrides = {}) => ({
  id: 'visit-1',
  placeName: '성수 카페',
  date: '2026-08-03T03:00:00.000Z',
  pending: true,
  rating: 0,
  flower: null,
  tags: [],
  photos: [],
  entries: [],
  ...overrides,
});

let destinationLocation;

function Destination() {
  destinationLocation = useLocation();
  return <div>목적지 화면</div>;
}

function renderHome(app = {}) {
  useApp.mockReturnValue({ couple: COUPLE, records: [], ...app });

  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/map" element={<Destination />} />
        <Route path="/record" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  destinationLocation = null;
});

describe('Home new visit navigation', () => {
  it('아래 더하기 버튼만 new-record intent로 지도를 연다', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: '새 기록' }));

    expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
    expect(destinationLocation.pathname).toBe('/map');
    expect(destinationLocation.state).toEqual({ intent: 'new-record' });
  });

  it('지도 아이콘은 intent 없이 둘러보기 지도를 연다', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: '지도' }));

    expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
    expect(destinationLocation.pathname).toBe('/map');
    expect(destinationLocation.state).toBeNull();
  });

  it('장식용 빈 카드는 아래 더하기 안내만 하고 이동하지 않는다', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByText('아래 + 버튼으로 새 기록을 시작해요'));

    expect(screen.getByText('오늘,우리는')).toBeInTheDocument();
    expect(destinationLocation).toBeNull();
  });
});

describe('Home pending partition', () => {
  it('대기 기록은 한 줄 안내와 접근 가능한 CTA로 recordId만 전달한다', async () => {
    const user = userEvent.setup();
    const pending = record({ id: 'pending-line', placeName: '한 줄 대기 장소' });
    const { container } = renderHome({ records: [pending] });
    const pendingCard = container.querySelector('[data-pending-card]');

    expect(within(pendingCard).getByText('오늘의 한 줄을 남겨주세요')).toBeInTheDocument();
    await user.click(within(pendingCard).getByRole('button', { name: '한 줄을 남겨주세요' }));

    expect(await screen.findByText('목적지 화면')).toBeInTheDocument();
    expect(destinationLocation.pathname).toBe('/record');
    expect(destinationLocation.state).toEqual({ recordId: 'pending-line' });
  });

  it('entries나 공동 꾸밈 데이터가 아니라 현재 사용자용 pending만 따른다', () => {
    const pending = record({
      id: 'pending',
      placeName: '대기 장소',
      pending: true,
      rating: 5,
      flower: 'rose',
      tags: ['데이트'],
      photos: [{ id: 'photo-1' }],
      entries: [{ memberId: 'me', text: '옛 파생값' }],
    });
    const complete = record({
      id: 'complete',
      placeName: '완료 장소',
      pending: false,
      entries: [],
    });

    const { container } = renderHome({ records: [pending, complete] });
    const carousel = container.querySelector('[data-pending-carousel]');
    const monthList = container.querySelector('[data-home-month-list]');

    expect(within(carousel).getByText('대기 장소')).toBeInTheDocument();
    expect(within(carousel).queryByText('완료 장소')).not.toBeInTheDocument();
    expect(within(monthList).getByText('완료 장소')).toBeInTheDocument();
    expect(within(monthList).queryByText('대기 장소')).not.toBeInTheDocument();
  });

  it('아직 데이터가 없는 로딩 형태도 빈 카드로 안전하게 렌더링한다', () => {
    expect(() => renderHome({ couple: null, records: undefined })).not.toThrow();
    expect(screen.getByText('아래 + 버튼으로 새 기록을 시작해요')).toBeInTheDocument();
  });
});

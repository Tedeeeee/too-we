import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp } from '@/data/store';
import * as api from '@/data/api';
import MapSelect from './MapSelect';

const mapViewCalls = vi.hoisted(() => vi.fn());

vi.mock('@/data/store', () => ({ useApp: vi.fn() }));
vi.mock('@/data/api', () => ({ getNearbyPlaces: vi.fn() }));
vi.mock('@/components/MapView', () => ({
  default: (props) => {
    mapViewCalls(props);
    return (
      <div aria-label="지도 테스트 대역">
        {props.markers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            onClick={() => props.onMarkerClick?.(marker.id)}
          >
            지도에서 {marker.name} 선택
          </button>
        ))}
      </div>
    );
  },
}));

const PLACE = {
  id: '28720295',
  name: '블루보틀 성수 카페',
  category: '음식점 > 카페',
  address: '서울 성동구 성수동1가 656-439',
  roadAddress: '서울 성동구 아차산로 7',
  phone: '02-6212-6998',
  url: 'https://place.map.kakao.com/28720295',
  lat: 37.5446137523921,
  lng: 127.055978290073,
  provider: 'kakao',
};

const SECOND_PLACE = {
  ...PLACE,
  id: 'second-place',
  name: '서울숲 작은 카페',
  lat: 37.546,
  lng: 127.049,
};

const EDIT_DRAFT = {
  place: { ...SECOND_PLACE },
  date: '2026-08-08',
  time: '20:40',
  flower: 'lilac',
  tags: ['# 첫째', '# 셋째'],
  text: '지도 왕복 draft',
  rating: 5,
};

const originalGeolocation = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  'geolocation',
);

let destinationLocation = null;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setGeolocation(getCurrentPosition) {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: getCurrentPosition ? { getCurrentPosition } : undefined,
  });
}

function Destination() {
  destinationLocation = useLocation();
  return <div>새 기록 화면</div>;
}

function renderMap({ intent, recordId, draft, strict = false } = {}) {
  const entry = intent
    ? {
        pathname: '/map',
        state: {
          intent,
          ...(recordId ? { recordId } : {}),
          ...(draft ? { draft } : {}),
        },
      }
    : { pathname: '/map' };
  const content = (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/map" element={<MapSelect />} />
        <Route path="/record" element={<Destination />} />
        <Route path="/place/:recordId/edit" element={<Destination />} />
      </Routes>
    </MemoryRouter>
  );

  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}

function latestMapProps() {
  return mapViewCalls.mock.calls.at(-1)?.[0];
}

function resultName(place) {
  return `${place.name} 결과 선택`;
}

async function submitKeyword(user, keyword) {
  const input = screen.getByRole('searchbox', { name: '장소 검색어' });
  await user.clear(input);
  await user.type(input, keyword);
  await user.click(screen.getByRole('button', { name: '장소 검색' }));
  return input;
}

beforeEach(() => {
  vi.resetAllMocks();
  destinationLocation = null;
  useApp.mockReturnValue({ records: [] });
  setGeolocation(vi.fn((_success, error) => error({ code: 1 })));
});

afterAll(() => {
  if (originalGeolocation) {
    Object.defineProperty(globalThis.navigator, 'geolocation', originalGeolocation);
  } else {
    delete globalThis.navigator.geolocation;
  }
});

describe('MapSelect keyword search', () => {
  it('trim한 키워드로 명시적으로 검색하고 로딩 뒤 결과와 같은 마커를 표시한다', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    api.getNearbyPlaces.mockReturnValue(pending.promise);
    renderMap();

    await submitKeyword(user, '  성수 카페  ');

    expect(api.getNearbyPlaces).toHaveBeenCalledWith({ keyword: '성수 카페' });
    expect(screen.getByRole('status', { name: '검색 상태' })).toHaveTextContent(
      '장소를 찾고 있어요',
    );

    await act(async () => pending.resolve([{ ...PLACE }]));

    expect(
      await screen.findByRole('button', { name: resultName(PLACE) }),
    ).toBeInTheDocument();
    expect(latestMapProps().markers).toEqual([
      expect.objectContaining({ id: PLACE.id, name: PLACE.name, lat: PLACE.lat, lng: PLACE.lng }),
    ]);
  });

  it('빈 결과를 안전한 안내로 표시한다', async () => {
    const user = userEvent.setup();
    api.getNearbyPlaces.mockResolvedValue([]);
    renderMap();

    await submitKeyword(user, '없는 장소');

    expect(
      await screen.findByRole('status', { name: '검색 상태' }),
    ).toHaveTextContent('검색 결과가 없어요.');
    expect(screen.getByRole('searchbox', { name: '장소 검색어' })).toHaveValue('없는 장소');
  });

  it('오류 원문을 숨기고 같은 키워드로 명시적으로 재시도한다', async () => {
    const user = userEvent.setup();
    const raw = 'https://sdk.invalid?appkey=never-show-this-key';
    api.getNearbyPlaces
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network, { message: raw }))
      .mockResolvedValueOnce([{ ...PLACE }]);
    renderMap();

    const input = await submitKeyword(user, '성수 카페');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('장소를 불러오지 못했어요');
    expect(alert).not.toHaveTextContent('never-show-this-key');
    expect(input).toHaveValue('성수 카페');

    await user.click(screen.getByRole('button', { name: '검색 다시 시도' }));

    expect(api.getNearbyPlaces).toHaveBeenCalledTimes(2);
    expect(api.getNearbyPlaces).toHaveBeenLastCalledWith({ keyword: '성수 카페' });
    expect(
      await screen.findByRole('button', { name: resultName(PLACE) }),
    ).toBeInTheDocument();
  });

  it('느린 이전 검색이 빠른 최신 검색 결과를 덮어쓰지 않는다', async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    api.getNearbyPlaces
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderMap();

    await submitKeyword(user, '첫 검색');
    await submitKeyword(user, '둘째 검색');
    await act(async () => second.resolve([{ ...SECOND_PLACE }]));

    expect(
      await screen.findByRole('button', { name: resultName(SECOND_PLACE) }),
    ).toBeInTheDocument();

    await act(async () => first.resolve([{ ...PLACE }]));

    expect(screen.queryByRole('button', { name: resultName(PLACE) })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: resultName(SECOND_PLACE) })).toBeInTheDocument();
  });

  it('A-B-A 검색 순서에서 마지막 A 의도가 최종 결과를 결정한다', async () => {
    const user = userEvent.setup();
    const firstA = deferred();
    const requestB = deferred();
    api.getNearbyPlaces
      .mockReturnValueOnce(firstA.promise)
      .mockReturnValueOnce(requestB.promise);
    renderMap();

    await submitKeyword(user, 'A');
    await submitKeyword(user, 'B');
    await submitKeyword(user, 'A');

    expect(api.getNearbyPlaces).toHaveBeenCalledTimes(2);

    await act(async () => firstA.resolve([{ ...PLACE }]));
    await act(async () => requestB.resolve([{ ...SECOND_PLACE }]));

    expect(
      await screen.findByRole('button', { name: resultName(PLACE) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: resultName(SECOND_PLACE) })).not.toBeInTheDocument();
  });

  it('같은 검색이 처리 중일 때 중복 submit을 한 요청으로 억제한다', async () => {
    const pending = deferred();
    api.getNearbyPlaces.mockReturnValue(pending.promise);
    renderMap();
    const input = screen.getByRole('searchbox', { name: '장소 검색어' });
    fireEvent.change(input, { target: { value: '성수 카페' } });
    const form = input.closest('form');

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.getNearbyPlaces).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve([]));
  });
});

describe('MapSelect selection and route intent', () => {
  it('둘러보기 진입에서는 마커와 결과 선택만 연결하고 이동하지 않는다', async () => {
    const user = userEvent.setup();
    api.getNearbyPlaces.mockResolvedValue([{ ...PLACE }]);
    renderMap();
    await submitKeyword(user, '성수 카페');

    await user.click(await screen.findByRole('button', { name: `지도에서 ${PLACE.name} 선택` }));

    expect(screen.getByRole('button', { name: resultName(PLACE) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(latestMapProps().selectedId).toBe(PLACE.id);
    expect(screen.queryByText('새 기록 화면')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: resultName(PLACE) }));
    expect(screen.queryByText('새 기록 화면')).not.toBeInTheDocument();
  });

  it('new-record intent에서 전체 불변 스냅샷과 호환 필드를 /record로 전달한다', async () => {
    const user = userEvent.setup();
    api.getNearbyPlaces.mockResolvedValue([{ ...PLACE }]);
    renderMap({ intent: 'new-record' });
    await submitKeyword(user, '성수 카페');

    await user.click(await screen.findByRole('button', { name: resultName(PLACE) }));

    expect(await screen.findByText('새 기록 화면')).toBeInTheDocument();
    expect(destinationLocation.pathname).toBe('/record');
    expect(destinationLocation.state).toMatchObject({
      placeId: PLACE.id,
      name: PLACE.name,
      placeName: PLACE.name,
      category: PLACE.category,
      place: PLACE,
    });
    expect(destinationLocation.state.place).not.toBe(PLACE);
    expect(Object.isFrozen(destinationLocation.state.place)).toBe(true);
  });

  it('edit-record-place intent에서 선택한 전체 스냅샷만 원래 수정 화면으로 돌려준다', async () => {
    const user = userEvent.setup();
    const draft = { ...EDIT_DRAFT, partnerText: '전달하면 안 되는 짝궁 값' };
    api.getNearbyPlaces.mockResolvedValue([{ ...PLACE }]);
    renderMap({ intent: 'edit-record-place', recordId: 'visit-1', draft });
    await submitKeyword(user, '성수 카페');

    await user.click(await screen.findByRole('button', { name: resultName(PLACE) }));

    expect(await screen.findByText('새 기록 화면')).toBeInTheDocument();
    expect(destinationLocation.pathname).toBe('/place/visit-1/edit');
    expect(destinationLocation.state).toEqual({
      draft: {
        ...EDIT_DRAFT,
        place: PLACE,
      },
    });
    expect(destinationLocation.state.draft.place).not.toBe(PLACE);
    expect(destinationLocation.state.draft.tags).not.toBe(EDIT_DRAFT.tags);
    expect(Object.isFrozen(destinationLocation.state.draft)).toBe(true);
    expect(Object.isFrozen(destinationLocation.state.draft.place)).toBe(true);
    expect(Object.isFrozen(destinationLocation.state.draft.tags)).toBe(true);
    expect(JSON.stringify(destinationLocation.state)).not.toContain('전달하면 안 되는 짝궁 값');
  });
});

describe('MapSelect geolocation outcomes', () => {
  it('StrictMode에서도 위치 권한 요청은 한 번만 한다', () => {
    const getCurrentPosition = vi.fn();
    setGeolocation(getCurrentPosition);

    renderMap({ strict: true });

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('허용한 현재 위치를 지도 중심과 검색 옵션에 한 번만 반영한다', async () => {
    const user = userEvent.setup();
    let grantLocation;
    const getCurrentPosition = vi.fn((success) => {
      grantLocation = success;
    });
    setGeolocation(getCurrentPosition);
    api.getNearbyPlaces.mockResolvedValue([{ ...PLACE }]);
    renderMap();

    act(() => grantLocation({ coords: { latitude: 37.5, longitude: 127.05 } }));

    await waitFor(() => {
      expect(latestMapProps().center).toEqual({ lat: 37.5, lng: 127.05 });
    });
    expect(screen.getByText('현재 위치를 반영했어요.')).toBeInTheDocument();

    await submitKeyword(user, '성수 카페');

    expect(api.getNearbyPlaces).toHaveBeenCalledWith({
      keyword: '성수 카페',
      lat: 37.5,
      lng: 127.05,
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, '위치 권한 없이도'],
    [2, '현재 위치를 확인할 수 없어요'],
    [3, '현재 위치 확인이 늦어지고 있어요'],
  ])('위치 오류 code %s 뒤에도 키워드 검색과 선택을 유지한다', async (code, message) => {
    const user = userEvent.setup();
    setGeolocation(vi.fn((_success, error) => error({ code })));
    api.getNearbyPlaces.mockResolvedValue([{ ...PLACE }]);
    renderMap();

    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    await submitKeyword(user, '성수 카페');

    expect(api.getNearbyPlaces).toHaveBeenCalledWith({ keyword: '성수 카페' });
    const result = await screen.findByRole('button', { name: resultName(PLACE) });
    await user.click(result);
    expect(result).toHaveAttribute('aria-pressed', 'true');
  });
});

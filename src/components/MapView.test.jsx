import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadKakaoMapsSdk } from '@/data/kakao-maps';
import MapView from './MapView';

vi.mock('@/data/kakao-maps', () => ({
  loadKakaoMapsSdk: vi.fn(),
}));

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

// 지도 층 쌓임 계약: 지도 루트는 화면의 가장 아래 한 층이고, SDK가 컨테이너 안에
// 심는 높은 z-index pane은 그 층을 벗어나 형제 오버레이 위로 올라갈 수 없다.
const MAP_LAYER_Z_INDEX = 0;
const SDK_PANE_Z_INDEX = 10_000;

// jsdom은 지정하지 않은 z-index를 'auto'가 아니라 ''로 준다. 선언 없음을 null로 모아
// Number('') === 0에 속아 "0층으로 선언됨"으로 읽히는 일을 막는다.
function declaredZIndex(element) {
  const zIndex = getComputedStyle(element).zIndex;
  return zIndex === '' || zIndex === 'auto' ? null : Number(zIndex);
}

function createsStackingContext(element) {
  const style = getComputedStyle(element);
  if (style.isolation === 'isolate') return true;
  return style.position !== 'static' && declaredZIndex(element) !== null;
}

function nearestStackingContext(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (createsStackingContext(node)) return node;
  }
  return null;
}

function createSdkHarness() {
  const maps = [];
  const markers = [];
  const listeners = [];

  const Map = vi.fn(function KakaoMap(container, options) {
    this.container = container;
    this.options = options;
    this.setCenter = vi.fn();
    // 실제 Kakao SDK는 컨테이너 안에 z-index가 수천대인 pane을 직접 심는다.
    this.sdkPane = container.ownerDocument.createElement('div');
    this.sdkPane.style.position = 'absolute';
    this.sdkPane.style.inset = '0';
    this.sdkPane.style.zIndex = String(SDK_PANE_Z_INDEX);
    container.appendChild(this.sdkPane);
    maps.push(this);
  });

  const Marker = vi.fn(function KakaoMarker(options) {
    this.position = options.position;
    this.activeMap = options.map;
    this.setMap = vi.fn((map) => {
      this.activeMap = map;
    });
    this.setPosition = vi.fn((position) => {
      this.position = position;
    });
    this.setOpacity = vi.fn();
    this.setZIndex = vi.fn();
    markers.push(this);
  });

  class LatLng {
    constructor(lat, lng) {
      this.lat = lat;
      this.lng = lng;
    }
  }

  const event = {
    addListener: vi.fn((target, type, listener) => {
      listeners.push({ target, type, listener, removed: false });
    }),
    removeListener: vi.fn((target, type, listener) => {
      const registered = listeners.find(
        (entry) => entry.target === target && entry.type === type && entry.listener === listener,
      );
      if (registered) registered.removed = true;
    }),
  };

  return {
    sdk: { Map, Marker, LatLng, event },
    Map,
    Marker,
    maps,
    markers,
    listeners,
    event,
    click(marker) {
      const registered = listeners.find(
        (entry) => entry.target === marker && entry.type === 'click' && !entry.removed,
      );
      registered?.listener();
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MapView Kakao SDK lifecycle', () => {
  it('지도를 한 번 만들고 중심과 고유 마커를 갱신한 뒤 안전하게 정리한다', async () => {
    const harness = createSdkHarness();
    const onMarkerClick = vi.fn();
    loadKakaoMapsSdk.mockResolvedValue(harness.sdk);

    const { rerender, unmount } = render(
      <MapView
        center={{ lat: 37.1, lng: 127.1 }}
        markers={[
          { id: 'a', lat: 37.11, lng: 127.11 },
          { id: 'b', lat: 37.12, lng: 127.12 },
        ]}
        onMarkerClick={onMarkerClick}
      />,
    );

    await waitFor(() => expect(harness.Map).toHaveBeenCalledTimes(1));
    expect(harness.Map.mock.calls[0][1].center).toMatchObject({ lat: 37.1, lng: 127.1 });
    // Markers come from the effect that runs after the ready-state commit, not from the
    // SDK promise, so this needs its own wait rather than riding on the Map assertion.
    await waitFor(() =>
      expect(harness.markers.filter((marker) => marker.activeMap)).toHaveLength(2),
    );

    rerender(
      <MapView
        center={{ lat: 37.2, lng: 127.2 }}
        markers={[
          { id: 'a', lat: 37.21, lng: 127.21 },
          { id: 'a', lat: 99, lng: 99 },
          { id: 'c', lat: 37.23, lng: 127.23 },
        ]}
        selectedId="c"
        onMarkerClick={onMarkerClick}
      />,
    );

    await waitFor(() => {
      expect(harness.maps[0].setCenter).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 37.2, lng: 127.2 }),
      );
      const active = harness.markers.filter((marker) => marker.activeMap);
      expect(active).toHaveLength(2);
      expect(active.map((marker) => marker.position.lat).sort()).toEqual([37.21, 37.23]);
    });
    expect(harness.Map).toHaveBeenCalledTimes(1);

    const selectedMarker = harness.markers.find(
      (marker) => marker.activeMap && marker.position.lat === 37.23,
    );
    act(() => harness.click(selectedMarker));
    expect(onMarkerClick).toHaveBeenCalledWith('c');
    expect(selectedMarker.setZIndex).toHaveBeenLastCalledWith(2);

    unmount();
    expect(harness.markers.every((marker) => marker.activeMap === null)).toBe(true);
    expect(harness.event.removeListener).toHaveBeenCalled();
  });

  it('SDK가 심은 높은 z-index pane을 지도 기본 층 안에 가둔다', async () => {
    const harness = createSdkHarness();
    loadKakaoMapsSdk.mockResolvedValue(harness.sdk);

    const { container } = render(
      <MapView center={{ lat: 37.1, lng: 127.1 }} markers={[]} />,
    );
    const mapLayer = container.firstElementChild;

    expect(declaredZIndex(mapLayer)).toBe(MAP_LAYER_Z_INDEX);
    expect(createsStackingContext(mapLayer)).toBe(true);

    await waitFor(() => expect(harness.maps).toHaveLength(1));

    // pane 자체는 어떤 형제 오버레이보다 높은 z-index를 요구하지만,
    // 지도 층이 쌓임 문맥이라 그 요구는 이 층 안에서만 통해야 한다.
    const pane = harness.maps[0].sdkPane;
    expect(declaredZIndex(pane)).toBe(SDK_PANE_Z_INDEX);
    expect(nearestStackingContext(pane)).toBe(mapLayer);
  });

  it('SDK가 준비되기 전에 사라지면 지도를 만들지 않는다', async () => {
    const pending = deferred();
    const harness = createSdkHarness();
    loadKakaoMapsSdk.mockReturnValue(pending.promise);

    const { unmount } = render(
      <MapView center={{ lat: 37.1, lng: 127.1 }} markers={[]} />,
    );
    unmount();
    await act(async () => pending.resolve(harness.sdk));

    expect(harness.Map).not.toHaveBeenCalled();
  });

  it('SDK 실패는 원시 오류를 숨기고 마커 선택 가능한 접근성 폴백을 남긴다', async () => {
    const onMarkerClick = vi.fn();
    loadKakaoMapsSdk.mockRejectedValue(
      new Error('https://sdk.invalid?appkey=never-show-this-key'),
    );

    render(
      <MapView
        center={{ lat: 37.1, lng: 127.1 }}
        markers={[{ id: 'place-1', lat: 37.11, lng: 127.11, name: '성수 카페' }]}
        onMarkerClick={onMarkerClick}
      />,
    );

    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('아래 장소 목록'));
    expect(status).not.toHaveTextContent('never-show-this-key');

    fireEvent.click(screen.getByRole('button', { name: '성수 카페 선택' }));
    expect(onMarkerClick).toHaveBeenCalledWith('place-1');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '../errors';
import { createPlaceSearchRepository } from './places';

describe('createPlaceSearchRepository — 어댑터 없음 (Kakao는 Wave 3)', () => {
  it('주변 장소는 빈 목록이다 — 픽스처를 대신 쓰지 않는다', async () => {
    await expect(createPlaceSearchRepository().getNearbyPlaces()).resolves.toEqual([]);
  });

  it('장소 조회는 null이다', async () => {
    await expect(createPlaceSearchRepository().getPlace('p1')).resolves.toBeNull();
  });

  it('mock 장소 이름이 새지 않는다', async () => {
    const places = await createPlaceSearchRepository().getNearbyPlaces('성수');

    expect(JSON.stringify(places)).not.toContain('블루보틀');
  });
});

describe('createPlaceSearchRepository — 어댑터 주입', () => {
  it('검색 질의를 어댑터에 그대로 넘긴다', async () => {
    const searchPlaces = vi.fn(async () => [{ id: 'kakao-1', name: '성수동 블루보틀' }]);
    const places = createPlaceSearchRepository({ adapter: { searchPlaces } });

    await expect(places.getNearbyPlaces({ keyword: '성수', lat: 37.5, lng: 127 })).resolves.toEqual([
      { id: 'kakao-1', name: '성수동 블루보틀' },
    ]);
    expect(searchPlaces).toHaveBeenCalledWith({ keyword: '성수', lat: 37.5, lng: 127 });
  });

  it('단건 조회도 어댑터로 넘긴다', async () => {
    const getPlace = vi.fn(async (id) => ({ id, name: '성수동 블루보틀' }));
    const places = createPlaceSearchRepository({ adapter: { getPlace } });

    await expect(places.getPlace('kakao-1')).resolves.toEqual({ id: 'kakao-1', name: '성수동 블루보틀' });
    expect(getPlace).toHaveBeenCalledWith('kakao-1');
  });

  it('어댑터가 목록 대신 이상한 값을 주면 빈 목록으로 막는다', async () => {
    const places = createPlaceSearchRepository({ adapter: { searchPlaces: async () => null } });

    await expect(places.getNearbyPlaces()).resolves.toEqual([]);
  });

  it('어댑터 실패도 AppError로 번역한다', async () => {
    const places = createPlaceSearchRepository({
      adapter: {
        searchPlaces: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
    });

    await expect(places.getNearbyPlaces()).rejects.toMatchObject({
      code: ERROR_CODES.network,
      retryable: true,
    });
  });

  it('일부 기능만 구현한 어댑터도 받아들인다', async () => {
    const places = createPlaceSearchRepository({ adapter: { searchPlaces: async () => [] } });

    await expect(places.getPlace('kakao-1')).resolves.toBeNull();
  });

  it('빈 placeId는 어댑터를 부르지 않는다', async () => {
    const getPlace = vi.fn();
    const places = createPlaceSearchRepository({ adapter: { getPlace } });

    await expect(places.getPlace('')).resolves.toBeNull();
    expect(getPlace).not.toHaveBeenCalled();
  });
});

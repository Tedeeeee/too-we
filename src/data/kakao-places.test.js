import { describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from './errors';
import { createKakaoPlacesAdapter } from './kakao-places';

const kakaoRow = (over = {}) => ({
  id: '28720295',
  place_name: '블루보틀 성수 카페',
  category_name: '음식점 > 카페',
  address_name: '서울 성동구 성수동1가 656-439',
  road_address_name: '서울 성동구 아차산로 7',
  phone: '02-6212-6998',
  place_url: 'https://place.map.kakao.com/28720295',
  y: '37.5446137523921',
  x: '127.055978290073',
  ...over,
});

const createSdkHarness = ({ rows = [kakaoRow()], status = 'OK' } = {}) => {
  const keywordSearch = vi.fn((_keyword, callback) => callback(rows, status, { current: 1 }));
  const Places = vi.fn(function PlacesService() {
    this.keywordSearch = keywordSearch;
  });
  class LatLng {
    constructor(lat, lng) {
      this.lat = lat;
      this.lng = lng;
    }
  }
  const maps = {
    LatLng,
    services: {
      Places,
      Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
      SortBy: { ACCURACY: 'ACCURACY', DISTANCE: 'DISTANCE' },
    },
  };

  return { maps, loadSdk: vi.fn(async () => maps), keywordSearch, Places, LatLng };
};

describe('createKakaoPlacesAdapter — 검색과 정규화', () => {
  it('빈 키워드는 SDK를 불러오지 않고 빈 목록을 준다', async () => {
    const loadSdk = vi.fn();
    const adapter = createKakaoPlacesAdapter({ loadSdk });

    await expect(adapter.searchPlaces('   ')).resolves.toEqual([]);
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it('키워드를 trim하고 위치·반경·페이지 옵션을 새 객체로 전달한다', async () => {
    const harness = createSdkHarness();
    const adapter = createKakaoPlacesAdapter({ loadSdk: harness.loadSdk });
    const query = {
      keyword: '  성수 카페  ',
      lat: 37.5446,
      lng: 127.056,
      radius: 1200,
      page: 2,
      size: 10,
      sort: 'distance',
      category: 'CE7',
    };
    const original = structuredClone(query);

    const result = await adapter.searchPlaces(query);

    expect(query).toEqual(original);
    expect(harness.keywordSearch).toHaveBeenCalledWith(
      '성수 카페',
      expect.any(Function),
      {
        location: expect.objectContaining({ lat: 37.5446, lng: 127.056 }),
        radius: 1200,
        page: 2,
        size: 10,
        sort: 'DISTANCE',
        category_group_code: 'CE7',
      },
    );
    expect(result).toEqual([
      {
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
      },
    ]);
  });

  it('좌표 없이도 키워드만 검색하고 ZERO_RESULT는 빈 목록으로 돌려준다', async () => {
    const harness = createSdkHarness({ rows: [], status: 'ZERO_RESULT' });
    const adapter = createKakaoPlacesAdapter({ loadSdk: harness.loadSdk });

    await expect(adapter.searchPlaces({ keyword: '망원' })).resolves.toEqual([]);
    expect(harness.keywordSearch).toHaveBeenCalledWith('망원', expect.any(Function), {});
  });

  it('검색 결과의 숫자가 아닌 좌표나 필수값 누락은 캐시하지 않는다', async () => {
    const harness = createSdkHarness({
      rows: [
        kakaoRow({ id: '' }),
        kakaoRow({ id: 'bad-coordinate', x: 'not-a-number' }),
        kakaoRow({ id: 'null-coordinate', x: null }),
      ],
    });
    const adapter = createKakaoPlacesAdapter({ loadSdk: harness.loadSdk });

    await expect(adapter.searchPlaces('성수')).resolves.toEqual([]);
    await expect(adapter.getPlace('bad-coordinate')).resolves.toBeNull();
  });
});

describe('createKakaoPlacesAdapter — 선택 장소 캐시', () => {
  it('정규화한 검색 스냅샷을 id로 다시 찾고 호출자 변경에서 보호한다', async () => {
    const harness = createSdkHarness();
    const adapter = createKakaoPlacesAdapter({ loadSdk: harness.loadSdk });

    const results = await adapter.searchPlaces('성수');
    results[0].name = '호출자가 바꾼 이름';

    await expect(adapter.getPlace(' 28720295 ')).resolves.toMatchObject({
      id: '28720295',
      name: '블루보틀 성수 카페',
      provider: 'kakao',
    });
    await expect(adapter.getPlace('never-searched')).resolves.toBeNull();
    expect(harness.loadSdk).toHaveBeenCalledTimes(1);
  });
});

describe('createKakaoPlacesAdapter — 오류 계약', () => {
  it.each([
    ['INVALID_REQUEST', ERROR_CODES.validation, false],
    ['OVER_QUERY_LIMIT', ERROR_CODES.rate_limited, true],
    ['ERROR', ERROR_CODES.network, true],
  ])('%s 상태를 %s AppError로 바꾼다', async (status, code, retryable) => {
    const harness = createSdkHarness({ rows: [], status });
    const adapter = createKakaoPlacesAdapter({ loadSdk: harness.loadSdk });

    await expect(adapter.searchPlaces('성수')).rejects.toMatchObject({ code, retryable });
  });

  it.each([
    [{ keyword: '성수', lat: 37.5 }, '짝이 없는 좌표'],
    [{ keyword: '성수', lat: 95, lng: 127 }, '범위를 벗어난 위도'],
    [{ keyword: '성수', lat: 37.5, lng: 127, radius: 20001 }, '과도한 반경'],
    [{ keyword: '성수', page: 0 }, '범위를 벗어난 페이지'],
    [{ keyword: '성수', sort: 'newest' }, '지원하지 않는 정렬'],
  ])('%s 입력은 validation AppError로 거부한다 (%s)', async (query) => {
    const harness = createSdkHarness();
    const adapter = createKakaoPlacesAdapter({ loadSdk: harness.loadSdk });

    await expect(adapter.searchPlaces(query)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
      retryable: false,
    });
    expect(harness.loadSdk).not.toHaveBeenCalled();
  });

  it('SDK 설정 오류를 원시 오류로 바꾸지 않고 그대로 보존한다', async () => {
    const expected = new AppError(ERROR_CODES.configuration);
    const adapter = createKakaoPlacesAdapter({ loadSdk: vi.fn(async () => { throw expected; }) });

    await expect(adapter.searchPlaces('성수')).rejects.toBe(expected);
  });

  it('Places 생성자는 있지만 keywordSearch가 없으면 configuration AppError로 거부한다', async () => {
    const maps = {
      services: {
        Places: class Places {},
        Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
      },
    };
    const adapter = createKakaoPlacesAdapter({ loadSdk: async () => maps });

    await expect(adapter.searchPlaces('성수')).rejects.toMatchObject({
      code: ERROR_CODES.configuration,
      retryable: false,
    });
  });

  it('검색 서비스의 전송 예외를 network AppError로 바꾼다', async () => {
    const maps = {
      services: {
        Places: class Places {
          keywordSearch() {
            throw new TypeError('Failed to fetch');
          }
        },
        Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
      },
    };
    const adapter = createKakaoPlacesAdapter({ loadSdk: async () => maps });

    await expect(adapter.searchPlaces('성수')).rejects.toMatchObject({
      code: ERROR_CODES.network,
      retryable: true,
    });
  });
});

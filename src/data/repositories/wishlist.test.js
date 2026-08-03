import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../errors';
import { createRepositories } from './index';
import { createFakeSupabaseClient, queriesFor, transportFailure } from './__fixtures__/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';

const PLACE = Object.freeze({
  provider: 'kakao',
  providerId: 'kakao-1',
  name: '  어라운드 성수  ',
  category: '  카페  ',
  address: '  서울 성동구 성수동  ',
  roadAddress: '  서울 성동구 성수이로 1  ',
  url: '  https://place.map.kakao.com/kakao-1  ',
  lat: 37.54,
  lng: 127.05,
});

const WISHLIST_ROW = {
  id: 'w1',
  couple_id: 'c1',
  created_by: ME,
  place_provider: 'kakao',
  place_provider_id: 'kakao-1',
  place_name: '어라운드 성수',
  place_category: '카페',
  place_address: '서울 성동구 성수동',
  place_road_address: '서울 성동구 성수이로 1',
  place_url: 'https://place.map.kakao.com/kakao-1',
  place_lat: 37.54,
  place_lng: 127.05,
  place_snapshot: {
    provider: 'kakao',
    provider_id: 'kakao-1',
    name: '어라운드 성수',
    category: '카페',
    address: '서울 성동구 성수동',
    road_address: '서울 성동구 성수이로 1',
    url: 'https://place.map.kakao.com/kakao-1',
    lat: 37.54,
    lng: 127.05,
  },
  place_snapshot_at: '2026-07-02T00:00:00Z',
  created_at: '2026-07-02T00:00:00Z',
};

const build = (config = {}) => {
  const client = createFakeSupabaseClient({ userId: ME, ...config });
  return { client, wishlist: createRepositories({ client }).wishlist };
};

describe('getWishlist', () => {
  it('커플의 가고 싶은 곳을 최신순으로 읽는다', async () => {
    const { client, wishlist } = build({
      tables: {
        wishlist_places: [
          { id: 'w1', place_name: '어라운드 성수', place_category: '카페', created_by: ME, created_at: '2026-07-02T00:00:00Z' },
          { id: 'w2', place_name: '뚝섬 한강공원', place_category: '공원', created_by: PARTNER, created_at: '2026-07-01T00:00:00Z' },
        ],
        profiles: [
          { id: ME, display_name: '지은' },
          { id: PARTNER, display_name: '태식' },
        ],
      },
    });

    await expect(wishlist.getWishlist()).resolves.toEqual([
      expect.objectContaining({
        id: 'w1',
        name: '어라운드 성수',
        category: '카페',
        pickedBy: '지은',
        pickedByUserId: ME,
      }),
      expect.objectContaining({
        id: 'w2',
        name: '뚝섬 한강공원',
        category: '공원',
        pickedBy: '태식',
        pickedByUserId: PARTNER,
      }),
    ]);

    expect(queriesFor(client, 'wishlist_places')[0].orders).toEqual([['created_at', { ascending: false }]]);
  });

  it('커플 id를 클라이언트가 넘기지 않는다 — RLS가 범위를 정한다', async () => {
    const { client, wishlist } = build({ tables: { wishlist_places: [] } });

    await wishlist.getWishlist();

    expect(queriesFor(client, 'wishlist_places')[0].filters).toEqual([]);
  });

  it('비어 있으면 프로필을 조회하지 않고 빈 목록을 준다 — 픽스처를 섞지 않는다', async () => {
    const { client, wishlist } = build({ tables: { wishlist_places: [] } });

    await expect(wishlist.getWishlist()).resolves.toEqual([]);
    expect(queriesFor(client, 'profiles')).toHaveLength(0);
  });

  it('담은 사람 이름을 모르면 빈 문자열이고 만들어내지 않는다', async () => {
    const { wishlist } = build({
      tables: {
        wishlist_places: [{ id: 'w1', place_name: 'x', place_category: null, created_by: PARTNER, created_at: 'z' }],
        profiles: [{ id: ME, display_name: '지은' }],
      },
    });

    await expect(wishlist.getWishlist()).resolves.toEqual([
      expect.objectContaining({
        id: 'w1',
        name: 'x',
        category: '',
        pickedBy: '',
        pickedByUserId: PARTNER,
      }),
    ]);
  });

  it('먼저 익명 세션을 보장한다', async () => {
    const { client, wishlist } = build({ session: null, tables: { wishlist_places: [] } });

    await wishlist.getWishlist();

    expect(client.calls.auth).toEqual(['getSession', 'signInAnonymously']);
  });

  it('조회 실패를 AppError로 바꿔 거부한다', async () => {
    const { wishlist } = build({
      tables: { wishlist_places: transportFailure({ code: '42501', message: 'permission denied' }) },
    });

    await expect(wishlist.getWishlist()).rejects.toMatchObject({ code: ERROR_CODES.forbidden });
  });
});

describe('wishlist shared CRUD', () => {
  it('현재 세션과 활성 커플에서 소유 필드를 만들고 전체 장소 스냅샷을 저장한다', async () => {
    const input = Object.freeze({ ...PLACE, couple_id: 'caller-couple', created_by: PARTNER });
    const original = structuredClone(input);
    const { client, wishlist } = build({
      tables: {
        couples: [{ id: 'c1' }],
        wishlist_places: (query) => (query.op === 'insert' ? [WISHLIST_ROW] : [WISHLIST_ROW]),
        profiles: [{ id: ME, display_name: '지은' }],
      },
    });

    await expect(wishlist.createWishlistPlace(input)).resolves.toMatchObject({
      id: 'w1',
      provider: 'kakao',
      providerId: 'kakao-1',
      pickedBy: '지은',
      pickedByUserId: ME,
    });

    expect(input).toEqual(original);
    expect(queriesFor(client, 'couples')[0]).toMatchObject({
      columns: 'id',
      filters: [['eq', 'status', 'active']],
      cardinality: 'maybe',
    });
    const insert = queriesFor(client, 'wishlist_places').find((query) => query.op === 'insert');
    expect(insert.payload).toEqual({
      couple_id: 'c1',
      created_by: ME,
      place_provider: 'kakao',
      place_provider_id: 'kakao-1',
      place_name: '어라운드 성수',
      place_category: '카페',
      place_address: '서울 성동구 성수동',
      place_road_address: '서울 성동구 성수이로 1',
      place_url: 'https://place.map.kakao.com/kakao-1',
      place_lat: 37.54,
      place_lng: 127.05,
      place_snapshot: WISHLIST_ROW.place_snapshot,
      place_snapshot_at: expect.any(String),
    });
    expect(queriesFor(client, 'visits')).toEqual([]);
  });

  it('활성 커플이 없으면 생성하지 않고 not_found AppError를 준다', async () => {
    const { client, wishlist } = build({ tables: { couples: [] } });

    await expect(wishlist.createWishlistPlace(PLACE)).rejects.toMatchObject({
      code: ERROR_CODES.not_found,
      retryable: false,
    });
    expect(queriesFor(client, 'wishlist_places')).toEqual([]);
  });

  it('작성자가 아닌 커플 구성원도 created_by를 바꾸지 않고 장소 전체를 수정한다', async () => {
    const next = Object.freeze({
      provider: 'manual',
      name: '  새 장소  ',
      category: '',
      address: '  서울 성동구  ',
      roadAddress: '',
      url: '',
      lat: 37.5,
      lng: 127,
    });
    const updatedRow = {
      ...WISHLIST_ROW,
      created_by: PARTNER,
      place_provider: 'manual',
      place_provider_id: null,
      place_name: '새 장소',
      place_category: null,
      place_address: '서울 성동구',
      place_road_address: null,
      place_url: null,
      place_lat: 37.5,
      place_lng: 127,
    };
    const { client, wishlist } = build({
      tables: {
        wishlist_places: (query) => (query.op === 'update' ? [updatedRow] : [updatedRow]),
        profiles: [{ id: PARTNER, display_name: '태식' }],
      },
    });

    await expect(wishlist.updateWishlistPlace(' w1 ', next)).resolves.toMatchObject({
      id: 'w1',
      provider: 'manual',
      providerId: null,
      name: '새 장소',
      pickedBy: '태식',
      pickedByUserId: PARTNER,
    });

    const update = queriesFor(client, 'wishlist_places').find((query) => query.op === 'update');
    expect(update.filters).toEqual([['eq', 'id', 'w1']]);
    expect(update.payload).toEqual({
      place_provider: 'manual',
      place_provider_id: null,
      place_name: '새 장소',
      place_category: null,
      place_address: '서울 성동구',
      place_road_address: null,
      place_url: null,
      place_lat: 37.5,
      place_lng: 127,
      place_snapshot: {
        provider: 'manual',
        name: '새 장소',
        address: '서울 성동구',
        lat: 37.5,
        lng: 127,
      },
      place_snapshot_at: expect.any(String),
    });
    expect(update.payload).not.toHaveProperty('couple_id');
    expect(update.payload).not.toHaveProperty('created_by');
    expect(next.name).toBe('  새 장소  ');
  });

  it('커플 구성원이 작성자 조건 없이 공유 항목을 삭제한다', async () => {
    const { client, wishlist } = build({
      tables: { wishlist_places: (query) => (query.op === 'delete' ? [{ id: 'w1' }] : []) },
    });

    await expect(wishlist.deleteWishlistPlace(' w1 ')).resolves.toEqual({ id: 'w1' });

    const deletion = queriesFor(client, 'wishlist_places').find((query) => query.op === 'delete');
    expect(deletion.filters).toEqual([['eq', 'id', 'w1']]);
    expect(deletion.filters.flat()).not.toContain('created_by');
    expect(queriesFor(client, 'visits')).toEqual([]);
  });

  it('잘못된 CRUD 입력은 네트워크 전에 validation AppError로 막는다', async () => {
    const { client, wishlist } = build({ tables: {} });

    await expect(wishlist.createWishlistPlace({ name: '   ' })).rejects.toMatchObject({
      code: ERROR_CODES.validation,
    });
    await expect(wishlist.updateWishlistPlace('', PLACE)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
    });
    await expect(wishlist.deleteWishlistPlace(null)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
    });
    await expect(
      wishlist.createWishlistPlace({ name: 'x', lat: '37.5' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validation });
    await expect(
      wishlist.updateWishlistPlace('w1', { name: 'x', category: 42 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validation });
    expect(client.calls.auth).toEqual([]);
    expect(client.calls.queries).toEqual([]);
  });

  it('쓰기 전송 실패도 raw URL 대신 안전한 AppError로 거부한다', async () => {
    const { wishlist } = build({
      tables: {
        couples: [{ id: 'c1' }],
        wishlist_places: transportFailure(new TypeError('Failed to fetch https://secret.invalid?apikey=token')),
      },
    });

    const error = await wishlist.createWishlistPlace(PLACE).catch((caught) => caught);
    expect(error).toMatchObject({ code: ERROR_CODES.network, retryable: true });
    expect(error.message).not.toContain('secret.invalid');
    expect(error.message).not.toContain('token');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { ERROR_CODES } from './errors';
import { __resetSupabaseClient, __setSupabaseClient } from './supabase';
import {
  createFakeSupabaseClient,
  lastRpcArgs,
  okEnvelope,
  queriesFor,
  rpcNames,
} from './repositories/__fixtures__/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const originalKakao = globalThis.kakao;

const visitRow = (over = {}) => ({
  id: 'v1',
  couple_id: 'c1',
  visited_at: '2026-05-03T10:14:00Z',
  place_provider: 'manual',
  place_provider_id: null,
  place_name: '직접 입력한 곳',
  place_category: null,
  place_address: null,
  place_road_address: null,
  place_phone: null,
  place_url: null,
  place_lat: null,
  place_lng: null,
  flower_key: null,
  visit_entries: [],
  visit_tags: [],
  visit_photos: [],
  ...over,
});

beforeEach(() => {
  __resetSupabaseClient();
});

afterEach(() => {
  __resetSupabaseClient();
  if (originalKakao === undefined) delete globalThis.kakao;
  else globalThis.kakao = originalKakao;
});

describe('data API facade', () => {
  it('첫 화면의 동시 조회가 익명 로그인을 한 번만 수행하고 같은 사용자 id를 쓴다', async () => {
    let signInCount = 0;
    const client = createFakeSupabaseClient({
      session: null,
      signInResult: () => ({
        data: { session: { user: { id: `anon-${++signInCount}` } } },
        error: null,
      }),
      tables: {
        couples: [],
        visits: [
          visitRow({
            visit_entries: [{ author_id: 'anon-1', note: null, rating: 4 }],
          }),
        ],
      },
    });
    __setSupabaseClient(client);

    const [couple, records] = await Promise.all([api.getCouple(), api.getRecords()]);

    expect(signInCount).toBe(1);
    expect(client.calls.auth.filter((call) => call === 'signInAnonymously')).toHaveLength(1);
    expect(couple.me.userId).toBe('anon-1');
    expect(records[0].rating).toBe(4);
  });

  it('Supabase 테스트 클라이언트를 바꾸면 이전 사용자 id를 재사용하지 않는다', async () => {
    const firstClient = createFakeSupabaseClient({
      userId: 'user-a',
      tables: {
        visits: [visitRow({ visit_entries: [{ author_id: 'user-a', note: null, rating: 2 }] })],
      },
    });
    __setSupabaseClient(firstClient);
    await expect(api.getRecords()).resolves.toEqual([
      expect.objectContaining({ rating: 2 }),
    ]);

    __resetSupabaseClient();
    const secondClient = createFakeSupabaseClient({
      userId: 'user-b',
      tables: {
        visits: [visitRow({ visit_entries: [{ author_id: 'user-b', note: null, rating: 5 }] })],
      },
    });
    __setSupabaseClient(secondClient);

    await expect(api.getRecords()).resolves.toEqual([
      expect.objectContaining({ rating: 5 }),
    ]);
    expect(secondClient.calls.auth).toEqual(['getSession']);
  });

  it('만료된 초대를 재발급하는 최소 facade action을 제공한다', async () => {
    const client = createFakeSupabaseClient({
      userId: ME,
      tables: {
        couples: [{
          id: 'c1',
          status: 'active',
          started_on: null,
          connected_at: null,
          created_at: '2026-05-01T00:00:00Z',
          couple_members: [{ user_id: ME, slot: 1, left_at: null }],
        }],
        profiles: [{ id: ME, display_name: '지은' }],
        couple_invites: [{
          code: '731904',
          status: 'active',
          expires_at: '2099-05-05T00:00:00Z',
        }],
      },
      rpc: {
        reissue_couple_invite: okEnvelope({ couple_id: 'c1' }),
      },
    });
    __setSupabaseClient(client);

    await expect(
      api.reissueCoupleInvite({ requestKey: 'api-reissue-key' }),
    ).resolves.toMatchObject({ inviteCode: '731904' });
    expect(client.calls.rpc).toEqual([{
      name: 'reissue_couple_invite',
      args: { p_request_key: 'api-reissue-key' },
    }]);
  });

  it('기존 Promise API가 주입된 Supabase 저장소의 빈 기록 목록을 그대로 돌려준다', async () => {
    const client = createFakeSupabaseClient({ userId: ME, tables: { visits: [] } });
    __setSupabaseClient(client);

    await expect(api.getRecords()).resolves.toEqual([]);
    expect(queriesFor(client, 'visits')).toHaveLength(1);
  });

  it('새 기록 저장은 입력을 바꾸지 않고 장소·시각만 있는 대기 기록을 만든다', async () => {
    const client = createFakeSupabaseClient({
      userId: ME,
      tables: {
        visits: [
          visitRow({
            id: 'v2',
            place_provider: 'kakao',
            place_provider_id: 'kakao-api-1',
            place_name: '연남동 카페',
            place_category: '음식점 > 카페',
            place_address: '서울 마포구 연남동',
            place_road_address: '서울 마포구 동교로 1',
            place_url: 'https://place.map.kakao.com/kakao-api-1',
            place_lat: 37.566,
            place_lng: 126.922,
          }),
        ],
      },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
      },
    });
    __setSupabaseClient(client);
    const input = {
      place: {
        id: 'kakao-api-1',
        name: '연남동 카페',
        category: '음식점 > 카페',
        address: '서울 마포구 연남동',
        roadAddress: '서울 마포구 동교로 1',
        phone: '02-000-0000',
        url: 'https://place.map.kakao.com/kakao-api-1',
        lat: 37.566,
        lng: 126.922,
        provider: 'kakao',
      },
      text: '  내 한 줄  ',
      rating: 3,
      date: '2026-05-03T10:14:00Z',
      requestKey: 'screen-request-key',
    };
    const original = structuredClone(input);

    const record = await api.saveFiveSecondRecord(input);

    expect(input).toEqual(original);
    expect(rpcNames(client)).toEqual(['create_visit']);
    expect(lastRpcArgs(client, 'create_visit')).toEqual({
      p_place: {
        provider: 'kakao',
        provider_id: 'kakao-api-1',
        name: '연남동 카페',
        category: '음식점 > 카페',
        address: '서울 마포구 연남동',
        road_address: '서울 마포구 동교로 1',
        phone: '02-000-0000',
        url: 'https://place.map.kakao.com/kakao-api-1',
        lat: 37.566,
        lng: 126.922,
      },
      p_visited_at: '2026-05-03T10:14:00.000Z',
      p_request_key: 'screen-request-key',
    });
    expect(record).toMatchObject({ pending: true, flower: null, entries: [], tags: [], photos: [] });
  });

  it('기본 Kakao 어댑터로 키워드를 검색하고 같은 장소 스냅샷을 다시 찾는다', async () => {
    const keywordSearch = vi.fn((_keyword, callback) => callback([
      {
        id: 'kakao-api-1',
        place_name: '연남동 카페',
        category_name: '음식점 > 카페',
        address_name: '서울 마포구 연남동',
        road_address_name: '서울 마포구 동교로 1',
        phone: '02-000-0000',
        place_url: 'https://place.map.kakao.com/kakao-api-1',
        y: '37.566',
        x: '126.922',
      },
    ], 'OK'));
    const Places = vi.fn(function PlacesService() {
      this.keywordSearch = keywordSearch;
    });
    globalThis.kakao = {
      maps: {
        services: {
          Places,
          Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
          SortBy: { ACCURACY: 'ACCURACY', DISTANCE: 'DISTANCE' },
        },
      },
    };
    const query = { keyword: '  연남 카페  ' };
    const original = structuredClone(query);

    const places = await api.getNearbyPlaces(query);

    expect(query).toEqual(original);
    expect(keywordSearch).toHaveBeenCalledWith('연남 카페', expect.any(Function), {});
    expect(places).toEqual([
      {
        id: 'kakao-api-1',
        name: '연남동 카페',
        category: '음식점 > 카페',
        address: '서울 마포구 연남동',
        roadAddress: '서울 마포구 동교로 1',
        phone: '02-000-0000',
        url: 'https://place.map.kakao.com/kakao-api-1',
        lat: 37.566,
        lng: 126.922,
        provider: 'kakao',
      },
    ]);
    await expect(api.getPlace('kakao-api-1')).resolves.toEqual(places[0]);
  });

  it.each([
    [undefined],
    [null],
    ['   '],
    [{ keyword: '   ' }],
  ])('빈 장소 검색 입력 %s는 SDK를 부르지 않고 빈 목록을 준다', async (query) => {
    const Places = vi.fn();
    globalThis.kakao = { maps: { services: { Places } } };

    await expect(api.getNearbyPlaces(query)).resolves.toEqual([]);
    expect(Places).not.toHaveBeenCalled();
  });

  it.each([
    [[]],
    [42],
    [{ keyword: 42 }],
  ])('잘못된 장소 검색 입력 %s는 SDK를 부르지 않고 validation AppError로 거부한다', async (query) => {
    const Places = vi.fn();
    globalThis.kakao = { maps: { services: { Places } } };

    await expect(api.getNearbyPlaces(query)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
      retryable: false,
    });
    expect(Places).not.toHaveBeenCalled();
  });

  it('빈 장소 API와 저장 모델이 없는 설정 API는 픽스처를 만들지 않는다', async () => {
    const client = createFakeSupabaseClient({ userId: ME, tables: {}, rpc: {} });
    __setSupabaseClient(client);

    await expect(api.getNearbyPlaces()).resolves.toEqual([]);
    await expect(api.getPlace('mock-place')).resolves.toBeNull();
    await expect(api.getSettings()).resolves.toEqual({ recordAlert: '' });
    expect(client.calls.queries).toEqual([]);
    expect(client.calls.rpc).toEqual([]);
  });

  it('잘못된 저장 입력도 원시 TypeError가 아니라 안정적인 AppError로 거부한다', async () => {
    await expect(api.saveFiveSecondRecord(null)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
    });
  });

  it('facade 경계에서도 상대 entry 쓰기 shape을 받지 않는다', async () => {
    const client = createFakeSupabaseClient({ userId: ME, tables: {}, rpc: {} });
    __setSupabaseClient(client);
    const input = Object.freeze({
      recordId: 'v1',
      text: '내 한 줄',
      entries: Object.freeze([{ memberId: 'partner', text: '상대 한 줄', rating: 5 }]),
    });

    await expect(api.saveFiveSecondRecord(input)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
      retryable: false,
    });

    expect(client.calls.auth).toEqual([]);
    expect(client.calls.rpc).toEqual([]);
    expect(client.calls.queries).toEqual([]);
  });

  it('facade 모델은 내 rating-only로 pending을 완료하지 않고 상대 값을 읽기 전용으로 보여준다', async () => {
    const partner = '22222222-2222-4222-8222-222222222222';
    const client = createFakeSupabaseClient({
      userId: ME,
      tables: {
        visits: [visitRow({
          visit_entries: [
            { author_id: ME, note: null, rating: 3 },
            { author_id: partner, note: '  상대 한 줄  ', rating: 5 },
          ],
        })],
      },
    });
    __setSupabaseClient(client);

    const [record] = await api.getRecords();

    expect(record).toMatchObject({ pending: true, rating: 3 });
    expect(record.entries).toEqual([
      expect.objectContaining({
        memberId: 'partner',
        text: '상대 한 줄',
        rating: 5,
        readOnly: true,
      }),
    ]);
  });

  it('facade updateRecord로 공동 장소를 변경하고 최신 서버 장소를 받는다', async () => {
    const updatedRow = visitRow({
      place_provider: 'manual',
      place_provider_id: null,
      place_name: '새 장소',
      place_phone: '02-123-4567',
    });
    const client = createFakeSupabaseClient({
      userId: ME,
      tables: {
        visits: (query) => (query.op === 'update' ? [{ id: 'v1' }] : [updatedRow]),
      },
    });
    __setSupabaseClient(client);
    const patch = Object.freeze({
      place: Object.freeze({ name: '  새 장소  ', phone: ' 02-123-4567 ' }),
    });

    const record = await api.updateRecord('v1', patch);

    expect(record.place).toMatchObject({
      provider: 'manual',
      providerId: null,
      name: '새 장소',
      phone: '02-123-4567',
    });
    const update = queriesFor(client, 'visits').find((query) => query.op === 'update');
    expect(update.payload).toMatchObject({
      place_provider: 'manual',
      place_provider_id: null,
      place_name: '새 장소',
      place_phone: '02-123-4567',
      place_snapshot: { provider: 'manual', name: '새 장소', phone: '02-123-4567' },
    });
    expect(client.calls.rpc).toEqual([]);
  });

  it('facade가 사진 입력을 바꾸지 않고 private storage 업로드 상태를 파일별로 돌려준다', async () => {
    const source = new File(['image'], 'memory.jpg', { type: 'image/jpeg' });
    const files = Object.freeze([source]);
    const client = createFakeSupabaseClient({
      userId: ME,
      storage: {
        'visit-photos': {
          upload: ({ path }) => ({ path }),
        },
      },
      rpc: {
        register_visit_photo: okEnvelope({ photo_id: 'photo-1', ordinal: 1 }),
      },
    });
    __setSupabaseClient(client);

    const [result] = await api.uploadVisitPhotos({ id: 'v1', coupleId: 'c1' }, files);

    expect(files).toEqual([source]);
    expect(result).toMatchObject({
      status: 'succeeded',
      file: source,
      objectUploaded: true,
      photo: { id: 'photo-1', ownedByMe: true, order: 1 },
    });
    const args = lastRpcArgs(client, 'register_visit_photo');
    expect(args.p_storage_path).toMatch(/^c1\/v1\/[^/]+\.jpg$/);
    expect(args.p_request_key).toEqual(expect.any(String));
    expect(args.p_metadata).toEqual({
      content_type: 'image/jpeg',
      byte_size: source.size,
      width: null,
      height: null,
    });
    expect(client.calls.storage[0].options).toMatchObject({ upsert: false });
  });

  it('facade에서 상대 사진 삭제 요청은 raw backend 호출 없이 안전한 실패 상태다', async () => {
    const client = createFakeSupabaseClient({ userId: ME });
    __setSupabaseClient(client);

    const result = await api.deleteVisitPhoto({
      id: 'partner-photo',
      bucket: 'visit-photos',
      path: 'c1/v1/partner.webp',
      uploaderId: 'partner',
      ownedByMe: false,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: ERROR_CODES.forbidden, retryable: false },
    });
    expect(client.calls.storage).toEqual([]);
    expect(client.calls.queries).toEqual([]);
  });
});

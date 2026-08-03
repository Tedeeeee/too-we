import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as api from './api';
import { ERROR_CODES } from './errors';
import { __resetSupabaseClient, __setSupabaseClient } from './supabase';
import {
  createFakeSupabaseClient,
  okEnvelope,
  queriesFor,
  rpcNames,
} from './repositories/__fixtures__/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';

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
});

describe('data API facade', () => {
  it('기존 Promise API가 주입된 Supabase 저장소의 빈 기록 목록을 그대로 돌려준다', async () => {
    const client = createFakeSupabaseClient({ userId: ME, tables: { visits: [] } });
    __setSupabaseClient(client);

    await expect(api.getRecords()).resolves.toEqual([]);
    expect(queriesFor(client, 'visits')).toHaveLength(1);
  });

  it('새 기록 저장은 호출자 입력을 바꾸거나 파트너 한 줄을 만들어내지 않는다', async () => {
    const client = createFakeSupabaseClient({
      userId: ME,
      tables: {
        visits: [
          visitRow({
            id: 'v2',
            visit_entries: [{ author_id: ME, note: '내 한 줄', rating: 3 }],
          }),
        ],
      },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v2' }),
      },
    });
    __setSupabaseClient(client);
    const input = {
      place: { name: '직접 입력한 곳' },
      text: '  내 한 줄  ',
      rating: 3,
      date: '2026-05-03T10:14:00Z',
      requestKey: 'screen-request-key',
    };
    const original = structuredClone(input);

    const record = await api.saveFiveSecondRecord(input);

    expect(input).toEqual(original);
    expect(rpcNames(client)).toEqual(['create_visit', 'upsert_my_visit_entry']);
    expect(record.entries).toEqual([
      expect.objectContaining({ memberId: 'me', text: '내 한 줄', rating: 3 }),
    ]);
  });

  it('Wave 3 전 장소 API와 저장 모델이 없는 설정 API는 픽스처를 만들지 않는다', async () => {
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
});

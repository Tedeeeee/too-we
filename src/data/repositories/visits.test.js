import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '../errors';
import { createRepositories } from './index';
import {
  createFakeSupabaseClient,
  errorEnvelope,
  lastRpcArgs,
  okEnvelope,
  queriesFor,
  rpcNames,
  transportFailure,
} from './__fixtures__/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-07-30T04:05:06.000Z');

const visitRow = (over = {}) => ({
  id: 'v1',
  couple_id: 'c1',
  visited_at: '2026-05-03T10:14:00Z',
  place_provider: 'kakao',
  place_provider_id: 'kakao-1',
  place_name: '성수동 블루보틀',
  place_category: '카페',
  place_address: '서울 성동구 연무장길 7',
  place_road_address: null,
  place_url: null,
  place_lat: 37.5443,
  place_lng: 127.0557,
  flower_key: null,
  visit_entries: [],
  visit_tags: [],
  visit_photos: [],
  ...over,
});

const build = (config = {}) => {
  const { placeSearchAdapter, ...clientConfig } = config;
  const client = createFakeSupabaseClient({ userId: ME, ...clientConfig });
  const repositories = createRepositories({
    client,
    placeSearchAdapter,
    newRequestKey: () => 'request-key-1',
    now: () => NOW,
  });
  return { client, visits: repositories.visits };
};

describe('getRecords', () => {
  it('방문 시각 내림차순으로 요청한다', async () => {
    const { client, visits } = build({ tables: { visits: [] } });

    await expect(visits.getRecords()).resolves.toEqual([]);

    const [query] = queriesFor(client, 'visits');
    expect(query.orders).toEqual([['visited_at', { ascending: false }]]);
    expect(query.columns).toContain('visit_entries');
    expect(query.columns).toContain('visit_tags');
    expect(query.columns).toContain('visit_photos');
  });

  it('mock 픽스처를 섞지 않는다 — 서버가 빈 목록이면 빈 목록이다', async () => {
    const { visits } = build({ tables: { visits: [] } });

    await expect(visits.getRecords()).resolves.toEqual([]);
  });

  it('행을 현재 화면 셰이프로 옮긴다', async () => {
    const { visits } = build({
      tables: {
        visits: [
          visitRow({
            flower_key: 'rose',
            visit_entries: [
              { author_id: PARTNER, note: '상대 한 줄', rating: 4 },
              { author_id: ME, note: '내 한 줄', rating: 3 },
            ],
            visit_tags: [{ ordinal: 1, label: '# 하나' }],
          }),
        ],
      },
    });

    const [record] = await visits.getRecords();

    expect(record).toMatchObject({
      id: 'v1',
      placeName: '성수동 블루보틀',
      category: '카페',
      flower: 'rose',
      rating: 3,
      tags: ['# 하나'],
    });
    expect(record.entries.map((entry) => entry.memberId)).toEqual(['me', 'partner']);
  });

  it('저장소 조회에서도 상대 rating-only는 보이고 내 rating-only는 대기 상태로 남는다', async () => {
    const { visits } = build({
      tables: {
        visits: [
          visitRow({
            visit_entries: [
              { author_id: ME, note: null, rating: 3 },
              { author_id: PARTNER, note: null, rating: 5 },
            ],
          }),
        ],
      },
    });

    const [record] = await visits.getRecords();

    expect(record.rating).toBe(3);
    expect(record.entries).toEqual([
      expect.objectContaining({ memberId: 'partner', text: null, rating: 5, readOnly: true }),
    ]);
  });

  it('커플 id를 클라이언트가 넘기지 않는다 — RLS가 범위를 정한다', async () => {
    const { client, visits } = build({ tables: { visits: [] } });

    await visits.getRecords();

    expect(queriesFor(client, 'visits')[0].filters).toEqual([]);
  });
});

describe('getRecord', () => {
  it('id로 한 건을 읽는다', async () => {
    const { client, visits } = build({ tables: { visits: [visitRow()] } });

    await expect(visits.getRecord('v1')).resolves.toMatchObject({ id: 'v1' });
    expect(queriesFor(client, 'visits')[0].filters).toEqual([['eq', 'id', 'v1']]);
  });

  it('보이지 않는 기록은 null이다 (존재 여부를 알려주지 않는다)', async () => {
    const { visits } = build({ tables: { visits: [] } });

    await expect(visits.getRecord('v1')).resolves.toBeNull();
  });

  it('id가 없으면 validation으로 거부한다', async () => {
    const { visits } = build({ tables: { visits: [] } });

    await expect(visits.getRecord('')).rejects.toMatchObject({ code: ERROR_CODES.validation });
    await expect(visits.getRecord(null)).rejects.toMatchObject({ code: ERROR_CODES.validation });
  });
});

describe('saveFiveSecondRecord — 기다리는 기록에 내 한 줄 붙이기', () => {
  it('upsert_my_visit_entry만 부르고 새 기록을 만들지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow({ visit_entries: [{ author_id: ME, note: '내 한 줄', rating: 3 }] })] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1', pending: false }) },
    });

    await expect(visits.saveFiveSecondRecord({ recordId: 'v1', text: '내 한 줄', rating: 3 })).resolves.toMatchObject({
      id: 'v1',
    });

    expect(rpcNames(client)).toEqual(['upsert_my_visit_entry']);
    expect(lastRpcArgs(client, 'upsert_my_visit_entry')).toEqual({
      p_visit_id: 'v1',
      p_text: '내 한 줄',
      p_rating: 3,
    });
  });

  it('상대 한 줄이나 상대 별점을 만들지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow({ visit_entries: [{ author_id: ME, note: '내 한 줄', rating: 3 }] })] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }) },
    });

    await visits.saveFiveSecondRecord({ recordId: 'v1', text: '내 한 줄', rating: 3 });

    for (const call of client.calls.rpc) {
      expect(JSON.stringify(call.args)).not.toContain(PARTNER);
    }
    expect(client.calls.queries.filter((query) => query.op !== 'select')).toEqual([]);
  });

  it('대기 카드를 채우려고 보충 기록을 만들지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow({ visit_entries: [{ author_id: ME, note: '내 한 줄', rating: 3 }] })] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }) },
    });

    await visits.saveFiveSecondRecord({ recordId: 'v1', text: '내 한 줄', rating: 3 });

    expect(rpcNames(client)).not.toContain('create_visit');
  });

  it('빈 한 줄은 null로 보내 대기 상태를 유지하고 입력을 되돌리지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow({ visit_entries: [{ author_id: ME, note: null, rating: 3 }] })] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1', pending: true }) },
    });

    const record = await visits.saveFiveSecondRecord({ recordId: 'v1', text: '   ', rating: 3 });

    expect(lastRpcArgs(client, 'upsert_my_visit_entry')).toEqual({
      p_visit_id: 'v1',
      p_text: null,
      p_rating: 3,
    });
    expect(record.entries).toEqual([]);
    expect(record.rating).toBe(3);
  });

  it('별점 0은 별점 없음(null)이다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow()] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }) },
    });

    await visits.saveFiveSecondRecord({ recordId: 'v1', text: 'x', rating: 0 });

    expect(lastRpcArgs(client, 'upsert_my_visit_entry').p_rating).toBeNull();
  });

  it('없는 기록은 not_found로 거부한다', async () => {
    const { visits } = build({
      tables: { visits: [] },
      rpc: { upsert_my_visit_entry: errorEnvelope('not_found', { resource: 'visit' }) },
    });

    await expect(visits.saveFiveSecondRecord({ recordId: 'v9', text: 'x' })).rejects.toMatchObject({
      code: ERROR_CODES.not_found,
    });
  });
});

describe('saveFiveSecondRecord — 새 기록', () => {
  const NEW_ROW = visitRow({ id: 'v2', visit_entries: [{ author_id: ME, note: '내 한 줄', rating: 3 }] });

  it('create_visit → upsert_my_visit_entry 순서로 부른다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2', couple_id: 'c1' }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v2' }),
      },
      placeSearchAdapter: {
        getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀', category: '카페' }),
      },
    });

    await expect(visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: '내 한 줄', rating: 3 })).resolves.toMatchObject(
      { id: 'v2' },
    );

    expect(rpcNames(client)).toEqual(['create_visit', 'upsert_my_visit_entry']);
  });

  it('create_visit에 필수 멱등 키와 장소 스냅샷을 보낸다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v2' }),
      },
      placeSearchAdapter: {
        getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀', category: '카페' }),
      },
    });

    await visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: 'x', rating: 3, date: '2026-05-03T10:14:00Z' });

    expect(lastRpcArgs(client, 'create_visit')).toEqual({
      p_place: { provider: 'kakao', provider_id: 'kakao-1', name: '성수동 블루보틀', category: '카페' },
      p_visited_at: '2026-05-03T10:14:00.000Z',
      p_request_key: 'request-key-1',
    });
  });

  it('호출자가 준 멱등 키를 재시도에 그대로 쓴다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v2' }),
      },
      placeSearchAdapter: { getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀' }) },
    });

    await visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: 'x', requestKey: 'screen-entry-key' });

    expect(lastRpcArgs(client, 'create_visit').p_request_key).toBe('screen-entry-key');
  });

  it('날짜를 주지 않으면 주입된 현재 시각을 쓴다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v2' }),
      },
      placeSearchAdapter: { getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀' }) },
    });

    await visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: 'x' });

    expect(lastRpcArgs(client, 'create_visit').p_visited_at).toBe(NOW.toISOString());
  });

  it('빈 기록으로 저장할 수 있다 — 한 줄도 별점도 없으면 entry를 만들지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow({ id: 'v2' })] },
      rpc: { create_visit: okEnvelope({ visit_id: 'v2' }) },
      placeSearchAdapter: { getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀' }) },
    });

    const record = await visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: '', rating: 0 });

    expect(rpcNames(client)).toEqual(['create_visit']);
    expect(record.entries).toEqual([]);
  });

  it('상대 한 줄을 함께 만들지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v2' }),
      },
      placeSearchAdapter: { getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀' }) },
    });

    const record = await visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: '내 한 줄', rating: 3 });

    expect(record.entries.filter((entry) => entry.memberId === 'partner')).toEqual([]);
    expect(client.calls.rpc.filter((call) => call.name === 'upsert_my_visit_entry')).toHaveLength(1);
  });

  it('장소를 직접 넘기면 검색 어댑터를 부르지 않는다', async () => {
    const getPlace = vi.fn();
    const { client, visits } = build({
      tables: { visits: [visitRow({ id: 'v2' })] },
      rpc: { create_visit: okEnvelope({ visit_id: 'v2' }) },
      placeSearchAdapter: { getPlace },
    });

    await visits.saveFiveSecondRecord({ place: { name: '직접 입력한 곳' } });

    expect(getPlace).not.toHaveBeenCalled();
    expect(lastRpcArgs(client, 'create_visit').p_place).toEqual({ provider: 'manual', name: '직접 입력한 곳' });
  });

  it('장소 검색이 아직 비어 있으면 not_found로 거부하고 기록을 만들지 않는다', async () => {
    const { client, visits } = build({ tables: { visits: [] }, rpc: {} });

    await expect(visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: 'x' })).rejects.toMatchObject({
      code: ERROR_CODES.not_found,
    });
    expect(client.calls.rpc).toEqual([]);
  });

  it('장소도 기록도 없으면 validation으로 거부한다', async () => {
    const { client, visits } = build({ tables: { visits: [] }, rpc: {} });

    await expect(visits.saveFiveSecondRecord({ text: 'x' })).rejects.toMatchObject({
      code: ERROR_CODES.validation,
    });
    expect(client.calls.rpc).toEqual([]);
  });

  it('create_visit 실패 시 한 줄을 쓰지 않고 입력을 그대로 돌려준다', async () => {
    const { client, visits } = build({
      tables: { visits: [] },
      rpc: { create_visit: transportFailure(new TypeError('Failed to fetch')) },
      placeSearchAdapter: { getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀' }) },
    });

    await expect(visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: 'x', rating: 3 })).rejects.toMatchObject({
      code: ERROR_CODES.network,
      retryable: true,
    });
    expect(rpcNames(client)).toEqual(['create_visit']);
  });
});

describe('setRecordFlower', () => {
  it('visits.flower_key를 갱신하고 최신 기록을 준다', async () => {
    const { client, visits } = build({
      tables: {
        visits: (query) => (query.op === 'update' ? [{ id: 'v1' }] : [visitRow({ flower_key: 'rose' })]),
      },
    });

    await expect(visits.setRecordFlower('v1', 'rose')).resolves.toMatchObject({ flower: 'rose' });

    const update = queriesFor(client, 'visits').find((query) => query.op === 'update');
    expect(update.payload).toEqual({ flower_key: 'rose' });
    expect(update.filters).toEqual([['eq', 'id', 'v1']]);
  });

  it('null을 넘기면 꽃갈피를 해제한다', async () => {
    const { client, visits } = build({
      tables: {
        visits: (query) => (query.op === 'update' ? [{ id: 'v1' }] : [visitRow({ flower_key: null })]),
      },
    });

    await expect(visits.setRecordFlower('v1', null)).resolves.toMatchObject({ flower: null });
    expect(queriesFor(client, 'visits').find((query) => query.op === 'update').payload).toEqual({ flower_key: null });
  });

  it('한 줄·별점을 건드리지 않는다 — 대기 상태에 영향이 없다', async () => {
    const row = visitRow({ visit_entries: [{ author_id: ME, note: null, rating: 3 }] });
    const { client, visits } = build({
      tables: { visits: (query) => (query.op === 'update' ? [{ id: 'v1' }] : [row]) },
    });

    const record = await visits.setRecordFlower('v1', 'rose');

    expect(client.calls.rpc).toEqual([]);
    expect(record.entries).toEqual([]);
  });

  it('RLS가 막으면 0행이므로 not_found다', async () => {
    const { visits } = build({ tables: { visits: [] } });

    await expect(visits.setRecordFlower('v1', 'rose')).rejects.toMatchObject({ code: ERROR_CODES.not_found });
  });

  it('꽃 키가 없는 값이면 conflict/validation으로 번역된다', async () => {
    const { visits } = build({
      tables: {
        visits: transportFailure({ code: '23503', message: 'foreign key violation' }),
      },
    });

    await expect(visits.setRecordFlower('v1', 'nope')).rejects.toMatchObject({ code: ERROR_CODES.conflict });
  });
});

describe('updateRecord', () => {
  const EDITED_ROW = visitRow({
    visit_entries: [{ author_id: ME, note: '고친 한 줄', rating: 4 }],
    visit_tags: [{ ordinal: 1, label: '# 하나' }],
  });

  it('태그·한 줄·별점을 각자의 RPC로 나눠 저장한다', async () => {
    const { client, visits } = build({
      tables: { visits: [EDITED_ROW] },
      rpc: {
        set_visit_tags: okEnvelope({ visit_id: 'v1', tag_count: 1 }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }),
      },
    });

    await expect(
      visits.updateRecord('v1', { tags: ['# 하나'], text: '고친 한 줄', rating: 4 }),
    ).resolves.toMatchObject({ tags: ['# 하나'], rating: 4 });

    expect(rpcNames(client)).toEqual(['set_visit_tags', 'upsert_my_visit_entry']);
    expect(lastRpcArgs(client, 'set_visit_tags')).toEqual({ p_visit_id: 'v1', p_labels: ['# 하나'] });
    expect(lastRpcArgs(client, 'upsert_my_visit_entry')).toEqual({
      p_visit_id: 'v1',
      p_text: '고친 한 줄',
      p_rating: 4,
    });
  });

  it('한 줄을 비우면 대기 상태로 돌아간다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow({ visit_entries: [{ author_id: ME, note: null, rating: 4 }] })] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1', pending: true }) },
    });

    const record = await visits.updateRecord('v1', { text: '   ', rating: 4 });

    expect(lastRpcArgs(client, 'upsert_my_visit_entry').p_text).toBeNull();
    expect(record.entries).toEqual([]);
  });

  it('별점만 고칠 때 기존 한 줄을 지우지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [EDITED_ROW] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }) },
    });

    await visits.updateRecord('v1', { rating: 5 });

    expect(lastRpcArgs(client, 'upsert_my_visit_entry')).toEqual({
      p_visit_id: 'v1',
      p_text: '고친 한 줄',
      p_rating: 5,
    });
  });

  it('한 줄만 고칠 때 기존 별점을 지우지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [EDITED_ROW] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }) },
    });

    await visits.updateRecord('v1', { text: '다시 고친 한 줄' });

    expect(lastRpcArgs(client, 'upsert_my_visit_entry')).toEqual({
      p_visit_id: 'v1',
      p_text: '다시 고친 한 줄',
      p_rating: 4,
    });
  });

  it('꽃갈피와 날짜는 공동 데이터라 visits update로 간다', async () => {
    const { client, visits } = build({
      tables: { visits: (query) => (query.op === 'update' ? [{ id: 'v1' }] : [EDITED_ROW]) },
    });

    await visits.updateRecord('v1', { flower: 'lilac', date: '2026-05-04T09:00:00Z' });

    const update = queriesFor(client, 'visits').find((query) => query.op === 'update');
    expect(update.payload).toEqual({ flower_key: 'lilac', visited_at: '2026-05-04T09:00:00.000Z' });
  });

  it('상대 한 줄을 쓰지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [EDITED_ROW] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }) },
    });

    await visits.updateRecord('v1', { text: 'x', rating: 3 });

    expect(client.calls.rpc.every((call) => call.name === 'upsert_my_visit_entry')).toBe(true);
    for (const call of client.calls.rpc) {
      expect(JSON.stringify(call.args)).not.toContain(PARTNER);
    }
  });

  it('지원하지 않는 patch 키는 조용히 버리지 않고 validation으로 거부한다', async () => {
    const { client, visits } = build({ tables: { visits: [EDITED_ROW] }, rpc: {} });

    await expect(visits.updateRecord('v1', { entries: [] })).rejects.toMatchObject({
      code: ERROR_CODES.validation,
    });
    expect(client.calls.rpc).toEqual([]);
  });

  it('빈 patch는 아무것도 쓰지 않고 최신 기록만 준다', async () => {
    const { client, visits } = build({ tables: { visits: [EDITED_ROW] }, rpc: {} });

    await expect(visits.updateRecord('v1', {})).resolves.toMatchObject({ id: 'v1' });
    expect(client.calls.rpc).toEqual([]);
    expect(client.calls.queries.filter((query) => query.op !== 'select')).toEqual([]);
  });

  it('없는 기록은 not_found로 거부한다', async () => {
    const { visits } = build({
      tables: { visits: [] },
      rpc: { set_visit_tags: errorEnvelope('not_found', { resource: 'visit' }) },
    });

    await expect(visits.updateRecord('v9', { tags: ['x'] })).rejects.toMatchObject({
      code: ERROR_CODES.not_found,
    });
  });
});

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
  place_phone: null,
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
  const {
    placeSearchAdapter,
    newRequestKey = () => 'request-key-1',
    ...clientConfig
  } = config;
  const client = createFakeSupabaseClient({ userId: ME, ...clientConfig });
  const repositories = createRepositories({
    client,
    placeSearchAdapter,
    newRequestKey,
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

    const record = await visits.saveFiveSecondRecord({ recordId: 'v1', text: '내 한 줄', rating: 3 });

    expect(record).toMatchObject({ id: 'v1', pending: false });

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

  it.each([
    ['entries', { entries: [{ memberId: 'partner', text: '상대 한 줄', rating: 5 }] }],
    ['authorId', { authorId: PARTNER }],
    ['memberId', { memberId: 'partner' }],
  ])('%s로 상대 기록을 쓰려는 입력은 auth·RPC 전에 거부한다', async (_key, malicious) => {
    const { client, visits } = build({ tables: {}, rpc: {} });
    const input = Object.freeze({ recordId: 'v1', text: '내 한 줄', ...malicious });

    await expect(visits.saveFiveSecondRecord(input)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
      retryable: false,
    });

    expect(client.calls.auth).toEqual([]);
    expect(client.calls.rpc).toEqual([]);
    expect(client.calls.queries).toEqual([]);
  });

  it.each([
    ['한 줄 타입', { text: { value: '내 한 줄' }, rating: 3 }],
    ['1~5 범위 밖 별점', { text: '내 한 줄', rating: 6 }],
    ['소수 별점', { text: '내 한 줄', rating: 2.5 }],
  ])('잘못된 %s 입력은 자동 clear하지 않고 쓰기 전에 거부한다', async (_caseName, entry) => {
    const { client, visits } = build({ tables: {}, rpc: {} });
    const input = Object.freeze({ recordId: 'v1', ...entry });

    await expect(visits.saveFiveSecondRecord(input)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
    });

    expect(client.calls.auth).toEqual([]);
    expect(client.calls.rpc).toEqual([]);
    expect(client.calls.queries).toEqual([]);
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
  const NEW_ROW = visitRow({ id: 'v2', flower_key: null });

  it('새 방문은 create_visit 한 번으로만 만들고 개인 entry를 함께 쓰지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2', couple_id: 'c1' }),
      },
      placeSearchAdapter: {
        getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀', category: '카페' }),
      },
    });

    await expect(visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: '내 한 줄', rating: 3 })).resolves.toMatchObject(
      { id: 'v2', pending: true, flower: null, entries: [] },
    );

    expect(rpcNames(client)).toEqual(['create_visit']);
  });

  it('정규화된 Kakao 장소 스냅샷·방문 시각·호출자 멱등 키만 보내고 입력을 바꾸지 않는다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
      },
    });
    const input = {
      place: {
        id: 'kakao-1',
        name: '성수동 블루보틀',
        category: '음식점 > 카페',
        address: '서울 성동구 성수동 1',
        roadAddress: '서울 성동구 연무장길 7',
        phone: '02-000-0000',
        url: 'https://place.map.kakao.com/kakao-1',
        lat: 37.5443,
        lng: 127.0557,
        provider: 'kakao',
      },
      date: '2026-05-03T10:14:00+09:00',
      requestKey: 'visit-intent-1',
    };
    const original = structuredClone(input);

    await visits.saveFiveSecondRecord(input);

    expect(lastRpcArgs(client, 'create_visit')).toEqual({
      p_place: {
        provider: 'kakao',
        provider_id: 'kakao-1',
        name: '성수동 블루보틀',
        category: '음식점 > 카페',
        address: '서울 성동구 성수동 1',
        road_address: '서울 성동구 연무장길 7',
        phone: '02-000-0000',
        url: 'https://place.map.kakao.com/kakao-1',
        lat: 37.5443,
        lng: 127.0557,
      },
      p_visited_at: '2026-05-03T01:14:00.000Z',
      p_request_key: 'visit-intent-1',
    });
    expect(input).toEqual(original);
    expect(rpcNames(client)).toEqual(['create_visit']);
  });

  it('호출자가 준 멱등 키를 재시도에 그대로 쓴다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
      },
      placeSearchAdapter: { getPlace: async () => ({ id: 'kakao-1', name: '성수동 블루보틀' }) },
    });

    await visits.saveFiveSecondRecord({ placeId: 'kakao-1', text: 'x', requestKey: 'screen-entry-key' });

    expect(lastRpcArgs(client, 'create_visit').p_request_key).toBe('screen-entry-key');
  });

  it('같은 생성 의도를 재시도하면 새 키를 만들지 않고 각 시도에 같은 키를 전달한다', async () => {
    let requestKeyGenerationCount = 0;
    const { client, visits } = build({
      newRequestKey: () => `generated-${++requestKeyGenerationCount}`,
      tables: { visits: [NEW_ROW] },
      rpc: { create_visit: okEnvelope({ visit_id: 'v2' }, true) },
    });
    const input = {
      place: { id: 'kakao-1', name: '성수동 블루보틀', provider: 'kakao' },
      date: '2026-05-03T10:14:00Z',
      requestKey: 'same-visit-key',
    };

    await visits.saveFiveSecondRecord(input);
    await visits.saveFiveSecondRecord(input);

    expect(client.calls.rpc.map((call) => call.args.p_request_key)).toEqual([
      'same-visit-key',
      'same-visit-key',
    ]);
    expect(rpcNames(client)).toEqual(['create_visit', 'create_visit']);
    expect(requestKeyGenerationCount).toBe(0);
  });

  it('날짜를 주지 않으면 주입된 현재 시각을 쓴다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: {
        create_visit: okEnvelope({ visit_id: 'v2' }),
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
    expect(record).toMatchObject({ pending: true, flower: null, tags: [], photos: [] });
  });

  it('새 기록 입력에 한 줄·별점·꽃갈피·태그·사진이 섞여도 공유 빈 기록만 만든다', async () => {
    const { client, visits } = build({
      tables: { visits: [NEW_ROW] },
      rpc: { create_visit: okEnvelope({ visit_id: 'v2' }) },
    });

    const record = await visits.saveFiveSecondRecord({
      place: { id: 'kakao-1', name: '성수동 블루보틀', provider: 'kakao' },
      text: '내 한 줄',
      rating: 3,
      flower: 'rose',
      tags: ['# 데이트'],
      photos: [{ path: 'do-not-send.webp' }],
    });

    expect(record).toMatchObject({ pending: true, flower: null, entries: [], tags: [], photos: [] });
    expect(rpcNames(client)).toEqual(['create_visit']);
    expect(lastRpcArgs(client, 'create_visit')).not.toHaveProperty('p_flower');
    expect(lastRpcArgs(client, 'create_visit')).not.toHaveProperty('p_tags');
    expect(lastRpcArgs(client, 'create_visit')).not.toHaveProperty('p_photos');
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
    expect(record.pending).toBe(true);
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

  it('문자열이 아닌 꽃 값은 쓰기 전에 validation으로 거부한다', async () => {
    const { client, visits } = build({ tables: {}, rpc: {} });

    await expect(visits.setRecordFlower('v1', 42)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
      retryable: false,
    });
    expect(client.calls.auth).toEqual([]);
    expect(client.calls.queries).toEqual([]);
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

  it('태그는 빈 값을 제거하고 사용자가 넘긴 순서 그대로 저장한다', async () => {
    const { client, visits } = build({
      tables: { visits: [EDITED_ROW] },
      rpc: { set_visit_tags: okEnvelope({ visit_id: 'v1', tag_count: 2 }) },
    });
    const patch = Object.freeze({ tags: Object.freeze([' # 첫 ', ' ', '# 둘']) });

    await visits.updateRecord('v1', patch);

    expect(lastRpcArgs(client, 'set_visit_tags')).toEqual({
      p_visit_id: 'v1',
      p_labels: ['# 첫', '# 둘'],
    });
    expect(patch.tags).toEqual([' # 첫 ', ' ', '# 둘']);
  });

  it.each([
    ['text', { text: { value: '내 한 줄' } }],
    ['undefined text', { text: undefined }],
    ['rating', { rating: 6 }],
    ['undefined rating', { rating: undefined }],
    ['tags', { tags: '# 문자열' }],
    ['tag item', { tags: ['# 정상', 42] }],
    ['flower', { flower: 42 }],
    ['undefined flower', { flower: undefined }],
    ['date', { date: null }],
    ['place id', { place: { id: 42, name: '새 장소' } }],
    ['place coordinate', { place: { name: '새 장소', lat: '37.5' } }],
  ])('잘못된 %s patch는 기존 값을 clear하거나 일부 저장하기 전에 거부한다', async (_field, invalidPatch) => {
    const { client, visits } = build({
      tables: { visits: [EDITED_ROW] },
      rpc: {
        set_visit_tags: okEnvelope({ visit_id: 'v1' }),
        upsert_my_visit_entry: okEnvelope({ visit_id: 'v1' }),
      },
    });
    const patch = Object.freeze(invalidPatch);
    const original = structuredClone(invalidPatch);

    await expect(visits.updateRecord('v1', patch)).rejects.toMatchObject({
      code: ERROR_CODES.validation,
      retryable: false,
    });

    expect(patch).toEqual(original);
    expect(client.calls.auth).toEqual([]);
    expect(client.calls.rpc).toEqual([]);
    expect(client.calls.queries).toEqual([]);
  });

  it('한 줄을 비우면 대기 상태로 돌아간다', async () => {
    const { client, visits } = build({
      tables: { visits: [visitRow({ visit_entries: [{ author_id: ME, note: null, rating: 4 }] })] },
      rpc: { upsert_my_visit_entry: okEnvelope({ visit_id: 'v1', pending: true }) },
    });

    const record = await visits.updateRecord('v1', { text: '   ', rating: 4 });

    expect(lastRpcArgs(client, 'upsert_my_visit_entry').p_text).toBeNull();
    expect(record.entries).toEqual([]);
    expect(record.pending).toBe(true);
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

  it('장소는 정규화한 전체 스냅샷과 공동 컬럼을 한 번에 바꾸고 최신 장소를 다시 읽는다', async () => {
    const latestRow = visitRow({
      ...EDITED_ROW,
      place_provider: 'kakao',
      place_provider_id: 'kakao-2',
      place_name: '연남동 카페',
      place_category: '음식점 > 카페',
      place_address: '서울 마포구 연남동',
      place_road_address: '서울 마포구 동교로 1',
      place_phone: '02-000-0000',
      place_url: 'https://place.map.kakao.com/kakao-2',
      place_lat: 37.566,
      place_lng: 126.922,
    });
    let selectCount = 0;
    const { client, visits } = build({
      tables: {
        visits: (query) => {
          if (query.op === 'update') return [{ id: 'v1' }];
          selectCount += 1;
          return selectCount === 1 ? [EDITED_ROW] : [latestRow];
        },
      },
    });
    const patch = Object.freeze({
      place: Object.freeze({
        id: ' kakao-2 ',
        name: '  연남동 카페  ',
        category: ' 음식점 > 카페 ',
        address: ' 서울 마포구 연남동 ',
        roadAddress: ' 서울 마포구 동교로 1 ',
        phone: ' 02-000-0000 ',
        url: ' https://place.map.kakao.com/kakao-2 ',
        lat: 37.566,
        lng: 126.922,
        provider: 'kakao',
      }),
    });
    const original = structuredClone(patch);

    const record = await visits.updateRecord('v1', patch);

    const normalizedPlace = {
      provider: 'kakao',
      provider_id: 'kakao-2',
      name: '연남동 카페',
      category: '음식점 > 카페',
      address: '서울 마포구 연남동',
      road_address: '서울 마포구 동교로 1',
      phone: '02-000-0000',
      url: 'https://place.map.kakao.com/kakao-2',
      lat: 37.566,
      lng: 126.922,
    };
    const update = queriesFor(client, 'visits').find((query) => query.op === 'update');
    expect(update.payload).toEqual({
      place_provider: 'kakao',
      place_provider_id: 'kakao-2',
      place_name: '연남동 카페',
      place_category: '음식점 > 카페',
      place_address: '서울 마포구 연남동',
      place_road_address: '서울 마포구 동교로 1',
      place_phone: '02-000-0000',
      place_url: 'https://place.map.kakao.com/kakao-2',
      place_lat: 37.566,
      place_lng: 126.922,
      place_snapshot: normalizedPlace,
      place_snapshot_at: NOW.toISOString(),
    });
    expect(update.filters).toEqual([['eq', 'id', 'v1']]);
    expect(record.place).toEqual({
      provider: 'kakao',
      providerId: 'kakao-2',
      name: '연남동 카페',
      category: '음식점 > 카페',
      address: '서울 마포구 연남동',
      roadAddress: '서울 마포구 동교로 1',
      phone: '02-000-0000',
      url: 'https://place.map.kakao.com/kakao-2',
      lat: 37.566,
      lng: 126.922,
    });
    expect(patch).toEqual(original);
    expect(client.calls.rpc).toEqual([]);
  });

  it('장소 공동 쓰기가 실패하면 입력과 기존 장소를 변경하지 않고 안정적으로 거부한다', async () => {
    const rawMessage = 'place update failed: secret backend detail';
    const { client, visits } = build({
      tables: {
        visits: (query) => (
          query.op === 'update'
            ? transportFailure({ status: 500, message: rawMessage })
            : [EDITED_ROW]
        ),
      },
    });
    const patch = Object.freeze({ place: Object.freeze({ name: '  새 장소  ' }) });
    const original = structuredClone(patch);

    const error = await visits.updateRecord('v1', patch).catch((caught) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.network, retryable: true });
    expect(error.message).not.toContain(rawMessage);
    expect(patch).toEqual(original);
    expect(queriesFor(client, 'visits')).toHaveLength(2);
    expect(client.calls.rpc).toEqual([]);
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

  it('개인 entry 쓰기가 실패하면 입력을 변경하지 않고 원시 백엔드 문구를 노출하지 않는다', async () => {
    const rawMessage = 'Failed to fetch https://backend.invalid?apikey=do-not-expose';
    const { client, visits } = build({
      tables: { visits: [EDITED_ROW] },
      rpc: { upsert_my_visit_entry: transportFailure(new TypeError(rawMessage)) },
    });
    const patch = Object.freeze({ text: '  변경할 한 줄  ', rating: 5 });
    const original = structuredClone(patch);

    const error = await visits.updateRecord('v1', patch).catch((caught) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.network, retryable: true });
    expect(error.message).not.toContain('backend.invalid');
    expect(error.message).not.toContain('apikey');
    expect(patch).toEqual(original);
    expect(rpcNames(client)).toEqual(['upsert_my_visit_entry']);
    expect(queriesFor(client, 'visits')).toHaveLength(1);
  });
});

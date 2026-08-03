import { describe, expect, it } from 'vitest';
import {
  EMPTY_SETTINGS,
  SLOT_COLORS,
  mapCouple,
  mapVisit,
  mapWishlistPlace,
  normalizeEntryText,
  normalizeRating,
  normalizeTags,
  toPlacePayload,
} from './mappers';

const ME = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-05-03T12:00:00Z');

const coupleRow = (over = {}) => ({
  id: 'c1',
  status: 'active',
  started_on: '2026-05-03',
  connected_at: '2026-05-03T01:00:00Z',
  created_at: '2026-05-01T01:00:00Z',
  couple_members: [
    { user_id: ME, slot: 1, left_at: null },
    { user_id: PARTNER, slot: 2, left_at: null },
  ],
  ...over,
});

const profiles = [
  { id: ME, display_name: '지은' },
  { id: PARTNER, display_name: '태식' },
];

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
  place_phone: '02-000-0000',
  place_url: null,
  place_lat: 37.5443,
  place_lng: 127.0557,
  flower_key: 'rose',
  visit_entries: [],
  visit_tags: [],
  visit_photos: [],
  ...over,
});

describe('mapCouple — auth.uid로 me/partner 별칭을 정한다', () => {
  it('현재 사용자를 me로, 나머지 구성원을 partner로 붙인다', () => {
    const couple = mapCouple({ userId: ME, couple: coupleRow(), profiles, invite: null });

    expect(couple.me).toMatchObject({ id: 'me', userId: ME, name: '지은', initial: '지' });
    expect(couple.partner).toMatchObject({ id: 'partner', userId: PARTNER, name: '태식', initial: '태' });
  });

  it('상대 기기에서는 별칭이 뒤바뀐다 (같은 행, 다른 auth.uid)', () => {
    const couple = mapCouple({ userId: PARTNER, couple: coupleRow(), profiles, invite: null });

    expect(couple.me).toMatchObject({ userId: PARTNER, name: '태식' });
    expect(couple.partner).toMatchObject({ userId: ME, name: '지은' });
  });

  it('아바타 색은 slot으로 고정된다', () => {
    const couple = mapCouple({ userId: ME, couple: coupleRow(), profiles, invite: null });

    expect(couple.me.color).toBe(SLOT_COLORS[1]);
    expect(couple.partner.color).toBe(SLOT_COLORS[2]);
  });

  it('탈퇴(left_at)한 구성원은 세지 않는다', () => {
    const couple = mapCouple({
      userId: ME,
      couple: coupleRow({
        couple_members: [
          { user_id: ME, slot: 1, left_at: null },
          { user_id: PARTNER, slot: 2, left_at: '2026-06-01T00:00:00Z' },
        ],
      }),
      profiles,
      invite: null,
    });

    expect(couple.connected).toBe(false);
    expect(couple.partner.userId).toBeNull();
  });

  it('상대가 아직 없으면 빈 partner를 주고 이름을 만들어내지 않는다', () => {
    const couple = mapCouple({
      userId: ME,
      couple: coupleRow({ couple_members: [{ user_id: ME, slot: 1, left_at: null }] }),
      profiles: [{ id: ME, display_name: '지은' }],
      invite: null,
    });

    expect(couple.connected).toBe(false);
    expect(couple.partner).toMatchObject({ id: 'partner', userId: null, name: '', initial: '' });
    expect(couple.partner.color).toBe(SLOT_COLORS[2]);
  });

  it('커플이 없으면 온보딩 전 상태를 준다', () => {
    const couple = mapCouple({ userId: ME, couple: null, profiles: [], invite: null });

    expect(couple).toMatchObject({
      coupleId: null,
      connected: false,
      onboarded: false,
      inviteCode: '',
      startDate: null,
    });
    expect(couple.me).toMatchObject({ id: 'me', userId: ME, name: '', initial: '' });
  });

  it('이름이 없으면 아직 온보딩이 끝나지 않은 것으로 본다', () => {
    const couple = mapCouple({
      userId: ME,
      couple: coupleRow({ couple_members: [{ user_id: ME, slot: 1, left_at: null }] }),
      profiles: [{ id: ME, display_name: null }],
      invite: null,
    });

    expect(couple.onboarded).toBe(false);
  });

  it('커플 + 이름이 있으면 온보딩 완료다', () => {
    expect(mapCouple({ userId: ME, couple: coupleRow(), profiles, invite: null }).onboarded).toBe(true);
  });

  it('활성 초대 코드만 노출한다', () => {
    const active = mapCouple({
      userId: ME,
      couple: coupleRow(),
      profiles,
      invite: { code: '482195', status: 'active', expires_at: '2026-05-04T00:00:00Z' },
      now: NOW,
    });
    const consumed = mapCouple({
      userId: ME,
      couple: coupleRow(),
      profiles,
      invite: { code: '482195', status: 'consumed' },
    });

    expect(active).toMatchObject({
      inviteCode: '482195',
      inviteExpiresAt: '2026-05-04T00:00:00.000Z',
    });
    expect(consumed).toMatchObject({ inviteCode: '', inviteExpiresAt: null });
  });

  it('status가 active여도 시간이 지난 코드는 공유하지 않고 만료 시각만 안전하게 투영한다', () => {
    const expired = mapCouple({
      userId: ME,
      couple: coupleRow(),
      profiles,
      invite: { code: '482195', status: 'active', expires_at: '2026-05-03T11:59:59Z' },
      now: NOW,
    });
    const malformed = mapCouple({
      userId: ME,
      couple: coupleRow(),
      profiles,
      invite: { code: '999999', status: 'active', expires_at: 'not-a-date' },
      now: NOW,
    });

    expect(expired).toMatchObject({
      inviteCode: '',
      inviteExpiresAt: '2026-05-03T11:59:59.000Z',
    });
    expect(malformed).toMatchObject({ inviteCode: '', inviteExpiresAt: null });
  });

  it('started_on이 비면 connected_at → created_at 순으로 떨어진다', () => {
    const row = coupleRow({ started_on: null });
    expect(mapCouple({ userId: ME, couple: row, profiles, invite: null }).startDate).toBe(row.connected_at);

    const bare = coupleRow({ started_on: null, connected_at: null });
    expect(mapCouple({ userId: ME, couple: bare, profiles, invite: null }).startDate).toBe(bare.created_at);
  });
});

describe('mapVisit — 화면 기록 셰이프', () => {
  it('행을 현재 화면이 읽는 필드로 옮긴다', () => {
    const record = mapVisit(visitRow(), ME);

    expect(record).toMatchObject({
      id: 'v1',
      coupleId: 'c1',
      placeId: 'kakao-1',
      placeName: '성수동 블루보틀',
      category: '카페',
      date: '2026-05-03T10:14:00Z',
      pending: true,
      flower: 'rose',
      tags: [],
      photos: [],
      entries: [],
    });
  });

  it('장소 스냅샷을 통째로 보존한다', () => {
    expect(mapVisit(visitRow(), ME).place).toEqual({
      provider: 'kakao',
      providerId: 'kakao-1',
      name: '성수동 블루보틀',
      category: '카페',
      address: '서울 성동구 연무장길 7',
      roadAddress: null,
      phone: '02-000-0000',
      url: null,
      lat: 37.5443,
      lng: 127.0557,
    });
  });

  it('꽃갈피는 nullable이다 — 선택 없음이 null로 온다', () => {
    expect(mapVisit(visitRow({ flower_key: null }), ME).flower).toBeNull();
  });

  it('없는 행은 null이다', () => {
    expect(mapVisit(null, ME)).toBeNull();
  });

  it('태그는 ordinal 순서를 따른다 (행 순서가 섞여도)', () => {
    const record = mapVisit(
      visitRow({
        visit_tags: [
          { ordinal: 3, label: '# 셋' },
          { ordinal: 1, label: '# 하나' },
          { ordinal: 2, label: '# 둘' },
        ],
      }),
      ME,
    );

    expect(record.tags).toEqual(['# 하나', '# 둘', '# 셋']);
  });

  it('사진은 ordinal 순서를 따르고 저장소 경로를 유지한다', () => {
    const record = mapVisit(
      visitRow({
        visit_photos: [
          {
            id: 'p2',
            uploader_id: PARTNER,
            ordinal: 2,
            storage_bucket: 'visit-photos',
            storage_path: 'c1/v1/b.webp',
          },
          {
            id: 'p1',
            uploader_id: ME,
            ordinal: 1,
            storage_bucket: 'visit-photos',
            storage_path: 'c1/v1/a.webp',
          },
        ],
      }),
      ME,
    );

    expect(record.photos).toEqual([
      {
        id: 'p1',
        ordinal: 1,
        order: 1,
        bucket: 'visit-photos',
        path: 'c1/v1/a.webp',
        uploaderId: ME,
        ownedByMe: true,
      },
      {
        id: 'p2',
        ordinal: 2,
        order: 2,
        bucket: 'visit-photos',
        path: 'c1/v1/b.webp',
        uploaderId: PARTNER,
        ownedByMe: false,
      },
    ]);
  });

  it('사진 소유권 투영은 같은 방문을 보는 사용자에 따라 바뀌지만 기존 pending 계산은 바뀌지 않는다', () => {
    const row = visitRow({
      visit_entries: [{ author_id: ME, note: null, rating: 5 }],
      visit_photos: [{
        id: 'p1',
        uploader_id: ME,
        ordinal: 1,
        storage_bucket: 'visit-photos',
        storage_path: 'c1/v1/a.webp',
      }],
    });

    expect(mapVisit(row, ME)).toMatchObject({
      pending: true,
      photos: [{ uploaderId: ME, ownedByMe: true, order: 1 }],
    });
    expect(mapVisit(row, PARTNER)).toMatchObject({
      pending: true,
      photos: [{ uploaderId: ME, ownedByMe: false, order: 1 }],
    });
  });

  it('내 한 줄을 먼저, 상대 한 줄을 뒤에 놓는다', () => {
    const record = mapVisit(
      visitRow({
        visit_entries: [
          { author_id: PARTNER, note: '상대 한 줄', rating: 4, created_at: '2026-05-03T11:00:00Z' },
          { author_id: ME, note: '내 한 줄', rating: 3, created_at: '2026-05-03T12:00:00Z' },
        ],
      }),
      ME,
    );

    expect(record.entries.map((e) => e.memberId)).toEqual(['me', 'partner']);
    expect(record.entries[0]).toMatchObject({ memberId: 'me', text: '내 한 줄', rating: 3 });
  });

  it('상대 한 줄은 읽기 전용으로 표시된다', () => {
    const record = mapVisit(
      visitRow({
        visit_entries: [
          { author_id: ME, note: '내 한 줄', rating: 3 },
          { author_id: PARTNER, note: '상대 한 줄', rating: 4 },
        ],
      }),
      ME,
    );

    expect(record.entries.find((e) => e.memberId === 'partner').readOnly).toBe(true);
    expect(record.entries.find((e) => e.memberId === 'me').readOnly).toBe(false);
  });

  it('상대의 공백을 제거한 한 줄·별점을 함께 보여주되 반드시 읽기 전용으로 낸다', () => {
    const record = mapVisit(
      visitRow({
        visit_entries: [
          { author_id: ME, note: null, rating: 3 },
          { author_id: PARTNER, note: '  상대 한 줄  ', rating: 5 },
        ],
      }),
      ME,
    );

    expect(record.pending).toBe(true);
    expect(record.rating).toBe(3);
    expect(record.entries).toEqual([
      {
        memberId: 'partner',
        authorUserId: PARTNER,
        text: '상대 한 줄',
        rating: 5,
        readOnly: true,
      },
    ]);
  });

  it('한 줄이 비면(null) 그 사용자의 entry를 내보내지 않는다 — 대기 상태', () => {
    const record = mapVisit(
      visitRow({
        visit_entries: [
          { author_id: ME, note: null, rating: 3 },
          { author_id: PARTNER, note: '상대 한 줄', rating: 4 },
        ],
      }),
      ME,
    );

    expect(record.entries.map((e) => e.memberId)).toEqual(['partner']);
  });

  it('공백만 남은 한 줄도 대기 상태다', () => {
    const record = mapVisit(visitRow({ visit_entries: [{ author_id: ME, note: '   ', rating: 3 }] }), ME);

    expect(record.entries).toEqual([]);
  });

  it('별점은 개인 데이터이고 record.rating은 내 별점의 호환 투영이다', () => {
    const record = mapVisit(
      visitRow({
        visit_entries: [
          { author_id: ME, note: null, rating: 2 },
          { author_id: PARTNER, note: '상대 한 줄', rating: 5 },
        ],
      }),
      ME,
    );

    expect(record.rating).toBe(2);
    expect(record.entries).toHaveLength(1);
  });

  it('내 rating-only는 대기 상태로 숨기고 상대 rating-only는 읽기 전용으로 보여준다', () => {
    const record = mapVisit(
      visitRow({
        visit_entries: [
          { author_id: ME, note: null, rating: 3 },
          { author_id: PARTNER, note: null, rating: 5 },
        ],
      }),
      ME,
    );

    expect(record.rating).toBe(3);
    expect(record.entries).toEqual([
      {
        memberId: 'partner',
        authorUserId: PARTNER,
        text: null,
        rating: 5,
        readOnly: true,
      },
    ]);
  });

  it('상대 한 줄과 별점이 모두 없으면 상대 entry를 만들지 않는다', () => {
    const record = mapVisit(
      visitRow({
        visit_entries: [{ author_id: PARTNER, note: null, rating: null }],
      }),
      ME,
    );

    expect(record.entries).toEqual([]);
  });

  it('상대 기기에서 본 같은 행은 별점 투영이 상대 값으로 바뀐다', () => {
    const row = visitRow({
      visit_entries: [
        { author_id: ME, note: '내 한 줄', rating: 2 },
        { author_id: PARTNER, note: '상대 한 줄', rating: 5 },
      ],
    });

    expect(mapVisit(row, ME).rating).toBe(2);
    expect(mapVisit(row, PARTNER).rating).toBe(5);
  });

  it('내 별점이 없으면 0으로 떨어진다 (별점 없음)', () => {
    expect(mapVisit(visitRow({ visit_entries: [{ author_id: ME, note: 'x', rating: null }] }), ME).rating).toBe(0);
    expect(mapVisit(visitRow(), ME).rating).toBe(0);
  });

  it.each([
    ['내 entry가 없음', [], true],
    ['내 한 줄이 null이고 별점만 있음', [{ author_id: ME, note: null, rating: 5 }], true],
    ['내 한 줄이 공백이고 별점만 있음', [{ author_id: ME, note: '   ', rating: 5 }], true],
    ['상대 한 줄과 별점만 있음', [{ author_id: PARTNER, note: '상대 한 줄', rating: 5 }], true],
    [
      '내 한 줄은 비고 상대 한 줄은 있음',
      [
        { author_id: ME, note: null, rating: 5 },
        { author_id: PARTNER, note: '상대 한 줄', rating: 5 },
      ],
      true,
    ],
    ['내 한 줄이 유효함', [{ author_id: ME, note: '  내 한 줄  ', rating: null }], false],
    [
      '내 한 줄이 유효하고 상대 한 줄은 비어 있음',
      [
        { author_id: ME, note: '내 한 줄', rating: 1 },
        { author_id: PARTNER, note: null, rating: 5 },
      ],
      false,
    ],
  ])('pending은 현재 사용자 한 줄만 본다 — %s', (_caseName, visitEntries, pending) => {
    const record = mapVisit(
      visitRow({
        flower_key: 'rose',
        visit_entries: visitEntries,
        visit_tags: [{ ordinal: 1, label: '# 태그' }],
        visit_photos: [
          { id: 'p1', ordinal: 1, storage_bucket: 'visit-photos', storage_path: 'c1/v1/a.webp' },
        ],
      }),
      ME,
    );

    expect(record.pending).toBe(pending);
  });

  it('같은 공유 방문도 각 사용자의 한 줄 작성 여부에 따라 독립적으로 pending을 계산한다', () => {
    const blank = visitRow();
    const onlyMine = visitRow({
      visit_entries: [{ author_id: ME, note: '내 한 줄', rating: 3 }],
    });
    const both = visitRow({
      visit_entries: [
        { author_id: ME, note: '내 한 줄', rating: 3 },
        { author_id: PARTNER, note: '상대 한 줄', rating: 4 },
      ],
    });

    expect([mapVisit(blank, ME).pending, mapVisit(blank, PARTNER).pending]).toEqual([true, true]);
    expect([mapVisit(onlyMine, ME).pending, mapVisit(onlyMine, PARTNER).pending]).toEqual([false, true]);
    expect([mapVisit(both, ME).pending, mapVisit(both, PARTNER).pending]).toEqual([false, false]);
  });
});

describe('mapWishlistPlace', () => {
  it('담은 사람 메타데이터를 유지한 채 기록 생성에 바로 쓸 수 있는 장소 스냅샷을 만든다', () => {
    const nameById = new Map([[PARTNER, '태식']]);
    const row = Object.freeze({
      id: 'w1',
      place_provider: 'kakao',
      place_provider_id: 'kakao-1',
      place_name: '어라운드 성수',
      place_category: '카페',
      place_address: '서울 성동구 성수동',
      place_road_address: '서울 성동구 성수이로 1',
      place_url: 'https://place.map.kakao.com/kakao-1',
      place_lat: 37.54,
      place_lng: 127.05,
      created_by: PARTNER,
    });
    const item = mapWishlistPlace(
      row,
      nameById,
    );

    expect(item).toEqual({
      id: 'w1',
      provider: 'kakao',
      providerId: 'kakao-1',
      name: '어라운드 성수',
      category: '카페',
      address: '서울 성동구 성수동',
      roadAddress: '서울 성동구 성수이로 1',
      url: 'https://place.map.kakao.com/kakao-1',
      lat: 37.54,
      lng: 127.05,
      pickedBy: '태식',
      pickedByUserId: PARTNER,
    });
    expect(toPlacePayload(item)).toEqual({
      provider: 'kakao',
      provider_id: 'kakao-1',
      name: '어라운드 성수',
      category: '카페',
      address: '서울 성동구 성수동',
      road_address: '서울 성동구 성수이로 1',
      url: 'https://place.map.kakao.com/kakao-1',
      lat: 37.54,
      lng: 127.05,
    });
    expect(row.place_name).toBe('어라운드 성수');
  });

  it('이름을 모르면 빈 문자열이고 만들어내지 않는다', () => {
    const item = mapWishlistPlace({ id: 'w1', place_name: 'x', place_category: null, created_by: ME }, new Map());

    expect(item.pickedBy).toBe('');
    expect(item.category).toBe('');
    expect(item).toMatchObject({
      provider: 'kakao',
      providerId: null,
      address: null,
      roadAddress: null,
      url: null,
      lat: null,
      lng: null,
    });
  });

  it('manual wishlist의 자체 id를 외부 장소 provider id로 오인하지 않는다', () => {
    const item = mapWishlistPlace(
      {
        id: 'wishlist-row-id',
        place_provider: 'manual',
        place_provider_id: null,
        place_name: '직접 입력한 곳',
        created_by: ME,
      },
      new Map([[ME, '지은']]),
    );

    expect(toPlacePayload(item)).toEqual({
      provider: 'manual',
      name: '직접 입력한 곳',
    });
    expect(item).toMatchObject({
      id: 'wishlist-row-id',
      provider: 'manual',
      providerId: null,
      pickedBy: '지은',
    });
  });
});

describe('입력 정규화', () => {
  it('normalizeRating은 1~5만 통과시키고 나머지는 null이다', () => {
    expect(normalizeRating(3)).toBe(3);
    expect(normalizeRating(1)).toBe(1);
    expect(normalizeRating(5)).toBe(5);
    expect(normalizeRating(0)).toBeNull();
    expect(normalizeRating(6)).toBeNull();
    expect(normalizeRating(null)).toBeNull();
    expect(normalizeRating(undefined)).toBeNull();
    expect(normalizeRating('4')).toBe(4);
    expect(normalizeRating(2.7)).toBeNull();
  });

  it('normalizeEntryText는 앞뒤 공백을 자르고 빈 값을 null로 만든다', () => {
    expect(normalizeEntryText('  한 줄  ')).toBe('한 줄');
    expect(normalizeEntryText('')).toBeNull();
    expect(normalizeEntryText('   ')).toBeNull();
    expect(normalizeEntryText(undefined)).toBeNull();
  });

  it('normalizeTags는 순서를 지키고 빈 태그를 버린다', () => {
    expect(normalizeTags([' # 하나 ', '', '   ', '# 둘'])).toEqual(['# 하나', '# 둘']);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags('문자열')).toEqual([]);
  });
});

describe('toPlacePayload', () => {
  it('장소 검색 결과를 create_visit 스냅샷으로 옮긴다', () => {
    expect(
      toPlacePayload({
        id: 'kakao-1',
        name: '성수동 블루보틀',
        category: '카페',
        address: '서울 성동구 연무장길 7',
        lat: 37.5443,
        lng: 127.0557,
      }),
    ).toEqual({
      provider: 'kakao',
      provider_id: 'kakao-1',
      name: '성수동 블루보틀',
      category: '카페',
      address: '서울 성동구 연무장길 7',
      lat: 37.5443,
      lng: 127.0557,
    });
  });

  it('외부 식별자가 없으면 manual 스냅샷이다', () => {
    expect(toPlacePayload({ name: '  직접 입력한 곳  ' })).toEqual({ provider: 'manual', name: '직접 입력한 곳' });
  });

  it('이름 없는 장소는 스냅샷이 되지 않는다', () => {
    expect(toPlacePayload({ id: 'kakao-1', name: '   ' })).toBeNull();
    expect(toPlacePayload(null)).toBeNull();
    expect(toPlacePayload('성수동')).toBeNull();
  });

  it('좌표가 숫자가 아니면 넣지 않는다', () => {
    expect(toPlacePayload({ name: 'x', lat: 'abc', lng: null })).toEqual({ provider: 'manual', name: 'x' });
  });
});

describe('EMPTY_SETTINGS', () => {
  it('설정 모델이 없으므로 값을 만들어내지 않는다', () => {
    expect(EMPTY_SETTINGS).toEqual({ recordAlert: '' });
  });
});

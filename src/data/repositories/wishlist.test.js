import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../errors';
import { createRepositories } from './index';
import { createFakeSupabaseClient, queriesFor, transportFailure } from './__fixtures__/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';

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
      { id: 'w1', name: '어라운드 성수', category: '카페', pickedBy: '지은', pickedByUserId: ME },
      { id: 'w2', name: '뚝섬 한강공원', category: '공원', pickedBy: '태식', pickedByUserId: PARTNER },
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
      { id: 'w1', name: 'x', category: '', pickedBy: '', pickedByUserId: PARTNER },
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

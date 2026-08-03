import { mapWishlistPlace } from './mappers';
import { runQuery } from './rpc';

export function createWishlistRepository({ getClient, session }) {
  return {
    async getWishlist() {
      await session.ensureUserId();
      const client = getClient();
      const rows = await runQuery(
        client.from('wishlist_places').select('*').order('created_at', { ascending: false }),
      );
      if (!rows?.length) return [];

      const profiles = await runQuery(client.from('profiles').select('id,display_name'));
      const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name ?? '']));
      return rows.map((row) => mapWishlistPlace(row, nameById));
    },
  };
}

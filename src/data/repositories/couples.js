import { AppError, ERROR_CODES } from '../errors';
import { mapCouple } from './mappers';
import { callRpc, runQuery } from './rpc';

const COUPLE_COLUMNS =
  'id,status,started_on,connected_at,created_at,couple_members(user_id,slot,left_at)';

const validationError = (cause) => new AppError(ERROR_CODES.validation, { cause });

export function createCouplesRepository({ getClient, session, requestKey, now = () => new Date() }) {
  const getCouple = async () => {
    const userId = await session.ensureUserId();
    const client = getClient();
    const couple = await runQuery(
      client.from('couples').select(COUPLE_COLUMNS).eq('status', 'active').maybeSingle(),
    );

    if (!couple) return mapCouple({ userId, couple: null, profiles: [], invite: null });

    const profiles = await runQuery(client.from('profiles').select('id,display_name'));
    const invite = await runQuery(
      client
        .from('couple_invites')
        .select('code,status,expires_at')
        .eq('status', 'active')
        .maybeSingle(),
    );

    return mapCouple({ userId, couple, profiles, invite, now: now() });
  };

  return {
    getCouple,

    async createCouple(options = {}) {
      await session.ensureUserId();
      await callRpc(getClient(), 'create_couple', {
        p_display_name: options.displayName ?? null,
        p_started_on: options.startedOn ?? null,
        p_request_key: requestKey(options.requestKey),
      });
      return getCouple();
    },

    async reissueCoupleInvite(options = {}) {
      await session.ensureUserId();
      await callRpc(getClient(), 'reissue_couple_invite', {
        p_request_key: requestKey(options.requestKey),
      });
      return getCouple();
    },

    async connectWithCode(code, options = {}) {
      const normalizedCode = typeof code === 'string' ? code.trim() : '';
      if (!/^\d{6}$/.test(normalizedCode)) throw validationError({ field: 'code' });

      await session.ensureUserId();
      await callRpc(getClient(), 'join_couple_with_code', {
        p_code: normalizedCode,
        p_request_key: requestKey(options.requestKey),
        p_display_name: options.displayName ?? null,
      });
      return getCouple();
    },

    async setMyName(name) {
      const displayName = typeof name === 'string' ? name.trim() : '';
      if (!displayName) throw validationError({ field: 'name' });

      await session.ensureUserId();
      await callRpc(getClient(), 'upsert_my_profile', { p_display_name: displayName });
      return getCouple();
    },

    completeOnboarding() {
      return getCouple();
    },

    async disconnectCouple(options = {}) {
      await session.ensureUserId();
      const result = await callRpc(getClient(), 'disconnect_couple', {
        p_request_key: requestKey(options.requestKey),
      });
      return {
        disconnected: true,
        coupleId: result.data?.couple_id ?? null,
        replayed: result.replayed,
      };
    },
  };
}

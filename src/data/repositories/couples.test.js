import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../errors';
import { createRepositories } from './index';
import {
  createFakeSupabaseClient,
  errorEnvelope,
  lastRpcArgs,
  okEnvelope,
  queriesFor,
  raisedError,
  rpcNames,
  transportFailure,
} from './__fixtures__/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-05-03T12:00:00Z');

const COUPLE_ROW = {
  id: 'c1',
  status: 'active',
  started_on: '2026-05-03',
  connected_at: '2026-05-03T01:00:00Z',
  created_at: '2026-05-01T01:00:00Z',
  couple_members: [
    { user_id: ME, slot: 1, left_at: null },
    { user_id: PARTNER, slot: 2, left_at: null },
  ],
};

const PROFILE_ROWS = [
  { id: ME, display_name: '지은' },
  { id: PARTNER, display_name: '태식' },
];

const INVITE_ROW = { code: '482195', status: 'active', expires_at: '2026-05-04T00:00:00Z' };

const connectedTables = (over = {}) => ({
  couples: [COUPLE_ROW],
  profiles: PROFILE_ROWS,
  couple_invites: [INVITE_ROW],
  ...over,
});

const build = ({ now = () => NOW, newRequestKey = () => 'request-key-1', ...config } = {}) => {
  const client = createFakeSupabaseClient({ userId: ME, ...config });
  const repositories = createRepositories({ client, newRequestKey, now });
  return { client, couples: repositories.couples };
};

describe('getCouple', () => {
  it('활성 커플·프로필·초대 코드를 모아 화면 셰이프로 준다', async () => {
    const { couples } = build({ tables: connectedTables() });

    await expect(couples.getCouple()).resolves.toMatchObject({
      coupleId: 'c1',
      connected: true,
      onboarded: true,
      inviteCode: '482195',
      inviteExpiresAt: '2026-05-04T00:00:00.000Z',
      startDate: '2026-05-03',
      me: { id: 'me', name: '지은' },
      partner: { id: 'partner', name: '태식' },
    });
  });

  it('커플 id를 클라이언트가 넘기지 않는다 — RLS가 범위를 정한다', async () => {
    const { client, couples } = build({ tables: connectedTables() });

    await couples.getCouple();

    const [coupleQuery] = queriesFor(client, 'couples');
    expect(coupleQuery.filters).toEqual([['eq', 'status', 'active']]);
    expect(coupleQuery.columns).toContain('couple_members');

    const [profileQuery] = queriesFor(client, 'profiles');
    expect(profileQuery.filters).toEqual([]);
  });

  it('활성 초대 코드만 조회한다', async () => {
    const { client, couples } = build({ tables: connectedTables() });

    await couples.getCouple();

    expect(queriesFor(client, 'couple_invites')[0].filters).toEqual([['eq', 'status', 'active']]);
  });

  it('DB status가 active여도 만료 시각이 지난 초대 코드는 공유하지 않는다', async () => {
    const { couples } = build({
      tables: connectedTables({
        couple_invites: [
          { code: '482195', status: 'active', expires_at: '2026-05-03T11:59:59Z' },
        ],
      }),
    });

    await expect(couples.getCouple()).resolves.toMatchObject({
      inviteCode: '',
      inviteExpiresAt: '2026-05-03T11:59:59.000Z',
    });
  });

  it('커플이 없으면 초대 코드를 조회하지 않고 온보딩 전 상태를 준다', async () => {
    const { client, couples } = build({ tables: { couples: [], profiles: [] } });

    await expect(couples.getCouple()).resolves.toMatchObject({
      connected: false,
      onboarded: false,
      inviteCode: '',
    });
    expect(queriesFor(client, 'couple_invites')).toHaveLength(0);
  });

  it('먼저 익명 세션을 보장한다', async () => {
    const { client, couples } = build({ session: null, tables: { couples: [], profiles: [] } });

    await couples.getCouple();

    expect(client.calls.auth).toEqual(['getSession', 'signInAnonymously']);
  });

  it('조회 실패를 AppError로 바꿔 거부한다', async () => {
    const { couples } = build({
      tables: { couples: transportFailure({ status: 503, message: 'unavailable' }) },
    });

    await expect(couples.getCouple()).rejects.toMatchObject({
      code: ERROR_CODES.network,
      retryable: true,
    });
  });
});

describe('createCouple', () => {
  it('create_couple RPC로 커플과 첫 초대 코드를 만들고 최신 상태를 다시 읽는다', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: { create_couple: okEnvelope({ couple_id: 'c1', slot: 1, invite: { code: '482195' } }) },
    });

    await expect(couples.createCouple()).resolves.toMatchObject({ inviteCode: '482195' });
    expect(rpcNames(client)).toEqual(['create_couple']);
  });

  it('중복 실행에 안전하도록 멱등 키를 보낸다', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: { create_couple: okEnvelope({ couple_id: 'c1' }) },
    });

    await couples.createCouple();

    expect(lastRpcArgs(client, 'create_couple')).toEqual({
      p_display_name: null,
      p_started_on: null,
      p_request_key: 'request-key-1',
    });
  });

  it('호출자가 준 멱등 키를 그대로 쓴다 (재시도가 같은 키를 재사용한다)', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: { create_couple: okEnvelope({ couple_id: 'c1' }) },
    });

    await couples.createCouple({ requestKey: 'caller-key' });

    expect(lastRpcArgs(client, 'create_couple').p_request_key).toBe('caller-key');
  });

  it('같은 create 요청을 재시도해도 호출자가 준 멱등 키를 새 키로 바꾸지 않는다', async () => {
    let requestKeyGenerationCount = 0;
    const { client, couples } = build({
      newRequestKey: () => `generated-${++requestKeyGenerationCount}`,
      tables: connectedTables(),
      rpc: { create_couple: okEnvelope({ couple_id: 'c1' }, true) },
    });

    await couples.createCouple({ requestKey: 'same-create-key' });
    await couples.createCouple({ requestKey: 'same-create-key' });

    expect(client.calls.rpc.map((call) => call.args.p_request_key)).toEqual([
      'same-create-key',
      'same-create-key',
    ]);
    expect(requestKeyGenerationCount).toBe(0);
  });

  it('초대 코드 유효기간 미설정(TW014)은 configuration 오류다', async () => {
    const { couples } = build({
      tables: connectedTables(),
      rpc: {
        create_couple: transportFailure(raisedError('TW014', 'config_unresolved', { key: 'invite_ttl_seconds' })),
      },
    });

    await expect(couples.createCouple()).rejects.toMatchObject({
      code: ERROR_CODES.configuration,
      domainCode: 'config_unresolved',
    });
  });

  it('이미 활성 커플이 있으면 conflict로 거부한다', async () => {
    const { couples } = build({
      tables: connectedTables(),
      rpc: { create_couple: errorEnvelope('active_membership_conflict') },
    });

    await expect(couples.createCouple()).rejects.toMatchObject({
      code: ERROR_CODES.conflict,
      domainCode: 'active_membership_conflict',
    });
  });
});

describe('connectWithCode', () => {
  it('6자리가 아니면 서버를 부르지 않고 validation으로 거부한다', async () => {
    const { client, couples } = build({ tables: connectedTables(), rpc: {} });

    await expect(couples.connectWithCode('12a45')).rejects.toMatchObject({ code: ERROR_CODES.validation });
    await expect(couples.connectWithCode('1234567')).rejects.toMatchObject({ code: ERROR_CODES.validation });
    await expect(couples.connectWithCode('')).rejects.toMatchObject({ code: ERROR_CODES.validation });
    expect(client.calls.rpc).toEqual([]);
  });

  it('join_couple_with_code에 코드와 필수 멱등 키를 보낸다', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: { join_couple_with_code: okEnvelope({ couple_id: 'c1', slot: 2 }) },
    });

    await expect(couples.connectWithCode(' 482195 ')).resolves.toMatchObject({ connected: true });
    expect(lastRpcArgs(client, 'join_couple_with_code')).toEqual({
      p_code: '482195',
      p_request_key: 'request-key-1',
      p_display_name: null,
    });
  });

  it('가짜 커플을 만들어내지 않는다 — 상대 정보는 서버가 준 행에서만 온다', async () => {
    const { couples } = build({
      tables: connectedTables({
        couples: [{ ...COUPLE_ROW, couple_members: [{ user_id: ME, slot: 2, left_at: null }] }],
        profiles: [{ id: ME, display_name: '지은' }],
      }),
      rpc: { join_couple_with_code: okEnvelope({ couple_id: 'c1', slot: 2 }) },
    });

    const couple = await couples.connectWithCode('482195');

    expect(couple.partner).toMatchObject({ name: '', userId: null });
    expect(couple.connected).toBe(false);
  });

  it.each([
    ['invite_not_found', ERROR_CODES.not_found, false],
    ['invite_expired', ERROR_CODES.validation, false],
    ['invite_consumed', ERROR_CODES.conflict, false],
    ['invite_revoked', ERROR_CODES.validation, false],
    ['couple_capacity_reached', ERROR_CODES.conflict, false],
    ['active_membership_conflict', ERROR_CODES.conflict, false],
    ['rate_limited', ERROR_CODES.rate_limited, true],
  ])('%s 초대 실패를 다른 domainCode로 보존한다', async (domainCode, code, retryable) => {
    const { couples } = build({
      tables: connectedTables(),
      rpc: {
        join_couple_with_code: errorEnvelope(domainCode, { retry_after_seconds: 600 }),
      },
    });

    await expect(couples.connectWithCode('482195')).rejects.toMatchObject({
      code,
      domainCode,
      retryable,
    });
  });

  it('시도 제한은 rate_limited로 오고 재시도 가능하다', async () => {
    const { couples } = build({
      tables: connectedTables(),
      rpc: { join_couple_with_code: errorEnvelope('rate_limited', { retry_after_seconds: 600 }) },
    });

    await expect(couples.connectWithCode('482195')).rejects.toMatchObject({
      code: ERROR_CODES.rate_limited,
      retryable: true,
      details: { retry_after_seconds: 600 },
    });
  });

  it('같은 join 요청을 재시도해도 호출자가 준 멱등 키를 새 키로 바꾸지 않는다', async () => {
    let requestKeyGenerationCount = 0;
    const { client, couples } = build({
      newRequestKey: () => `generated-${++requestKeyGenerationCount}`,
      tables: connectedTables(),
      rpc: { join_couple_with_code: okEnvelope({ couple_id: 'c1', slot: 2 }, true) },
    });

    await couples.connectWithCode('482195', { requestKey: 'same-join-key' });
    await couples.connectWithCode('482195', { requestKey: 'same-join-key' });

    expect(client.calls.rpc.map((call) => call.args.p_request_key)).toEqual([
      'same-join-key',
      'same-join-key',
    ]);
    expect(requestKeyGenerationCount).toBe(0);
  });
});

describe('reissueCoupleInvite', () => {
  it('만료되거나 폐기된 활성 커플 초대를 RPC로 재발급하고 최신 상태를 읽는다', async () => {
    const { client, couples } = build({
      tables: connectedTables({
        couple_invites: [
          { code: '731904', status: 'active', expires_at: '2026-05-05T00:00:00Z' },
        ],
      }),
      rpc: {
        reissue_couple_invite: okEnvelope({
          couple_id: 'c1',
          invite: { code: '731904', status: 'active', expires_at: '2026-05-05T00:00:00Z' },
        }),
      },
    });

    await expect(
      couples.reissueCoupleInvite({ requestKey: 'same-reissue-key' }),
    ).resolves.toMatchObject({
      inviteCode: '731904',
      inviteExpiresAt: '2026-05-05T00:00:00.000Z',
    });
    expect(lastRpcArgs(client, 'reissue_couple_invite')).toEqual({
      p_request_key: 'same-reissue-key',
    });
  });

  it('재발급 재시도도 호출자가 준 같은 멱등 키를 유지한다', async () => {
    let requestKeyGenerationCount = 0;
    const { client, couples } = build({
      newRequestKey: () => `generated-${++requestKeyGenerationCount}`,
      tables: connectedTables(),
      rpc: {
        reissue_couple_invite: okEnvelope({ couple_id: 'c1' }, true),
      },
    });

    await couples.reissueCoupleInvite({ requestKey: 'same-reissue-key' });
    await couples.reissueCoupleInvite({ requestKey: 'same-reissue-key' });

    expect(client.calls.rpc.map((call) => call.args.p_request_key)).toEqual([
      'same-reissue-key',
      'same-reissue-key',
    ]);
    expect(requestKeyGenerationCount).toBe(0);
  });

  it('재발급 실패는 AppError를 보존하고 성공 상태를 만들어내지 않는다', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: {
        reissue_couple_invite: transportFailure(new TypeError('Failed to fetch')),
      },
    });

    await expect(
      couples.reissueCoupleInvite({ requestKey: 'same-reissue-key' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.network, retryable: true });
    expect(queriesFor(client, 'couples')).toHaveLength(0);
  });
});

describe('setMyName', () => {
  it('upsert_my_profile로 이름을 저장하고 최신 상태를 준다', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: { upsert_my_profile: okEnvelope({ user_id: ME, display_name: '지은' }) },
    });

    await expect(couples.setMyName('  지은  ')).resolves.toMatchObject({ me: { name: '지은', initial: '지' } });
    expect(lastRpcArgs(client, 'upsert_my_profile')).toEqual({ p_display_name: '지은' });
  });

  it('저장한 이름은 이후 조회에서도 RLS 프로필 행에서 다시 읽는다', async () => {
    let displayName = null;
    const { couples } = build({
      tables: connectedTables({
        profiles: () => [{ id: ME, display_name: displayName }],
      }),
      rpc: {
        upsert_my_profile: (args) => {
          displayName = args.p_display_name;
          return okEnvelope({ user_id: ME, display_name: displayName });
        },
      },
    });

    await couples.setMyName('  지은  ');

    await expect(couples.getCouple()).resolves.toMatchObject({
      me: { userId: ME, name: '지은' },
    });
  });

  it('빈 이름은 서버를 부르지 않고 validation으로 거부한다', async () => {
    const { client, couples } = build({ tables: connectedTables(), rpc: {} });

    await expect(couples.setMyName('   ')).rejects.toMatchObject({ code: ERROR_CODES.validation });
    expect(client.calls.rpc).toEqual([]);
  });
});

describe('completeOnboarding', () => {
  it('저장되는 플래그가 없으므로 최신 상태를 다시 읽기만 한다', async () => {
    const { client, couples } = build({ tables: connectedTables() });

    await expect(couples.completeOnboarding()).resolves.toMatchObject({ onboarded: true });
    expect(client.calls.rpc).toEqual([]);
  });

  it('이름이 없으면 완료로 만들지 않는다', async () => {
    const { couples } = build({
      tables: connectedTables({ profiles: [{ id: ME, display_name: null }] }),
    });

    await expect(couples.completeOnboarding()).resolves.toMatchObject({ onboarded: false });
  });
});

describe('disconnectCouple', () => {
  it('disconnect_couple RPC를 안정적인 멱등 키와 함께 부르고 purge 내부값은 노출하지 않는다', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: {
        disconnect_couple: okEnvelope({
          couple_id: 'c1',
          purge_job_id: 'j1',
          purge_due_at: '2026-05-04T00:00:00Z',
        }),
      },
    });

    const result = await couples.disconnectCouple();

    expect(result).toEqual({ disconnected: true, coupleId: 'c1', replayed: false });
    expect(result).not.toHaveProperty('purgeJobId');
    expect(result).not.toHaveProperty('purgeDueAt');
    expect(lastRpcArgs(client, 'disconnect_couple')).toEqual({ p_request_key: 'request-key-1' });
  });

  it('실패 후 같은 해제 의도를 재시도할 때 호출자가 준 키와 입력 객체를 그대로 보존한다', async () => {
    let attempts = 0;
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: {
        disconnect_couple: () => {
          attempts += 1;
          if (attempts === 1) return transportFailure(new TypeError('Failed to fetch'));
          return okEnvelope({ couple_id: 'c1' }, true);
        },
      },
    });
    const options = Object.freeze({ requestKey: 'disconnect-intent-1' });

    await expect(couples.disconnectCouple(options)).rejects.toMatchObject({
      code: ERROR_CODES.network,
    });
    await expect(couples.disconnectCouple(options)).resolves.toEqual({
      disconnected: true,
      coupleId: 'c1',
      replayed: true,
    });

    expect(client.calls.rpc.map((call) => call.args.p_request_key)).toEqual([
      'disconnect-intent-1',
      'disconnect-intent-1',
    ]);
    expect(options).toEqual({ requestKey: 'disconnect-intent-1' });
  });

  it('해제 요청이 실패하면 거부하고 아무것도 지우지 않는다', async () => {
    const { couples } = build({
      tables: connectedTables(),
      rpc: { disconnect_couple: transportFailure(new TypeError('Failed to fetch')) },
    });

    await expect(couples.disconnectCouple()).rejects.toMatchObject({ code: ERROR_CODES.network });
  });
});

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

const build = (config = {}) => {
  const client = createFakeSupabaseClient({ userId: ME, ...config });
  const repositories = createRepositories({ client, newRequestKey: () => 'request-key-1' });
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

  it('사용된 코드와 만료된 코드를 구분해서 거부한다', async () => {
    const consumed = build({
      tables: connectedTables(),
      rpc: { join_couple_with_code: errorEnvelope('invite_consumed', { consumed_at: 'x' }) },
    });
    const expired = build({
      tables: connectedTables(),
      rpc: { join_couple_with_code: errorEnvelope('invite_expired', { expired_at: 'x' }) },
    });
    const capacity = build({
      tables: connectedTables(),
      rpc: { join_couple_with_code: errorEnvelope('couple_capacity_reached') },
    });

    await expect(consumed.couples.connectWithCode('482195')).rejects.toMatchObject({
      domainCode: 'invite_consumed',
    });
    await expect(expired.couples.connectWithCode('482195')).rejects.toMatchObject({
      domainCode: 'invite_expired',
    });
    await expect(capacity.couples.connectWithCode('482195')).rejects.toMatchObject({
      domainCode: 'couple_capacity_reached',
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
  it('disconnect_couple RPC를 멱등 키와 함께 부른다', async () => {
    const { client, couples } = build({
      tables: connectedTables(),
      rpc: { disconnect_couple: okEnvelope({ couple_id: 'c1', purge_job_id: 'j1' }) },
    });

    await expect(couples.disconnectCouple()).resolves.toMatchObject({ coupleId: 'c1', purgeJobId: 'j1' });
    expect(lastRpcArgs(client, 'disconnect_couple')).toEqual({ p_request_key: 'request-key-1' });
  });

  it('해제 요청이 실패하면 거부하고 아무것도 지우지 않는다', async () => {
    const { couples } = build({
      tables: connectedTables(),
      rpc: { disconnect_couple: transportFailure(new TypeError('Failed to fetch')) },
    });

    await expect(couples.disconnectCouple()).rejects.toMatchObject({ code: ERROR_CODES.network });
  });
});

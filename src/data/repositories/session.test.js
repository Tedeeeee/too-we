import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../errors';
import { createSessionRepository } from './session';
import { createFakeSupabaseClient } from './__fixtures__/fake-supabase';

const repo = (client) => createSessionRepository({ getClient: () => client });

describe('createSessionRepository', () => {
  it('첫 실행에서 만든 익명 사용자를 다음 저장소 실행이 브라우저 세션에서 복원한다', async () => {
    let persistedSession = null;
    let signInCount = 0;
    const calls = [];
    const client = {
      auth: {
        async getSession() {
          calls.push('getSession');
          return { data: { session: persistedSession }, error: null };
        },
        async signInAnonymously() {
          calls.push('signInAnonymously');
          signInCount += 1;
          persistedSession = { user: { id: `anonymous-${signInCount}` } };
          return { data: { session: persistedSession }, error: null };
        },
      },
    };

    await expect(repo(client).ensureUserId()).resolves.toBe('anonymous-1');
    await expect(repo(client).ensureUserId()).resolves.toBe('anonymous-1');

    expect(signInCount).toBe(1);
    expect(calls).toEqual(['getSession', 'signInAnonymously', 'getSession']);
  });

  it('세션이 있으면 그 사용자 id를 쓰고 새로 로그인하지 않는다', async () => {
    const client = createFakeSupabaseClient({ userId: 'existing-user' });

    await expect(repo(client).ensureUserId()).resolves.toBe('existing-user');
    expect(client.calls.auth).toEqual(['getSession']);
  });

  it('세션이 없으면 익명 로그인으로 세션을 만든다', async () => {
    const client = createFakeSupabaseClient({ session: null, signInUserId: 'fresh-anon' });

    await expect(repo(client).ensureUserId()).resolves.toBe('fresh-anon');
    expect(client.calls.auth).toEqual(['getSession', 'signInAnonymously']);
  });

  it('동시 호출이 겹쳐도 익명 로그인은 한 번만 한다', async () => {
    const client = createFakeSupabaseClient({ session: null, signInUserId: 'fresh-anon' });
    const session = repo(client);

    const results = await Promise.all([session.ensureUserId(), session.ensureUserId(), session.ensureUserId()]);

    expect(results).toEqual(['fresh-anon', 'fresh-anon', 'fresh-anon']);
    expect(client.calls.auth.filter((call) => call === 'signInAnonymously')).toHaveLength(1);
  });

  it('한 번 확보한 세션은 다시 조회하지 않는다', async () => {
    const client = createFakeSupabaseClient({ userId: 'existing-user' });
    const session = repo(client);

    await session.ensureUserId();
    await session.ensureUserId();

    expect(client.calls.auth).toEqual(['getSession']);
  });

  it('reset 후에는 다시 세션을 확인한다', async () => {
    const client = createFakeSupabaseClient({ userId: 'existing-user' });
    const session = repo(client);

    await session.ensureUserId();
    session.reset();
    await session.ensureUserId();

    expect(client.calls.auth).toEqual(['getSession', 'getSession']);
  });

  it('진행 중인 익명 로그인 뒤 reset되면 늦게 도착한 이전 사용자 id를 재사용하지 않는다', async () => {
    let releaseFirstSignIn;
    let signInCount = 0;
    const client = {
      auth: {
        async getSession() {
          return { data: { session: null }, error: null };
        },
        async signInAnonymously() {
          signInCount += 1;
          if (signInCount === 1) {
            return new Promise((resolve) => {
              releaseFirstSignIn = () => resolve({
                data: { session: { user: { id: 'stale-user' } } },
                error: null,
              });
            });
          }
          return { data: { session: { user: { id: 'current-user' } } }, error: null };
        },
      },
    };
    const session = repo(client);

    const pending = session.ensureUserId();
    await Promise.resolve();
    session.reset();
    releaseFirstSignIn();

    await expect(pending).resolves.toBe('current-user');
    expect(signInCount).toBe(2);
  });

  it('세션 조회 실패는 auth 오류로 번역한다', async () => {
    const client = createFakeSupabaseClient({
      getSessionError: { __isAuthError: true, status: 401, message: 'invalid jwt' },
    });

    await expect(repo(client).ensureUserId()).rejects.toMatchObject({ code: ERROR_CODES.auth });
  });

  it('익명 로그인 실패는 auth 오류로 번역한다', async () => {
    const client = createFakeSupabaseClient({
      session: null,
      signInResult: () => ({
        data: { session: null },
        error: { __isAuthError: true, status: 422, message: 'anonymous sign-ins are disabled' },
      }),
    });

    await expect(repo(client).ensureUserId()).rejects.toBeInstanceOf(AppError);
  });

  it('네트워크 실패는 재시도 가능한 network 오류다', async () => {
    const client = createFakeSupabaseClient({
      session: null,
      signInResult: () => ({ data: { session: null }, error: new TypeError('Failed to fetch') }),
    });

    await expect(repo(client).ensureUserId()).rejects.toMatchObject({
      code: ERROR_CODES.network,
      retryable: true,
    });
  });

  it('세션 없이 성공한 로그인 응답도 auth 실패로 본다', async () => {
    const client = createFakeSupabaseClient({
      session: null,
      signInResult: () => ({ data: { session: null }, error: null }),
    });

    await expect(repo(client).ensureUserId()).rejects.toMatchObject({ code: ERROR_CODES.auth });
  });

  it('실패는 캐시하지 않는다 — 다음 호출이 다시 시도한다', async () => {
    let fail = true;
    const client = createFakeSupabaseClient({
      session: null,
      signInResult: () =>
        fail
          ? { data: { session: null }, error: new TypeError('Failed to fetch') }
          : { data: { session: { user: { id: 'recovered' } } }, error: null },
    });
    const session = repo(client);

    await expect(session.ensureUserId()).rejects.toBeInstanceOf(AppError);
    fail = false;
    await expect(session.ensureUserId()).resolves.toBe('recovered');
  });

  it('설정 오류(클라이언트 생성 실패)를 그대로 전달한다', async () => {
    const session = createSessionRepository({
      getClient: () => {
        throw new AppError(ERROR_CODES.configuration);
      },
    });

    await expect(session.ensureUserId()).rejects.toMatchObject({
      code: ERROR_CODES.configuration,
      retryable: false,
    });
  });
});

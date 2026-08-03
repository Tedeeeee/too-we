import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './errors';
import {
  PUBLISHABLE_KEY_ENV,
  SUPABASE_URL_ENV,
  __resetSupabaseClient,
  __setSupabaseClient,
  createSupabaseClient,
  getSupabaseClient,
  readSupabaseConfig,
} from './supabase';

/** 전부 가짜 값이다. 실제 프로젝트 URL이나 키를 이 파일에 쓰지 않는다. */
const FAKE_URL = 'https://fake-project.supabase.co';
const FAKE_PUBLISHABLE = 'sb_publishable_FAKE1234567890';
const FAKE_SECRET = 'sb_secret_FAKE0987654321';

const fakeEnv = (over = {}) => ({
  [SUPABASE_URL_ENV]: FAKE_URL,
  [PUBLISHABLE_KEY_ENV]: FAKE_PUBLISHABLE,
  ...over,
});

/** role만 바꾼 가짜 JWT (서명 없음). 레거시 anon/service_role 키 형태를 흉내낸다. */
const fakeJwt = (role) =>
  [
    btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    btoa(JSON.stringify({ role, iss: 'supabase' })),
    'FAKESIGNATURE',
  ].join('.');

const expectConfigError = (fn) => {
  let thrown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect(thrown.code).toBe('configuration');
  expect(thrown.retryable).toBe(false);
  return thrown;
};

afterEach(() => {
  __resetSupabaseClient();
  vi.unstubAllEnvs();
});

/**
 * 워크스페이스에 `.env.local`이 있어서 Vite가 실제 설정을 넘겨주는 상황을 만든다.
 * 값은 가짜지만 "ambient 환경에 설정이 존재한다"는 조건은 실제와 같다.
 */
const stubAmbientEnv = () => {
  vi.stubEnv(SUPABASE_URL_ENV, FAKE_URL);
  vi.stubEnv(PUBLISHABLE_KEY_ENV, FAKE_PUBLISHABLE);
};

describe('환경변수 이름', () => {
  it('브라우저에 노출해도 되는 두 변수만 쓴다', () => {
    expect(SUPABASE_URL_ENV).toBe('VITE_SUPABASE_URL');
    expect(PUBLISHABLE_KEY_ENV).toBe('VITE_SUPABASE_PUBLISHABLE_KEY');
  });
});

describe('import 시점 안전성', () => {
  it('설정이 없어도 모듈을 불러오는 것만으로 터지지 않는다', async () => {
    vi.resetModules();
    const mod = await import('./supabase');
    expect(mod.getSupabaseClient).toBeTypeOf('function');
    expect(mod.createSupabaseClient).toBeTypeOf('function');
  });
});

describe('readSupabaseConfig', () => {
  it('두 환경변수를 읽는다', () => {
    expect(readSupabaseConfig(fakeEnv())).toEqual({
      url: FAKE_URL,
      publishableKey: FAKE_PUBLISHABLE,
    });
  });

  it('앞뒤 공백을 정리한다', () => {
    expect(readSupabaseConfig(fakeEnv({ [SUPABASE_URL_ENV]: `  ${FAKE_URL}  ` })).url).toBe(
      FAKE_URL,
    );
  });

  it('URL이 없으면 configuration 오류다', () => {
    const error = expectConfigError(() => readSupabaseConfig(fakeEnv({ [SUPABASE_URL_ENV]: '' })));
    expect(error.message).toMatch(/[가-힣]/);
  });

  it('URL 형식이 아니면 configuration 오류다', () => {
    expectConfigError(() => readSupabaseConfig(fakeEnv({ [SUPABASE_URL_ENV]: 'not-a-url' })));
  });

  it('publishable key가 없으면 configuration 오류다', () => {
    expectConfigError(() => readSupabaseConfig(fakeEnv({ [PUBLISHABLE_KEY_ENV]: '' })));
  });

  it('환경변수가 아예 없어도 던지기만 하고 크래시하지 않는다', () => {
    expectConfigError(() => readSupabaseConfig({}));
  });

  it('레거시 anon JWT는 허용한다', () => {
    const anon = fakeJwt('anon');
    expect(readSupabaseConfig(fakeEnv({ [PUBLISHABLE_KEY_ENV]: anon })).publishableKey).toBe(anon);
  });
});

/**
 * 회귀 방어: `readSupabaseConfig(env = defaultEnv())` 형태는 기본 인수 문법이
 * "생략"과 "명시적 undefined"를 구분하지 못해서, 명시적 undefined도 ambient 환경을
 * 읽어 버렸다. `.env.local`이 있는 워크스페이스에서는 실제 설정이 잡혀 던지지 않고,
 * 없는 워크스페이스에서는 우연히 통과했다. 아래 테스트는 ambient에 설정이 있는
 * 조건을 stub으로 고정해서 두 워크스페이스에서 같은 결과를 낸다.
 */
describe('ambient 환경 격리', () => {
  it('명시적 undefined는 ambient 설정을 읽지 않는다', () => {
    stubAmbientEnv();
    expectConfigError(() => readSupabaseConfig(undefined));
  });

  it('명시적 빈 객체는 ambient 설정을 읽지 않는다', () => {
    stubAmbientEnv();
    expectConfigError(() => readSupabaseConfig({}));
  });

  it('인수를 생략하면 ambient 설정을 읽는다', () => {
    stubAmbientEnv();
    expect(readSupabaseConfig()).toEqual({
      url: FAKE_URL,
      publishableKey: FAKE_PUBLISHABLE,
    });
  });

  it('createSupabaseClient에 env: undefined를 넘기면 ambient를 읽지 않는다', () => {
    stubAmbientEnv();
    const createClient = vi.fn(() => ({}));

    expectConfigError(() => createSupabaseClient({ env: undefined, createClient }));
    expect(createClient).not.toHaveBeenCalled();
  });

  it('createSupabaseClient에 env를 생략하면 ambient를 읽는다', () => {
    stubAmbientEnv();
    const createClient = vi.fn(() => ({}));
    createSupabaseClient({ createClient });

    expect(createClient.mock.calls[0][0]).toBe(FAKE_URL);
    expect(createClient.mock.calls[0][1]).toBe(FAKE_PUBLISHABLE);
  });

  it('ambient에 설정이 있어도 명시적 env가 우선한다', () => {
    stubAmbientEnv();
    expectConfigError(() =>
      readSupabaseConfig({ [SUPABASE_URL_ENV]: FAKE_URL, [PUBLISHABLE_KEY_ENV]: '' }),
    );
  });
});

describe('service role 키 차단', () => {
  it('sb_secret_ 접두사 키를 거부한다', () => {
    const error = expectConfigError(() =>
      readSupabaseConfig(fakeEnv({ [PUBLISHABLE_KEY_ENV]: FAKE_SECRET })),
    );
    expect(error.message).not.toContain(FAKE_SECRET);
  });

  it('role이 service_role인 레거시 JWT를 거부한다', () => {
    const secretJwt = fakeJwt('service_role');
    const error = expectConfigError(() =>
      readSupabaseConfig(fakeEnv({ [PUBLISHABLE_KEY_ENV]: secretJwt })),
    );
    expect(error.message).not.toContain(secretJwt);
  });

  it('service role 환경변수로 대체하지 않는다', () => {
    expectConfigError(() =>
      readSupabaseConfig({
        [SUPABASE_URL_ENV]: FAKE_URL,
        SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET,
        VITE_SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET,
      }),
    );
  });

  it('createSupabaseClient가 service role 값을 전달하지 않는다', () => {
    const createClient = vi.fn(() => ({ fake: true }));
    createSupabaseClient({
      env: fakeEnv({ SUPABASE_SERVICE_ROLE_KEY: FAKE_SECRET }),
      createClient,
    });

    expect(JSON.stringify(createClient.mock.calls)).not.toContain(FAKE_SECRET);
  });
});

describe('createSupabaseClient', () => {
  it('주입된 팩토리에 url·publishable key를 넘긴다', () => {
    const client = { fake: true };
    const createClient = vi.fn(() => client);

    expect(createSupabaseClient({ env: fakeEnv(), createClient })).toBe(client);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient.mock.calls[0][0]).toBe(FAKE_URL);
    expect(createClient.mock.calls[0][1]).toBe(FAKE_PUBLISHABLE);
  });

  it('signInAnonymously에 맞게 세션 유지·자동 갱신을 켠다', () => {
    const createClient = vi.fn(() => ({}));
    createSupabaseClient({ env: fakeEnv(), createClient });

    const { auth } = createClient.mock.calls[0][2];
    expect(auth.persistSession).toBe(true);
    expect(auth.autoRefreshToken).toBe(true);
    expect(auth.detectSessionInUrl).toBe(false);
    expect(auth.storageKey).toBeTypeOf('string');
    expect(auth.storageKey.length).toBeGreaterThan(0);
  });

  it('url·publishableKey를 직접 넘기면 환경변수보다 우선한다', () => {
    const createClient = vi.fn(() => ({}));
    createSupabaseClient({
      url: 'https://other.supabase.co',
      publishableKey: 'sb_publishable_OTHER',
      env: fakeEnv(),
      createClient,
    });

    expect(createClient.mock.calls[0][0]).toBe('https://other.supabase.co');
    expect(createClient.mock.calls[0][1]).toBe('sb_publishable_OTHER');
  });

  it('직접 넘긴 값도 service role이면 거부한다', () => {
    const createClient = vi.fn(() => ({}));
    expectConfigError(() =>
      createSupabaseClient({ url: FAKE_URL, publishableKey: FAKE_SECRET, createClient }),
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('설정이 없으면 configuration 오류를 던진다', () => {
    const createClient = vi.fn(() => ({}));
    expectConfigError(() => createSupabaseClient({ env: {}, createClient }));
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('lazy singleton', () => {
  it('여러 번 불러도 클라이언트를 한 번만 만든다', () => {
    const createClient = vi.fn(() => ({ fake: true }));
    const first = getSupabaseClient({ env: fakeEnv(), createClient });
    const second = getSupabaseClient({ env: fakeEnv(), createClient });

    expect(second).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('__resetSupabaseClient 후에는 다시 만든다', () => {
    const createClient = vi.fn(() => ({}));
    getSupabaseClient({ env: fakeEnv(), createClient });
    __resetSupabaseClient();
    getSupabaseClient({ env: fakeEnv(), createClient });

    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('__setSupabaseClient로 테스트 대역을 주입할 수 있다', () => {
    const stub = { from: () => {} };
    __setSupabaseClient(stub);

    const createClient = vi.fn(() => ({}));
    expect(getSupabaseClient({ env: fakeEnv(), createClient })).toBe(stub);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('설정 오류를 캐시하지 않는다', () => {
    const createClient = vi.fn(() => ({ fake: true }));
    expectConfigError(() => getSupabaseClient({ env: {}, createClient }));

    const client = getSupabaseClient({ env: fakeEnv(), createClient });
    expect(client).toEqual({ fake: true });
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, userMessage } from './errors';
import { KAKAO_MAP_KEY_ENV, createKakaoMapsSdkLoader } from './kakao-maps';

const FAKE_MAP_KEY = 'fake-kakao-javascript-key';

const readyMaps = () => ({
  load: vi.fn((callback) => callback()),
  services: {
    Places: vi.fn(),
    Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
  },
});

const createDocumentHarness = () => {
  let appendedScript = null;
  const script = { remove: vi.fn() };
  const document = {
    createElement: vi.fn(() => script),
    head: {
      appendChild: vi.fn((node) => {
        appendedScript = node;
      }),
    },
  };

  return { document, script, getAppendedScript: () => appendedScript };
};

describe('createKakaoMapsSdkLoader', () => {
  it('이미 services까지 준비된 kakao global은 키나 document 없이 재사용한다', async () => {
    const maps = readyMaps();
    const getEnv = vi.fn(() => ({}));
    const loadSdk = createKakaoMapsSdkLoader({
      getEnv,
      getDocument: () => undefined,
      getGlobal: () => ({ kakao: { maps } }),
    });

    await expect(loadSdk()).resolves.toBe(maps);
    expect(getEnv).not.toHaveBeenCalled();
  });

  it('호출할 때만 VITE_KAKAO_MAP_KEY를 읽고 services SDK script를 만든다', async () => {
    const globalObject = {};
    const getEnv = vi.fn(() => ({ [KAKAO_MAP_KEY_ENV]: FAKE_MAP_KEY }));
    const harness = createDocumentHarness();
    const loadSdk = createKakaoMapsSdkLoader({
      getEnv,
      getDocument: () => harness.document,
      getGlobal: () => globalObject,
    });

    expect(getEnv).not.toHaveBeenCalled();
    const loading = loadSdk();

    expect(getEnv).toHaveBeenCalledTimes(1);
    expect(harness.document.head.appendChild).toHaveBeenCalledTimes(1);
    const url = new URL(harness.getAppendedScript().src);
    expect(`${url.origin}${url.pathname}`).toBe('https://dapi.kakao.com/v2/maps/sdk.js');
    expect(url.searchParams.get('appkey')).toBe(FAKE_MAP_KEY);
    expect(url.searchParams.get('autoload')).toBe('false');
    expect(url.searchParams.get('libraries')).toBe('services');

    const maps = readyMaps();
    globalObject.kakao = { maps };
    harness.script.onload();

    await expect(loading).resolves.toBe(maps);
    expect(maps.load).toHaveBeenCalledTimes(1);
  });

  it('동시 호출은 하나의 script load를 공유한다', async () => {
    const globalObject = {};
    const harness = createDocumentHarness();
    const loadSdk = createKakaoMapsSdkLoader({
      getEnv: () => ({ [KAKAO_MAP_KEY_ENV]: FAKE_MAP_KEY }),
      getDocument: () => harness.document,
      getGlobal: () => globalObject,
    });

    const first = loadSdk();
    const second = loadSdk();

    expect(harness.document.head.appendChild).toHaveBeenCalledTimes(1);
    const maps = readyMaps();
    globalObject.kakao = { maps };
    harness.script.onload();

    await expect(Promise.all([first, second])).resolves.toEqual([maps, maps]);
  });

  it('빈 키는 script를 만들지 않고 안전한 configuration AppError로 거부한다', async () => {
    const harness = createDocumentHarness();
    const loadSdk = createKakaoMapsSdkLoader({
      getEnv: () => ({ [KAKAO_MAP_KEY_ENV]: '   ' }),
      getDocument: () => harness.document,
      getGlobal: () => ({}),
    });

    await expect(loadSdk()).rejects.toMatchObject({
      code: ERROR_CODES.configuration,
      message: userMessage(ERROR_CODES.configuration),
      retryable: false,
    });
    expect(harness.document.createElement).not.toHaveBeenCalled();
  });

  it('script 전송 실패는 키를 유출하지 않는 network AppError로 거부한다', async () => {
    const harness = createDocumentHarness();
    const loadSdk = createKakaoMapsSdkLoader({
      getEnv: () => ({ [KAKAO_MAP_KEY_ENV]: FAKE_MAP_KEY }),
      getDocument: () => harness.document,
      getGlobal: () => ({}),
    });

    const loading = loadSdk();
    harness.script.onerror({ target: harness.script });

    const error = await loading.catch((caught) => caught);
    expect(error).toMatchObject({
      code: ERROR_CODES.network,
      message: userMessage(ERROR_CODES.network),
      retryable: true,
    });
    expect(error.cause?.message).not.toContain(FAKE_MAP_KEY);
    expect(error.message).not.toContain(FAKE_MAP_KEY);
  });

  it('script가 끝나도 services API가 없으면 configuration AppError로 거부한다', async () => {
    const globalObject = {};
    const harness = createDocumentHarness();
    const loadSdk = createKakaoMapsSdkLoader({
      getEnv: () => ({ [KAKAO_MAP_KEY_ENV]: FAKE_MAP_KEY }),
      getDocument: () => harness.document,
      getGlobal: () => globalObject,
    });

    const loading = loadSdk();
    globalObject.kakao = { maps: { load: (callback) => callback() } };
    harness.script.onload();

    await expect(loading).rejects.toMatchObject({ code: ERROR_CODES.configuration });
  });
});

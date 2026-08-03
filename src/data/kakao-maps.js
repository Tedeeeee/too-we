import { AppError, ERROR_CODES } from './errors';

export const KAKAO_MAP_KEY_ENV = 'VITE_KAKAO_MAP_KEY';

const SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js';

const defaultEnv = () => {
  try {
    return import.meta.env ?? {};
  } catch {
    return {};
  }
};

const configurationError = (detail) =>
  new AppError(ERROR_CODES.configuration, { cause: new Error(detail) });

const networkError = () =>
  new AppError(ERROR_CODES.network, {
    cause: new Error('Kakao Maps SDK failed to load'),
  });

const readyMaps = (globalObject) => {
  const maps = globalObject?.kakao?.maps;
  return typeof maps?.services?.Places === 'function' ? maps : null;
};

/**
 * Official Kakao Maps browser SDK loader.
 *
 * Environment, DOM, and global access stay behind injected accessors so tests never need
 * a network request. The key is read only when loading is actually necessary, and it is
 * used only to build the SDK script URL — errors retain fixed, log-safe messages.
 */
export function createKakaoMapsSdkLoader({
  getEnv = defaultEnv,
  getDocument = () => globalThis.document,
  getGlobal = () => globalThis,
} = {}) {
  let pending = null;

  return function loadKakaoMapsSdk() {
    const loaded = readyMaps(getGlobal());
    if (loaded) return Promise.resolve(loaded);
    if (pending) return pending;

    pending = new Promise((resolve, reject) => {
      const env = getEnv?.() ?? {};
      const rawKey = env?.[KAKAO_MAP_KEY_ENV];
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) {
        reject(configurationError(`${KAKAO_MAP_KEY_ENV} is missing`));
        return;
      }

      const documentObject = getDocument?.();
      if (
        typeof documentObject?.createElement !== 'function' ||
        typeof documentObject?.head?.appendChild !== 'function'
      ) {
        reject(configurationError('Kakao Maps SDK requires a browser document'));
        return;
      }

      const script = documentObject.createElement('script');
      const url = new URL(SDK_URL);
      url.searchParams.set('appkey', key);
      url.searchParams.set('autoload', 'false');
      url.searchParams.set('libraries', 'services');

      script.async = true;
      script.src = url.toString();
      script.onload = () => {
        const maps = getGlobal()?.kakao?.maps;
        if (typeof maps?.load !== 'function') {
          reject(configurationError('Kakao Maps SDK did not expose maps.load'));
          return;
        }

        try {
          maps.load(() => {
            const servicesMaps = readyMaps(getGlobal());
            if (servicesMaps) resolve(servicesMaps);
            else reject(configurationError('Kakao Maps SDK services library is unavailable'));
          });
        } catch {
          reject(configurationError('Kakao Maps SDK initialization failed'));
        }
      };
      script.onerror = () => {
        script.remove?.();
        reject(networkError());
      };

      try {
        documentObject.head.appendChild(script);
      } catch {
        reject(configurationError('Kakao Maps SDK script could not be attached'));
      }
    });

    pending = pending.catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

export const loadKakaoMapsSdk = createKakaoMapsSdkLoader();

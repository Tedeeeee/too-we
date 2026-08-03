import { describe, expect, it } from 'vitest';
import { createRepositories } from './index';
import { createFakeSupabaseClient } from './__fixtures__/fake-supabase';

const build = () => {
  const client = createFakeSupabaseClient({ userId: 'u1', tables: {}, rpc: {} });
  return { client, settings: createRepositories({ client }).settings };
};

describe('getSettings', () => {
  it('저장되는 설정 모델이 없으므로 안정적인 기본값을 준다', async () => {
    const { settings } = build();

    await expect(settings.getSettings()).resolves.toEqual({ recordAlert: '' });
  });

  it('사용자 데이터를 만들어내지 않는다 — 픽스처 값이 새지 않는다', async () => {
    const { settings } = build();

    const value = await settings.getSettings();

    expect(value.recordAlert).toBe('');
    expect(JSON.stringify(value)).not.toContain('도보');
  });

  it('아직 저장소를 건드리지 않는다', async () => {
    const { client, settings } = build();

    await settings.getSettings();

    expect(client.calls.queries).toEqual([]);
    expect(client.calls.rpc).toEqual([]);
  });

  it('호출마다 새 객체를 주어 호출자 변경이 다음 호출에 새지 않는다', async () => {
    const { settings } = build();

    const first = await settings.getSettings();
    first.recordAlert = '변경됨';

    await expect(settings.getSettings()).resolves.toEqual({ recordAlert: '' });
  });
});

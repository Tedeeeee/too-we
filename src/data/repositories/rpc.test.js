import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../errors';
import { callRpc, unwrap } from './rpc';
import {
  createFakeSupabaseClient,
  errorEnvelope,
  okEnvelope,
  raisedError,
  transportFailure,
} from './__fixtures__/fake-supabase';

const clientWithRpc = (rpc) => createFakeSupabaseClient({ userId: 'u1', rpc });

describe('unwrap', () => {
  it('데이터를 그대로 통과시킨다', () => {
    expect(unwrap({ data: [{ id: 1 }], error: null })).toEqual([{ id: 1 }]);
  });

  it('없는 결과는 null이다', () => {
    expect(unwrap({ data: null, error: null })).toBeNull();
    expect(unwrap(undefined)).toBeNull();
  });

  it('오류는 AppError로 바꿔 던진다', () => {
    expect(() => unwrap({ data: null, error: { status: 500, message: 'boom' } })).toThrow(AppError);
  });

  it('PGRST116(0행)은 not_found다', () => {
    let thrown;
    try {
      unwrap({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown.code).toBe(ERROR_CODES.not_found);
  });
});

describe('callRpc', () => {
  it('성공 봉투에서 data와 replayed를 꺼낸다', async () => {
    const client = clientWithRpc({ create_visit: okEnvelope({ visit_id: 'v1' }) });

    await expect(callRpc(client, 'create_visit', { p_request_key: 'k' })).resolves.toEqual({
      data: { visit_id: 'v1' },
      replayed: false,
    });
    expect(client.calls.rpc).toEqual([{ name: 'create_visit', args: { p_request_key: 'k' } }]);
  });

  it('멱등 재생은 replayed:true로 알려준다', async () => {
    const client = clientWithRpc({ create_visit: okEnvelope({ visit_id: 'v1' }, true) });

    await expect(callRpc(client, 'create_visit', {})).resolves.toMatchObject({ replayed: true });
  });

  it('supabase error가 비어 있어도 ok:false 봉투를 실패로 처리한다', async () => {
    const client = clientWithRpc({ join_couple_with_code: errorEnvelope('invite_expired', { expired_at: 'x' }) });

    await expect(callRpc(client, 'join_couple_with_code', {})).rejects.toMatchObject({
      code: ERROR_CODES.validation,
      domainCode: 'invite_expired',
    });
  });

  it('raise된 TW 오류도 같은 코드로 번역한다', async () => {
    const client = clientWithRpc({
      create_couple: transportFailure(raisedError('TW014', 'config_unresolved', { key: 'invite_ttl_seconds' })),
    });

    await expect(callRpc(client, 'create_couple', {})).rejects.toMatchObject({
      code: ERROR_CODES.configuration,
      domainCode: 'config_unresolved',
    });
  });

  it('전송 실패는 재시도 가능한 network다', async () => {
    const client = clientWithRpc({ create_visit: transportFailure(new TypeError('Failed to fetch')) });

    await expect(callRpc(client, 'create_visit', {})).rejects.toMatchObject({
      code: ERROR_CODES.network,
      retryable: true,
    });
  });

  it('rpc 호출 자체가 던져도 AppError로 나온다', async () => {
    const client = {
      rpc() {
        throw new TypeError('Failed to fetch');
      },
    };

    await expect(callRpc(client, 'create_visit', {})).rejects.toBeInstanceOf(AppError);
  });

  it('봉투가 아닌 응답은 unknown으로 거부한다', async () => {
    const client = clientWithRpc({ create_visit: { data: { visit_id: 'v1' }, error: null } });

    await expect(callRpc(client, 'create_visit', {})).rejects.toMatchObject({ code: ERROR_CODES.unknown });
  });
});

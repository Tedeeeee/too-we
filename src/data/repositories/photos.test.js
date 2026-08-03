import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '../errors';
import { createRepositories } from './index';
import {
  createFakeSupabaseClient,
  errorEnvelope,
  lastRpcArgs,
  okEnvelope,
  queriesFor,
  rpcNames,
  transportFailure,
} from './__fixtures__/fake-supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const COUPLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VISIT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECORD = Object.freeze({ id: VISIT, coupleId: COUPLE });
const NOW = new Date('2026-08-03T05:06:07.000Z');

const file = (name, contents = name) => new File([contents], name, { type: 'image/jpeg' });

const prepared = (source) => ({
  blob: new Blob([source.name], { type: 'image/webp' }),
  contentType: 'image/webp',
  byteSize: source.name.length,
  width: 1200,
  height: 900,
  extension: 'webp',
  compressed: true,
});

const build = ({ storage, rpc, tables = {}, processPhotoFile, newPhotoId, newRequestKey } = {}) => {
  const client = createFakeSupabaseClient({ userId: ME, storage, rpc, tables });
  const repositories = createRepositories({
    client,
    processPhotoFile: processPhotoFile ?? vi.fn(async (source) => prepared(source)),
    newPhotoId: newPhotoId ?? (() => 'fresh-photo'),
    newRequestKey: newRequestKey ?? (() => 'stable-request-key'),
    now: () => NOW,
  });
  return { client, photos: repositories.photos };
};

describe('visit photo upload pipeline', () => {
  it('fresh canonical path에 upsert 없이 올린 뒤 안정적인 키와 메타데이터로 등록한다', async () => {
    const source = file('memory.jpg');
    const input = Object.freeze([source]);
    const { client, photos } = build({
      storage: {
        'visit-photos': { upload: { path: `${COUPLE}/${VISIT}/fresh-photo.webp` } },
      },
      rpc: {
        register_visit_photo: okEnvelope({ photo_id: 'photo-1', ordinal: 1 }),
      },
    });

    const [result] = await photos.uploadVisitPhotos(RECORD, input);

    expect(input).toEqual([source]);
    expect(client.calls.storage).toHaveLength(1);
    expect(client.calls.storage[0]).toMatchObject({
      bucket: 'visit-photos',
      method: 'upload',
      path: `${COUPLE}/${VISIT}/fresh-photo.webp`,
      options: { contentType: 'image/webp', upsert: false },
    });
    expect(lastRpcArgs(client, 'register_visit_photo')).toEqual({
      p_visit_id: VISIT,
      p_storage_path: `${COUPLE}/${VISIT}/fresh-photo.webp`,
      p_metadata: {
        content_type: 'image/webp',
        byte_size: source.name.length,
        width: 1200,
        height: 900,
      },
      p_request_key: 'stable-request-key',
    });
    expect(result).toMatchObject({
      status: 'succeeded',
      file: source,
      objectUploaded: true,
      requestKey: 'stable-request-key',
      path: `${COUPLE}/${VISIT}/fresh-photo.webp`,
      photo: {
        id: 'photo-1',
        order: 1,
        ordinal: 1,
        uploaderId: ME,
        ownedByMe: true,
      },
    });
  });

  it('업로드 성공 뒤 등록 결과를 모르면 같은 path와 request key로 등록만 재시도한다', async () => {
    let registration = 0;
    const { client, photos } = build({
      storage: { 'visit-photos': { upload: { path: 'uploaded' } } },
      rpc: {
        register_visit_photo: () => {
          registration += 1;
          return registration === 1
            ? transportFailure(new TypeError('Failed to fetch https://private.invalid?apikey=hidden'))
            : okEnvelope({ photo_id: 'photo-1', ordinal: 1 }, true);
        },
      },
    });

    const [failed] = await photos.uploadVisitPhotos(RECORD, [file('memory.jpg')]);
    const firstArgs = lastRpcArgs(client, 'register_visit_photo');
    const [replayed] = await photos.uploadVisitPhotos(RECORD, [failed]);

    expect(failed).toMatchObject({
      status: 'failed',
      objectUploaded: true,
      error: { code: ERROR_CODES.network, retryable: true },
    });
    expect(failed.error.message).not.toContain('private.invalid');
    expect(client.calls.storage).toHaveLength(1);
    expect(client.calls.rpc).toHaveLength(2);
    expect(lastRpcArgs(client, 'register_visit_photo')).toEqual(firstArgs);
    expect(replayed).toMatchObject({ status: 'succeeded', objectUploaded: true });
  });

  it('새 filename의 첫 업로드 conflict는 성공으로 추측하거나 metadata를 등록하지 않는다', async () => {
    const { client, photos } = build({
      storage: {
        'visit-photos': {
          upload: transportFailure({ statusCode: 409, message: 'object already exists' }),
        },
      },
      rpc: {
        register_visit_photo: okEnvelope({ photo_id: 'must-not-register', ordinal: 1 }),
      },
    });

    const [result] = await photos.uploadVisitPhotos(RECORD, [file('memory.jpg')]);

    expect(result).toMatchObject({
      status: 'failed',
      objectUploaded: false,
      uploadAttempted: true,
      error: { code: ERROR_CODES.conflict },
    });
    expect(client.calls.rpc).toEqual([]);
  });

  it('여러 파일 중 하나가 실패해도 성공 결과를 버리지 않는다', async () => {
    let photoNumber = 0;
    const newPhotoId = () => `photo-path-${++photoNumber}`;
    const { client, photos } = build({
      newPhotoId,
      storage: {
        'visit-photos': {
          upload: ({ path }) =>
            path.includes('photo-path-2')
              ? transportFailure({ statusCode: 503, message: 'raw storage unavailable' })
              : { path },
        },
      },
      rpc: {
        register_visit_photo: ({ p_storage_path }) =>
          okEnvelope({ photo_id: p_storage_path.includes('photo-path-1') ? 'p1' : 'p3', ordinal: p_storage_path.includes('photo-path-1') ? 1 : 2 }),
      },
    });

    const results = await photos.uploadVisitPhotos(RECORD, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);

    expect(results.map((result) => result.status)).toEqual(['succeeded', 'failed', 'succeeded']);
    expect(results[1]).toMatchObject({ error: { code: ERROR_CODES.network } });
    expect(results[1].error.message).not.toContain('raw storage');
    expect(rpcNames(client)).toEqual(['register_visit_photo', 'register_visit_photo']);
  });

  it('클라이언트 개수 추측으로 막지 않고 서버의 최대 5장 결과를 파일별 상태로 보존한다', async () => {
    let photoNumber = 0;
    const { client, photos } = build({
      newPhotoId: () => `photo-${++photoNumber}`,
      newRequestKey: () => `request-${photoNumber}`,
      storage: { 'visit-photos': { upload: ({ path }) => ({ path }) } },
      rpc: {
        register_visit_photo: ({ p_storage_path }) => {
          const ordinal = Number(p_storage_path.match(/photo-(\d+)/)?.[1]);
          return ordinal <= 5
            ? okEnvelope({ photo_id: `p${ordinal}`, ordinal })
            : errorEnvelope('photo_limit_reached', { max_photos: 5 });
        },
      },
    });

    const results = await photos.uploadVisitPhotos(
      RECORD,
      Array.from({ length: 6 }, (_, index) => file(`${index + 1}.jpg`)),
    );

    expect(client.calls.storage).toHaveLength(6);
    expect(client.calls.rpc).toHaveLength(6);
    expect(results.slice(0, 5).every((result) => result.status === 'succeeded')).toBe(true);
    expect(results[5]).toMatchObject({
      status: 'failed',
      error: { code: ERROR_CODES.conflict, domainCode: 'photo_limit_reached' },
    });
  });
});

describe('private photo reads', () => {
  it('사진 순서를 보존하고 제한 시간 signed URL만 붙인다', async () => {
    const records = Object.freeze([Object.freeze({
      id: VISIT,
      photos: Object.freeze([
        Object.freeze({ id: 'p1', bucket: 'visit-photos', path: `${COUPLE}/${VISIT}/a.webp`, order: 1 }),
        Object.freeze({ id: 'p2', bucket: 'visit-photos', path: `${COUPLE}/${VISIT}/b.webp`, order: 2 }),
      ]),
    })]);
    const { client, photos } = build({
      storage: {
        'visit-photos': {
          createSignedUrl: ({ path }) => ({ signedUrl: `https://signed.invalid/${path}` }),
        },
      },
    });

    const [record] = await photos.attachSignedUrls(records);

    expect(records[0].photos[0]).not.toHaveProperty('url');
    expect(record.photos.map((photo) => photo.id)).toEqual(['p1', 'p2']);
    expect(record.photos[0]).toMatchObject({
      url: `https://signed.invalid/${COUPLE}/${VISIT}/a.webp`,
      urlExpiresAt: '2026-08-03T05:16:07.000Z',
    });
    expect(client.calls.storage.map((call) => call.method)).toEqual([
      'createSignedUrl',
      'createSignedUrl',
    ]);
    expect(client.calls.storage.every((call) => call.expiresIn === 600)).toBe(true);
  });

  it('signed URL 실패를 원본 backend 문구가 없는 AppError로 바꾼다', async () => {
    const rawMessage = 'sign failed https://backend.invalid?token=secret';
    const { photos } = build({
      storage: {
        'visit-photos': {
          createSignedUrl: transportFailure({ status: 500, message: rawMessage }),
        },
      },
    });

    const error = await photos.attachSignedUrls([{
      id: VISIT,
      photos: [{ id: 'p1', bucket: 'visit-photos', path: `${COUPLE}/${VISIT}/a.webp` }],
    }]).catch((caught) => caught);

    expect(error).toMatchObject({ code: ERROR_CODES.network, retryable: true });
    expect(error.message).not.toContain('backend.invalid');
    expect(error.message).not.toContain('secret');
  });
});

describe('visit photo deletion', () => {
  const OWN_PHOTO = Object.freeze({
    id: 'photo-1',
    bucket: 'visit-photos',
    path: `${COUPLE}/${VISIT}/mine.webp`,
    uploaderId: ME,
    ownedByMe: true,
  });

  it('상대 사진 삭제는 storage나 metadata를 건드리기 전에 거부한다', async () => {
    const { client, photos } = build({ tables: {}, storage: {}, rpc: {} });

    const result = await photos.deleteVisitPhoto({ ...OWN_PHOTO, ownedByMe: false });

    expect(result).toMatchObject({
      status: 'failed',
      objectDeleted: false,
      error: { code: ERROR_CODES.forbidden, retryable: false },
    });
    expect(client.calls.storage).toEqual([]);
    expect(client.calls.queries).toEqual([]);
  });

  it('object를 먼저 지우고 metadata 실패 상태를 보존해 재시도 때 metadata만 지운다', async () => {
    let objectDeleted = false;
    let metadataAttempts = 0;
    const { client, photos } = build({
      storage: {
        'visit-photos': {
          remove: () => {
            objectDeleted = true;
            return [];
          },
        },
      },
      tables: {
        visit_photos: (query) => {
          expect(objectDeleted).toBe(true);
          expect(query.op).toBe('delete');
          metadataAttempts += 1;
          return metadataAttempts === 1
            ? transportFailure(new TypeError('Failed to fetch https://db.invalid?apikey=hidden'))
            : [];
        },
      },
    });

    const failed = await photos.deleteVisitPhoto(OWN_PHOTO);
    const retried = await photos.deleteVisitPhoto(OWN_PHOTO, failed);

    expect(failed).toMatchObject({
      status: 'failed',
      objectDeleted: true,
      error: { code: ERROR_CODES.network, retryable: true },
    });
    expect(failed.error.message).not.toContain('db.invalid');
    expect(retried).toMatchObject({ status: 'succeeded', objectDeleted: true, error: null });
    expect(client.calls.storage).toHaveLength(1);
    expect(queriesFor(client, 'visit_photos')).toHaveLength(2);
  });
});

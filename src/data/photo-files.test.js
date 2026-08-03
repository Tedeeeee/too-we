import { describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from './errors';
import { createPhotoFileProcessor } from './photo-files';

const imageFile = (name = 'portrait.jpg') =>
  new File(['original-image'], name, { type: 'image/jpeg' });

describe('createPhotoFileProcessor', () => {
  it('브라우저 이미지 API가 없으면 원본을 바꾸지 않고 안전하게 사용한다', async () => {
    const file = imageFile();
    const processPhotoFile = createPhotoFileProcessor({
      createImageBitmap: null,
      createCanvas: null,
    });

    await expect(processPhotoFile(file)).resolves.toEqual({
      blob: file,
      contentType: 'image/jpeg',
      byteSize: file.size,
      width: null,
      height: null,
      extension: 'jpg',
      compressed: false,
    });
  });

  it('EXIF 방향을 반영한 bitmap 비율을 지키며 모바일 크기로 축소한다', async () => {
    const file = imageFile();
    const close = vi.fn();
    const createImageBitmap = vi.fn().mockResolvedValue({ width: 3024, height: 4032, close });
    const drawImage = vi.fn();
    const output = new Blob(['compressed'], { type: 'image/webp' });
    const convertToBlob = vi.fn().mockResolvedValue(output);
    const createCanvas = vi.fn((width, height) => ({
      width,
      height,
      getContext: () => ({ drawImage }),
      convertToBlob,
    }));
    const processPhotoFile = createPhotoFileProcessor({ createImageBitmap, createCanvas });

    const prepared = await processPhotoFile(file);

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(createCanvas).toHaveBeenCalledWith(1536, 2048);
    expect(drawImage).toHaveBeenCalledWith(expect.any(Object), 0, 0, 1536, 2048);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.82 });
    expect(close).toHaveBeenCalledTimes(1);
    expect(prepared).toEqual({
      blob: output,
      contentType: 'image/webp',
      byteSize: output.size,
      width: 1536,
      height: 2048,
      extension: 'webp',
      compressed: true,
    });
  });

  it('사용 가능한 압축 API가 실패하면 원시 오류 대신 AppError로 거부한다', async () => {
    const rawMessage = 'decoder failed at https://backend.invalid?apikey=do-not-show';
    const processPhotoFile = createPhotoFileProcessor({
      createImageBitmap: vi.fn().mockRejectedValue(new Error(rawMessage)),
      createCanvas: vi.fn(),
    });

    const error = await processPhotoFile(imageFile()).catch((caught) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: ERROR_CODES.unknown, retryable: false });
    expect(error.message).not.toContain('backend.invalid');
    expect(error.message).not.toContain('apikey');
  });
});

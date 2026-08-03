import { AppError, ERROR_CODES } from './errors';

export const PHOTO_PROCESSING_DEFAULTS = Object.freeze({
  maxDimension: 2048,
  outputType: 'image/webp',
  quality: 0.82,
});

const extensionFor = (contentType, name = '') => {
  const byType = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }[contentType];
  if (byType) return byType;
  const suffix = typeof name === 'string' ? name.split('.').at(-1)?.toLowerCase() : '';
  return suffix && /^[a-z0-9]+$/.test(suffix) ? suffix : 'bin';
};

const originalResult = (file) => ({
  blob: file,
  contentType: file.type || 'application/octet-stream',
  byteSize: file.size,
  width: null,
  height: null,
  extension: extensionFor(file.type, file.name),
  compressed: false,
});

const browserCanvas = (width, height) => {
  if (typeof globalThis.OffscreenCanvas === 'function') {
    return new globalThis.OffscreenCanvas(width, height);
  }
  if (typeof globalThis.document?.createElement !== 'function') return null;
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const encodeCanvas = (canvas, options) => {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob(options);
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas encoding returned no data'))),
        options.type,
        options.quality,
      );
    });
  }
  throw new Error('canvas encoding is unavailable');
};

export function createPhotoFileProcessor({
  createImageBitmap = typeof globalThis.createImageBitmap === 'function'
    ? globalThis.createImageBitmap.bind(globalThis)
    : null,
  createCanvas = browserCanvas,
  maxDimension = PHOTO_PROCESSING_DEFAULTS.maxDimension,
  outputType = PHOTO_PROCESSING_DEFAULTS.outputType,
  quality = PHOTO_PROCESSING_DEFAULTS.quality,
} = {}) {
  return async function processPhotoFile(file) {
    if (!file || typeof file !== 'object' || typeof file.size !== 'number') {
      throw new AppError(ERROR_CODES.validation, { cause: { field: 'file' } });
    }
    if (!file.type?.startsWith('image/')) return originalResult(file);
    if (typeof createImageBitmap !== 'function' || typeof createCanvas !== 'function') {
      return originalResult(file);
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = createCanvas(width, height);
      const context = canvas?.getContext?.('2d');
      if (!context) throw new Error('2d canvas context is unavailable');
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await encodeCanvas(canvas, { type: outputType, quality });

      return {
        blob,
        contentType: blob.type || outputType,
        byteSize: blob.size,
        width,
        height,
        extension: extensionFor(blob.type || outputType),
        compressed: true,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(ERROR_CODES.unknown, { cause: error });
    } finally {
      bitmap?.close?.();
    }
  };
}

export const processPhotoFile = createPhotoFileProcessor();

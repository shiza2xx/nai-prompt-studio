/** Runtime-only thumbnail preparation for official artist cards. */

export const OFFICIAL_ARTIST_THUMBNAIL_WIDTH = 320;
export const OFFICIAL_ARTIST_THUMBNAIL_HEIGHT = 468;
export const OFFICIAL_ARTIST_THUMBNAIL_QUALITY = 0.9;
export const CONTENT_GRID_THUMBNAIL_WIDTH = 384;
export const CONTENT_GRID_THUMBNAIL_HEIGHT = 512;

export interface ThumbnailTransformRuntime {
  createImageBitmap?: (image: unknown, options?: { resizeWidth?: number; resizeHeight?: number; resizeQuality?: string }) => Promise<{ width: number; height: number; close?: () => void; } & Record<string, unknown>>;
  OffscreenCanvas?: new (width: number, height: number) => { getContext(type: '2d'): { drawImage(...args: unknown[]): void } | null; convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> };
  document?: { createElement(name: 'canvas'): { width: number; height: number; getContext(type: '2d'): { drawImage(...args: unknown[]): void } | null; toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void } };
  URL?: { createObjectURL(value: Blob): string; revokeObjectURL(value: string): void };
  Image?: new () => { src: string; onload: (() => void) | null; onerror: (() => void) | null; decode?: () => Promise<void> };
}
function runtime(): ThumbnailTransformRuntime {
  return globalThis as unknown as ThumbnailTransformRuntime;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Thumbnail preparation aborted.');
}

/**
 * Resize and WebP-encode an official card. This function never writes to
 * disk; PreviewCache owns the resulting object URL and revokes it on clear.
 */
export async function createOfficialArtistThumbnail(blob: Blob, signal?: AbortSignal, env: ThumbnailTransformRuntime = runtime()): Promise<Blob> {
  throwIfAborted(signal);
  const width = OFFICIAL_ARTIST_THUMBNAIL_WIDTH;
  const height = OFFICIAL_ARTIST_THUMBNAIL_HEIGHT;
  const bitmapFactory = env.createImageBitmap;
  const Canvas = env.OffscreenCanvas;
  if (bitmapFactory && Canvas) {
    let bitmap: ({ width: number; height: number; close?: () => void } & Record<string, unknown>) | undefined;
    try {
      bitmap = await bitmapFactory(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
      throwIfAborted(signal);
      const canvas = new Canvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Thumbnail canvas is unavailable.');
      context.drawImage(bitmap, 0, 0, width, height);
      const result = await canvas.convertToBlob({ type: 'image/webp', quality: OFFICIAL_ARTIST_THUMBNAIL_QUALITY });
      throwIfAborted(signal);
      return result;
    } finally {
      bitmap?.close?.();
    }
  }

  const documentRef = env.document;
  const ImageCtor = env.Image;
  const URLRef = env.URL;
  if (!documentRef || !ImageCtor || !URLRef) throw new Error('Thumbnail image APIs are unavailable.');
  const canvas = documentRef.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Thumbnail canvas is unavailable.');
  const sourceUrl = URLRef.createObjectURL(blob);
  try {
    const image = new ImageCtor();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Official artist thumbnail failed to decode.'));
      image.src = sourceUrl;
    });
    throwIfAborted(signal);
    context.drawImage(image, 0, 0, width, height);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Thumbnail WebP encoding failed.')), 'image/webp', OFFICIAL_ARTIST_THUMBNAIL_QUALITY));
    throwIfAborted(signal);
    return result;
  } finally {
    // This URL is only a transient source for the fallback canvas.
    URLRef.revokeObjectURL(sourceUrl);
  }
}

/** Renderer-only derived thumbnail for user content. Source bytes are never written or replaced. */
export async function createContentGridThumbnail(blob: Blob, signal?: AbortSignal, env: ThumbnailTransformRuntime = runtime()): Promise<Blob> {
  throwIfAborted(signal);
  const bitmapFactory = env.createImageBitmap;
  const Canvas = env.OffscreenCanvas;
  if (!bitmapFactory || !Canvas) return blob;
  let bitmap: ({ width: number; height: number; close?: () => void } & Record<string, unknown>) | undefined;
  try {
    bitmap = await bitmapFactory(blob);
    throwIfAborted(signal);
    const scale = Math.min(1, CONTENT_GRID_THUMBNAIL_WIDTH / Math.max(1, bitmap.width), CONTENT_GRID_THUMBNAIL_HEIGHT / Math.max(1, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new Canvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Thumbnail canvas is unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);
    const type = blob.type === 'image/png' ? 'image/png' : 'image/webp';
    const result = await canvas.convertToBlob({ type, quality: OFFICIAL_ARTIST_THUMBNAIL_QUALITY });
    throwIfAborted(signal);
    return result;
  } finally { bitmap?.close?.(); }
}

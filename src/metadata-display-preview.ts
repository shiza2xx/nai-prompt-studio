/**
 * Creates the lightweight image used only by the Image Metadata workspace.
 *
 * The original image bytes stay in MetadataWorkspace for metadata saves and
 * selected-tag previews.  This prevents a full-resolution booru image from
 * being decoded again every time the workspace DOM is recreated.
 */

export const METADATA_DISPLAY_PREVIEW_MAX_WIDTH = 2048;
export const METADATA_DISPLAY_PREVIEW_MAX_HEIGHT = 1120;
export const METADATA_DISPLAY_PREVIEW_QUALITY = 0.9;

export interface MetadataDisplayPreviewRuntime {
  createImageBitmap?: (image: Blob) => Promise<{ width: number; height: number; close?: () => void } & Record<string, unknown>>;
  OffscreenCanvas?: new (width: number, height: number) => {
    getContext(type: '2d'): { drawImage(...args: unknown[]): void } | null;
    convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
  };
}

function runtime(): MetadataDisplayPreviewRuntime {
  return globalThis as unknown as MetadataDisplayPreviewRuntime;
}

/**
 * Downscale without cropping or upscaling.  Returning the source blob is a
 * safe fallback on platforms without Chromium's bitmap/canvas APIs.
 */
export async function createMetadataDisplayPreview(source: Blob, env: MetadataDisplayPreviewRuntime = runtime()): Promise<Blob> {
  const bitmapFactory = env.createImageBitmap;
  const Canvas = env.OffscreenCanvas;
  if (!bitmapFactory || !Canvas) return source;

  let bitmap: ({ width: number; height: number; close?: () => void } & Record<string, unknown>) | undefined;
  try {
    bitmap = await bitmapFactory(source);
    if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) return source;
    const scale = Math.min(1, METADATA_DISPLAY_PREVIEW_MAX_WIDTH / bitmap.width, METADATA_DISPLAY_PREVIEW_MAX_HEIGHT / bitmap.height);
    if (scale >= 1) return source;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new Canvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return source;
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: 'image/webp', quality: METADATA_DISPLAY_PREVIEW_QUALITY });
  } catch {
    return source;
  } finally {
    bitmap?.close?.();
  }
}

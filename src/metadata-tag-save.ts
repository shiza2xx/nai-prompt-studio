export type MetadataTagCategory = 'frame' | 'scene' | 'render' | 'character';

export interface MetadataTagSavePreview {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  originalName: string;
}

export interface MetadataTagSavePayload {
  tag: string;
  category: MetadataTagCategory;
  presetId: string;
  preview: MetadataTagSavePreview;
}

export type MetadataTagSaveHandler = (payload: MetadataTagSavePayload) => Promise<boolean> | boolean;

/** Dispatch the selected-tag action without constructing or dispatching a library payload. */
export async function dispatchMetadataTagSave(handler: MetadataTagSaveHandler | undefined, selectionText: string, category: MetadataTagCategory, presetId: string, preview: MetadataTagSavePreview): Promise<boolean> {
  if (!handler || !selectionText.trim()) return false;
  return Boolean(await handler({ tag: selectionText.trim(), category, presetId: presetId || 'default', preview }));
}

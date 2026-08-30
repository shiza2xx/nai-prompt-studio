/**
 * Pure drag-and-drop policy for the Custom Tags workspace.
 *
 * Chromium on Windows can expose `DataTransfer.types = ['Files']` while
 * withholding both the FileList and file names until the drop event. Keep the
 * policy independent of DOM/File so it can be exercised with those fixtures.
 */
export type CustomTagDropPhase = 'drag' | 'drop';
export type CustomTagDropDecision = 'ignore' | 'candidate' | 'pack' | 'invalid';

export interface CustomTagDropFileDescriptor {
  name?: string;
  type?: string;
}

export interface CustomTagDropInput {
  phase: CustomTagDropPhase;
  targetInsideImageDrop: boolean;
  types?: readonly string[];
  /** Present only when the browser exposes actual files. */
  files?: readonly CustomTagDropFileDescriptor[];
  /** Item cardinality may be known even when item names/files are hidden. */
  itemCount?: number;
}

function hasFilesType(types: readonly string[] | undefined): boolean {
  return Boolean(types?.some(type => String(type).toLocaleLowerCase() === 'files'));
}

function isPackName(name: string | undefined): boolean {
  return Boolean(name?.trim().toLocaleLowerCase().endsWith('.naipack'));
}

function isImageDescriptor(file: CustomTagDropFileDescriptor | undefined): boolean {
  if (!file) return false;
  const type = String(file.type ?? '').toLocaleLowerCase();
  const name = String(file.name ?? '').toLocaleLowerCase();
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp' || /\.(?:png|jpe?g|webp)$/.test(name);
}

/** Classify a potential or actual external-file drop for workspace capture. */
export function classifyCustomTagDrop(input: CustomTagDropInput): CustomTagDropDecision {
  if (!hasFilesType(input.types)) return 'ignore';
  const files = input.files;
  const count = files ? files.length : Number.isSafeInteger(input.itemCount) ? input.itemCount! : undefined;
  const single = count === 1;
  const descriptor = single ? files?.[0] : undefined;
  const namedPack = single && isPackName(descriptor?.name);

  // The image control remains authoritative for image files and for an
  // undisclosed external file while the pointer is over that control. A
  // visibly identified .naipack is unambiguous and can still be imported.
  if (input.targetInsideImageDrop && !namedPack) return 'ignore';
  if (input.phase === 'drop') return namedPack ? 'pack' : 'invalid';
  if (single && descriptor?.name) return namedPack ? 'candidate' : 'invalid';
  if (count != null && count !== 1) return 'invalid';
  // A hidden FileList/name is still an eligible external-file drag. The drop
  // phase performs the strict extension/cardinality check.
  return 'candidate';
}

export function customTagDropIsImage(file: CustomTagDropFileDescriptor | undefined): boolean {
  return isImageDescriptor(file);
}

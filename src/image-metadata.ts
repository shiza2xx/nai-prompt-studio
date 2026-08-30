/** Offline NovelAI image metadata reader. Stealth framing follows the official MIT project. */

export interface PngTextChunk {
  type: 'tEXt' | 'zTXt' | 'iTXt';
  keyword: string;
  text?: string;
  compressed?: Uint8Array;
}

export interface MetadataCharacter {
  positive: string;
  negative: string;
}

export interface ImageMetadata {
  model: string;
  steps: string;
  sampler: string;
  width: string;
  height: string;
  scale: string;
  base: MetadataCharacter;
  characters: MetadataCharacter[];
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const RIFF = new TextEncoder().encode('RIFF');
const WEBP = new TextEncoder().encode('WEBP');
const STEALTH_MAGIC = new TextEncoder().encode('stealth_pngcomp');
const textDecoder = new TextDecoder();

export class ImageMetadataError extends Error {
  constructor(message: string) { super(message); this.name = 'ImageMetadataError'; }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.length >= prefix.length && equalBytes(bytes.slice(0, prefix.length), prefix);
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && equalBytes(bytes.slice(0, 4), RIFF) && equalBytes(bytes.slice(8, 12), WEBP);
}

function readZeroTerminated(data: Uint8Array, offset: number): { value: string; next: number } {
  const end = data.indexOf(0, offset);
  if (end < 0) throw new ImageMetadataError('The PNG text metadata is malformed.');
  return { value: textDecoder.decode(data.slice(offset, end)), next: end + 1 };
}

export function parsePngTextChunks(bytes: Uint8Array): PngTextChunk[] {
  if (bytes.length < PNG_SIGNATURE.length || !equalBytes(bytes.slice(0, 8), PNG_SIGNATURE)) {
    throw new ImageMetadataError('Choose a PNG image exported by NovelAI.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngTextChunk[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new ImageMetadataError('This PNG is truncated or corrupt.');
    const length = view.getUint32(offset, false);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new ImageMetadataError('This PNG is truncated or corrupt.');
    const type = textDecoder.decode(bytes.slice(offset + 4, dataStart));
    const data = bytes.slice(dataStart, dataEnd);
    if (type === 'tEXt') {
      const item = readZeroTerminated(data, 0);
      chunks.push({ type, keyword: item.value, text: textDecoder.decode(data.slice(item.next)) });
    } else if (type === 'zTXt') {
      const item = readZeroTerminated(data, 0);
      if (item.next >= data.length || data[item.next] !== 0) throw new ImageMetadataError('The PNG text metadata is malformed.');
      chunks.push({ type, keyword: item.value, compressed: data.slice(item.next + 1) });
    } else if (type === 'iTXt') {
      const keyword = readZeroTerminated(data, 0);
      if (keyword.next + 2 > data.length) throw new ImageMetadataError('The PNG text metadata is malformed.');
      const compressed = data[keyword.next] === 1;
      const language = readZeroTerminated(data, keyword.next + 2);
      const translated = readZeroTerminated(data, language.next);
      const payload = data.slice(translated.next);
      chunks.push({ type, keyword: keyword.value, ...(compressed ? { compressed: payload } : { text: textDecoder.decode(payload) }) });
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

type ByteOrder = 'little' | 'big';
interface TiffEntry { tag: number; type: number; count: number; valueOffset: number; }

function webpError(message = 'This WebP is truncated or corrupt.'): ImageMetadataError {
  return new ImageMetadataError(message);
}

function readTiffUint16(view: DataView, offset: number, order: ByteOrder): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw webpError('The WebP EXIF metadata is truncated or corrupt.');
  return view.getUint16(offset, order === 'little');
}

function readTiffUint32(view: DataView, offset: number, order: ByteOrder): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw webpError('The WebP EXIF metadata is truncated or corrupt.');
  return view.getUint32(offset, order === 'little');
}

function parseIfd(view: DataView, offset: number, order: ByteOrder): TiffEntry[] {
  const count = readTiffUint16(view, offset, order);
  const entriesStart = offset + 2;
  const entriesEnd = entriesStart + count * 12;
  if (!Number.isSafeInteger(entriesEnd) || entriesEnd + 4 > view.byteLength) throw webpError('The WebP EXIF metadata is truncated or corrupt.');
  const entries: TiffEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = entriesStart + index * 12;
    entries.push({ tag: readTiffUint16(view, entry, order), type: readTiffUint16(view, entry + 2, order), count: readTiffUint32(view, entry + 4, order), valueOffset: entry + 8 });
  }
  return entries;
}

function tiffEntryData(bytes: Uint8Array, view: DataView, entry: TiffEntry, order: ByteOrder, requiredType: number): Uint8Array {
  if (entry.type !== requiredType || !entry.count) throw webpError('The WebP EXIF metadata is malformed.');
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1 };
  const unit = sizes[entry.type];
  if (!unit || entry.count > Math.floor(Number.MAX_SAFE_INTEGER / unit)) throw webpError('The WebP EXIF metadata is malformed.');
  const length = entry.count * unit;
  const start = length <= 4 ? entry.valueOffset : readTiffUint32(view, entry.valueOffset, order);
  if (start + length > bytes.length || start < 0) throw webpError('The WebP EXIF metadata is truncated or corrupt.');
  return bytes.slice(start, start + length);
}

function trimTerminalNul(value: string): string { return value.replace(/\0+$/, ''); }

function decodeUtf16(bytes: Uint8Array, fallbackOrder: ByteOrder): string {
  if (bytes.length % 2) throw webpError('The WebP EXIF UserComment is malformed.');
  const hasLittleBom = bytes[0] === 0xff && bytes[1] === 0xfe;
  const hasBigBom = bytes[0] === 0xfe && bytes[1] === 0xff;
  const order = hasLittleBom ? 'utf-16le' : hasBigBom ? 'utf-16be' : fallbackOrder === 'little' ? 'utf-16le' : 'utf-16be';
  return trimTerminalNul(new TextDecoder(order).decode(bytes.slice(hasLittleBom || hasBigBom ? 2 : 0)));
}

function decodeExifUserComment(data: Uint8Array, order: ByteOrder): string {
  if (data.length < 8) throw webpError('The WebP EXIF UserComment is malformed.');
  const marker = new TextDecoder('ascii').decode(data.slice(0, 8));
  const body = data.slice(8);
  if (marker === 'ASCII\0\0\0') return trimTerminalNul(textDecoder.decode(body));
  if (marker === 'UNICODE\0') return decodeUtf16(body, order);
  if (marker === 'JIS\0\0\0\0') return trimTerminalNul(new TextDecoder('shift_jis').decode(body));
  if (marker === '\0\0\0\0\0\0\0\0') return trimTerminalNul(textDecoder.decode(body));
  throw webpError('The WebP EXIF UserComment encoding is unsupported.');
}

function parseExifUserComment(exif: Uint8Array): string | null {
  if (exif.length < 8) throw webpError('The WebP EXIF metadata is truncated or corrupt.');
  const byteOrder = exif[0] === 0x49 && exif[1] === 0x49 ? 'little' : exif[0] === 0x4d && exif[1] === 0x4d ? 'big' : null;
  if (!byteOrder) throw webpError('The WebP EXIF byte order is invalid.');
  const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
  if (readTiffUint16(view, 2, byteOrder) !== 42) throw webpError('The WebP EXIF metadata is malformed.');
  const ifd0 = parseIfd(view, readTiffUint32(view, 4, byteOrder), byteOrder);
  const pointer = ifd0.find(entry => entry.tag === 0x8769);
  if (!pointer) return null;
  if (pointer.type !== 4 || pointer.count !== 1) throw webpError('The WebP EXIF metadata is malformed.');
  const exifIfdOffset = readTiffUint32(view, pointer.valueOffset, byteOrder);
  const comment = parseIfd(view, exifIfdOffset, byteOrder).find(entry => entry.tag === 0x9286);
  return comment ? decodeExifUserComment(tiffEntryData(exif, view, comment, byteOrder, 7), byteOrder) : null;
}

/** Reads EXIF UserComment JSON from a structurally valid RIFF/WEBP container. */
export function parseWebpExifUserComment(bytes: Uint8Array): string | null {
  if (!isWebp(bytes)) throw new ImageMetadataError('Choose a PNG or WebP image exported by NovelAI.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boundary = 8 + view.getUint32(4, true);
  if (boundary < 12 || boundary > bytes.length) throw webpError();
  let offset = 12;
  let comment: string | null = null;
  while (offset < boundary) {
    if (offset + 8 > boundary) throw webpError();
    const length = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length % 2);
    if (!Number.isSafeInteger(paddedEnd) || paddedEnd > boundary) throw webpError();
    if (textDecoder.decode(bytes.slice(offset, offset + 4)) === 'EXIF') {
      const value = parseExifUserComment(bytes.slice(dataStart, dataEnd));
      if (value !== null) comment = value;
    }
    offset = paddedEnd;
  }
  return comment;
}

export function decodeStealthPayload(alpha: Uint8Array): Uint8Array | null {
  const headerBits = (STEALTH_MAGIC.length + 4) * 8;
  if (alpha.length < headerBits) return null;
  const readByte = (start: number): number => {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | (alpha[start + bit] & 1);
    return value;
  };
  const prefix = new Uint8Array(STEALTH_MAGIC.length);
  for (let index = 0; index < prefix.length; index += 1) prefix[index] = readByte(index * 8);
  if (!equalBytes(prefix, STEALTH_MAGIC)) return null;
  let bitLength = 0;
  for (let index = 0; index < 4; index += 1) bitLength = (bitLength * 256) + readByte((STEALTH_MAGIC.length + index) * 8);
  if (!Number.isSafeInteger(bitLength) || bitLength < 8 || bitLength % 8 || headerBits + bitLength > alpha.length) {
    throw new ImageMetadataError('The embedded NovelAI metadata is corrupt.');
  }
  const payload = new Uint8Array(bitLength / 8);
  for (let index = 0; index < payload.length; index += 1) payload[index] = readByte(headerBits + index * 8);
  return payload;
}

async function decompress(data: Uint8Array, format: 'gzip' | 'deflate'): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new ImageMetadataError('This browser cannot decompress image metadata.');
  try {
    const body = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream(format));
    return textDecoder.decode(await new Response(stream).arrayBuffer());
  } catch {
    throw new ImageMetadataError('The embedded NovelAI metadata is corrupt.');
  }
}

export function parseMetadataJson(value: string): Record<string, unknown> {
  try {
    let parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    const outer = parsed as Record<string, unknown>;
    if (typeof outer.Comment === 'string') {
      const comment = JSON.parse(outer.Comment);
      if (comment && typeof comment === 'object' && !Array.isArray(comment)) return comment as Record<string, unknown>;
    }
    return outer;
  } catch {
    throw new ImageMetadataError('The image metadata is not valid NovelAI JSON.');
  }
}

function text(value: unknown): string { return typeof value === 'string' ? value : value == null ? '' : String(value); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function caption(value: unknown): string { const source = record(value); return text(record(source.caption).base_caption); }
function firstText(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) { const value = source[key]; if (typeof value === 'string' && value) return value; }
  return '';
}
function characterAt(value: unknown, index: number): string {
  if (!Array.isArray(value)) return '';
  const item = value[index];
  const source = record(item);
  const nestedCaption = caption(item);
  if (nestedCaption) return nestedCaption;
  for (const key of ['char_caption', 'prompt', 'text']) if (key in source) return text(source[key]);
  return typeof item === 'string' ? item : '';
}
function characterPrompts(value: unknown): unknown {
  const source = record(value);
  return source.character_prompts ?? record(source.caption).char_captions;
}

export function normalizeMetadata(raw: Record<string, unknown>): ImageMetadata {
  const source = record(raw);
  const parameters = record(source.parameters);
  const settings = Object.keys(parameters).length ? parameters : source;
  const modelName = firstText(source, ['model_name', 'model']) || firstText(settings, ['model_name', 'model']);
  const modelHash = firstText(source, ['model_hash', 'hash']) || firstText(settings, ['model_hash', 'hash']);
  const model = modelName || modelHash || firstText(source, ['Source']) || 'Unknown model';
  const base = {
    positive: caption(source.v4_prompt) || firstText(source, ['prompt', 'Description']),
    negative: caption(source.v4_negative_prompt) || firstText(source, ['uc'])
  };
  const positives = characterPrompts(source.v4_prompt);
  const negatives = characterPrompts(source.v4_negative_prompt);
  const positiveList = Array.isArray(positives) ? positives : [];
  const negativeList = Array.isArray(negatives) ? negatives : [];
  const characters = Array.from({ length: Math.max(positiveList.length, negativeList.length) }, (_, index) => ({
    positive: characterAt(positives, index), negative: characterAt(negatives, index)
  }));
  return {
    model, steps: text(settings.steps), sampler: firstText(settings, ['sampler', 'sampler_name']),
    width: text(settings.width), height: text(settings.height), scale: text(settings.scale ?? settings.cfg_scale), base, characters
  };
}

async function commentFromChunks(chunks: PngTextChunk[]): Promise<string | null> {
  for (const chunk of chunks) {
    if (chunk.keyword !== 'Comment') continue;
    if (chunk.text !== undefined) return chunk.text;
    if (chunk.compressed) return decompress(chunk.compressed, 'deflate');
  }
  return null;
}

async function alphaFromFile(file: File): Promise<Uint8Array> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new ImageMetadataError('The image could not be decoded.');
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(canvas.width * canvas.height);
    let index = 0;
    for (let x = 0; x < canvas.width; x += 1) for (let y = 0; y < canvas.height; y += 1) alpha[index++] = rgba[(y * canvas.width + x) * 4 + 3];
    return alpha;
  } catch (error) {
    if (error instanceof ImageMetadataError) throw error;
    throw new ImageMetadataError('The image could not be decoded.');
  } finally { bitmap?.close(); }
}

export async function extractImageMetadata(file: File, alreadyReadBytes?: Uint8Array): Promise<ImageMetadata> {
  // Callers that also need a display/save blob may supply their single local
  // read. Direct callers retain the original File-only contract.
  const bytes = alreadyReadBytes ?? new Uint8Array(await file.arrayBuffer());
  if (hasPrefix(bytes, PNG_SIGNATURE)) {
    const chunks = parsePngTextChunks(bytes);
    const stealth = decodeStealthPayload(await alphaFromFile(file));
    if (stealth) return normalizeMetadata(parseMetadataJson(await decompress(stealth, 'gzip')));
    const comment = await commentFromChunks(chunks);
    if (comment) return normalizeMetadata(parseMetadataJson(comment));
  } else if (isWebp(bytes)) {
    const comment = parseWebpExifUserComment(bytes);
    if (comment) return normalizeMetadata(parseMetadataJson(comment));
    // Alpha is deliberately read from decoded pixels, never raw WebP ALPH bytes.
    const stealth = decodeStealthPayload(await alphaFromFile(file));
    if (stealth) return normalizeMetadata(parseMetadataJson(await decompress(stealth, 'gzip')));
  } else {
    throw new ImageMetadataError('Choose a PNG or WebP image exported by NovelAI.');
  }
  throw new ImageMetadataError('No NovelAI metadata was found in this image.');
}

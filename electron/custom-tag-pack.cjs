const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { validateImagePayload } = require('./custom-tag-assets.cjs');

const PACK_FORMAT = 'nai-custom-tags-pack';
const PACK_SCHEMA_VERSION = 1;
const LIBRARY_FORMAT = 'nai-custom-tag-library';
const LIBRARY_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_PREVIEW_BYTES = 512 * 1024 * 1024;
const MAX_CARDS = 5000;
const CUSTOM_TAG_MAX_LENGTH = 4096;
// A full pack may contain one directory entry plus pack.json, manifest.json,
// and one distinct preview file for every card. Keep the archive entry budget
// aligned with the card limit instead of consuming three cards on metadata.
const MAX_ENTRIES = MAX_CARDS + 3;
const MAX_ASAR_HEADER_BYTES = 16 * 1024 * 1024;
const ID = /^[a-zA-Z0-9_-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const PREVIEW = /^([a-f0-9]{64})\.(png|jpg|webp)$/;
const MIME_EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every(key => allowed.has(key)) && required.every(key => own(value, key));
}
function strictTimestamp(value) {
  try { return typeof value === 'string' && value === new Date(value).toISOString(); } catch { return false; }
}
function strictId(value) { return typeof value === 'string' && ID.test(value) && value === value.trim(); }
function cleanName(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 80 && value === value.replace(/\s+/g, ' '); }
function decodeEntities(value) {
  return value.replace(/&(amp|quot|apos|lt|gt|nbsp);|&#(\d+);|&#x([\da-f]+);/gi, (match, named, decimal, hexadecimal) => {
    if (named) return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[named.toLowerCase()] ?? match;
    const code = Number.parseInt(decimal ?? hexadecimal ?? '', hexadecimal ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}
function promptToken(value) {
  return value.trim().replace(/^[-+]?\d+(?:\.\d+)?\s*::\s*/, '').replace(/\s*::\s*$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').toLocaleLowerCase();
}
function promptIdentity(value) {
  const seen = new Set(); const parts = [];
  for (const item of String(value).split(',')) { const token = promptToken(item); if (token && !seen.has(token)) { seen.add(token); parts.push(token); } }
  return parts.sort().join('|');
}
function artistIdentity(value) {
  return decodeEntities(String(value)).normalize('NFKC').replace(/^\s*artist\s*:\s*/i, '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLocaleLowerCase();
}
function semanticIdentity(card) {
  const identity = card.kind === 'artist' ? artistIdentity(card.tag) : promptIdentity(card.tag);
  return identity ? (card.kind === 'artist' ? `artist:${identity}` : `tag:${card.zone}:${identity}`) : '';
}
function fail(message) { throw new Error(`Invalid .naipack: ${message}`); }

function validatePreviewMeta(value) {
  if (!isRecord(value) || !exactKeys(value, ['file', 'mime', 'bytes', 'sha256', 'originalName'])) fail('invalid preview metadata');
  if (typeof value.file !== 'string' || !/^previews\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(value.file) || value.file.includes('\\') || value.file.includes('..')) fail('invalid preview path');
  const match = PREVIEW.exec(path.posix.basename(value.file));
  if (!match || value.sha256 !== match[1] || MIME_EXTENSION[value.mime] !== match[2]) fail('preview hash, MIME, or extension mismatch');
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > MAX_PREVIEW_BYTES || !HASH.test(value.sha256)) fail('invalid preview size or hash');
  if (typeof value.originalName !== 'string' || value.originalName.length > 255 || value.originalName.includes('\u0000')) fail('invalid preview original name');
  return value;
}

function validateManifestObject(manifest) {
  if (!exactKeys(manifest, ['format', 'schemaVersion', 'preset', 'cardOrder', 'cards']) || manifest.format !== LIBRARY_FORMAT || manifest.schemaVersion !== LIBRARY_SCHEMA_VERSION) fail('unsupported manifest schema');
  const preset = manifest.preset;
  if (!exactKeys(preset, ['id', 'name', 'createdAt', 'updatedAt']) || !strictId(preset.id) || !cleanName(preset.name) || !strictTimestamp(preset.createdAt) || !strictTimestamp(preset.updatedAt)) fail('invalid preset');
  if (!Array.isArray(manifest.cards) || !Array.isArray(manifest.cardOrder) || manifest.cards.length > MAX_CARDS || manifest.cardOrder.length !== manifest.cards.length) fail('invalid card collection');
  const ids = new Set(); const semantics = new Set();
  for (const card of manifest.cards) {
    if (!exactKeys(card, ['id', 'kind', 'tag', 'presetId', 'description', 'createdAt', 'updatedAt'], ['zone', 'preview']) || !strictId(card.id) || ids.has(card.id)) fail('duplicate or invalid card id');
    if (card.kind !== 'tag' && card.kind !== 'artist') fail('invalid card kind');
    if (card.presetId !== preset.id) fail('card preset id mismatch');
    if (typeof card.tag !== 'string' || !card.tag || card.tag !== card.tag.trim() || card.tag.length > CUSTOM_TAG_MAX_LENGTH || typeof card.description !== 'string' || card.description.length > 2000 || !strictTimestamp(card.createdAt) || !strictTimestamp(card.updatedAt)) fail('invalid card fields');
    if (card.kind === 'tag' && !['frame', 'scene', 'render', 'character'].includes(card.zone)) fail('invalid prompt card zone');
    if (card.kind === 'artist' && own(card, 'zone')) fail('artist card cannot have a zone');
    if (own(card, 'preview')) { if (card.preview == null) fail('null preview is not permitted in a pack'); validatePreviewMeta(card.preview); }
    if (card.kind === 'tag' && !own(card, 'preview')) fail('prompt cards require a preview');
    const identity = semanticIdentity(card); if (!identity || semantics.has(identity)) fail('duplicate card semantic identity');
    ids.add(card.id); semantics.add(identity);
  }
  if (new Set(manifest.cardOrder).size !== manifest.cardOrder.length || manifest.cardOrder.some(id => !strictId(id) || !ids.has(id))) fail('invalid card order');
  return manifest;
}

function readSafeAsarHeader(archivePath) {
  const stat = fs.statSync(archivePath);
  const fd = fs.openSync(archivePath, 'r');
  try {
    const prefix = Buffer.alloc(8);
    if (fs.readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) fail('truncated ASAR header');
    const pickleSize = prefix.readUInt32LE(0); const headerSize = prefix.readUInt32LE(4);
    if (pickleSize < 4 || headerSize < 2 || headerSize > MAX_ASAR_HEADER_BYTES || headerSize + 8 > stat.size) fail('unsafe ASAR header length');
  } finally { fs.closeSync(fd); }
  try { return asar.getRawHeader(archivePath); } catch { fail('malformed ASAR header'); }
}

function walkHeader(node, parent, entries, lowerPaths) {
  if (!isRecord(node) || !isRecord(node.files)) fail('malformed ASAR directory');
  if (Object.keys(node).some(key => key !== 'files')) fail('malformed ASAR directory metadata');
  for (const [name, child] of Object.entries(node.files)) {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\u0000') || path.posix.isAbsolute(name)) fail('unsafe ASAR entry name');
    const entryPath = `${parent}/${name}`;
    const lower = entryPath.toLocaleLowerCase();
    if (lowerPaths.has(lower)) fail('case-colliding ASAR entries');
    lowerPaths.add(lower); entries.push({ path: entryPath, node: child });
    if (entries.length > MAX_ENTRIES) fail('too many ASAR entries');
    if (!isRecord(child)) fail('malformed ASAR entry');
    if (own(child, 'link') || own(child, 'executable') || own(child, 'transformed') || child.unpacked) fail('links, executable, transformed, or unpacked entries are not allowed');
    const metadataKeys = own(child, 'files') ? ['files'] : ['size', 'offset', 'integrity', 'transformed'];
    if (Object.keys(child).some(key => !metadataKeys.includes(key))) fail('malformed ASAR entry metadata');
    if (own(child, 'integrity') && (!isRecord(child.integrity) || !exactKeys(child.integrity, ['algorithm', 'hash', 'blockSize', 'blocks']) || child.integrity.algorithm !== 'SHA256' || !HASH.test(child.integrity.hash) || !Number.isSafeInteger(child.integrity.blockSize) || child.integrity.blockSize <= 0 || child.integrity.blockSize > MAX_ARCHIVE_BYTES || !Array.isArray(child.integrity.blocks) || child.integrity.blocks.some(block => typeof block !== 'string' || !HASH.test(block)))) fail('malformed ASAR integrity metadata');
    if (own(child, 'files')) walkHeader(child, entryPath, entries, lowerPaths);
  }
}

function decodeJson(bytes, label) {
  if (bytes.length > MAX_MANIFEST_BYTES) fail(`${label} is too large`);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value)) fail(`${label} must be an object`);
    return value;
  } catch (error) { if (String(error.message).startsWith('Invalid .naipack:')) throw error; fail(`malformed ${label}`); }
}

function readArchiveFile(archivePath, name, maxBytes) {
  let info;
  try { info = asar.statFile(archivePath, name, false); } catch { fail(`missing ${name}`); }
  if (!isRecord(info) || own(info, 'link') || own(info, 'files') || info.unpacked || !Number.isSafeInteger(info.size) || info.size < 0 || info.size > maxBytes || typeof info.offset !== 'string' || !/^\d+$/.test(info.offset) || !Number.isSafeInteger(Number(info.offset))) fail(`unsafe ${name} size or type`);
  const archiveSize = fs.statSync(archivePath).size; const headerSize = (() => { const fd = fs.openSync(archivePath, 'r'); try { const prefix = Buffer.alloc(8); fs.readSync(fd, prefix, 0, 8, 0); return prefix.readUInt32LE(4); } finally { fs.closeSync(fd); } })();
  if (8 + headerSize + Number(info.offset) + info.size > archiveSize) fail(`unsafe ${name} data range`);
  // Keep extraction explicitly non-following even after the header walk.  This
  // is defense in depth for ASAR's default followLinks=true behavior and keeps
  // the trust boundary independent of a future header/API change.
  let bytes; try { bytes = asar.extractFile(archivePath, name, false); } catch { fail(`cannot read ${name}`); }
  if (!Buffer.isBuffer(bytes) || bytes.length !== info.size || bytes.length > maxBytes) fail(`invalid ${name} payload`);
  if (info.integrity) {
    const blockSize = info.integrity.blockSize;
    // @electron/asar emits a final block even when the payload length is an
    // exact multiple of blockSize (that final block is the empty flush block).
    const blockCount = Math.floor(bytes.length / blockSize) + 1;
    if (info.integrity.hash !== sha256(bytes) || info.integrity.blocks.length !== blockCount) fail(`ASAR integrity mismatch for ${name}`);
    for (let offset = 0, index = 0; offset <= bytes.length; offset += blockSize, index += 1) {
      if (info.integrity.blocks[index] !== sha256(bytes.subarray(offset, Math.min(bytes.length, offset + blockSize)))) fail(`ASAR block integrity mismatch for ${name}`);
    }
  }
  return bytes;
}

function validatePackArchive(archivePath, { stagingDir } = {}) {
  if (typeof archivePath !== 'string' || path.extname(archivePath).toLocaleLowerCase() !== '.naipack') fail('file extension must be .naipack');
  let stat; try { stat = fs.lstatSync(archivePath); } catch { fail('archive is unavailable'); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('archive must be a regular non-symlink file');
  if (stat.size > MAX_ARCHIVE_BYTES) fail('archive exceeds 512 MiB');
  const header = readSafeAsarHeader(archivePath); const entries = []; walkHeader(header.header, '', entries, new Set());
  const files = new Map();
  let hasPreviewDirectory = false;
  for (const entry of entries) {
    const normalized = entry.path.replace(/^\/+/, '');
    if (entry.node.files) {
      if (normalized !== 'previews' || !Object.keys(entry.node.files).length) fail('unexpected or empty preview directory');
      hasPreviewDirectory = true;
      continue;
    }
    if (!['pack.json', 'manifest.json'].includes(normalized) && !/^previews\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(normalized)) fail('extra ASAR entry');
    if (files.has(normalized)) fail('duplicate ASAR entry');
    files.set(normalized, entry.node);
  }
  if (!files.has('pack.json') || !files.has('manifest.json')) fail('pack.json and manifest.json are required');
  const dataEntries = [...files.entries()].map(([name, info]) => {
    if (!isRecord(info) || !Number.isSafeInteger(info.size) || info.size < 0 || typeof info.offset !== 'string' || !/^\d+$/.test(info.offset) || !Number.isSafeInteger(Number(info.offset))) fail(`unsafe ${name} size or offset`);
    return { name, offset: Number(info.offset), size: info.size };
  }).sort((left, right) => left.offset - right.offset);
  let dataOffset = 0;
  for (const entry of dataEntries) { if (entry.offset !== dataOffset) fail('malformed ASAR data layout'); dataOffset += entry.size; }
  if (8 + header.headerSize + dataOffset !== stat.size) fail('malformed ASAR trailing data');
  const packBytes = readArchiveFile(archivePath, 'pack.json', MAX_MANIFEST_BYTES); const pack = decodeJson(packBytes, 'pack.json');
  if (!exactKeys(pack, ['format', 'schemaVersion', 'manifestSha256', 'cardCount', 'totalPreviewBytes']) || pack.format !== PACK_FORMAT || pack.schemaVersion !== PACK_SCHEMA_VERSION || !HASH.test(pack.manifestSha256) || !Number.isSafeInteger(pack.cardCount) || pack.cardCount < 0 || pack.cardCount > MAX_CARDS || !Number.isSafeInteger(pack.totalPreviewBytes) || pack.totalPreviewBytes < 0 || pack.totalPreviewBytes > MAX_TOTAL_PREVIEW_BYTES) fail('invalid pack metadata');
  const manifestBytes = readArchiveFile(archivePath, 'manifest.json', MAX_MANIFEST_BYTES); if (sha256(manifestBytes) !== pack.manifestSha256) fail('manifest digest mismatch');
  const manifest = validateManifestObject(decodeJson(manifestBytes, 'manifest.json')); if (manifest.cards.length !== pack.cardCount) fail('card count mismatch');
  const refs = new Map(); let totalPreviewBytes = 0;
  for (const card of manifest.cards) if (card.preview) {
    const existing = refs.get(card.preview.file);
    // A shared content-addressed file may carry a different original name on
    // each card, but its byte identity and MIME/size contract must agree.
    if (existing && (existing.mime !== card.preview.mime || existing.bytes !== card.preview.bytes || existing.sha256 !== card.preview.sha256)) fail('conflicting shared preview metadata');
    refs.set(card.preview.file, card.preview);
  }
  if (hasPreviewDirectory !== (refs.size > 0)) fail('preview directory does not match manifest references');
  for (const [ref, preview] of refs) {
    const bytes = readArchiveFile(archivePath, ref, MAX_PREVIEW_BYTES);
    if (bytes.length !== preview.bytes || sha256(bytes) !== preview.sha256) fail('preview size or digest mismatch');
    try { validateImagePayload(bytes, preview.mime); } catch { fail('preview MIME or image signature mismatch'); }
    totalPreviewBytes += bytes.length; if (totalPreviewBytes > MAX_TOTAL_PREVIEW_BYTES) fail('previews exceed 512 MiB');
  }
  if (totalPreviewBytes !== pack.totalPreviewBytes) fail('preview byte total mismatch');
  for (const file of files.keys()) if (file.startsWith('previews/') && !refs.has(file)) fail('unreferenced preview entry');
  let stage = null;
  if (stagingDir) {
    fs.mkdirSync(stagingDir, { recursive: true });
    const parentStat = fs.lstatSync(stagingDir); if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail('staging directory is unsafe');
    stage = fs.mkdtempSync(path.join(path.resolve(stagingDir), '.naipack-'));
    try {
      fs.writeFileSync(path.join(stage, 'pack.json'), packBytes, { flag: 'wx' }); fs.writeFileSync(path.join(stage, 'manifest.json'), manifestBytes, { flag: 'wx' });
      if (refs.size) fs.mkdirSync(path.join(stage, 'previews'), { recursive: false });
      for (const ref of refs.keys()) { const target = path.join(stage, ref.replace('/', path.sep)); fs.writeFileSync(target, readArchiveFile(archivePath, ref, MAX_PREVIEW_BYTES), { flag: 'wx' }); }
    } catch (error) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} throw error; }
  }
  return { pack, manifest, previews: refs, archivePath: path.resolve(archivePath), stage };
}

async function createPackArchive({ manifest, destination, previewResolver }) {
  validateManifestObject(manifest);
  if (typeof destination !== 'string' || path.extname(destination).toLocaleLowerCase() !== '.naipack') throw new Error('Pack destination must use .naipack');
  if (typeof previewResolver !== 'function') throw new Error('Pack preview resolver is required');
  const destinationPath = path.resolve(destination);
  if (fs.existsSync(destinationPath)) throw new Error('Pack destination already exists');
  const stage = fs.mkdtempSync(path.join(path.dirname(destinationPath), `.naipack-build-${process.pid}-`));
  let completed = false;
  try {
    const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8'); fs.writeFileSync(path.join(stage, 'manifest.json'), manifestBytes, { flag: 'wx' });
    let totalPreviewBytes = 0; const previewRefs = new Set();
    for (const card of manifest.cards) if (card.preview && !previewRefs.has(card.preview.file)) {
      previewRefs.add(card.preview.file); const bytes = Buffer.from(await previewResolver(card.preview, card));
      if (bytes.length !== card.preview.bytes || sha256(bytes) !== card.preview.sha256) throw new Error('Pack preview bytes do not match manifest');
      validateImagePayload(bytes, card.preview.mime); totalPreviewBytes += bytes.length; if (totalPreviewBytes > MAX_TOTAL_PREVIEW_BYTES) throw new Error('Pack previews exceed 512 MiB');
      const target = path.join(stage, card.preview.file.replace('/', path.sep)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
    }
    const pack = { format: PACK_FORMAT, schemaVersion: PACK_SCHEMA_VERSION, manifestSha256: sha256(manifestBytes), cardCount: manifest.cards.length, totalPreviewBytes };
    fs.writeFileSync(path.join(stage, 'pack.json'), Buffer.from(canonicalJson(pack), 'utf8'), { flag: 'wx' });
    const files = [path.join(stage, 'pack.json'), path.join(stage, 'manifest.json'), ...[...previewRefs].sort().map(ref => path.join(stage, ref.replace('/', path.sep)))];
    await asar.createPackageFromFiles(stage, destinationPath, files);
    validatePackArchive(destinationPath);
    completed = true;
    return { destination: destinationPath, pack, manifest };
  } catch (error) {
    if (!completed) { try { fs.rmSync(destinationPath, { force: true }); } catch {} }
    throw error;
  } finally { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} }
}

function cleanupPackStage(result) { if (result?.stage) { try { fs.rmSync(result.stage, { recursive: true, force: true }); } catch {} } }

module.exports = {
  PACK_FORMAT, PACK_SCHEMA_VERSION, PACK_EXTENSION: '.naipack', CUSTOM_TAG_MAX_LENGTH, MAX_ARCHIVE_BYTES, MAX_MANIFEST_BYTES, MAX_PREVIEW_BYTES, MAX_TOTAL_PREVIEW_BYTES, MAX_CARDS, MAX_ENTRIES,
  canonicalJson, semanticIdentity, validateManifestObject, validatePackArchive, validatePack: validatePackArchive, readPack: validatePackArchive,
  createPackArchive, createPack: createPackArchive, createCustomTagPack: createPackArchive, cleanupPackStage
};

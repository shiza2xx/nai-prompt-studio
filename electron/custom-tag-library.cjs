const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { containedAsset, validateImagePayload } = require('./custom-tag-assets.cjs');
const { createPackArchive, semanticIdentity, validatePackArchive, cleanupPackStage } = require('./custom-tag-pack.cjs');

const FORMAT = 'nai-custom-tag-library';
const VERSION = 1;
const CUSTOM_TAG_MAX_LENGTH = 4096;
const DEFAULT_PRESET_ID = 'default';
const DEFAULT_PRESET_NAME = 'My Tags';
const ID = /^[a-zA-Z0-9_-]+$/;
const PREVIEW_FILE = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/;
const MIME_EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digestMirror(presets, tags) { return sha256(Buffer.from(stable({ customTagPresets: presets, customTags: tags }))); }
function manifestDocument(item) { return { format: FORMAT, schemaVersion: VERSION, preset: item.preset, cardOrder: item.cards.map(card => card.id), cards: item.cards }; }
function digestPreset(item) { return sha256(Buffer.from(stable(manifestDocument(item)))); }
function timestamp(value, fallback) { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback; }
function cleanName(value, limit) { return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit); }
function safeId(value) { const result = String(value ?? '').trim(); return ID.test(result) ? result : ''; }
function strictId(value) { return typeof value === 'string' && value === safeId(value) ? value : ''; }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const descriptor = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(descriptor, bytes, 'utf8'); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  const backup = `${file}.bak`;
  let displaced = false;
  try {
    if (fs.existsSync(file)) { try { fs.rmSync(backup, { force: true }); } catch {} fs.renameSync(file, backup); displaced = true; }
    fs.renameSync(temporary, file);
  } catch (error) {
    try { if (displaced && !fs.existsSync(file) && fs.existsSync(backup)) fs.renameSync(backup, file); } catch {}
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}
function atomicImmutable(file, bytes, beforeRename, afterRename) {
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Immutable preview target is not a regular file');
    const existing = fs.readFileSync(file);
    if (!existing.equals(bytes)) throw new Error('Immutable preview collision');
    return { file, created: false };
  }
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  let renamed = false;
  try {
    if (beforeRename) beforeRename();
    fs.renameSync(temporary, file);
    renamed = true;
    if (afterRename) afterRename();
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    // A failpoint can fire after the rename but before a journal exists. Only
    // remove the target when this invocation created it and it still contains
    // the exact immutable bytes; never remove an existing shared preview.
    if (renamed) {
      try {
        const current = fs.lstatSync(file);
        if (current.isFile() && !current.isSymbolicLink() && fs.readFileSync(file).equals(bytes)) fs.rmSync(file, { force: true });
      } catch {}
    }
    throw error;
  }
  return { file, created: true };
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeWorkspaceSection(workspaceFile, section, value) {
  let workspace = { version: 3 };
  if (fs.existsSync(workspaceFile)) {
    try {
      workspace = readJson(workspaceFile);
      if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) throw new Error('invalid');
      if ((Object.prototype.hasOwnProperty.call(workspace, 'customTags') && !Array.isArray(workspace.customTags)) || (Object.prototype.hasOwnProperty.call(workspace, 'customTagPresets') && !Array.isArray(workspace.customTagPresets))) throw new Error('invalid');
    } catch { throw new Error('Refusing to overwrite malformed workspace.json; repair or restore it before saving other sections.'); }
  }
  atomicJson(workspaceFile, { ...workspace, [section]: value });
}
function strictTimestamp(value) { try { return typeof value === 'string' && value === new Date(value).toISOString(); } catch { return false; } }
function strictPreset(value, expectedId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !strictId(value.id) || (expectedId && value.id !== expectedId)) throw new Error('Invalid canonical preset');
  if (typeof value.name !== 'string' || value.name !== cleanName(value.name, 80) || !value.name || (value.id === DEFAULT_PRESET_ID && value.name !== DEFAULT_PRESET_NAME)) throw new Error('Invalid canonical preset name');
  if (!strictTimestamp(value.createdAt) || !strictTimestamp(value.updatedAt)) throw new Error('Invalid canonical preset timestamp');
  return { id: value.id, name: value.name, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
function validateIndex(value, expectedOrder) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== FORMAT || value.schemaVersion !== VERSION) throw new Error('Invalid custom tag library index');
  if (!Array.isArray(value.presetOrder) || !value.presetOrder.length || value.presetOrder.some(id => !strictId(id)) || new Set(value.presetOrder).size !== value.presetOrder.length) throw new Error('Invalid preset order');
  if (expectedOrder && JSON.stringify(value.presetOrder) !== JSON.stringify(expectedOrder)) throw new Error('Custom tag index order mismatch');
  if (typeof value.mirrorDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.mirrorDigest) || !strictTimestamp(value.updatedAt) || (value.warning != null && typeof value.warning !== 'string')) throw new Error('Invalid custom tag index metadata');
  if (value.presetState != null) {
    if (!value.presetState || typeof value.presetState !== 'object' || Array.isArray(value.presetState) || Object.keys(value.presetState).some(id => !strictId(id) || !value.presetOrder.includes(id))) throw new Error('Invalid custom tag preset state');
    for (const id of value.presetOrder) {
      const state = value.presetState[id];
      if (!state || !Number.isSafeInteger(state.revision) || state.revision <= 0 || typeof state.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(state.sha256)) throw new Error('Invalid custom tag preset state');
    }
  }
  return value;
}
function canonicalPath(value) { const normalized = path.normalize(path.resolve(value)); return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized; }
function isRealDirectory(value) {
  try { const stat = fs.lstatSync(value); return stat.isDirectory() && !stat.isSymbolicLink() && canonicalPath(fs.realpathSync.native(value)) === canonicalPath(value); } catch { return false; }
}
function ensureContainedDirectory(root, target) {
  const base = path.resolve(root); const resolved = path.resolve(target);
  if (resolved !== base && !canonicalPath(resolved).startsWith(`${canonicalPath(base)}${path.sep}`)) throw new Error('Custom tag directory is outside the library');
  fs.mkdirSync(resolved, { recursive: true });
  if (!isRealDirectory(base) || !isRealDirectory(resolved)) throw new Error('Custom tag directory cannot be a symbolic link or junction');
  return resolved;
}
function defaultPreset(now) { return { id: DEFAULT_PRESET_ID, name: DEFAULT_PRESET_NAME, createdAt: now, updatedAt: now }; }

function normalizePreset(value, now, allowDefault = true) {
  if (!value || typeof value !== 'object') return null;
  const id = safeId(value.id); const name = cleanName(value.name, 80);
  if (!id || !name || (!allowDefault && id === DEFAULT_PRESET_ID)) return null;
  const createdAt = timestamp(value.createdAt, now);
  return { id, name: id === DEFAULT_PRESET_ID ? DEFAULT_PRESET_NAME : name, createdAt, updatedAt: timestamp(value.updatedAt, createdAt) };
}
function normalizePresets(values, now) {
  const result = []; const ids = new Set(); const names = new Set(); let builtIn = null;
  for (const value of Array.isArray(values) ? values : []) {
    const preset = normalizePreset(value, now);
    if (!preset) continue;
    if (preset.id === DEFAULT_PRESET_ID) { builtIn = preset; continue; }
    const key = preset.name.toLocaleLowerCase();
    if (ids.has(preset.id) || names.has(key)) continue;
    ids.add(preset.id); names.add(key); result.push(preset);
  }
  return [builtIn ?? defaultPreset(now), ...result];
}
function normalizeLegacyCard(value, presetIds, now) {
  if (!value || typeof value !== 'object') return null;
  const id = safeId(value.id); const rawTag = typeof value.tag === 'string' ? value.tag.trim().replace(/\s+/g, ' ') : ''; const tag = rawTag.length <= CUSTOM_TAG_MAX_LENGTH ? rawTag : '';
  const kind = value.kind === 'artist' ? 'artist' : 'tag';
  const zone = value.zone === 'scene' || value.zone === 'render' || value.zone === 'character' ? value.zone : value.zone === 'frame' ? 'frame' : null;
  if (!id || !tag || (kind === 'tag' && !zone)) return null;
  const presetId = presetIds.has(value.presetId) ? value.presetId : DEFAULT_PRESET_ID;
  const createdAt = timestamp(value.createdAt, now);
  return { id, kind, tag, ...(kind === 'tag' ? { zone } : {}), presetId, description: typeof value.description === 'string' ? value.description.slice(0, 2000) : '', createdAt, updatedAt: timestamp(value.updatedAt, createdAt), ...(typeof value.imageAsset === 'string' ? { legacyAsset: value.imageAsset } : {}), ...(MIME_EXTENSION[value.mime] ? { mime: value.mime } : {}), originalName: typeof value.originalName === 'string' ? value.originalName.slice(0, 255) : '' };
}
function validatePreview(value, presetDir) {
  if (!value || typeof value !== 'object' || typeof value.file !== 'string' || !/^previews\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(value.file.replace(/\\/g, '/'))) return null;
  if (!MIME_EXTENSION[value.mime] || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > 20 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.originalName !== 'string' || value.originalName.length > 255) return null;
  const name = path.basename(value.file); if (!PREVIEW_FILE.test(name) || !name.startsWith(value.sha256 + '.')) return null;
  const previewDir = path.join(presetDir, 'previews'); if (!isRealDirectory(previewDir)) return null;
  let target; try { target = containedAsset(previewDir, name); } catch { return null; }
  const bytes = fs.readFileSync(target); try { validateImagePayload(bytes, value.mime); } catch { return null; }
  if (bytes.length !== value.bytes || sha256(bytes) !== value.sha256 || MIME_EXTENSION[value.mime] !== path.extname(name).slice(1)) return null;
  return { file: `previews/${name}`, mime: value.mime, bytes: value.bytes, sha256: value.sha256, originalName: value.originalName };
}
function normalizeManifest(value, expectedId, presetDir, now) {
  if (!value || value.format !== FORMAT || value.schemaVersion !== VERSION) throw new Error('Unsupported custom tag manifest');
  const preset = strictPreset(value.preset, expectedId);
  if (!Array.isArray(value.cards) || !Array.isArray(value.cardOrder)) throw new Error('Invalid custom tag card collection');
  const sourceCards = value.cards; const byId = new Map();
  for (const source of sourceCards) {
    if (!source || typeof source !== 'object' || Array.isArray(source) || (source.kind !== 'tag' && source.kind !== 'artist') || source.presetId !== expectedId || !strictId(source.id)) throw new Error('Invalid canonical custom card');
    if (typeof source.tag !== 'string' || source.tag !== source.tag.trim() || !source.tag || source.tag.length > CUSTOM_TAG_MAX_LENGTH || typeof source.description !== 'string' || source.description.length > 2000 || !strictTimestamp(source.createdAt) || !strictTimestamp(source.updatedAt)) throw new Error('Invalid canonical custom card fields');
    if (source.kind === 'tag' ? !['frame', 'scene', 'render', 'character'].includes(source.zone) : Object.prototype.hasOwnProperty.call(source, 'zone')) throw new Error('Invalid canonical custom card zone');
    const card = { id: source.id, kind: source.kind, tag: source.tag, ...(source.kind === 'tag' ? { zone: source.zone } : {}), presetId: source.presetId, description: source.description, createdAt: source.createdAt, updatedAt: source.updatedAt };
    if (byId.has(card.id)) throw new Error('Duplicate canonical custom card id');
    const preview = source.preview == null ? null : validatePreview(source.preview, presetDir);
    if (card.kind === 'tag' && !preview) throw new Error('Persisted prompt cards require a valid preview');
    if (source.preview != null && !preview) throw new Error('Invalid custom tag preview');
    delete card.legacyAsset; delete card.mime; delete card.originalName;
    byId.set(card.id, { ...card, ...(preview ? { preview } : {}) });
  }
  const order = value.cardOrder;
  if (order.length !== byId.size || new Set(order).size !== order.length || order.some(id => !strictId(id) || !byId.has(id))) throw new Error('Invalid canonical custom card order');
  return { preset, cards: order.map(id => byId.get(id)) };
}
function runtimeSnapshot(manifests, warning = '') {
  const presets = manifests.map(item => item.preset);
  const tags = manifests.flatMap(item => item.cards.map(card => ({ id: card.id, kind: card.kind, tag: card.tag, ...(card.kind === 'tag' ? { zone: card.zone } : { zone: 'frame' }), presetId: card.presetId, description: card.description, ...(card.preview ? { imageAsset: `${card.presetId}/${card.preview.file}`, mime: card.preview.mime, originalName: card.preview.originalName } : {}), createdAt: card.createdAt, updatedAt: card.updatedAt })));
  return { version: VERSION, presets, tags, ...(warning ? { warning } : {}) };
}
function assertUniqueCardSemantics(manifests) {
  const seen = new Set();
  for (const item of manifests) for (const card of item.cards) {
    const identity = semanticIdentity(card);
    if (!identity || seen.has(identity)) throw new Error('A custom tag with this name already exists in that category.');
    seen.add(identity);
  }
}
function validateManifestSet(manifests, root, now) {
  if (!Array.isArray(manifests) || !manifests.length) throw new Error('Invalid custom tag manifest set');
  const presetIds = new Set(); const cardIds = new Set(); const normalized = [];
  for (const item of manifests) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !item.preset || !Array.isArray(item.cards)) throw new Error('Invalid custom tag manifest set');
    const presetId = item.preset.id;
    if (!strictId(presetId) || presetIds.has(presetId)) throw new Error('Invalid custom tag manifest set');
    presetIds.add(presetId);
    const directory = ensureContainedDirectory(root, path.join(root, 'presets', presetId));
    const manifest = normalizeManifest({ format: FORMAT, schemaVersion: VERSION, preset: item.preset, cardOrder: item.cards.map(card => card?.id), cards: item.cards }, presetId, directory, now);
    for (const card of manifest.cards) {
      if (cardIds.has(card.id)) throw new Error('Duplicate custom card id across preset manifests');
      cardIds.add(card.id);
    }
    normalized.push(manifest);
  }
  if (normalized[0].preset.id !== DEFAULT_PRESET_ID) throw new Error('Default preset must be first');
  return normalized;
}
function preservedDamagedLegacyMirror(index) {
  return typeof index.warning === 'string' && /^\d+ damaged legacy Custom Tags record(?:s)? could not be migrated; the legacy mirror was preserved\./.test(index.warning);
}
function legacyReadOnlySnapshot(legacy, customTagsDir, now, reason) {
  const presets = normalizePresets(legacy.presets, now);
  const presetIds = new Set(presets.map(item => item.id)); const cardIds = new Set(); const tags = [];
  let invalid = 0; let unavailableRequiredPreview = 0; let unavailableOptionalPreview = 0;
  for (const raw of legacy.tags) {
    const card = normalizeLegacyCard(raw, presetIds, now);
    if (!card || cardIds.has(card?.id)) { invalid += 1; continue; }
    cardIds.add(card.id);
    let image = null;
    if (card.legacyAsset && card.mime) {
      try {
        const source = containedAsset(customTagsDir, card.legacyAsset); const bytes = fs.readFileSync(source); validateImagePayload(bytes, card.mime);
        image = { imageAsset: card.legacyAsset, mime: card.mime, originalName: card.originalName };
      } catch { /* Read-only fallback deliberately drops unusable asset references. */ }
    }
    if (card.kind === 'tag' && !image) { unavailableRequiredPreview += 1; continue; }
    if (card.kind === 'artist' && (card.legacyAsset || card.mime) && !image) unavailableOptionalPreview += 1;
    tags.push({ id: card.id, kind: card.kind, tag: card.tag, zone: card.kind === 'tag' ? card.zone : 'frame', presetId: card.presetId, description: card.description, ...image, createdAt: card.createdAt, updatedAt: card.updatedAt });
  }
  const notices = [];
  if (unavailableRequiredPreview) notices.push(`${unavailableRequiredPreview} legacy prompt card${unavailableRequiredPreview === 1 ? '' : 's'} with unavailable required previews ${unavailableRequiredPreview === 1 ? 'was' : 'were'} omitted.`);
  if (unavailableOptionalPreview) notices.push(`${unavailableOptionalPreview} legacy artist image${unavailableOptionalPreview === 1 ? ' was' : 's were'} unavailable and ${unavailableOptionalPreview === 1 ? 'was' : 'were'} omitted.`);
  if (invalid) notices.push(`${invalid} malformed legacy Custom Tags record${invalid === 1 ? ' was' : 's were'} omitted.`);
  return { version: VERSION, presets, tags, warning: [`Canonical Custom Tags library could not be loaded; legacy data is shown read-only. ${reason}`, ...notices].join(' ') };
}

class CustomTagLibrary {
  constructor({ customTagsDir, workspaceFile, now = () => new Date().toISOString(), failpoint = null }) {
    this.customTagsDir = path.resolve(customTagsDir); this.workspaceFile = path.resolve(workspaceFile); this.root = path.join(this.customTagsDir, 'library-v1'); this.now = now; this.failpoint = failpoint; this.previewReferenceIndex = null; this.runtimeCanonical = null;
  }
  invalidatePreviewReferenceIndex() { this.previewReferenceIndex = null; }
  previewReferences() {
    if (this.previewReferenceIndex) return this.previewReferenceIndex;
    const index = new Map();
    const canonical = this.readCanonical();
    for (const manifest of canonical.manifests) for (const card of manifest.cards) if (card.preview) index.set(`${manifest.preset.id}\u0000${card.preview.file}`, true);
    this.previewReferenceIndex = index;
    return index;
  }
  hit(name) { if (this.failpoint) this.failpoint(name); }
  indexFile() { return path.join(this.root, 'index.json'); }
  journalFile() { return path.join(this.root, 'journal.json'); }
  manifestFile(id, root = this.root) { if (!safeId(id)) throw new Error('Invalid preset id'); return path.join(root, 'presets', id, 'manifest.json'); }
  readCanonical() {
    if (!isRealDirectory(this.root)) throw new Error('Custom tag library is unavailable');
    const index = validateIndex(readJson(this.indexFile()));
    const seen = new Set(); const cardIds = new Set(); const manifests = [];
    for (const id of index.presetOrder) { if (!strictId(id) || seen.has(id)) throw new Error('Invalid preset order'); seen.add(id); const dir = path.join(this.root, 'presets', id); if (!isRealDirectory(dir)) throw new Error('Invalid preset directory'); const manifest = normalizeManifest(readJson(this.manifestFile(id)), id, dir, this.now()); for (const card of manifest.cards) { if (cardIds.has(card.id)) throw new Error('Duplicate custom card id across preset manifests'); cardIds.add(card.id); } manifests.push(manifest); }
    if (manifests[0].preset.id !== DEFAULT_PRESET_ID) throw new Error('Default preset must be first');
    const [presets, tags] = this.compatibilityArrays(manifests);
    if (index.mirrorDigest !== digestMirror(presets, tags) && !preservedDamagedLegacyMirror(index)) throw new Error('Custom tag index mirror digest mismatch');
    const computedState = Object.fromEntries(manifests.map(item => [item.preset.id, { revision: index.presetState?.[item.preset.id]?.revision ?? 1, sha256: digestPreset(item) }]));
    const presetStateCurrent = index.presetState && index.presetOrder.every(id => index.presetState[id]?.sha256 === computedState[id].sha256);
    const normalizedIndex = presetStateCurrent ? index : { ...index, presetState: computedState, updatedAt: this.now() };
    if (!presetStateCurrent && canonicalPath(this.root) === canonicalPath(path.join(this.customTagsDir, 'library-v1'))) atomicJson(this.indexFile(), normalizedIndex);
    const canonical = { index: normalizedIndex, manifests };
    this.retainCanonical(canonical);
    return canonical;
  }
  retainCanonical(canonical) {
    const cardIndex = new Map(); const semanticIndex = new Map(); const previewRefs = new Map(); const manifestSignatures = new Map();
    for (const item of canonical.manifests) { const stat = fs.statSync(this.manifestFile(item.preset.id)); manifestSignatures.set(item.preset.id, `${stat.size}:${stat.mtimeMs}`); }
    for (const item of canonical.manifests) for (const card of item.cards) {
      cardIndex.set(card.id, { presetId: item.preset.id, card });
      semanticIndex.set(semanticIdentity(card), card.id);
      if (card.preview) previewRefs.set(`${item.preset.id}\u0000${card.preview.file}`, true);
    }
    this.runtimeCanonical = { index: canonical.index, manifests: canonical.manifests, cardIndex, semanticIndex, previewRefs, manifestSignatures };
  }
  transactionCanonical() {
    if (!this.runtimeCanonical) { this.readCanonical(); return this.runtimeCanonical; }
    let index;
    try { index = validateIndex(readJson(this.indexFile())); } catch { this.readCanonical(); return this.runtimeCanonical; }
    if (stable(index.presetOrder) !== stable(this.runtimeCanonical.index.presetOrder) || stable(index.presetState) !== stable(this.runtimeCanonical.index.presetState) || index.mirrorDigest !== this.runtimeCanonical.index.mirrorDigest) { this.readCanonical(); return this.runtimeCanonical; }
    try {
      for (const id of index.presetOrder) { const stat = fs.statSync(this.manifestFile(id)); if (this.runtimeCanonical.manifestSignatures.get(id) !== `${stat.size}:${stat.mtimeMs}`) { this.readCanonical(); return this.runtimeCanonical; } }
    } catch { this.readCanonical(); return this.runtimeCanonical; }
    return this.runtimeCanonical;
  }
  readLegacy() {
    if (!fs.existsSync(this.workspaceFile)) return { exists: false, valid: true, workspace: {}, presets: [], tags: [] };
    try {
      const workspace = readJson(this.workspaceFile); if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) throw new Error('invalid');
      if ((Object.prototype.hasOwnProperty.call(workspace, 'customTags') && !Array.isArray(workspace.customTags)) || (Object.prototype.hasOwnProperty.call(workspace, 'customTagPresets') && !Array.isArray(workspace.customTagPresets))) throw new Error('invalid');
      return { exists: true, valid: true, workspace, presets: Array.isArray(workspace.customTagPresets) ? workspace.customTagPresets : [], tags: Array.isArray(workspace.customTags) ? workspace.customTags : [] };
    } catch { return { exists: true, valid: false, workspace: null, presets: [], tags: [] }; }
  }
  migrationManifests(legacy, stageRoot) {
    const now = this.now(); const presets = normalizePresets(legacy.presets, now); const ids = new Set(presets.map(item => item.id));
    const cards = []; const seen = new Set(); let skipped = 0; let normalized = 0;
    if (legacy.presets.length && JSON.stringify(legacy.presets) !== JSON.stringify(presets)) normalized += 1;
    for (const value of legacy.tags) {
      const card = normalizeLegacyCard(value, ids, now); if (!card || seen.has(card.id)) throw new Error('Legacy Custom Tags metadata is malformed or contains duplicate ids; migration was not activated.'); seen.add(card.id); cards.push(card);
      const expectedKind = value.kind === 'artist' ? 'artist' : 'tag';
      if (value.kind !== expectedKind || value.id !== card.id || value.tag !== card.tag || value.presetId !== card.presetId || (expectedKind === 'tag' && value.zone !== card.zone) || typeof value.description !== 'string' || !strictTimestamp(value.createdAt) || !strictTimestamp(value.updatedAt)) normalized += 1;
    }
    const manifests = presets.map(preset => ({ preset, cards: [] })); const map = new Map(manifests.map(item => [item.preset.id, item]));
    for (const card of cards) {
      let preview;
      if (card.legacyAsset && card.mime) {
        try {
          const source = containedAsset(this.customTagsDir, card.legacyAsset); const bytes = fs.readFileSync(source); validateImagePayload(bytes, card.mime);
          const hash = sha256(bytes); const filename = `${hash}.${MIME_EXTENSION[card.mime]}`; const previewDir = ensureContainedDirectory(stageRoot, path.join(stageRoot, 'presets', card.presetId, 'previews'));
          const target = path.join(previewDir, filename); atomicImmutable(target, bytes, () => this.hit('migration:asset-staged'));
          preview = { file: `previews/${filename}`, mime: card.mime, bytes: bytes.length, sha256: hash, originalName: card.originalName };
        } catch { /* malformed legacy assets are skipped below when required */ }
      }
      if (card.kind === 'tag' && !preview) { skipped += 1; continue; }
      const clean = { ...card, ...(preview ? { preview } : {}) }; delete clean.legacyAsset; delete clean.mime; delete clean.originalName; map.get(card.presetId).cards.push(clean);
    }
    return { manifests, skipped, normalized };
  }
  writeTree(root, manifests, mirrorDigestValue = '', warning = '') {
    for (const item of manifests) { const file = this.manifestFile(item.preset.id, root); ensureContainedDirectory(root, path.dirname(file)); atomicJson(file, { format: FORMAT, schemaVersion: VERSION, preset: item.preset, cardOrder: item.cards.map(card => card.id), cards: item.cards }); }
    atomicJson(path.join(root, 'index.json'), { format: FORMAT, schemaVersion: VERSION, presetOrder: manifests.map(item => item.preset.id), presetState: Object.fromEntries(manifests.map(item => [item.preset.id, { revision: 1, sha256: digestPreset(item) }])), mirrorDigest: mirrorDigestValue, updatedAt: this.now(), ...(warning ? { warning } : {}) });
  }
  migrate(legacy) {
    this.invalidatePreviewReferenceIndex();
    const stage = path.join(this.customTagsDir, `.library-v1-stage-${process.pid}-${crypto.randomBytes(6).toString('hex')}`); fs.mkdirSync(stage, { recursive: false });
    try { const migration = this.migrationManifests(legacy, stage); const warnings = []; if (migration.skipped) warnings.push(`${migration.skipped} damaged legacy Custom Tags record${migration.skipped === 1 ? '' : 's'} could not be migrated; the legacy mirror was preserved.`); if (migration.normalized) warnings.push(`${migration.normalized} legacy Custom Tags record group${migration.normalized === 1 ? '' : 's'} required safe schema normalization.`); const warning = warnings.join(' '); const mirrorDigest = migration.skipped ? digestMirror(legacy.presets, legacy.tags) : digestMirror(...this.compatibilityArrays(migration.manifests)); this.writeTree(stage, migration.manifests, mirrorDigest, warning); this.hit('migration:staged'); this.validateTree(stage); fs.renameSync(stage, this.root); this.hit('migration:activated'); return { ...this.readCanonical(), skipped: migration.skipped }; }
    catch (error) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} throw error; }
  }
  validateTree(root) { const previous = this.root; this.root = root; try { return this.readCanonical(); } finally { this.root = previous; } }
  replayJournal() {
    this.invalidatePreviewReferenceIndex();
    if (!fs.existsSync(this.journalFile())) return;
    this.runtimeCanonical = null;
    const journal = readJson(this.journalFile()); if (!journal || journal.format !== FORMAT || journal.schemaVersion !== VERSION || typeof journal.operationId !== 'string' || !/^[a-f0-9-]{36}$/i.test(journal.operationId) || !Array.isArray(journal.manifests)) throw new Error('Invalid custom tag operation journal');
    validateIndex(journal.index);
    const legacy = this.readLegacy(); this.commitJournal(journal, { mirror: !legacy.exists || legacy.valid });
  }
  compatibilityArrays(manifests) {
    const snapshot = runtimeSnapshot(manifests);
    const tags = snapshot.tags.map(tag => tag.imageAsset ? { ...tag, imageAsset: path.basename(tag.imageAsset) } : tag);
    return [snapshot.presets, tags];
  }
  ensureFlatMirrorAssets(manifests, changedPreviews = null) {
    const requested = changedPreviews == null ? null : new Set(changedPreviews.map(item => `${item.presetId}\u0000${item.file}`));
    for (const item of manifests) for (const card of item.cards) if (card.preview && (!requested || requested.has(`${item.preset.id}\u0000${card.preview.file}`))) {
      const sourceDir = path.join(this.root, 'presets', item.preset.id, 'previews');
      const source = containedAsset(sourceDir, path.basename(card.preview.file)); const bytes = fs.readFileSync(source);
      const target = path.join(this.customTagsDir, path.basename(card.preview.file));
      atomicImmutable(target, bytes, () => this.hit('mirror:asset-staged'));
    }
  }
  commitJournal(journal, { mirror = true, trustedDelta = false } = {}) {
    const manifestIds = journal.manifests.map(item => item?.preset?.id);
    if (!manifestIds.length || manifestIds[0] !== DEFAULT_PRESET_ID || new Set(manifestIds).size !== manifestIds.length || manifestIds.some(id => !strictId(id))) throw new Error('Invalid custom tag journal index');
    validateIndex(journal.index, manifestIds);
    const cleanup = journal.cleanup;
    if (cleanup != null && (!cleanup || typeof cleanup !== 'object' || !strictId(cleanup.presetId) || cleanup.presetId === DEFAULT_PRESET_ID || manifestIds.includes(cleanup.presetId) || !Array.isArray(cleanup.previews) || cleanup.previews.some(preview => !preview || typeof preview.file !== 'string' || !/^previews\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(preview.file.replace(/\\/g, '/'))))) throw new Error('Invalid custom tag cleanup journal');
    if (Array.isArray(journal.assetCopies)) {
      for (const copy of journal.assetCopies) {
        if (!copy || typeof copy.source !== 'string' || typeof copy.target !== 'string' || !/^presets\/[a-zA-Z0-9_-]+\/previews\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(copy.target)) throw new Error('Invalid custom tag import asset journal');
        const sourceResolved = path.resolve(copy.source);
        const profileRoot = path.dirname(this.customTagsDir);
        if (!canonicalPath(sourceResolved).startsWith(`${canonicalPath(profileRoot)}${path.sep}`) || !path.basename(sourceResolved).match(/^[a-f0-9]{64}\.(?:png|jpg|webp)$/)) throw new Error('Invalid custom tag import asset source');
        const source = containedAsset(path.dirname(sourceResolved), path.basename(sourceResolved));
        const targetRelative = copy.target.replace(/\\/g, '/');
        const targetParts = targetRelative.split('/');
        const targetDir = ensureContainedDirectory(this.root, path.join(this.root, 'presets', targetParts[1], 'previews'));
        const target = path.join(targetDir, targetParts[3]);
        atomicImmutable(target, fs.readFileSync(source), () => { this.hit('transaction:asset-staged'); this.hit('transaction:asset:staged'); });
        this.hit('transaction:asset');
      }
    }
    // Direct ordinary transactions are constructed from the retained, fully
    // validated runtime state and validate only their cloned preset(s) before
    // journaling. Replay/import/recovery never take this shortcut.
    const manifests = trustedDelta ? journal.manifests : validateManifestSet(journal.manifests, this.root, this.now());
    const [presets, tags] = this.compatibilityArrays(manifests);
    if (journal.index.mirrorDigest !== digestMirror(presets, tags)) throw new Error('Custom tag journal mirror digest mismatch');
    const changedPresetIds = Array.isArray(journal.changedPresetIds) ? new Set(journal.changedPresetIds) : null;
    if (changedPresetIds && (changedPresetIds.size !== journal.changedPresetIds.length || [...changedPresetIds].some(id => !strictId(id) || !manifestIds.includes(id)))) throw new Error('Invalid custom tag journal changed preset list');
    const changedMirrorPreviews = Array.isArray(journal.changedMirrorPreviews) ? journal.changedMirrorPreviews : null;
    if (changedMirrorPreviews && changedMirrorPreviews.some(preview => !preview || !strictId(preview.presetId) || typeof preview.file !== 'string' || !/^previews\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(preview.file) || !manifests.some(item => item.preset.id === preview.presetId && item.cards.some(card => card.preview?.file === preview.file)))) throw new Error('Invalid custom tag journal changed mirror preview list');
    for (const item of journal.manifests) { if (changedPresetIds && !changedPresetIds.has(item.preset.id)) continue; const file = this.manifestFile(item.preset.id); atomicJson(file, { format: FORMAT, schemaVersion: VERSION, preset: item.preset, cardOrder: item.cards.map(card => card.id), cards: item.cards }); }
    this.hit('transaction:manifests');
    atomicJson(this.indexFile(), journal.index); this.hit('transaction:index');
    if (mirror) {
      this.ensureFlatMirrorAssets(journal.manifests, changedMirrorPreviews);
      this.writeMirror(journal.manifests, journal.index.mirrorDigest); this.hit('transaction:mirror');
      fs.rmSync(this.journalFile(), { force: true });
      if (cleanup) {
        try { this.cleanupDeletedPreset(cleanup.presetId, cleanup.previews, journal.manifests); } catch { /* Committed state remains authoritative if cleanup cannot complete. */ }
      }
    }
    this.retainCanonical({ index: journal.index, manifests });
  }
  writeMirror(manifests, digest) {
    const current = this.readLegacy();
    if (current.exists && !current.valid) throw new Error('Refusing to overwrite malformed workspace.json');
    const workspace = current.workspace ?? { version: 3 }; const [presets, tags] = this.compatibilityArrays(manifests);
    atomicJson(this.workspaceFile, { ...workspace, customTagPresets: presets, customTags: tags, customTagLibraryDigest: digest });
  }
  mergeDrift(canonical, legacy) {
    const current = runtimeSnapshot(canonical.manifests); const manifests = canonical.manifests.map(item => ({ preset: { ...item.preset }, cards: item.cards.map(card => ({ ...card, ...(card.preview ? { preview: { ...card.preview } } : {}) })) })); const presetMap = new Map(manifests.map(item => [item.preset.id, item])); const cardMap = new Map(manifests.flatMap(item => item.cards.map(card => [card.id, { owner: item, card }]))); let changed = false;
    for (const preset of normalizePresets(legacy.presets, this.now())) if (!presetMap.has(preset.id) && preset.id !== DEFAULT_PRESET_ID) { const item = { preset, cards: [] }; presetMap.set(preset.id, item); manifests.push(item); changed = true; }
    const ids = new Set(presetMap.keys());
    for (const raw of legacy.tags) {
      const incoming = normalizeLegacyCard(raw, ids, this.now()); if (!incoming) continue; const found = cardMap.get(incoming.id);
      if (found && Date.parse(incoming.updatedAt) > Date.parse(found.card.updatedAt)) {
        let replacementPreview = found.card.preview;
        if (incoming.legacyAsset || incoming.mime) { if (!incoming.legacyAsset || !incoming.mime) continue; try { replacementPreview = this.previewFromLegacy(incoming, incoming.presetId); } catch { continue; } }
        if (incoming.kind === 'tag' && !replacementPreview) continue;
        const destination = presetMap.get(incoming.presetId); if (destination !== found.owner && replacementPreview === found.card.preview && found.card.preview) this.copyPreview(found.owner.preset.id, destination.preset.id, found.card.preview);
        found.owner.cards.splice(found.owner.cards.indexOf(found.card), 1);
        const replacement = { ...found.card, kind: incoming.kind, tag: incoming.tag, ...(incoming.kind === 'tag' ? { zone: incoming.zone } : {}), presetId: destination.preset.id, description: incoming.description, updatedAt: incoming.updatedAt, ...(replacementPreview ? { preview: replacementPreview } : {}) };
        if (!replacementPreview) delete replacement.preview;
        if (incoming.kind === 'artist') delete replacement.zone;
        destination.cards.push(replacement); changed = true; continue;
      }
      if (found) continue;
      let preview;
      if (incoming.legacyAsset && incoming.mime) try { preview = this.previewFromLegacy(incoming, incoming.presetId); } catch {}
      if (incoming.kind === 'tag' && !preview) continue;
      const card = { id: incoming.id, kind: incoming.kind, tag: incoming.tag, ...(incoming.kind === 'tag' ? { zone: incoming.zone } : {}), presetId: incoming.presetId, description: incoming.description, createdAt: incoming.createdAt, updatedAt: incoming.updatedAt, ...(preview ? { preview } : {}) };
      presetMap.get(incoming.presetId).cards.push(card); cardMap.set(card.id, { owner: presetMap.get(incoming.presetId), card }); changed = true;
    }
    if (!changed) return { snapshot: current, warning: 'Custom Tags compatibility mirror differed from the canonical library; canonical data was retained.' };
    const stamp = this.now().replace(/[:.]/g, '-'); atomicJson(path.join(this.customTagsDir, `workspace-recovery-${stamp}.json`), legacy.workspace);
    return { snapshot: this.commit(manifests), warning: 'Custom Tags compatibility mirror changes were conservatively merged; no canonical deletions were inferred.' };
  }
  load() {
    this.invalidatePreviewReferenceIndex();
    // A pending journal can update workspace.json as part of replay. Do not
    // compare the committed canonical tree to a pre-replay mirror afterwards:
    // that stale snapshot would look like external drift and could resurrect
    // cards/folders a completed delete transaction just removed.
    fs.mkdirSync(this.customTagsDir, { recursive: true }); let legacy = this.readLegacy();
    let canonical;
    try { if (fs.existsSync(this.root)) { this.replayJournal(); legacy = this.readLegacy(); canonical = this.readCanonical(); } else if (!legacy.valid) return { version: VERSION, presets: [], tags: [], warning: 'Custom Tags workspace is malformed; no empty canonical library was created.' }; else { canonical = this.migrate(legacy); const migrated = runtimeSnapshot(canonical.manifests, canonical.index.warning ?? ''); if (!canonical.skipped) { try { this.ensureFlatMirrorAssets(canonical.manifests); this.writeMirror(canonical.manifests, canonical.index.mirrorDigest); } catch (error) { return { ...migrated, warning: `Canonical Custom Tags migration succeeded, but its compatibility mirror could not be synchronized. ${error.message}` }; } } return migrated; } }
    catch (error) {
      try { canonical = this.recoverFromBackups(); }
      catch { const fallback = legacy.valid ? legacyReadOnlySnapshot(legacy, this.customTagsDir, this.now(), error.message) : { version: VERSION, presets: [], tags: [], warning: `Canonical Custom Tags library and compatibility workspace are unavailable. ${error.message}` }; return fallback; }
    }
    const snapshot = runtimeSnapshot(canonical.manifests, canonical.index.warning ?? ''); if (preservedDamagedLegacyMirror(canonical.index)) return snapshot; const [mirrorPresets, mirrorTags] = this.compatibilityArrays(canonical.manifests); const expected = digestMirror(mirrorPresets, mirrorTags); const actual = legacy.valid ? digestMirror(legacy.presets, legacy.tags) : '';
    if (legacy.exists && legacy.valid && canonical.index.mirrorDigest && actual !== canonical.index.mirrorDigest) { const merged = this.mergeDrift(canonical, legacy); return { ...merged.snapshot, warning: merged.warning }; }
    if (legacy.exists && !legacy.valid) {
      const recovery = path.join(this.customTagsDir, `workspace-corrupt-${this.now().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}.json`);
      try { fs.copyFileSync(this.workspaceFile, recovery, fs.constants.COPYFILE_EXCL); } catch {}
      return { ...snapshot, warning: [snapshot.warning, 'workspace.json is malformed and was preserved unchanged; compatibility mirroring and generic saves are disabled until it is repaired.'].filter(Boolean).join(' ') };
    }
    if (!legacy.exists || actual !== expected) { try { this.ensureFlatMirrorAssets(canonical.manifests); this.writeMirror(canonical.manifests, expected); } catch (error) { return { ...snapshot, warning: `Canonical Custom Tags loaded, but its compatibility mirror could not be synchronized. ${error.message}` }; } }
    return snapshot;
  }
  commit(manifests, cleanup, delta = null) {
    this.invalidatePreviewReferenceIndex();
    const changedPresetIds = delta?.changedPresetIds;
    const changedMirrorPreviews = delta?.changedMirrorPreviews;
    if (Array.isArray(changedPresetIds)) for (const id of changedPresetIds) {
      const index = manifests.findIndex(item => item.preset.id === id); if (index < 0) throw new Error('Changed Custom Tags preset is missing');
      const directory = ensureContainedDirectory(this.root, path.join(this.root, 'presets', id));
      manifests[index] = normalizeManifest(manifestDocument(manifests[index]), id, directory, this.now());
    }
    const [mirrorPresets, mirrorTags] = this.compatibilityArrays(manifests); const mirrorDigestValue = digestMirror(mirrorPresets, mirrorTags);
    const previousState = this.runtimeCanonical?.index?.presetState ?? {};
    const changed = new Set(Array.isArray(changedPresetIds) ? changedPresetIds : manifests.map(item => item.preset.id));
    const presetState = Object.fromEntries(manifests.map(item => [item.preset.id, { revision: changed.has(item.preset.id) ? ((previousState[item.preset.id]?.revision ?? 0) + 1) : (previousState[item.preset.id]?.revision ?? 1), sha256: digestPreset(item) }]));
    const journal = { format: FORMAT, schemaVersion: VERSION, operationId: crypto.randomUUID(), manifests, ...(cleanup ? { cleanup } : {}), ...(Array.isArray(changedPresetIds) ? { changedPresetIds } : {}), ...(Array.isArray(changedMirrorPreviews) ? { changedMirrorPreviews } : {}), index: { format: FORMAT, schemaVersion: VERSION, presetOrder: manifests.map(item => item.preset.id), presetState, mirrorDigest: mirrorDigestValue, updatedAt: this.now() } };
    atomicJson(this.journalFile(), journal); this.hit('transaction:journal'); this.commitJournal(journal, { trustedDelta: Array.isArray(changedPresetIds) }); return runtimeSnapshot(manifests);
  }
  exportablePreset(presetId) {
    this.replayJournal(); const canonical = this.readCanonical();
    if (!strictId(presetId) || presetId === DEFAULT_PRESET_ID) throw new Error('Only a created Custom Tags preset can be exported');
    const item = canonical.manifests.find(manifest => manifest.preset.id === presetId);
    if (!item || !item.cards.length) throw new Error('Only non-empty created presets can be exported');
    return { preset: { ...item.preset }, cards: item.cards.map(card => ({ ...card, ...(card.preview ? { preview: { ...card.preview } } : {}) })) };
  }
  async exportPack(presetId, destination, tempDir) {
    const manifest = this.exportablePreset(presetId);
    const finalDestination = path.resolve(destination); const buildDir = path.resolve(tempDir || path.dirname(finalDestination)); fs.mkdirSync(buildDir, { recursive: true });
    const stagedDestination = path.join(buildDir, `.naipack-build-${process.pid}-${crypto.randomBytes(6).toString('hex')}.naipack`);
    const result = await createPackArchive({
      manifest: { format: FORMAT, schemaVersion: VERSION, preset: manifest.preset, cardOrder: manifest.cards.map(card => card.id), cards: manifest.cards },
      destination: stagedDestination,
      previewResolver: preview => {
        if (!preview || typeof preview.file !== 'string') throw new Error('Exported preview reference is invalid');
        const source = containedAsset(path.join(this.root, 'presets', manifest.preset.id, 'previews'), path.basename(preview.file));
        return fs.readFileSync(source);
      }
    });
    if (fs.existsSync(finalDestination)) { try { fs.rmSync(stagedDestination, { force: true }); } catch {} throw new Error('Pack destination already exists'); }
    try { fs.mkdirSync(path.dirname(finalDestination), { recursive: true }); fs.renameSync(stagedDestination, finalDestination); }
    catch (error) { try { fs.rmSync(stagedDestination, { force: true }); } catch {} throw error; }
    return { ...result, destination: finalDestination };
  }
  importPack(archivePath, options = {}) {
    const requestedStage = typeof options === 'string' ? options : options?.stagingDir;
    const stagingDir = requestedStage || path.join(path.dirname(this.customTagsDir), 'temp');
    const parsed = validatePackArchive(archivePath, { stagingDir });
    const stage = parsed.stage;
    try {
      this.hit('import:stage');
      this.replayJournal(); const canonical = this.readCanonical();
      const legacyState = this.readLegacy();
      if (legacyState.exists && !legacyState.valid) throw new Error('Custom Tags changes are disabled while workspace.json is malformed.');
      if (/damaged legacy Custom Tags record/i.test(canonical.index.warning ?? '')) throw new Error('Custom Tags changes are disabled until damaged legacy records are repaired or recovered.');
      const now = this.now(); const existingNames = new Set(canonical.manifests.map(item => item.preset.name.toLocaleLowerCase()));
      const sourceName = parsed.manifest.preset.name;
      let name = sourceName; let suffix = 0;
      while (existingNames.has(name.toLocaleLowerCase())) { suffix += 1; const suffixText = ` (Imported${suffix > 1 ? ` ${suffix}` : ''})`; name = `${sourceName.slice(0, Math.max(1, 80 - suffixText.length)).trimEnd()}${suffixText}`; }
      const existingSemantics = new Set(canonical.manifests.flatMap(item => item.cards.map(card => semanticIdentity(card))));
      const importedSemantics = new Set(); const importedCards = []; let skipped = 0;
      const presetId = `preset-${crypto.randomUUID().replace(/-/g, '')}`;
      const cardsById = new Map(parsed.manifest.cards.map(card => [card.id, card]));
      for (const cardId of parsed.manifest.cardOrder) {
        const source = cardsById.get(cardId); if (!source) throw new Error('Invalid .naipack: card order reference is missing');
        const semantic = semanticIdentity(source);
        if (existingSemantics.has(semantic) || importedSemantics.has(semantic)) { skipped += 1; continue; }
        importedSemantics.add(semantic);
        const id = `card-${crypto.randomUUID().replace(/-/g, '')}`;
        const card = { id, kind: source.kind, tag: source.tag, ...(source.kind === 'tag' ? { zone: source.zone } : {}), presetId, description: source.description, createdAt: now, updatedAt: now, ...(source.preview ? { preview: { ...source.preview } } : {}) };
        importedCards.push(card);
      }
      if (parsed.manifest.cards.length > 0 && importedCards.length === 0) return { status: 'no-new-cards', snapshot: runtimeSnapshot(canonical.manifests), presetId: null, name: null, imported: 0, skipped };
      const preset = { id: presetId, name, createdAt: now, updatedAt: now };
      const manifests = canonical.manifests.map(item => ({ preset: { ...item.preset }, cards: item.cards.map(card => ({ ...card, ...(card.preview ? { preview: { ...card.preview } } : {}) })) }));
      manifests.push({ preset, cards: importedCards });
      const [mirrorPresets, mirrorTags] = this.compatibilityArrays(manifests); const mirrorDigestValue = digestMirror(mirrorPresets, mirrorTags);
      const operationId = crypto.randomUUID(); const assetCopies = [];
      for (const card of importedCards) if (card.preview) assetCopies.push({ source: path.join(stage, card.preview.file.replace('/', path.sep)), target: `presets/${presetId}/${card.preview.file}` });
      const changedMirrorPreviews = importedCards.filter(card => card.preview).map(card => ({ presetId, file: card.preview.file }));
      const presetState = { ...(canonical.index.presetState ?? {}), [presetId]: { revision: 1, sha256: digestPreset({ preset, cards: importedCards }) } };
      const journal = { format: FORMAT, schemaVersion: VERSION, operationId, manifests, changedPresetIds: [presetId], changedMirrorPreviews, index: { format: FORMAT, schemaVersion: VERSION, presetOrder: manifests.map(item => item.preset.id), presetState, mirrorDigest: mirrorDigestValue, updatedAt: now }, assetCopies };
      const indexFile = this.indexFile(); const indexBefore = fs.existsSync(indexFile) ? fs.readFileSync(indexFile) : null;
      const workspaceBefore = fs.existsSync(this.workspaceFile) ? fs.readFileSync(this.workspaceFile) : null;
      const indexBackup = `${indexFile}.bak`; const workspaceBackup = `${this.workspaceFile}.bak`;
      const indexBackupBefore = fs.existsSync(indexBackup) ? fs.readFileSync(indexBackup) : null;
      const workspaceBackupBefore = fs.existsSync(workspaceBackup) ? fs.readFileSync(workspaceBackup) : null;
      const flatAssetsBefore = new Set(); for (const card of importedCards) if (card.preview) { const target = path.join(this.customTagsDir, path.basename(card.preview.file)); if (fs.existsSync(target)) flatAssetsBefore.add(target); }
      try {
        this.hit('import:assets');
        atomicJson(this.journalFile(), journal); this.hit('transaction:journal'); this.commitJournal(journal);
      } catch (error) {
        try { fs.rmSync(path.join(this.root, 'presets', presetId), { recursive: true, force: true }); } catch {}
        try { if (indexBefore) fs.writeFileSync(indexFile, indexBefore); else fs.rmSync(indexFile, { force: true }); } catch {}
        try { if (workspaceBefore) fs.writeFileSync(this.workspaceFile, workspaceBefore); else fs.rmSync(this.workspaceFile, { force: true }); } catch {}
        try { if (indexBackupBefore) fs.writeFileSync(indexBackup, indexBackupBefore); else fs.rmSync(indexBackup, { force: true }); } catch {}
        try { if (workspaceBackupBefore) fs.writeFileSync(workspaceBackup, workspaceBackupBefore); else fs.rmSync(workspaceBackup, { force: true }); } catch {}
        for (const card of importedCards) if (card.preview) { const target = path.join(this.customTagsDir, path.basename(card.preview.file)); if (!flatAssetsBefore.has(target)) { try { fs.rmSync(target, { force: true }); } catch {} } }
        try { fs.rmSync(this.journalFile(), { force: true }); } catch {}
        throw error;
      }
      return { status: 'imported', snapshot: runtimeSnapshot(manifests), presetId, name, imported: importedCards.length, skipped };
    } finally {
      // Asset copies are complete (or the journal is removed by the failure
      // rollback) before this method returns. Keep staging task-owned and
      // clean it on every return path, including a pre-existing pending
      // journal or a validation/failpoint error.
      if (stage) cleanupPackStage(parsed);
    }
  }
  transact(operation, payload = {}, bytes) {
    const legacyState = this.readLegacy(); if (legacyState.exists && !legacyState.valid) throw new Error('Custom Tags changes are disabled while workspace.json is malformed.');
    this.replayJournal(); const canonical = this.transactionCanonical(); if (/damaged legacy Custom Tags record/i.test(canonical.index.warning ?? '')) throw new Error('Custom Tags changes are disabled until damaged legacy records are repaired or recovered.'); const manifests = canonical.manifests.slice(); const byPreset = new Map(manifests.map(item => [item.preset.id, item])); const mutablePresetIds = new Set(); const mutablePreset = id => { let item = byPreset.get(id); if (!item) return null; if (mutablePresetIds.has(id)) return item; const clone = { preset: { ...item.preset }, cards: item.cards.map(card => ({ ...card, ...(card.preview ? { preview: { ...card.preview } } : {}) })) }; manifests[manifests.indexOf(item)] = clone; byPreset.set(id, clone); mutablePresetIds.add(id); return clone; }; const now = this.now();
    if (operation === 'preset:create') { const preset = normalizePreset(payload, now, false); if (!preset || byPreset.has(preset.id)) throw new Error('Invalid or duplicate preset'); if (manifests.some(item => item.preset.name.toLocaleLowerCase() === preset.name.toLocaleLowerCase())) throw new Error('Preset names must be unique'); manifests.push({ preset, cards: [] }); }
    else if (operation === 'preset:update') { const current = byPreset.get(payload.id); if (!current || payload.id === DEFAULT_PRESET_ID) throw new Error('Unknown preset'); const name = cleanName(payload.name, 80); if (!name || manifests.some(other => other !== current && other.preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('Preset names must be unique'); const item = mutablePreset(payload.id); item.preset = { ...item.preset, name, updatedAt: now }; }
    else if (operation === 'preset:delete') {
      const item = byPreset.get(payload.id); if (!item || payload.id === DEFAULT_PRESET_ID) throw new Error('Unknown preset');
      const mode = payload.mode == null ? 'move' : payload.mode;
      if (mode !== 'move' && mode !== 'delete') throw new Error('Invalid preset deletion mode');
      const deletedPreviews = item.cards.filter(card => card.preview).map(card => ({ ...card.preview }));
      if (mode === 'move') {
        const target = mutablePreset(DEFAULT_PRESET_ID);
        const targetSemantics = new Set(manifests.flatMap(entry => entry === item ? [] : entry.cards.map(card => semanticIdentity(card))));
        for (const card of item.cards) { const identity = semanticIdentity(card); if (!identity || targetSemantics.has(identity)) throw new Error('A custom tag with this name already exists in that category.'); targetSemantics.add(identity); }
        for (const card of item.cards) { if (card.preview) this.copyPreview(item.preset.id, DEFAULT_PRESET_ID, card.preview); target.cards.push({ ...card, presetId: DEFAULT_PRESET_ID, updatedAt: now }); }
      }
      manifests.splice(manifests.indexOf(item), 1);
      assertUniqueCardSemantics(manifests);
      const changedPresetIds = mode === 'move' ? [DEFAULT_PRESET_ID] : [];
      return this.commit(manifests, { presetId: item.preset.id, previews: deletedPreviews }, { changedPresetIds });
    }
    else if (operation === 'card:delete') { const indexed = canonical.cardIndex?.get(payload.id); const current = indexed ? byPreset.get(indexed.presetId) : null; const currentIndex = current?.cards.findIndex(card => card.id === payload.id) ?? -1; if (!current || currentIndex < 0) throw new Error('Unknown custom card'); const item = mutablePreset(indexed.presetId); item.cards.splice(currentIndex, 1); }
    else if (operation === 'card:upsert') {
      const presetId = byPreset.has(payload.presetId) ? payload.presetId : DEFAULT_PRESET_ID; const legacy = normalizeLegacyCard({ ...payload, presetId }, new Set(byPreset.keys()), now); if (!legacy) throw new Error('Invalid custom card');
      const semanticOwner = canonical.semanticIndex?.get(semanticIdentity(legacy)); if (semanticOwner && semanticOwner !== legacy.id) throw new Error('A custom tag with this name already exists in that category.');
      let previous = null; let previousPresetId = null; let previousIndex = -1; const indexed = canonical.cardIndex?.get(legacy.id); if (indexed) { const item = mutablePreset(indexed.presetId); previousIndex = item.cards.findIndex(card => card.id === legacy.id); if (previousIndex >= 0) { previous = item.cards[previousIndex]; previousPresetId = item.preset.id; item.cards.splice(previousIndex, 1); } }
      let preview = previous?.preview;
      if (bytes != null) preview = this.storePreview(presetId, bytes, payload.mime, payload.originalName, 'transaction:asset');
      if (preview && previousPresetId && previousPresetId !== presetId && bytes == null) this.copyPreview(previousPresetId, presetId, preview);
      if (legacy.kind === 'tag' && !preview) throw new Error('Prompt cards require an image'); const card = { id: legacy.id, kind: legacy.kind, tag: legacy.tag, ...(legacy.kind === 'tag' ? { zone: legacy.zone } : {}), presetId, description: legacy.description, createdAt: previous?.createdAt ?? legacy.createdAt, updatedAt: legacy.updatedAt, ...(preview ? { preview } : {}) }; const destination = mutablePreset(presetId); if (previousPresetId === presetId && previousIndex >= 0) destination.cards.splice(previousIndex, 0, card); else destination.cards.push(card);
    } else throw new Error('Unknown Custom Tags transaction');
    assertUniqueCardSemantics(manifests);
    // Normal edits should touch only the preset manifest that actually
    // changed. The compatibility workspace still receives its authoritative
    // metadata mirror, while unchanged preview bytes are left untouched.
    const previousByPreset = new Map(canonical.manifests.map(item => [item.preset.id, item]));
    const changedPresetIds = manifests.filter(item => stable(item) !== stable(previousByPreset.get(item.preset.id))).map(item => item.preset.id);
    const changedMirrorPreviews = operation === 'card:upsert'
      ? manifests.flatMap(item => item.cards.filter(card => card.id === payload.id && card.preview).map(card => ({ presetId: item.preset.id, file: card.preview.file })))
      : [];
    return this.commit(manifests, undefined, { changedPresetIds, changedMirrorPreviews });
  }
  resolvePreview(presetId, relativeFile) {
    if (!strictId(presetId) || typeof relativeFile !== 'string' || !/^previews\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(relativeFile)) throw new Error('Invalid preview path');
    if (!this.previewReferences().has(`${presetId}\u0000${relativeFile}`)) throw new Error('Preview is not referenced');
    // Authorization is cached, never the bytes or filesystem trust check.
    // Every protocol request still verifies containment, regular-file status,
    // and symlink/junction safety through containedAsset.
    return containedAsset(path.join(this.root, 'presets', presetId, 'previews'), path.basename(relativeFile));
  }
  storePreview(presetId, payload, mime, originalName = '', phase = 'transaction:asset') {
    const bytes = validateImagePayload(payload, mime); const hash = sha256(bytes); const filename = `${hash}.${MIME_EXTENSION[mime]}`;
    const dir = ensureContainedDirectory(this.root, path.join(this.root, 'presets', presetId, 'previews')); const target = path.join(dir, filename);
    const write = atomicImmutable(target, bytes, () => this.hit(`${phase}:staged`), () => this.hit(phase));
    // Existing content-addressed previews still participate in the phase
    // failpoint, but atomicImmutable deliberately does not run the post-rename
    // callback for them (there is no newly-created target to roll back).
    if (!write.created) this.hit(phase);
    return { file: `previews/${filename}`, mime, bytes: bytes.length, sha256: hash, originalName: typeof originalName === 'string' ? originalName.slice(0, 255) : '' };
  }
  previewFromLegacy(card, presetId) {
    const source = containedAsset(this.customTagsDir, card.legacyAsset); const bytes = fs.readFileSync(source);
    return this.storePreview(presetId, bytes, card.mime, card.originalName, 'drift:asset');
  }
  copyPreview(fromPresetId, toPresetId, preview) {
    const source = containedAsset(path.join(this.root, 'presets', fromPresetId, 'previews'), path.basename(preview.file));
    const destinationDir = ensureContainedDirectory(this.root, path.join(this.root, 'presets', toPresetId, 'previews'));
    const destination = path.join(destinationDir, path.basename(preview.file)); atomicImmutable(destination, fs.readFileSync(source), () => this.hit('transaction:asset-copy-staged'));
    return destination;
  }
  cleanupDeletedPreset(presetId, deletedPreviews, manifests) {
    // Cleanup is deliberately outside the journaled commit. A failed cleanup
    // leaves harmless orphan bytes, while a premature cleanup could destroy a
    // preview still referenced by the committed canonical manifests.
    if (manifests.some(item => item?.preset?.id === presetId)) return;
    const remainingNames = new Set();
    const remainingHashes = new Set();
    for (const item of manifests) for (const card of item.cards) if (card.preview) {
      const name = path.basename(card.preview.file);
      remainingNames.add(name);
      remainingHashes.add(card.preview.sha256);
    }
    const deletedDir = path.join(this.root, 'presets', safeId(presetId));
    try {
      if (safeId(presetId) && isRealDirectory(deletedDir)) fs.rmSync(deletedDir, { recursive: true, force: true });
    } catch { /* Orphaned source trees are safe to recover on a later load. */ }
    for (const preview of deletedPreviews) {
      const name = path.basename(typeof preview?.file === 'string' ? preview.file : '');
      if (!PREVIEW_FILE.test(name) || remainingNames.has(name)) continue;
      const hash = name.slice(0, 64);
      // Preserve a shared content-addressed byte even if a malformed or
      // future manifest spells its basename differently.
      if (remainingHashes.has(hash)) continue;
      try {
        const target = containedAsset(this.customTagsDir, name);
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (sha256(fs.readFileSync(target)) !== hash) continue;
        fs.rmSync(target, { force: true });
      } catch { /* Conservative cleanup: never make a successful commit fail. */ }
    }
  }
  recoverFromBackups() {
    if (!isRealDirectory(this.root)) throw new Error('No canonical library to recover');
    const stage = path.join(this.customTagsDir, `.library-recovery-${process.pid}-${crypto.randomBytes(5).toString('hex')}`); fs.cpSync(this.root, stage, { recursive: true, errorOnExist: true });
    try {
      const pending = [stage];
      while (pending.length) for (const entry of fs.readdirSync(pending.pop(), { withFileTypes: true })) { const target = path.join(entry.parentPath || entry.path, entry.name); if (entry.isDirectory()) pending.push(target); else if (entry.isFile() && entry.name.endsWith('.bak')) fs.copyFileSync(target, target.slice(0, -4)); }
      const recovered = this.validateTree(stage); const corrupt = path.join(this.customTagsDir, `library-v1-corrupt-${this.now().replace(/[:.]/g, '-')}`); fs.renameSync(this.root, corrupt); fs.renameSync(stage, this.root); return recovered;
    } catch (error) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} throw error; }
  }
}

function createCustomTagLibrary(options) { return new CustomTagLibrary(options); }
module.exports = { FORMAT, VERSION, CUSTOM_TAG_MAX_LENGTH, DEFAULT_PRESET_ID, CustomTagLibrary, createCustomTagLibrary, digestMirror, normalizePreset, normalizePresets, writeWorkspaceSection };

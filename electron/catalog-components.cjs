/*
 * Thin catalog component storage and download protocol.
 *
 * The application catalog.json is deliberately metadata-only in packaged
 * builds.  Images and guide artwork live in independently verifiable ASAR
 * components beside the profile.  This module contains no Electron APIs so
 * its state, path and transfer invariants can be tested with temporary
 * fixtures.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Electron patches node:fs so paths below an outer .asar are interpreted as
// virtual archive entries.  Component and legacy archives are real files in
// the profile, so use original-fs for those outer-file operations.  Keeping
// the patched fs alias above is intentional: native ASAR reads such as
// `archive.asar/inner/path` rely on Electron's integration.
let outerFs = fs;
try { outerFs = require('original-fs'); } catch { /* plain Node/test runtime */ }

const COMPONENT_VERSION = '0.6.3';
const COMPONENTS = Object.freeze({
  artists: Object.freeze({ id: 'artists', filename: 'nai-v5-artists.asar', expectedRoot: 'cards/artist', count: 4198, version: COMPONENT_VERSION, trustedUrl: `https://github.com/shiza2xx/nai-prompt-studio/releases/download/v${COMPONENT_VERSION}/nai-v5-artists.asar` }),
  characters: Object.freeze({ id: 'characters', filename: 'nai-characters.asar', expectedRoot: 'cards/character', count: 5457, version: COMPONENT_VERSION, trustedUrl: `https://github.com/shiza2xx/nai-prompt-studio/releases/download/v${COMPONENT_VERSION}/nai-characters.asar` }),
  guide: Object.freeze({ id: 'guide', filename: 'nai-constructor-guide.asar', expectedRoot: 'guide', count: 281, version: COMPONENT_VERSION, trustedUrl: `https://github.com/shiza2xx/nai-prompt-studio/releases/download/v${COMPONENT_VERSION}/nai-constructor-guide.asar` })
});

const COMPONENT_IDS = Object.freeze(Object.keys(COMPONENTS));
const TRUSTED_HOST = 'github.com';
const TRUSTED_REDIRECT_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const STATE_VERSION = 1;
const legacyValidationCache = new Map();

function safeRelative(base, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0')) throw new Error('Invalid catalog component path');
  if (relative.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('Catalog component path escaped its profile directory');
  const normalized = path.posix.normalize(relative.replace(/^\/+/, ''));
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('/./')) throw new Error('Catalog component path escaped its profile directory');
  const root = path.resolve(base);
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Catalog component path escaped its profile directory');
  return target;
}

function componentPaths(catalogDir) {
  const root = path.resolve(catalogDir);
  return {
    root,
    state: safeRelative(root, 'catalog-state.json'),
    downloads: safeRelative(root, 'downloads'),
    components: safeRelative(root, 'components'),
    legacy: safeRelative(root, 'legacy'),
    legacyPack: safeRelative(root, 'legacy/legacy-app.asar')
  };
}

function mkdirs(paths) {
  for (const value of [paths.root, paths.downloads, paths.components, paths.legacy]) fs.mkdirSync(value, { recursive: true });
  for (const value of [paths.root, paths.downloads, paths.components, paths.legacy]) {
    const stat = fs.lstatSync(value);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Catalog component directory must be a real directory');
  }
  return paths;
}

function validSha512(value) { return typeof value === 'string' && /^[a-f0-9]{128}$/i.test(value); }
function validUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname === TRUSTED_HOST && url.pathname.startsWith(`/shiza2xx/nai-prompt-studio/releases/download/v${COMPONENT_VERSION}/`);
  } catch { return false; }
}

function normalizeDescriptor(raw, fallbackId) {
  if (!raw || typeof raw !== 'object') throw new Error('Catalog component descriptor must be an object');
  const base = COMPONENTS[String(raw.id || fallbackId || '')];
  if (!base) throw new Error(`Unknown catalog component: ${raw.id || fallbackId || ''}`);
  const descriptor = { ...base, ...raw, id: base.id };
  if (descriptor.filename !== base.filename || descriptor.expectedRoot !== base.expectedRoot || descriptor.version !== COMPONENT_VERSION) throw new Error(`Catalog component ${base.id} has incompatible metadata`);
  const candidateUrl = raw.url ?? raw.trustedUrl ?? base.trustedUrl;
  if (!validUrl(candidateUrl) || candidateUrl !== base.trustedUrl) throw new Error(`Catalog component ${base.id} URL is not trusted`);
  descriptor.url = base.trustedUrl;
  descriptor.trustedUrl = base.trustedUrl;
  if (!Number.isSafeInteger(descriptor.size) || descriptor.size <= 0) throw new Error(`Catalog component ${base.id} has invalid size`);
  if (!validSha512(descriptor.sha512)) throw new Error(`Catalog component ${base.id} has invalid SHA-512`);
  if (!Number.isSafeInteger(descriptor.count) || descriptor.count < 0 || descriptor.count !== base.count && base.count !== 0) throw new Error(`Catalog component ${base.id} has invalid count`);
  return descriptor;
}

function normalizeDescriptors(value) {
  const list = Array.isArray(value) ? value : value && Array.isArray(value.catalogs) ? value.catalogs : [];
  const byId = new Map();
  for (const item of list) {
    const descriptor = normalizeDescriptor(item, item?.id);
    if (byId.has(descriptor.id)) throw new Error(`Duplicate catalog component: ${descriptor.id}`);
    byId.set(descriptor.id, descriptor);
  }
  return COMPONENT_IDS.map(id => byId.get(id)).filter(Boolean);
}

function componentIdentity(descriptor) {
  const id = typeof descriptor === 'string' ? descriptor : descriptor?.id;
  const base = COMPONENTS[String(id || '')];
  if (!base) throw new Error(`Unknown catalog component: ${id || ''}`);
  // Path routing needs only the immutable identity fields. Full descriptors
  // still pass through normalizeDescriptor before verification/download.
  return descriptor && typeof descriptor === 'object' && Number.isSafeInteger(descriptor.size) && validSha512(descriptor.sha512)
    ? normalizeDescriptor(descriptor, id) : base;
}

function hashFile(file, signal) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = outerFs.createReadStream(file);
    const abort = () => { stream.destroy(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    stream.on('end', () => { signal?.removeEventListener('abort', abort); resolve(hash.digest('hex')); });
    if (signal?.aborted) abort();
  });
}

function normalizeInnerPath(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0')) throw new Error('Invalid catalog component path');
  if (relative.split('/').some(segment => segment === '.' || segment === '..')) throw new Error('Catalog component path escaped its archive');
  const normalized = path.posix.normalize(relative.replace(/^\/+/, ''));
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || normalized.includes('/./')) throw new Error('Catalog component path escaped its archive');
  return normalized;
}

// Electron's native ASAR integration lets fs read `archive.asar/inner/path`
// without shipping @electron/asar in the packaged application.  The optional
// inspector is deliberately injectable for build/test tooling that needs to
// enumerate archive entries.
function readNativeArchiveFile(file, relative, readFile = fs.readFileSync) {
  const inner = normalizeInnerPath(relative);
  return readFile(path.join(file, ...inner.split('/')));
}

function archiveEntries(file, { inspector } = {}) {
  if (!inspector || typeof inspector.list !== 'function') throw new Error('ASAR entry inspection is development-only; use native ASAR reads at runtime');
  return inspector.list(file).map(value => String(value).replace(/\\/g, '/').replace(/^\/+/, ''));
}

function readArchiveJson(file, candidates, { inspector } = {}) {
  for (const candidate of candidates) {
    try {
      const bytes = inspector?.read
        ? inspector.read(file, candidate)
        : readNativeArchiveFile(file, candidate);
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch { /* try the next convention */ }
  }
  return null;
}

function validateArchiveShape(file, descriptor, { inspector } = {}) {
  const entries = inspector ? archiveEntries(file, { inspector }) : null;
  const root = descriptor.expectedRoot.replace(/\/+$/, '');
  const metadata = readArchiveJson(file, ['catalog-component.json', 'component.json', 'manifest.json'], { inspector });
  // Pack descriptors and the verified digest are authoritative for thin
  // components without a synthetic metadata file. Development inspectors can
  // still enumerate entries; Electron runtime probes inner files natively.
  const hasRoot = entries ? entries.some(entry => entry === root || entry.startsWith(`${root}/`)) : Boolean(metadata?.expectedRoot || descriptor.expectedRoot);
  if (!hasRoot) throw new Error(`Catalog component ${descriptor.id} is missing expected root ${root}`);
  if (metadata) {
    if (metadata.version && String(metadata.version) !== COMPONENT_VERSION) throw new Error(`Catalog component ${descriptor.id} version mismatch`);
    if (metadata.expectedRoot && String(metadata.expectedRoot).replace(/\\/g, '/') !== root) throw new Error(`Catalog component ${descriptor.id} root metadata mismatch`);
    if (metadata.count !== undefined && descriptor.count > 0 && Number(metadata.count) !== descriptor.count) throw new Error(`Catalog component ${descriptor.id} count mismatch`);
  }
  if (metadata?.id && String(metadata.id) !== descriptor.id) throw new Error(`Catalog component ${descriptor.id} metadata id mismatch`);
  return { entries: entries || [], metadata };
}

async function verifyComponent(file, descriptor, { signal, archiveInspector } = {}) {
  const normalized = normalizeDescriptor(descriptor, descriptor?.id);
  throwIfAborted(signal);
  if (!outerFs.existsSync(file)) throw new Error(`Catalog component ${normalized.id} is missing`);
  const linkStat = outerFs.lstatSync(file);
  if (!linkStat.isFile() || linkStat.isSymbolicLink()) throw new Error(`Catalog component ${normalized.id} must be a regular file`);
  const stat = linkStat;
  if (stat.size !== normalized.size) throw new Error(`Catalog component ${normalized.id} size mismatch`);
  const digest = await hashFile(file, signal);
  throwIfAborted(signal);
  if (digest.toLowerCase() !== normalized.sha512.toLowerCase()) throw new Error(`Catalog component ${normalized.id} SHA-512 mismatch`);
  const shape = validateArchiveShape(file, normalized, { inspector: archiveInspector });
  throwIfAborted(signal);
  return { ...normalized, path: file, status: 'Installed', verifiedSize: stat.size, verifiedSha512: digest, verifiedMtimeMs: stat.mtimeMs, archiveMetadata: shape.metadata };
}

function defaultState() { return { version: STATE_VERSION, components: {} }; }
function loadState(catalogDir) {
  const paths = mkdirs(componentPaths(catalogDir));
  try { const stat = fs.lstatSync(paths.state); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Catalog component state must be a regular file'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  try {
    const value = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
    if (!value || value.version !== STATE_VERSION || !value.components || typeof value.components !== 'object') throw new Error('invalid state');
    return value;
  } catch { return defaultState(); }
}
function saveState(catalogDir, state) {
  const paths = mkdirs(componentPaths(catalogDir));
  try { const stat = fs.lstatSync(paths.state); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Catalog component state must be a regular file'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const temp = safeRelative(paths.root, 'catalog-state.json.tmp');
  try { const stat = fs.lstatSync(temp); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Catalog component state temporary file must be regular'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  fs.writeFileSync(temp, JSON.stringify({ version: STATE_VERSION, components: state.components || {} }, null, 2), 'utf8');
  fs.renameSync(temp, paths.state);
  return state;
}

function componentFile(catalogDir, descriptor) {
  const item = componentIdentity(descriptor);
  return safeRelative(componentPaths(catalogDir).components, item.filename);
}

function partialFile(catalogDir, descriptor) {
  const item = componentIdentity(descriptor);
  return safeRelative(componentPaths(catalogDir).downloads, `${item.filename}.partial`);
}

function componentRecordMatchesFacts(record, stat, item) {
  return record?.status === 'Installed' && record.filename === item.filename
    && Number.isSafeInteger(record.size) && record.size === stat.size
    && Number.isFinite(Number(record.mtimeMs)) && Number(record.mtimeMs) === stat.mtimeMs
    && validSha512(record.sha512);
}

function installedStateRecord(item, stat, sha512) {
  return {
    status: 'Installed',
    filename: item.filename,
    size: stat.size,
    sha512,
    mtimeMs: stat.mtimeMs,
    version: item.version,
    expectedRoot: item.expectedRoot,
    count: item.count,
    updatedAt: new Date().toISOString()
  };
}

function persistInstalledState(catalogDir, verified, file = verified.path) {
  const item = normalizeDescriptor(verified, verified?.id);
  const stat = outerFs.statSync(file);
  const digest = String(verified.verifiedSha512 || verified.sha512 || '').toLowerCase();
  if (stat.size !== item.size || !validSha512(digest)) throw new Error(`Catalog component ${item.id} verification facts are invalid`);
  const state = loadState(catalogDir);
  state.components[item.id] = installedStateRecord(item, stat, digest);
  saveState(catalogDir, state);
  return { ...item, path: file, status: 'Installed', verifiedSize: stat.size, verifiedSha512: digest, verifiedMtimeMs: stat.mtimeMs };
}

function removeMatchingPartial(catalogDir, item, activePath) {
  const partial = partialFile(catalogDir, item);
  if (path.resolve(partial) === path.resolve(activePath)) return;
  try { outerFs.rmSync(partial, { force: true }); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function activateVerifiedComponent(catalogDir, verified, { removePartial = false, signal } = {}) {
  throwIfAborted(signal);
  const activated = activateComponent(catalogDir, verified, { signal });
  throwIfAborted(signal);
  const result = persistInstalledState(catalogDir, verified, activated.path);
  throwIfAborted(signal);
  if (removePartial) {
    throwIfAborted(signal);
    removeMatchingPartial(catalogDir, result, activated.path);
  }
  return result;
}

function statusForComponent(catalogDir, descriptor) {
  const item = normalizeDescriptor(descriptor, descriptor?.id);
  const file = componentFile(catalogDir, item);
  const record = loadState(catalogDir).components[item.id];
  try {
    const stat = outerFs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return { ...item, path: file, status: 'Damaged', sizeOnDisk: stat.size, error: stat.isSymbolicLink() ? 'Symbolic links are not allowed' : 'Component must be a regular file' };
    if (componentRecordMatchesFacts(record, stat, item)) return { ...item, path: file, status: 'Installed', sizeOnDisk: stat.size, verifiedSize: record.size, verifiedSha512: record.sha512, verifiedMtimeMs: record.mtimeMs };
    if (record?.status === 'Installed') return { ...item, path: file, status: 'Damaged', sizeOnDisk: stat.size, error: 'Installed component changed; repair is required' };
    return { ...item, path: file, status: 'Damaged', sizeOnDisk: stat.size, error: 'Component has not been verified' };
  } catch (error) {
    const fileExists = outerFs.existsSync(file);
    if (fileExists) return { ...item, path: file, status: 'Damaged', error: error instanceof Error ? error.message : String(error) };
    // A stale state record cannot make a missing target Installed. Keep the
    // Downloading label only while a real resumable partial is present.
    let resumable = false;
    if (record?.status === 'Downloading') {
      try { const partial = partialFile(catalogDir, item); const partialStat = outerFs.lstatSync(partial); resumable = partialStat.isFile() && !partialStat.isSymbolicLink() && partialStat.size > 0; } catch { resumable = false; }
    }
    const status = resumable ? 'Downloading' : 'Missing';
    return { ...item, path: file, status, error: record?.error || '' };
  }
}

function statuses(catalogDir, descriptors, { archiveInspector } = {}) {
  let migrated = null;
  try { migrated = validateLegacyArchive(componentPaths(catalogDir).legacyPack, { inspector: archiveInspector }); } catch { /* no legacy migration */ }
  return descriptors.map(descriptor => {
    const item = normalizeDescriptor(descriptor, descriptor?.id);
    const current = statusForComponent(catalogDir, item);
    // A successfully activated component is authoritative even when a
    // preserved v0.6.2 archive remains beside it. Legacy is only a fallback
    // source for components that are absent or unusable.
    if (current.status === 'Installed' || !migrated) return current;
    return { ...item, path: migrated.file, status: 'Migrated', verifiedSize: migrated.size };
  });
}

async function inspectComponent(catalogDir, descriptor, { force = false, archiveInspector, signal } = {}) {
  const item = normalizeDescriptor(descriptor, descriptor?.id);
  const file = componentFile(catalogDir, item);
  const state = loadState(catalogDir);
  const record = state.components[item.id];
  try {
    throwIfAborted(signal);
    const stat = outerFs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Catalog component must be a regular file');
    // A valid activated pack remains valid when a later app descriptor changes.
    // Rehash only after file facts change or when Repair explicitly requests it.
    if (!force && componentRecordMatchesFacts(record, stat, item)) {
      return { ...item, path: file, status: 'Installed', verifiedSize: record.size, verifiedSha512: record.sha512, verifiedMtimeMs: record.mtimeMs };
    }
    if (!force && record?.status === 'Installed' && record.filename === item.filename && validSha512(record.sha512)) {
      const digest = await hashFile(file, signal);
      throwIfAborted(signal);
      if (digest.toLowerCase() === record.sha512.toLowerCase()) {
        throwIfAborted(signal);
        state.components[item.id] = { ...record, status: 'Installed', size: stat.size, mtimeMs: stat.mtimeMs, sha512: digest, updatedAt: new Date().toISOString() };
        saveState(catalogDir, state);
        return { ...item, path: file, status: 'Installed', verifiedSize: stat.size, verifiedSha512: digest, verifiedMtimeMs: stat.mtimeMs };
      }
    }
    throwIfAborted(signal);
    const verified = await verifyComponent(file, item, { archiveInspector, signal });
    throwIfAborted(signal);
    // A successful local verification is authoritative. Repair explicitly
    // discards only this component's matching stale partial after the target
    // facts have been persisted.
    throwIfAborted(signal);
    const result = persistInstalledState(catalogDir, verified, file);
    throwIfAborted(signal);
    if (force) {
      throwIfAborted(signal);
      removeMatchingPartial(catalogDir, item, file);
    }
    return result;
  } catch (error) {
    if (error?.code === 'ABORT_ERR' || signal?.aborted) throw error?.code === 'ABORT_ERR' ? error : abortError();
    return { ...item, path: file, status: outerFs.existsSync(file) ? 'Damaged' : (record?.status === 'Downloading' ? 'Downloading' : 'Missing'), error: error instanceof Error ? error.message : String(error) };
  }
}

function responseStatus(response) { return Number(response?.status ?? response?.statusCode ?? 0); }
function responseBody(response) {
  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') return response.body;
  return null;
}
function responseHeader(response, name) {
  const headers = response?.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  return String(headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? '');
}
function parseContentRange(value) {
  const match = /^\s*bytes\s+(\d+)-(\d+)\/(\d+)\s*$/i.exec(String(value || ''));
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return null;
  return { start, end, total, length: end - start + 1 };
}
function releaseResponse(response) {
  const body = response?.body;
  for (const value of [response, body]) {
    try { if (typeof value?.destroy === 'function') value.destroy(); } catch { /* best effort */ }
    try { if (typeof value?.resume === 'function') value.resume(); } catch { /* best effort */ }
    try { if (typeof value?.cancel === 'function') void value.cancel(); } catch { /* best effort */ }
  }
  try {
    const iterator = body?.[Symbol.asyncIterator]?.();
    if (typeof iterator?.return === 'function') void Promise.resolve(iterator.return()).catch(() => {});
  } catch { /* best effort */ }
}
function abortError() { return Object.assign(new Error('Catalog component download cancelled'), { code: 'ABORT_ERR' }); }
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(); }
function readResponseChunk(iterator, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, abortError());
    if (signal?.aborted) { finish(reject, abortError()); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(reject, Object.assign(new Error('Catalog component response stalled'), { code: 'ETIMEDOUT' })), timeoutMs);
    Promise.resolve().then(() => iterator.next()).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
async function closeResponseIterator(iterator) {
  if (typeof iterator?.return !== 'function') return;
  try { await iterator.return(); } catch { /* closing is best effort */ }
}
async function responseBytes(response) {
  if (typeof response?.arrayBuffer === 'function') return Buffer.from(await response.arrayBuffer());
  if (Buffer.isBuffer(response?.body)) return response.body;
  if (typeof response?.body === 'string') return Buffer.from(response.body);
  throw new Error('Catalog component response has no body');
}

async function downloadComponent({ catalogDir, descriptor, request = fetch, signal, onProgress = () => {}, timeoutMs = 30_000, retries = 2, archiveInspector }) {
  const item = normalizeDescriptor(descriptor, descriptor?.id);
  const paths = mkdirs(componentPaths(catalogDir));
  const partial = partialFile(catalogDir, item);
  const target = componentFile(catalogDir, item);
  const priorState = loadState(catalogDir);
  const priorRecord = priorState.components[item.id];
  let preservedRecord = null;
  let targetPresent = false;
  try {
    const stat = outerFs.lstatSync(target);
    targetPresent = true;
    if (stat.isFile() && !stat.isSymbolicLink() && componentRecordMatchesFacts(priorRecord, stat, item)) preservedRecord = { ...priorRecord };
  } catch { /* a missing/unverified target has no state to preserve */ }
  const failureStatus = targetPresent ? 'Damaged' : 'Missing';
  const failureRecord = error => ({ status: failureStatus, filename: item.filename, error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
  const cancelledRecord = () => ({ status: failureStatus, filename: item.filename, error: 'Download cancelled', updatedAt: new Date().toISOString() });
  const cancelDownload = () => {
    const state = loadState(catalogDir);
    state.components[item.id] = preservedRecord || cancelledRecord();
    saveState(catalogDir, state);
    throw abortError();
  };
  const checkDownloadAbort = () => { if (signal?.aborted) cancelDownload(); };
  // Record a pre-aborted direct download as cancelled without touching an
  // existing partial; callers can retry that resumable file later.
  checkDownloadAbort();
  try { const stat = outerFs.lstatSync(partial); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Catalog component partial must be a regular file'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }

  const resetPartial = () => {
    try { outerFs.truncateSync(partial, 0); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
  const activateVerified = verified => activateVerifiedComponent(catalogDir, verified, { removePartial: true, signal });

  // A complete partial is a usable offline download. Verify it before making
  // any request so an exact Range at EOF cannot trigger an unnecessary 416.
  let partialSize = 0;
  checkDownloadAbort();
  try { partialSize = outerFs.statSync(partial).size; } catch { partialSize = 0; }
  checkDownloadAbort();
  if (partialSize > item.size) {
    checkDownloadAbort();
    resetPartial();
  }
  else if (partialSize === item.size && partialSize > 0) {
    try {
      checkDownloadAbort();
      const verified = await verifyComponent(partial, item, { signal, archiveInspector });
      checkDownloadAbort();
      onProgress({ id: item.id, phase: 'Verifying', completed: item.size, total: item.size, percent: 100, attempt: 0 });
      checkDownloadAbort();
      return activateVerified(verified);
    } catch (error) {
      if (error?.code === 'ABORT_ERR' || signal?.aborted) cancelDownload();
      // A complete but corrupt partial must never become the active target.
      checkDownloadAbort();
      resetPartial();
    }
  }
  checkDownloadAbort();
  const transferState = loadState(catalogDir);
  transferState.components[item.id] = { status: 'Downloading', filename: item.filename, updatedAt: new Date().toISOString() };
  checkDownloadAbort();
  saveState(catalogDir, transferState);
  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      const state = loadState(catalogDir);
      state.components[item.id] = preservedRecord || cancelledRecord();
      saveState(catalogDir, state);
      throw Object.assign(new Error('Catalog component download cancelled'), { code: 'ABORT_ERR' });
    }
    try {
      throwIfAborted(signal);
      let offset = 0;
      try { offset = outerFs.statSync(partial).size; } catch { offset = 0; }
      throwIfAborted(signal);
      if (offset > item.size) { throwIfAborted(signal); resetPartial(); offset = 0; }
      let freshRangeRetry = false;
      while (true) {
      checkDownloadAbort();
      const headers = offset ? { Range: `bytes=${offset}-` } : {};
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      let response;
      try { response = await request(item.url, { headers, signal: controller.signal }); }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      if (signal?.aborted) { releaseResponse(response); throw abortError(); }
      const statusCode = responseStatus(response);
      if (response?.url) {
        let finalUrl;
        try { finalUrl = new URL(String(response.url)); } catch { releaseResponse(response); throw new Error('Catalog component response URL is invalid'); }
        if (finalUrl.protocol !== 'https:' || !TRUSTED_REDIRECT_HOSTS.has(finalUrl.hostname)) { releaseResponse(response); throw new Error('Catalog component response host is not trusted'); }
      }
      throwIfAborted(signal);
      if (statusCode === 416) {
        // Some servers reject an EOF range even though the partial is already
        // complete. Verify/promote that file when possible; otherwise clear
        // the incomplete/corrupt partial and retry exactly once from zero.
        releaseResponse(response);
        throwIfAborted(signal);
        if (offset === item.size) {
          try {
            throwIfAborted(signal);
            const verified = await verifyComponent(partial, item, { signal, archiveInspector });
            throwIfAborted(signal);
            onProgress({ id: item.id, phase: 'Verifying', completed: item.size, total: item.size, percent: 100, attempt });
            throwIfAborted(signal);
            return activateVerified(verified);
          } catch (error) {
            if (error?.code === 'ABORT_ERR' || signal?.aborted) throw error?.code === 'ABORT_ERR' ? error : abortError();
            throwIfAborted(signal);
            resetPartial();
          }
        } else {
          throwIfAborted(signal);
          resetPartial();
        }
        if (offset > 0 && !freshRangeRetry) {
          throwIfAborted(signal);
          freshRangeRetry = true;
          offset = 0;
          continue;
        }
        throw new Error('Catalog component request failed: HTTP 416');
      }
      if (response?.ok === false || (statusCode && (statusCode < 200 || statusCode >= 300) && statusCode !== 206)) {
        releaseResponse(response);
        throw new Error(`Catalog component request failed: HTTP ${statusCode || 0}`);
      }
      const contentRange = statusCode === 206 ? parseContentRange(responseHeader(response, 'content-range')) : null;
      const contentLengthHeader = responseHeader(response, 'content-length');
      const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : null;
      if (statusCode === 206 && (!contentRange || contentRange.start !== offset || contentRange.total !== item.size || (contentLength !== null && contentLength !== contentRange.length))) {
        releaseResponse(response);
        throwIfAborted(signal);
        try { resetPartial(); } catch { /* retry path will report the failure */ }
        throw new Error('Catalog component resume Content-Range is invalid');
      }
      if (offset && responseStatus(response) !== 206) { throwIfAborted(signal); resetPartial(); offset = 0; }
      const body = responseBody(response);
      if (body) {
        const stream = outerFs.createWriteStream(partial, { flags: offset ? 'a' : 'w' });
        let received = offset;
        let iterator;
        let completed = false;
        try {
          iterator = body[Symbol.asyncIterator]();
          while (true) {
            const step = await readResponseChunk(iterator, signal, timeoutMs);
            if (step.done) break;
            const chunk = Buffer.from(step.value);
            received += chunk.length;
            if (received > item.size) throw new Error('Catalog component response exceeds descriptor size');
            await new Promise((resolve, reject) => {
              try { stream.write(chunk, error => error ? reject(error) : resolve()); }
              catch (error) { reject(error); }
            });
            onProgress({ id: item.id, phase: 'Downloading', completed: received, total: item.size, percent: Math.floor(received / item.size * 100), attempt });
          }
          throwIfAborted(signal);
          if (contentRange && received - offset !== contentRange.length) throw new Error('Catalog component response Content-Range length mismatch');
          await new Promise((resolve, reject) => {
            try { stream.end(error => error ? reject(error) : resolve()); }
            catch (error) { reject(error); }
          });
          throwIfAborted(signal);
          completed = true;
        } finally {
          if (!completed) {
            try { stream.destroy(); } catch { /* best effort */ }
            await closeResponseIterator(iterator);
          }
        }
      } else {
        const bytes = await responseBytes(response);
        throwIfAborted(signal);
        if (contentRange && bytes.length !== contentRange.length) {
          throwIfAborted(signal);
          try { resetPartial(); } catch { /* retry path will report the failure */ }
          throw new Error('Catalog component response Content-Range length mismatch');
        }
        throwIfAborted(signal);
        if (offset && responseStatus(response) === 206) outerFs.appendFileSync(partial, bytes); else outerFs.writeFileSync(partial, bytes);
        const completed = outerFs.statSync(partial).size;
        onProgress({ id: item.id, phase: 'Downloading', completed, total: item.size, percent: Math.floor(completed / item.size * 100), attempt });
        throwIfAborted(signal);
      }
      throwIfAborted(signal);
      const verified = await verifyComponent(partial, item, { signal, archiveInspector });
      throwIfAborted(signal);
      onProgress({ id: item.id, phase: 'Verifying', completed: item.size, total: item.size, percent: 100, attempt });
      throwIfAborted(signal);
      return activateVerified(verified);
      }
    } catch (error) {
      if (error?.code === 'ABORT_ERR' || signal?.aborted) {
        const state = loadState(catalogDir);
        state.components[item.id] = preservedRecord || cancelledRecord();
        saveState(catalogDir, state);
        throw error?.code === 'ABORT_ERR' ? error : abortError();
      }
      if (/(?:SHA-512|size mismatch|not a readable ASAR|expected root|version mismatch|count mismatch|Content-Range|exceeds descriptor size)/i.test(String(error?.message || ''))) {
        try { resetPartial(); } catch { /* next attempt starts from zero */ }
      }
      attempt += 1;
      if (attempt > retries) {
        const state = loadState(catalogDir);
        state.components[item.id] = preservedRecord || failureRecord(error);
        saveState(catalogDir, state);
        throw error;
      }
      onProgress({ id: item.id, phase: 'Retrying', completed: 0, total: item.size, percent: 0, attempt, message: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function ensureComponent({ catalogDir, descriptor, request = fetch, signal, onProgress = () => {}, timeoutMs = 30_000, retries = 2, repair = false, archiveInspector }) {
  const item = normalizeDescriptor(descriptor, descriptor?.id);
  throwIfAborted(signal);
  const current = await inspectComponent(catalogDir, item, { force: repair, archiveInspector, signal });
  throwIfAborted(signal);
  if (current.status === 'Installed') return current;
  onProgress({ id: item.id, phase: 'Checking', completed: 0, total: item.size, percent: 0 });
  throwIfAborted(signal);
  return downloadComponent({ catalogDir, descriptor: item, request, signal, onProgress, timeoutMs, retries, archiveInspector });
}

function readInstallerSelections(dataDir) {
  const result = { artists: true, guide: true, characters: false };
  try {
    const source = fs.readFileSync(path.join(dataDir, 'installer-options.ini'), 'utf8');
    let section = '';
    for (const line of source.split(/\r?\n/)) {
      const match = /^\s*\[([^\]]+)\]/.exec(line); if (match) { section = match[1].toLowerCase(); continue; }
      const pair = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line); if (!pair || section !== 'catalogs') continue;
      const value = /^(1|true|yes)$/i.test(pair[2]);
      if (/^(artists|v5|v5artists)$/i.test(pair[1])) result.artists = value;
      if (/^(characters|v45characters)$/i.test(pair[1])) result.characters = value;
      if (/^(guide|builder|constructor)$/i.test(pair[1])) result.guide = value;
    }
  } catch { /* fresh profiles use the contract defaults */ }
  return result;
}

async function ensureSelectedComponents({ catalogDir, dataDir, descriptors, request = fetch, signal, onProgress = () => {}, timeoutMs = 30_000, retries = 2, archiveInspector }) {
  const selected = readInstallerSelections(dataDir);
  const chosen = descriptors.filter(item => selected[item.id] !== false);
  const total = chosen.reduce((sum, item) => sum + item.size, 0);
  let completed = 0;
  const results = [];
  // A preserved 0.6.2 fat ASAR is only a per-component fallback. An installed
  // current component remains authoritative even while that archive exists.
  let migrated = null;
  try { migrated = validateLegacyArchive(componentPaths(catalogDir).legacyPack, { inspector: archiveInspector }); } catch { /* no valid migration */ }
  for (const descriptor of chosen) {
    onProgress({ id: descriptor.id, phase: 'Checking', completed, total, percent: total ? Math.floor(completed / total * 100) : 100 });
    throwIfAborted(signal);
    const current = await inspectComponent(catalogDir, descriptor, { archiveInspector, signal });
    throwIfAborted(signal);
    let result;
    if (current.status === 'Installed') result = current;
    else if (migrated) result = { ...descriptor, path: migrated.file, status: 'Migrated', verifiedSize: migrated.size };
    else result = await ensureComponent({ catalogDir, descriptor, request, signal, timeoutMs, retries, archiveInspector, onProgress: event => {
      const local = Math.max(0, Math.min(descriptor.size, Number(event.completed) || 0));
      onProgress({ ...event, completed: completed + local, total, percent: total ? Math.floor((completed + local) / total * 100) : 100 });
    } });
    results.push(result);
    completed += descriptor.size;
    throwIfAborted(signal);
    onProgress({ id: descriptor.id, phase: 'Opening', completed, total, percent: total ? Math.floor(completed / total * 100) : 100 });
  }
  return { selected, results, total, ...(migrated ? { migrated: true } : {}) };
}

function activateComponent(catalogDir, verified, { signal } = {}) {
  const item = normalizeDescriptor(verified, verified?.id);
  const source = verified.path || partialFile(catalogDir, item);
  const target = componentFile(catalogDir, item);
  const backup = `${target}.previous-${Date.now()}-${process.pid}`;
  let movedTarget = false;
  let movedSource = false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    throwIfAborted(signal);
    if (outerFs.existsSync(target)) {
      outerFs.renameSync(target, backup);
      movedTarget = true;
    }
    throwIfAborted(signal);
    outerFs.renameSync(source, target);
    movedSource = true;
    throwIfAborted(signal);
  } catch (error) {
    if (error?.code === 'ABORT_ERR' || signal?.aborted) {
      // A cancellation after either rename must restore both the old target
      // and the resumable source before surfacing ABORT_ERR.
      try {
        if (movedSource && outerFs.existsSync(target)) outerFs.renameSync(target, source);
        if (movedTarget && outerFs.existsSync(backup)) outerFs.renameSync(backup, target);
      } catch { /* preserve the original cancellation error */ }
    } else if (!outerFs.existsSync(target) && outerFs.existsSync(backup)) outerFs.renameSync(backup, target);
    throw error?.code === 'ABORT_ERR' ? error : (signal?.aborted ? abortError() : error);
  }
  // The verified target is now authoritative. Remove only this exact backup;
  // unrelated files in the component directory remain untouched.
  if (outerFs.existsSync(backup)) {
    try { outerFs.rmSync(backup, { force: true }); } catch (error) { throw new Error(`Catalog component backup cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { ...item, path: target, status: 'Installed' };
}

function resolveComponentAsset(catalogDir, relative, { allowLegacy = true } = {}) {
  let normalized;
  try { normalized = normalizeInnerPath(relative); } catch { throw new Error('Invalid runtime catalog asset'); }
  const match = normalized.startsWith('cards/artist/') ? COMPONENTS.artists
    : normalized.startsWith('cards/character/') ? COMPONENTS.characters
      : normalized.startsWith('guide/') ? COMPONENTS.guide : null;
  if (!match) throw new Error('Invalid runtime catalog asset');
  if (!normalized.startsWith(`${match.expectedRoot}/`)) throw new Error(`Catalog component ${match.id} asset is outside its expected root`);
  const paths = componentPaths(catalogDir);
  const installed = componentFile(catalogDir, match);
  let installedError = null;
  if (outerFs.existsSync(installed)) {
    const installedStat = outerFs.lstatSync(installed);
    const record = loadState(catalogDir).components[match.id];
    if (!installedStat.isFile() || installedStat.isSymbolicLink()) installedError = `Catalog component ${match.id} must be a regular file`;
    else if (!componentRecordMatchesFacts(record, installedStat, match)) installedError = `Catalog component ${match.id} is not verified`;
    else return `${installed}${path.sep}${normalized}`;
  }
  if (allowLegacy && outerFs.existsSync(paths.legacyPack)) {
    try {
      validateLegacyArchive(paths.legacyPack);
      return `${paths.legacyPack}${path.sep}dist${path.sep}catalog${path.sep}${normalized}`;
    } catch { /* invalid legacy is not a usable fallback */ }
  }
  throw new Error(installedError || `Catalog component ${match.id} is not installed`);
}

function validateLegacyArchive(file, { expectedRoots = ['dist/catalog/catalog.json', 'dist/catalog/cards/artist', 'dist/catalog/cards/character', 'dist/catalog/guide'], inspector } = {}) {
  if (!outerFs.existsSync(file) || !outerFs.lstatSync(file).isFile() || outerFs.lstatSync(file).isSymbolicLink()) throw new Error('Legacy catalog archive is missing');
  const stat = outerFs.statSync(file);
  const cacheKey = `${file}|${stat.size}|${stat.mtimeMs}|${expectedRoots.join('|')}`;
  if (legacyValidationCache.has(cacheKey)) return legacyValidationCache.get(cacheKey);
  const entries = inspector ? archiveEntries(file, { inspector }) : null;
  if (entries) {
    if (!entries.includes('dist/catalog/catalog.json')) throw new Error('Legacy archive does not contain dist/catalog/catalog.json');
    for (const root of expectedRoots.slice(1)) if (!entries.some(entry => entry === root || entry.startsWith(`${root}/`))) throw new Error(`Legacy archive is missing ${root}`);
  } else {
    let catalog;
    try { catalog = JSON.parse(readNativeArchiveFile(file, 'dist/catalog/catalog.json').toString('utf8')); } catch { throw new Error('Legacy archive does not contain dist/catalog/catalog.json'); }
    const probes = [
      catalog?.artists?.[0]?.image,
      catalog?.characters?.[0]?.image,
      'guide/manifest.json'
    ];
    if (!probes[0] || !probes[1]) throw new Error('Legacy archive catalog is missing representative card metadata');
    for (const probe of probes) {
      const inner = `dist/catalog/${normalizeInnerPath(probe)}`;
      try { readNativeArchiveFile(file, inner); } catch { throw new Error(`Legacy archive is missing ${inner}`); }
    }
    let guide;
    try { guide = JSON.parse(readNativeArchiveFile(file, 'dist/catalog/guide/manifest.json').toString('utf8')); } catch { throw new Error('Legacy archive guide manifest is missing'); }
    const guideEntries = Array.isArray(guide) ? guide : guide?.entries;
    const guideImage = guideEntries?.find(entry => typeof entry?.image === 'string')?.image;
    if (!guideImage) throw new Error('Legacy archive guide manifest has no image');
    try { readNativeArchiveFile(file, `dist/catalog/guide/${normalizeInnerPath(guideImage)}`); } catch { throw new Error('Legacy archive is missing a representative guide image'); }
  }
  const result = { file, status: 'Migrated', entries: entries || expectedRoots, size: stat.size, mtimeMs: stat.mtimeMs };
  legacyValidationCache.set(cacheKey, result);
  return result;
}

module.exports = {
  COMPONENT_VERSION, COMPONENTS, COMPONENT_IDS, STATE_VERSION, TRUSTED_REDIRECT_HOSTS,
  safeRelative, componentPaths, normalizeDescriptor, normalizeDescriptors,
  hashFile, normalizeInnerPath, readNativeArchiveFile, archiveEntries, validateArchiveShape, verifyComponent,
  loadState, saveState, componentFile, partialFile, statusForComponent, statuses, inspectComponent,
  downloadComponent, ensureComponent, readInstallerSelections, ensureSelectedComponents,
  activateComponent, resolveComponentAsset, validateLegacyArchive
};

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const MANIFEST_URL = 'https://github.com/shiza2xx/nai-prompt-studio/releases/latest/download/update-manifest.json';
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const DEFAULT_OPTIONS = Object.freeze({ connectTimeoutMs: 15_000, idleTimeoutMs: 15_000, maxAttempts: 3, maxRedirects: 5, maxManifestBytes: 1024 * 1024, retryDelayMs: 100 });

class UpdateAbortError extends Error {
  constructor(message = 'Update download cancelled.') { super(message); this.name = 'AbortError'; this.code = 'ABORT_ERR'; this.cancelled = true; }
}
function semver(value) { const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/); return match ? match.slice(1).map(Number) : null; }
function compareVersions(left, right) {
  const a = semver(left); const b = semver(right);
  if (!a || !b) throw new Error('Update manifest contains an invalid semantic version.');
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
function validateManifest(raw, currentVersion) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1) throw new Error('Unsupported update manifest schema.');
  const asset = String(raw.asset || ''); const url = new URL(String(raw.url || '')); const size = Number(raw.size); const sha512 = String(raw.sha512 || '').toLowerCase();
  if (!semver(raw.version)) throw new Error('Update manifest contains an invalid semantic version.');
  if (compareVersions(raw.version, currentVersion) <= 0) return { available: false, version: String(raw.version) };
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error('Update asset host is not trusted.');
  if (!/^NAI-Prompt-Studio-V5-Setup-\d+\.\d+\.\d+\.exe$/.test(asset) || path.basename(url.pathname) !== asset) throw new Error('Update installer asset name is invalid.');
  if (!Number.isSafeInteger(size) || size < 1024 || size > 2 * 1024 * 1024 * 1024) throw new Error('Update installer size is invalid.');
  if (!/^[a-f0-9]{128}$/.test(sha512)) throw new Error('Update installer SHA-512 is invalid.');
  return { available: true, schemaVersion: 1, version: String(raw.version), asset, url: url.toString(), size, sha512, releaseNotes: String(raw.releaseNotes || '') };
}
function trustedUrl(value) { const parsed = new URL(String(value)); if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) throw new Error('Update redirect host is not trusted.'); return parsed; }

function request(url, requestOptions = {}, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options }; const redirects = Number(requestOptions.redirects || 0);
  if (redirects > config.maxRedirects) return Promise.reject(new Error('Too many update redirects.'));
  let parsed; try { parsed = trustedUrl(url); } catch (error) { return Promise.reject(error); }
  const signal = requestOptions.signal;
  if (signal?.aborted) return Promise.reject(new UpdateAbortError());
  return new Promise((resolve, reject) => {
    let settled = false; let connectTimer; let req;
    const onAbort = () => { const error = new UpdateAbortError(); req?.destroy(error); finish(error); };
    const finish = (error, value) => { if (settled) return; settled = true; if (connectTimer) clearTimeout(connectTimer); signal?.removeEventListener('abort', onAbort); if (error) reject(error); else resolve(value); };
    req = https.get(parsed, { headers: { 'User-Agent': 'NAI-Prompt-Studio-Updater', Accept: 'application/octet-stream, application/json', ...(requestOptions.headers || {}) } }, response => {
      if (connectTimer) clearTimeout(connectTimer);
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        try { request(new URL(response.headers.location, parsed).toString(), { ...requestOptions, redirects: redirects + 1 }, config).then(value => finish(null, value), finish); } catch (error) { finish(error); }
        return;
      }
      if ((status < 200 || status >= 300) && status !== 416) { response.resume(); const error = new Error(`Update server returned HTTP ${status}.`); error.statusCode = status; finish(error); return; }
      finish(null, response);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    connectTimer = setTimeout(() => { const error = new Error('Update connection timed out.'); error.code = 'ETIMEDOUT'; req.destroy(error); finish(error); }, Math.max(1, Number(config.connectTimeoutMs)));
    req.once('error', error => finish(error));
  });
}
async function readResponseJson(response, maxBytes = DEFAULT_OPTIONS.maxManifestBytes, options = {}) {
  const chunks = []; let size = 0; let timer;
  const signal = options.signal;
  const idleTimeoutMs = Math.max(1, Number(options.idleTimeoutMs ?? DEFAULT_OPTIONS.idleTimeoutMs));
  const onAbort = () => response.destroy(new UpdateAbortError());
  const resetIdleTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const error = new Error('Update manifest response stalled while waiting for data.');
      error.code = 'ETIMEDOUT';
      response.destroy(error);
    }, idleTimeoutMs);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  resetIdleTimer();
  try {
    for await (const chunk of response) {
      if (signal?.aborted) throw new UpdateAbortError();
      resetIdleTimer();
      size += chunk.length;
      if (size > maxBytes) throw new Error('Update manifest is too large.');
      chunks.push(chunk);
    }
    if (response.aborted || response.readableAborted || response.complete === false) throw new Error('Update manifest response ended prematurely.');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    response.destroy?.();
  }
}
async function checkForUpdate(currentVersion, fetchJson, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const raw = fetchJson
    ? await fetchJson(MANIFEST_URL)
    : await readResponseJson(config.requestImpl ? await config.requestImpl(MANIFEST_URL, { signal: config.signal, headers: { Accept: 'application/json' } }) : await request(MANIFEST_URL, { signal: config.signal }, config), config.maxManifestBytes, config);
  return validateManifest(raw, currentVersion);
}
function emitProgress(onProgress, phase, completed, total, attempt, message) {
  if (typeof onProgress !== 'function') return;
  const boundedCompleted = Math.max(0, Math.min(Number(total) || 0, Number(completed) || 0));
  const payload = { phase, completed: boundedCompleted, total: Number(total) || 0, percent: Number(total) ? Math.round((boundedCompleted / Number(total)) * 100) : 0, attempt: Number(attempt) || 0 };
  if (message) payload.message = String(message); onProgress(payload);
}
function localSize(file) { try { return fs.statSync(file).size; } catch { return 0; } }
async function sha512File(file) { const hash = crypto.createHash('sha512'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
function removeFile(file) { try { fs.rmSync(file, { force: true }); } catch { /* best effort cleanup */ } }
function abortIfNeeded(signal) { if (signal?.aborted) throw new UpdateAbortError(); }
function parseContentRange(value) { const match = String(value || '').trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i); return match ? { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) } : null; }
async function sleep(ms, signal) {
  if (!ms) return;
  await new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new UpdateAbortError()); };
    timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function consumeResponse(response, partial, offset, total, attempt, options) {
  const signal = options.signal; const idleTimeoutMs = Math.max(1, Number(options.idleTimeoutMs)); const output = fs.createWriteStream(partial, { flags: offset > 0 ? 'a' : 'w' });
  let completed = offset; let timer; let ended = false; let timeoutError;
  const onAbort = () => response.destroy(new UpdateAbortError());
  signal?.addEventListener('abort', onAbort, { once: true });
  const resetIdleTimer = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timeoutError = new Error('Update download stalled while waiting for data.'); timeoutError.code = 'ETIMEDOUT'; response.destroy(timeoutError); }, idleTimeoutMs); };
  resetIdleTimer();
  try {
    for await (const chunk of response) {
      abortIfNeeded(signal); resetIdleTimer(); const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); completed += bytes.length;
      if (completed > total) throw new Error('Update response exceeded the manifest size.');
      await new Promise((resolve, reject) => { output.write(bytes, error => error ? reject(error) : resolve()); });
      emitProgress(options.onProgress, 'downloading', completed, total, attempt);
    }
    ended = true; if (timer) clearTimeout(timer); if (timeoutError) throw timeoutError;
    if (response.aborted || response.readableAborted || response.complete === false) throw new Error('Update response ended prematurely.');
    await new Promise((resolve, reject) => { output.end(error => error ? reject(error) : resolve()); }); return completed;
  } catch (error) {
    if (timer) clearTimeout(timer); response.destroy?.(); output.destroy(); if (error?.code === 'ABORT_ERR' || signal?.aborted) throw new UpdateAbortError(); throw error;
  } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onAbort); if (!ended && !output.destroyed) output.destroy(); }
}
async function promoteVerified(partial, target, manifest) {
  const size = localSize(partial); if (size !== manifest.size || (await sha512File(partial)).toLowerCase() !== manifest.sha512) { removeFile(partial); throw new Error('Downloaded update failed size or SHA-512 verification.'); }
  removeFile(target); fs.renameSync(partial, target); return target;
}
async function reuseVerifiedTarget(target, manifest, options) {
  if (!fs.existsSync(target)) return false; if (localSize(target) !== manifest.size) { removeFile(target); return false; }
  try { if ((await sha512File(target)).toLowerCase() === manifest.sha512) { emitProgress(options.onProgress, 'ready', manifest.size, manifest.size, 0, 'Verified update already downloaded.'); return true; } } catch { /* invalid target is replaced below */ }
  removeFile(target); return false;
}

async function downloadInstaller(manifest, updatesDir, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  if (options.responseTimeoutMs != null) config.connectTimeoutMs = options.responseTimeoutMs;
  if (options.dataIdleTimeoutMs != null) config.idleTimeoutMs = options.dataIdleTimeoutMs;
  if (options.maxRetries != null) config.maxAttempts = Number(options.maxRetries) + 1;
  if (!manifest || manifest.available === false) throw new Error('An available update manifest is required.');
  if (!Number.isSafeInteger(manifest.size) || !/^[a-f0-9]{128}$/i.test(String(manifest.sha512 || ''))) throw new Error('Update manifest is invalid.');
  fs.mkdirSync(updatesDir, { recursive: true }); const target = path.join(updatesDir, manifest.asset); const partial = `${target}.partial`;
  if (await reuseVerifiedTarget(target, manifest, config)) return target;
  if (localSize(partial) > manifest.size) removeFile(partial); emitProgress(config.onProgress, 'starting', localSize(partial), manifest.size, 0);
  const requestImpl = config.requestImpl || config.request || ((url, requestOptions) => request(url, requestOptions, config)); const maxAttempts = Math.max(1, Math.floor(Number(config.maxAttempts)) || 1); let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    abortIfNeeded(config.signal); let offset = localSize(partial);
    if (offset === manifest.size && !config.forceRangeRequest) {
      try { const ready = await promoteVerified(partial, target, manifest); emitProgress(config.onProgress, 'ready', manifest.size, manifest.size, attempt); return ready; }
      catch (error) { lastError = error; offset = localSize(partial); }
    }
    try {
      const response = await requestImpl(manifest.url, { signal: config.signal, headers: offset ? { Range: `bytes=${offset}-` } : {} }); const status = Number(response.statusCode || 0);
      if (status === 416) { response.resume?.(); if (offset !== manifest.size) { removeFile(partial); throw new Error('Update server rejected an incomplete resume range.'); } const ready = await promoteVerified(partial, target, manifest); emitProgress(config.onProgress, 'ready', manifest.size, manifest.size, attempt); return ready; }
      let start = offset;
      if (status === 206) {
        const range = parseContentRange(response.headers?.['content-range'] || response.headers?.['Content-Range']); const contentLength = Number(response.headers?.['content-length'] || response.headers?.['Content-Length']);
        if (!range || range.start !== offset || range.total !== manifest.size || range.end < range.start || (Number.isFinite(contentLength) && contentLength !== range.end - range.start + 1)) { response.destroy?.(); removeFile(partial); throw new Error('Update response contained an invalid Content-Range header.'); }
        emitProgress(config.onProgress, 'downloading', offset, manifest.size, attempt);
      } else if (status === 200) { if (offset) { removeFile(partial); offset = 0; } start = 0; }
      else { response.resume?.(); const error = new Error(`Update server returned HTTP ${status}.`); error.statusCode = status; throw error; }
      if (status === 200) emitProgress(config.onProgress, 'downloading', start, manifest.size, attempt);
      await consumeResponse(response, partial, start, manifest.size, attempt, config); const completed = localSize(partial);
      if (completed !== manifest.size) throw new Error('Update response ended before the manifest size was reached.');
      emitProgress(config.onProgress, 'verifying', completed, manifest.size, attempt);
      const ready = await promoteVerified(partial, target, manifest); emitProgress(config.onProgress, 'ready', manifest.size, manifest.size, attempt); return ready;
    } catch (error) {
      lastError = error; if (error?.code === 'ABORT_ERR' || config.signal?.aborted) { emitProgress(config.onProgress, 'paused', localSize(partial), manifest.size, attempt, 'Download cancelled.'); throw new UpdateAbortError(); }
      const protocolError = /Content-Range|exceeded the manifest size|response length|failed size|SHA-512|rejected an incomplete/i.test(String(error?.message || '')); if (protocolError) removeFile(partial);
      if (attempt < maxAttempts) {
        emitProgress(config.onProgress, 'retrying', localSize(partial), manifest.size, attempt, error?.message);
        try { await sleep(Number(config.retryDelayMs), config.signal); } catch (sleepError) { if (sleepError?.code === 'ABORT_ERR' || config.signal?.aborted) { emitProgress(config.onProgress, 'paused', localSize(partial), manifest.size, attempt, 'Download cancelled.'); throw new UpdateAbortError(); } throw sleepError; }
        continue;
      }
      emitProgress(config.onProgress, 'error', localSize(partial), manifest.size, attempt, error?.message); throw lastError;
    }
  }
  throw lastError || new Error('Update download failed.');
}

module.exports = { MANIFEST_URL, ALLOWED_HOSTS, DEFAULT_OPTIONS, UpdateAbortError, compareVersions, validateManifest, request, readResponseJson, checkForUpdate, downloadInstaller, parseContentRange };

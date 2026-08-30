import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const nativeFs = require('node:fs');
const { createPackage, createPackageFromFiles, extractFile, listPackage } = require('@electron/asar');
const { COMPONENTS, componentFile, partialFile, componentPaths, normalizeDescriptor, verifyComponent, loadState, saveState, activateComponent, resolveComponentAsset, ensureComponent, ensureSelectedComponents, validateLegacyArchive, downloadComponent, inspectComponent, statusForComponent, statuses, safeRelative } = require('../../electron/catalog-components.cjs');
const testTempRoot = join(process.cwd(), '.test-tmp-v063', 'components-' + process.pid);
mkdirSync(testTempRoot, { recursive: true });
const localTemp = prefix => mkdtempSync(join(testTempRoot, prefix + '-'));
process.once('exit', () => { try { rmSync(testTempRoot, { recursive: true, force: true }); } catch {} });
// v0.6.3 thin component contracts. Fixtures stay under the workspace and use
// an injected development inspector; packaged runtime uses native Electron fs.
const componentInspector = { list: file => listPackage(file), read: (file, entry) => extractFile(file, entry) };
async function awaitAsar(streamPromise) {
  const stream = await streamPromise;
  if (!stream?.writableFinished) await once(stream, 'finish');
  if (stream?.path && !existsSync(stream.path)) await once(stream, 'close');
}
async function componentFixture(id, inner, payload = 'fixture') {
  const root = localTemp(`component-source-${id}`);
  const innerFile = join(root, ...inner.split('/'));
  mkdirSync(join(innerFile, '..'), { recursive: true });
  writeFileSync(innerFile, payload);
  const metadata = { id, version: '0.6.3', expectedRoot: COMPONENTS[id].expectedRoot, count: COMPONENTS[id].count };
  writeFileSync(join(root, 'catalog-component.json'), `${JSON.stringify(metadata)}\n`);
  const archive = join(localTemp(`component-archive-${id}`), COMPONENTS[id].filename);
  await awaitAsar(createPackage(root, archive));
  const bytes = readFileSync(archive);
  return { archive, descriptor: normalizeDescriptor({ ...COMPONENTS[id], size: bytes.length, sha512: createHash('sha512').update(bytes).digest('hex') }), root };
}
const artistComponent = await componentFixture('artists', 'cards/artist/danbooru-artist-tags-2-v5/fixture.webp', 'RIFFxxxxWEBP');
assert.equal((await verifyComponent(artistComponent.archive, artistComponent.descriptor, { archiveInspector: componentInspector })).status, 'Installed');
const { url: _artistUrl, ...artistDescriptorWithoutUrl } = artistComponent.descriptor;
assert.throws(() => normalizeDescriptor({ ...artistDescriptorWithoutUrl, trustedUrl: 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.6.3/other.asar' }), /URL is not trusted/i);
// createPackageFromFiles resolves source filenames itself; the production pack
// builder must provide absolute inputs so nested archive paths are retained.
const directPackSource = localTemp('direct-pack-source');
mkdirSync(join(directPackSource, 'cards/artist/example'), { recursive: true });
writeFileSync(join(directPackSource, 'cards/artist/example/fixture.webp'), 'RIFFxxxxWEBP');
writeFileSync(join(directPackSource, 'catalog.json'), '{}');
const directPack = join(localTemp('direct-pack-output'), 'direct.asar');
await awaitAsar(createPackageFromFiles(directPackSource, directPack, [join(directPackSource, 'cards/artist/example/fixture.webp'), join(directPackSource, 'catalog.json')]));
assert.ok(listPackage(directPack).some(entry => String(entry).replace(/\\/g, '/') === '/cards/artist/example/fixture.webp'));
assert.throws(() => safeRelative(localTemp('component-path'), '../escape'), /escaped/i);
assert.throws(() => resolveComponentAsset(localTemp('component-path'), '../escape'), /invalid runtime catalog asset/i);

const componentProfile = localTemp('component-profile');
const componentStatePaths = componentPaths(join(componentProfile, 'catalog'));
mkdirSync(componentProfile, { recursive: true });
const componentBytes = readFileSync(artistComponent.archive);
const activated = activateComponent(join(componentProfile, 'catalog'), await verifyComponent(artistComponent.archive, artistComponent.descriptor, { archiveInspector: componentInspector }));
const activatedStat = statSync(activated.path);
const componentState = loadState(join(componentProfile, 'catalog'));
componentState.components.artists = { status: 'Installed', filename: artistComponent.descriptor.filename, size: activatedStat.size, sha512: artistComponent.descriptor.sha512, mtimeMs: activatedStat.mtimeMs, version: '0.6.3', expectedRoot: 'cards/artist', count: 4198 };
saveState(join(componentProfile, 'catalog'), componentState);
assert.match(resolveComponentAsset(join(componentProfile, 'catalog'), 'cards/artist/danbooru-artist-tags-2-v5/fixture.webp'), /nai-v5-artists\.asar/);
const changedDescriptor = normalizeDescriptor({ ...artistComponent.descriptor, size: artistComponent.descriptor.size + 1, sha512: 'b'.repeat(128) });
assert.equal((await inspectComponent(join(componentProfile, 'catalog'), changedDescriptor)).status, 'Installed');
let futureDescriptorRequest = false;
const futureDescriptorResult = await ensureComponent({ catalogDir: join(componentProfile, 'catalog'), descriptor: changedDescriptor, request: async () => { futureDescriptorRequest = true; throw new Error('future descriptor must not auto-download'); }, retries: 0, archiveInspector: componentInspector });
assert.equal(futureDescriptorResult.status, 'Installed');
assert.equal(futureDescriptorRequest, false);
await assert.rejects(downloadComponent({ catalogDir: join(componentProfile, 'catalog'), descriptor: changedDescriptor, request: async () => ({ status: 200, ok: true, body: componentBytes }), retries: 0, archiveInspector: componentInspector }), /size mismatch/i);
assert.equal(loadState(join(componentProfile, 'catalog')).components.artists.status, 'Installed');
assert.equal(resolveComponentAsset(join(componentProfile, 'catalog'), 'cards/artist/danbooru-artist-tags-2-v5/fixture.webp').endsWith('fixture.webp'), true);
assert.equal(readFileSync(activated.path).equals(componentBytes), true);
const oldBytes = readFileSync(activated.path);
assert.throws(() => activateComponent(join(componentProfile, 'catalog'), { ...artistComponent.descriptor, path: join(componentProfile, 'missing.partial') }));
assert.equal(readFileSync(activated.path).equals(oldBytes), true);
assert.equal(readdirSync(componentStatePaths.components).some(name => name.includes('.previous-')), false);

// Component targets must reject symlinks before runtime resolution; retain a
// deterministic skip only for hosts where creating a test symlink is denied.
const symlinkComponentProfile = localTemp('component-symlink');
const symlinkComponentCatalog = join(symlinkComponentProfile, 'catalog');
const symlinkComponentPaths = componentPaths(symlinkComponentCatalog);
mkdirSync(symlinkComponentPaths.components, { recursive: true });
const symlinkOutside = join(symlinkComponentProfile, 'outside.asar');
writeFileSync(symlinkOutside, componentBytes);
let componentSymlinkCheckSkipped = false;
try {
  symlinkSync(symlinkOutside, componentFile(symlinkComponentCatalog, artistComponent.descriptor), 'file');
  assert.equal(statusForComponent(symlinkComponentCatalog, artistComponent.descriptor).status, 'Damaged');
  assert.throws(() => resolveComponentAsset(symlinkComponentCatalog, 'cards/artist/danbooru-artist-tags-2-v5/fixture.webp'), /regular file|symbolic/i);
} catch (error) {
  if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'UNKNOWN') componentSymlinkCheckSkipped = true;
  else throw error;
}
assert.equal(typeof componentSymlinkCheckSkipped, 'boolean');

// A stale Installed record without its target must not be reported as
// Installed; status consumers need a real Missing state to offer recovery.
const missingStatusProfile = localTemp('component-missing-status');
const missingStatusCatalog = join(missingStatusProfile, 'catalog');
const missingStatusState = loadState(missingStatusCatalog);
missingStatusState.components.artists = {
  status: 'Installed',
  filename: artistComponent.descriptor.filename,
  size: artistComponent.descriptor.size,
  sha512: artistComponent.descriptor.sha512,
  mtimeMs: 1,
  version: '0.6.3',
  expectedRoot: 'cards/artist',
  count: 4198
};
saveState(missingStatusCatalog, missingStatusState);
assert.equal(statusForComponent(missingStatusCatalog, artistComponent.descriptor).status, 'Missing');

const downloadProfile = localTemp('component-download');
const partial = join(componentPaths(join(downloadProfile, 'catalog')).downloads, artistComponent.descriptor.filename + '.partial');
mkdirSync(join(downloadProfile, 'catalog'), { recursive: true });
const archiveBytes = componentBytes;
const split = Math.floor(archiveBytes.length / 3);
mkdirSync(componentPaths(join(downloadProfile, 'catalog')).downloads, { recursive: true });
writeFileSync(partial, archiveBytes.subarray(0, split));
const ranges = [];
await downloadComponent({ catalogDir: join(downloadProfile, 'catalog'), descriptor: artistComponent.descriptor, request: async (_url, request) => { ranges.push(request.headers.Range || ''); return { status: 206, ok: true, headers: { 'content-range': `bytes ${split}-${archiveBytes.length - 1}/${archiveBytes.length}`, 'content-length': archiveBytes.length - split }, body: archiveBytes.subarray(split) }; }, retries: 0, archiveInspector: componentInspector });
assert.deepEqual(ranges, [`bytes=${split}-`]);
assert.equal(loadState(join(downloadProfile, 'catalog')).components.artists.size, archiveBytes.length);

// A complete valid partial is promoted locally without an HTTP request.
const completePartialProfile = localTemp('component-complete-partial');
const completePartialCatalog = join(completePartialProfile, 'catalog');
const completePartialPath = join(componentPaths(completePartialCatalog).downloads, artistComponent.descriptor.filename + '.partial');
mkdirSync(componentPaths(completePartialCatalog).downloads, { recursive: true });
writeFileSync(completePartialPath, archiveBytes);
let completePartialRequests = 0;
const completePartialResult = await downloadComponent({ catalogDir: completePartialCatalog, descriptor: artistComponent.descriptor, request: async () => { completePartialRequests += 1; throw new Error('complete partial must not request'); }, retries: 0, archiveInspector: componentInspector });
assert.equal(completePartialResult.status, 'Installed');
assert.equal(completePartialRequests, 0);
assert.equal(existsSync(completePartialPath), false);

// Cancellation is checked before exact-partial verification, so an already
// aborted repair cannot promote or remove the resumable partial.
const preabortedCompleteProfile = localTemp('component-preaborted-complete');
const preabortedCompleteCatalog = join(preabortedCompleteProfile, 'catalog');
const preabortedCompletePartial = partialFile(preabortedCompleteCatalog, artistComponent.descriptor);
mkdirSync(componentPaths(preabortedCompleteCatalog).downloads, { recursive: true });
writeFileSync(preabortedCompletePartial, archiveBytes);
const preabortedCompleteController = new AbortController();
preabortedCompleteController.abort();
await assert.rejects(downloadComponent({ catalogDir: preabortedCompleteCatalog, descriptor: artistComponent.descriptor, signal: preabortedCompleteController.signal, request: async () => { throw new Error('pre-aborted exact partial must not request'); }, retries: 0, archiveInspector: componentInspector }), error => error?.code === 'ABORT_ERR');
assert.equal(existsSync(componentFile(preabortedCompleteCatalog, artistComponent.descriptor)), false);
assert.equal(readFileSync(preabortedCompletePartial).equals(archiveBytes), true);

// A buffered response can complete its write before the caller cancellation
// callback runs; the guard after progress must leave it resumable, not active.
const bufferedAbortProfile = localTemp('component-buffered-abort');
const bufferedAbortCatalog = join(bufferedAbortProfile, 'catalog');
const bufferedAbortController = new AbortController();
let bufferedAbortProgress = false;
await assert.rejects(downloadComponent({ catalogDir: bufferedAbortCatalog, descriptor: artistComponent.descriptor, signal: bufferedAbortController.signal, request: async () => ({ status: 200, ok: true, body: archiveBytes }), onProgress: event => { if (event.phase === 'Downloading') { bufferedAbortProgress = true; bufferedAbortController.abort(); } }, retries: 0, archiveInspector: componentInspector }), error => error?.code === 'ABORT_ERR');
assert.equal(bufferedAbortProgress, true);
assert.equal(existsSync(componentFile(bufferedAbortCatalog, artistComponent.descriptor)), false);
assert.equal(readFileSync(partialFile(bufferedAbortCatalog, artistComponent.descriptor)).equals(archiveBytes), true);

// Cancellation at the verifying checkpoint is also before activation/state
// commit, while the complete partial remains available for a later retry.
const verifyingAbortProfile = localTemp('component-verifying-abort');
const verifyingAbortCatalog = join(verifyingAbortProfile, 'catalog');
const verifyingAbortController = new AbortController();
await assert.rejects(downloadComponent({ catalogDir: verifyingAbortCatalog, descriptor: artistComponent.descriptor, signal: verifyingAbortController.signal, request: async () => ({ status: 200, ok: true, body: archiveBytes }), onProgress: event => { if (event.phase === 'Verifying') verifyingAbortController.abort(); }, retries: 0, archiveInspector: componentInspector }), error => error?.code === 'ABORT_ERR');
assert.equal(existsSync(componentFile(verifyingAbortCatalog, artistComponent.descriptor)), false);
assert.equal(readFileSync(partialFile(verifyingAbortCatalog, artistComponent.descriptor)).equals(archiveBytes), true);

// Repair rehashes a valid target and persists true facts without touching the
// network, removing only the matching stale partial.
const repairProfile = localTemp('component-repair');
const repairCatalog = join(repairProfile, 'catalog');
const repairSource = join(repairProfile, artistComponent.descriptor.filename);
writeFileSync(repairSource, archiveBytes);
const repairActivated = activateComponent(repairCatalog, await verifyComponent(repairSource, artistComponent.descriptor, { archiveInspector: componentInspector }));
const repairStat = statSync(repairActivated.path);
const repairState = loadState(repairCatalog);
repairState.components.artists = { status: 'Installed', filename: artistComponent.descriptor.filename, size: repairStat.size, sha512: artistComponent.descriptor.sha512, mtimeMs: 1, version: '0.6.3', expectedRoot: 'cards/artist', count: 4198 };
saveState(repairCatalog, repairState);
const repairPartial = partialFile(repairCatalog, artistComponent.descriptor);
writeFileSync(repairPartial, Buffer.from('stale partial'));
let repairRequests = 0;
const repaired = await ensureComponent({ catalogDir: repairCatalog, descriptor: artistComponent.descriptor, repair: true, request: async () => { repairRequests += 1; throw new Error('repair must be local'); }, retries: 0, archiveInspector: componentInspector });
assert.equal(repaired.status, 'Installed');
assert.equal(repairRequests, 0);
assert.equal(existsSync(repairPartial), false);
const repairedRecord = loadState(repairCatalog).components.artists;
assert.equal(repairedRecord.size, repairStat.size);
assert.equal(repairedRecord.sha512, artistComponent.descriptor.sha512);
assert.equal(repairedRecord.mtimeMs, statSync(repairActivated.path).mtimeMs);

// Repair also observes cancellation raised during local archive inspection;
// the valid target and unrelated partial are left untouched.
const repairAbortProfile = localTemp('component-repair-abort');
const repairAbortCatalog = join(repairAbortProfile, 'catalog');
const repairAbortSource = join(repairAbortProfile, artistComponent.descriptor.filename);
writeFileSync(repairAbortSource, archiveBytes);
const repairAbortActivated = activateComponent(repairAbortCatalog, await verifyComponent(repairAbortSource, artistComponent.descriptor, { archiveInspector: componentInspector }));
const repairAbortState = loadState(repairAbortCatalog);
repairAbortState.components.artists = { status: 'Installed', filename: artistComponent.descriptor.filename, size: archiveBytes.length, sha512: artistComponent.descriptor.sha512, mtimeMs: 1, version: '0.6.3', expectedRoot: 'cards/artist', count: 4198 };
saveState(repairAbortCatalog, repairAbortState);
const repairAbortPartial = partialFile(repairAbortCatalog, artistComponent.descriptor);
const repairAbortPartialBytes = Buffer.from('repair partial remains');
writeFileSync(repairAbortPartial, repairAbortPartialBytes);
const preabortedRepairController = new AbortController();
preabortedRepairController.abort();
await assert.rejects(ensureComponent({ catalogDir: repairAbortCatalog, descriptor: artistComponent.descriptor, signal: preabortedRepairController.signal, repair: true, request: async () => { throw new Error('pre-aborted repair must not request'); }, retries: 0, archiveInspector: componentInspector }), error => error?.code === 'ABORT_ERR');
assert.equal(existsSync(componentFile(repairAbortCatalog, artistComponent.descriptor)), true);
assert.equal(readFileSync(repairAbortPartial).equals(repairAbortPartialBytes), true);
assert.equal(loadState(repairAbortCatalog).components.artists.mtimeMs, 1);
const repairAbortController = new AbortController();
const abortingInspector = { list: file => { repairAbortController.abort(); return listPackage(file); }, read: componentInspector.read };
await assert.rejects(ensureComponent({ catalogDir: repairAbortCatalog, descriptor: artistComponent.descriptor, signal: repairAbortController.signal, repair: true, request: async () => { throw new Error('cancelled repair must not request'); }, retries: 0, archiveInspector: abortingInspector }), error => error?.code === 'ABORT_ERR');
assert.equal(existsSync(componentFile(repairAbortCatalog, artistComponent.descriptor)), true);
assert.equal(readFileSync(repairAbortPartial).equals(repairAbortPartialBytes), true);
assert.equal(loadState(repairAbortCatalog).components.artists.mtimeMs, 1);

// A corrupt complete partial is discarded and replaced by a fresh response.
const corruptCompleteProfile = localTemp('component-corrupt-complete');
const corruptCompleteCatalog = join(corruptCompleteProfile, 'catalog');
const corruptCompletePath = partialFile(corruptCompleteCatalog, artistComponent.descriptor);
mkdirSync(componentPaths(corruptCompleteCatalog).downloads, { recursive: true });
writeFileSync(corruptCompletePath, Buffer.alloc(archiveBytes.length, 0x63));
const corruptCompleteRanges = [];
await downloadComponent({ catalogDir: corruptCompleteCatalog, descriptor: artistComponent.descriptor, request: async (_url, request) => { corruptCompleteRanges.push(request.headers.Range || ''); return { status: 200, ok: true, body: archiveBytes }; }, retries: 0, archiveInspector: componentInspector });
assert.deepEqual(corruptCompleteRanges, ['']);

// A server-side 416 for an incomplete range gets one fresh, zero-offset
// request even when the configured retry budget is zero.
const incomplete416Profile = localTemp('component-incomplete-416');
const incomplete416Catalog = join(incomplete416Profile, 'catalog');
const incomplete416Partial = partialFile(incomplete416Catalog, artistComponent.descriptor);
mkdirSync(componentPaths(incomplete416Catalog).downloads, { recursive: true });
writeFileSync(incomplete416Partial, archiveBytes.subarray(0, split));
const incomplete416Ranges = [];
await downloadComponent({ catalogDir: incomplete416Catalog, descriptor: artistComponent.descriptor, request: async (_url, request) => {
  incomplete416Ranges.push(request.headers.Range || '');
  if (incomplete416Ranges.length === 1) return { status: 416, ok: false, body: Buffer.alloc(0) };
  return { status: 200, ok: true, body: archiveBytes };
}, retries: 0, archiveInspector: componentInspector });
assert.deepEqual(incomplete416Ranges, [`bytes=${split}-`, '']);

// A cancellation raised while releasing a 416 response must be observed
// before the reset/fresh request, preserving the resumable prefix.
const abort416Profile = localTemp('component-abort-416');
const abort416Catalog = join(abort416Profile, 'catalog');
const abort416Partial = partialFile(abort416Catalog, artistComponent.descriptor);
mkdirSync(componentPaths(abort416Catalog).downloads, { recursive: true });
writeFileSync(abort416Partial, archiveBytes.subarray(0, split));
const abort416Controller = new AbortController();
let abort416Requests = 0;
await assert.rejects(downloadComponent({ catalogDir: abort416Catalog, descriptor: artistComponent.descriptor, signal: abort416Controller.signal, request: async () => {
  abort416Requests += 1;
  return { status: 416, ok: false, body: Buffer.alloc(0), destroy: () => abort416Controller.abort() };
}, retries: 0, archiveInspector: componentInspector }), error => error?.code === 'ABORT_ERR');
assert.equal(abort416Requests, 1);
assert.equal(existsSync(componentFile(abort416Catalog, artistComponent.descriptor)), false);
assert.equal(readFileSync(abort416Partial).equals(archiveBytes.subarray(0, split)), true);


// A resumed 206 response without a matching Content-Range must fail before
// appending. Otherwise a server can return an unrelated payload that happens
// to complete the partial file and activate corrupt bytes.
const invalidResumeProfile = localTemp('component-invalid-resume');
const invalidResumeCatalog = join(invalidResumeProfile, 'catalog');
const invalidResumePaths = componentPaths(invalidResumeCatalog);
mkdirSync(invalidResumePaths.downloads, { recursive: true });
const invalidResumeSplit = Math.floor(archiveBytes.length / 3);
writeFileSync(join(invalidResumePaths.downloads, `${artistComponent.descriptor.filename}.partial`), archiveBytes.subarray(0, invalidResumeSplit));
await assert.rejects(downloadComponent({
  catalogDir: invalidResumeCatalog,
  descriptor: artistComponent.descriptor,
  request: async () => ({ status: 206, ok: true, body: archiveBytes.subarray(invalidResumeSplit) }),
  retries: 0,
  archiveInspector: componentInspector
}), /content-range|resume/i);
assert.equal(existsSync(componentFile(invalidResumeCatalog, artistComponent.descriptor)), false);

// Non-success responses must release their response stream before the retry
// path surfaces the HTTP error; leaving an IncomingMessage untouched leaks a
// socket on every failed component transfer.
const responseFailureProfile = localTemp('component-response-failure');
let responseFailureDestroyed = false;
let responseFailureResumed = false;
const responseFailureBody = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: () => Promise.resolve({ done: true }) }) };
await assert.rejects(downloadComponent({
  catalogDir: join(responseFailureProfile, 'catalog'),
  descriptor: artistComponent.descriptor,
  request: async () => ({ status: 503, ok: false, body: responseFailureBody, destroy: () => { responseFailureDestroyed = true; }, resume: () => { responseFailureResumed = true; } }),
  retries: 0,
  archiveInspector: componentInspector
}), /HTTP 503/i);
assert.equal(responseFailureDestroyed || responseFailureResumed, true);

// A stalled streamed body must be closed after the timeout; retaining a
// pending iterator leaves an open source/write path and permits late writes.
const stalledStreamProfile = localTemp('component-stalled-stream');
let stalledNextCalls = 0;
let stalledReturnCalls = 0;
const stalledBody = {
  [Symbol.asyncIterator]() {
    return {
      next() {
        stalledNextCalls += 1;
        if (stalledNextCalls === 1) return Promise.resolve({ done: false, value: Buffer.from('partial') });
        return new Promise(() => {});
      },
      return() {
        stalledReturnCalls += 1;
        return Promise.resolve({ done: true });
      }
    };
  }
};
await assert.rejects(downloadComponent({
  catalogDir: join(stalledStreamProfile, 'catalog'),
  descriptor: artistComponent.descriptor,
  request: async () => ({ status: 200, ok: true, body: stalledBody }),
  timeoutMs: 5,
  retries: 0,
  archiveInspector: componentInspector
}), /stalled/i);
assert.equal(stalledReturnCalls, 1);

// Cancellation while the iterator is waiting for its next chunk must reject
// promptly rather than waiting for the idle timeout and must close the body.
const abortStreamProfile = localTemp('component-abort-stream');
const abortStreamController = new AbortController();
let abortStreamNextCalls = 0;
let abortStreamReturnCalls = 0;
const abortStreamBody = {
  [Symbol.asyncIterator]() {
    return {
      next() {
        abortStreamNextCalls += 1;
        if (abortStreamNextCalls === 1) return Promise.resolve({ done: false, value: Buffer.from('partial') });
        return new Promise(() => {});
      },
      return() {
        abortStreamReturnCalls += 1;
        return Promise.resolve({ done: true });
      }
    };
  }
};
await assert.rejects(downloadComponent({
  catalogDir: join(abortStreamProfile, 'catalog'),
  descriptor: artistComponent.descriptor,
  signal: abortStreamController.signal,
  request: async () => ({ status: 200, ok: true, body: abortStreamBody }),
  onProgress: event => { if (event.completed > 0) abortStreamController.abort(); },
  timeoutMs: 20,
  retries: 0,
  archiveInspector: componentInspector
}), error => error?.code === 'ABORT_ERR');
assert.equal(abortStreamReturnCalls, 1);

// A write callback failure must destroy the stream before surfacing the
// failure, otherwise each retry can retain a live handle to the partial file.
const writeFailureProfile = localTemp('component-write-failure');
const originalCreateWriteStream = nativeFs.createWriteStream;
let failedWriter;
nativeFs.createWriteStream = () => {
  failedWriter = {
    destroyed: false,
    write(_chunk, callback) { callback(new Error('fixture write failed')); },
    destroy() { this.destroyed = true; },
    end(callback) { callback?.(); }
  };
  return failedWriter;
};
try {
  await assert.rejects(downloadComponent({
    catalogDir: join(writeFailureProfile, 'catalog'),
    descriptor: artistComponent.descriptor,
    request: async () => ({ status: 200, ok: true, body: { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: false, value: Buffer.from('partial') }), return: () => Promise.resolve({ done: true }) }) } }),
    retries: 0,
    archiveInspector: componentInspector
  }), /fixture write failed/i);
  assert.equal(failedWriter.destroyed, true);
} finally {
  nativeFs.createWriteStream = originalCreateWriteStream;
}

const cancelProfile = localTemp('component-cancel');
const componentCancelController = new AbortController();
componentCancelController.abort();
await assert.rejects(downloadComponent({ catalogDir: join(cancelProfile, 'catalog'), descriptor: artistComponent.descriptor, signal: componentCancelController.signal, request: async () => { throw new Error('request must not start'); }, retries: 0, archiveInspector: componentInspector }), error => error?.code === 'ABORT_ERR');
assert.equal(loadState(join(cancelProfile, 'catalog')).components.artists.status, 'Missing');
const failedDownloadProfile = localTemp('component-failed-download');
await assert.rejects(downloadComponent({ catalogDir: join(failedDownloadProfile, 'catalog'), descriptor: artistComponent.descriptor, request: async () => ({ status: 200, ok: true, body: Buffer.from('not-an-asar') }), retries: 0, archiveInspector: componentInspector }), /size mismatch|SHA-512/i);
assert.equal(loadState(join(failedDownloadProfile, 'catalog')).components.artists.status, 'Missing');
const corruptDownloadProfile = localTemp('component-corrupt-download');
await assert.rejects(downloadComponent({ catalogDir: join(corruptDownloadProfile, 'catalog'), descriptor: artistComponent.descriptor, request: async () => ({ status: 200, ok: true, body: Buffer.alloc(archiveBytes.length, 0x63) }), retries: 0, archiveInspector: componentInspector }), /SHA-512/i);
assert.equal(existsSync(componentFile(join(corruptDownloadProfile, 'catalog'), artistComponent.descriptor)), false);
const oversizeDownloadProfile = localTemp('component-oversize-download');
await assert.rejects(downloadComponent({ catalogDir: join(oversizeDownloadProfile, 'catalog'), descriptor: artistComponent.descriptor, request: async () => ({ status: 200, ok: true, body: Buffer.concat([archiveBytes, Buffer.from([0x63])]) }), retries: 0, archiveInspector: componentInspector }), /size mismatch/i);
assert.equal(existsSync(componentFile(join(oversizeDownloadProfile, 'catalog'), artistComponent.descriptor)), false);

const legacyRoot = localTemp('legacy-source');
const legacyCatalog = { version: 2, artists: [{ image: 'cards/artist/danbooru-artist-tags-2-v5/fixture.webp' }], characters: [{ image: 'cards/character/danbooru-character-tags-v4.5/fixture.jpg' }] };
mkdirSync(join(legacyRoot, 'dist/catalog/cards/artist/danbooru-artist-tags-2-v5'), { recursive: true });
mkdirSync(join(legacyRoot, 'dist/catalog/cards/character/danbooru-character-tags-v4.5'), { recursive: true });
mkdirSync(join(legacyRoot, 'dist/catalog/guide'), { recursive: true });
writeFileSync(join(legacyRoot, 'dist/catalog/catalog.json'), JSON.stringify(legacyCatalog));
writeFileSync(join(legacyRoot, 'dist/catalog/cards/artist/danbooru-artist-tags-2-v5/fixture.webp'), 'RIFFxxxxWEBP');
writeFileSync(join(legacyRoot, 'dist/catalog/cards/character/danbooru-character-tags-v4.5/fixture.jpg'), 'jpg');
writeFileSync(join(legacyRoot, 'dist/catalog/guide/manifest.json'), JSON.stringify([{ image: 'fixture.png' }]));
writeFileSync(join(legacyRoot, 'dist/catalog/guide/fixture.png'), 'png');
const legacyArchive = join(localTemp('legacy-archive'), 'legacy-app.asar');
await awaitAsar(createPackage(legacyRoot, legacyArchive));
const legacyProfile = localTemp('legacy-profile');
const legacyCatalogDir = join(legacyProfile, 'catalog');
mkdirSync(componentPaths(legacyCatalogDir).legacy, { recursive: true });
copyFileSync(legacyArchive, componentPaths(legacyCatalogDir).legacyPack);
const legacyValidation = validateLegacyArchive(componentPaths(legacyCatalogDir).legacyPack, { inspector: componentInspector });
assert.equal(legacyValidation.status, 'Migrated');
assert.match(resolveComponentAsset(legacyCatalogDir, 'guide/fixture.png'), /legacy-app\.asar/);
const optionsPath = join(legacyProfile, 'installer-options.ini');
writeFileSync(optionsPath, '[catalogs]\nv5Artists=1\nbuilder=1\nv45Characters=0\n');
const legacySnapshot = readFileSync(optionsPath, 'utf8');
const legacyResults = await ensureSelectedComponents({ catalogDir: legacyCatalogDir, dataDir: legacyProfile, descriptors: [artistComponent.descriptor, { ...COMPONENTS.guide, size: artistComponent.descriptor.size, sha512: artistComponent.descriptor.sha512 }, { ...COMPONENTS.characters, size: artistComponent.descriptor.size, sha512: artistComponent.descriptor.sha512 }], request: async () => { throw new Error('legacy source must suppress downloads'); }, archiveInspector: componentInspector });
assert.equal(legacyResults.migrated, true);
assert.deepEqual(legacyResults.results.map(item => item.status), ['Migrated', 'Migrated']);
assert.equal(readFileSync(optionsPath, 'utf8'), legacySnapshot);
assert.equal(existsSync(join(legacyCatalogDir, 'active.json')), false);

// An explicitly installed component takes status precedence over a retained
// legacy ASAR, while components that have not been installed remain Migrated.
const legacyArtistDescriptor = artistComponent.descriptor;
const legacyArtistArchive = join(localTemp('legacy-artist-component'), legacyArtistDescriptor.filename);
copyFileSync(activated.path, legacyArtistArchive);
const legacyActivated = activateComponent(legacyCatalogDir, await verifyComponent(legacyArtistArchive, legacyArtistDescriptor, { archiveInspector: componentInspector }));
const legacyActivatedStat = statSync(legacyActivated.path);
const legacyInstalledState = loadState(legacyCatalogDir);
legacyInstalledState.components.artists = {
  status: 'Installed',
  filename: legacyArtistDescriptor.filename,
  size: legacyActivatedStat.size,
  sha512: legacyArtistDescriptor.sha512,
  mtimeMs: legacyActivatedStat.mtimeMs,
  version: '0.6.3',
  expectedRoot: legacyArtistDescriptor.expectedRoot,
  count: legacyArtistDescriptor.count
};
saveState(legacyCatalogDir, legacyInstalledState);
const legacyStatusDescriptors = [
  legacyArtistDescriptor,
  normalizeDescriptor({ ...COMPONENTS.guide, size: 1, sha512: '0'.repeat(128) }),
  normalizeDescriptor({ ...COMPONENTS.characters, size: 1, sha512: '0'.repeat(128) })
];
const legacyStatuses = statuses(legacyCatalogDir, legacyStatusDescriptors, { archiveInspector: componentInspector });
assert.deepEqual(legacyStatuses.map(item => item.status), ['Installed', 'Migrated', 'Migrated']);
let installedPriorityRequests = 0;
const installedPriority = await ensureSelectedComponents({ catalogDir: legacyCatalogDir, dataDir: legacyProfile, descriptors: [legacyArtistDescriptor, { ...COMPONENTS.guide, size: legacyArtistDescriptor.size, sha512: legacyArtistDescriptor.sha512 }, { ...COMPONENTS.characters, size: legacyArtistDescriptor.size, sha512: legacyArtistDescriptor.sha512 }], request: async () => { installedPriorityRequests += 1; throw new Error('legacy fallback should suppress only missing component downloads'); }, archiveInspector: componentInspector });
assert.deepEqual(installedPriority.results.map(item => item.status), ['Installed', 'Migrated']);
assert.equal(installedPriorityRequests, 0);

// A damaged regular component must not shadow a validated migrated archive;
// runtime resolution should continue down the documented source precedence.
writeFileSync(componentFile(legacyCatalogDir, legacyArtistDescriptor), 'damaged component');
assert.match(resolveComponentAsset(legacyCatalogDir, 'cards/artist/danbooru-artist-tags-2-v5/fixture.webp'), /legacy-app\.asar/);

rmSync(testTempRoot, { recursive: true, force: true });
console.log('Catalog component tests passed.');

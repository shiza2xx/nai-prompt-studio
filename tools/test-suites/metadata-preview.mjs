import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs'; import { gzipSync, gunzipSync } from 'node:zlib';
import { decodeStealthPayload,extractImageMetadata,normalizeMetadata,parseMetadataJson,parsePngTextChunks,parseWebpExifUserComment } from '../../src/image-metadata.ts'; import { PreviewCache } from '../../src/preview-cache.ts';
import { createOfficialArtistThumbnail, OFFICIAL_ARTIST_THUMBNAIL_HEIGHT, OFFICIAL_ARTIST_THUMBNAIL_WIDTH } from '../../src/artist-thumbnail.ts';
import { createMetadataDisplayPreview, METADATA_DISPLAY_PREVIEW_MAX_HEIGHT, METADATA_DISPLAY_PREVIEW_MAX_WIDTH } from '../../src/metadata-display-preview.ts';
import { PREVIEW_CACHE_BUDGETS } from '../../src/types.ts';
import { buildWarmupPlan, scheduleIdleWarmup, uniqueWarmupItems } from '../../src/catalog-warmup.ts';
const require = createRequire(import.meta.url);
const { loadPost: loadBooruPost } = require('../../electron/booru-metadata.cjs');
const uiSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');
const electronSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
const catalogUpdaterSource = readFileSync(new URL('../../electron/catalog-updater.cjs', import.meta.url), 'utf8');
const updateV5Source = readFileSync(new URL('../update-v5-catalog.mjs', import.meta.url), 'utf8');

const originalBooruBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7]);
const requestedBooruUrls = [];
const originalBooru = await loadBooruPost('https://danbooru.donmai.us/posts/42', { fetch: async url => {
  requestedBooruUrls.push(url);
  if (url.endsWith('/posts/42.json')) return new Response(JSON.stringify({ id: 42, tag_string: 'original_quality', file_url: 'https://cdn.donmai.us/original.png', large_file_url: 'https://cdn.donmai.us/compressed.jpg' }), { headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/original.png')) return new Response(originalBooruBytes, { headers: { 'content-type': 'image/png' } });
  return new Response(Buffer.from([255, 216, 255, 224, 1]), { headers: { 'content-type': 'image/jpeg' } });
} });
assert.equal(originalBooru.mime, 'image/png');
assert.deepEqual(Buffer.from(originalBooru.bytes), originalBooruBytes, 'Image Metadata keeps the original booru bytes');
assert.equal(requestedBooruUrls.includes('https://cdn.donmai.us/compressed.jpg'), false, 'compressed Danbooru variants remain fallbacks');
const customTagPackSource = readFileSync(new URL('../../electron/custom-tag-pack.cjs', import.meta.url), 'utf8');
const metadataHighlightSource = readFileSync(new URL('../../src/metadata-artist-highlight.ts', import.meta.url), 'utf8');
const warmupSource = readFileSync(new URL('../../src/catalog-warmup.ts', import.meta.url), 'utf8');
// PreviewCache deduplicates source fetches, mounts ready entries synchronously,
// terminates failed skeletons, and evicts decoded URLs by byte-bounded LRU.
assert.equal(Math.round((72 * 832 * 1216 * 4) / 1024 / 1024 * 100) / 100, 277.88);
assert.equal(320 * 468 * 4, 599040);
assert.equal(PREVIEW_CACHE_BUDGETS.large.grid + PREVIEW_CACHE_BUDGETS.large.content + PREVIEW_CACHE_BUDGETS.large.hover, 1536 * 1024 * 1024);
assert.equal(PREVIEW_CACHE_BUDGETS.balanced.grid + PREVIEW_CACHE_BUDGETS.balanced.content + PREVIEW_CACHE_BUDGETS.balanced.hover, 576 * 1024 * 1024);
const previewFetches = new Map();
const revokedPreviewUrls = [];
let previewImageSequence = 0;
function previewImage() {
  const classes = new Set();
  return {
    src: '', dataset: {}, complete: true, naturalWidth: 16, naturalHeight: 16, isConnected: true,
    classList: { add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)), has: value => classes.has(value) },
    parentElement: { classList: { add: (...values) => values.forEach(value => classes.add(value)) } },
    decode: async () => {}, classes, addEventListener: () => {}
  };
}
const previewCache = new PreviewCache({
  fetch: async source => { previewFetches.set(source, (previewFetches.get(source) ?? 0) + 1); return source === 'missing' ? { ok: false, status: 404, blob: async () => ({ source }) } : { ok: true, blob: async () => ({ source }) }; },
  createObjectURL: blob => `blob:preview-${++previewImageSequence}-${blob.source}`,
  revokeObjectURL: url => revokedPreviewUrls.push(url),
  createImage: previewImage,
  maxBytes: 1024,
  schedule: callback => callback()
});
const sharedA = previewCache.load('a', 'visible');
assert.strictEqual(sharedA, previewCache.load('a', 'current-page'));
const readyA = await sharedA;
assert.equal(readyA.state, 'ready');
assert.equal(previewFetches.get('a'), 1);
const mountedImage = previewImage();
mountedImage.dataset.previewSrc = 'a';
const mounted = previewCache.hydrateImage(mountedImage);
assert.equal(mounted?.state, 'ready');
assert.equal(mountedImage.src, readyA.url);
assert.equal(mountedImage.classes.has('is-decoded'), true);
assert.equal(mountedImage.classes.has('is-preview-ready'), true);
const cachedImage = previewImage();
cachedImage.dataset.previewSrc = 'a';
assert.equal(previewCache.hydrateImage(cachedImage)?.state, 'ready');
assert.equal(previewFetches.get('a'), 1);
mountedImage.isConnected = false;
cachedImage.isConnected = false;
const failedImage = previewImage();
failedImage.dataset.previewSrc = 'missing';
const failed = previewCache.hydrateImage(failedImage);
assert.equal((await failed?.promise)?.state, 'failed');
assert.equal(failedImage.dataset.previewState, 'error');
assert.equal(failedImage.classes.has('is-preview-error'), true);
assert.equal(failedImage.src, './plus.png');
await previewCache.load('b', 'background');
assert.equal(previewCache.has('a'), false);
assert.ok(revokedPreviewUrls.some(url => url.includes('preview-')));
const staleImage = previewImage();
staleImage.dataset.previewSrc = 'stale';
staleImage.isConnected = false;
const stale = previewCache.hydrateImage(staleImage);
await stale?.promise;
assert.equal(staleImage.src, '');

// Transforms are opt-in per cache variant, deduplicated across callers, and
// foreground requests promote queued background work immediately.
let transformed = 0;
const transformedCache = new PreviewCache({
  variant: 'official-thumbnail',
  fetch: async source => ({ ok: true, blob: async () => ({ source, transformed: false }) }),
  transform: async (blob, context) => { transformed += 1; assert.equal(context.variant, 'official-thumbnail'); return { ...blob, transformed: true }; },
  createObjectURL: blob => `blob:transformed-${blob.source}`,
  revokeObjectURL: () => {}, createImage: previewImage, maxBytes: 4096, schedule: callback => callback()
});
const transformedOne = transformedCache.load('same', 'background');
assert.strictEqual(transformedOne, transformedCache.load('same', 'visible'));
assert.equal((await transformedOne).state, 'ready');
assert.equal(transformed, 1);
// Prompt Builder and Artist Mix use the same official thumbnail namespace.
assert.strictEqual(await transformedCache.load('same', 'current-page'), await transformedOne);
assert.equal(transformed, 1);
const unchangedCache = new PreviewCache({
  fetch: async source => ({ ok: true, blob: async () => ({ source }) }),
  createObjectURL: blob => `blob:unchanged-${blob.source}`, revokeObjectURL: () => {}, createImage: previewImage, maxBytes: 4096, schedule: callback => callback()
});
await unchangedCache.load('user-owned', 'background');
assert.equal(unchangedCache.get('user-owned')?.variant, 'default');
const oversizedCache = new PreviewCache({
  fetch: async source => ({ ok: true, blob: async () => ({ source }) }),
  createObjectURL: blob => `blob:oversized-${blob.source}`, revokeObjectURL: () => {}, createImage: previewImage, maxBytes: 1, schedule: callback => callback()
});
assert.equal((await oversizedCache.load('too-large', 'background')).state, 'failed');
assert.equal(oversizedCache.has('too-large'), false);

// A 1 -> 2 -> 1 page walk reuses both official thumbnail entries without a
// second fetch/decode when the grid budget can retain the two pages.
const pageFetches = new Map();
const pageCache = new PreviewCache({
  variant: 'official-thumbnail',
  fetch: async source => { pageFetches.set(source, (pageFetches.get(source) ?? 0) + 1); return { ok: true, blob: async () => ({ source }) }; },
  createObjectURL: blob => `blob:page-${blob.source}`, revokeObjectURL: () => {}, createImage: previewImage, maxBytes: 8192, schedule: callback => callback()
});
await Promise.all(['page-1-a', 'page-1-b'].map(source => pageCache.load(source, 'current-page')));
await Promise.all(['page-2-a', 'page-2-b'].map(source => pageCache.load(source, 'current-page')));
await Promise.all(['page-1-a', 'page-1-b'].map(source => pageCache.load(source, 'current-page')));
for (const source of ['page-1-a', 'page-1-b', 'page-2-a', 'page-2-b']) assert.equal(pageFetches.get(source), 1);

// Startup warmup groups are ordered by value and deduplicated by stable source:
// unique Page 2 first, then Favorites page 1, then remaining/user work.
const startupJobs = uniqueWarmupItems([
  ...['page-2-a', 'shared'].map(source => ({ source, group: 'page-2' })),
  ...['shared', 'favorites-only'].map(source => ({ source, group: 'favorites' })),
  ...['idle-only', 'user-only'].map(source => ({ source, group: 'remaining' }))
], job => job.source);
assert.deepEqual(startupJobs.map(job => job.source), ['page-2-a', 'shared', 'favorites-only', 'idle-only', 'user-only']);
assert.deepEqual(startupJobs.map(job => job.group), ['page-2', 'page-2', 'favorites', 'remaining', 'remaining']);

let resolveSlow;
const promotionStarts = [];
const promotionCache = new PreviewCache({
  fetch: async source => { promotionStarts.push(source); if (source === 'background-first') await new Promise(resolve => { resolveSlow = resolve; }); return { ok: true, blob: async () => ({ source }) }; },
  createObjectURL: blob => `blob:promotion-${blob.source}`, revokeObjectURL: () => {}, createImage: previewImage,
  backgroundConcurrency: 1, schedule: callback => callback()
});
const firstBackground = promotionCache.load('background-first', 'background');
const promoted = promotionCache.load('promoted', 'background');
assert.equal(promotionCache.get('promoted')?.state, 'queued');
promotionCache.load('promoted', 'visible');
assert.equal(promotionCache.get('promoted')?.state, 'loading');
resolveSlow();
await Promise.all([firstBackground, promoted]);
assert.deepEqual(promotionStarts, ['background-first', 'promoted']);

const leaseCache = new PreviewCache({
  fetch: async source => ({ ok: true, blob: async () => ({ source }) }),
  createObjectURL: blob => `blob:lease-${blob.source}`, revokeObjectURL: () => {}, createImage: previewImage, maxBytes: 1024, schedule: callback => callback()
});
await leaseCache.load('leased', 'background');
const lease = leaseCache.acquireLease('current-page', ['leased']);
await leaseCache.load('evictable', 'background');
assert.equal(leaseCache.has('leased'), true);
lease.release();
await leaseCache.load('replacement', 'background');
assert.equal(leaseCache.has('leased'), false);

const invalidatedLeaseCache = new PreviewCache({
  fetch: async source => ({ ok: true, blob: async () => ({ source }) }), createObjectURL: blob => `blob:invalidate-${blob.source}`,
  revokeObjectURL: () => {}, createImage: previewImage, maxBytes: 1024, schedule: callback => callback()
});
await invalidatedLeaseCache.load('leased-source', 'background');
const invalidatedLease = invalidatedLeaseCache.acquireLease('invalidated-page', ['leased-source']);
invalidatedLeaseCache.invalidateSources(['leased-source']);
assert.deepEqual(invalidatedLease.sources, [], 'source invalidation must remove lease membership as well as its refcount');

const replacedLeaseCache = new PreviewCache({
  fetch: async source => ({ ok: true, blob: async () => ({ source }) }), createObjectURL: blob => `blob:replace-${blob.source}`,
  revokeObjectURL: () => {}, createImage: previewImage, maxBytes: 1024, schedule: callback => callback()
});
await replacedLeaseCache.load('stale-source', 'background');
const staleLease = replacedLeaseCache.acquireLease('same-scope', ['stale-source']);
replacedLeaseCache.acquireLease('same-scope', []);
staleLease.update(['stale-source']);
await replacedLeaseCache.load('replacement-source', 'background');
assert.equal(replacedLeaseCache.has('stale-source'), false, 'a replaced lease handle cannot revive global retention');

let pendingSignal;
const cancelCache = new PreviewCache({
  fetch: async (_source, signal) => { pendingSignal = signal; return { ok: true, blob: async () => new Promise(() => {}) }; },
  createObjectURL: blob => `blob:cancel-${blob.source}`, revokeObjectURL: () => {}, createImage: previewImage, schedule: callback => callback()
});
const pending = cancelCache.load('cancel-me', 'visible');
cancelCache.clear();
assert.equal(pendingSignal.aborted, true);
assert.equal((await pending).state, 'failed');

// Every asynchronous stage has a deterministic, injectable per-entry
// deadline. The timeout aborts the signal, settles the public promise, frees
// the worker slot, and leaves late non-abortable work unable to resurrect an
// entry or leak its eventual object URL.
function timeoutOptions(timers, extra = {}) {
  return { ...extra, foregroundConcurrency: 1, timeoutMs: 7, setTimeout: callback => { timers.push(callback); return callback; }, clearTimeout: () => {}, schedule: callback => callback() };
}
async function finishTimedOut(cache, timers, pending, started, signal) {
  while (!started()) await Promise.resolve();
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal((await pending).state, 'failed');
  assert.equal(signal.aborted, true);
  assert.equal(cache.get('timeout-stage')?.state, 'failed');
}
// Fetch itself can ignore abort; the public load still settles and the signal
// is aborted at the injected deadline.
{
  const timers = []; let started = false; let signal;
  const cache = new PreviewCache(timeoutOptions(timers, { fetch: async (_source, requestSignal) => { signal = requestSignal; started = true; return new Promise(() => {}); }, createImage: previewImage }));
  await finishTimedOut(cache, timers, cache.load('timeout-stage', 'visible'), () => started, signal);
}
// The response body can be independently non-abortable.
{
  const timers = []; let started = false; let signal;
  const cache = new PreviewCache(timeoutOptions(timers, { fetch: async (_source, requestSignal) => { signal = requestSignal; return { ok: true, blob: async () => { started = true; return new Promise(() => {}); } }; }, createImage: previewImage }));
  await finishTimedOut(cache, timers, cache.load('timeout-stage', 'visible'), () => started, signal);
}
// Transform can ignore the signal after the source blob has arrived.
{
  const timers = []; let started = false; let signal;
  const cache = new PreviewCache(timeoutOptions(timers, { fetch: async (_source, requestSignal) => { signal = requestSignal; return { ok: true, blob: async () => ({ source: 'timeout-stage' }) }; }, transform: async () => { started = true; return new Promise(() => {}); }, createImage: previewImage }));
  await finishTimedOut(cache, timers, cache.load('timeout-stage', 'visible'), () => started, signal);
}
// Image decode may have already created an object URL. Timeout revokes it
// immediately, and a later decode completion cannot resurrect the entry.
{
  const timers = []; let started = false; let releaseDecode; let signal; const revoked = [];
  const cache = new PreviewCache(timeoutOptions(timers, { fetch: async (_source, requestSignal) => { signal = requestSignal; return { ok: true, blob: async () => ({ source: 'timeout-decode' }) }; }, createObjectURL: blob => `blob:timeout-${blob.source}`, revokeObjectURL: url => revoked.push(url), createImage: () => { const image = previewImage(); image.decode = async () => { started = true; await new Promise(resolve => { releaseDecode = resolve; }); }; return image; } }));
  const pending = cache.load('timeout-stage', 'visible');
  await finishTimedOut(cache, timers, pending, () => started, signal);
  assert.deepEqual(revoked, ['blob:timeout-timeout-decode']);
  releaseDecode(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(revoked, ['blob:timeout-timeout-decode']);
  assert.equal(cache.get('timeout-stage')?.state, 'failed');
}
// Releasing a timed-out slot immediately allows the next foreground request
// to start even while the old non-abortable fetch remains pending.
{
  const timers = []; let firstStarted = false; let nextStarted = false;
  const cache = new PreviewCache(timeoutOptions(timers, { fetch: async source => { if (source === 'first') { firstStarted = true; return new Promise(() => {}); } nextStarted = true; return { ok: true, blob: async () => ({ source }) }; }, createObjectURL: blob => `blob:slot-${blob.source}`, createImage: previewImage }));
  const first = cache.load('first', 'visible');
  while (!firstStarted) await Promise.resolve();
  timers.shift()();
  const second = cache.load('second', 'visible');
  assert.equal(nextStarted, true);
  assert.equal((await first).state, 'failed');
  assert.equal((await second).state, 'ready');
  cache.clear();
}

// The concrete browser transformer requests the approved dimensions/quality,
// closes bitmaps, and emits WebP without touching the source bytes.
let closedBitmap = false;
let convertOptions;
const thumbBlob = await createOfficialArtistThumbnail(new Blob(['source']), undefined, {
  createImageBitmap: async (_blob, options) => { assert.equal(options.resizeWidth, OFFICIAL_ARTIST_THUMBNAIL_WIDTH); assert.equal(options.resizeHeight, OFFICIAL_ARTIST_THUMBNAIL_HEIGHT); return { width: 832, height: 1216, close: () => { closedBitmap = true; } }; },
  OffscreenCanvas: class { getContext() { return { drawImage: () => {} }; } async convertToBlob(options) { convertOptions = options; return new Blob(['thumbnail'], { type: options.type }); } }
});
assert.equal(thumbBlob.type, 'image/webp');
assert.equal(convertOptions.quality, 0.9);
assert.equal(closedBitmap, true);

// Metadata keeps exact source bytes for saves, but only displays a bounded
// WebP preview after the first load so returning to the workspace cannot
// re-decode a full-resolution booru image.
let metadataBitmapClosed = false;
let metadataCanvasWidth = 0;
let metadataCanvasHeight = 0;
const metadataPreview = await createMetadataDisplayPreview(new Blob(['source']), {
  createImageBitmap: async () => ({ width: 4096, height: 2048, close: () => { metadataBitmapClosed = true; } }),
  OffscreenCanvas: class {
    constructor(width, height) { metadataCanvasWidth = width; metadataCanvasHeight = height; }
    getContext() { return { drawImage() {} }; }
    async convertToBlob(options) { assert.equal(options.type, 'image/webp'); return new Blob(['metadata-preview'], { type: options.type }); }
  }
});
assert.equal(metadataPreview.type, 'image/webp');
assert.equal(metadataCanvasWidth, METADATA_DISPLAY_PREVIEW_MAX_WIDTH);
assert.equal(metadataCanvasHeight, 1024, 'display preview must preserve the source aspect ratio while staying below its height cap');
assert.ok(metadataCanvasHeight <= METADATA_DISPLAY_PREVIEW_MAX_HEIGHT);
assert.equal(metadataBitmapClosed, true);
const smallMetadataSource = new Blob(['small']);
assert.strictEqual(await createMetadataDisplayPreview(smallMetadataSource, {
  createImageBitmap: async () => ({ width: 800, height: 600 }),
  OffscreenCanvas: class { getContext() { throw new Error('Small images must not be rasterized again.'); } async convertToBlob() { throw new Error('unreachable'); } }
}), smallMetadataSource);

// Scope validity is local to each hydration call; one connected scope/token
// must not suppress a second connected scope that happens to render later.
const scopeCache = new PreviewCache({
  fetch: async source => ({ ok: true, blob: async () => ({ source }) }),
  createObjectURL: blob => `blob:scope-${blob.source}`,
  revokeObjectURL: () => {},
  createImage: previewImage,
  maxBytes: 4096,
  schedule: callback => callback()
});
const scopeAImage = previewImage();
scopeAImage.dataset.previewSrc = 'scope-a';
const scopeBImage = previewImage();
scopeBImage.dataset.previewSrc = 'scope-b';
const scopeAResult = scopeCache.hydrateImage(scopeAImage, { token: 1, isCurrent: () => true });
const scopeBResult = scopeCache.hydrateImage(scopeBImage, { token: 2, isCurrent: () => true });
await Promise.all([scopeAResult?.promise, scopeBResult?.promise]);
assert.equal(scopeAImage.dataset.previewState, 'ready');
assert.equal(scopeBImage.dataset.previewState, 'ready');

// Detached consumers are pruned before eviction, so old DOM nodes do not pin
// decoded entries or accumulate as cache consumers.
const detachedCache = new PreviewCache({
  fetch: async source => ({ ok: true, blob: async () => ({ source }) }),
  createObjectURL: blob => `blob:detached-${blob.source}`,
  revokeObjectURL: () => {},
  createImage: previewImage,
  maxBytes: 1024,
  schedule: callback => callback()
});
const detachedImage = previewImage();
detachedImage.dataset.previewSrc = 'detached';
await detachedCache.hydrateImage(detachedImage)?.promise;
detachedImage.isConnected = false;
await detachedCache.load('detached-next', 'background');
assert.equal(detachedCache.has('detached'), false);

// Catalog revision changes evict only catalog-owned entries and are no-ops
// when the loaded revision is unchanged; user/library assets remain resident.
const catalogFetches = new Map();
const catalogCache = new PreviewCache({
  fetch: async source => { catalogFetches.set(source, (catalogFetches.get(source) ?? 0) + 1); return { ok: true, blob: async () => ({ source }) }; },
  createObjectURL: blob => `blob:catalog-${blob.source}`,
  revokeObjectURL: () => {},
  createImage: previewImage,
  maxBytes: 8192,
  schedule: callback => callback()
});
const catalogSource = 'nai-catalog://asset/catalog.webp';
const userSource = 'nai-library://asset/user.webp';
await catalogCache.load(catalogSource, 'background');
await catalogCache.load(userSource, 'background');
const catalogFetchesBeforeChange = catalogFetches.get(catalogSource) ?? 0;
catalogCache.invalidateCatalog('catalog-rev-1', source => source.startsWith('nai-catalog://') || source.startsWith('./catalog/'));
assert.equal(catalogCache.has(catalogSource), false);
assert.equal(catalogCache.has(userSource), true);
await catalogCache.load(catalogSource, 'background');
const catalogFetchesAfterChange = catalogFetches.get(catalogSource) ?? 0;
catalogCache.invalidateCatalog('catalog-rev-1', source => source.startsWith('nai-catalog://') || source.startsWith('./catalog/'));
assert.equal(catalogCache.has(catalogSource), true);
assert.equal(catalogFetches.get(catalogSource), catalogFetchesAfterChange);
assert.ok(catalogFetchesAfterChange > catalogFetchesBeforeChange);

const warmupCards = Array.from({ length: 8 }, (_, index) => ({ id: `warm-${index}`, catalogId: `warm-${index}`, tag: `Warm ${index}`, image: `cards/artist/${index}.webp` }));
const warmupPlan = buildWarmupPlan(warmupCards, { selected: ['warm-3'], anchors: ['warm-2'], companions: ['warm-2', 'warm-1'], visible: ['warm-0'], initialLimit: warmupCards.length });
assert.deepEqual(warmupPlan.slice(0, 5).map(item => item.id), ['warm-3', 'warm-2', 'warm-1', 'warm-0', 'warm-4']);
assert.equal(buildWarmupPlan(warmupCards, { visible: ['warm-0'], initialLimit: 3, includeCatalogRemainder: false }).length, 3);
const boundedWarmupCards = Array.from({ length: 4198 }, (_, index) => ({ id: `bounded-${index}`, catalogId: `bounded-${index}`, tag: `Bounded ${index}`, image: `cards/artist/bounded-${index}.webp` }));
const originalArrayMap = Array.prototype.map;
let boundedCatalogMapped = false;
Array.prototype.map = function (...args) { if (this === boundedWarmupCards) boundedCatalogMapped = true; return originalArrayMap.apply(this, args); };
let boundedWarmupPlan;
try {
  boundedWarmupPlan = buildWarmupPlan(boundedWarmupCards, { selected: ['bounded-3000'], anchors: ['bounded-12'], visible: ['bounded-2', 'bounded-3'], initialLimit: 4, includeCatalogRemainder: false });
} finally { Array.prototype.map = originalArrayMap; }
assert.equal(boundedCatalogMapped, false);
assert.deepEqual(boundedWarmupPlan.map(item => item.id), ['bounded-3000', 'bounded-12', 'bounded-2', 'bounded-3']);
let activeWarmups = 0; let maxWarmups = 0; const finishedWarmups = [];
const warmupRun = scheduleIdleWarmup(warmupPlan, async item => { activeWarmups += 1; maxWarmups = Math.max(maxWarmups, activeWarmups); await new Promise(resolve => setTimeout(resolve, 1)); activeWarmups -= 1; finishedWarmups.push(item.id); return true; }, 0, callback => setTimeout(callback, 0), 2);
warmupRun.startIdle();
while (finishedWarmups.length < warmupPlan.length) await new Promise(resolve => setTimeout(resolve, 2));
assert.ok(maxWarmups <= 2);
assert.equal(new Set(finishedWarmups).size, warmupPlan.length);
assert.match(warmupSource, /requestIdleCallback/);
assert.match(warmupSource, /initialGraceMs/);
assert.match(warmupSource, /onePerSlice/);

assert.doesNotMatch(preloadSource, /process\.isPackaged/);
assert.match(uiSource, /async function loadCatalogMode/);
assert.match(uiSource, /packagedCatalogMode/);
assert.match(uiSource, /function isCatalogPreviewSource\(source: string\): boolean/);
assert.match(uiSource, /function invalidateOfficialPreviewCatalog\(revision: string\): void \{[\s\S]*?gridPreviewCache\.invalidateCatalog\(revision, isCatalogPreviewSource\)[\s\S]*?hoverPreviewCache\.invalidateCatalog\(revision, isCatalogPreviewSource\)/);
assert.match(electronSource, /fs\.promises\.readFile\(target\)/);
assert.doesNotMatch(electronSource, /fs\.readFileSync\(target\)/);
assert.match(catalogUpdaterSource, /const GALLERY_PAGE_CONCURRENCY = 4/);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const textPayload = Buffer.from('Comment\0"{\\"model_name\\":\\"Text model\\",\\"steps\\":12}"', 'utf8');
const textChunk = Buffer.alloc(12 + textPayload.length);
textChunk.writeUInt32BE(textPayload.length, 0); textChunk.write('tEXt', 4); textPayload.copy(textChunk, 8);
const endChunk = Buffer.alloc(12); endChunk.write('IEND', 4);
const parsedText = parsePngTextChunks(new Uint8Array(Buffer.concat([pngSignature, textChunk, endChunk])));
assert.equal(parsedText[0].keyword, 'Comment');
assert.deepEqual(parseMetadataJson(parsedText[0].text), { model_name: 'Text model', steps: 12 });
const stealthJson = JSON.stringify({ Description: 'outer description', Comment: JSON.stringify({ model_name: 'NovelAI Diffusion V5', steps: 28, sampler: 'k_euler_ancestral', width: 1920, height: 1088, scale: 7, v4_prompt: { caption: { base_caption: 'base positive', char_captions: [{ char_caption: 'first character' }, { char_caption: 'second character' }] } }, v4_negative_prompt: { caption: { base_caption: 'base negative', char_captions: [{ char_caption: 'first negative' }] } } }) });
const stealthCompressed = gzipSync(stealthJson);
const stealthHeader = Buffer.alloc(19); Buffer.from('stealth_pngcomp').copy(stealthHeader); stealthHeader.writeUInt32BE(stealthCompressed.length * 8, 15);
const stealthBits = [...Buffer.concat([stealthHeader, stealthCompressed])].flatMap(byte => Array.from({ length: 8 }, (_, bit) => (byte >> (7 - bit)) & 1));
const alpha = new Uint8Array(stealthBits.length + 5).fill(254); stealthBits.forEach((bit, index) => { alpha[index] = 254 | bit; });
assert.deepEqual(Buffer.from(decodeStealthPayload(alpha)), stealthCompressed);
const normalizedStealth = normalizeMetadata(parseMetadataJson(gunzipSync(decodeStealthPayload(alpha)).toString('utf8')));
assert.equal(normalizedStealth.model, 'NovelAI Diffusion V5');
assert.equal(normalizedStealth.scale, '7');
assert.equal(normalizedStealth.characters.length, 2);
assert.equal(normalizedStealth.characters[1].positive, 'second character');
assert.equal(normalizedStealth.characters[1].negative, '');
const normalizedFallback = normalizeMetadata({ Source: 'V5', Description: 'fallback prompt', uc: 'fallback negative', parameters: { steps: 28, sampler: 'k_dpmpp_2m_sde', width: 1472, height: 1472, scale: 6.5 } });
assert.equal(normalizedFallback.model, 'V5');
assert.equal(normalizedFallback.base.positive, 'fallback prompt');
assert.equal(normalizedFallback.characters.length, 0);

function writeUint16(buffer, offset, value, little) { little ? buffer.writeUInt16LE(value, offset) : buffer.writeUInt16BE(value, offset); }
function writeUint32(buffer, offset, value, little) { little ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset); }
function exactArrayBuffer(bytes) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
function webpChunk(type, data) {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(type, 0); chunk.writeUInt32LE(data.length, 4); data.copy(chunk, 8);
  return chunk;
}
function webpWithExif(exif, extras = []) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...extras, webpChunk('EXIF', exif)]);
  const file = Buffer.alloc(8); file.write('RIFF', 0); file.writeUInt32LE(body.length, 4);
  return Buffer.concat([file, body]);
}
function makeTiffUserComment(value, { little = false, marker = 'ASCII\0\0\0', unicode = false } = {}) {
  const encoded = unicode ? Buffer.from(`\ufeff${value}`, 'utf16le') : Buffer.from(value, 'utf8');
  const payload = unicode && !little ? Buffer.concat(Array.from({ length: encoded.length / 2 }, (_, index) => Buffer.from([encoded[index * 2 + 1], encoded[index * 2]]))) : encoded;
  const comment = Buffer.concat([Buffer.from(marker, 'ascii'), payload, Buffer.from(unicode ? [0, 0] : [0])]);
  const exifIfdOffset = 26;
  const commentOffset = 44;
  const tiff = Buffer.alloc(commentOffset + comment.length);
  tiff.write(little ? 'II' : 'MM', 0); writeUint16(tiff, 2, 42, little); writeUint32(tiff, 4, 8, little);
  writeUint16(tiff, 8, 1, little); writeUint16(tiff, 10, 0x8769, little); writeUint16(tiff, 12, 4, little); writeUint32(tiff, 14, 1, little); writeUint32(tiff, 18, exifIfdOffset, little);
  writeUint16(tiff, exifIfdOffset, 1, little); writeUint16(tiff, exifIfdOffset + 2, 0x9286, little); writeUint16(tiff, exifIfdOffset + 4, 7, little); writeUint32(tiff, exifIfdOffset + 6, comment.length, little); writeUint32(tiff, exifIfdOffset + 10, commentOffset, little);
  comment.copy(tiff, commentOffset);
  return tiff;
}

const syntheticOuter = JSON.stringify({ Comment: JSON.stringify({ model_name: 'Little endian model', steps: 7 }) });
const syntheticWebp = webpWithExif(makeTiffUserComment(syntheticOuter, { little: true }), [webpChunk('JUNK', Buffer.from([1, 2, 3]))]);
assert.equal(parseWebpExifUserComment(syntheticWebp), syntheticOuter);
assert.equal(normalizeMetadata(parseMetadataJson(parseWebpExifUserComment(syntheticWebp))).model, 'Little endian model');
const unicodeWebp = webpWithExif(makeTiffUserComment(JSON.stringify({ model_name: 'Big endian Unicode model', steps: 9 }), { marker: 'UNICODE\0', unicode: true }));
assert.equal(normalizeMetadata(parseMetadataJson(parseWebpExifUserComment(unicodeWebp))).model, 'Big endian Unicode model');
const alphOnlyWebp = (() => { const body = Buffer.concat([Buffer.from('WEBP'), webpChunk('ALPH', Buffer.from([1, 2, 3]))]); const file = Buffer.alloc(8); file.write('RIFF'); file.writeUInt32LE(body.length, 4); return Buffer.concat([file, body]); })();
assert.equal(parseWebpExifUserComment(alphOnlyWebp), null);
assert.throws(() => parseWebpExifUserComment(syntheticWebp.subarray(0, -1)), /WebP/);
const declaredBoundary = Buffer.from(syntheticWebp); declaredBoundary.writeUInt32LE(declaredBoundary.length - 9, 4);
assert.throws(() => parseWebpExifUserComment(declaredBoundary), /WebP/);
assert.throws(() => parseWebpExifUserComment(Buffer.from('not an image')), /PNG or WebP/);
for (const [name, startsWith, lengths] of [
  ['tags2 (1).webp', '1girl, masterpiece, best quality', [192, 106]],
  ['tags2 (2).webp', 'best quality, 3::very aesthetic', [741, 292]]
]) {
  const extracted = normalizeMetadata(parseMetadataJson(parseWebpExifUserComment(new Uint8Array(readFileSync(new URL(`../../${name}`, import.meta.url))))));
  assert.deepEqual([extracted.model, extracted.steps, extracted.sampler, extracted.width, extracted.height, extracted.scale, extracted.characters.length], ['NovelAI Diffusion V5', '28', 'k_euler_ancestral', '1024', '1024', '5', 1]);
  assert.ok(extracted.base.positive.startsWith(startsWith));
  assert.deepEqual([extracted.characters[0].positive.length, extracted.characters[0].negative.length], lengths);
  let readCount = 0;
  const preReadBytes = new Uint8Array(readFileSync(new URL(`../../${name}`, import.meta.url)));
  const extractedFromFile = await extractImageMetadata({ type: 'text/plain', arrayBuffer: async () => { readCount += 1; return exactArrayBuffer(preReadBytes); } }, preReadBytes);
  assert.deepEqual(extractedFromFile, extracted);
  assert.equal(readCount, 0, 'pre-read metadata extraction must not read the File again');
}
const previousImageBitmap = globalThis.createImageBitmap;
const previousDocument = globalThis.document;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }) }) }) };
try {
  await assert.rejects(() => extractImageMetadata({ arrayBuffer: async () => exactArrayBuffer(alphOnlyWebp) }), /No NovelAI metadata was found in this image/);
} finally {
  globalThis.createImageBitmap = previousImageBitmap;
  globalThis.document = previousDocument;
}
await assert.rejects(() => extractImageMetadata({ arrayBuffer: async () => exactArrayBuffer(Buffer.from('not an image')) }), /PNG or WebP/);

console.log('Metadata/preview cache tests passed.');

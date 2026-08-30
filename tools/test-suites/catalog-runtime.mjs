import assert from 'node:assert/strict'; import {mkdtempSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs'; import {join} from 'node:path'; import {createRequire} from 'node:module'; import {commitSnapshot,discoverCards,EXPECTED_CARD_COUNT,GALLERY_URL,isWebp,makeCatalog,parseGalleryPage,seedStageFromLive,stableAssetFilename,stableCatalogId} from '../update-v5-catalog.mjs'; import {ARTIST_PAGE_SIZE,CHARACTER_PAGE_SIZE,filterCharacters,paginateArtists,paginateCharacters} from '../../src/catalog-browser.ts'; import {mixCompanionCapacity,mixCompanionScale,mixOrbitLayout} from '../../src/artist-mix-layout.ts'; import {normalizeArtistWeight,resolveRandomPoolRange} from '../../src/random.ts'; const require=createRequire(import.meta.url); const nativeFs=require('node:fs'); const {loadCatalog:loadRuntimeCatalog,parseGalleryPage:parseRuntimeGalleryPage,normalizeImageUrl:normalizeRuntimeImageUrl,runUpdate:runRuntimeCatalogUpdate,catalogAssetFromProtocolUrl,resolveActiveCatalogAsset}=require('../../electron/catalog-updater.cjs'); const {ComponentProgressCoalescer}=require('../../electron/component-progress-coalescer.cjs');
const testTempRoot = join(process.cwd(), '.test-tmp-v063', '1788114714459-' + process.pid); mkdirSync(testTempRoot,{recursive:true}); const localTemp = prefix => mkdtempSync(join(testTempRoot, prefix + '-')); process.once('exit',()=>{try{rmSync(testTempRoot,{recursive:true,force:true})}catch{}});
// Catalog search indexes normalization once per catalog identity and keeps
// favorites outside cached base hits so a mutable favorite set stays current.
{
  let normalized = 0;
  const cards = [{ id: 'one', catalogId: 'one', get tag() { normalized += 1; return 'Alpha'; }, gallery: 'v5', image: 'one.webp', score: 0 }, { id: 'two', catalogId: 'two', get tag() { normalized += 1; return 'Beta'; }, gallery: 'v5', image: 'two.webp', score: 0 }];
  assert.deepEqual(filterCharacters(cards, 'alpha').map(card => card.id), ['one']);
  assert.deepEqual(filterCharacters(cards, 'alpha', true, new Set(['one'])).map(card => card.id), ['one']);
  assert.equal(normalized, cards.length, 'normalization is retained per catalog array');
  for (let index = 0; index < 33; index += 1) filterCharacters(cards, `missing-${index}`);
  assert.deepEqual(paginateCharacters(cards, { query: 'alpha', page: 99, pageSize: 1 }).cards.map(card => card.id), ['one']);
}

// Component byte progress is intentionally the only throttled updater stream.
// The fake clock verifies the trailing value and immediate state boundaries.
{
  let clock = 0; let scheduled = null; let timerId = 0; const emitted = [];
  const coalescer = new ComponentProgressCoalescer(value => emitted.push(value), {
    now: () => clock,
    setTimer: callback => { scheduled = callback; return ++timerId; },
    clearTimer: () => { scheduled = null; }
  });
  coalescer.push({ id: 'artists', attempt: 0, phase: 'Downloading', percent: 1 });
  coalescer.push({ id: 'artists', attempt: 0, phase: 'Downloading', percent: 2 });
  assert.deepEqual(emitted.map(item => item.percent), [1]);
  clock = 100; scheduled();
  assert.deepEqual(emitted.map(item => item.percent), [1, 2]);
  coalescer.push({ id: 'artists', attempt: 1, phase: 'Retrying', percent: 0 });
  coalescer.push({ id: 'artists', attempt: 1, phase: 'Downloading', percent: 100 });
  assert.deepEqual(emitted.map(item => `${item.phase}:${item.percent}`), ['Downloading:1', 'Downloading:2', 'Retrying:0', 'Downloading:100']);
  coalescer.push({ id: 'guide', attempt: 0, phase: 'Downloading', percent: 1 });
  coalescer.push({ id: 'guide', attempt: 0, phase: 'Downloading', percent: 2 });
  coalescer.clear(); clock = 200; scheduled?.();
  assert.equal(emitted.at(-1).percent, 1, 'clearing an operation must discard stale trailing progress');
}

const fixture = readFileSync(new URL('../fixtures/nax-v5-gallery.html', import.meta.url), 'utf8');
const runtimeCardAsset = 'cards/artist/danbooru-artist-tags-2-v5/artist-v5-new-card.webp';
assert.equal(catalogAssetFromProtocolUrl(`nai-catalog://asset/${runtimeCardAsset}`), runtimeCardAsset);
assert.equal(catalogAssetFromProtocolUrl(`nai-catalog://cards/artist/danbooru-artist-tags-2-v5/artist-v5-new-card.webp`), runtimeCardAsset);
assert.throws(() => catalogAssetFromProtocolUrl('nai-catalog://outside/cards/artist/danbooru-artist-tags-2-v5/artist-v5-new-card.webp'), /Invalid runtime catalog card asset/);
const guideManifest = JSON.parse(readFileSync(new URL('../../public/catalog/guide/manifest.json', import.meta.url), 'utf8'));
assert.equal(guideManifest.length, 281);
assert.equal(guideManifest.some(entry => /^2\.[34]\./.test(entry.section)), false);
assert.equal(guideManifest.filter(entry => /^5\.[1-4]\./.test(entry.section)).length, 33);
assert.equal(guideManifest.filter(entry => /^4\.[1-8]\./.test(entry.section)).length, 248);
const parsed = parseGalleryPage(fixture);
assert.deepEqual(parsed.pages, [1, 2]);
assert.equal(parsed.cards.length, 2);
assert.equal(parsed.cards[0].tag, 'Alpha artist');
assert.equal(parsed.cards[1].tag, 'Beta artist');
const requestedUrls = [];
const discovered = await discoverCards(async url => { requestedUrls.push(url); return { ok: true, text: async () => fixture }; });
assert.equal(discovered.length, 2);
assert.deepEqual(requestedUrls, [`${GALLERY_URL}&page=1`, `${GALLERY_URL}&page=2`]);
const strictParser = parseGalleryPage(`<a data-page="3"></a>
  <figure class="imagePanel"><img src="https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/allowed.webp"><figurecaption class="imageText">Allowed</figurecaption></figure>
  <figure class="imagePanel"><img src="https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v4.5/wrong-gallery.webp"><figurecaption class="imageText">Wrong gallery</figurecaption></figure>
  <figure class="imagePanel"><img src="https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/tags.zip"><figurecaption class="imageText">Tags archive</figurecaption></figure>`);
assert.deepEqual(strictParser.pages, [3]);
assert.deepEqual(strictParser.cards.map(card => card.tag), ['Allowed']);
assert.equal(isWebp(Buffer.from('RIFFxxxxWEBP')), true);
assert.equal(isWebp(Buffer.from('not webp')), false);
const runtimeParsed = parseRuntimeGalleryPage(fixture);
assert.deepEqual(runtimeParsed.pages, [1, 2]);
assert.equal(runtimeParsed.cards[1].sourceUrl.includes('%2520'), true);
assert.equal(normalizeRuntimeImageUrl(runtimeParsed.cards[1].sourceUrl), runtimeParsed.cards[1].sourceUrl);
assert.equal(normalizeRuntimeImageUrl('https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v4/a.webp'), null);
const runtimeWebp = Buffer.from('RIFFxxxxWEBP');
function runtimeResponse(url, body = fixture) { return { ok: true, status: 200, url, text: async () => body, arrayBuffer: async () => runtimeWebp }; }
function runtimeRoot(name) {
  const root = join(process.cwd(), '.qa-artifacts', `runtime-update-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const catalogDir = join(root, 'catalog');
  const embeddedPath = join(root, 'embedded.json');
  mkdirSync(catalogDir, { recursive: true });
  return { root, catalogDir, embeddedPath };
}
function embeddedArtist({ tag, sourceUrl, catalogId, image = 'catalog/embedded.webp', runtime = false }) {
  return { id: catalogId, catalogId, tag, gallery: 'danbooru-artist-tags-2-v5', image, sourceUrl, runtime };
}
async function runRuntimeFixture({ name, artists = [], body = fixture, onPage, onCard }) {
  const paths = runtimeRoot(name);
  writeFileSync(paths.embeddedPath, JSON.stringify({ version: 2, artists, characters: [], tags: ['girl'] }));
  // Embedded metadata is only authoritative when its loose-development image
  // actually exists and validates. Give fixture cards real WebP bytes so the
  // exact-source pruning path is exercised explicitly.
  for (const card of artists) {
    if (card.runtime || typeof card.image !== 'string' || /^(?:nai-|blob:|data:|\/)/i.test(card.image)) continue;
    const imagePath = join(paths.root, card.image);
    mkdirSync(join(imagePath, '..'), { recursive: true });
    writeFileSync(imagePath, runtimeWebp);
  }
  const calls = { page: [], card: [] };
  const fetchImpl = async (url, options = {}) => {
    if (url.startsWith(GALLERY_URL)) {
      calls.page.push(url);
      onPage?.(url, options, calls);
      return runtimeResponse(url, body);
    }
    calls.card.push(url);
    onCard?.(url, options, calls);
    return runtimeResponse(url);
  };
  const result = await runRuntimeCatalogUpdate({ ...paths, fetchImpl });
  return { ...paths, calls, result };
}

// A source already present in the embedded V5 snapshot is not fetched or
// copied into the runtime delta.  Only the genuinely new Beta card is fetched.
const exactEmbedded = embeddedArtist({ tag: 'Alpha artist', sourceUrl: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/a.webp', catalogId: 'embedded-alpha' });
const exactRun = await runRuntimeFixture({ name: 'exact-embedded', artists: [exactEmbedded] });
assert.equal(exactRun.result.added, 1);
assert.equal(exactRun.calls.card.filter(url => url.endsWith('/a.webp')).length, 0);
assert.equal(exactRun.calls.card.filter(url => url.includes('b%2520artist.webp')).length, 1);
const exactPointer = JSON.parse(readFileSync(join(exactRun.catalogDir, 'active.json'), 'utf8'));
const exactOverlay = JSON.parse(readFileSync(join(exactRun.catalogDir, 'generations', exactPointer.generation, 'catalog.json'), 'utf8'));
const sharedEmbeddedImage = 'catalog/shared.webp';
const sharedEmbeddedArtists = [
  embeddedArtist({ tag: 'Alpha artist', sourceUrl: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/a.webp', catalogId: 'shared-alpha', image: sharedEmbeddedImage }),
  embeddedArtist({ tag: 'Beta artist', sourceUrl: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/b%2520artist.webp', catalogId: 'shared-beta', image: sharedEmbeddedImage })
];
const originalRuntimeReadSync = nativeFs.readSync; let sharedBaseHeaderProbes = 0;
nativeFs.readSync = (descriptor, buffer, ...args) => { if (buffer?.length === 12) sharedBaseHeaderProbes += 1; return originalRuntimeReadSync(descriptor, buffer, ...args); };
let sharedBaseRun;
try { sharedBaseRun = await runRuntimeFixture({ name: 'shared-base-probe', artists: sharedEmbeddedArtists }); }
finally { nativeFs.readSync = originalRuntimeReadSync; }
assert.equal(sharedBaseRun.calls.card.length, 0);
assert.equal(sharedBaseHeaderProbes, 1, 'one runtime update must probe a repeated immutable base asset once');
assert.deepEqual(exactOverlay.artists.map(card => card.catalogId), ['artist-v5-beta-artist-qruygu']);
assert.equal(exactRun.result.catalog.artists.some(card => card.catalogId === 'embedded-alpha'), true);

// A changed raw URL is a genuinely new source even when the display tag is
// unchanged; exact source identity is required for reuse and ID preservation.
const changedEmbedded = embeddedArtist({ tag: 'Alpha artist', sourceUrl: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/alpha-old.webp', catalogId: 'embedded-alpha' });
const alphaOnlyFixture = `<nav><a data-page="1">A</a></nav><figure class="imagePanel"><img src="https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/a.webp"><figurecaption class="imageText">Alpha artist</figurecaption></figure>`;
const changedRun = await runRuntimeFixture({ name: 'tag-override', artists: [changedEmbedded], body: alphaOnlyFixture });
assert.equal(changedRun.result.changed, 0);
assert.equal(changedRun.result.added, 1);
assert.equal(changedRun.result.catalog.artists.find(card => card.sourceUrl.endsWith('/a.webp'))?.catalogId, 'artist-v5-alpha-artist-mfwvfy');
assert.equal(changedRun.result.catalog.artists.find(card => card.sourceUrl.endsWith('/a.webp'))?.runtime, true);
assert.equal(changedRun.calls.card.filter(url => url.endsWith('/a.webp')).length, 1);

// A clean runtime update adds both discovered identities.
const newRun = await runRuntimeFixture({ name: 'new-identities' });
assert.equal(newRun.result.added, 2);
assert.equal(newRun.calls.card.length, 2);
assert.equal(readFileSync(join(newRun.catalogDir, 'active.json'), 'utf8').includes('generation'), true);

// The next generation retains the prior runtime delta without downloading it
// again, while the merged catalog still contains both cards.
let secondPageCalls = 0;
const secondFetch = async (url, options = {}) => {
  if (url.startsWith(GALLERY_URL)) { secondPageCalls += 1; return runtimeResponse(url, fixture); }
  throw new Error(`unexpected second-update card fetch: ${url}`);
};
const secondResult = await runRuntimeCatalogUpdate({ catalogDir: newRun.catalogDir, embeddedPath: newRun.embeddedPath, fetchImpl: secondFetch });
assert.equal(secondResult.added, 0);
assert.equal(secondResult.changed, 0);
assert.equal(secondResult.catalog.artists.length, 2);
assert.equal(secondPageCalls, 2);

// The active overlay is a snapshot of the current V5 discovery. A card that
// disappears from NAX is pruned from the next generation and merged catalog.
const pruneFetch = async (url, options = {}) => {
  if (url.startsWith(GALLERY_URL)) return runtimeResponse(url, alphaOnlyFixture);
  throw new Error(`unexpected prune card fetch: ${url}`);
};
const prunedResult = await runRuntimeCatalogUpdate({ catalogDir: newRun.catalogDir, embeddedPath: newRun.embeddedPath, fetchImpl: pruneFetch });
assert.equal(prunedResult.catalog.artists.length, 1);
assert.equal(prunedResult.catalog.artists[0].tag, 'Alpha artist');
const prunedPointer = JSON.parse(readFileSync(join(newRun.catalogDir, 'active.json'), 'utf8'));
const prunedOverlay = JSON.parse(readFileSync(join(newRun.catalogDir, 'generations', prunedPointer.generation, 'catalog.json'), 'utf8'));
assert.deepEqual(prunedOverlay.artists.map(card => card.tag), ['Alpha artist']);

// If an override later resolves to an exact embedded source, the embedded
// card becomes authoritative and the runtime override is removed.
const revertEmbedded = embeddedArtist({ tag: 'Alpha artist', sourceUrl: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/a.webp', catalogId: 'embedded-alpha' });
const alphaChangedFixture = `<nav><a data-page="1">A</a></nav><figure class="imagePanel"><img src="https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/alpha-new.webp"><figurecaption class="imageText">Alpha artist</figurecaption></figure>`;
const revertInitial = await runRuntimeFixture({ name: 'override-reversion', artists: [revertEmbedded], body: alphaChangedFixture });
assert.equal(revertInitial.result.changed, 0);
assert.equal(revertInitial.result.added, 1);
assert.equal(revertInitial.result.catalog.artists.find(card => card.sourceUrl.endsWith('/alpha-new.webp'))?.runtime, true);
const revertResult = await runRuntimeCatalogUpdate({ catalogDir: revertInitial.catalogDir, embeddedPath: revertInitial.embeddedPath, fetchImpl: async url => {
  if (url.startsWith(GALLERY_URL)) return runtimeResponse(url, alphaOnlyFixture);
  throw new Error(`unexpected reversion card fetch: ${url}`);
} });
assert.equal(revertResult.added, 0);
assert.equal(revertResult.changed, 0);
assert.equal(revertResult.catalog.artists.length, 1);
assert.equal(revertResult.catalog.artists[0].catalogId, 'embedded-alpha');
assert.equal(revertResult.catalog.artists[0].runtime, false);
const revertPointer = JSON.parse(readFileSync(join(revertInitial.catalogDir, 'active.json'), 'utf8'));
const revertOverlay = JSON.parse(readFileSync(join(revertInitial.catalogDir, 'generations', revertPointer.generation, 'catalog.json'), 'utf8'));
assert.equal(revertOverlay.artists.length, 0);

const secondPointer = JSON.parse(readFileSync(join(newRun.catalogDir, 'active.json'), 'utf8'));
const secondOverlay = JSON.parse(readFileSync(join(newRun.catalogDir, 'generations', secondPointer.generation, 'catalog.json'), 'utf8'));
const activeAsset = resolveActiveCatalogAsset(newRun.catalogDir, secondOverlay.artists[0].image);
assert.equal(isWebp(readFileSync(activeAsset)), true);
assert.throws(() => resolveActiveCatalogAsset(newRun.catalogDir, 'active.json'), /invalid runtime catalog card asset/i);
assert.throws(() => resolveActiveCatalogAsset(newRun.catalogDir, '../active.json'), /invalid runtime catalog card asset/i);
assert.throws(() => resolveActiveCatalogAsset(newRun.catalogDir, `cards/artist/danbooru-artist-tags-2-v5/../active.json`), /invalid runtime catalog card asset/i);
const outsideRuntimeAsset = join(newRun.root, 'outside.webp');
writeFileSync(outsideRuntimeAsset, runtimeWebp);
let runtimeSymlinkCheckSkipped = false;
try {
  const activeFile = activeAsset;
  const backupFile = `${activeFile}.backup`;
  renameSync(activeFile, backupFile);
  symlinkSync(outsideRuntimeAsset, activeFile, 'file');
  assert.throws(() => resolveActiveCatalogAsset(newRun.catalogDir, secondOverlay.artists[0].image), /regular file|redirected/i);
  rmSync(activeFile, { force: true });
  renameSync(backupFile, activeFile);
} catch (error) {
  if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'UNKNOWN') runtimeSymlinkCheckSkipped = true;
  else throw error;
}
assert.equal(typeof runtimeSymlinkCheckSkipped, 'boolean');

// Existing but malformed active pointers must fail closed instead of silently
// falling back to the embedded snapshot.
const malformedPaths = runtimeRoot('malformed-pointer');
writeFileSync(malformedPaths.embeddedPath, JSON.stringify({ version: 2, artists: [], characters: [], tags: [] }));
const activePointerPath = join(malformedPaths.catalogDir, 'active.json');
writeFileSync(activePointerPath, '{not-json');
assert.throws(() => loadRuntimeCatalog(malformedPaths), /invalid active catalog pointer/i);
assert.throws(() => resolveActiveCatalogAsset(malformedPaths.catalogDir, 'cards/artist/danbooru-artist-tags-2-v5/missing.webp'), /invalid active catalog pointer/i);
for (const value of [{ generation: '../escape' }, { generation: 'bad/name' }, { generation: 42 }, {}, null]) {
  writeFileSync(activePointerPath, JSON.stringify(value));
  assert.throws(() => loadRuntimeCatalog(malformedPaths), /invalid active catalog pointer generation/i);
  assert.throws(() => resolveActiveCatalogAsset(malformedPaths.catalogDir, 'cards/artist/danbooru-artist-tags-2-v5/missing.webp'), /invalid active catalog pointer generation/i);
}
writeFileSync(activePointerPath, JSON.stringify({ generation: 'missing-generation' }));
assert.throws(() => loadRuntimeCatalog(malformedPaths), /invalid active catalog generation directory/i);
assert.throws(() => resolveActiveCatalogAsset(malformedPaths.catalogDir, 'cards/artist/danbooru-artist-tags-2-v5/missing.webp'), /invalid active catalog generation directory/i);
mkdirSync(join(malformedPaths.catalogDir, 'generations', 'empty-generation'), { recursive: true });
writeFileSync(activePointerPath, JSON.stringify({ generation: 'empty-generation' }));
assert.throws(() => loadRuntimeCatalog(malformedPaths), /invalid active catalog generation catalog/i);

// Cancellation before staging commit leaves the active pointer untouched.
const pointerBeforeCancel = readFileSync(join(newRun.catalogDir, 'active.json'), 'utf8');
const cancelController = new AbortController();
await assert.rejects(() => runRuntimeCatalogUpdate({
  catalogDir: newRun.catalogDir,
  embeddedPath: newRun.embeddedPath,
  signal: cancelController.signal,
  fetchImpl: async (url, options = {}) => {
    if (url.startsWith(GALLERY_URL) && url.endsWith('page=2')) cancelController.abort();
    return runtimeResponse(url, fixture);
  }
}), /cancelled/i);
assert.equal(readFileSync(join(newRun.catalogDir, 'active.json'), 'utf8'), pointerBeforeCancel);

// Abort exactly from the final validation progress callback. The old pointer
// must remain byte-for-byte unchanged because commit begins only afterwards.
const validationRun = await runRuntimeFixture({ name: 'cancel-final-validation' });
const pointerBeforeValidationCancel = readFileSync(join(validationRun.catalogDir, 'active.json'), 'utf8');
const validationController = new AbortController();
await assert.rejects(() => runRuntimeCatalogUpdate({
  catalogDir: validationRun.catalogDir,
  embeddedPath: validationRun.embeddedPath,
  signal: validationController.signal,
  fetchImpl: async url => {
    if (url.startsWith(GALLERY_URL)) return runtimeResponse(url, fixture);
    throw new Error(`unexpected validation card fetch: ${url}`);
  },
  onProgress: event => { if (event.phase === 'validation' && event.message === 'Staged catalog validated') validationController.abort(); }
}), /cancelled/i);
assert.equal(readFileSync(join(validationRun.catalogDir, 'active.json'), 'utf8'), pointerBeforeValidationCancel);

for (const paths of [exactRun, changedRun, newRun, revertInitial, malformedPaths, validationRun]) rmSync(paths.root, { recursive: true, force: true });

const temp = localTemp('nai-v5-atomic');
const liveCatalog = join(temp, 'catalog.json');
const liveArtistDir = join(temp, 'live-artists');
const stageCatalog = join(temp, 'stage-catalog.json');
const stageArtistDir = join(temp, 'stage-artists');
mkdirSync(liveArtistDir);
writeFileSync(liveCatalog, 'old-catalog');
writeFileSync(join(liveArtistDir, 'old.webp'), 'old-card');
writeFileSync(stageCatalog, 'new-catalog');
mkdirSync(stageArtistDir);
writeFileSync(join(stageArtistDir, 'new.webp'), 'new-card');
commitSnapshot({ stageCatalogPath: stageCatalog, stageArtistDir, catalogPath: liveCatalog, liveArtistDir });
assert.equal(readFileSync(liveCatalog, 'utf8'), 'new-catalog');
assert.equal(readFileSync(join(liveArtistDir, 'new.webp'), 'utf8'), 'new-card');

const failureCatalog = join(temp, 'failure-catalog.json');
const failureArtistDir = join(temp, 'failure-artists');
const failureStageCatalog = join(temp, 'failure-stage-catalog.json');
mkdirSync(failureArtistDir);
writeFileSync(failureCatalog, 'prior-catalog');
writeFileSync(join(failureArtistDir, 'prior.webp'), 'prior-card');
writeFileSync(failureStageCatalog, 'broken-catalog');
assert.throws(() => commitSnapshot({ stageCatalogPath: failureStageCatalog, stageArtistDir: join(temp, 'missing-stage-artists'), catalogPath: failureCatalog, liveArtistDir: failureArtistDir }));
assert.equal(readFileSync(failureCatalog, 'utf8'), 'prior-catalog');
assert.equal(readFileSync(join(failureArtistDir, 'prior.webp'), 'utf8'), 'prior-card');

const seedLive = join(temp, 'seed-live');
const seedStage = join(temp, 'seed-stage');
mkdirSync(seedLive);
mkdirSync(seedStage);
const seedCard = { tag: 'Seed artist', image: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/seed.webp', score: 0 };
const seedId = stableCatalogId(seedCard);
writeFileSync(join(seedLive, 'legacy-index.webp'), 'RIFFxxxxWEBP');
const seededCount = seedStageFromLive([seedCard], [{ id: seedId, catalogId: seedId, image: 'cards/artist/danbooru-artist-tags-2-v5/legacy-index.webp', sourceUrl: seedCard.image }], seedStage, seedLive);
assert.equal(seededCount, 1);
assert.equal(isWebp(readFileSync(join(seedStage, stableAssetFilename(seedCard)))), true);
const indexedExistingSeed = [{ id: seedId, catalogId: seedId, image: 'cards/artist/danbooru-artist-tags-2-v5/legacy-index.webp', sourceUrl: seedCard.image }];
Object.defineProperty(indexedExistingSeed, 'find', { value: () => { throw new Error('seed reuse must not linearly scan existing artists'); } });
assert.equal(seedStageFromLive([seedCard], indexedExistingSeed, seedStage, seedLive), 1, 'seed reuse builds one source index rather than invoking Array.find per card');
const changedSourceCard = { ...seedCard, image: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/seed-renamed.webp' };
assert.equal(seedStageFromLive([changedSourceCard], [{ id: 'legacy-id', catalogId: 'legacy-id', tag: seedCard.tag, image: 'cards/artist/danbooru-artist-tags-2-v5/legacy-index.webp', sourceUrl: seedCard.image }], seedStage, seedLive), 0);
writeFileSync(join(seedLive, 'invalid.webp'), 'not webp');
const invalidSeed = { ...seedCard, tag: 'Invalid seed', image: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/invalid.webp' };
assert.equal(seedStageFromLive([invalidSeed], [{ id: stableCatalogId(invalidSeed), catalogId: stableCatalogId(invalidSeed), image: 'cards/artist/danbooru-artist-tags-2-v5/invalid.webp', sourceUrl: invalidSeed.image }], seedStage, seedLive), 0);

rmSync(temp, { recursive: true, force: true });
const stableCard = { tag: 'Alpha artist', image: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/alpha.webp', score: 0 };
assert.equal(stableAssetFilename(stableCard), stableAssetFilename(stableCard));
assert.equal(makeCatalog([stableCard], { characters: [], danbooruTags: [] }).artists[0].image, `cards/artist/danbooru-artist-tags-2-v5/${stableAssetFilename(stableCard)}`);

console.log('catalog-runtime tests passed.');

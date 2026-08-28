import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildArtistsPrompt, buildBasePrompt, serializeTag } from '../src/prompt.ts';
import { MetadataArtistHighlighter, decodeCatalogEntities, escapeMetadataHtml, extractMetadataArtists, serializeMetadataArtists } from '../src/metadata-artist-highlight.ts';
import { normalizeAnimationMode, normalizeArtistMix, normalizeCustomTag, normalizeCustomTagPresetId, normalizeCustomTagPresets, normalizeDraft, normalizeRandomRange, normalizeSavedLibrary, normalizeSavedLibraryItem, normalizeTheme, normalizeSettings } from '../src/storage.ts';
import { DEFAULT_CUSTOM_TAG_PRESET_ID, DEFAULT_CUSTOM_TAG_PRESET_NAME } from '../src/custom-tag-presets.ts';
import { commitSnapshot, discoverCards, EXPECTED_CARD_COUNT, GALLERY_URL, isWebp, makeCatalog, parseGalleryPage, seedStageFromLive, stableAssetFilename, stableCatalogId } from './update-v5-catalog.mjs';
import { normalizeArtistWeight, pickUniqueCards, randomArtistSelection, randomCount, randomWeight, reconcileSelectedArtists, rerollArtistWeight, rerollArtistWeights, resolveRandomPoolRange } from '../src/random.ts';
import { decodePreviews } from '../src/preview-loader.ts';
import { ARTIST_PAGE_SIZE, CHARACTER_PAGE_SIZE, filterCharacters, paginateArtists, paginateCharacters } from '../src/catalog-browser.ts';
import { mixCompanionCapacity, mixCompanionScale, mixOrbitLayout } from '../src/artist-mix-layout.ts';
import { artistDisplayName, canonicalArtistIdentity, customArtistCatalogId, mergeArtistCatalog, migrateArtistAliases, migrateArtistMixAliases, migrateFavoriteAliases } from '../src/artist-catalog.ts';
import { decodeStealthPayload, extractImageMetadata, normalizeMetadata, parseMetadataJson, parsePngTextChunks, parseWebpExifUserComment } from '../src/image-metadata.ts';
import { BUILTIN_CONSTRUCTOR_FOLDER_ID, canonicalCustomTagIdentity, canonicalGroupIdentity, classifyGuideEntries, constructorCardTags, groupConstructorCards, guideVisualCount, hasPromptTag, hasPromptTagGroup, mergeConstructorCards, qualityPresetTags, searchConstructorFolders, splitTagGroup, togglePromptTag, togglePromptTagGroup } from '../src/prompt-constructor.ts';
import { buildWarmupPlan, scheduleIdleWarmup } from '../src/catalog-warmup.ts';

const require = createRequire(import.meta.url);
const nativeFs = require('node:fs');
const { createPackage, createPackageFromFiles, extractFile, listPackage } = require('@electron/asar');
const { resolveAppPaths, ensureWritable, migrateLegacyWorkspace } = require('../electron/app-paths.cjs');
const { containedAsset, hasValidMagic, validateImagePayload } = require('../electron/custom-tag-assets.cjs');
const { loadCatalog: loadRuntimeCatalog, parseGalleryPage: parseRuntimeGalleryPage, normalizeImageUrl: normalizeRuntimeImageUrl, runUpdate: runRuntimeCatalogUpdate, catalogAssetFromProtocolUrl, resolveActiveCatalogAsset } = require('../electron/catalog-updater.cjs');
const { compareVersions, validateManifest, readResponseJson, downloadInstaller, parseContentRange } = require('../electron/app-updater.cjs');
const { COMPONENTS, componentFile, componentPaths, normalizeDescriptor, verifyComponent, loadState, saveState, activateComponent, resolveComponentAsset, ensureComponent, ensureSelectedComponents, validateLegacyArchive, downloadComponent, inspectComponent, statusForComponent, statuses, safeRelative } = require('../electron/catalog-components.cjs');

const testTempRoot = join(process.cwd(), '.test-tmp-v063', String(process.pid));
mkdirSync(testTempRoot, { recursive: true });
const localTemp = prefix => mkdtempSync(join(testTempRoot, `${prefix}-`));

const legacySaved = normalizeSavedLibraryItem({ id: 'legacy-one', name: 'Legacy one', prompt: '1girl, soft light', createdAt: '2024-01-01T00:00:00.000Z' });
assert.equal(legacySaved?.kind, 'prompt');
assert.equal(legacySaved?.legacy, true);
assert.equal(legacySaved && Object.prototype.hasOwnProperty.call(legacySaved, 'snapshot'), false);
const normalizedSavedPrompt = normalizeSavedLibraryItem({ id: 'prompt-one', kind: 'prompt', name: 'Prompt one', prompt: 'base', snapshot: { base: { frame: '1girl', artists: [], setting: 'indoors', render: 'highres', undesired: '' }, characters: [{ id: 'char-one', label: 'A', prompt: 'girl', undesired: '' }], randomRange: { min: 3, max: 7 }, animationMode: 'off' } });
assert.equal(normalizedSavedPrompt?.kind, 'prompt');
assert.equal(normalizedSavedPrompt?.kind === 'prompt' ? normalizedSavedPrompt.snapshot?.base.frame : undefined, '1girl');
assert.equal(normalizedSavedPrompt?.kind === 'prompt' ? normalizedSavedPrompt.snapshot?.characters.length : undefined, 1);
assert.deepEqual(normalizedSavedPrompt?.kind === 'prompt' ? normalizedSavedPrompt.snapshot?.randomRange : undefined, { min: 3, max: 7 });
assert.equal(normalizedSavedPrompt?.kind === 'prompt' ? Object.prototype.hasOwnProperty.call(normalizedSavedPrompt.snapshot, 'animationMode') : false, false);
const normalizedSavedMix = normalizeSavedLibraryItem({ id: 'mix-one', kind: 'artist-mix', name: 'Mix one', prompt: 'artist: alpha', snapshot: { anchors: [{ id: 'a', catalogId: 'artist-v5-a', tag: 'artist: alpha', weight: 1 }], companions: [], randomRange: { min: 2, max: 4 }, favoritesOnly: true } });
assert.equal(normalizedSavedMix?.kind, 'artist-mix');
assert.equal(normalizedSavedMix?.kind === 'artist-mix' ? normalizedSavedMix.snapshot.anchors.length : undefined, 1);
assert.equal(normalizedSavedMix?.kind === 'artist-mix' ? normalizedSavedMix.snapshot.anchorWeightsLocked : undefined, true);
const cappedMix = normalizeArtistMix({ anchors: Array.from({ length: 3 }, (_, index) => ({ id: `anchor-${index}`, catalogId: `artist-v5-anchor-${index}`, tag: `artist: anchor ${index}`, weight: 1 })), companions: Array.from({ length: 9 }, (_, index) => ({ id: `companion-${index}`, catalogId: `artist-v5-companion-${index}`, tag: `artist: companion ${index}`, weight: 1 })) });
assert.equal(cappedMix.anchors.length, 3);
assert.equal(cappedMix.companions.length, 9);
for (const anchorCount of [1, 2, 3, 4]) {
  const retainedMix = normalizeArtistMix({
    anchors: Array.from({ length: anchorCount }, (_, index) => ({ id: `retained-anchor-${index}`, catalogId: `artist-v5-retained-anchor-${index}`, tag: `artist: retained anchor ${index}`, weight: 1 })),
    companions: Array.from({ length: 12 - anchorCount }, (_, index) => ({ id: `retained-companion-${index}`, catalogId: `artist-v5-retained-companion-${index}`, tag: `artist: retained companion ${index}`, weight: 1 }))
  });
  assert.equal(retainedMix.anchors.length + retainedMix.companions.length, 12);
  assert.equal(retainedMix.companions.length, mixCompanionCapacity(anchorCount));
}
assert.deepEqual(normalizeSavedLibrary([legacySaved, normalizedSavedPrompt, normalizedSavedPrompt]), [legacySaved, normalizedSavedPrompt]);
assert.equal(normalizeTheme('raspberry-rose'), 'raspberry-rose');
assert.equal(normalizeTheme('noir'), 'noir');
assert.equal(normalizeTheme('unsupported'), 'arcane-gold');
assert.equal(normalizeTheme('celestial-light'), 'celestial-light');
assert.equal(normalizeTheme('ember-peach'), 'ember-peach');
assert.equal(normalizeTheme('gothic-ivory'), 'gothic-ivory');
assert.equal(normalizeTheme('galaxy'), 'galaxy');
const v4SavedPrompt = normalizeSavedLibraryItem({ id: 'v4-prompt', version: 4, kind: 'prompt', source: 'manual', name: 'Independent', description: 'A complete local record', prompt: 'base positive', imageAsset: 'v4-prompt.webp', mime: 'image/webp', createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z', data: { model: 'nai-diffusion-4', steps: '28', sampler: 'k_euler', width: '832', height: '1216', cfg: '5', positive: 'base positive', negative: 'base negative', characters: [{ id: 'one', label: 'Hero', positive: 'hero positive', negative: 'hero negative' }] } });
assert.equal(v4SavedPrompt?.kind === 'prompt' ? v4SavedPrompt.data?.characters[0].negative : '', 'hero negative');
assert.equal(v4SavedPrompt?.imageAsset, 'v4-prompt.webp');
const artistExtractionFixture = [{ id: 'artist-v5-known', catalogId: 'artist-v5-known', tag: 'Known Artist 7', gallery: 'v5', image: 'known.webp', score: 0 }];
const extractedMetadataArtists = extractMetadataArtists('artist: Unknown Painter::1.4, 0.8::Known Artist 7 ::, Known Artist 7', artistExtractionFixture);
assert.equal(extractedMetadataArtists.length, 2);
assert.equal(extractedMetadataArtists[0].tag, 'artist: Unknown Painter');
assert.equal(extractedMetadataArtists[0].weight, 1.4);
assert.equal(extractedMetadataArtists[1].catalogId, 'artist-v5-known');
assert.match(serializeMetadataArtists(extractedMetadataArtists), /Known Artist 7 ::/);
const canonicalSerializedMetadataArtists = extractMetadataArtists('1.4::artist: Known Artist 7::', artistExtractionFixture);
assert.equal(canonicalSerializedMetadataArtists.length, 1);
assert.equal(canonicalSerializedMetadataArtists[0].weight, 1.4);
const canonicalUnknownMetadataArtist = extractMetadataArtists('1.4::artist: Unknown Painter::', []);
assert.equal(canonicalUnknownMetadataArtist.length, 1);
assert.equal(canonicalUnknownMetadataArtist[0].tag, 'artist: Unknown Painter');
assert.equal(canonicalUnknownMetadataArtist[0].weight, 1.4);

assert.equal(compareVersions('0.4.0', '0.3.9'), 1);
assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
const validUpdateManifest = { schemaVersion: 1, version: '0.4.1', asset: 'NAI-Prompt-Studio-V5-Setup-0.4.1.exe', url: 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.4.1/NAI-Prompt-Studio-V5-Setup-0.4.1.exe', size: 4096, sha512: 'a'.repeat(128), releaseNotes: 'Fixture' };
assert.equal(validateManifest(validUpdateManifest, '0.4.0').available, true);
assert.equal(validateManifest({ ...validUpdateManifest, version: '0.3.9' }, '0.4.0').available, false);
assert.throws(() => validateManifest({ ...validUpdateManifest, version: 'latest' }, '0.4.0'), /invalid semantic version/i);
assert.throws(() => validateManifest({ ...validUpdateManifest, url: 'https://example.com/NAI-Prompt-Studio-V5-Setup-0.4.1.exe' }, '0.4.0'), /host is not trusted/i);
assert.throws(() => validateManifest({ ...validUpdateManifest, sha512: 'invalid' }, '0.4.0'), /SHA-512/i);
assert.deepEqual(parseContentRange('bytes 10-20/42'), { start: 10, end: 20, total: 42 });
assert.equal(parseContentRange('bytes 10-/42'), null);

function mockedResponse(chunks, statusCode = 200, headers = {}, complete = true) {
  const response = Readable.from(chunks);
  response.statusCode = statusCode;
  response.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  response.complete = complete;
  return response;
}
function updateFixture(bytes = 4096) {
  const payload = Buffer.alloc(bytes, 73);
  return { payload, manifest: { available: true, schemaVersion: 1, version: '0.5.6', asset: 'NAI-Prompt-Studio-V5-Setup-0.5.6.exe', url: 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.6/NAI-Prompt-Studio-V5-Setup-0.5.6.exe', size: payload.length, sha512: createHash('sha512').update(payload).digest('hex'), releaseNotes: 'Fixture' } };
}
const manifestStall = new Readable({ read() {} });
manifestStall.complete = false;
await assert.rejects(readResponseJson(manifestStall, 1024, { idleTimeoutMs: 5 }), /manifest response stalled/i);
const manifestAbortController = new AbortController();
const manifestAbort = new Readable({ read() {} });
manifestAbort.complete = false;
const manifestAbortPromise = readResponseJson(manifestAbort, 1024, { idleTimeoutMs: 1000, signal: manifestAbortController.signal });
manifestAbortController.abort();
await assert.rejects(manifestAbortPromise, error => error?.code === 'ABORT_ERR');
const updateTemp = localTemp('nai-update');
const normalFixture = updateFixture();
const normalProgress = [];
const normalTarget = await downloadInstaller(normalFixture.manifest, updateTemp, { requestImpl: async () => mockedResponse([normalFixture.payload]), onProgress: event => normalProgress.push(event), retryDelayMs: 0 });
assert.equal(readFileSync(normalTarget).equals(normalFixture.payload), true);
assert.equal(normalProgress.at(-1).phase, 'ready');
assert.equal(normalProgress.at(-1).percent, 100);
rmSync(normalTarget, { force: true });
const resumeFixture = updateFixture();
const resumePartial = join(updateTemp, resumeFixture.manifest.asset + '.partial');
const resumeSplit = 1300;
writeFileSync(resumePartial, resumeFixture.payload.subarray(0, resumeSplit));
const resumeHeaders = [];
let resumeAttempt = 0;
await downloadInstaller(resumeFixture.manifest, updateTemp, { maxAttempts: 2, retryDelayMs: 0, requestImpl: async (_url, request) => {
  resumeHeaders.push(request.headers?.Range || '');
  resumeAttempt += 1;
  if (resumeAttempt === 1) return mockedResponse([resumeFixture.payload.subarray(resumeSplit, resumeSplit + 700)], 206, { 'content-range': `bytes ${resumeSplit}-${resumeSplit + 699}/${resumeFixture.manifest.size}`, 'content-length': 700 }, false);
  const start = Number(String(request.headers?.Range || '').match(/(\d+)/)?.[1] ?? resumeSplit);
  return mockedResponse([resumeFixture.payload.subarray(start)], 206, { 'content-range': `bytes ${start}-${resumeFixture.manifest.size - 1}/${resumeFixture.manifest.size}`, 'content-length': resumeFixture.manifest.size - start });
} });
assert.deepEqual(resumeHeaders, [`bytes=${resumeSplit}-`, `bytes=${resumeSplit + 700}-`]);
assert.equal(readFileSync(join(updateTemp, resumeFixture.manifest.asset)).equals(resumeFixture.payload), true);
const restartFixture = updateFixture();
restartFixture.manifest.version = '0.5.7';
restartFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.7.exe';
restartFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.7/NAI-Prompt-Studio-V5-Setup-0.5.7.exe';
const restartPartial = join(updateTemp, restartFixture.manifest.asset + '.partial');
writeFileSync(restartPartial, Buffer.alloc(200, 1));
let restartRange = '';
await downloadInstaller(restartFixture.manifest, updateTemp, { requestImpl: async (_url, request) => { restartRange = request.headers?.Range || ''; return mockedResponse([restartFixture.payload]); } });
assert.equal(restartRange, 'bytes=200-');
assert.equal(readFileSync(join(updateTemp, restartFixture.manifest.asset)).equals(restartFixture.payload), true);
const complete416Fixture = updateFixture();
complete416Fixture.manifest.version = '0.5.8';
complete416Fixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.8.exe';
complete416Fixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.8/NAI-Prompt-Studio-V5-Setup-0.5.8.exe';
const complete416Partial = join(updateTemp, complete416Fixture.manifest.asset + '.partial');
writeFileSync(complete416Partial, complete416Fixture.payload);
let complete416Calls = 0;
await downloadInstaller(complete416Fixture.manifest, updateTemp, { forceRangeRequest: true, requestImpl: async (_url, request) => { complete416Calls += 1; assert.equal(request.headers.Range, `bytes=${complete416Fixture.manifest.size}-`); return mockedResponse([], 416); } });
assert.equal(complete416Calls, 1);
assert.equal(readFileSync(join(updateTemp, complete416Fixture.manifest.asset)).equals(complete416Fixture.payload), true);
const invalid416Fixture = updateFixture();
invalid416Fixture.manifest.version = '0.5.13';
invalid416Fixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.13.exe';
invalid416Fixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.13/NAI-Prompt-Studio-V5-Setup-0.5.13.exe';
const invalid416Partial = join(updateTemp, invalid416Fixture.manifest.asset + '.partial');
writeFileSync(invalid416Partial, invalid416Fixture.payload.subarray(0, 100));
await assert.rejects(downloadInstaller(invalid416Fixture.manifest, updateTemp, { maxAttempts: 1, requestImpl: async () => mockedResponse([], 416) }), /incomplete resume range/i);
assert.equal(readdirSync(updateTemp).includes(invalid416Fixture.manifest.asset + '.partial'), false);
const malformedFixture = updateFixture();
malformedFixture.manifest.version = '0.5.9';
malformedFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.9.exe';
malformedFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.9/NAI-Prompt-Studio-V5-Setup-0.5.9.exe';
const malformedPartial = join(updateTemp, malformedFixture.manifest.asset + '.partial');
writeFileSync(malformedPartial, Buffer.alloc(200, 4));
let malformedCalls = 0;
await downloadInstaller(malformedFixture.manifest, updateTemp, { maxAttempts: 2, retryDelayMs: 0, requestImpl: async () => { malformedCalls += 1; return malformedCalls === 1 ? mockedResponse([Buffer.alloc(10)], 206, { 'content-range': 'bytes 999-1008/4096', 'content-length': 10 }) : mockedResponse([malformedFixture.payload]); } });
assert.equal(malformedCalls, 2);
assert.equal(readFileSync(join(updateTemp, malformedFixture.manifest.asset)).equals(malformedFixture.payload), true);
const timeoutFixture = updateFixture();
timeoutFixture.manifest.version = '0.5.11';
timeoutFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.11.exe';
timeoutFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.11/NAI-Prompt-Studio-V5-Setup-0.5.11.exe';
await assert.rejects(downloadInstaller(timeoutFixture.manifest, updateTemp, { maxAttempts: 1, idleTimeoutMs: 5, requestImpl: async () => {
  const response = new Readable({ read() {} }); response.statusCode = 200; response.headers = {}; response.complete = false; return response;
} }), /stalled|premature/i);
const cancelFixture = updateFixture();
cancelFixture.manifest.version = '0.5.12';
cancelFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.12.exe';
cancelFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.12/NAI-Prompt-Studio-V5-Setup-0.5.12.exe';
const updateCancelController = new AbortController();
const updateCancelStream = new Readable({ read() { if (!this.sent) { this.sent = true; this.push(cancelFixture.payload.subarray(0, 500)); } } });
updateCancelStream.statusCode = 200; updateCancelStream.headers = {}; updateCancelStream.complete = false;
await assert.rejects(downloadInstaller(cancelFixture.manifest, updateTemp, { signal: updateCancelController.signal, maxAttempts: 1, idleTimeoutMs: 1000, requestImpl: async () => updateCancelStream, onProgress: event => { if (event.phase === 'downloading' && event.completed > 0) updateCancelController.abort(); } }), error => error?.code === 'ABORT_ERR');
assert.equal(readFileSync(join(updateTemp, cancelFixture.manifest.asset + '.partial')).length, 500);
const mismatchFixture = updateFixture();
 mismatchFixture.manifest.version = '0.5.10';
 mismatchFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.10.exe';
 mismatchFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.10/NAI-Prompt-Studio-V5-Setup-0.5.10.exe';
await assert.rejects(downloadInstaller({ ...mismatchFixture.manifest, sha512: 'f'.repeat(128) }, updateTemp, { maxAttempts: 1, requestImpl: async () => mockedResponse([mismatchFixture.payload]) }), /size or SHA-512/i);
assert.equal(readdirSync(updateTemp).includes(mismatchFixture.manifest.asset + '.partial'), false);
const fullMismatchFixture = updateFixture();
fullMismatchFixture.manifest.version = '0.5.18';
fullMismatchFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.18.exe';
fullMismatchFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.18/NAI-Prompt-Studio-V5-Setup-0.5.18.exe';
writeFileSync(join(updateTemp, fullMismatchFixture.manifest.asset + '.partial'), Buffer.alloc(fullMismatchFixture.manifest.size, 1));
let fullMismatchRange = 'unset';
await downloadInstaller(fullMismatchFixture.manifest, updateTemp, { maxAttempts: 1, requestImpl: async (_url, request) => { fullMismatchRange = request.headers?.Range || ''; return mockedResponse([fullMismatchFixture.payload]); } });
assert.equal(fullMismatchRange, '');
const oversizeFixture = updateFixture();
oversizeFixture.manifest.version = '0.5.14';
oversizeFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.14.exe';
oversizeFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.14/NAI-Prompt-Studio-V5-Setup-0.5.14.exe';
await assert.rejects(downloadInstaller(oversizeFixture.manifest, updateTemp, { maxAttempts: 1, requestImpl: async () => mockedResponse([Buffer.concat([oversizeFixture.payload, Buffer.from([1])])]) }), /exceeded the manifest size/i);
assert.equal(readdirSync(updateTemp).includes(oversizeFixture.manifest.asset + '.partial'), false);
const shortFixture = updateFixture();
shortFixture.manifest.version = '0.5.15';
shortFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.15.exe';
shortFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.15/NAI-Prompt-Studio-V5-Setup-0.5.15.exe';
await assert.rejects(downloadInstaller(shortFixture.manifest, updateTemp, { maxAttempts: 1, requestImpl: async () => mockedResponse([shortFixture.payload.subarray(0, 200)]) }), /ended before the manifest size/i);
assert.equal(readFileSync(join(updateTemp, shortFixture.manifest.asset + '.partial')).length, 200);
rmSync(join(updateTemp, shortFixture.manifest.asset + '.partial'), { force: true });
const prematureFixture = updateFixture();
prematureFixture.manifest.version = '0.5.16';
prematureFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.16.exe';
prematureFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.16/NAI-Prompt-Studio-V5-Setup-0.5.16.exe';
await assert.rejects(downloadInstaller(prematureFixture.manifest, updateTemp, { maxAttempts: 1, requestImpl: async () => mockedResponse([prematureFixture.payload.subarray(0, 200)], 200, {}, false) }), /prematurely/i);
assert.equal(readFileSync(join(updateTemp, prematureFixture.manifest.asset + '.partial')).length, 200);
rmSync(join(updateTemp, prematureFixture.manifest.asset + '.partial'), { force: true });
const reuseFixture = updateFixture();
reuseFixture.manifest.version = '0.5.17';
reuseFixture.manifest.asset = 'NAI-Prompt-Studio-V5-Setup-0.5.17.exe';
reuseFixture.manifest.url = 'https://github.com/shiza2xx/nai-prompt-studio/releases/download/v0.5.17/NAI-Prompt-Studio-V5-Setup-0.5.17.exe';
const reuseTarget = await downloadInstaller(reuseFixture.manifest, updateTemp, { requestImpl: async () => mockedResponse([reuseFixture.payload]) });
const reuseProgress = [];
assert.equal(await downloadInstaller(reuseFixture.manifest, updateTemp, { requestImpl: async () => { throw new Error('verified target should be reused'); }, onProgress: event => reuseProgress.push(event) }), reuseTarget);
assert.equal(reuseProgress.at(-1).message, 'Verified update already downloaded.');
rmSync(updateTemp, { recursive: true, force: true });

let loaderActive = 0;
let loaderPeak = 0;
const loaderProgress = [];
const loaderResult = await decodePreviews([1, 2, 3, 4, 5], async item => {
  loaderActive += 1;
  loaderPeak = Math.max(loaderPeak, loaderActive);
  await new Promise(resolve => setTimeout(resolve, 0));
  loaderActive -= 1;
  return item !== 3;
}, 2, (completed, total) => loaderProgress.push([completed, total]));
assert.equal(loaderPeak, 2);
assert.deepEqual(loaderResult.failed, [3]);
assert.equal(loaderResult.completed, 5);
assert.deepEqual(loaderProgress.at(-1), [5, 5]);

const guideFixture = [
  { tag: 'upper_body', section: '5.1. Shot Types', image: 'frame.png', description: 'A framing guide' },
  { tag: 'gothic', section: '4.5. Genre Mood', image: 'scene.png', description: 'A mood guide' },
  { tag: 'anime coloring', section: '4.3. Coloring Shading', image: 'render.png', description: 'A rendering guide' },
  { tag: 'Euler', section: '2.3. Style Reference (style yoinker)', image: 'excluded.png' }
];
assert.deepEqual(guideVisualCount(guideFixture), { frame: 1, scene: 1, render: 1 });
const constructorFixture = classifyGuideEntries(guideFixture);
assert.equal(constructorFixture.filter(card => card.kind === 'preset').length, 1);
assert.equal(constructorFixture.find(card => card.tag === 'upper_body')?.description, 'A framing guide');
assert.deepEqual(qualityPresetTags(), ['solo artist', '-5.3::artist collaboration::', 'year 2024', 'year 2023', 'year 2022', 'year 2021', '-1::clean text::', '-1::flat color::', 'natural', 'incredibly absurdres', 'very aesthetic', 'highres', 'masterpiece', 'best quality', 'amazing quality', '-3::simple illustration::', 'best illustration', 'novel illustration']);
assert.equal(togglePromptTag('1girl, 1.2::upper_body::, upper_body88', 'upper_body'), '1girl, upper_body88');
assert.equal(togglePromptTag('alpha, upper_body, Upper Body, 1.2::upper_body::, omega', 'upper body'), 'alpha, omega');
assert.equal(togglePromptTag('alpha, upper_body, Upper Body, 1.2::upper_body::, omega', 'upper_body'), 'alpha, omega');
assert.equal(hasPromptTag('1girl, upper_body', 'upper_body'), true);
assert.equal(hasPromptTag('1girl, -5.3::artist collaboration::', '-5.3::artist collaboration::'), true);
assert.equal(togglePromptTag('-5.3::artist collaboration::', '-5.3::artist collaboration::'), '');
assert.equal(togglePromptTag('', '-5.3::artist collaboration::'), '-5.3::artist collaboration::');
const commaGroup = 'tag1, tag2, tag1, , tag2';
assert.deepEqual(splitTagGroup(commaGroup), ['tag1', 'tag2']);
assert.equal(canonicalGroupIdentity('Tag_One, 2::tag two::'), canonicalGroupIdentity('TAG TWO, tag one'));
assert.equal(canonicalCustomTagIdentity('scene', 'Tag_One, 2::tag two::'), 'scene:tag one|tag two');
const partialGroupPrompt = togglePromptTagGroup('neighbor, 1.2::Tag_One::, tag_one_extra, tail', 'tag one, tag_two');
assert.equal(partialGroupPrompt, 'neighbor, 1.2::Tag_One::, tag_one_extra, tail, tag_two');
assert.equal(hasPromptTagGroup(partialGroupPrompt, 'TAG_ONE, 3::tag two::'), true);
assert.equal(togglePromptTagGroup(partialGroupPrompt, 'tag_one, TAG_TWO'), 'neighbor, tag_one_extra, tail');
const commaRecord = { id: 'one-card', tag: 'tag1, tag2, tag3', tags: splitTagGroup('tag1, tag2, tag3'), zone: 'frame', section: 'Custom', image: 'custom.png', kind: 'tag' };
assert.equal([commaRecord].length, 1);
assert.equal(commaRecord.tag, 'tag1, tag2, tag3');
assert.deepEqual(constructorCardTags(commaRecord), ['tag1', 'tag2', 'tag3']);
const presetPrompt = qualityPresetTags().map((tag, index) => index === 1 ? tag : tag.replace(/::$/, '')).join(', ');
assert.equal(qualityPresetTags().every(tag => hasPromptTag(presetPrompt, tag)), true);
assert.equal(qualityPresetTags().reduce((value, tag) => togglePromptTag(value, tag), presetPrompt), '');
const customOverride = { id: 'custom', tag: 'gothic', section: 'Custom', image: 'custom.png', zone: 'scene', kind: 'tag' };
assert.equal(mergeConstructorCards(constructorFixture, [customOverride]).filter(card => card.tag === 'gothic').length, 1);
const folderCards = [
  { id: 'guide-frame', tag: 'upper_body', section: '5.1. Shot Types', image: 'frame.png', zone: 'frame', kind: 'tag' },
  { id: 'custom-second-a', tag: 'moonlit', section: 'Custom', image: 'custom.png', zone: 'frame', kind: 'tag', presetId: 'second', group: 'Second folder', description: 'Night guide' },
  { id: 'custom-first', tag: 'soft focus', section: 'Custom', image: 'custom.png', zone: 'frame', kind: 'tag', presetId: 'first', group: 'First folder', description: 'Portrait guide' },
  { id: 'custom-second-b', tag: 'lantern', section: 'Custom', image: 'custom.png', zone: 'frame', kind: 'tag', presetId: 'second', group: 'Second folder', description: 'Warm light needle' }
];
const groupedFolders = groupConstructorCards(folderCards, [{ id: 'first', name: 'First folder' }, { id: 'second', name: 'Second folder' }, { id: 'empty', name: 'Empty folder' }]);
assert.deepEqual(groupedFolders.map(folder => folder.id), [BUILTIN_CONSTRUCTOR_FOLDER_ID, 'first', 'second']);
assert.equal(groupedFolders.find(folder => folder.id === BUILTIN_CONSTRUCTOR_FOLDER_ID)?.cards.length, 1);
assert.equal(groupedFolders.find(folder => folder.id === 'empty'), undefined);
const folderNameSearch = searchConstructorFolders(groupedFolders, 'second');
assert.deepEqual(folderNameSearch.map(folder => folder.cards.map(card => card.tag)), [['moonlit', 'lantern']]);
assert.equal(folderNameSearch[0].folderNameMatch, true);
const descriptionSearch = searchConstructorFolders(groupedFolders, 'needle');
assert.deepEqual(descriptionSearch.map(folder => folder.cards.map(card => card.tag)), [['lantern']]);
assert.deepEqual(groupedFolders.find(folder => folder.id === 'second')?.cards.map(card => card.tag), ['moonlit', 'lantern']);
const collisionFolders = groupConstructorCards([
  { id: 'guide-collision', tag: 'wide shot', section: '5.1. Shot Types', image: 'frame.png', zone: 'frame', kind: 'tag' },
  { id: 'custom-collision', tag: 'user wide shot', section: 'Custom', image: 'custom.png', zone: 'frame', kind: 'tag', presetId: 'hothottuk', group: 'User hothottuk', description: 'Custom collision regression' }
], [{ id: 'hothottuk', name: 'User hothottuk' }]);
assert.equal(collisionFolders.length, 2);
assert.equal(collisionFolders[0].name, 'hothottuk');
assert.equal(collisionFolders[1].name, 'User hothottuk');
assert.notEqual(collisionFolders[0].id, collisionFolders[1].id);
assert.equal(collisionFolders[1].id, 'hothottuk');
assert.deepEqual(collisionFolders[1].cards.map(card => card.tag), ['user wide shot']);
assert.equal(hasValidMagic(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'), true);
assert.equal(hasValidMagic(Buffer.from('RIFFxxxxWEBP'), 'image/webp'), true);
assert.throws(() => validateImagePayload(Buffer.from('not an image'), 'image/png'), /signature/i);
assert.throws(() => containedAsset('D:/profile/custom-tags', '../outside.png'), /invalid|outside/i);
const assetTemp = localTemp('nai-custom-assets');
const assetRoot = join(assetTemp, 'custom-tags');
mkdirSync(assetRoot);
const outsideAsset = join(assetTemp, 'outside.png');
writeFileSync(outsideAsset, 'outside');
let symlinkChecksSkipped = false;
try {
  symlinkSync(outsideAsset, join(assetRoot, 'asset-link.png'), 'file');
  assert.throws(() => containedAsset(assetRoot, 'asset-link.png'), /symbolic|redirect/i);
  const redirectedRoot = join(assetTemp, 'redirected-root');
  symlinkSync(assetRoot, redirectedRoot, 'junction');
  assert.throws(() => containedAsset(redirectedRoot, 'outside.png'), /directory|redirect/i);
} catch (error) {
  if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'UNKNOWN') symlinkChecksSkipped = true;
  else throw error;
} finally { rmSync(assetTemp, { recursive: true, force: true }); }
assert.equal(typeof symlinkChecksSkipped, 'boolean');

const fixture = readFileSync(new URL('./fixtures/nax-v5-gallery.html', import.meta.url), 'utf8');
const runtimeCardAsset = 'cards/artist/danbooru-artist-tags-2-v5/artist-v5-new-card.webp';
assert.equal(catalogAssetFromProtocolUrl(`nai-catalog://asset/${runtimeCardAsset}`), runtimeCardAsset);
assert.equal(catalogAssetFromProtocolUrl(`nai-catalog://cards/artist/danbooru-artist-tags-2-v5/artist-v5-new-card.webp`), runtimeCardAsset);
assert.throws(() => catalogAssetFromProtocolUrl('nai-catalog://outside/cards/artist/danbooru-artist-tags-2-v5/artist-v5-new-card.webp'), /Invalid runtime catalog card asset/);
const guideManifest = JSON.parse(readFileSync(new URL('../public/catalog/guide/manifest.json', import.meta.url), 'utf8'));
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
  const extracted = normalizeMetadata(parseMetadataJson(parseWebpExifUserComment(new Uint8Array(readFileSync(new URL(`../${name}`, import.meta.url))))));
  assert.deepEqual([extracted.model, extracted.steps, extracted.sampler, extracted.width, extracted.height, extracted.scale, extracted.characters.length], ['NovelAI Diffusion V5', '28', 'k_euler_ancestral', '1024', '1024', '5', 1]);
  assert.ok(extracted.base.positive.startsWith(startsWith));
  assert.deepEqual([extracted.characters[0].positive.length, extracted.characters[0].negative.length], lengths);
  const extractedFromFile = await extractImageMetadata({ type: 'text/plain', arrayBuffer: async () => exactArrayBuffer(readFileSync(new URL(`../${name}`, import.meta.url))) } );
  assert.deepEqual(extractedFromFile, extracted);
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

const artists = [{ id: 'a', catalogId: 'artist-v5-1', tag: 'artist: alpha', weight: 1 }, { id: 'b', catalogId: 'artist-v5-2', tag: 'artist: beta', weight: 0.9 }];
assert.equal(serializeTag(artists[0]), '1.0::artist: alpha::');
assert.equal(serializeTag(artists[1]), '0.9::artist: beta::');
assert.equal(serializeTag({ id: 'digit', tag: 'artist: aogisa88', weight: 1.8 }), '1.8::artist: aogisa88 ::');
assert.equal(serializeTag({ id: 'plain', tag: 'artist: aogisa', weight: 1.8 }), '1.8::artist: aogisa::');
assert.equal(serializeTag({ id: 'trimmed', tag: '  artist: aki99   ', weight: 1 }), '1.0::artist: aki99 ::');
assert.equal(buildBasePrompt({ frame: '1girl', artists, setting: 'indoors', render: 'best quality', undesired: 'watermark' }), '1girl, 1.0::artist: alpha::, 0.9::artist: beta::, indoors, best quality');
assert.equal(buildArtistsPrompt(artists), '1.0::artist: alpha::, 0.9::artist: beta::');
assert.notEqual(buildArtistsPrompt(artists), buildBasePrompt({ frame: '1girl', artists, setting: 'indoors', render: 'best quality', undesired: '' }));
assert.equal(buildBasePrompt({ frame: 'FRAME', artists: [], setting: 'SCENE', render: 'RENDER', undesired: 'UC', }), 'FRAME, SCENE, RENDER');
assert.equal(normalizeRandomRange({ min: 2, max: 5 }).min, 2);
assert.equal(normalizeRandomRange({ min: 2, max: 5 }).max, 5);
const migrated = normalizeDraft({ base: { frame: 'custom frame', artists: [{ id: 'old', tag: 'artist: legacy', weight: 1 }], setting: 'custom scene', render: 'custom render', undesired: 'keep uc' }, characters: [{ id: 'character-v4.5-1', label: 'Hero', prompt: 'girl', undesired: '' }], randomRange: { min: 3, max: 4 } });
assert.deepEqual(migrated?.base.artists, []);
assert.equal(migrated?.base.frame, 'custom frame');
assert.equal(migrated?.characters[0].label, 'Hero');
assert.deepEqual(migrated?.randomRange, { min: 3, max: 4 });
assert.equal(normalizeAnimationMode(undefined), 'auto');
assert.equal(normalizeAnimationMode('invalid'), 'auto');
assert.equal(normalizeAnimationMode('on'), 'on');
assert.equal(normalizeAnimationMode('off'), 'off');
assert.deepEqual(normalizeSettings(undefined), { animationMode: 'auto', preloadCharacterPreviews: false, theme: 'arcane-gold', updateCatalogOnStartup: true, checkAppUpdatesOnStartup: true, seenGuideIds: [], lastSeenVersion: '' });
assert.deepEqual(normalizeSettings({ preloadCharacterPreviews: true, theme: 'midnight-blue', updateCatalogOnStartup: false, checkAppUpdatesOnStartup: false, seenGuideIds: ['overview'], lastSeenVersion: '0.4.0' }, 'off'), { animationMode: 'off', preloadCharacterPreviews: true, theme: 'midnight-blue', updateCatalogOnStartup: false, checkAppUpdatesOnStartup: false, seenGuideIds: ['overview'], lastSeenVersion: '0.4.0' });
const normalizedMix = normalizeArtistMix({ primary: { id: 'primary', catalogId: 'artist-v5-primary', tag: 'artist: primary', weight: 1 }, companions: [{ id: 'same', catalogId: 'artist-v5-primary', tag: 'artist: duplicate', weight: 2 }, { id: 'companion', catalogId: 'artist-v5-companion', tag: 'artist: companion', weight: 0.3 }], randomRange: { min: 1, max: 1 }, favoritesOnly: true });
assert.equal(normalizedMix.version, 2);
assert.equal(normalizedMix.anchors[0]?.catalogId, 'artist-v5-primary');
assert.deepEqual(normalizedMix.companions.map(item => item.catalogId), ['artist-v5-companion']);
assert.deepEqual(normalizedMix.randomRange, { min: 2, max: 2 });
assert.equal(normalizedMix.favoritesOnly, true);
assert.equal(normalizedMix.anchorWeightsLocked, true);
assert.equal(normalizeArtistMix({ anchorWeightsLocked: false }).anchorWeightsLocked, false);
assert.equal(normalizeArtistMix({ anchorWeightsLocked: true }).anchorWeightsLocked, true);
assert.equal(migrated?.version, 2);
assert.equal(migrated?.animationMode, 'auto');
const motionOn = normalizeDraft({ ...migrated, animationMode: 'on' });
const motionOff = normalizeDraft({ ...migrated, animationMode: 'off' });
assert.equal(motionOn?.animationMode, 'on');
assert.equal(motionOff?.animationMode, 'off');
assert.equal(motionOn?.base.frame, migrated?.base.frame);
assert.equal(motionOff?.characters[0].label, migrated?.characters[0].label);
const normalizedPresetFolders = normalizeCustomTagPresets([
  { id: 'folder-one', name: '  Mood   Boards ', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
  { id: 'folder-two', name: 'mood boards', createdAt: '2025-01-03T00:00:00.000Z', updatedAt: '2025-01-04T00:00:00.000Z' },
  { id: 'folder-one', name: 'Another folder' },
  { id: 'bad/id', name: 'Rejected path id' }
]);
assert.equal(normalizedPresetFolders[0].id, DEFAULT_CUSTOM_TAG_PRESET_ID);
assert.equal(normalizedPresetFolders[0].name, DEFAULT_CUSTOM_TAG_PRESET_NAME);
assert.equal(normalizedPresetFolders.filter(preset => preset.name.toLocaleLowerCase() === 'mood boards').length, 1);
assert.equal(normalizedPresetFolders.filter(preset => preset.id === 'folder-one').length, 1);
const normalizedLegacyCustomTag = normalizeCustomTag({ id: 'legacy-tag', tag: 'tag1, tag2', zone: 'frame', imageAsset: 'legacy.png', mime: 'image/png' });
assert.equal(normalizedLegacyCustomTag?.presetId, DEFAULT_CUSTOM_TAG_PRESET_ID);
assert.equal(normalizedLegacyCustomTag?.kind, 'tag');
const normalizedImageLessArtist = normalizeCustomTag({ id: 'personal-artist', kind: 'artist', tag: 'artist: Personal_Artist', zone: 'frame' });
assert.equal(normalizedImageLessArtist?.kind, 'artist');
assert.equal(normalizedImageLessArtist?.imageAsset, undefined);
assert.equal(normalizeCustomTag({ id: 'broken-tag', kind: 'tag', tag: 'solo', zone: 'frame' }), null);
assert.equal(normalizeCustomTagPresetId(undefined, normalizedPresetFolders), DEFAULT_CUSTOM_TAG_PRESET_ID);
assert.equal(normalizeCustomTagPresetId('unknown-folder', normalizedPresetFolders), DEFAULT_CUSTOM_TAG_PRESET_ID);
assert.equal(normalizeCustomTagPresetId('folder-one', normalizedPresetFolders), 'folder-one');
const randomCards = pickUniqueCards([{ id: '1', tag: 'a', gallery: 'v5', image: 'a.webp', score: 0 }, { id: '2', tag: 'b', gallery: 'v5', image: 'b.webp', score: 0 }, { id: '3', tag: 'c', gallery: 'v5', image: 'c.webp', score: 0 }], 2, () => 0);
assert.deepEqual(randomCards.map(card => card.id), ['1', '2']);
assert.equal(randomCount(2, 3, () => 0), 2);
assert.equal(randomCount(2, 3, () => 0.999999), 3);
assert.equal(randomWeight(() => 0), 0.1);
assert.equal(randomWeight(() => 0.999999), 2.0);
assert.equal(mixCompanionScale(0.1), 0.856);
assert.equal(mixCompanionScale(0.9), 0.984);
assert.equal(mixCompanionScale(1), 1);
assert.equal(mixCompanionScale(2), 1);
assert.equal(mixCompanionCapacity(1), 11);
assert.equal(mixCompanionCapacity(2), 10);
assert.equal(mixCompanionCapacity(3), 9);
assert.equal(mixCompanionCapacity(4), 8);
const singleOrbit = mixOrbitLayout(5);
assert.equal(singleOrbit.ringCount, 2);
assert.equal(singleOrbit.placements.length, 5);
assert.equal(new Set(singleOrbit.placements.map(item => `${item.x}:${item.y}`)).size, 5);
assert.equal(singleOrbit.placements.some(item => item.y < 50) && singleOrbit.placements.some(item => item.y > 50), true);
for (const placement of singleOrbit.placements) {
  assert.ok(placement.box.left >= 0 && placement.box.top >= 0);
  assert.ok(placement.box.left + placement.box.width <= 1100 && placement.box.top + placement.box.height <= singleOrbit.height);
}
const multiOrbit = mixOrbitLayout(13);
assert.equal(multiOrbit.ringCount, 2);
assert.equal(multiOrbit.placements.length, 11);
assert.equal(multiOrbit.height, singleOrbit.height);
assert.deepEqual(mixOrbitLayout(13), multiOrbit);
const twoRingOrbit = mixOrbitLayout(7);
assert.equal(twoRingOrbit.ringCount, 2);
assert.equal(twoRingOrbit.placements.every(item => item.row === (item.y < 50 ? 'top' : 'bottom')), true);
assert.equal(multiOrbit.placements.every(item => !('duration' in item) && !('direction' in item) && !('delay' in item)), true);
assert.equal(new Set(multiOrbit.placements.map(item => `${item.x}:${item.y}`)).size, 11);
for (const anchorCount of [1, 2, 3, 4]) {
  for (const companionCount of [2, 5, 8, 12]) {
    const layout = mixOrbitLayout(companionCount, anchorCount);
    assert.equal(layout.placements.every(item => item.row === (item.y < 50 ? 'top' : 'bottom')), true);
    assert.equal(new Set(layout.placements.map(item => `${item.x}:${item.y}`)).size, layout.placements.length);
    assert.equal(layout.placements.every(item => item.box.left >= 0 && item.box.top >= 0 && item.box.left + item.box.width <= 1100 && item.box.top + item.box.height <= layout.height), true);
    if (layout.placements.length >= 3) assert.equal(layout.placements.some(item => item.y < 50) && layout.placements.some(item => item.y > 50), true);
  }
}

assert.equal(artistDisplayName(' artist: Aogisa&nbsp;88 '), 'Aogisa 88');
assert.equal(canonicalArtistIdentity('Artist: Aogisa_88'), canonicalArtistIdentity('aogisa 88'));
assert.equal(canonicalArtistIdentity('artist: x&#x5f;y'), 'x y');
const customArtistOne = { id: 'one', kind: 'artist', tag: 'artist: Aogisa_88', zone: 'frame', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' };
const customArtistTwo = { id: 'two', kind: 'artist', tag: 'different', zone: 'frame', imageAsset: 'two.webp', mime: 'image/webp', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' };
const officialArtist = { id: 'artist-v5-aogisa', catalogId: 'artist-v5-aogisa', tag: 'aogisa 88', gallery: 'v5', image: 'aogisa.webp', score: 1 };
const mergedArtists = mergeArtistCatalog([officialArtist, { ...officialArtist, id: 'duplicate', catalogId: 'duplicate' }], [customArtistOne, customArtistTwo], tag => tag.imageAsset ? `nai-custom://asset/${tag.imageAsset}` : './plus.png');
assert.deepEqual(mergedArtists.cards.map(card => card.catalogId), ['artist-v5-aogisa', customArtistCatalogId('two')]);
assert.equal(mergedArtists.aliases.get(customArtistCatalogId('one')), 'artist-v5-aogisa');
assert.equal(mergedArtists.shadowedCustomIds.has('one'), true);
assert.equal(mergedArtists.cards.find(card => card.catalogId === customArtistCatalogId('two'))?.image, 'nai-custom://asset/two.webp');
const migratedRows = migrateArtistAliases([{ id: 'row-one', catalogId: customArtistCatalogId('one'), tag: 'artist: Aogisa_88', weight: 1.7 }, { id: 'row-two', catalogId: 'artist-v5-aogisa', tag: 'artist: aogisa 88', weight: 0.4 }], mergedArtists.aliases);
assert.equal(migratedRows[0].id, 'row-one');
assert.equal(migratedRows[0].catalogId, 'artist-v5-aogisa');
assert.deepEqual([...migrateFavoriteAliases(new Set([customArtistCatalogId('one'), 'artist-v5-aogisa']), mergedArtists.aliases)], ['artist-v5-aogisa']);
const migratedMix = migrateArtistMixAliases(normalizeArtistMix({ version: 1, primary: migratedRows[0], companions: [migratedRows[1]], randomRange: { min: 2, max: 2 }, favoritesOnly: false }), mergedArtists.aliases);
assert.equal(migratedMix.anchors[0]?.id, 'row-one');
assert.equal(migratedMix.companions.length, 0);
assert.deepEqual(resolveRandomPoolRange({ min: 2, max: 5 }, 0), { min: 0, max: 0, available: 0, feasible: false });
assert.deepEqual(resolveRandomPoolRange({ min: 2, max: 5 }, 1), { min: 1, max: 1, available: 1, feasible: false });
assert.deepEqual(resolveRandomPoolRange({ min: 2, max: 5 }, 3), { min: 2, max: 3, available: 3, feasible: true });
assert.deepEqual(resolveRandomPoolRange({ min: 2, max: 4 }, 5), { min: 2, max: 4, available: 5, feasible: true });
assert.deepEqual(resolveRandomPoolRange({ min: 4, max: 8 }, 12), { min: 4, max: 8, available: 12, feasible: true });
assert.equal(normalizeArtistWeight(-1), 0.1);
assert.equal(normalizeArtistWeight(2.04), 2.0);
assert.equal(normalizeArtistWeight('not a number'), 1.0);
const randomFixture = [
  { id: '1', tag: 'a', gallery: 'v5', image: 'a.webp', score: 0 },
  { id: '2', tag: 'b', gallery: 'v5', image: 'b.webp', score: 0 },
  { id: '3', tag: 'c', gallery: 'v5', image: 'c.webp', score: 0 },
  { id: '4', tag: 'd', gallery: 'v5', image: 'd.webp', score: 0 }
];
const randomValues = [0, 0, 0, 0, 0.999999, 0.5];
const randomSelection = randomArtistSelection(randomFixture, 3, () => randomValues.shift());
assert.equal(randomSelection.length, 3);
assert.equal(new Set(randomSelection.map(item => item.card.id)).size, 3);
assert.deepEqual(randomSelection.map(item => item.weight), [0.1, 2.0, 1.1]);
assert.ok(randomSelection.every(item => item.weight >= 0.1 && item.weight <= 2 && Number.isInteger(item.weight * 10)));
assert.deepEqual(normalizeRandomRange({ min: 9, max: 3 }), { min: 9, max: 9 });
const selected = [
  { id: 'row-a', catalogId: 'artist-v5-alpha', image: 'old.webp', tag: 'artist: old alpha', weight: 0.7 },
  { id: 'row-missing', catalogId: 'artist-v5-missing', image: 'kept.webp', tag: 'artist: missing', weight: 1.4 }
];
const current = [{ id: 'artist-v5-alpha', catalogId: 'artist-v5-alpha', tag: 'alpha current', gallery: 'danbooru-artist-tags-2-v5', image: 'new.webp', score: 0 }];
const reconciled = reconcileSelectedArtists(selected, current);
assert.deepEqual(reconciled.map(item => item.id), ['row-a', 'row-missing']);
assert.equal(reconciled[0].tag, 'artist: alpha current');
assert.equal(reconciled[0].image, 'new.webp');
assert.equal(reconciled[1].image, 'kept.webp');
assert.deepEqual(rerollArtistWeight(selected[0], () => 0), { ...selected[0], weight: 0.1 });
const allWeights = rerollArtistWeights(selected, () => 0.999999);
assert.deepEqual(allWeights.map(item => item.id), ['row-a', 'row-missing']);
assert.deepEqual(allWeights.map(item => item.weight), [2, 2]);

const stableCard = { tag: 'Alpha artist', image: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/alpha.webp', score: 0 };
assert.equal(stableAssetFilename(stableCard), stableAssetFilename(stableCard));
assert.equal(makeCatalog([stableCard], { characters: [], danbooruTags: [] }).artists[0].image, `cards/artist/danbooru-artist-tags-2-v5/${stableAssetFilename(stableCard)}`);

const catalog = JSON.parse(readFileSync(new URL('../public/catalog/catalog.json', import.meta.url), 'utf8'));
assert.equal(EXPECTED_CARD_COUNT, 4198);
assert.equal(catalog.artists.length, EXPECTED_CARD_COUNT);
assert.equal(catalog.characters.length, 5457);
assert.ok(catalog.artists.length > 0);
assert.ok(catalog.artists.every(card => card.id.startsWith('artist-v5-') && card.gallery === 'danbooru-artist-tags-2-v5' && card.image.startsWith('cards/artist/danbooru-artist-tags-2-v5/') && card.image.endsWith('.webp')));
assert.ok(catalog.characters.every(card => card.gallery === 'danbooru-character-tags-v4.5' && card.image.startsWith('cards/character/danbooru-character-tags-v4.5/')));
assert.ok(catalog.tags.every(tag => !catalog.danbooruTags.some(item => item.category === 1 && item.tag === tag)));
assert.equal(catalog.artists.filter(card => /[0-9]$/.test(card.tag)).length, 166);
const highlightFixture = [
  { id: 'aogisa', tag: 'aogisa', gallery: 'v5', image: 'aogisa.webp', score: 0 },
  { id: 'aogisa88', tag: 'aogisa88', gallery: 'v5', image: 'aogisa88.webp', score: 0 },
  { id: 'aki99', tag: 'aki99', gallery: 'v5', image: 'aki99.webp', score: 0 },
  { id: 'spice', tag: '13 (spice!!)', gallery: 'v5', image: 'spice.webp', score: 0 },
  { id: 'gin', tag: 'gin&#039;ichi', gallery: 'v5', image: 'gin.webp', score: 0 },
  { id: 'space', tag: 'space artist', gallery: 'v5', image: 'space.webp', score: 0 },
  { id: 'fullwidth', tag: 'Aki99', gallery: 'v5', image: 'fullwidth.webp', score: 0 },
  { id: 'colon', tag: 'n:go', gallery: 'v5', image: 'n-go.webp', score: 0 },
  { id: 'unsafe', tag: '<unsafe>', gallery: 'v5', image: 'unsafe.webp', score: 0 }
];
const highlighter = new MetadataArtistHighlighter(highlightFixture);
const highlighted = highlighter.render("artist: aogisa88, AOGISA, aki99, 13 (spice!!), gin'ichi, <unsafe>, <script>");
assert.match(highlighted, /data-artist-preview-image="\.\/catalog\/aki99\.webp"/);
assert.match(highlighted, /data-artist-preview-tag="aki99" data-artist-preview-prompt="artist: aki99"/);
assert.match(highlighted, /tabindex="0"/);
assert.match(highlighted, /artist: aogisa88/);
assert.match(highlighted, /13 \(spice!!\)/);
assert.match(highlighted, /gin&#039;ichi/);
assert.match(highlighted, /&lt;script&gt;/);
assert.equal((highlighter.render('aogisa88').match(/metadata-artist-highlight/g) ?? []).length, 1);
assert.equal((highlighter.render('aogisa88x').match(/metadata-artist-highlight/g) ?? []).length, 0);
const whitespaceEquivalent = highlighter.render('space__artist and space   artist then ＡＫＩ９９');
assert.equal((whitespaceEquivalent.match(/metadata-artist-highlight/g) ?? []).length, 3);
assert.match(whitespaceEquivalent, />space__artist<|>space   artist</);
assert.match(whitespaceEquivalent, /ＡＫＩ９９/);
assert.equal(escapeMetadataHtml('<'), '&lt;');
assert.equal(decodeCatalogEntities('&amp; &lt; &gt; &quot; &#x27; &#039;'), "& < > \" ' '");
const actualAki99 = catalog.artists.find(card => card.tag === 'aki99');
assert.ok(actualAki99);
assert.match(new MetadataArtistHighlighter([actualAki99]).render('artist: aki99'), /metadata-artist-highlight/);
const catalogHighlighter = new MetadataArtistHighlighter(catalog.artists);
const catalogHighlight = catalogHighlighter.render("artist: aki99, gin'ichi (akacia), 13 (spice!!)");
assert.equal((catalogHighlight.match(/metadata-artist-highlight/g) ?? []).length, 3);
const explicitKnown = highlighter.render('1.2::artist: aogisa88::, artist: n:go, artist: space__artist');
assert.equal((explicitKnown.match(/metadata-artist-highlight/g) ?? []).length, 3);
assert.match(explicitKnown, /data-artist-preview-kind="known"/);
assert.match(explicitKnown, />aogisa88<.*?>n:go<.*?>space__artist</);
const explicitUnknown = highlighter.render('artist: aogisa-extra, artist: unknown person, aogisa');
assert.equal((explicitUnknown.match(/metadata-artist-highlight unknown/g) ?? []).length, 2);
assert.equal((explicitUnknown.match(/metadata-artist-highlight/g) ?? []).length, 3);
assert.match(explicitUnknown, /data-artist-preview-kind="message"/);
assert.match(explicitUnknown, /This artist is not in the local catalog, so a preview is unavailable\. You can test it directly on the NovelAI website\./);
assert.doesNotMatch(explicitUnknown, /data-artist-preview-image="[^"]*aogisa-extra/);
assert.equal((highlighter.render('unknown person').match(/metadata-artist-highlight/g) ?? []).length, 0);
assert.equal((highlighter.render('notartist: unknown').match(/metadata-artist-highlight unknown/g) ?? []).length, 0);
assert.equal((highlighter.render('some_artist: unknown').match(/metadata-artist-highlight unknown/g) ?? []).length, 0);
assert.equal((highlighter.render('{{artist: unknown}}').match(/metadata-artist-highlight unknown/g) ?? []).length, 1);
assert.equal((highlighter.render('ＡＲＴＩＳＴ：unknown').match(/metadata-artist-highlight unknown/g) ?? []).length, 1);
for (const terminator of [', next', ':: next', '\nnext', '} next', '] next']) {
  const rendered = highlighter.render(`artist: aogisa${terminator}`);
  assert.equal((rendered.match(/metadata-artist-highlight/g) ?? []).length, 1);
}
const normalizedExplicit = highlighter.render('artist: ＡＫＩ９９, artist: space___artist, artist: gin&#039;ichi');
assert.equal((normalizedExplicit.match(/metadata-artist-highlight/g) ?? []).length, 3);
const escapedUnknown = highlighter.render('artist: <unknown "artist">');
assert.match(escapedUnknown, /&lt;unknown &quot;artist&quot;&gt;/);
assert.doesNotMatch(escapedUnknown, /data-artist-preview-image/);
assert.doesNotMatch(escapedUnknown, /data-artist-preview-prompt/);

const assetDir = new URL('../public/catalog/cards/artist/danbooru-artist-tags-2-v5', import.meta.url);
const assetCount = readdirSync(assetDir).filter(file => file.endsWith('.webp')).length;
assert.equal(assetCount, catalog.artists.length);
const characterAssetDir = new URL('../public/catalog/cards/character/danbooru-character-tags-v4.5', import.meta.url);
assert.equal(readdirSync(characterAssetDir).filter(file => file.endsWith('.jpg')).length, 5457);
const browserFixture = Array.from({ length: 197 }, (_, index) => ({ id: `character-${index}`, tag: index === 150 ? 'Synthetic Beyond First Page' : `Character ${index}`, gallery: 'danbooru-character-tags-v4.5', image: `cards/character/${index}.jpg`, score: 0 }));
const firstCharacterPage = paginateCharacters(browserFixture, { page: 1 });
const lastCharacterPage = paginateCharacters(browserFixture, { page: 99 });
assert.equal(CHARACTER_PAGE_SIZE, 96);
assert.equal(firstCharacterPage.cards.length, 96);
assert.equal(lastCharacterPage.page, 3);
assert.equal(lastCharacterPage.cards.at(-1)?.id, 'character-196');
assert.equal(filterCharacters(browserFixture, 'beyond first page').length, 1);
assert.equal(paginateCharacters(browserFixture, { query: 'beyond first page' }).cards[0].id, 'character-150');
assert.equal(paginateCharacters(browserFixture, { favoritesOnly: true, favoriteIds: new Set(['character-150']) }).filteredCount, 1);
const artistBrowserFixture = Array.from({ length: 4198 }, (_, index) => ({ id: `artist-v5-${index}`, catalogId: `artist-v5-${index}`, tag: index === 3410 ? 'Synthetic Artist Beyond First Page' : `Artist ${index}`, gallery: 'danbooru-artist-tags-2-v5', image: `cards/artist/${index}.webp`, score: 0 }));
const firstArtistPage = paginateArtists(artistBrowserFixture, { page: 1 });
const lastArtistPage = paginateArtists(artistBrowserFixture, { page: 999 });
assert.equal(ARTIST_PAGE_SIZE, 72);
assert.equal(firstArtistPage.cards.length, 72);
assert.equal(lastArtistPage.pageCount, 59);
assert.equal(lastArtistPage.cards.length, 22);
assert.equal(paginateArtists(artistBrowserFixture, { query: 'beyond first page' }).cards[0].id, 'artist-v5-3410');

const uiSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../src/artist-card-preview.ts', import.meta.url), 'utf8');
const storageSource = readFileSync(new URL('../src/storage.ts', import.meta.url), 'utf8');
const metadataWorkspaceSource = readFileSync(new URL('../src/metadata-workspace.ts', import.meta.url), 'utf8');
const electronSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const catalogUpdaterSource = readFileSync(new URL('../electron/catalog-updater.cjs', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const appPathsSource = readFileSync(new URL('../electron/app-paths.cjs', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const packageSource = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lockSource = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const tsconfigSource = JSON.parse(readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'));
const localEnvSource = readFileSync(new URL('./local-env.mjs', import.meta.url), 'utf8');
const localRunnerSource = readFileSync(new URL('./run-local.mjs', import.meta.url), 'utf8');
const desktopBuildSource = readFileSync(new URL('./build-desktop.mjs', import.meta.url), 'utf8');
const catalogPacksSource = readFileSync(new URL('./catalog-packs.mjs', import.meta.url), 'utf8');
const thinCatalogSource = readFileSync(new URL('./thin-dist-catalog.ps1', import.meta.url), 'utf8');
const releaseManifestSource = readFileSync(new URL('./generate-release-manifest.mjs', import.meta.url), 'utf8');
const installerBuildSource = readFileSync(new URL('./build-installer.mjs', import.meta.url), 'utf8');
const iconPreparationSource = readFileSync(new URL('./prepare-icon.mjs', import.meta.url), 'utf8');
const iconResizeSource = readFileSync(new URL('./prepare-icon.ps1', import.meta.url), 'utf8');
const installerLauncherSource = readFileSync(new URL('./installer-launcher/Program.cs', import.meta.url), 'utf8');
const installerProofSource = readFileSync(new URL('./installer-proof/proof.nsi', import.meta.url), 'utf8');
const installerProofRunnerSource = readFileSync(new URL('./installer-proof/build-and-run-proof.mjs', import.meta.url), 'utf8');
const installerStorePatchSource = readFileSync(new URL('./electron-builder-nsis-store.mjs', import.meta.url), 'utf8');
const nsisIncludeSource = readFileSync(new URL('../build/installer.nsh', import.meta.url), 'utf8');
const npmrcSource = readFileSync(new URL('../.npmrc', import.meta.url), 'utf8');
assert.match(uiSource, /selected V5 artist weights/);
assert.match(uiSource, /let startupBusy = false;/);
assert.match(uiSource, /const failure = !startupBusy && startupFailures.length/);
assert.match(uiSource, /startupBusy = true;[^]*?await preloadCards\(failed, 'Retrying failed previews'\)[^]*?startupBusy = false;/);
assert.match(uiSource, /MetadataWorkspace/);
assert.match(uiSource, /new MetadataWorkspace\(\(\) => catalog\.artists\)/);
assert.match(metadataWorkspaceSource, /private readToken = 0;/);
assert.match(metadataWorkspaceSource, /const request = \+\+this\.readToken;/);
assert.match(metadataWorkspaceSource, /const result = await extractImageMetadata\(file\);\s+if \(request !== this\.readToken\) return;\s+this\.result = result; this\.sourceObjectUrl = URL\.createObjectURL\(file\);/);
assert.match(metadataWorkspaceSource, /catch \(error\) \{\s+if \(request !== this\.readToken\) return;/);
assert.match(metadataWorkspaceSource, /bindArtistCardPreview\(root\)/);
assert.match(metadataWorkspaceSource, /this\.artistHighlighter\(\)\.render\(value\)/);
assert.match(metadataWorkspaceSource, /const escapeHtml = escapeMetadataHtml;/);
assert.match(metadataWorkspaceSource, />IMAGE METADATA</);
assert.match(metadataWorkspaceSource, />Reveal the image's data\.</);
assert.match(metadataWorkspaceSource, /Drop a image here/);
assert.match(metadataWorkspaceSource, /Choose or drop a NovelAI Image\. Analysis stays entirely on this device and never changes your prompt builder\./);
assert.match(metadataWorkspaceSource, /aria-label="Choose a NovelAI image or drop one here"/);
assert.match(metadataWorkspaceSource, /accept="image\/png,\.png,image\/webp,\.webp"/);
assert.match(metadataWorkspaceSource, /Metadata extraction is based on <a href="https:\/\/github\.com\/NovelAI\/novelai-image-metadata" target="_blank" rel="noopener noreferrer">NovelAI's official image metadata repository<\/a>\./);
assert.match(metadataWorkspaceSource, /URL\.createObjectURL\(file\)/);
assert.match(metadataWorkspaceSource, /URL\.revokeObjectURL\(this\.sourceObjectUrl\)/);
assert.match(metadataWorkspaceSource, /dispose\(\): void \{ this\.readToken \+= 1; this\.releaseSourceImage\(\); \}/);
assert.match(metadataWorkspaceSource, /class="metadata-source-image"[\s\S]*?<div class="metadata-model"/);
assert.match(metadataWorkspaceSource, /data-metadata-copy="\$\{index\}"/);
assert.match(metadataWorkspaceSource, /<pre>[\s\S]*?<div class="metadata-prompt-actions">[\s\S]*?>Copy prompt<\/button>/);
assert.match(metadataWorkspaceSource, /private activePrompt\(index: number\): string/);
assert.match(metadataWorkspaceSource, /activeValue \? '' : 'disabled'/);
assert.match(uiSource, /metadataWorkspace\.dispose\(\);/);
assert.match(storageSource, /export function loadCustomTags\(\): CustomTag\[\] \{[\s\S]*?if \(!bridge\(\)\) return \[\];/);
assert.match(storageSource, /export function saveCustomTags\(tags: CustomTag\[\]\): void \{[\s\S]*?bridge\(\)\?\.save\('customTags', normalized\);/);
assert.doesNotMatch(storageSource.match(/export function saveCustomTags[\s\S]*?\n\}/)?.[0] ?? '', /localStorage\.setItem/);
assert.match(storageSource, /item\.imageAsset\.startsWith\('memory-'\)/);
assert.match(storageSource, /export function normalizeCustomTagPresets\(values: unknown\): CustomTagPreset\[\] \{/);
assert.match(storageSource, /DEFAULT_CUSTOM_TAG_PRESET_ID/);
assert.match(storageSource, /from '\.\/custom-tag-presets\.ts'/);
const savedPromptNormalizerSource = storageSource.match(/export function normalizeSavedPromptSnapshot\(value: unknown\): SavedPromptSnapshot \| undefined \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(savedPromptNormalizerSource, /version: 2[\s\S]*?base: draft\.base[\s\S]*?characters: draft\.characters[\s\S]*?randomRange/);
assert.doesNotMatch(savedPromptNormalizerSource, /animationMode/);
const savedPromptTypeSource = typesSource.match(/export interface SavedPromptSnapshot \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.doesNotMatch(savedPromptTypeSource, /animationMode/);
const savedPromptCaptureSource = uiSource.match(/function currentSavedPromptSnapshot\(\): SavedPromptSnapshot \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(savedPromptCaptureSource, /JSON\.stringify\(base\)[\s\S]*?characters[\s\S]*?randomRange/);
assert.doesNotMatch(savedPromptCaptureSource, /currentDraft|animationMode/);
assert.equal(tsconfigSource.compilerOptions.allowImportingTsExtensions, true);
assert.match(electronSource, /customTagPresets: \[\]/);
assert.match(electronSource, /\['sets', 'favorites', 'characterFavorites', 'draft', 'customTags', 'customTagPresets'\]/);
assert.match(electronSource, /version: 3/);
assert.match(electronSource, /savedLibrary/);
assert.match(electronSource, /nai-library/);
assert.match(electronSource, /library:image-save/);
assert.match(electronSource, /library:image-delete/);
assert.match(preloadSource, /saveLibraryImage/);
assert.match(preloadSource, /deleteLibraryImage/);
assert.match(appPathsSource, /savedLibraryDir/);
assert.match(indexSource, /raspberry-rose/);
assert.match(indexSource, /noir/);
assert.match(indexSource, /app-icon\.png/);
assert.match(iconPreparationSource, /build\/icon\.ico|icon\.ico/);
assert.match(iconPreparationSource, /prepare-icon\.ps1/);
assert.match(iconResizeSource, /HighQualityBicubic/);
assert.match(installerBuildSource, /win32icon/);
assert.match(packageSource.build.win.icon, /build\/icon\.ico/);
assert.equal(mixOrbitLayout(13, 4).placements.length, 8);
const threeAnchorNine = mixOrbitLayout(9, 3);
assert.equal(threeAnchorNine.placements.length, 9);
assert.equal(new Set(threeAnchorNine.placements.map(item => `${item.x}:${item.y}`)).size, 9);
assert.equal(mixOrbitLayout(13, 4).placements.every(item => item.box.left >= 0 && item.box.top >= 0 && item.box.left + item.box.width <= 1100 && item.box.top + item.box.height <= mixOrbitLayout(13, 4).height), true);
assert.equal(mixOrbitLayout(13, 4).placements.every(item => !('duration' in item) && !('direction' in item) && !('delay' in item)), true);
const mixCardSource = uiSource.match(/function mixArtistCardMarkup\([\s\S]*?\n\}/)?.[0] ?? '';
assert.doesNotMatch(mixCardSource, /<code/);
assert.match(styleSource, /R3 artist mix geometry/);
assert.match(styleSource, /@media \(min-width: 901px\)[\s\S]*?\.mix-orbit \{ min-height: 0; \}/);
assert.match(styleSource, /\.mix-orbit-primary \{ max-width: min\(52%, 560px\); \}/);
assert.doesNotMatch(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.mix-orbit \{ display: grid;/);
assert.doesNotMatch(styleSource, /\.mix-orbit\[data-layout-ready="false"\] \.mix-orbit-slot \{ visibility: hidden; \}/);
assert.match(styleSource, /\.mix-anchor-group \{ flex-wrap: wrap; gap: 4px; max-width: 100%;/);
assert.match(uiSource, /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{/);
assert.match(uiSource, /new ResizeObserver\(\(\) => scheduleMixOrbitThreads\(\)\)/);
assert.match(uiSource, /setTimeout\(settle, 40\)/);
assert.match(styleSource, /\.workspace-tabs \{[^}]*max-width: 100%;[^}]*overflow-x: auto;/);
assert.match(uiSource, /saveCustomTagPresets\(customTagPresets\)/);
assert.match(previewSource, /data-artist-preview-message/);
assert.match(previewSource, /previewImage\.removeAttribute\('src'\);[\s\S]*?previewImage\.alt = '';/);
assert.match(previewSource, /function restartPreviewReveal\(host: HTMLElement\): void \{[\s\S]*?host\.classList\.remove\('is-visible'\);[\s\S]*?void host\.offsetWidth;[\s\S]*?host\.classList\.add\('is-visible'\);/);
assert.match(previewSource, /updatePosition\(target, host\);\s+host\.setAttribute\('aria-hidden', 'false'\);\s+restartPreviewReveal\(host\);/);
assert.match(uiSource, /role="tablist"/);
assert.match(uiSource, /Image Metadata/);
assert.match(uiSource, /function currentDraft\(\): PromptDraft \{[\s\S]*?animationMode \}/);
assert.match(uiSource, /function animationModeMarkup\(\): string \{[\s\S]*?Animations[\s\S]*?value="auto"[\s\S]*?value="on"[\s\S]*?value="off"/);
assert.equal((uiSource.match(/\$\{animationModeMarkup\(\)\}/g) ?? []).length, 1);
assert.match(uiSource, /<div class="top-actions">\$\{animationModeMarkup\(\)\}\$\{activeWorkspace === 'prompt'/);
assert.match(uiSource, /id="animation-mode" aria-labelledby="animation-mode-label"/);
assert.match(uiSource, /document\.documentElement\.dataset\.animationMode = mode/);
assert.match(uiSource, /#animation-mode[^\n]*addEventListener\('change'/);
assert.match(uiSource, /animationMode = normalizeAnimationMode\([\s\S]*?applyAnimationMode\(animationMode\);\s+saveDraft\(currentDraft\(\)\);/);
assert.doesNotMatch(uiSource.match(/#animation-mode[^\n]*addEventListener\('change'[\s\S]*?\n  \}\);/)?.[0] ?? '', /render\(\)/);
assert.match(uiSource, /saveDraft\(currentDraft\(\)\);/);
assert.match(uiSource, /const draft = currentDraft\(\); saveDraft\(draft\); window\.naiStorage\?\.saveSync\('draft', draft\)/);
const resetSource = uiSource.match(/function resetPrompt\(\): void \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.doesNotMatch(resetSource, /animationMode\s*=/);
assert.match(uiSource, /let pendingWorkspaceTransition: 'prompt' \| 'custom-tags' \| 'metadata' \| null = null;/);
assert.match(uiSource, /function switchWorkspace\(workspace: 'prompt' \| 'custom-tags' \| 'metadata'\): void \{\s+if \(workspace === activeWorkspace\) return;\s+activeWorkspace = workspace;\s+pendingWorkspaceTransition = workspace;\s+render\(\);\s+\}/);
assert.doesNotMatch(uiSource, /Compatibility marker|function switchWorkspace\(workspace: 'prompt' \| 'metadata'\)/);
assert.match(uiSource, /function refreshConstructorGrid\(\): void \{[\s\S]*?clearArtistCardPreview\(\);[\s\S]*?grid\.innerHTML/);
const constructorFolderToggleSource = uiSource.match(/function toggleConstructorFolder\(folderId: string, button\?: HTMLButtonElement\): void \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(constructorFolderToggleSource, /shell\.classList\.toggle\('is-open', open\)/);
assert.match(constructorFolderToggleSource, /reveal\.toggleAttribute\('inert', !open\)/);
assert.match(constructorFolderToggleSource, /warmConstructorImages\(reveal, true\)/);
assert.doesNotMatch(constructorFolderToggleSource, /refreshConstructorGrid\(\);\s*\}/);
assert.match(uiSource, /class="constructor-folder-reveal"[\s\S]*?aria-hidden="\$\{!open\}"[\s\S]*?inert/);
assert.match(uiSource, /data-constructor-image-src=.*?decoding="async"/);
assert.match(uiSource, /const CONSTRUCTOR_IMAGE_CONCURRENCY = 6;/);
assert.match(uiSource, /function startConstructorImageWarmup\(\): void \{[\s\S]*?requestAnimationFrame[\s\S]*?warmConstructorImages\(grid\)/);
assert.match(uiSource, /function warmConstructorImages\(scope: ParentNode, priority = false\): void \{[\s\S]*?img\[data-constructor-image-src\][\s\S]*?queueConstructorImage\(image, priority\)/);
assert.match(uiSource, /function pumpConstructorImageWarmup\(\): void \{[\s\S]*?image\.decoding = 'async';[\s\S]*?image\.src = source;/);
assert.match(uiSource, /function openConstructor\([\s\S]*?render\(\);\s+startConstructorImageWarmup\(\);/);
assert.match(uiSource, /function closeConstructor\(\): void \{\s+clearConstructorImageWarmup\(\);/);
assert.match(uiSource, /function refreshConstructorGrid\(\): void \{[\s\S]*?warmConstructorImages\(grid\)/);
assert.match(styleSource, /\.constructor-folder-reveal \{[\s\S]*?grid-template-rows: 0fr[\s\S]*?transition:/);
assert.match(styleSource, /\.constructor-folder\.is-open \.constructor-folder-reveal \{ grid-template-rows: 1fr/);
assert.match(styleSource, /\.constructor-card-image img\.is-loaded \{ opacity: 1; \}/);
assert.match(uiSource, /function restoreConstructorGridFocus\(target: string \| null\): void \{[\s\S]*?target\.startsWith\('folder:'\)[\s\S]*?target\.slice\('folder:'\.length\)/);
assert.doesNotMatch(uiSource, /target\.split\(':', 2\)/);
assert.match(uiSource, /function revokeCustomImageUrl\(key: string\): void \{[\s\S]*?URL\.revokeObjectURL\(url\)/);
assert.match(uiSource, /function setCustomImageUrl\(key: string, url: string\): void \{[\s\S]*?revokeCustomImageUrl\(key\)/);
assert.match(uiSource, /class="\$\{workspacePanelClass\('prompt'\)\}"/);
assert.match(uiSource, /class="\$\{workspacePanelClass\('metadata'\)\}"/);
assert.match(uiSource, /pendingWorkspaceTransition = null;\s+bindEvents\(\);/);
assert.match(uiSource, /prompt-tab[^\n]*addEventListener\('click', \(\) => switchWorkspace\('prompt'\)\)/);
assert.match(uiSource, /metadata-tab[^\n]*addEventListener\('click', \(\) => switchWorkspace\('metadata'\)\)/);
assert.match(uiSource, /id="full-prompt-output"/);
assert.match(uiSource, /id="artist-prompt-output"/);
assert.match(uiSource, /id="copy-prompt"/);
assert.equal((uiSource.match(/>Copy prompt</g) ?? []).length, 1);
assert.doesNotMatch(uiSource, /copy-prompt-bottom|Offline catalog|offline snapshot/);
const footerMarkup = uiSource.match(/<footer class="app-footer">[\s\S]*?<\/footer>/)?.[0] ?? '';
assert.match(footerMarkup, /class="footer-brand"><span>NAI Prompt Studio<\/span><span class="footer-links">[\s\S]*?https:\/\/nax\.moe\/\?gallery=danbooru-artist-tags-2-v5[\s\S]*?NAX · CC BY 4\.0[\s\S]*?https:\/\/hothottuk\.neocities\.org\/en[\s\S]*?hothottuk's guide/);
const customWorkspaceSource = uiSource.match(/function customTagsWorkspace\(\): string \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(customWorkspaceSource, /custom-preset-sidebar[\s\S]*?custom-tag-form[\s\S]*?custom-tag-library/);
assert.doesNotMatch(customWorkspaceSource, /Personal images|source-note/);
assert.match(uiSource, /const accordionOpenState: Record<Zone, boolean> = \{ frame: true, scene: true, render: true, undesired: false \};/);
assert.match(uiSource, /function snapshotAccordionState\(\): void \{[\s\S]*?details\.open[\s\S]*?\}/);
assert.match(uiSource, /\.accordion\[data-zone\][\s\S]*?addEventListener\('toggle'/);
assert.match(uiSource, /function manualEditor\([\s\S]*?class="manual-editor"[\s\S]*?class="prompt-editor-toolbar"/);
assert.doesNotMatch(uiSource, /accordion-actions/);
assert.doesNotMatch(styleSource, /accordion-actions/);
assert.match(uiSource, /for="\$\{editorId\}"/);
assert.match(uiSource, /data-open-constructor="\$\{zone\}"/);
for (const zone of ['frame', 'scene', 'render']) assert.match(uiSource, new RegExp(`manualEditor\\('${zone}'`));
assert.match(customWorkspaceSource, /namePlaceholder[\s\S]*?customTypeSelector\(kind\)/);
assert.match(uiSource, /id="custom-card-kind"/);
assert.match(customWorkspaceSource, /data-custom-filter="artist"/);
assert.match(uiSource, /function customTagKind\(item\?: CustomTag\): CustomTagKind/);
assert.match(uiSource, /kind === 'artist' \? artistDisplayName\(rawTag\) : rawTag/);
assert.match(uiSource, /customArtistCatalogId\(item\.id\)/);
assert.match(uiSource, /rebuildEffectiveArtistCatalog\(\)/);
assert.doesNotMatch(uiSource, /No image selected/);
assert.doesNotMatch(uiSource, /Tag group and constructor are required/);
assert.match(uiSource, /Tag and constructor are required/);
assert.match(customWorkspaceSource, /custom-image-preview is-loaded[\s\S]*?custom-image-preview is-empty/);
assert.match(uiSource, /classList\.add\('has-image'\)/);
assert.match(styleSource, /custom-image-preview\.is-loaded[\s\S]*?object-fit: contain/);
assert.match(styleSource, /custom-library-card > img \{[^}]*object-fit: contain/);
assert.match(uiSource, /selected && !isDefault[\s\S]*?data-rename-preset[\s\S]*?data-delete-preset/);
assert.match(uiSource, /preset-action-icon[\s\S]*?aria-label="Rename/);
assert.match(uiSource, /preset-action-icon[\s\S]*?aria-label="Delete/);
assert.match(styleSource, /custom-preset-list \{[^}]*padding: 6px 9px 7px 3px/);
assert.match(styleSource, /custom-save-button, \.custom-library-actions \.tiny-copy[\s\S]*?border-radius: 999px/);
assert.match(styleSource, /\.reroll-weight, \.reroll-action \{[^}]*border-radius: 999px/);
assert.match(styleSource, /html, body, \* \{ scrollbar-color/);
assert.match(styleSource, /\*::-webkit-scrollbar-thumb/);
assert.match(uiSource, /class="number-stepper"/);
assert.match(uiSource, /data-number-step="up"[\s\S]*?data-number-step="down"/);
assert.match(uiSource, /input\.stepUp\(\)[\s\S]*?input\.stepDown\(\)[\s\S]*?new Event\('input', \{ bubbles: true \}\)/);
assert.match(uiSource, /button\.disabled = input\.disabled/);
assert.match(uiSource, /button\.addEventListener\('pointerdown', event => event\.preventDefault\(\)/);
assert.match(styleSource, /input\[type="number"\]::\-webkit-inner-spin-button[\s\S]*?appearance: none/);
assert.equal((uiSource.match(/>Reset prompt</g) ?? []).length, 1);
assert.match(uiSource, /class="reset-prompt" id="reset" type="button">Reset prompt/);
assert.doesNotMatch(uiSource, /reset-footer|New prompt|Local image analysis/);
assert.match(styleSource, /\.reset-prompt \{[^}]*border: 1px solid var\(--danger\)[^}]*white-space: nowrap/);
assert.match(styleSource, /\.reset-prompt:hover/);
for (const controlId of ['copy-prompt', 'copy-artists', 'reroll-all-weights', 'random-artists', 'random-favorites-only', 'reset', 'add-character', 'open-character-picker', 'open-artist-picker', 'open-artist-picker-empty']) {
  assert.match(uiSource, new RegExp(`id="${controlId}"`));
}
assert.match(styleSource, /\.empty-artist-card:hover/);
assert.match(styleSource, /\.empty-artist-card:active/);
assert.match(styleSource, /\.empty-artist-card:focus-visible/);
assert.match(styleSource, /\.empty-artist-card:hover(?:\:not\(:active\))? img/);
assert.match(styleSource, /\.workspace-tabs button:hover/);
assert.match(styleSource, /\.workspace-tabs button:active/);
assert.match(styleSource, /\.workspace-tabs button:focus-visible/);
assert.match(styleSource, /\.primary, \.secondary,[\s\S]*?outline: 2px solid transparent;\s+outline-offset: 3px;[\s\S]*?outline-color var\(--motion-control\)/);
assert.match(styleSource, /--detached-outline-clearance: 12px/);
for (const detachedGroup of ['top-actions', 'picker-tools', 'random-actions', 'character-entry-actions', 'character-actions', 'workspace-tabs']) {
  assert.match(styleSource, new RegExp(`\\.${detachedGroup} \\{[^}]*gap: var\\(--detached-outline-clearance\\)`));
}
assert.match(styleSource, /\.subheading > div \{[^}]*gap: var\(--detached-outline-clearance\)/);
assert.match(styleSource, /\.metadata-toggle button \{[^}]*outline-offset: -2px/);
assert.match(styleSource, /\.primary:hover:not\(:active\):not\(:disabled\):not\(:focus-visible\)[\s\S]*?border-color: var\(--accent\)[\s\S]*?outline-color: rgb\(var\(--accent-bright-rgb\) \/ 88%\)[\s\S]*?box-shadow: 0 0 20px rgb\(var\(--accent-rgb\) \/ 34%\), 0 5px 14px/);
assert.match(styleSource, /\.reset-prompt:hover:not\(:active\):not\(:disabled\):not\(:focus-visible\)[\s\S]*?border-color: var\(--danger\)[\s\S]*?outline-color: rgb\(228 155 157 \/ 88%\)[\s\S]*?0 0 20px rgb\(228 155 157 \/ 30%\)/);
assert.match(styleSource, /\.primary:disabled:hover[\s\S]*?\.metadata-copy:disabled:hover \{ box-shadow: none; transform: none; \}/);
assert.match(styleSource, /\.primary:active[\s\S]*?\.secondary:active[\s\S]*?\.chip:active/);
assert.match(styleSource, /button:disabled \{[^}]*transition: none; transform: none;/);
assert.match(styleSource, /\.workspace-panel-incoming \{ animation: workspace-panel-incoming 220ms/);
const panelKeyframe = styleSource.match(/@keyframes workspace-panel-incoming \{([\s\S]*?)\n\}/)?.[1] ?? '';
assert.match(panelKeyframe, /opacity/);
assert.match(panelKeyframe, /transform/);
assert.doesNotMatch(panelKeyframe, /(?:width|height|margin|padding|left|top|right|bottom)\s*:/);
assert.doesNotMatch(styleSource, /transition\s*:\s*all\b/);
assert.match(styleSource, /\.metadata-workspace \{ max-width: 1120px;/);
assert.match(uiSource, /if \(fullOutput\) fullOutput\.textContent = prompt\(\);/);
assert.match(uiSource, /if \(artistOutput\) artistOutput\.textContent = buildArtistsPrompt\(base\.artists\);/);
assert.match(uiSource, /min="0\.1" max="2" step="0\.1"/);
assert.match(uiSource, /random-favorites-only/);
assert.match(uiSource, /resolveRandomPoolRange/);
assert.match(uiSource, /needs at least 2 favorited V5 artists/);
assert.match(uiSource, /controlMax = activeRange\.feasible \? activeRange\.available/);
assert.doesNotMatch(uiSource, /Favorites pool \(\$\{artistFavorites\.size\}\)/);
assert.match(uiSource, /reroll-all-weights/);
assert.match(uiSource, /data-reroll-weight/);
assert.doesNotMatch(uiSource, /card\.png|card-overlay/);
assert.doesNotMatch(styleSource, /card\.png|card-overlay/);
assert.match(uiSource, /character-picker-backdrop/);
assert.match(uiSource, /character-previous/);
assert.match(uiSource, /character-next/);
assert.match(uiSource, /paginateCharacters/);
assert.match(uiSource, /paginateArtists/);
assert.doesNotMatch(uiSource, /slice\(0, 40\)/);
assert.doesNotMatch(uiSource, /slice\(0,\s*240\)/);
assert.match(uiSource, /artist-previous/);
assert.match(uiSource, /artist-next/);
assert.match(uiSource, /toggleFavorite\(button\.dataset\.favoriteArtist!, 'artists', true\)/);
assert.match(uiSource, /const previousScrollTop = options\.preserveScroll \? grid\.scrollTop : 0;/);
assert.match(uiSource, /favoriteButton\?\.focus\(\{ preventScroll: true \}\);/);
assert.match(uiSource, /mix-artist-previous/);
assert.match(uiSource, /mix-artist-next/);
assert.match(uiSource, /mixOrbitMarkup/);
assert.doesNotMatch(uiSource, /<svg[^>]*mix-orbit/);
assert.match(uiSource, /class="mix-orbit-carrier"><div class="mix-orbit-connector"/);
assert.match(uiSource, /slot\.dataset\.orbitRow = placement\.row/);
assert.match(uiSource, /--mix-weight-scale/);
assert.match(uiSource, /--orbit-x/);
assert.match(uiSource, /--orbit-y/);
assert.match(uiSource, /function layoutMixOrbitThreads\(\)/);
assert.match(uiSource, /rectangleEdge\(anchorRect, cardCenter\.x, cardCenter\.y\)/);
assert.match(uiSource, /function commitArtistMix\(/);
assert.match(uiSource, /commitArtistMix\(nextMix, notice\);/);
assert.match(uiSource, /function mixMotionEnabled\(\)/);
assert.match(uiSource, /mixTransitionActive/);
assert.match(uiSource, /mixTransitionTimer/);
assert.match(uiSource, /disabled aria-busy="true"/);
assert.match(uiSource, /--mix-slot-index/);
assert.match(uiSource, /character-search/);
assert.match(uiSource, /classList\.toggle\('on', characterFavoritesOnly\)/);
assert.match(uiSource, /setAttribute\('aria-pressed', String\(characterFavoritesOnly\)\)/);
const characterListSource = uiSource.match(/function renderCharacterList\(\): void \{[\s\S]*?\n\}\n\nfunction refreshCharacterPicker/)?.[0] ?? '';
assert.equal((characterListSource.match(/bindCharacterBlockEvents\(\)/g) ?? []).length, 1);
assert.doesNotMatch(characterListSource, /data-character-name|data-copy-character|data-remove-character|data-character-details/);
assert.match(styleSource, /artist-card-preview/);
assert.match(styleSource, /height: min\(68vh, 520px\)/);
assert.doesNotMatch(previewSource, /window\.addEventListener\(['"]scroll['"]/);
assert.match(previewSource, /export function clearArtistCardPreview\(\): void/);
assert.match(previewSource, /activeByPointer = false;\s+activeByFocus = false;\s+activeTarget = null;/);
assert.match(previewSource, /let rangePointerFocusPending = false;/);
assert.match(previewSource, /event\.target instanceof HTMLInputElement && event\.target\.type === 'range'/);
assert.match(previewSource, /target\.addEventListener\('pointerdown',[\s\S]*?rangePointerFocusPending = true;[\s\S]*?activeByFocus = false;/);
assert.match(previewSource, /target\.addEventListener\('pointerup', finishRangePointer, true\);/);
assert.match(previewSource, /target\.addEventListener\('pointercancel', finishRangePointer, true\);/);
assert.match(previewSource, /target\.addEventListener\('lostpointercapture', finishRangePointer, true\);/);
assert.match(previewSource, /const pointerOriginatedRangeFocus = rangePointerFocusPending;\s+rangePointerFocusPending = false;\s+if \(pointerOriginatedRangeFocus\) return;/);
assert.match(previewSource, /if \(activeTarget && !activeTarget\.isConnected\) \{\s+clearArtistCardPreview\(\);/);
assert.match(uiSource, /import \{ bindArtistCardPreview, clearArtistCardPreview \} from '\.\/artist-card-preview';/);
const renderSource = uiSource.match(/function render\(\): void \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(renderSource, /if \(!app\) return;\s+document\.documentElement\.dataset\.workspace = activeWorkspace;\s+clearArtistCardPreview\(\);\s+const tabs/);
assert.match(styleSource, /select:focus-visible/);
assert.match(styleSource, /\.animation-setting select \{[^}]*background: var\(--bg-deep\)[^}]*color: var\(--ink\)/);
assert.match(styleSource, /prefers-reduced-motion/);
assert.match(styleSource, /:root:not\(\[data-animation-mode="on"\]\) \.workspace-panel-incoming \{ animation: none !important; opacity: 1 !important; transform: none !important; \}/);
assert.match(styleSource, /:root:not\(\[data-animation-mode="on"\]\) \.empty-artist-card, :root:not\(\[data-animation-mode="on"\]\) \.empty-artist-card img \{ animation: none !important; transition: none !important; transform: none !important; \}/);
assert.match(styleSource, /:root:not\(\[data-animation-mode="on"\]\) \.artist-card-preview \{ opacity: 0; transition: none !important; transform: none !important; \}/);
assert.match(styleSource, /:root\[data-animation-mode="off"\] \*\{?[^\n]*animation-duration: \.001ms !important/);
assert.match(styleSource, /:root\[data-animation-mode="off"\] \.workspace-panel-incoming \{ animation: none !important; opacity: 1 !important; transform: none !important; \}/);
assert.match(styleSource, /:root\[data-animation-mode="off"\] \.artist-card-preview\.is-visible \{ opacity: 1; transform: none !important; \}/);
assert.doesNotMatch(uiSource, /[—–]/);
assert.doesNotMatch(indexSource, /[—–]/);
assert.match(uiSource, /const existingProfileAtStartup = hasExistingProfile\(\);/);
assert.match(uiSource, /const candidates = replay \|\| !existingProfileAtStartup \? overview : update;/);
assert.match(uiSource, /overview-mix[\s\S]*?overview-saved-library[\s\S]*?overview-custom/);
assert.match(uiSource, /function openStudioAfterStartup\(\): void \{[\s\S]*?startGuide\(false\);/);
assert.doesNotMatch(uiSource.match(/function openStudioAfterStartup\(\): void \{[\s\S]*?\n\}/)?.[0] ?? '', /lastSeenVersion !== APP_VERSION/);
const restorePromptSource = uiSource.match(/if \(item\.kind === 'prompt' && item\.snapshot\) \{[\s\S]*?\n  \} else if \(item\.kind === 'artist-mix'/)?.[0] ?? '';
assert.doesNotMatch(restorePromptSource, /animationMode|applyAnimationMode|settings =/);
assert.match(storageSource, /export function hasExistingProfile\(\): boolean/);
assert.doesNotMatch(styleSource, /rgb\((?:201 168 106|229 201 141|113 75 38|98 72 130)\s*\//);
assert.doesNotMatch(uiSource, /quick\s*start|prewarm/i);
assert.match(styleSource, /:focus-visible/);
assert.match(styleSource, /:focus-within/);
assert.doesNotMatch(styleSource, /scale\(1\.32\)/);
assert.match(styleSource, /scroll-padding: 72px/);
assert.match(styleSource, /\.modal-backdrop\[hidden\] \{ display: none; \}/);
assert.match(styleSource, /\.artist-catalog-picker \.artist-catalog-grid \{[^}]*overflow-y: auto;[^}]*scrollbar-gutter: stable;/);
assert.match(styleSource, /\.mix-orbit-primary, \.mix-orbit-slot \{ position: absolute;/);
assert.match(styleSource, /\.mix-artist-card\.mix-primary \{ width: 182px;/);
assert.match(styleSource, /\.mix-artist-card \{ width: 122px;/);
assert.match(styleSource, /\.mix-orbit-carrier \{ position: absolute; inset: 0; \}/);
assert.match(styleSource, /\.mix-orbit-upright \{[^}]*left: var\(--orbit-x\);[^}]*top: var\(--orbit-y\)/);
assert.match(styleSource, /\.mix-orbit-connector \{[^}]*width: 0;/);
assert.doesNotMatch(styleSource, /mix-orbit-carrier-spin|mix-orbit-upright-spin|mix-satellite-arrive|mix-card-arrive|mix-satellite-depart|mix-card-depart|mix-thread-reveal|is-departing|is-incoming/);
assert.doesNotMatch(styleSource, /--orbit-distance|--orbit-radius|--orbit-angle/);
assert.doesNotMatch(styleSource, /mix-orbit-threads|mix-orbit-thread-spin/);
assert.doesNotMatch(styleSource, /stroke-dash(?:offset|array)/);
assert.match(styleSource, /prefers-reduced-transparency/);
assert.match(styleSource, /@media \(max-width: 760px\)/);
assert.match(styleSource, /\.selected-artist-grid \{ max-width: 100%; margin: 0; padding: 24px 12px; \}/);
assert.match(electronSource, /showErrorBox/);
assert.match(electronSource, /Menu\.setApplicationMenu\(null\)/);
assert.match(electronSource, /window\.removeMenu\(\)/);
assert.match(electronSource, /will-navigate/);
assert.match(electronSource, /No system profile fallback was used/);
assert.equal(packageSource.version, '0.6.3');
assert.equal(lockSource.version, packageSource.version);
assert.equal(lockSource.packages[''].version, packageSource.version);
assert.match(uiSource, /const APP_VERSION = '0\.6\.3'/);
assert.match(uiSource, /type AppUpdatePhase = 'idle' \| 'checking' \| 'available' \| 'downloading' \| 'paused' \| 'verifying' \| 'ready' \| 'installing' \| 'up-to-date' \| 'error'/);
assert.match(uiSource, /role="progressbar"/);
assert.match(uiSource, /Download update/);
assert.match(uiSource, /Resume download/);
assert.match(uiSource, /Cancel download/);
assert.match(uiSource, /Install now/);
assert.match(uiSource, /bindAppUpdateProgress/);
assert.match(uiSource, /appUpdatePhase === 'downloading' \|\| appUpdatePhase === 'verifying' \|\| appUpdatePhase === 'installing'/);
assert.match(uiSource, /Download \$\{progress\.percent\}% complete, .* of .*\./);
assert.match(uiSource, /if \(!window\.naiUpdater \|\| appUpdatePhase === 'downloading'/);
assert.doesNotMatch(uiSource, /settingsWorkspaceLegacy/);
assert.match(uiSource, /function settingsWorkspace\(\): string \{[\s\S]*?appUpdateMarkup\(browserOnly\)/);
for (const updateControlId of ['check-app-update', 'download-app-update', 'resume-app-update', 'cancel-app-update', 'install-app-update', 'download-missing-v5', 'cancel-v5-update']) {
  assert.equal((uiSource.match(new RegExp(`id="${updateControlId}"`, 'g')) ?? []).length, 1);
}
assert.doesNotMatch(uiSource, /downloadAndInstall/);
assert.doesNotMatch(electronSource, /app-update:download-install/);
assert.doesNotMatch(electronSource, /showMessageBox/);
assert.match(electronSource, /app-update:progress/);
assert.match(electronSource, /app-update:cancel/);
assert.match(electronSource, /app-update:install/);
assert.match(preloadSource, /download: manifest/);
assert.match(preloadSource, /onProgress/);
assert.doesNotMatch(preloadSource, /downloadAndInstall/);
assert.match(electronSource, /app-update:progress/);
assert.match(packageSource.scripts['desktop:build'], /run-local\.mjs node tools\/build-desktop\.mjs/);
assert.match(packageSource.scripts.build, /run-local\.mjs/);
assert.match(packageSource.scripts.test, /run-local\.mjs/);
assert.match(packageSource.scripts['installer:proof'], /run-local\.mjs/);
assert.equal(packageSource.build.artifactName, 'NAI-Prompt-Studio-V5-Payload-${version}.${ext}');
assert.equal(packageSource.build.nsis.include, 'build/installer.nsh');
assert.match(localEnvSource, /\.local-cache/);
for (const variable of ['TEMP', 'TMP', 'TMPDIR', 'ELECTRON_CACHE', 'ELECTRON_BUILDER_CACHE', 'npm_config_cache']) {
  assert.match(localEnvSource, new RegExp(variable));
}
assert.match(localRunnerSource, /createLocalEnvironment\(\)/);
assert.match(desktopBuildSource, /catalog-packs\.mjs/);
assert.match(desktopBuildSource, /Catalog component packs are incomplete/);
assert.doesNotMatch(desktopBuildSource, /optimize-desktop-catalog\.ps1/);
assert.match(catalogPacksSource, /createPackageFromFiles/);
assert.match(catalogPacksSource, /createReadStream/);
assert.match(catalogPacksSource, /count: 281/);
assert.match(catalogPacksSource, /extra: \['catalog\.json'\]/);
assert.match(catalogPacksSource, /function guideImageInputs/);
assert.match(catalogPacksSource, /filenames = \[\.\.\.guideInputs, 'guide\/manifest\.json'\]/);
const guideManifestFixture = JSON.parse(readFileSync(new URL('../public/catalog/guide/manifest.json', import.meta.url), 'utf8'));
const guideManifestEntries = Array.isArray(guideManifestFixture) ? guideManifestFixture : guideManifestFixture.entries;
const uniqueGuideImages = new Set(guideManifestEntries.map(entry => String(entry.image).replaceAll('\\', '/')));
const sourceGuidePngs = readdirSync(new URL('../public/catalog/guide', import.meta.url), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.png'));
assert.equal(guideManifestEntries.length, 281);
assert.equal(uniqueGuideImages.size, 277);
assert.equal(sourceGuidePngs.length, 289);
assert.ok(sourceGuidePngs.length > uniqueGuideImages.size);
assert.doesNotMatch(catalogPacksSource, /catalog-pack-staging|cpSync/);
assert.doesNotMatch(catalogPacksSource, /createHash\('sha512'\)\.update\(readFileSync/);
assert.match(thinCatalogSource, /catalog\.json/);
assert.match(thinCatalogSource, /manifest\.json/);
assert.match(thinCatalogSource, /Remove-Item .*\$cards .*Recurse/);
assert.match(releaseManifestSource, /Complete v0\.6\.3 catalog descriptors are required/);
assert.match(desktopBuildSource, /build-installer\.mjs/);
assert.match(installerBuildSource, /electron-builder/);
assert.match(installerBuildSource, /\.payload/);
const runtimeAssetResolverSource = catalogUpdaterSource.match(/function resolveActiveCatalogAsset[\s\S]*?function readJson/)?.[0] ?? '';
assert.doesNotMatch(runtimeAssetResolverSource, /archiveEntries|hashFile/);
assert.match(installerBuildSource, /patchInstallerStoreCopy/);
assert.match(installerBuildSource, /restoreInstallerStoreCopy/);
assert.match(installerStorePatchSource, /APP_INSTALLER_STORE_FILE/);
assert.match(installerStorePatchSource, /never persist the full installer in system LOCALAPPDATA/);
assert.match(installerLauncherSource, /ResolveNonSystemCache/);
assert.match(installerLauncherSource, /NAI_INSTALLER_TEMP_ROOT/);
assert.match(installerLauncherSource, /No system-drive temporary directory was used/);
assert.match(installerLauncherSource, /There is deliberately no system-drive fallback/);
assert.match(installerLauncherSource, /Path\.ChangeExtension\(executable, "\.payload"\)/);
assert.match(installerLauncherSource, /Environment\.SetEnvironmentVariable\("TEMP", sessionCache\)/);
assert.match(installerLauncherSource, /Environment\.SetEnvironmentVariable\("NAI_INSTALL_DIR", originalDirectoryArgumentValue\)/);
assert.doesNotMatch(installerLauncherSource, /start\.EnvironmentVariables/);
assert.match(installerLauncherSource, /DeleteExactSession/);
assert.match(installerLauncherSource, /NAI-Prompt-Studio-Uninstaller\.exe/);
assert.match(installerProofSource, /PLUGINSDIR/);
assert.match(installerProofSource, /NAI_INSTALLER_CACHE/);
assert.match(nsisIncludeSource, /Uninstall NAI Prompt Studio\.payload/);
assert.match(nsisIncludeSource, /NAI-Installer-Launcher\.exe/);
assert.match(nsisIncludeSource, /StrCmp \$9 "data" removeContinue/);
assert.match(nsisIncludeSource, /!macro customUnInit/);
assert.match(nsisIncludeSource, /ReadEnvStr \$7 "NAI_INSTALL_DIR"/);
assert.equal(npmrcSource.trim().split(/\r?\n/)[0], 'cache=.local-cache/npm');

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
const changedSourceCard = { ...seedCard, image: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/seed-renamed.webp' };
assert.equal(seedStageFromLive([changedSourceCard], [{ id: 'legacy-id', catalogId: 'legacy-id', tag: seedCard.tag, image: 'cards/artist/danbooru-artist-tags-2-v5/legacy-index.webp', sourceUrl: seedCard.image }], seedStage, seedLive), 0);
writeFileSync(join(seedLive, 'invalid.webp'), 'not webp');
const invalidSeed = { ...seedCard, tag: 'Invalid seed', image: 'https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/invalid.webp' };
assert.equal(seedStageFromLive([invalidSeed], [{ id: stableCatalogId(invalidSeed), catalogId: stableCatalogId(invalidSeed), image: 'cards/artist/danbooru-artist-tags-2-v5/invalid.webp', sourceUrl: invalidSeed.image }], seedStage, seedLive), 0);

const devPaths = resolveAppPaths({ isPackaged: false, workspaceDir: 'D:/workspace', executablePath: 'C:/Program Files/NAI/Prompt Studio.exe' });
assert.equal(devPaths.dataDir.replaceAll('\\', '/'), 'D:/workspace/.app-data');
const packagedPaths = resolveAppPaths({ isPackaged: true, workspaceDir: 'D:/workspace', executablePath: 'C:/Program Files/NAI/Prompt Studio.exe' });
assert.equal(packagedPaths.dataDir.replaceAll('\\', '/'), 'C:/Program Files/NAI/data');
assert.match(devPaths.logsDir.replaceAll('\\', '/'), /D:\/workspace\/\.app-data\/logs$/);
assert.match(devPaths.crashDumpsDir.replaceAll('\\', '/'), /D:\/workspace\/\.app-data\/crash-dumps$/);
assert.match(devPaths.customTagsDir.replaceAll('\\', '/'), /D:\/workspace\/\.app-data\/custom-tags$/);
const pathTemp = localTemp('nai-paths');
const writablePaths = resolveAppPaths({ isPackaged: false, workspaceDir: pathTemp, executablePath: 'C:/Prompt Studio.exe' });
ensureWritable(writablePaths);
const legacy = join(pathTemp, 'legacy', 'workspace.json');
mkdirSync(join(pathTemp, 'legacy'));
writeFileSync(legacy, '{"version":1}');
assert.equal(migrateLegacyWorkspace(legacy, writablePaths.workspaceFile), true);
assert.equal(readFileSync(writablePaths.workspaceFile, 'utf8'), '{"version":1}');
writeFileSync(writablePaths.workspaceFile, '{"version":2}');
assert.equal(migrateLegacyWorkspace(legacy, writablePaths.workspaceFile), false);
const blockedTarget = join(pathTemp, 'blocked');
writeFileSync(blockedTarget, 'file');
assert.throws(() => ensureWritable(resolveAppPaths({ isPackaged: false, workspaceDir: blockedTarget, executablePath: 'C:/Prompt Studio.exe' })), /cannot write its profile/i);
rmSync(pathTemp, { recursive: true, force: true });
rmSync(temp, { recursive: true, force: true });

// V0.6 source contracts: autonomous library records, metadata-only extraction,
// theme chooser, monotonic startup percent, collision solver, installer policy.
assert.match(typesSource, /version\?: 4;[\s\S]*source\?: 'manual'/);
assert.match(storageSource, /normalizeSavedPromptData/);
assert.match(uiSource, /openLibrarySaveModal\('prompt', 'manual'\)/);
assert.match(uiSource, /openLibrarySaveModal\('artist-mix', 'manual'\)/);
assert.doesNotMatch(uiSource, /data-restore-library|>Restore</);
assert.doesNotMatch(uiSource, /Saved sets/);
assert.match(uiSource, /id="save-prompt-library"/);
assert.match(uiSource, /id="copy-prompt"[\s\S]*?id="save-prompt-library"/);
assert.match(metadataWorkspaceSource, /getSavePayload\(\): MetadataSavePayload \| null/);
assert.match(metadataWorkspaceSource, /Add to Saved Library/);
assert.match(metadataWorkspaceSource, /Save Artist Mix/);
assert.match(metadataWorkspaceSource, /extractMetadataArtists\(this\.result\.base\.positive/);
assert.doesNotMatch(metadataWorkspaceSource.match(/getSavePayload\(\)[\s\S]*?\n  \}/)?.[0] ?? '', /sourceObjectUrl/);
assert.match(uiSource, /celestial-light[\s\S]*ember-peach[\s\S]*id: 'gothic-ivory', label: 'Gothic'[\s\S]*id: 'galaxy', label: 'Galaxy'/);
assert.doesNotMatch(uiSource, /Gothic Ivory/);
assert.match(indexSource, /celestial-light','ember-peach','gothic-ivory','galaxy/);
assert.match(indexSource, /name="theme-color" content="#000000"/);
assert.match(electronSource, /backgroundColor: '#000000'/);
assert.match(uiSource, /v060-themes/);
assert.match(styleSource, /\[data-theme="celestial-light"\][\s\S]*color-scheme: light/);
assert.match(styleSource, /\[data-theme="ember-peach"\]/);
const galaxyThemeTokens = styleSource.match(/\[data-theme="galaxy"\]\s*\{([^}]*)\}/)?.[1] ?? '';
assert.ok(galaxyThemeTokens, 'Galaxy theme token block is present');
for (const token of ['--bg-deep: #0e0812', '--panel: #211322', '--ink: #f8edf5', '--accent: #e15b87']) assert.match(galaxyThemeTokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(styleSource, /\[data-theme="galaxy"\] body::before[\s\S]*animation: galaxy-nebula-drift/);
assert.match(styleSource, /\[data-theme="galaxy"\] body::after[\s\S]*animation: galaxy-starfield-drift/);
assert.match(styleSource, /@keyframes galaxy-nebula-drift[\s\S]*transform[\s\S]*opacity/);
assert.match(styleSource, /@keyframes galaxy-starfield-drift[\s\S]*transform[\s\S]*opacity/);
assert.match(styleSource, /:root\[data-theme="galaxy"\]\[data-animation-mode="off"\] body::before,[\s\S]*body::after \{ animation: none/);
assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*:root\[data-theme="galaxy"\]\[data-animation-mode="auto"\] body::before,[\s\S]*body::after \{ animation: none/);
assert.doesNotMatch(styleSource, /:root:not\(\[data-animation-mode="on"\]\) body::before/);
assert.doesNotMatch(styleSource, /:root\[data-animation-mode="auto"\][^\n{]*body::before \{ animation: none/);
assert.doesNotMatch(styleSource, /:root\[data-theme="galaxy"\]\[data-animation-mode="on"\] body::before \{ animation: none/);
assert.doesNotMatch(galaxyThemeTokens, /#82b6e6|#070711|#111126/);
assert.match(styleSource, /\[data-theme-swatch="galaxy"\]/);
const gothicThemeTokens = styleSource.match(/\[data-theme="gothic-ivory"\]\s*\{([^}]*)\}/)?.[1] ?? '';
assert.ok(gothicThemeTokens, 'Gothic theme token block is present');
for (const token of ['--bg-deep: #000', '--panel: #151515', '--panel-raised: #222', '--accent: #fff', '--accent-bright: #fff', '--accent-rgb: 255 255 255', '--accent-bright-rgb: 255 255 255']) assert.match(gothicThemeTokens, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(styleSource, /\[data-theme-swatch="gothic-ivory"\]\s*\{\s*background: #fff/);
assert.match(styleSource, /\[data-theme="gothic-ivory"\] \.startup-shell \{ background: #000; \}/);
assert.match(styleSource, /\[data-theme="gothic-ivory"\] \.startup-panel \{ background: var\(--panel\); \}/);
assert.match(uiSource, /aria-valuemax="100" aria-valuenow="\$\{progress\}"/);
assert.doesNotMatch(uiSource.match(/async function preloadCards[\s\S]*?\n\}/)?.[0] ?? '', /startupCompleted = 0/);
const boundedOrbit = mixOrbitLayout(9, 3, { width: 1180, height: 450, companionWidth: 124, companionHeight: 156, anchorWidth: 360, anchorHeight: 208 });
assert.equal(boundedOrbit.placements.length, 9);
for (let left = 0; left < boundedOrbit.placements.length; left += 1) for (let right = left + 1; right < boundedOrbit.placements.length; right += 1) {
  const a = boundedOrbit.placements[left].box; const b = boundedOrbit.placements[right].box;
  assert.equal(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top, true);
}
const screenshotOrbit = mixOrbitLayout(3, 1, { width: 1180, height: 450, companionWidth: 164, companionHeight: 198, anchorWidth: 160, anchorHeight: 286 });
assert.equal(screenshotOrbit.density, 'regular');
assert.equal(new Set(screenshotOrbit.placements.map(item => `${item.x < 50 ? 'left' : 'right'}:${item.y < 50 ? 'top' : 'bottom'}`)).size, 3);
// Measured layouts must retain every companion at the supported minimum and
// wide desktop widths, while keeping companion cards contained and disjoint.
for (const width of [720, 784, 896, 1024, 1400]) {
  const orbitWidth = width - 32;
  for (const height of [360, 390, 420, 450]) for (const anchorCount of [1, 2, 3, 4]) {
    const companionCount = mixCompanionCapacity(anchorCount);
    const anchorWidth = anchorCount === 1 ? 160 : Math.min(560, anchorCount * 116 + (anchorCount - 1) * 8);
    const measured = mixOrbitLayout(companionCount, anchorCount, { width: orbitWidth, height, companionWidth: Math.min(140, Math.max(120, width * 0.12)), companionHeight: 156, anchorWidth, anchorHeight: anchorCount === 1 ? 286 : 190 });
    assert.equal(measured.placements.length, companionCount);
    assert.equal(measured.height, height);
    assert.ok(measured.companionWidth >= 88);
    const anchor = { left: (orbitWidth - anchorWidth) / 2, top: (measured.height - (anchorCount === 1 ? 286 : 190)) / 2, width: anchorWidth, height: anchorCount === 1 ? 286 : 190 };
    for (let index = 0; index < measured.placements.length; index += 1) {
      const box = measured.placements[index].box;
      assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= orbitWidth && box.top + box.height <= measured.height);
      assert.equal(box.left >= anchor.left + anchor.width || anchor.left >= box.left + box.width || box.top >= anchor.top + anchor.height || anchor.top >= box.top + box.height, true);
      for (let other = index + 1; other < measured.placements.length; other += 1) {
        const peer = measured.placements[other].box;
        assert.equal(box.left + box.width <= peer.left || peer.left + peer.width <= box.left || box.top + box.height <= peer.top || peer.top + peer.height <= box.top, true);
      }
    }
  }
}
// A compact multi-anchor reflow keeps the vertical anchor group while the
// companion cards use their compact silhouette; even the shortest supported
// orbit must then expose every companion.
const compactOrbitWidth = 895; // 980px window minus shell, stage border, and padding.
const compactOrbitHeight = 300; // Conservative stage row after controls and prompt output at 980x700.
const compactAnchor = { left: (compactOrbitWidth - 364) / 2, top: (compactOrbitHeight - 190) / 2, width: 364, height: 190 }; // 3 × 116px cards plus 2 × 8px gaps.
const compactSecondPass = mixOrbitLayout(9, 3, { width: compactOrbitWidth, height: compactOrbitHeight, companionWidth: 164, companionHeight: 198, anchorWidth: compactAnchor.width, anchorHeight: compactAnchor.height });
assert.equal(compactSecondPass.density, 'compact');
assert.equal(compactSecondPass.placements.length, 9);
const boxesOverlap = (a, b) => !(a.left + a.width <= b.left || b.left + b.width <= a.left || a.top + a.height <= b.top || b.top + b.height <= a.top);
for (let index = 0; index < compactSecondPass.placements.length; index += 1) {
  const box = compactSecondPass.placements[index].box;
  assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= compactOrbitWidth && box.top + box.height <= compactOrbitHeight);
  assert.equal(boxesOverlap(box, compactAnchor), false);
  for (const peer of compactSecondPass.placements.slice(index + 1)) assert.equal(boxesOverlap(box, peer.box), false);
}
const fourAnchor = { left: (compactOrbitWidth - 488) / 2, top: (compactOrbitHeight - 190) / 2, width: 488, height: 190 }; // 4 × 116px cards plus 3 × 8px gaps.
const fourAnchorSecondPass = mixOrbitLayout(mixCompanionCapacity(4), 4, { width: compactOrbitWidth, height: compactOrbitHeight, companionWidth: 164, companionHeight: 198, anchorWidth: fourAnchor.width, anchorHeight: fourAnchor.height });
assert.equal(fourAnchorSecondPass.density, 'compact');
assert.equal(fourAnchorSecondPass.placements.length, mixCompanionCapacity(4));
for (let index = 0; index < fourAnchorSecondPass.placements.length; index += 1) {
  const box = fourAnchorSecondPass.placements[index].box;
  assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= compactOrbitWidth && box.top + box.height <= compactOrbitHeight);
  assert.equal(boxesOverlap(box, fourAnchor), false);
  for (const peer of fourAnchorSecondPass.placements.slice(index + 1)) assert.equal(boxesOverlap(box, peer.box), false);
}
assert.doesNotMatch(styleSource, /\.mix-stage \{[^}]*overflow: visible/);
assert.match(uiSource, /data-layout-ready="true"/);
assert.doesNotMatch(styleSource, /\.mix-orbit\[data-layout-ready="false"\] \.mix-orbit-slot \{ visibility: hidden; \}/);
assert.match(uiSource, /data-remove-library-character="\$\{escapeHtml\(character\.id\)\}"/);
assert.match(uiSource, /function removeLibraryCharacter\(characterId: string\)[\s\S]*?captureLibraryFormDraft\(\)[\s\S]*?filter\(character => character\.id !== characterId\)[\s\S]*?focus\(\{ preventScroll: true \}\)/);
assert.match(styleSource, /\.saved-library-character-remove \{[^}]*border-radius: 50%/);
assert.match(styleSource, /\.saved-library-character-remove:hover, \.saved-library-character-remove:focus-visible \{[^}]*background: var\(--danger\)/);
assert.match(styleSource, /\.saved-library-form-scroll \{[^}]*padding: 4px 10px 8px 6px;[^}]*scrollbar-gutter: stable/);
assert.match(styleSource, /\.saved-library-character-add \{[^}]*justify-self: start;[^}]*border-radius: 999px/);
assert.match(metadataWorkspaceSource, /patchPolarityBlock\(button\.closest<HTMLElement>/);
assert.doesNotMatch(metadataWorkspaceSource.match(/\[data-metadata-polarity\][\s\S]*?\}\)\);/)?.[0] ?? '', /refresh\(\)/);
assert.match(metadataWorkspaceSource, /cachedSavePayload/);
assert.match(uiSource, /activeWorkspace === 'metadata' \? `<section[\s\S]*?metadataWorkspace\.markup\(\)/);
assert.doesNotMatch(uiSource, /const metadataMarkup =/);
assert.doesNotMatch(uiSource, /data-copy-library-card/);
assert.match(uiSource, /data-library-copy=/);
assert.match(uiSource, /\.\.\.libraryFormPrompt, characters:/);
assert.doesNotMatch(uiSource.match(/const promptFields = kind === 'prompt'[\s\S]*?;\n/)?.[0] ?? '', /saved-library-model|saved-library-steps|saved-library-sampler|saved-library-width|saved-library-height|saved-library-cfg/);
assert.match(previewSource, /data-library-preview-image/);
assert.match(styleSource, /\.saved-library-card \{[^}]*grid-template-columns: 124px minmax\(0, 1fr\)/);
assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.saved-library-card \{ grid-template-columns: 110px minmax\(0, 1fr\)/);
assert.match(uiSource, /const generationMarkup = generationValues\.length \?/);
assert.doesNotMatch(uiSource.match(/function savedLibraryCardMarkup[\s\S]*?\n\}/)?.[0] ?? '', /\|\| 'Unavailable'/);
assert.match(uiSource, /<div class="mix-actions">[\s\S]*?\$\{status\}<\/section><section class="mix-stage"/);
assert.match(styleSource, /\.mix-random-settings > \.random-notice \{[^}]*grid-column: 1 \/ -1/);
assert.match(uiSource, /button\?\.classList\.contains\('library-copy-icon'\)[\s\S]*?button\.dataset\.copied = 'true'/);
assert.match(uiSource, /tabindex="0" role="img" aria-label="Preview cover for/);
assert.match(nsisIncludeSource, /Preserve local settings, storage, downloads and custom cards/);
assert.match(nsisIncludeSource, /NSD_CreateCheckbox[\s\S]*?Create Start Menu shortcut[\s\S]*?NSD_CreateCheckbox[\s\S]*?Create Desktop shortcut/);
assert.match(nsisIncludeSource, /installer-options\.ini/);
assert.match(nsisIncludeSource, /NAI Prompt Studio\.exe/);
assert.match(nsisIncludeSource, /Get-CimInstance Win32_Process/);
assert.match(nsisIncludeSource, /SetOutPath "\$INSTDIR\\\.nai-uninstaller-cache"/);
assert.doesNotMatch(nsisIncludeSource, /SetOutPath "\$INSTDIR\\data\\temp\\installer"/);
assert.match(installerLauncherSource, /Path\.Combine\(launcherDirectory, "\.nai-uninstaller-cache"\)/);
assert.doesNotMatch(installerLauncherSource, /Directory\.GetParent\(fullCache\)\?\.FullName/);
assert.match(installerLauncherSource, /DirectoryInfo installParent = Directory\.GetParent\(fullCache\);[\s\S]*?installParent == null \? null : installParent\.FullName/);
assert.doesNotMatch(installerLauncherSource, /Path\.Combine\(launcherDirectory, "data", "temp", "installer"\)/);
assert.match(nsisIncludeSource, /\$\{isUpdated\}/);
const closeExactStudioProcessSource = nsisIncludeSource.match(/!macro CloseExactStudioProcessBody[\s\S]*?!macroend/)?.[0] ?? '';
assert.match(closeExactStudioProcessSource, /\$\$target=.*?\$\$self=.*?\$\$p=/);
assert.doesNotMatch(closeExactStudioProcessSource, /(?<!\$)\$(?:target|self|p|closed|x|q|_)(?!\$)/);
assert.match(nsisIncludeSource, /!macro customCheckAppRunning[\s\S]*?!ifdef BUILD_UNINSTALLER[\s\S]*?Call un\.CloseExactStudioProcess[\s\S]*?!else[\s\S]*?Call CloseExactStudioProcess/);
assert.match(nsisIncludeSource, /Function CloseExactStudioProcess[\s\S]*?!insertmacro CloseExactStudioProcessBody[\s\S]*?FunctionEnd/);
assert.match(nsisIncludeSource, /Function un\.CloseExactStudioProcess[\s\S]*?!insertmacro CloseExactStudioProcessBody[\s\S]*?FunctionEnd/);
assert.match(nsisIncludeSource, /!ifndef BUILD_UNINSTALLER\s+Function LoadNAIShortcutPolicy[\s\S]*?Function NAIShortcutOptionsLeave[\s\S]*?FunctionEnd\s+!endif/);
assert.match(nsisIncludeSource, /!ifdef BUILD_UNINSTALLER\s+!macro customUnWelcomePage[\s\S]*?Function un\.NAIPreserveDataLeave[\s\S]*?FunctionEnd\s+!endif/);
assert.match(nsisIncludeSource, /!ifdef BUILD_UNINSTALLER\s+Var NAIPreserveData\s+Var NAIPreserveDataCheckbox\s+!else\s+Var NAIStartMenuShortcut[\s\S]*?Var NAIShortcutPolicyDirectory[\s\S]*?Var NAICatalogOptionsFresh\s+!endif/);
const customInstallSource = nsisIncludeSource.match(/!macro customInstall[\s\S]*?!macroend/)?.[0] ?? '';
assert.doesNotMatch(customInstallSource, /ReadINIStr[\s\S]*installer-options\.ini/);
// The assisted template inserts customUninstallPage after MUI_UNPAGE_INSTFILES;
// data-retention choices therefore must be collected by the pre-action welcome hook.
assert.match(nsisIncludeSource, /!macro customUnWelcomePage[\s\S]*?NSD_CreateCheckbox/);
assert.match(nsisIncludeSource, /!macro customUnWelcomePage\s+UninstPage custom un\.NAIPreserveDataPage un\.NAIPreserveDataLeave\s+!macroend/);
assert.doesNotMatch(nsisIncludeSource.match(/!macro customUnInstall[\s\S]*?!macroend/)?.[0] ?? '', /MessageBox MB_YESNO/);
const preserveDataPageSource = nsisIncludeSource.match(/Function un\.NAIPreserveDataPage[\s\S]*?FunctionEnd/)?.[0] ?? '';
assert.doesNotMatch(preserveDataPageSource, /\$\{isUpdated\}/);
assert.match(preserveDataPageSource, /\$\{GetParameters\}[\s\S]*?\$\{GetOptions\}[\s\S]*?"--updated"[\s\S]*?\$\{IfNot\} \$\{Errors\}/);
const customHeaderSource = nsisIncludeSource.match(/!macro customHeader[\s\S]*?!macroend/)?.[0] ?? '';
assert.doesNotMatch(customHeaderSource, /!macro customCheckAppRunning/);
assert.match(nsisIncludeSource, /!include "LogicLib\.nsh"[\s\S]*?!include "FileFunc\.nsh"[\s\S]*?!include "nsDialogs\.nsh"[\s\S]*?!macro customHeader/);
assert.equal(packageSource.build.nsis.runAfterFinish, true);
assert.equal(packageSource.build.nsis.createStartMenuShortcut, true);
assert.equal(packageSource.build.nsis.createDesktopShortcut, false);
assert.match(electronSource, /APP_USER_MODEL_ID/);
assert.match(electronSource, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
assert.match(electronSource, /APP_ICON/);
assert.match(installerLauncherSource, /CanonicalApplicationExecutable/);
assert.match(installerLauncherSource, /NAISETUPV0630000/);

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
const legacyResults = await ensureSelectedComponents({ catalogDir: legacyCatalogDir, dataDir: legacyProfile, descriptors: [artistComponent.descriptor, { ...artistComponent.descriptor, id: 'guide', filename: COMPONENTS.guide.filename, expectedRoot: COMPONENTS.guide.expectedRoot, count: COMPONENTS.guide.count }, { ...artistComponent.descriptor, id: 'characters', filename: COMPONENTS.characters.filename, expectedRoot: COMPONENTS.characters.expectedRoot, count: COMPONENTS.characters.count }], request: async () => { throw new Error('legacy source must suppress downloads'); }, archiveInspector: componentInspector });
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

// A damaged regular component must not shadow a validated migrated archive;
// runtime resolution should continue down the documented source precedence.
writeFileSync(componentFile(legacyCatalogDir, legacyArtistDescriptor), 'damaged component');
assert.match(resolveComponentAsset(legacyCatalogDir, 'cards/artist/danbooru-artist-tags-2-v5/fixture.webp'), /legacy-app\.asar/);

const warmupCards = Array.from({ length: 8 }, (_, index) => ({ id: `warm-${index}`, catalogId: `warm-${index}`, tag: `Warm ${index}`, image: `cards/artist/${index}.webp` }));
const warmupPlan = buildWarmupPlan(warmupCards, { selected: ['warm-3'], anchors: ['warm-2'], companions: ['warm-2', 'warm-1'], visible: ['warm-0'], initialLimit: warmupCards.length });
assert.deepEqual(warmupPlan.slice(0, 5).map(item => item.id), ['warm-3', 'warm-2', 'warm-1', 'warm-0', 'warm-4']);
let activeWarmups = 0; let maxWarmups = 0; const finishedWarmups = [];
const warmupRun = scheduleIdleWarmup(warmupPlan, async item => { activeWarmups += 1; maxWarmups = Math.max(maxWarmups, activeWarmups); await new Promise(resolve => setTimeout(resolve, 1)); activeWarmups -= 1; finishedWarmups.push(item.id); return true; }, 0, callback => setTimeout(callback, 0), 2);
warmupRun.startIdle();
while (finishedWarmups.length < warmupPlan.length) await new Promise(resolve => setTimeout(resolve, 2));
assert.ok(maxWarmups <= 2);
assert.equal(new Set(finishedWarmups).size, warmupPlan.length);

assert.doesNotMatch(preloadSource, /process\.isPackaged/);
assert.match(uiSource, /async function loadCatalogMode/);
assert.match(uiSource, /packagedCatalogMode/);
assert.match(electronSource, /fs\.readFileSync\(target\)/);
assert.match(uiSource.match(/async function bootApp\(\)[\s\S]*?\n\}/)?.[0] ?? '', /openStudioAfterStartup\(\);[\s\S]*?scheduleIdleWarmup/);
assert.doesNotMatch(uiSource.match(/async function bootApp\(\)[\s\S]*?\n\}/)?.[0] ?? '', /await preloadCards\(initialWarmup/);
assert.match(uiSource, /status\.status === 'Installed' \|\| status\.status === 'Migrated'/);
assert.match(uiSource, /status\.status === 'Missing' && Boolean\(status\.error\)/);
assert.doesNotMatch(uiSource.match(/function componentSettingsMarkup[\s\S]*?\n\}/)?.[0] ?? '', /Delete/);
assert.match(nsisIncludeSource, /fsutil\.exe.*hardlink create/);
assert.doesNotMatch(nsisIncludeSource, /CreateHardLink|67108864/);
assert.match(nsisIncludeSource, /workspace\.json/);
assert.match(nsisIncludeSource, /data\\catalog\\\*\.\*/);
const checkOrder = nsisIncludeSource.match(/!macro customCheckAppRunning[\s\S]*?!macroend/)?.[0] ?? '';
assert.ok(checkOrder.indexOf('Call CloseExactStudioProcess') < checkOrder.indexOf('Call PreserveLegacyCatalog'));
// The no-prior-legacy branch must probe the existing v0.6.2 source ($src),
// not the destination ($legacy) that is only created by the later copy.
const preserveLegacySourceFlow = nsisIncludeSource.match(/preserveLegacySourceExists:[\s\S]*?Pop \$0/)?.[0] ?? '';
assert.match(preserveLegacySourceFlow, /param\(\[string\]\$\$src,\[string\]\$\$dst\)/);
assert.match(preserveLegacySourceFlow, /\$\$info=Get-Item -LiteralPath \$\$src/);
assert.equal(preserveLegacySourceFlow.includes('$$info=Get-Item -LiteralPath $$legacy'), false);
assert.match(preserveLegacySourceFlow, /\$\$env:SystemRoot/);
assert.doesNotMatch(preserveLegacySourceFlow, /(?<!\$)\$env:SystemRoot/);

// v0.6.3 installer migration commands must be parser-safe for paths with
// spaces/apostrophes and must not inspect an arbitrary ASAR-header marker.
const preserveLegacyFunctionSource = nsisIncludeSource.match(/Function PreserveLegacyCatalog[\s\S]*?FunctionEnd/)?.[0] ?? '';
const preserveLegacyCommandSource = preserveLegacyFunctionSource.match(/preserveLegacySourceExists:[\s\S]*?nsExec::Exec[\s\S]*?Pop \$0/)?.[0] ?? '';
assert.equal((nsisIncludeSource.match(/nsExec::Exec/g) ?? []).length, 3);
assert.equal(nsisIncludeSource.includes('ExecToStack'), false);
assert.equal(nsisIncludeSource.includes("''"), false);
assert.doesNotMatch(preserveLegacyFunctionSource, /catalog\.json|dist\/catalog|ASCII|8388608|buffer/);
assert.match(preserveLegacyFunctionSource, /param\(\[string\]\$\$legacy\)/);
assert.match(preserveLegacyFunctionSource, /param\(\[string\]\$\$src,\[string\]\$\$dst\)/);
assert.match(preserveLegacyFunctionSource, /268435456/);
assert.match(preserveLegacyFunctionSource, /\$\$partial=/);
assert.match(preserveLegacyFunctionSource, /Test-Path -LiteralPath \$\$partial -PathType Leaf/);
assert.doesNotMatch(preserveLegacyFunctionSource, /Get-FileHash/);
assert.match(preserveLegacyFunctionSource, /\[Security\.Cryptography\.SHA512\]::Create\(\)/);
assert.match(preserveLegacyFunctionSource, /\$\$hashFile=\{ param\(\[string\]\$\$path\)/);
assert.match(preserveLegacyFunctionSource, /\[IO\.File\]::OpenRead\(\$\$path\)/);
assert.match(preserveLegacyFunctionSource, /\$\$srcHash=& \$\$hashFile \$\$src/);
assert.match(preserveLegacyFunctionSource, /\$\$partialHash=& \$\$hashFile \$\$partial/);
assert.match(preserveLegacyFunctionSource, /\$\$sha512\.ComputeHash\(\$\$hashStream\)/);
assert.match(preserveLegacyFunctionSource, /\[BitConverter\]::ToString/);
assert.match(preserveLegacyFunctionSource, /\$\$hashStream\.Dispose\(\)/);
assert.match(preserveLegacyFunctionSource, /\$\$sha512\.Dispose\(\)/);
assert.match(preserveLegacyFunctionSource, /\[IO\.File\]::Replace\(\$\$partial,\$\$dst/);
assert.match(preserveLegacyFunctionSource, /\[IO\.File\]::Move\(\$\$partial,\$\$dst\)/);
assert.match(preserveLegacyFunctionSource, /catch \{ if\(\$\$partial\)\{Remove-Item -LiteralPath \$\$partial/);
assert.equal((preserveLegacyCommandSource.match(/Pop \$0/g) ?? []).length, 1);
assert.ok(preserveLegacyCommandSource.indexOf('Remove-Item -LiteralPath $$partial') < preserveLegacyCommandSource.indexOf('$$fsutil=Join-Path'));
assert.ok(preserveLegacyCommandSource.indexOf('$$fsutil=Join-Path') < preserveLegacyCommandSource.indexOf('Copy-Item -LiteralPath $$src'));
assert.ok(preserveLegacyCommandSource.indexOf('Copy-Item -LiteralPath $$src') < preserveLegacyCommandSource.indexOf('$$staged=Get-Item'));
assert.ok(preserveLegacyCommandSource.indexOf('$$srcHash=') < preserveLegacyCommandSource.indexOf('[IO.File]::Replace'));
assert.doesNotMatch(preserveLegacyFunctionSource, /(?<!\$)\$env:SystemRoot/);
assert.doesNotMatch(preserveLegacyFunctionSource, /C:\\|PLUGINSDIR|\$TEMP|NAI_PROOF_ENV_RESULT/);
assert.match(nsisIncludeSource, /Legacy catalog preservation skipped:[^\n]*fat v0\.6\.2/);
assert.match(nsisIncludeSource, /Legacy catalog preservation failed before the previous application was removed/);
const preserveFailureMessageSource = preserveLegacyFunctionSource.match(/DetailPrint "Legacy catalog preservation failed[\s\S]*?Abort/)?.[0] ?? '';
assert.match(preserveFailureMessageSource, /!ifndef NAI_INSTALLER_PROOF[\s\S]*MessageBox MB_ICONSTOP[\s\S]*!endif/);
assert.doesNotMatch(nsisIncludeSource, /NAI_PROOF_ENV_RESULT/);
assert.match(installerProofSource, /!define NAI_INSTALLER_PROOF/);
assert.doesNotMatch(installerProofSource, /NAI_PROOF_TEST|NAI_PROBE_VALUE|NAI_PROOF_ENV_RESULT/);
assert.doesNotMatch(installerProofSource, /ExecToStack|DEBUG|debug|;\s*Call PreserveLegacyCatalog/);
assert.match(installerProofRunnerSource, /timeout: 120000/);
assert.match(installerProofRunnerSource, /stdio: \['ignore', 'pipe', 'pipe'\]/);
assert.match(installerProofRunnerSource, /maxBuffer: 1024 \* 1024/);
assert.match(installerProofRunnerSource, /const fallbackInstall = join\(proofDir, [\"']copy fallback install path with spaces and apostrophe/);
assert.match(installerProofRunnerSource, /SystemRoot: join\(proofDir, ['"]missing-system-root['"]\)/);
assert.match(installerProofRunnerSource, /Copy fallback did not atomically produce a complete destination/);

const closeExactCommandSource = closeExactStudioProcessSource.match(/nsExec::Exec[\s\S]*?Pop \$0/)?.[0] ?? '';
assert.match(closeExactCommandSource, /param\(\[string\]\$\$target\)/);
assert.equal((closeExactCommandSource.match(/Pop \$0/g) ?? []).length, 1);
assert.doesNotMatch(closeExactCommandSource, /''|(?<!\$)\$(?:target|self|p|closed|x|q)(?!\$)/);

// V0.6.1 Artist Mix, persistence, and Galaxy regressions.
assert.match(typesSource, /interface ArtistMixDraft[\s\S]*?anchorWeightsLocked: boolean/);
assert.match(storageSource, /anchorWeightsLocked: source\.anchorWeightsLocked !== false/);
assert.match(uiSource, /function currentMixArtistPickerPage\(\):[\s\S]*?const useFavorites = artistMix\.favoritesOnly/);
assert.match(uiSource, /id="mix-anchor-weights-lock"[\s\S]*?aria-pressed="\$\{artistMix\.anchorWeightsLocked\}"[\s\S]*?Lock anchor strength/);
assert.match(uiSource, /id="mix-reroll-strength"[\s\S]*?>Reroll strength</);
assert.match(uiSource, /function rerollMixStrength\(\)/);
assert.match(uiSource, /function randomizeMix\(\)[\s\S]*?artistMix\.anchorWeightsLocked \? artistMix\.anchors : rerollArtistWeights\(artistMix\.anchors\)/);
assert.match(uiSource, /function syncMixBehaviorControls\(\)[\s\S]*?classList\.toggle\('on', artistMix\.favoritesOnly\)[\s\S]*?setAttribute\('aria-pressed', String\(artistMix\.favoritesOnly\)\)[\s\S]*?Favorites \(\$\{mixPool\(\)\.length\}\)/);
const mixFavoritesHandler = uiSource.match(/document\.querySelector\('#mix-favorites-only'\)[\s\S]*?\);/)?.[0] ?? '';
assert.doesNotMatch(mixFavoritesHandler, /render\(\)|scheduleMixOrbitThreads\(\)/);
const mixLockHandler = uiSource.match(/document\.querySelector\('#mix-anchor-weights-lock'\)[\s\S]*?\n  \}\);/)?.[0] ?? '';
assert.doesNotMatch(mixLockHandler, /render\(\)|scheduleMixOrbitThreads\(\)/);
assert.match(uiSource, /mixPickerMode: 'primary' \| 'companion' \| 'replace-anchor'/);
assert.match(uiSource, /mixPickerReplaceTarget/);
assert.match(uiSource, /data-mix-replace-anchor/);
assert.match(uiSource, /openMixPicker\('replace-anchor',[\s\S]*?button\.dataset\.mixReplaceAnchor/);
assert.match(uiSource, /function replaceMixAnchor\(card: CatalogCard\)[\s\S]*?target\.weight[\s\S]*?companions = artistMix\.companions\.filter/);
const replaceAnchorSource = uiSource.match(/function replaceMixAnchor\(card: CatalogCard\)[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(replaceAnchorSource, /if \(duplicateAnchor\) return;/);
assert.doesNotMatch(replaceAnchorSource, /anchors = duplicateAnchor[\s\S]*?filter\(item => item\.id !== target\.id\)/);
assert.match(uiSource, /mixPickerMode === 'replace-anchor' \? replaceMixAnchor\(card\)/);
const instantMixSource = uiSource.match(/if \(!shouldAnimate\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
assert.ok(instantMixSource.indexOf('render();') < instantMixSource.indexOf('layoutMixOrbitThreads();'), 'instant Artist Mix commits must lay out synchronously after render');
assert.match(uiSource, /function syncMixWeightState\([\s\S]*?saveArtistMixSoon\(\);[\s\S]*?scheduleMixOrbitThreads\(\);[\s\S]*?focusTarget\.focus/);
const syncMixWeightSource = uiSource.match(/function syncMixWeightState\([\s\S]*?\n\}/)?.[0] ?? '';
assert.doesNotMatch(syncMixWeightSource, /render\(\)/);
assert.match(uiSource, /syncMixWeightState\(\{ \.\.\.artistMix, anchors: artistMix\.anchors\.map\(update\), companions: artistMix\.companions\.map\(update\) \}, \[target\], input\)/);
assert.match(uiSource, /syncMixWeightState\(\{ \.\.\.artistMix, anchors: artistMix\.anchors\.map\(update\), companions: artistMix\.companions\.map\(update\) \}, \[target\], button, notice\)/);
assert.match(uiSource, /class="mix-orbit-primary mix-anchor-group \$\{anchors\.length > 1 \? 'is-multi-anchor' : 'is-single-anchor'\}"/);
assert.match(uiSource, /class="mix-orbit-slot\$\{transitionClass\}"/);
assert.match(uiSource, /--mix-slot-index:\$\{index\}/);
assert.match(styleSource, /\.mix-orbit-slot\.is-mix-exiting[\s\S]*?opacity: 0/);
assert.match(styleSource, /\.mix-orbit-slot\.is-mix-entering[\s\S]*?transition-delay: calc\(var\(--mix-slot-index/);
const mixEnterMotion = styleSource.match(/\.mix-orbit-slot\.is-mix-entering \.mix-orbit-upright,[\s\S]*?transition-delay: calc\(var\(--mix-slot-index[^}]+\}/)?.[0] ?? '';
const mixExitMotion = styleSource.match(/\.mix-orbit-slot\.is-mix-exiting \.mix-orbit-upright,[\s\S]*?transition-delay: 0ms;/)?.[0] ?? '';
assert.match(mixEnterMotion, /transition-delay: calc\(var\(--mix-slot-index/);
assert.match(mixExitMotion, /transition-delay: 0ms/);
assert.doesNotMatch(mixExitMotion, /--mix-slot-index/);
assert.match(styleSource, /\.mix-anchor-replace-trigger/);
assert.match(uiSource, /<div class="mix-anchor-identity">/);
assert.match(styleSource, /\.mix-anchor-identity \{ min-width: 0; \}/);
assert.doesNotMatch(styleSource, /\.mix-artist-identity \{ min-width: 0; \}/);
assert.match(styleSource, /\.artist-catalog-picker \.artist-catalog-grid \{[\s\S]*align-content: start;[\s\S]*align-items: start;[\s\S]*grid-auto-rows: max-content/);
assert.match(styleSource, /\.mix-anchor-group\.is-multi-anchor[\s\S]*width: clamp\(116px, 11vw, 128px\)/);
assert.match(styleSource, /\.mix-anchor-group\.is-multi-anchor[\s\S]*grid-column: 1 \/ -1/);
assert.match(styleSource, /\.mix-anchor-group\.is-multi-anchor[\s\S]*grid-template-rows: 18px 21px/);
assert.match(styleSource, /\.mix-orbit-primary\.mix-anchor-group\.is-multi-anchor \{ max-width: min\(560px, calc\(100% - 20px\)\); \}/);
assert.doesNotMatch(styleSource.match(/\.mix-orbit\[data-layout-density="compact"\] \.mix-anchor-group\.is-multi-anchor[\s\S]*?\n\}/)?.[0] ?? '', /width: 96px|height: 64px/);
assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /Eight interface themes/);
assert.equal(packageSource.version, '0.6.3');
assert.equal(lockSource.version, packageSource.version);
assert.equal(lockSource.packages[''].version, packageSource.version);
rmSync(testTempRoot, { recursive: true, force: true });
console.log(`Tests passed: page discovery, atomic replacement/failure recovery, WebP validation, prompt serialization, migration, random uniqueness, and exact catalog assets (${catalog.artists.length} V5 artists / ${catalog.characters.length} characters).`);

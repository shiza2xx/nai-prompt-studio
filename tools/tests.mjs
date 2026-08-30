import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildArtistsPrompt, buildBasePrompt, serializeTag } from '../src/prompt.ts';
import { MetadataArtistHighlighter, decodeCatalogEntities, escapeMetadataHtml, extractMetadataArtists, serializeMetadataArtists } from '../src/metadata-artist-highlight.ts';
import { normalizeAnimationMode, normalizeArtistMix, normalizeCustomTag, normalizeCustomTagPresetId, normalizeCustomTagPresets, normalizeDraft, normalizeRandomRange, normalizeSavedLibrary, normalizeSavedLibraryItem, normalizeTheme, normalizeSettings, normalizePreviewCachePreset } from '../src/storage.ts';
import { DEFAULT_CUSTOM_TAG_PRESET_ID, DEFAULT_CUSTOM_TAG_PRESET_NAME } from '../src/custom-tag-presets.ts';
import { commitSnapshot, discoverCards, EXPECTED_CARD_COUNT, GALLERY_URL, isWebp, makeCatalog, parseGalleryPage, seedStageFromLive, stableAssetFilename, stableCatalogId } from './update-v5-catalog.mjs';
import { normalizeArtistWeight, pickUniqueCards, randomArtistSelection, randomCount, randomWeight, reconcileSelectedArtists, rerollArtistWeight, rerollArtistWeights, resolveRandomPoolRange } from '../src/random.ts';
import { decodePreviews } from '../src/preview-loader.ts';
import { ARTIST_PAGE_SIZE, CHARACTER_PAGE_SIZE, filterCharacters, paginateArtists, paginateCharacters } from '../src/catalog-browser.ts';
import { mixCompanionCapacity, mixCompanionScale, mixOrbitLayout } from '../src/artist-mix-layout.ts';
import { artistDisplayName, canonicalArtistIdentity, customArtistCatalogId, mergeArtistCatalog, migrateArtistAliases, migrateArtistMixAliases, migrateFavoriteAliases } from '../src/artist-catalog.ts';
import { decodeStealthPayload, extractImageMetadata, normalizeMetadata, parseMetadataJson, parsePngTextChunks, parseWebpExifUserComment } from '../src/image-metadata.ts';
import { BUILTIN_CONSTRUCTOR_FOLDER_ID, canonicalCustomTagIdentity, canonicalGroupIdentity, classifyGuideEntries, constructorCardTags, groupConstructorCards, guideVisualCount, hasPromptTag, hasPromptTagGroup, mergeConstructorCards, qualityPresetTags, searchConstructorFolders, splitTagGroup, togglePromptTag, togglePromptTagGroup } from '../src/prompt-constructor.ts';
import { buildWarmupPlan, scheduleIdleWarmup, uniqueWarmupItems } from '../src/catalog-warmup.ts';
import { PreviewCache } from '../src/preview-cache.ts';
import { createOfficialArtistThumbnail, OFFICIAL_ARTIST_THUMBNAIL_HEIGHT, OFFICIAL_ARTIST_THUMBNAIL_WIDTH } from '../src/artist-thumbnail.ts';
import { createMetadataDisplayPreview, METADATA_DISPLAY_PREVIEW_MAX_HEIGHT, METADATA_DISPLAY_PREVIEW_MAX_WIDTH } from '../src/metadata-display-preview.ts';
import { CUSTOM_TAG_MAX_LENGTH, PREVIEW_CACHE_BUDGETS } from '../src/types.ts';
import { classifyCustomTagDrop } from '../src/custom-tag-dnd.ts';

const require = createRequire(import.meta.url);
const nativeFs = require('node:fs');
const { createPackage, createPackageFromFiles, extractFile, listPackage } = require('@electron/asar');
const { resolveAppPaths, ensureWritable, migrateLegacyWorkspace } = require('../electron/app-paths.cjs');
const { containedAsset, hasValidMagic, validateImagePayload } = require('../electron/custom-tag-assets.cjs');
const { createCustomTagLibrary, digestMirror, writeWorkspaceSection } = require('../electron/custom-tag-library.cjs');
const { canonicalJson, createPackArchive, validatePackArchive, MAX_CARDS, MAX_ENTRIES } = require('../electron/custom-tag-pack.cjs');
const { loadCatalog: loadRuntimeCatalog, parseGalleryPage: parseRuntimeGalleryPage, normalizeImageUrl: normalizeRuntimeImageUrl, runUpdate: runRuntimeCatalogUpdate, catalogAssetFromProtocolUrl, resolveActiveCatalogAsset } = require('../electron/catalog-updater.cjs');
const { parsePostUrl, formatNovelAITags, loadPost: loadBooruPost, requestBytes: requestBooruBytes } = require('../electron/booru-metadata.cjs');
const { compareVersions, validateManifest, readResponseJson, downloadInstaller, parseContentRange } = require('../electron/app-updater.cjs');
const { COMPONENTS, componentFile, partialFile, componentPaths, normalizeDescriptor, verifyComponent, loadState, saveState, activateComponent, resolveComponentAsset, ensureComponent, ensureSelectedComponents, validateLegacyArchive, downloadComponent, inspectComponent, statusForComponent, statuses, safeRelative } = require('../electron/catalog-components.cjs');

// Saved Character records are autonomous and strictly discriminated. Their
// compatibility prompt mirrors positive text, while malformed character data
// is rejected instead of being coerced into a prompt item.
const characterRecord = normalizeSavedLibraryItem({ version: 4, id: 'character-record', kind: 'character', source: 'manual', name: 'Mira', description: 'A saved character', prompt: 'stale prompt', data: { positive: 'blue eyes, short hair', negative: 'blurry' }, createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z' });
assert.equal(characterRecord?.kind, 'character');
assert.equal(characterRecord?.prompt, 'blue eyes, short hair');
assert.deepEqual(characterRecord?.data, { positive: 'blue eyes, short hair', negative: 'blurry' });
assert.equal(normalizeSavedLibraryItem({ version: 4, id: 'bad-character', kind: 'character', name: 'Bad', data: { positive: 'only one side' } }), null);
for (const length of [180, 181, CUSTOM_TAG_MAX_LENGTH]) assert.equal(normalizeCustomTag({ id: `tag-${length}`, kind: 'artist', zone: 'frame', tag: 'x'.repeat(length) })?.tag.length, length);
assert.equal(normalizeCustomTag({ id: 'tag-over-limit', kind: 'artist', zone: 'frame', tag: 'x'.repeat(CUSTOM_TAG_MAX_LENGTH + 1) }), null);

const testTempRoot = join(process.cwd(), '.test-tmp-v063', String(process.pid));
mkdirSync(testTempRoot, { recursive: true });
const localTemp = prefix => mkdtempSync(join(testTempRoot, `${prefix}-`));
// Keep this run isolated even when an assertion aborts before the normal
// footer cleanup. The pre-existing .test-tmp-v063 root is intentionally left
// untouched.
process.once('exit', () => { try { rmSync(testTempRoot, { recursive: true, force: true }); } catch {} });

// Booru metadata remains deterministic and renderer-independent: all three
// accepted page grammars, normalization, bounded candidate fallback, and
// redirect policy are exercised with injected fetch responses.
assert.equal(parsePostUrl('https://danbooru.donmai.us/posts/42').site, 'danbooru');
assert.equal(parsePostUrl('https://konachan.com/post/show/42').site, 'konachan');
assert.equal(parsePostUrl('https://safebooru.org/index.php?page=post&s=view&id=42').site, 'safebooru');
for (const value of ['http://danbooru.donmai.us/posts/42', 'https://danbooru.donmai.us:443/posts/42', 'https://danbooru.donmai.us/posts/42?x=1', 'https://danbooru.donmai.us/posts/nope', 'https://safebooru.org/index.php?page=post&s=view&id=42&x=1']) assert.throws(() => parsePostUrl(value));
assert.equal(formatNovelAITags('blue_eyes red_hair blue_eyes'), 'blue eyes, red hair');
assert.equal(formatNovelAITags('blue_eyes, red_hair, blue_eyes'), 'blue eyes, red hair');
const booruPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const booruResponses = new Map([
  ['https://danbooru.donmai.us/posts/42.json', new Response(JSON.stringify({ id: 42, tag_string: 'blue_eyes red_hair', image_width: 640, image_height: 480, rating: 's', source: 'https://example.test/source', large_file_url: 'https://cdn.donmai.us/missing.png', file_url: 'https://cdn.donmai.us/good.png' }), { status: 200, headers: { 'content-type': 'application/json' } })],
  ['https://cdn.donmai.us/missing.png', new Response('missing', { status: 404 })],
  ['https://cdn.donmai.us/good.png', new Response(booruPng, { status: 200, headers: { 'content-type': 'image/png' } })]
]);
const booruResult = await loadBooruPost('https://danbooru.donmai.us/posts/42', { fetch: async url => booruResponses.get(url) ?? new Response('not found', { status: 404 }) });
assert.equal(booruResult.tags, 'blue eyes, red hair'); assert.equal(booruResult.mime, 'image/png'); assert.equal(booruResult.width, '640'); assert.equal(booruResult.height, '480'); assert.equal(booruResult.id, '42');
const redirectResponses = new Map([
  ['https://danbooru.donmai.us/posts/42.json', new Response(null, { status: 302, headers: { location: 'https://evil.example/posts/42.json' } })]
]);
await assert.rejects(() => loadBooruPost('https://danbooru.donmai.us/posts/42', { fetch: async url => redirectResponses.get(url) }), /redirected|approved/i);
await assert.rejects(() => loadBooruPost('https://danbooru.donmai.us/posts/42', { fetch: async url => url.endsWith('.json') ? new Response(JSON.stringify({ id: 42, tag_string: 'x', file_url: 'https://cdn.donmai.us/good.png' })) : new Response(booruPng, { status: 200, headers: { 'content-type': 'image/png' } }) }), /MIME|JSON/i);
await assert.rejects(() => loadBooruPost('https://danbooru.donmai.us/posts/42', { fetch: async url => url.endsWith('.json') ? new Response(JSON.stringify({ tag_string: 'x', file_url: 'https://cdn.donmai.us/good.png' }), { headers: { 'content-type': 'application/json' } }) : new Response(booruPng, { status: 200, headers: { 'content-type': 'image/png' } }) }), /post|id/i);
for (const mode of ['timeout', 'cancel']) {
  let cancelled = false; let released = false;
  const reader = { read: () => new Promise(() => {}), cancel: async () => { cancelled = true; }, releaseLock: () => { released = true; } };
  const controller = new AbortController();
  const fetch = async () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => reader } });
  const options = { fetch, timeoutMs: 12, ...(mode === 'cancel' ? { signal: controller.signal } : {}) };
  if (mode === 'cancel') setTimeout(() => controller.abort(), 3);
  await assert.rejects(() => requestBooruBytes(fetch, 'https://danbooru.donmai.us/posts/42.json', { site: 'danbooru', kind: 'api', ...options }), error => error?.code === (mode === 'timeout' ? 'TIMEOUT' : 'ABORT_ERR'));
  assert.equal(cancelled, true, `${mode} must cancel a pending response stream`); assert.equal(released, true, `${mode} must release a pending response stream lock`);
}

// v0.6.6 Custom Tags: canonical per-preset manifests migrate exact bytes and
// every mutation returns a complete normalized snapshot.
const customLibraryTemp = localTemp('custom-library');
const customLibraryAssets = join(customLibraryTemp, 'custom-tags');
const customLibraryWorkspace = join(customLibraryTemp, 'workspace.json');
mkdirSync(customLibraryAssets);
const exactPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const exactJpeg = Buffer.from([255, 216, 255, 224, 9, 8, 7]);
const exactWebp = Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBPdata', 'latin1');
writeFileSync(join(customLibraryAssets, 'legacy.png'), exactPng);
writeFileSync(join(customLibraryAssets, 'legacy.jpg'), exactJpeg);
writeFileSync(join(customLibraryAssets, 'legacy.webp'), exactWebp);
writeFileSync(customLibraryWorkspace, JSON.stringify({ version: 3, customTagPresets: [{ id: 'default', name: 'My Tags', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, { id: 'portrait', name: 'Portrait', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }], customTags: [{ id: 'comma-tag', kind: 'tag', tag: 'one, two', zone: 'scene', presetId: 'portrait', description: 'keeps, commas', imageAsset: 'legacy.png', mime: 'image/png', originalName: 'source.png', createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' }, { id: 'jpeg-tag', kind: 'tag', tag: 'jpeg', zone: 'frame', presetId: 'portrait', imageAsset: 'legacy.jpg', mime: 'image/jpeg', createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' }, { id: 'preview-artist', kind: 'artist', tag: 'artist: Preview', presetId: 'portrait', imageAsset: 'legacy.webp', mime: 'image/webp', createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' }, { id: 'text-artist', kind: 'artist', tag: 'artist: Test', zone: 'frame', presetId: 'missing', createdAt: '2026-01-04T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z' }] }));
const customLibrary = createCustomTagLibrary({ customTagsDir: customLibraryAssets, workspaceFile: customLibraryWorkspace, now: () => '2026-08-29T00:00:00.000Z' });
const migratedCustomLibrary = customLibrary.load();
assert.deepEqual(migratedCustomLibrary.presets.map(item => item.id), ['default', 'portrait']);
assert.equal(migratedCustomLibrary.tags.find(item => item.id === 'comma-tag')?.tag, 'one, two');
assert.equal(migratedCustomLibrary.tags.find(item => item.id === 'text-artist')?.presetId, 'default');
const migratedAsset = migratedCustomLibrary.tags.find(item => item.id === 'comma-tag')?.imageAsset;
assert.deepEqual(readFileSync(join(customLibraryAssets, 'library-v1', 'presets', migratedAsset)), exactPng);
assert.equal(normalizeCustomTag(migratedCustomLibrary.tags.find(item => item.id === 'comma-tag'))?.imageAsset, migratedAsset, 'desktop normalization must retain canonical preview refs');
assert.equal(normalizeCustomTag({ ...migratedCustomLibrary.tags.find(item => item.id === 'comma-tag'), id: 'character-card', zone: 'character' })?.zone, 'character', 'character cards persist as a distinct Custom Tags zone');
assert.equal(normalizeCustomTag({ ...migratedCustomLibrary.tags.find(item => item.id === 'comma-tag'), imageAsset: `../${migratedAsset}` }), null);
for (const [idValue, exact] of [['jpeg-tag', exactJpeg], ['preview-artist', exactWebp]]) assert.deepEqual(readFileSync(join(customLibraryAssets, 'library-v1', 'presets', migratedCustomLibrary.tags.find(item => item.id === idValue).imageAsset)), exact);
const initialMirror = JSON.parse(readFileSync(customLibraryWorkspace, 'utf8'));
const mirroredComma = initialMirror.customTags.find(item => item.id === 'comma-tag');
assert.equal(mirroredComma.imageAsset.includes('/'), false, 'compatibility mirror must use old-version-safe flat refs');
assert.equal(normalizeCustomTag(mirroredComma)?.imageAsset, mirroredComma.imageAsset);
assert.deepEqual(readFileSync(join(customLibraryAssets, mirroredComma.imageAsset)), exactPng, 'flat mirror bytes must exactly match canonical bytes');
const initialIndex = JSON.parse(readFileSync(join(customLibraryAssets, 'library-v1', 'index.json'), 'utf8'));
assert.equal(initialIndex.schemaVersion, 1);
assert.equal(initialIndex.mirrorDigest, digestMirror(initialMirror.customTagPresets, initialMirror.customTags), 'index digest must describe the actual flat compatibility arrays');
assert.equal(JSON.parse(readFileSync(join(customLibraryAssets, 'library-v1', 'presets', 'portrait', 'manifest.json'), 'utf8')).schemaVersion, 1);
writeWorkspaceSection(customLibraryWorkspace, 'settings', { theme: 'noir' });
const mirrorAfterGenericSave = JSON.parse(readFileSync(customLibraryWorkspace, 'utf8'));
assert.deepEqual(mirrorAfterGenericSave.customTags, initialMirror.customTags); assert.deepEqual(mirrorAfterGenericSave.customTagPresets, initialMirror.customTagPresets); assert.equal(mirrorAfterGenericSave.customTagLibraryDigest, initialMirror.customTagLibraryDigest);
assert.equal(normalizeCustomTag(mirrorAfterGenericSave.customTags.find(item => item.id === 'comma-tag'))?.imageAsset, mirroredComma.imageAsset);
assert.doesNotMatch(customLibrary.load().warning ?? '', /differed|conservatively merged/i, 'generic saves must not create mirror drift');
assert.deepEqual(customLibrary.load().tags, migratedCustomLibrary.tags, 'migration must be idempotent');
let customMutation = customLibrary.transact('preset:create', { id: 'new-preset', name: 'New Preset', createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z' });
assert.deepEqual(customMutation.presets.map(item => item.id), ['default', 'portrait', 'new-preset']);
customMutation = customLibrary.transact('card:upsert', { ...customMutation.tags.find(item => item.id === 'comma-tag'), presetId: 'new-preset', updatedAt: '2026-08-29T00:01:00Z' });
assert.equal(customMutation.tags.find(item => item.id === 'comma-tag')?.presetId, 'new-preset');
assert.ok(existsSync(customLibrary.resolvePreview('new-preset', customMutation.tags.find(item => item.id === 'comma-tag').imageAsset.split('/').slice(1).join('/'))));
customMutation = customLibrary.transact('preset:delete', { id: 'new-preset' });
assert.equal(customMutation.tags.find(item => item.id === 'comma-tag')?.presetId, 'default');
assert.equal(readFileSync(customLibraryWorkspace, 'utf8').includes('customTagLibraryDigest'), true);
const deleteFixtureTemp = localTemp('custom-library-delete-modes'); const deleteAssets = join(deleteFixtureTemp, 'custom-tags'); const deleteWorkspace = join(deleteFixtureTemp, 'workspace.json'); mkdirSync(deleteAssets);
const deleteTimestamp = '2026-01-01T00:00:00.000Z'; writeFileSync(deleteWorkspace, JSON.stringify({ version: 3, customTagPresets: [{ id: 'default', name: 'My Tags', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }, { id: 'delete-folder', name: 'Delete folder', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }, { id: 'shared-folder', name: 'Shared folder', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }], customTags: [{ id: 'shared-preview', kind: 'tag', tag: 'shared preview', zone: 'frame', presetId: 'delete-folder', imageAsset: 'shared.png', mime: 'image/png', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }, { id: 'unique-preview', kind: 'tag', tag: 'unique preview', zone: 'scene', presetId: 'delete-folder', imageAsset: 'unique.jpg', mime: 'image/jpeg', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }, { id: 'retained-shared-preview', kind: 'tag', tag: 'retained shared preview', zone: 'render', presetId: 'shared-folder', imageAsset: 'shared.png', mime: 'image/png', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }] })); writeFileSync(join(deleteAssets, 'shared.png'), exactPng); writeFileSync(join(deleteAssets, 'unique.jpg'), exactJpeg);
const deleteLibrary = createCustomTagLibrary({ customTagsDir: deleteAssets, workspaceFile: deleteWorkspace, now: () => '2026-08-29T05:00:00.000Z' }); const deleteInitial = deleteLibrary.load(); const sharedPreviewName = basename(deleteInitial.tags.find(item => item.id === 'shared-preview').imageAsset).split('/').at(-1); const uniquePreviewName = basename(deleteInitial.tags.find(item => item.id === 'unique-preview').imageAsset).split('/').at(-1); const deleteResult = deleteLibrary.transact('preset:delete', { id: 'delete-folder', mode: 'delete' });
assert.deepEqual(deleteResult.presets.map(item => item.id), ['default', 'shared-folder']); assert.equal(deleteResult.tags.some(item => item.id === 'shared-preview' || item.id === 'unique-preview'), false); assert.equal(existsSync(join(deleteAssets, 'library-v1', 'presets', 'delete-folder')), false, 'delete mode removes the committed preset directory'); assert.equal(existsSync(join(deleteAssets, 'library-v1', 'presets', 'shared-folder', 'manifest.json')), true); assert.equal(existsSync(join(deleteAssets, sharedPreviewName)), true, 'shared flat preview remains referenced by the retained manifest'); assert.deepEqual(readFileSync(join(deleteAssets, sharedPreviewName)), exactPng); assert.equal(existsSync(join(deleteAssets, uniquePreviewName)), false, 'unreferenced flat preview is removed only after commit'); const retainedManifest = JSON.parse(readFileSync(join(deleteAssets, 'library-v1', 'presets', 'shared-folder', 'manifest.json'), 'utf8')); assert.deepEqual(retainedManifest.cardOrder, ['retained-shared-preview']); assert.equal(retainedManifest.cards[0].preview.sha256, createHash('sha256').update(exactPng).digest('hex'));
const replayDeleteTemp = localTemp('custom-library-delete-replay'); const replayDeleteAssets = join(replayDeleteTemp, 'custom-tags'); const replayDeleteWorkspace = join(replayDeleteTemp, 'workspace.json'); mkdirSync(replayDeleteAssets); writeFileSync(join(replayDeleteAssets, 'replay.png'), exactPng); writeFileSync(replayDeleteWorkspace, JSON.stringify({ version: 3, customTagPresets: [{ id: 'default', name: 'My Tags', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }, { id: 'replay-folder', name: 'Replay folder', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }], customTags: [{ id: 'replay-card', kind: 'tag', tag: 'replay card', zone: 'frame', presetId: 'replay-folder', imageAsset: 'replay.png', mime: 'image/png', createdAt: deleteTimestamp, updatedAt: deleteTimestamp }] })); let replayDeleteFail = true; const replayDeleteLibrary = createCustomTagLibrary({ customTagsDir: replayDeleteAssets, workspaceFile: replayDeleteWorkspace, failpoint: phase => { if (phase === 'transaction:journal' && replayDeleteFail) throw new Error('injected delete journal'); } }); const replayDeleteInitial = replayDeleteLibrary.load(); const replayPreviewName = basename(replayDeleteInitial.tags.find(item => item.id === 'replay-card').imageAsset); assert.throws(() => replayDeleteLibrary.transact('preset:delete', { id: 'replay-folder', mode: 'delete' }), /injected delete journal/); replayDeleteFail = false; const replayDeleteResult = replayDeleteLibrary.load(); assert.equal(replayDeleteResult.presets.some(item => item.id === 'replay-folder'), false); assert.equal(existsSync(join(replayDeleteAssets, 'library-v1', 'presets', 'replay-folder')), false); assert.equal(existsSync(join(replayDeleteAssets, replayPreviewName)), false, 'journal replay also cleans unreferenced delete assets');
assert.equal(classifyCustomTagDrop({ phase: 'drag', targetInsideImageDrop: false, types: ['Files'], itemCount: 1 }), 'candidate', 'Windows external drags may hide File names until drop'); assert.equal(classifyCustomTagDrop({ phase: 'drop', targetInsideImageDrop: false, types: ['Files'], files: [{ name: 'shared.naipack', type: '' }] }), 'pack'); assert.equal(classifyCustomTagDrop({ phase: 'drop', targetInsideImageDrop: false, types: ['Files'], files: [{ name: 'one.png', type: 'image/png' }, { name: 'two.naipack', type: '' }] }), 'invalid'); assert.equal(classifyCustomTagDrop({ phase: 'drag', targetInsideImageDrop: true, types: ['Files'], itemCount: 1 }), 'ignore', 'undisclosed image drops remain with the image handler');
const replacementPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);
const olderWriterMirror = JSON.parse(readFileSync(customLibraryWorkspace, 'utf8')); const olderWriterCard = olderWriterMirror.customTags.find(item => item.id === 'comma-tag');
writeFileSync(join(customLibraryAssets, olderWriterCard.imageAsset), replacementPng); olderWriterCard.updatedAt = '2026-08-29T01:30:00.000Z'; writeFileSync(customLibraryWorkspace, JSON.stringify(olderWriterMirror));
const replacementMerge = customLibrary.load(); const replacementCard = replacementMerge.tags.find(item => item.id === 'comma-tag');
assert.deepEqual(readFileSync(join(customLibraryAssets, 'library-v1', 'presets', replacementCard.imageAsset)), replacementPng, 'newer resolvable mirror image must replace stale canonical preview');

const strictTemp = localTemp('custom-library-strict'); const strictAssets = join(strictTemp, 'custom-tags'); const strictWorkspace = join(strictTemp, 'workspace.json'); mkdirSync(strictAssets); writeFileSync(strictWorkspace, JSON.stringify({ version: 3, customTags: [], customTagPresets: [] }));
const strictLibrary = createCustomTagLibrary({ customTagsDir: strictAssets, workspaceFile: strictWorkspace }); strictLibrary.load();
const strictManifestPath = join(strictAssets, 'library-v1', 'presets', 'default', 'manifest.json'); const strictManifest = JSON.parse(readFileSync(strictManifestPath, 'utf8'));
strictManifest.cards = [{ id: 'duplicate', kind: 'artist', tag: 'artist: One', presetId: 'default', description: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }, { id: 'duplicate', kind: 'artist', tag: 'artist: Two', presetId: 'default', description: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]; strictManifest.cardOrder = ['duplicate', 'duplicate']; writeFileSync(strictManifestPath, JSON.stringify(strictManifest));
assert.match(strictLibrary.load().warning, /canonical custom tags library could not be loaded/i, 'duplicate canonical cards must invalidate the manifest');

function corruptCanonicalFixture(label, mutate) {
  const fixtureTemp = localTemp(`custom-library-corrupt-${label}`); const assets = join(fixtureTemp, 'custom-tags'); const workspace = join(fixtureTemp, 'workspace.json'); mkdirSync(assets);
  const timestamp = '2026-01-01T00:00:00.000Z'; writeFileSync(workspace, JSON.stringify({ version: 3, customTagPresets: [{ id: 'default', name: 'My Tags', createdAt: timestamp, updatedAt: timestamp }], customTags: [{ id: 'strict-artist', kind: 'artist', tag: 'artist: Strict', zone: 'frame', presetId: 'default', description: '', createdAt: timestamp, updatedAt: timestamp }] }));
  const library = createCustomTagLibrary({ customTagsDir: assets, workspaceFile: workspace }); library.load(); const manifestPath = join(assets, 'library-v1', 'presets', 'default', 'manifest.json'); const indexPath = join(assets, 'library-v1', 'index.json'); const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); const index = JSON.parse(readFileSync(indexPath, 'utf8')); mutate({ manifest, index }); writeFileSync(manifestPath, JSON.stringify(manifest)); writeFileSync(indexPath, JSON.stringify(index)); return library.load();
}
for (const [label, mutate] of [
  ['kind', ({ manifest }) => { manifest.cards[0].kind = 7; }],
  ['tag', ({ manifest }) => { manifest.cards[0].tag = ' trailing '; }],
  ['description', ({ manifest }) => { manifest.cards[0].description = null; }],
  ['timestamp', ({ manifest }) => { manifest.cards[0].updatedAt = 'yesterday'; }],
  ['zone', ({ manifest }) => { manifest.cards[0].zone = 'frame'; }],
  ['preset-id', ({ manifest }) => { manifest.cards[0].presetId = 'other'; }],
  ['order', ({ manifest }) => { manifest.cardOrder = [42]; }],
  ['preset-whitespace-id', ({ manifest }) => { manifest.preset.id = ' default '; }],
  ['card-whitespace-id', ({ manifest }) => { manifest.cards[0].id = ' strict-artist '; manifest.cardOrder = [' strict-artist ']; }],
  ['order-whitespace-id', ({ manifest }) => { manifest.cardOrder = [' strict-artist ']; }],
  ['card-preset-whitespace-id', ({ manifest }) => { manifest.cards[0].presetId = ' default '; }],
  ['index-order-whitespace-id', ({ index }) => { index.presetOrder = [' default ']; }],
  ['index-digest', ({ index }) => { index.mirrorDigest = 4; }],
  ['index-digest-mismatch', ({ index }) => { index.mirrorDigest = 'f'.repeat(64); }],
  ['index-time', ({ index }) => { index.updatedAt = 'soon'; }]
]) assert.match(corruptCanonicalFixture(label, mutate).warning, /canonical custom tags library could not be loaded/i, `${label} corruption must fail strict canonical validation`);

const crossTemp = localTemp('custom-library-cross-duplicate'); const crossAssets = join(crossTemp, 'custom-tags'); const crossWorkspace = join(crossTemp, 'workspace.json'); mkdirSync(crossAssets); const crossTime = '2026-01-01T00:00:00.000Z';
writeFileSync(crossWorkspace, JSON.stringify({ version: 3, customTagPresets: [{ id: 'default', name: 'My Tags', createdAt: crossTime, updatedAt: crossTime }, { id: 'second', name: 'Second', createdAt: crossTime, updatedAt: crossTime }], customTags: [{ id: 'first-card', kind: 'artist', tag: 'artist: First', zone: 'frame', presetId: 'default', description: '', createdAt: crossTime, updatedAt: crossTime }, { id: 'second-card', kind: 'artist', tag: 'artist: Second', zone: 'frame', presetId: 'second', description: '', createdAt: crossTime, updatedAt: crossTime }] }));
const crossLibrary = createCustomTagLibrary({ customTagsDir: crossAssets, workspaceFile: crossWorkspace }); crossLibrary.load(); const crossManifestPath = join(crossAssets, 'library-v1', 'presets', 'second', 'manifest.json'); const crossManifest = JSON.parse(readFileSync(crossManifestPath, 'utf8')); crossManifest.cards[0].id = 'first-card'; crossManifest.cardOrder = ['first-card']; writeFileSync(crossManifestPath, JSON.stringify(crossManifest));
assert.match(crossLibrary.load().warning, /canonical custom tags library could not be loaded/i, 'duplicate ids across manifests must invalidate the full tree');

const journalTemp = localTemp('custom-library-journal-duplicate'); const journalAssets = join(journalTemp, 'custom-tags'); const journalWorkspace = join(journalTemp, 'workspace.json'); mkdirSync(journalAssets); writeFileSync(journalWorkspace, JSON.stringify({ version: 3, customTags: [], customTagPresets: [] }));
const journalLibrary = createCustomTagLibrary({ customTagsDir: journalAssets, workspaceFile: journalWorkspace }); journalLibrary.load(); const journalCanonical = journalLibrary.readCanonical(); const duplicateJournalCard = { id: 'journal-duplicate', kind: 'artist', tag: 'artist: Journal', presetId: 'default', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }; const duplicateJournalPreset = { id: 'journal-second', name: 'Journal Second', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const duplicateJournalManifests = [{ preset: journalCanonical.manifests[0].preset, cards: [duplicateJournalCard] }, { preset: duplicateJournalPreset, cards: [{ ...duplicateJournalCard, presetId: 'journal-second' }] }];
assert.throws(() => journalLibrary.commitJournal({ format: 'nai-custom-tag-library', schemaVersion: 1, operationId: '00000000-0000-4000-8000-000000000000', manifests: duplicateJournalManifests, index: { format: 'nai-custom-tag-library', schemaVersion: 1, presetOrder: ['default', 'journal-second'], mirrorDigest: 'f'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' } }), /Duplicate custom card id across preset manifests/, 'journals must reject duplicate ids before committing');
assert.throws(() => journalLibrary.commitJournal({ format: 'nai-custom-tag-library', schemaVersion: 1, operationId: '00000000-0000-4000-8000-000000000000', manifests: [{ preset: journalCanonical.manifests[0].preset, cards: [{ ...duplicateJournalCard, id: ' journal-whitespace ' }] }], index: { format: 'nai-custom-tag-library', schemaVersion: 1, presetOrder: ['default'], mirrorDigest: 'f'.repeat(64), updatedAt: '2026-01-01T00:00:00.000Z' } }), /Invalid canonical custom card/, 'journals must reject whitespace-padded card ids without normalizing them');

const failureTemp = localTemp('custom-library-failure'); const failureAssets = join(failureTemp, 'custom-tags'); const failureWorkspace = join(failureTemp, 'workspace.json'); mkdirSync(failureAssets); writeFileSync(failureWorkspace, JSON.stringify({ version: 3, customTags: [], customTagPresets: [] }));
let injectedPhase = ''; let injected = false;
const failureLibrary = createCustomTagLibrary({ customTagsDir: failureAssets, workspaceFile: failureWorkspace, now: () => '2026-08-29T02:00:00.000Z', failpoint: phase => { if (phase === injectedPhase && !injected) { injected = true; throw new Error(`injected ${phase}`); } } });
assert.equal(failureLibrary.load().warning, undefined, 'a fresh empty profile must not report a legacy normalization warning'); injectedPhase = 'transaction:journal';
assert.throws(() => failureLibrary.transact('preset:create', { id: 'replayed', name: 'Replayed' }), /injected/);
assert.equal(failureLibrary.load().presets.some(item => item.id === 'replayed'), true, 'journal replay must be idempotent');
const driftWorkspace = JSON.parse(readFileSync(failureWorkspace, 'utf8')); driftWorkspace.customTags.push({ id: 'older-writer-artist', kind: 'artist', tag: 'artist: Recovered', zone: 'frame', presetId: 'default', createdAt: '2026-08-29T03:00:00Z', updatedAt: '2026-08-29T03:00:00Z' }); writeFileSync(failureWorkspace, JSON.stringify(driftWorkspace));
const driftResult = failureLibrary.load(); assert.equal(driftResult.tags.some(item => item.id === 'older-writer-artist'), true); assert.match(driftResult.warning, /conservatively merged/i);
injected = false; injectedPhase = 'transaction:asset:staged';
assert.throws(() => failureLibrary.transact('card:upsert', { id: 'atomic-preview', kind: 'tag', tag: 'atomic', zone: 'frame', presetId: 'default', mime: 'image/png' }, exactPng), /injected/);
const atomicHash = createHash('sha256').update(exactPng).digest('hex');
assert.equal(existsSync(join(failureAssets, 'library-v1', 'presets', 'default', 'previews', `${atomicHash}.png`)), false, 'staging failure must not expose a final hash path');
injectedPhase = ''; const atomicRetry = failureLibrary.transact('card:upsert', { id: 'atomic-preview', kind: 'tag', tag: 'atomic', zone: 'frame', presetId: 'default', mime: 'image/png' }, exactPng);
assert.equal(atomicRetry.tags.some(item => item.id === 'atomic-preview'), true);
injected = false; injectedPhase = 'transaction:asset';
assert.throws(() => failureLibrary.transact('card:upsert', { id: 'atomic-post-rename', kind: 'tag', tag: 'atomic post rename', zone: 'frame', presetId: 'default', mime: 'image/jpeg' }, exactJpeg), /injected/);
const postRenameHash = createHash('sha256').update(exactJpeg).digest('hex');
assert.equal(existsSync(join(failureAssets, 'library-v1', 'presets', 'default', 'previews', `${postRenameHash}.jpg`)), false, 'post-rename asset failure must remove only its newly-created target');
injected = false;
assert.throws(() => failureLibrary.transact('card:upsert', { id: 'atomic-existing-target', kind: 'tag', tag: 'atomic existing target', zone: 'frame', presetId: 'default', mime: 'image/png' }, exactPng), /injected/);
assert.equal(existsSync(join(failureAssets, 'library-v1', 'presets', 'default', 'previews', `${atomicHash}.png`)), true, 'post-rename asset failure must preserve a pre-existing shared target');
injectedPhase = '';
const malformedCanonicalBytes = Buffer.from('{workspace-is-still-corrupt'); writeFileSync(failureWorkspace, malformedCanonicalBytes);
const malformedCanonicalResult = failureLibrary.load(); assert.match(malformedCanonicalResult.warning, /preserved unchanged/i); assert.deepEqual(readFileSync(failureWorkspace), malformedCanonicalBytes);
assert.throws(() => failureLibrary.transact('preset:create', { id: 'blocked', name: 'Blocked' }), /malformed/i);
const malformedTemp = localTemp('custom-library-malformed'); const malformedAssets = join(malformedTemp, 'custom-tags'); mkdirSync(malformedAssets); const malformedWorkspace = join(malformedTemp, 'workspace.json'); writeFileSync(malformedWorkspace, '{truncated');
const malformedResult = createCustomTagLibrary({ customTagsDir: malformedAssets, workspaceFile: malformedWorkspace }).load();
assert.match(malformedResult.warning, /malformed/); assert.equal(existsSync(join(malformedAssets, 'library-v1')), false, 'malformed legacy data must not become empty authority');
for (const [field, value] of [['customTags', {}], ['customTagPresets', {}]]) {
  const nonArrayTemp = localTemp(`custom-library-non-array-${field}`); const nonArrayAssets = join(nonArrayTemp, 'custom-tags'); mkdirSync(nonArrayAssets); const nonArrayWorkspace = join(nonArrayTemp, 'workspace.json'); const exact = Buffer.from(JSON.stringify({ version: 3, [field]: value })); writeFileSync(nonArrayWorkspace, exact);
  const result = createCustomTagLibrary({ customTagsDir: nonArrayAssets, workspaceFile: nonArrayWorkspace }).load(); assert.match(result.warning, /malformed/); assert.deepEqual(readFileSync(nonArrayWorkspace), exact); assert.equal(existsSync(join(nonArrayAssets, 'library-v1')), false);
  assert.throws(() => writeWorkspaceSection(nonArrayWorkspace, 'settings', {}), /malformed/); assert.deepEqual(readFileSync(nonArrayWorkspace), exact);
}
const damagedTemp = localTemp('custom-library-damaged'); const damagedAssets = join(damagedTemp, 'custom-tags'); mkdirSync(damagedAssets); const damagedWorkspace = join(damagedTemp, 'workspace.json');
const damagedLegacyBytes = Buffer.from(JSON.stringify({ version: 3, customTagPresets: [], customTags: [{ id: 'damaged-required-preview', kind: 'tag', tag: 'damaged', zone: 'frame', imageAsset: 'missing.png', mime: 'image/png' }, { id: 'retained-text-artist', kind: 'artist', tag: 'artist: Retained', zone: 'frame' }] })); writeFileSync(damagedWorkspace, damagedLegacyBytes);
const damagedLibrary = createCustomTagLibrary({ customTagsDir: damagedAssets, workspaceFile: damagedWorkspace }); const damagedResult = damagedLibrary.load();
assert.match(damagedResult.warning, /1 damaged legacy Custom Tags record/); assert.equal(damagedResult.tags.some(item => item.id === 'retained-text-artist'), true); assert.deepEqual(readFileSync(damagedWorkspace), damagedLegacyBytes, 'damaged legacy migration must preserve the exact compatibility mirror');
for (let load = 0; load < 3; load += 1) { const repeated = damagedLibrary.load(); assert.match(repeated.warning, /1 damaged legacy Custom Tags record/); assert.deepEqual(readFileSync(damagedWorkspace), damagedLegacyBytes, 'damaged legacy mirror bytes must remain unchanged across repeated canonical loads'); }

const fallbackTemp = localTemp('custom-library-read-only-fallback'); const fallbackAssets = join(fallbackTemp, 'custom-tags'); const fallbackWorkspace = join(fallbackTemp, 'workspace.json'); mkdirSync(fallbackAssets); writeFileSync(fallbackWorkspace, JSON.stringify({ version: 3, customTagPresets: [], customTags: [{ id: 'missing-preview-tag', kind: 'tag', tag: 'missing preview', zone: 'frame', presetId: 'default', imageAsset: 'missing.png', mime: 'image/png' }, { id: 'artist-with-missing-preview', kind: 'artist', tag: 'artist: Retained', zone: 'frame', presetId: 'default', imageAsset: 'missing.webp', mime: 'image/webp' }, { id: 'text-only-artist', kind: 'artist', tag: 'artist: Text only', zone: 'frame', presetId: 'default' }] }));
const fallbackLibrary = createCustomTagLibrary({ customTagsDir: fallbackAssets, workspaceFile: fallbackWorkspace }); fallbackLibrary.load(); const fallbackIndexPath = join(fallbackAssets, 'library-v1', 'index.json'); const fallbackIndex = JSON.parse(readFileSync(fallbackIndexPath, 'utf8')); fallbackIndex.format = 'corrupt'; writeFileSync(fallbackIndexPath, JSON.stringify(fallbackIndex)); const fallbackResult = fallbackLibrary.load();
assert.match(fallbackResult.warning, /read-only.*unavailable required previews/i); assert.equal(fallbackResult.tags.some(item => item.id === 'missing-preview-tag'), false, 'read-only fallback must omit prompt cards with unavailable required previews'); assert.equal(fallbackResult.tags.some(item => item.id === 'artist-with-missing-preview'), true, 'read-only fallback must retain artists when their optional preview is unavailable'); assert.equal(fallbackResult.tags.some(item => item.id === 'artist-with-missing-preview' && item.imageAsset), false, 'read-only fallback must not expose dangling artist assets'); assert.equal(fallbackResult.tags.some(item => item.id === 'text-only-artist'), true, 'read-only fallback must retain text-only artists');

// .naipack packs are deterministic, preserve canonical card order and bytes,
// and reject an archive that contains anything outside the explicit allowlist.
const customPackTemp = localTemp('custom-tag-pack'); const packOne = join(customPackTemp, 'one.naipack'); const packTwo = join(customPackTemp, 'two.naipack');
customLibrary.transact('card:upsert', { ...customLibrary.load().tags.find(item => item.id === 'comma-tag'), presetId: 'portrait' }); const expectedPackOrder = customLibrary.readCanonical().manifests.find(item => item.preset.id === 'portrait').cards.map(item => item.id);
await customLibrary.exportPack('portrait', packOne, join(customPackTemp, 'build-one')); await customLibrary.exportPack('portrait', packTwo, join(customPackTemp, 'build-two'));
assert.deepEqual(readFileSync(packOne), readFileSync(packTwo), 'repeated exports must be byte deterministic');
const validatedPack = validatePackArchive(packOne, { stagingDir: join(customPackTemp, 'validated') }); assert.equal(validatedPack.pack.cardCount, 3); assert.deepEqual(validatedPack.manifest.cardOrder, expectedPackOrder); assert.equal(validatedPack.manifest.cards.find(item => item.id === 'comma-tag').tag, 'one, two'); assert.deepEqual(readFileSync(join(validatedPack.stage, 'previews', `${validatedPack.manifest.cards.find(item => item.id === 'comma-tag').preview.sha256}.png`)), replacementPng); const validatedPackJson = readFileSync(join(validatedPack.stage, 'pack.json')); const validatedManifestJson = readFileSync(join(validatedPack.stage, 'manifest.json')); rmSync(validatedPack.stage, { recursive: true, force: true });
const limitPackBytes = new Map();
const limitPackCards = [180, 181, CUSTOM_TAG_MAX_LENGTH].map((length, index) => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, index]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  limitPackBytes.set(sha256, bytes);
  return { id: `limit-${length}`, kind: 'tag', tag: 'x'.repeat(length), zone: 'frame', presetId: 'limits', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', preview: { file: `previews/${sha256}.png`, mime: 'image/png', bytes: bytes.length, sha256, originalName: `${length}.png` } };
});
const limitPackManifest = { format: 'nai-custom-tag-library', schemaVersion: 1, preset: { id: 'limits', name: 'Limits', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, cardOrder: limitPackCards.map(card => card.id), cards: limitPackCards };
const limitPack = join(customPackTemp, 'limits.naipack');
await createPackArchive({ manifest: limitPackManifest, destination: limitPack, previewResolver: preview => limitPackBytes.get(preview.sha256) });
const validatedLimitPack = validatePackArchive(limitPack, { stagingDir: join(customPackTemp, 'limits-validated') });
assert.deepEqual(validatedLimitPack.manifest.cards.map(card => card.tag.length), [180, 181, CUSTOM_TAG_MAX_LENGTH], '.naipack round-trip must retain 180, 181, and 4096 character tags');
const overLimitPack = join(customPackTemp, 'limits-over.naipack');
const overLimitStage = join(customPackTemp, 'limits-over-stage'); mkdirSync(join(overLimitStage, 'previews'), { recursive: true });
for (const card of limitPackCards) copyFileSync(join(validatedLimitPack.stage, card.preview.file), join(overLimitStage, card.preview.file));
const overLimitManifest = { ...limitPackManifest, cardOrder: [...limitPackManifest.cardOrder, 'limit-over'], cards: [...limitPackCards, { ...limitPackCards[0], id: 'limit-over', tag: 'x'.repeat(CUSTOM_TAG_MAX_LENGTH + 1) }] };
const overLimitManifestBytes = Buffer.from(canonicalJson(overLimitManifest), 'utf8');
const overLimitPackJson = { ...JSON.parse(readFileSync(join(validatedLimitPack.stage, 'pack.json'), 'utf8')), manifestSha256: createHash('sha256').update(overLimitManifestBytes).digest('hex'), cardCount: overLimitManifest.cards.length };
writeFileSync(join(overLimitStage, 'pack.json'), canonicalJson(overLimitPackJson));
writeFileSync(join(overLimitStage, 'manifest.json'), overLimitManifestBytes);
await createPackageFromFiles(overLimitStage, overLimitPack, [join(overLimitStage, 'pack.json'), join(overLimitStage, 'manifest.json'), ...limitPackCards.map(card => join(overLimitStage, card.preview.file))]);
assert.throws(() => validatePackArchive(overLimitPack), /invalid card fields/i, '.naipack must reject 4097 character tags');
const importedPackTemp = localTemp('custom-tag-pack-import'); const importedAssets = join(importedPackTemp, 'custom-tags'); const importedWorkspace = join(importedPackTemp, 'workspace.json'); mkdirSync(importedAssets); writeFileSync(importedWorkspace, JSON.stringify({ version: 3, customTagPresets: [{ id: 'existing', name: 'Portrait', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], customTags: [] }));
const importedLibrary = createCustomTagLibrary({ customTagsDir: importedAssets, workspaceFile: importedWorkspace, now: () => '2026-08-29T04:00:00.000Z' }); importedLibrary.load(); const importedResult = importedLibrary.importPack(packOne, { stagingDir: join(importedPackTemp, 'temp') }); assert.equal(importedResult.status, 'imported'); assert.equal(importedResult.name, 'Portrait (Imported)'); assert.equal(importedResult.imported, 3); assert.equal(importedLibrary.load().tags.filter(item => item.presetId === importedResult.presetId).length, 3);
const duplicateImport = importedLibrary.importPack(packOne, { stagingDir: join(importedPackTemp, 'temp') }); assert.equal(duplicateImport.status, 'no-new-cards'); assert.equal(importedLibrary.load().presets.filter(item => item.name.includes('(Imported')).length, 1);
const hostileExtra = join(customPackTemp, 'hostile-files'); mkdirSync(hostileExtra); writeFileSync(join(hostileExtra, 'pack.json'), validatedPackJson); writeFileSync(join(hostileExtra, 'manifest.json'), validatedManifestJson); writeFileSync(join(hostileExtra, 'extra'), 'reject'); const hostileArchive = join(customPackTemp, 'hostile.naipack'); await createPackageFromFiles(hostileExtra, hostileArchive, [join(hostileExtra, 'pack.json'), join(hostileExtra, 'manifest.json'), join(hostileExtra, 'extra')]); assert.throws(() => validatePackArchive(hostileArchive), /extra ASAR entry/);
assert.equal(MAX_ENTRIES, MAX_CARDS + 3, 'the ASAR entry budget must include pack, manifest, and previews directory overhead');
const boundaryBytes = new Map();
const boundaryCards = Array.from({ length: MAX_CARDS }, (_, index) => {
  const bytes = Buffer.from([82, 73, 70, 70, index & 0xff, (index >>> 8) & 0xff, 0, 0, 87, 69, 66, 80, index & 0xff, (index >>> 8) & 0xff]);
  const hash = createHash('sha256').update(bytes).digest('hex'); const file = `previews/${hash}.webp`; boundaryBytes.set(hash, bytes);
  return { id: `boundary-card-${index}`, kind: 'tag', tag: `boundary-${index}`, zone: 'frame', presetId: 'boundary', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', preview: { file, mime: 'image/webp', bytes: bytes.length, sha256: hash, originalName: `${index}.webp` } };
});
const boundaryManifest = { format: 'nai-custom-tag-library', schemaVersion: 1, preset: { id: 'boundary', name: 'Boundary', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, cardOrder: boundaryCards.map(card => card.id), cards: boundaryCards };
const boundaryArchive = join(customPackTemp, 'boundary.naipack'); await createPackArchive({ manifest: boundaryManifest, destination: boundaryArchive, previewResolver: preview => boundaryBytes.get(preview.sha256) });
assert.equal(validatePackArchive(boundaryArchive).pack.cardCount, MAX_CARDS, 'a full 5,000-card pack with one preview per card must validate');

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
assert.deepEqual(normalizeSettings(undefined), { animationMode: 'auto', preloadCharacterPreviews: false, theme: 'arcane-gold', updateCatalogOnStartup: true, checkAppUpdatesOnStartup: true, seenGuideIds: [], lastSeenVersion: '', previewCachePreset: 'large' });
assert.deepEqual(normalizeSettings({ preloadCharacterPreviews: true, theme: 'midnight-blue', updateCatalogOnStartup: false, checkAppUpdatesOnStartup: false, seenGuideIds: ['overview'], lastSeenVersion: '0.4.0' }, 'off'), { animationMode: 'off', preloadCharacterPreviews: true, theme: 'midnight-blue', updateCatalogOnStartup: false, checkAppUpdatesOnStartup: false, seenGuideIds: ['overview'], lastSeenVersion: '0.4.0' , previewCachePreset: 'large' });
assert.equal(normalizePreviewCachePreset('balanced'), 'balanced');
assert.equal(normalizePreviewCachePreset('legacy-value'), 'large');
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
const previewCacheSource = readFileSync(new URL('../src/preview-cache.ts', import.meta.url), 'utf8');
const warmupSource = readFileSync(new URL('../src/catalog-warmup.ts', import.meta.url), 'utf8');
const thumbnailSource = readFileSync(new URL('../src/artist-thumbnail.ts', import.meta.url), 'utf8');
const storageSource = readFileSync(new URL('../src/storage.ts', import.meta.url), 'utf8');
const metadataWorkspaceSource = readFileSync(new URL('../src/metadata-workspace.ts', import.meta.url), 'utf8');
const electronSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const customTagLibrarySource = readFileSync(new URL('../electron/custom-tag-library.cjs', import.meta.url), 'utf8');
const customTagPackSource = readFileSync(new URL('../electron/custom-tag-pack.cjs', import.meta.url), 'utf8');
const componentSource = readFileSync(new URL('../electron/catalog-components.cjs', import.meta.url), 'utf8');
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
assert.match(metadataWorkspaceSource, /import \{ createMetadataDisplayPreview \} from '\.\/metadata-display-preview';/);
assert.match(metadataWorkspaceSource, /const displayBlob = await createMetadataDisplayPreview\(new Blob\(\[bytes\], \{ type: mime \}\)\);\s+if \(request !== this\.readToken\) return;\s+this\.result = result;\s+this\.sourceObjectUrl = URL\.createObjectURL\(displayBlob\);/);
assert.match(metadataWorkspaceSource, /catch \(error\) \{\s+if \(request !== this\.readToken\) return;/);
assert.match(metadataWorkspaceSource, /bindArtistCardPreview\(root\)/);
assert.match(metadataWorkspaceSource, /private renderHighlighted\(value: string\): string/);
assert.match(metadataWorkspaceSource, /const highlighter = this\.artistHighlighter\(\);/);
assert.match(metadataWorkspaceSource, /const escapeHtml = escapeMetadataHtml;/);
assert.match(metadataWorkspaceSource, />IMAGE METADATA</);
assert.match(metadataWorkspaceSource, />Reveal the image's data\.</);
assert.match(metadataWorkspaceSource, />Drop an image here</);
assert.match(metadataWorkspaceSource, /Choose or drop a NovelAI Image\. Analysis stays entirely on this device and never changes your prompt builder\./);
assert.match(metadataWorkspaceSource, /aria-label="Choose a NovelAI image or drop one here"/);
assert.match(metadataWorkspaceSource, /accept="image\/png,\.png,image\/webp,\.webp"/);
assert.match(metadataWorkspaceSource, /Metadata extraction is based on <a href="https:\/\/github\.com\/NovelAI\/novelai-image-metadata" target="_blank" rel="noopener noreferrer">NovelAI's official image metadata repository<\/a>\./);
assert.doesNotMatch(metadataWorkspaceSource, /URL\.createObjectURL\(file\)/, 'metadata display must use the bounded preview blob instead of the original file');
assert.match(metadataWorkspaceSource, /URL\.revokeObjectURL\(this\.sourceObjectUrl\)/);
assert.match(metadataWorkspaceSource, /dispose\(\): void \{\s+this\.deactivate\(\);\s+this\.releaseSourceImage\(\);\s+\}/);
assert.match(metadataWorkspaceSource, /class="metadata-source-image"[\s\S]*?<div class="metadata-model"/);
assert.match(metadataWorkspaceSource, /data-metadata-copy="\$\{index\}"/);
assert.match(metadataWorkspaceSource, /<pre>[\s\S]*?<div class="metadata-prompt-actions">[\s\S]*?>Copy prompt<\/button>/);
assert.match(metadataWorkspaceSource, /private activePrompt\(index: number\): string/);
assert.match(metadataWorkspaceSource, /activeValue \? '' : 'disabled'/);
assert.doesNotMatch(metadataWorkspaceSource, /sourceKind === 'remote' \? \[\]/, 'remote metadata saves must retain catalog-aware artist extraction');
assert.match(uiSource, /metadataWorkspace\.dispose\(\);/);
assert.match(storageSource, /export function loadCustomTags\(\): CustomTag\[\] \{[\s\S]*?if \(!bridge\(\)\) return \[\];/);
assert.match(storageSource, /export async function transactCustomTags/);
assert.doesNotMatch(storageSource.match(/export function saveCustomTags[\s\S]*?\n\}/)?.[0] ?? '', /localStorage\.setItem/);
assert.match(storageSource, /memory-\[a-zA-Z0-9_-\]/);
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
assert.match(electronSource, /custom-tags:transact/);
assert.match(electronSource, /custom-tags:import/); assert.match(electronSource, /custom-tags:export/);
assert.match(customTagLibrarySource, /Refusing to overwrite malformed workspace\.json/);
assert.match(customTagPackSource, /nai-custom-tags-pack/); assert.match(customTagPackSource, /extractFile/); assert.doesNotMatch(customTagPackSource, /extractAll/);
assert.match(preloadSource, /webUtils\.getPathForFile/); assert.match(uiSource, /Import \.naipack/); assert.match(uiSource, /data-export-preset/); assert.match(uiSource, /custom-tag-pack-drop-toast/); assert.match(uiSource, /Import a shared Custom Tags preset\./); assert.match(styleSource, /\.custom-tag-pack-drop-toast\[hidden\] \{ display: none; \}/); assert.doesNotMatch(styleSource, /\.custom-tags-workspace\.is-pack-dragging/);
assert.match(styleSource, /\.preset-row \{[^}]*outline: 2px solid transparent;[^}]*transition: transform var\(--motion-control\)/, 'preset folders must own the same detached hover outline and motion as All Tags');
assert.match(styleSource, /\.preset-row:has\(\.preset-select:active\) \{ transform: translateY\(1px\) scale\(\.985\); \}/, 'preset folder click feedback must animate the whole folder shell');
assert.match(styleSource, /\.preset-row:hover:not\(:focus-within\):not\(:has\(\.preset-select:active\)\)[^}]*outline-color:[^}]*box-shadow:[^}]*translateY\(-1px\)/, 'preset folder hover must mirror the All Tags detached outline and lift');
assert.match(styleSource, /\.preset-row-top \.preset-select \{ grid-column: 1 \/ -1; grid-row: 1;[^}]*padding-right: 76px;[^}]*cursor: pointer;/, 'the preset select button must cover the complete folder row');
assert.match(styleSource, /\.preset-actions \{[^}]*grid-column: 2;[^}]*pointer-events: none;/); assert.match(styleSource, /\.preset-actions button \{ pointer-events: auto; \}/); assert.match(styleSource, /\.preset-check \{[^}]*grid-column: 3;[^}]*pointer-events: none;/, 'only real folder action buttons may intercept the full-row select target');
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
assert.match(uiSource, /function pumpConstructorImageWarmup\(\): void \{[\s\S]*?PreviewCache owns the shared foreground\/background worker limits/);
assert.match(uiSource, /function openConstructor\([\s\S]*?render\(\);\s+startConstructorImageWarmup\(\);/);
assert.match(uiSource, /function closeConstructor\(\): void \{\s+clearConstructorImageWarmup\(\);/);
assert.match(uiSource, /type ConstructorTarget =/);
assert.match(uiSource, /kind: 'base'; zone: ConstructorZone/);
assert.match(uiSource, /kind: 'character'; characterId: string/);
assert.match(uiSource, /data-open-character-constructor/);
assert.match(uiSource, /function characterConstructorCards\(characterId: string\)[\s\S]*?zone === 'character'/);
assert.match(uiSource, /function constructorTargetPrompt\(target: ConstructorTarget\)[\s\S]*?characterId[\s\S]*?character\.prompt/);
assert.match(uiSource, /function setConstructorTargetPrompt\(target: ConstructorTarget[\s\S]*?character\.prompt = value/);
assert.match(uiSource, /function constructorFolderViews\(target: ConstructorTarget\)[\s\S]*?builtin:hothottuk/);
assert.match(uiSource, /function refreshConstructorGrid\(\): void \{[\s\S]*?warmConstructorImages\(grid\)/);
assert.match(uiSource, /data-constructor-tag.*toggleConstructorCard\(button\.dataset\.constructorTag!, event\)/);
assert.match(uiSource, /function refreshConstructorGrid\(options: \{ restoreFocus\?: boolean \} = \{\}\): void/);
assert.match(uiSource, /clearArtistCardPreview\(\);[\s\S]*?refreshConstructorGrid\(\{ restoreFocus: !pointerActivation \}\)/);
assert.match(styleSource, /\.constructor-folder-reveal \{[\s\S]*?grid-template-rows: 0fr[\s\S]*?transition:/);
assert.match(styleSource, /\.constructor-folder\.is-open \.constructor-folder-reveal \{ grid-template-rows: 1fr/);
assert.match(styleSource, /\.constructor-card-image img\.is-loaded \{ opacity: 1; \}/);
assert.match(uiSource, /function restoreConstructorGridFocus\(target: string \| null\): void \{[\s\S]*?target\.startsWith\('folder:'\)[\s\S]*?target\.slice\('folder:'\.length\)/);
assert.doesNotMatch(uiSource, /target\.split\(':', 2\)/);
assert.match(uiSource, /function revokeCustomImageUrl\(key: string\): void \{[\s\S]*?URL\.revokeObjectURL\(url\)/);
assert.match(uiSource, /function setCustomImageUrl\(key: string, url: string\): void \{[\s\S]*?revokeCustomImageUrl\(key\)/);
assert.match(uiSource, /class="\$\{workspacePanelClass\('prompt'\)\}"/);
assert.match(uiSource, /class="\$\{workspacePanelClass\('metadata'\)\}"/);
assert.match(uiSource, /id="artist-mix-panel" class="\$\{workspacePanelClass\('artist-mix'\)\} artist-mix-workspace/);
assert.match(uiSource, /id="saved-library-panel" class="\$\{workspacePanelClass\('saved-library'\)\} saved-library-workspace/);
assert.match(uiSource, /id="settings-panel" class="\$\{workspacePanelClass\('settings'\)\} settings-workspace/);
assert.match(uiSource, /pendingWorkspaceTransition = null;\s+bindEvents\(\);/);
assert.ok(uiSource.includes('class="app-chrome"'), 'topbar and workspace tabs must share app chrome');
assert.match(styleSource, /\.app-chrome \{[^}]*position: sticky;[^}]*top: 0;[^}]*background: var\(--bg-deep\)/);
assert.match(styleSource, /\.app-chrome \{[^}]*isolation: isolate/);
assert.match(metadataWorkspaceSource, /class="metadata-tag-folder-arrow" aria-hidden="true"><\/span>/);
assert.match(styleSource, /\.metadata-tag-folder-arrow \{[^}]*position: absolute;[^}]*top: 50%;[^}]*right: 12px/);
assert.match(styleSource, /\.metadata-tag-folder-arrow \{[^}]*transform: translateY\(-50%\)/);
assert.match(uiSource, /data-save-character="\$\{escapeHtml\(character\.id\)\}"/);
assert.match(uiSource, /openLibrarySaveModal\('character', 'prompt-builder', character\)/);
assert.match(uiSource, /libraryFormName = character\?\.label \?\? ''/);
assert.match(uiSource, /positive: character\.prompt, negative: character\.undesired/);
assert.match(uiSource, /prompt-tab[^\n]*addEventListener\('click', \(\) => switchWorkspace\('prompt'\)\)/);
assert.match(uiSource, /metadata-tab[^\n]*addEventListener\('click', \(\) => switchWorkspace\('metadata'\)\)/);
assert.match(uiSource, /id="full-prompt-output"/);
assert.match(uiSource, /id="artist-prompt-output"/);
assert.match(uiSource, /id="copy-prompt"/);
assert.equal((uiSource.match(/>Copy prompt</g) ?? []).length, 1);
assert.doesNotMatch(uiSource, /copy-prompt-bottom|Offline catalog|offline snapshot/);
const footerMarkup = uiSource.match(/<footer class="app-footer">[\s\S]*?<\/footer>/)?.[0] ?? '';
assert.match(footerMarkup, /class="footer-brand"><span>NAI Prompt Studio<\/span><span class="footer-links">[\s\S]*?https:\/\/nax\.moe\/\?gallery=danbooru-artist-tags-2-v5[\s\S]*?NAX · CC BY 4\.0[\s\S]*?https:\/\/hothottuk\.neocities\.org\/en[\s\S]*?hothottuk's guide/);
const customWorkspaceSource = uiSource.match(/function customTagsWorkspaceContent\(\): string \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(customWorkspaceSource, /custom-preset-sidebar[\s\S]*?custom-tag-form[\s\S]*?custom-tag-library/);
assert.doesNotMatch(customWorkspaceSource, /Personal images|source-note/);
assert.match(uiSource, /function customTagsWorkspace\(\): string \{[\s\S]*?role="alert"[\s\S]*?customTagLibraryWarning/);
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
assert.match(uiSource, /function customArtistSignature\(tags: readonly CustomTag\[\]\): string/);
assert.match(uiSource, /if \(nextArtistSignature !== appliedCustomArtistSignature\) \{[\s\S]*?rebuildEffectiveArtistCatalog\(\);/);
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
assert.match(uiSource, /let renderedWorkspace: 'prompt' \| 'artist-mix' \| 'saved-library' \| 'custom-tags' \| 'metadata' \| 'settings' = activeWorkspace;/);
assert.match(uiSource, /workspaceScrollTop\.set\(renderedWorkspace, window\.scrollY\)/);
assert.match(uiSource, /if \(workspaceScrollTop\.has\(activeWorkspace\)\) window\.scrollTo\(\{ top: workspaceScrollTop\.get\(activeWorkspace\)!, behavior: 'auto' \}\)/);
assert.match(uiSource, /viewScrollTop\.get\(grid\.id\)/);
assert.match(uiSource, /id="custom-tag-grid"/);
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
assert.match(renderSource, /if \(!app\) return;\s+document\.documentElement\.dataset\.workspace = activeWorkspace;\s+clearHoverPreviewCache\(\);\s+updatePreviewLeases\('prompt'\);/);
assert.match(styleSource, /select:focus-visible/);
assert.match(styleSource, /\.animation-setting select \{[^}]*background: var\(--bg-deep\)[^}]*color: var\(--ink\)/);
assert.match(styleSource, /prefers-reduced-motion/);
assert.match(styleSource, /:root:not\(\[data-animation-mode="on"\]\) \.workspace-panel-incoming \{ animation: none !important; opacity: 1 !important; transform: none !important; \}/);
assert.match(styleSource, /:root:not\(\[data-animation-mode="on"\]\) \.empty-artist-card, :root:not\(\[data-animation-mode="on"\]\) \.empty-artist-card img \{ animation: none !important; transition: none !important; transform: none !important; \}/);
assert.match(styleSource, /:root:not\(\[data-animation-mode="on"\]\) \.artist-card-preview \{ opacity: 0; transition: none !important; transform: none !important; \}/);
assert.match(styleSource, /:root\[data-animation-mode="off"\] \*\{?[^\n]*animation-duration: \.001ms !important/);
assert.match(styleSource, /:root\[data-animation-mode="off"\] \.workspace-panel-incoming \{ animation: none !important; opacity: 1 !important; transform: none !important; \}/);
assert.match(styleSource, /\.workspace-panel-incoming-metadata \{ animation: workspace-panel-metadata-incoming/);
assert.match(styleSource, /@keyframes workspace-panel-metadata-incoming \{\s+from \{ opacity: 0; \}\s+to \{ opacity: 1; \}/);
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
assert.equal(packageSource.version, '0.6.6');
assert.equal(lockSource.version, packageSource.version);
assert.equal(lockSource.packages[''].version, packageSource.version);
assert.match(uiSource, /const APP_VERSION = '0\.6\.6'/);
assert.match(uiSource, /function bindPreviewFade\(scope: ParentNode = document\): void \{[\s\S]*?scope\.querySelectorAll<HTMLImageElement>\('\.card-image img:first-of-type, \.character-catalog-card \.preview-image'\)/);
const previewFadeSource = uiSource.match(/function bindPreviewFade\([\s\S]*?\n\}/)?.[0] ?? '';
assert.match(previewFadeSource, /image\.classList\.add\('is-decoded'\)/);
assert.match(previewFadeSource, /image\.parentElement/);
assert.match(previewFadeSource, /is-preview-ready/);
assert.match(previewFadeSource, /typeof HTMLElement !== 'undefined' && thumbnail instanceof HTMLElement/);
assert.match(previewFadeSource, /image\.complete && image\.naturalWidth > 0/);
assert.match(previewFadeSource, /image\.addEventListener\('load', markReady, \{ once: true \}\)/);
const characterPickSource = uiSource.match(/function bindCharacterPickerEvents\(\): void \{[\s\S]*?\n\}\s*\nfunction refreshArtistGrid/)?.[0] ?? '';
assert.match(characterPickSource, /characters\.push\(newCharacter\(card\.tag, `girl, \$\{card\.tag\}`\)\);\s+saveSoon\(\);\s+renderCharacterList\(\);\s+focusField\('#character-search'\);/);
assert.doesNotMatch(characterPickSource, /refreshCharacterPicker\(\);/, 'picking a character must not restart the already-visible picker page');
function refreshSource(name) {
  const start = uiSource.indexOf(`function ${name}(`);
  const end = uiSource.indexOf('\nfunction ', start + 1);
  return start >= 0 ? uiSource.slice(start, end < 0 ? uiSource.length : end) : '';
}
for (const pickerRefresh of ['refreshArtistGrid', 'refreshMixPicker', 'refreshCharacterPicker']) {
  const source = refreshSource(pickerRefresh);
  assert.match(source, /\.innerHTML =/);
  assert.match(source, /bindPreviewFade\(grid\);/);
}
assert.match(uiSource, /grid\.innerHTML = page\.cards\.map\(artistCard\)\.join\('\'\)[\s\S]*?bindPreviewFade\(grid\);/);
assert.match(uiSource, /grid\.innerHTML = page\.cards\.map\(characterCard\)\.join\('\'\);[\s\S]*?bindPreviewFade\(grid\);/);
assert.match(uiSource, /grid\.innerHTML = page\.cards\.map\(card => \{[\s\S]*?bindPreviewFade\(grid\);/);
// Exercise the readiness contract with deterministic fake images. This keeps
// the regression gate behavioral even though main.ts is an application entry
// module rather than a directly importable unit.
const previewFunctionStart = uiSource.indexOf('function bindPreviewFade(');
const previewFunctionEnd = uiSource.indexOf('\n}\n\nfunction updateEditor', previewFunctionStart) + 2;
const previewFunctionForTest = uiSource.slice(previewFunctionStart, previewFunctionEnd)
  .replace(/scope: ParentNode = document/g, 'scope = document')
  .replace(/querySelectorAll<HTMLImageElement>/g, 'querySelectorAll')
  .replace(/\): void \{/g, ') {');
class PreviewTestHTMLElement {}
const bindPreviewFadeForTest = new Function('document', 'HTMLElement', `return (${previewFunctionForTest})`)(undefined, PreviewTestHTMLElement);
class PreviewTestClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  contains(value) { return this.values.has(value); }
}
class PreviewTestParent extends PreviewTestHTMLElement {
  constructor() { super(); this.classList = new PreviewTestClassList(); }
}
class PreviewTestImage {
  constructor(complete, naturalWidth, parent = new PreviewTestParent()) { this.complete = complete; this.naturalWidth = naturalWidth; this.classList = new PreviewTestClassList(); this.parentElement = parent; this.listeners = new Map(); }
  addEventListener(type, callback, options) { const entries = this.listeners.get(type) ?? []; entries.push({ callback, once: options?.once === true }); this.listeners.set(type, entries); }
  emit(type) { const entries = this.listeners.get(type) ?? []; for (const entry of [...entries]) entry.callback(); this.listeners.set(type, entries.filter(entry => !entry.once)); }
  listenerCount(type) { return (this.listeners.get(type) ?? []).length; }
}
const cachedPreview = new PreviewTestImage(true, 96);
const pendingPreview = new PreviewTestImage(false, 0);
const failedCachePreview = new PreviewTestImage(true, 0);
const unrelatedPreview = new PreviewTestImage(false, 0);
let previewSelector = '';
let previewScopeCalls = 0;
const previewGrid = { querySelectorAll(selector) { previewScopeCalls += 1; previewSelector = selector; return [cachedPreview, pendingPreview, failedCachePreview]; } };
bindPreviewFadeForTest(previewGrid);
assert.equal(previewScopeCalls, 1);
assert.equal(previewSelector, '.card-image img:first-of-type, .character-catalog-card .preview-image');
assert.equal(cachedPreview.classList.contains('is-decoded'), true);
assert.equal(cachedPreview.parentElement.classList.contains('is-preview-ready'), true);
assert.equal(cachedPreview.listenerCount('load'), 0);
assert.equal(pendingPreview.classList.contains('is-decoded'), false);
assert.equal(pendingPreview.parentElement.classList.contains('is-preview-ready'), false);
assert.equal(pendingPreview.listenerCount('load'), 1);
assert.equal(failedCachePreview.classList.contains('is-decoded'), false);
assert.equal(failedCachePreview.parentElement.classList.contains('is-preview-ready'), false);
assert.equal(failedCachePreview.listenerCount('load'), 1);
failedCachePreview.emit('error'); failedCachePreview.emit('load');
pendingPreview.naturalWidth = 96; pendingPreview.emit('load'); pendingPreview.emit('load');
assert.equal(pendingPreview.classList.contains('is-decoded'), true);
assert.equal(pendingPreview.parentElement.classList.contains('is-preview-ready'), true);
assert.equal(failedCachePreview.classList.contains('is-decoded'), false);
assert.equal(failedCachePreview.parentElement.classList.contains('is-preview-ready'), false);
assert.equal(pendingPreview.listenerCount('load'), 0);
assert.equal(failedCachePreview.listenerCount('load'), 0);
assert.equal(unrelatedPreview.classList.contains('is-decoded'), false);
const nonElementParentClassList = new PreviewTestClassList();
const nonElementParentPreview = new PreviewTestImage(true, 96, { classList: nonElementParentClassList });
bindPreviewFadeForTest({ querySelectorAll() { return [nonElementParentPreview]; } });
assert.equal(nonElementParentPreview.classList.contains('is-decoded'), true);
assert.equal(nonElementParentClassList.contains('is-preview-ready'), false);
assert.doesNotMatch(previewFunctionForTest, /setInterval|setTimeout|requestAnimationFrame/);
assert.match(styleSource, /\.card-image > img:first-of-type\.is-decoded, \.character-catalog-card \.preview-image\.is-decoded \{[^}]*opacity: 1/);
assert.match(styleSource, /\.card-image\.is-preview-ready > \.card-skeleton, \.character-catalog-card > button:first-child\.is-preview-ready > \.card-skeleton \{[^}]*display: none;[^}]*animation: none;[^}]*pointer-events: none;/);
assert.match(previewSource, /const boundTargets = new WeakSet<HTMLElement>\(\)/);
assert.match(previewSource, /root\.querySelectorAll<HTMLElement>\(PREVIEW_SELECTOR\)/);
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
assert.match(desktopBuildSource, /catalog-components\.json/);
assert.doesNotMatch(desktopBuildSource, /catalog-packs\.mjs/);
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
assert.match(typesSource, /interface SavedCharacterData \{[\s\S]*?positive: string;[\s\S]*?negative: string;/);
assert.match(typesSource, /interface SavedCharacterItem extends SavedLibraryCommon[\s\S]*?kind: 'character'[\s\S]*?data: SavedCharacterData/);
assert.match(storageSource, /if \(source\.kind === 'character'\)[\s\S]*?normalizeSavedCharacterData\(source\.data\)[\s\S]*?return null/);
assert.match(uiSource, /id="save-library-character"[\s\S]*?New Character/);
assert.match(uiSource, /data-library-filter="character"[\s\S]*?Characters/);
assert.match(uiSource, /item\.kind === 'character'[\s\S]*?Character details/);
assert.match(uiSource, /saved-library-character-positive/);
assert.match(uiSource, /saved-library-character-negative/);
assert.match(uiSource, /function requestCharacterRemoval\(characterId: string[\s\S]*?saveSoon\(\)[\s\S]*?character-remove/);
assert.match(styleSource, /\.saved-library-character-remove \{[^}]*border-radius: 50%/);
assert.match(styleSource, /\.saved-library-character-remove:hover, \.saved-library-character-remove:focus-visible \{[^}]*background: var\(--danger\)/);
assert.match(styleSource, /\.saved-library-form-scroll \{[^}]*padding: 4px 10px 8px 6px;[^}]*scrollbar-gutter: stable/);
assert.match(styleSource, /\.saved-library-character-add \{[^}]*justify-self: start;[^}]*border-radius: 999px/);
assert.match(metadataWorkspaceSource, /patchPolarityBlock\(button\.closest<HTMLElement>/);
assert.doesNotMatch(metadataWorkspaceSource.match(/\[data-metadata-polarity\][\s\S]*?\}\)\);/)?.[0] ?? '', /refresh\(\)/);
assert.match(metadataWorkspaceSource, /cachedSavePayload/);
assert.match(customTagLibrarySource, /changedMirrorPreviews/);
assert.match(customTagLibrarySource, /ensureFlatMirrorAssets\(journal\.manifests, changedMirrorPreviews\)/);
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
assert.match(installerLauncherSource, /NAISETUPV0640000/);
assert.match(componentSource, /require\('original-fs'\)/);
assert.match(componentSource, /outerFs\.createReadStream/);

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
assert.match(catalogUpdaterSource, /mapWithConcurrency\(pages\.filter\(page => page !== 1\), GALLERY_PAGE_CONCURRENCY/);
assert.match(catalogUpdaterSource, /const embeddedBySource = new Map/);
assert.match(catalogUpdaterSource, /embeddedBySource\.get\(source\.sourceUrl\)/);
assert.match(catalogUpdaterSource, /fs\.readSync\(descriptor, header, 0, header\.length, 0\)/);
assert.doesNotMatch(catalogUpdaterSource, /isWebp\(fs\.readFileSync/);
assert.match(catalogUpdaterSource, /PROGRESS_INTERVAL_MS = 100/);
const bootSource = uiSource.match(/async function bootApp\(\)[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(bootSource, /const warmup = startupCatalogCards\(\)/);
assert.match(bootSource, /const blocking = startupBlockingCards\(warmup\)/);
assert.match(uiSource, /const STARTUP_BLOCKING_PREVIEW_LIMIT = STARTUP_ARTIST_PAGE_SIZE/);
assert.match(uiSource, /function startupBlockingCards\(warmup: readonly CatalogCard\[\]\)/);
assert.match(bootSource, /await preloadCards\(blocking, 'Preparing card previews', 'visible'\)/);
assert.match(bootSource, /scheduleStartupIdlePreviews\(\[\.\.\.pageTwo, \.\.\.favoritesFirst, \.\.\.idleCards\], startupSources\)/);
assert.doesNotMatch(uiSource, /waitForStartupBudget/);
assert.doesNotMatch(bootSource, /scheduleIdleWarmup\(warmup/);
assert.match(uiSource, /const gridPreviewCache = new PreviewCache\([\s\S]*?transform: async/);
assert.match(uiSource, /const contentPreviewCache = new PreviewCache/);
assert.match(uiSource, /const hoverPreviewCache = new PreviewCache/);
assert.match(uiSource, /data-preview-cache="\$\{official \? 'grid' : 'content'\}"/);
assert.match(uiSource, /data-preview-cache="content" data-preview-src/);
assert.match(uiSource, /function isOfficialArtistCard\(card: CatalogCard \| undefined\)[\s\S]*?card\.custom !== true/);
assert.match(uiSource, /function customLibraryCardMarkup\([\s\S]*?data-preview-cache="content"/);
assert.match(uiSource, /function characterCard\([\s\S]*?data-preview-cache="content"/);
assert.match(uiSource, /function savedLibraryCardMarkup\([\s\S]*?data-preview-cache="content"/);
assert.match(uiSource, /const visual = hasImage \? `<img data-preview-cache="content"/);
assert.match(uiSource, /const cache = job\.card \? contentOrGridPreviewCache\(job\.card\) : contentPreviewCache/);
assert.match(uiSource, /function clearHoverPreviewCache\(\): void \{[\s\S]*?hoverPreviewCache\.clear\(\)/);
for (const boundary of ['switchWorkspace', 'closeArtistPicker', 'closeCharacterPicker', 'closeMixPicker', 'refreshArtistGrid', 'refreshCharacterPicker', 'refreshMixPicker']) {
  const boundarySource = uiSource.match(new RegExp(`function ${boundary}\\([\\s\\S]*?\\n\\}`))?.[0] ?? '';
  assert.match(boundarySource, /clearHoverPreviewCache\(\)/, `${boundary} must cancel hover originals`);
}
assert.match(uiSource, /const requestToken = \+\+previewPageToken/);
assert.match(uiSource, /pageStatus\.textContent = 'Preparing page…'/);
assert.match(previewSource, /if \(source && officialArtist && previewImageLoader\)/);
assert.match(previewSource, /requestToken !== previewRequestToken/);
assert.match(previewCacheSource, /setMaxBytes\(value: number\)/);
assert.match(previewCacheSource, /acquireLease\(scope: string/);
assert.match(previewCacheSource, /entry\.controller\.abort\(\)/);
assert.match(thumbnailSource, /resizeWidth/);
assert.match(thumbnailSource, /convertToBlob\([\s\S]*?image\/webp/);
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
for (const mode of ['primary', 'companion', 'replace-anchor']) assert.match(uiSource, new RegExp(`openMixPicker\\('${mode}'`));
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
assert.equal(packageSource.version, '0.6.6');
assert.equal(lockSource.version, packageSource.version);
assert.equal(lockSource.packages[''].version, packageSource.version);
rmSync(testTempRoot, { recursive: true, force: true });
console.log(`Tests passed: page discovery, atomic replacement/failure recovery, WebP validation, prompt serialization, migration, random uniqueness, and exact catalog assets (${catalog.artists.length} V5 artists / ${catalog.characters.length} characters).`);

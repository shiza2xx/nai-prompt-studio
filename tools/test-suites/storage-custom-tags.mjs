import assert from 'node:assert/strict'; import { copyFileSync,existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,statSync,symlinkSync,writeFileSync } from 'node:fs'; import { basename, join } from 'node:path'; import { createRequire } from 'node:module'; import { gzipSync,gunzipSync } from 'node:zlib'; import { createHash } from 'node:crypto'; import { normalizeArtistMix,normalizeCustomTag,normalizeCustomTagPresetId,normalizeCustomTagPresets,normalizeDraft,normalizeRandomRange,normalizeSavedLibrary,normalizeSavedLibraryItem,normalizeTheme,normalizeSettings,normalizePreviewCachePreset } from '../../src/storage.ts'; import { DEFAULT_CUSTOM_TAG_PRESET_ID,DEFAULT_CUSTOM_TAG_PRESET_NAME } from '../../src/custom-tag-presets.ts'; import { artistDisplayName,canonicalArtistIdentity,customArtistCatalogId,mergeArtistCatalog,migrateArtistAliases,migrateArtistMixAliases,migrateFavoriteAliases } from '../../src/artist-catalog.ts'; import { CUSTOM_TAG_MAX_LENGTH } from '../../src/types.ts'; import { classifyCustomTagDrop } from '../../src/custom-tag-dnd.ts'; import { mixCompanionCapacity } from '../../src/artist-mix-layout.ts'; const require=createRequire(import.meta.url); const asarModule=require('@electron/asar'); const {createPackage,createPackageFromFiles,extractFile,listPackage}=asarModule; const {resolveAppPaths,ensureWritable,migrateLegacyWorkspace}=require('../../electron/app-paths.cjs'); const {containedAsset,hasValidMagic,validateImagePayload}=require('../../electron/custom-tag-assets.cjs'); const {createCustomTagLibrary,digestMirror,writeWorkspaceSection}=require('../../electron/custom-tag-library.cjs'); const {canonicalJson,createPackArchive,validatePackArchive,MAX_CARDS,MAX_ENTRIES}=require('../../electron/custom-tag-pack.cjs'); const {parsePostUrl,formatNovelAITags,loadPost:loadBooruPost,requestBytes:requestBooruBytes}=require('../../electron/booru-metadata.cjs');
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
const booruCompressedJpeg = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
const booruRequests = [];
const booruResponses = new Map([
  ['https://danbooru.donmai.us/posts/42.json', new Response(JSON.stringify({ id: 42, tag_string: 'blue_eyes red_hair', image_width: 640, image_height: 480, rating: 's', source: 'https://example.test/source', large_file_url: 'https://cdn.donmai.us/compressed.jpg', file_url: 'https://cdn.donmai.us/original.png' }), { status: 200, headers: { 'content-type': 'application/json' } })],
  ['https://cdn.donmai.us/compressed.jpg', new Response(booruCompressedJpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })],
  ['https://cdn.donmai.us/original.png', new Response(booruPng, { status: 200, headers: { 'content-type': 'image/png' } })]
]);
const booruResult = await loadBooruPost('https://danbooru.donmai.us/posts/42', { fetch: async url => { booruRequests.push(url); return booruResponses.get(url) ?? new Response('not found', { status: 404 }); } });
assert.equal(booruResult.tags, 'blue eyes, red hair'); assert.equal(booruResult.mime, 'image/png'); assert.equal(booruResult.width, '640'); assert.equal(booruResult.height, '480'); assert.equal(booruResult.id, '42');
assert.deepEqual(Buffer.from(booruResult.bytes), booruPng, 'booru cards preserve the original response bytes');
assert.equal(booruRequests.includes('https://cdn.donmai.us/compressed.jpg'), false, 'a lower-quality Danbooru JPEG is not requested when file_url succeeds');
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
const indexedPreview = migratedCustomLibrary.tags.find(item => item.id === 'comma-tag');
let canonicalPreviewReads = 0; const originalReadCanonical = customLibrary.readCanonical.bind(customLibrary);
customLibrary.readCanonical = (...args) => { canonicalPreviewReads += 1; return originalReadCanonical(...args); };
const indexedRelativePreview = `previews/${basename(indexedPreview.imageAsset)}`;
assert.equal(customLibrary.resolvePreview(indexedPreview.presetId, indexedRelativePreview).endsWith(basename(indexedPreview.imageAsset)), true);
assert.equal(customLibrary.resolvePreview(indexedPreview.presetId, indexedRelativePreview).endsWith(basename(indexedPreview.imageAsset)), true);
assert.equal(canonicalPreviewReads, 1, 'repeated preview authorization must reuse the verified reference index');
customLibrary.readCanonical = originalReadCanonical;
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
const orderPreset = customLibrary.transact('preset:create', { id: 'order-preset', name: 'Order preset', createdAt: '2026-08-29T00:02:00Z', updatedAt: '2026-08-29T00:02:00Z' });
for (const [idValue, tag] of [['order-one', 'artist: Order 1'], ['order-two', 'artist: Order 2'], ['order-three', 'artist: Order 3']]) customLibrary.transact('card:upsert', { id: idValue, kind: 'artist', tag, presetId: 'order-preset', description: '', createdAt: '2026-08-29T00:02:00Z', updatedAt: '2026-08-29T00:02:00Z' });
assert.throws(() => customLibrary.transact('card:upsert', { id: 'unknown-preset-card', kind: 'artist', tag: 'artist: Unknown preset', presetId: 'missing-preset', description: '', createdAt: '2026-08-29T00:02:00Z', updatedAt: '2026-08-29T00:02:00Z' }), /Unknown custom tag preset/);
assert.throws(() => customLibrary.transact('card:reorder', { presetId: 'order-preset', orderedCardIds: ['order-one', 'order-one', 'order-three'] }), /Invalid custom tag card order/);
assert.throws(() => customLibrary.transact('card:reorder', { presetId: 'order-preset', orderedCardIds: ['order-one', 'order-two', 'foreign'] }), /Invalid custom tag card order/);
assert.throws(() => customLibrary.transact('card:move', { id: 'order-one', destinationPresetId: 'order-preset' }), /Invalid custom tag move/);
assert.throws(() => customLibrary.transact('card:move', { id: 'order-one', destinationPresetId: 'default' }, exactPng), /cannot include preview bytes/);
const reordered = customLibrary.transact('card:reorder', { presetId: 'order-preset', orderedCardIds: ['order-three', 'order-one', 'order-two'] });
assert.deepEqual(reordered.tags.filter(item => item.presetId === 'order-preset').map(item => item.id), ['order-three', 'order-one', 'order-two']);
const movedWithPreview = customLibrary.transact('card:move', { id: 'comma-tag', destinationPresetId: 'order-preset' });
assert.equal(movedWithPreview.tags.find(item => item.id === 'comma-tag')?.presetId, 'order-preset');
const movedPreviewPath = movedWithPreview.tags.find(item => item.id === 'comma-tag').imageAsset;
assert.ok(existsSync(join(customLibraryAssets, 'library-v1', 'presets', 'order-preset', movedPreviewPath.split('/').at(-2), movedPreviewPath.split('/').at(-1))));
const movedBack = customLibrary.transact('card:move', { id: 'comma-tag', destinationPresetId: 'default' });
assert.equal(movedBack.tags.find(item => item.id === 'comma-tag')?.presetId, 'default');
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
const originalPackExtract = asarModule.extractFile; const packExtractions = new Map();
asarModule.extractFile = (archive, name, ...args) => { packExtractions.set(name, (packExtractions.get(name) ?? 0) + 1); return originalPackExtract(archive, name, ...args); };
let oneReadPack;
try { oneReadPack = validatePackArchive(packOne, { stagingDir: join(customPackTemp, 'one-read') }); }
finally { asarModule.extractFile = originalPackExtract; }
for (const name of ['pack.json', 'manifest.json', ...new Set(oneReadPack.manifest.cards.flatMap(card => card.preview ? [card.preview.file] : []))]) assert.equal(packExtractions.get(name), 1, `${name} must be extracted once per validation context`);
rmSync(oneReadPack.stage, { recursive: true, force: true });
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
const lateFailureSource = join(customPackTemp, 'late-failure-source'); mkdirSync(join(lateFailureSource, 'previews'), { recursive: true });
copyFileSync(join(validatedLimitPack.stage, 'pack.json'), join(lateFailureSource, 'pack.json')); copyFileSync(join(validatedLimitPack.stage, 'manifest.json'), join(lateFailureSource, 'manifest.json'));
const lateFailureFiles = [join(lateFailureSource, 'pack.json'), join(lateFailureSource, 'manifest.json')];
for (const card of limitPackCards) { const target = join(lateFailureSource, card.preview.file); copyFileSync(join(validatedLimitPack.stage, card.preview.file), target); lateFailureFiles.push(target); }
writeFileSync(lateFailureFiles.at(-1), Buffer.from('damaged-preview'));
const lateFailurePack = join(customPackTemp, 'late-failure.naipack'); await createPackageFromFiles(lateFailureSource, lateFailurePack, lateFailureFiles);
const lateFailureStaging = join(customPackTemp, 'late-failure-staging'); mkdirSync(lateFailureStaging);
assert.throws(() => validatePackArchive(lateFailurePack, { stagingDir: lateFailureStaging }), /preview size or digest mismatch|preview MIME/i);
assert.deepEqual(readdirSync(lateFailureStaging), [], 'a later preview validation failure cleans the partial staging directory');
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

console.log('storage-custom-tags tests passed.');

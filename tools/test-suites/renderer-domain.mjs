import assert from 'node:assert/strict'; import { createRequire } from 'node:module'; import {decodePreviews,ViewportPreviewLoader} from '../../src/preview-loader.ts'; import {BUILTIN_CONSTRUCTOR_FOLDER_ID,canonicalCustomTagIdentity,canonicalGroupIdentity,classifyGuideEntries,constructorCardTags,groupConstructorCards,guideVisualCount,hasPromptTag,hasPromptTagGroup,mergeConstructorCards,qualityPresetTags,searchConstructorFolders,splitTagGroup,togglePromptTag,togglePromptTagGroup} from '../../src/prompt-constructor.ts'; import {buildArtistsPrompt,buildBasePrompt,serializeTag} from '../../src/prompt.ts'; import {MAX_PROMPT_RANDOM_ARTISTS,normalizeArtistWeight,pickUniqueCards,promptArtistPoolSize,randomArtistSelection,randomCount,randomWeight,reconcileSelectedArtists,rerollArtistWeight,rerollArtistWeights,resolveRandomPoolRange} from '../../src/random.ts'; import {normalizeAnimationMode,normalizeArtistMix,normalizeArtistMixRange,normalizeCustomTag,normalizeCustomTagPresetId,normalizeCustomTagPresets,normalizeDraft,normalizeRandomRange,normalizeTheme,normalizeSettings,normalizePreviewCachePreset,normalizeSavedPromptSnapshot} from '../../src/storage.ts'; const require=createRequire(import.meta.url); const {containedAsset,hasValidMagic,validateImagePayload}=require('../../electron/custom-tag-assets.cjs'); import { DEFAULT_CUSTOM_TAG_PRESET_ID,DEFAULT_CUSTOM_TAG_PRESET_NAME } from '../../src/custom-tag-presets.ts'; import { artistDisplayName,canonicalArtistIdentity,customArtistCatalogId,mergeArtistCatalog,migrateArtistAliases,migrateArtistMixAliases,migrateFavoriteAliases } from '../../src/artist-catalog.ts'; import {mixCompanionCapacity,mixCompanionScale,mixOrbitLayout,normalizeWheelDelta,stepWeightFromWheel} from '../../src/artist-mix-layout.ts';
import { compareReleaseVersions, shouldShowWhatsNew, startupExperience } from '../../src/release-state.ts';

assert.equal(compareReleaseVersions('0.6.9', '0.7.0'), -1);
assert.equal(compareReleaseVersions('0.7.0', '0.7.0'), 0);
assert.equal(compareReleaseVersions('0.7.1', '0.7.0'), 1);
assert.equal(compareReleaseVersions('legacy', '0.6.9'), null);
assert.equal(shouldShowWhatsNew(false, '', '0.7.0'), false, 'fresh profiles use the Studio Guide');
assert.equal(shouldShowWhatsNew(true, '0.6.9', '0.7.0'), true, 'older profiles see the current release');
assert.equal(shouldShowWhatsNew(true, '', '0.7.0'), true, 'missing release markers are legacy');
assert.equal(shouldShowWhatsNew(true, 'not-a-version', '0.7.0'), true, 'malformed release markers are legacy');
assert.equal(shouldShowWhatsNew(true, '0.7.0', '0.7.0'), false, 'current release is already acknowledged');
assert.equal(shouldShowWhatsNew(true, '0.7.1', '0.7.0'), false, 'newer release markers do not downgrade');
assert.equal(startupExperience(false, '', '0.7.0'), 'guide');
assert.equal(startupExperience(true, '0.6.9', '0.7.0'), 'whats-new');
assert.equal(startupExperience(true, '0.7.0', '0.7.0'), 'none');
let loaderActive = 0; let loaderPeak = 0; const loaderProgress = [];
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

const originalObserver = globalThis.IntersectionObserver;
const originalHeight = globalThis.innerHeight;
const observers = [];
globalThis.innerHeight = 900;
globalThis.IntersectionObserver = class {
  constructor(_callback, options) { this.options = options; this.disconnected = 0; observers.push(this); }
  observe() {} unobserve() {} disconnect() { this.disconnected += 1; }
};
const imageStub = { getBoundingClientRect: () => ({ top: 1200, bottom: 1300 }) };
const libraryScope = { isConnected: true, clientHeight: 900, scrollHeight: 900, clientWidth: 900, scrollWidth: 900, querySelectorAll: () => [imageStub], getBoundingClientRect: () => ({ top: 0, bottom: 900 }) };
const viewportLoader = new ViewportPreviewLoader();
viewportLoader.hydrate(libraryScope, 'img', () => {});
assert.equal(observers.at(-1).options.root, null, 'non-scrolling Saved Library grids observe the document viewport');
viewportLoader.hydrate(libraryScope, 'img', () => {});
assert.equal(observers.at(-2).disconnected, 1, 'rescanning a scope disconnects its previous observer');
const scrollScope = { ...libraryScope, clientHeight: 300, scrollHeight: 900 };
viewportLoader.hydrate(scrollScope, 'img', () => {});
assert.equal(observers.at(-1).options.root, scrollScope, 'overflow grids retain their own viewport root');
viewportLoader.dispose();
if (originalObserver === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = originalObserver;
if (originalHeight === undefined) delete globalThis.innerHeight; else globalThis.innerHeight = originalHeight;

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
const artists = [{ id: 'a', catalogId: 'artist-v5-1', tag: 'artist: alpha', weight: 1 }, { id: 'b', catalogId: 'artist-v5-2', tag: 'artist: beta', weight: 0.9 }];
assert.equal(serializeTag(artists[0]), '1.0::artist: alpha::');
assert.equal(serializeTag(artists[1]), '0.9::artist: beta::');
assert.equal(serializeTag({ id: 'digit', tag: 'artist: aogisa88', weight: 1.8 }), '1.8::artist: aogisa88 ::');
assert.equal(serializeTag({ id: 'plain', tag: 'artist: aogisa', weight: 1.8 }), '1.8::artist: aogisa::');
assert.equal(serializeTag({ id: 'trimmed', tag: '  artist: aki99   ', weight: 1 }), '1.0::artist: aki99 ::');
assert.equal(buildBasePrompt({ foundation: 'opaque base', frame: '1girl', artists, setting: 'indoors', render: 'best quality', undesired: 'watermark' }), 'opaque base, 1girl, 1.0::artist: alpha::, 0.9::artist: beta::, indoors, best quality');
assert.equal(buildArtistsPrompt(artists), '1.0::artist: alpha::, 0.9::artist: beta::');
assert.notEqual(buildArtistsPrompt(artists), buildBasePrompt({ foundation: '', frame: '1girl', artists, setting: 'indoors', render: 'best quality', undesired: '' }));
assert.equal(buildBasePrompt({ foundation: 'FOUNDATION', frame: 'FRAME', artists: [], setting: 'SCENE', render: 'RENDER', undesired: 'UC', }), 'FOUNDATION, FRAME, SCENE, RENDER');
const legacySnapshot = normalizeSavedPromptSnapshot({ base: { frame: 'FRAME', artists: [], setting: 'SCENE', render: 'RENDER', undesired: 'UC' }, characters: [], randomRange: { min: 2, max: 5 } });
assert.equal(legacySnapshot?.version, 3);
assert.equal(legacySnapshot?.base.foundation, '', 'legacy saved snapshots gain an empty foundation');
assert.equal(buildBasePrompt(legacySnapshot.base), 'FRAME, SCENE, RENDER', 'legacy snapshot prompt order stays stable after migration');
assert.equal(normalizeRandomRange({ min: 2, max: 5 }).min, 2);
assert.equal(normalizeRandomRange({ min: 2, max: 5 }).max, 5);
assert.equal(MAX_PROMPT_RANDOM_ARTISTS, 15);
assert.equal(promptArtistPoolSize(4198), 15);
assert.deepEqual(normalizeRandomRange({ min: 99, max: 4198 }), { min: 15, max: 15 });
const migrated = normalizeDraft({ base: { frame: 'custom frame', artists: [{ id: 'old', tag: 'artist: legacy', weight: 1 }], setting: 'custom scene', render: 'custom render', undesired: 'keep uc' }, characters: [{ id: 'character-v4.5-1', label: 'Hero', prompt: 'girl', undesired: '' }], randomRange: { min: 3, max: 4 } });
assert.equal(migrated?.base.artists[0]?.id, 'old', 'legacy Prompt Builder artists remain readable in the draft');
assert.equal(migrated?.base.frame, 'custom frame');
assert.equal(migrated?.characters[0].label, 'Hero');
assert.deepEqual(migrated?.randomRange, { min: 3, max: 4 });
assert.equal(migrated?.useArtistMix, false, 'older drafts default the Artist Mix link off');
assert.equal(migrated?.version, 4, 'old drafts normalize to live schema v4');
const linkedDraft = normalizeDraft({ ...migrated, useArtistMix: true });
assert.equal(linkedDraft?.useArtistMix, true, 'the Artist Mix link round-trips when explicitly enabled');
assert.equal(linkedDraft?.version, 4, 'explicit Artist Mix drafts retain live schema v4');
assert.equal(normalizeAnimationMode(undefined), 'auto');
assert.equal(normalizeAnimationMode('invalid'), 'auto');
assert.equal(normalizeAnimationMode('on'), 'on');
assert.equal(normalizeAnimationMode('off'), 'off');
assert.deepEqual(normalizeSettings(undefined), { animationMode: 'auto', preloadCharacterPreviews: false, theme: 'arcane-gold', updateCatalogOnStartup: true, checkAppUpdatesOnStartup: true, seenGuideIds: [], lastSeenVersion: '', previewCachePreset: 'large', interfaceScale: 100 });
assert.deepEqual(normalizeSettings({ preloadCharacterPreviews: true, theme: 'midnight-blue', updateCatalogOnStartup: false, checkAppUpdatesOnStartup: false, seenGuideIds: ['overview'], lastSeenVersion: '0.4.0' }, 'off'), { animationMode: 'off', preloadCharacterPreviews: true, theme: 'midnight-blue', updateCatalogOnStartup: false, checkAppUpdatesOnStartup: false, seenGuideIds: ['overview'], lastSeenVersion: '0.4.0' , previewCachePreset: 'large', interfaceScale: 100 });
assert.equal(normalizeSettings({ interfaceScale: 110 }).interfaceScale, 110);
assert.equal(normalizeSettings({ interfaceScale: 125 }).interfaceScale, 125);
assert.equal(normalizeSettings({ interfaceScale: 111 }).interfaceScale, 100);
assert.equal(normalizeSettings({ scale: '125' }).interfaceScale, 125);
assert.equal(normalizePreviewCachePreset('balanced'), 'balanced');
assert.equal(normalizePreviewCachePreset('legacy-value'), 'large');
const normalizedMix = normalizeArtistMix({ primary: { id: 'primary', catalogId: 'artist-v5-primary', tag: 'artist: primary', weight: 1 }, companions: [{ id: 'same', catalogId: 'artist-v5-primary', tag: 'artist: duplicate', weight: 2 }, { id: 'companion', catalogId: 'artist-v5-companion', tag: 'artist: companion', weight: 0.3 }], randomRange: { min: 1, max: 1 }, favoritesOnly: true });
assert.equal(normalizedMix.version, 2);
assert.equal(normalizedMix.anchors[0]?.catalogId, 'artist-v5-primary');
assert.deepEqual(normalizedMix.companions.map(item => item.catalogId), ['artist-v5-companion']);
assert.deepEqual(normalizedMix.randomRange, { min: 1, max: 1 });
assert.equal(normalizedMix.favoritesOnly, true);
assert.equal(normalizedMix.anchorWeightsLocked, true);
assert.equal(normalizeArtistMix({ anchorWeightsLocked: false }).anchorWeightsLocked, false);
assert.equal(normalizeArtistMix({ anchorWeightsLocked: true }).anchorWeightsLocked, true);
assert.deepEqual(normalizeArtistMixRange({ min: 1, max: 1 }, 0), { min: 1, max: 1 });
assert.deepEqual(normalizeArtistMixRange({ min: 1, max: 2 }, 5), { min: 5, max: 5 });
const thirteenAnchors = Array.from({ length: 13 }, (_, index) => ({ id: `anchor-${index}`, catalogId: `artist-v5-anchor-${index}`, tag: `artist: anchor ${index}`, weight: 1 }));
const normalizedTwelveAnchors = normalizeArtistMix({ anchors: thirteenAnchors, companions: [{ id: 'companion', catalogId: 'artist-v5-companion', tag: 'artist: companion', weight: 1 }] });
assert.equal(normalizedTwelveAnchors.anchors.length, 12, 'the twelfth anchor is retained while the thirteenth is dropped');
assert.equal(normalizedTwelveAnchors.companions.length, 0, 'twelve anchors consume all companion capacity');
assert.equal(mixCompanionCapacity(0), 12);
assert.equal(mixCompanionCapacity(12), 0);
assert.equal(normalizeWheelDelta(-1, 0), -1);
assert.equal(normalizeWheelDelta(-1, 1), -16);
assert.equal(normalizeWheelDelta(200, 0), 48, 'a single wheel event is bounded before it reaches weight state');
const wheelAccumulator = { remainder: 0 };
assert.equal(stepWeightFromWheel(1, -1, 1, wheelAccumulator), 1, 'fine deltas accumulate without an uncontrolled burst');
assert.equal(stepWeightFromWheel(1, -1, 1, wheelAccumulator), 1.1, 'wheel up increases weight by one tenth');
const downWheelAccumulator = { remainder: 0 };
assert.equal(stepWeightFromWheel(2, 1, 1, downWheelAccumulator), 2, 'fine downward deltas also accumulate');
assert.equal(stepWeightFromWheel(2, 1, 1, downWheelAccumulator), 1.9, 'wheel down decreases weight by one tenth');
assert.equal(stepWeightFromWheel(0.1, 200, 0, { remainder: 0 }), 0.1, 'lower endpoint is clamped');
assert.equal(stepWeightFromWheel(2, -200, 0, { remainder: 0 }), 2, 'upper endpoint is clamped');
assert.equal(migrated?.version, 4);
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
for (const anchorCount of Array.from({ length: 13 }, (_, index) => index)) {
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

console.log('renderer-domain tests passed.');

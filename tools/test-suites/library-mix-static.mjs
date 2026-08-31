import assert from 'node:assert/strict'; import {readFileSync,readdirSync} from 'node:fs'; import {mixCompanionCapacity,mixCompanionScale,mixOrbitLayout} from '../../src/artist-mix-layout.ts'; import * as f from './source-fixtures.mjs'; const {uiSource,customTagsWorkspaceSource,savedLibraryWorkspaceSource,styleSource,typesSource,previewSource,previewCacheSource,metadataHighlightSource,warmupSource,thumbnailSource,storageSource,globalSource,metadataWorkspaceSource,electronSource,customTagLibrarySource,customTagPackSource,componentSource,catalogUpdaterSource,updateV5Source,preloadSource,appPathsSource,indexSource,packageSource,lockSource,tsconfigSource,localEnvSource,localRunnerSource,desktopBuildSource,catalogPacksSource,catalogPacksVersionSource,thinCatalogSource,releaseManifestSource,installerBuildSource,iconPreparationSource,iconResizeSource,installerLauncherSource,installerProofSource,installerProofRunnerSource,installerStorePatchSource,nsisIncludeSource,npmrcSource}=f;
// V0.6 source contracts: autonomous library records, metadata-only extraction,
// theme chooser, monotonic startup percent, collision solver, installer policy.
assert.match(typesSource, /version\?: 4;[\s\S]*source\?: 'manual'/);
assert.match(storageSource, /normalizeSavedPromptData/);
assert.match(uiSource, /create: kind => openLibrarySaveModal\(kind, 'manual'\)/);
assert.match(savedLibraryWorkspaceSource, /id="save-library-prompt"[\s\S]*?id="save-library-mix"/);
assert.doesNotMatch(uiSource, /data-restore-library|>Restore</);
assert.doesNotMatch(uiSource, /Saved sets/);
assert.match(uiSource, /id="save-prompt-library"/);
assert.match(uiSource, /id="copy-prompt"[\s\S]*?id="save-prompt-library"/);
assert.match(metadataWorkspaceSource, /getSavePayload\(\): MetadataSavePayload \| null/);
assert.match(metadataWorkspaceSource, /Add to Saved Library/);
assert.match(metadataWorkspaceSource, /Save Artist Mix/);
assert.match(metadataWorkspaceSource, /this\.artistHighlighter\(\)\.extract\(this\.result\.base\.positive/);
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
assert.match(savedLibraryWorkspaceSource, /id="save-library-character"[\s\S]*?New Character/);
assert.match(savedLibraryWorkspaceSource, /\['character', 'Characters'\]/);
assert.match(savedLibraryWorkspaceSource, /item\.kind === 'character'[\s\S]*?Character details/);
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
assert.match(savedLibraryWorkspaceSource, /data-library-copy=/);
assert.match(uiSource, /\.\.\.libraryFormPrompt, characters:/);
assert.doesNotMatch(uiSource.match(/const promptFields = kind === 'prompt'[\s\S]*?;\n/)?.[0] ?? '', /saved-library-model|saved-library-steps|saved-library-sampler|saved-library-width|saved-library-height|saved-library-cfg/);
assert.match(previewSource, /data-library-preview-image/);
assert.match(styleSource, /\.saved-library-card \{[^}]*grid-template-columns: 124px minmax\(0, 1fr\)/);
assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*?\.saved-library-card \{ grid-template-columns: 110px minmax\(0, 1fr\)/);
assert.match(savedLibraryWorkspaceSource, /const generation = item\.kind === 'prompt'/);
assert.doesNotMatch(savedLibraryWorkspaceSource, /\|\| 'Unavailable'/);
assert.match(uiSource, /<div class="mix-actions">[\s\S]*?\$\{status\}<\/section><section class="mix-stage"/);
assert.match(styleSource, /\.mix-random-settings > \.random-notice \{[^}]*grid-column: 1 \/ -1/);
assert.match(uiSource, /button\?\.classList\.contains\('library-copy-icon'\)[\s\S]*?button\.dataset\.copied = 'true'/);
assert.match(savedLibraryWorkspaceSource, /tabindex="0" role="img" aria-label="Preview cover for/);
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
assert.match(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /Eight interface themes/);
assert.equal(packageSource.version, '0.6.8');
assert.equal(lockSource.version, packageSource.version);
assert.equal(lockSource.packages[''].version, packageSource.version);
assert.match(installerBuildSource, /nsis-template-override\.cjs'\)\.replaceAll\('\\\\', '\/'\)/);
assert.match(installerBuildSource, /--require="\$\{nsisTemplateOverride\}"/);
console.log('library-mix-static tests passed.');

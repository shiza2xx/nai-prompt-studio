import assert from 'node:assert/strict'; import {readFileSync,readdirSync} from 'node:fs'; import {mixCompanionCapacity,mixCompanionScale,mixOrbitLayout} from '../../src/artist-mix-layout.ts'; import * as f from './source-fixtures.mjs'; const {uiSource,customTagsWorkspaceSource,savedLibraryWorkspaceSource,styleSource,typesSource,previewSource,previewCacheSource,metadataHighlightSource,warmupSource,thumbnailSource,storageSource,globalSource,metadataWorkspaceSource,electronSource,customTagLibrarySource,customTagPackSource,componentSource,catalogUpdaterSource,updateV5Source,preloadSource,appPathsSource,indexSource,packageSource,lockSource,tsconfigSource,localEnvSource,localRunnerSource,desktopBuildSource,catalogPacksSource,catalogPacksVersionSource,thinCatalogSource,releaseManifestSource,installerBuildSource,iconPreparationSource,iconResizeSource,installerLauncherSource,installerProofSource,installerProofRunnerSource,installerStorePatchSource,nsisIncludeSource,npmrcSource}=f;
// V0.6 source contracts: autonomous library records, metadata-only extraction,
// theme chooser, monotonic startup percent, collision solver, installer policy.
assert.match(typesSource, /version\?: 4;[\s\S]*source\?: 'manual'/);
assert.match(storageSource, /normalizeSavedPromptData/);
assert.match(uiSource, /create: kind => openLibrarySaveModal\(kind, 'manual'\)/);
assert.match(savedLibraryWorkspaceSource, /saved-library-use[\s\S]*data-use-library/);
assert.match(savedLibraryWorkspaceSource, /if \(button\.dataset\.useLibrary\) \{ this\.actions\.apply\(button\.dataset\.useLibrary\); return true; \}/);
assert.match(uiSource, /function applySavedPromptToBuilder\(itemId: string\): void \{[\s\S]*?item\.data\?\.positive \?\? item\.prompt[\s\S]*?item\.data\?\.negative \?\? ''[\s\S]*?base\.foundation\.trim\(\) \|\| base\.undesired\.trim\(\) \|\| characters\.length/);
assert.match(uiSource, /function commitSavedPromptToBuilder\(item: SavedLibraryItem\): void \{[\s\S]*?foundation: positive, undesired: negative[\s\S]*?id\(\)[\s\S]*?saveDraft\(currentDraft\(\)\)[\s\S]*?editor-base-foundation/);
assert.match(uiSource, /libraryModalMode === 'apply'[\s\S]*?confirm-library-apply[\s\S]*?cancel-library-action/);
assert.match(uiSource, /syncMixWeightState\([\s\S]*?card, '', false\);[\s\S]*?queueMixWheelSave\(\)/);
assert.match(uiSource, /event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\)/);
assert.doesNotMatch(uiSource.match(/function handleMixCardWheel\([\s\S]*?\n\}/)?.[0] ?? '', /render\(\)/);
assert.match(uiSource, /\.mix-artist-card'\)\.forEach\(card => card\.addEventListener\('wheel', handleMixCardWheel, \{ passive: false \}\)/);
assert.match(styleSource, /\.mix-artist-card \{ overscroll-behavior: contain; \}/);
assert.match(styleSource, /\.mix-artist-card \.weight-controls \{[\s\S]*?grid-template-rows: minmax\(24px, auto\) minmax\(26px, auto\)[\s\S]*?width: 100%/);
assert.match(styleSource, /\.mix-artist-card \.weight-controls input\[type="range"\] \{[\s\S]*?grid-column: 1 \/ -1[\s\S]*?min-height: 24px/);
assert.match(styleSource, /\.mix-artist-card \.weight-controls \.reroll-weight \{[\s\S]*?min-width: 54px[\s\S]*?font-size: 10px[\s\S]*?white-space: nowrap/);
assert.match(styleSource, /data-layout-density="compact"[\s\S]*?grid-template-rows: 86px minmax\(0, 1fr\)[\s\S]*?min-width: 120px[\s\S]*?min-height: 145px/);
assert.match(styleSource, /data-layout-density="micro"[\s\S]*?width: var\(--mix-companion-width, 88px\)[\s\S]*?height: var\(--mix-companion-height, 64px\)/);
assert.match(styleSource, /is-dense-anchor \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(120px, 1fr\)\)[\s\S]*?width: min\(720px/);
assert.match(savedLibraryWorkspaceSource, /private createPromptCard\(\): string[\s\S]*?id="save-library-prompt"[\s\S]*?New Prompt/);
assert.match(savedLibraryWorkspaceSource, /return `\$\{this\.createPromptCard\(\)\}\$\{items\.map/);
const savedLibraryHeaderSource = savedLibraryWorkspaceSource.match(/<header class="workspace-intro">[\s\S]*?<\/header>/)?.[0] ?? '';
assert.doesNotMatch(savedLibraryHeaderSource, /saved-library-header-actions|save-library-mix|save-library-character/);
assert.doesNotMatch(savedLibraryWorkspaceSource, /save-library-empty/);
const savedLibraryRefreshSource = savedLibraryWorkspaceSource.match(/refresh\(_controller: WorkspaceController[\s\S]*?\n  route\(/)?.[0] ?? '';
assert.match(savedLibraryRefreshSource, /const present = new Set\(s\.items\.map/);
assert.match(savedLibraryRefreshSource, /else if \(!wanted\.has\(id\)\) node\.hidden = true/);
assert.match(savedLibraryRefreshSource, /const emptyState = this\.emptyState\(s\)/);
assert.match(savedLibraryRefreshSource, /title\.textContent = emptyState\.title/);
assert.match(savedLibraryRefreshSource, /copy\.textContent = emptyState\.copy/);
assert.doesNotMatch(savedLibraryRefreshSource, /replaceChildren\(/);
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
assert.doesNotMatch(uiSource, /v060-themes/, 'legacy v0.6 update-tour candidates are not part of the Studio Guide');
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
  for (const height of [360, 390, 420, 450]) for (const anchorCount of Array.from({ length: 13 }, (_, index) => index)) {
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
      if (anchorCount > 0) assert.equal(box.left >= anchor.left + anchor.width || anchor.left >= box.left + box.width || box.top >= anchor.top + anchor.height || anchor.top >= box.top + box.height, true);
      for (let other = index + 1; other < measured.placements.length; other += 1) {
        const peer = measured.placements[other].box;
        assert.equal(box.left + box.width <= peer.left || peer.left + peer.width <= box.left || box.top + box.height <= peer.top || peer.top + peer.height <= box.top, true);
      }
    }
  }
}
// A constrained multi-anchor reflow keeps the vertical anchor group while the
// companion cards use a readable compact silhouette or the emergency micro
// tier when that is the only collision-free fit.
const compactOrbitWidth = 895; // 980px window minus shell, stage border, and padding.
const compactOrbitHeight = 300; // Conservative stage row after controls and prompt output at 980x700.
const compactAnchor = { left: (compactOrbitWidth - 364) / 2, top: (compactOrbitHeight - 190) / 2, width: 364, height: 190 }; // 3 × 116px cards plus 2 × 8px gaps.
const compactSecondPass = mixOrbitLayout(9, 3, { width: compactOrbitWidth, height: compactOrbitHeight, companionWidth: 164, companionHeight: 198, anchorWidth: compactAnchor.width, anchorHeight: compactAnchor.height });
assert.ok(compactSecondPass.density === 'compact' || compactSecondPass.density === 'micro');
if (compactSecondPass.density === 'compact') {
  assert.ok(compactSecondPass.companionWidth >= 120 && compactSecondPass.companionHeight >= 145);
} else {
  assert.ok(compactSecondPass.companionWidth >= 88 && compactSecondPass.companionHeight >= 64);
}
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
assert.ok(fourAnchorSecondPass.density === 'compact' || fourAnchorSecondPass.density === 'micro');
if (fourAnchorSecondPass.density === 'compact') {
  assert.ok(fourAnchorSecondPass.companionWidth >= 120 && fourAnchorSecondPass.companionHeight >= 145);
} else {
  assert.ok(fourAnchorSecondPass.companionWidth >= 88 && fourAnchorSecondPass.companionHeight >= 64);
}
assert.equal(fourAnchorSecondPass.placements.length, mixCompanionCapacity(4));
for (let index = 0; index < fourAnchorSecondPass.placements.length; index += 1) {
  const box = fourAnchorSecondPass.placements[index].box;
  assert.ok(box.left >= 0 && box.top >= 0 && box.left + box.width <= compactOrbitWidth && box.top + box.height <= compactOrbitHeight);
  assert.equal(boxesOverlap(box, fourAnchor), false);
  for (const peer of fourAnchorSecondPass.placements.slice(index + 1)) assert.equal(boxesOverlap(box, peer.box), false);
}
// Dense 5..12-anchor groups reserve side lanes and remain contained at the
// narrow desktop orbit reported by geometry QA.
const narrowDenseOrbit = mixOrbitLayout(7, 5, { width: 688, height: 360, companionWidth: 154, companionHeight: 198, anchorWidth: 480, anchorHeight: 318 });
assert.equal(narrowDenseOrbit.placements.length, 7);
const narrowDenseAnchor = { left: (688 - 480) / 2, top: (360 - 318) / 2, width: 480, height: 318 };
assert.ok(narrowDenseAnchor.left >= 0 && narrowDenseAnchor.top >= 0 && narrowDenseAnchor.left + narrowDenseAnchor.width <= 688 && narrowDenseAnchor.top + narrowDenseAnchor.height <= 360);
for (const placement of narrowDenseOrbit.placements) {
  assert.ok(placement.box.left >= 0 && placement.box.top >= 0 && placement.box.left + placement.box.width <= 688 && placement.box.top + placement.box.height <= 360);
  assert.equal(boxesOverlap(placement.box, narrowDenseAnchor), false);
}
for (const anchorCount of Array.from({ length: 8 }, (_, index) => index + 5)) {
  const rows = Math.ceil(anchorCount / 5);
  const anchorHeight = rows * 102 + (rows - 1) * 6;
  const denseLayout = mixOrbitLayout(mixCompanionCapacity(anchorCount), anchorCount, { width: 688, height: 360, companionWidth: 154, companionHeight: 198, anchorWidth: 480, anchorHeight });
  assert.equal(denseLayout.placements.length, mixCompanionCapacity(anchorCount));
  assert.ok(anchorHeight <= 360);
}
assert.doesNotMatch(styleSource, /\.mix-stage \{[^}]*overflow: visible/);
assert.match(uiSource, /data-layout-ready="true"/);
assert.doesNotMatch(styleSource, /\.mix-orbit\[data-layout-ready="false"\] \.mix-orbit-slot \{ visibility: hidden; \}/);
assert.match(uiSource, /data-remove-library-character="\$\{escapeHtml\(character\.id\)\}"/);
assert.match(uiSource, /function removeLibraryCharacter\(characterId: string\)[\s\S]*?captureLibraryFormDraft\(\)[\s\S]*?filter\(character => character\.id !== characterId\)[\s\S]*?focus\(\{ preventScroll: true \}\)/);
assert.match(typesSource, /interface SavedCharacterData \{[\s\S]*?positive: string;[\s\S]*?negative: string;/);
assert.match(typesSource, /interface SavedCharacterItem extends SavedLibraryCommon[\s\S]*?kind: 'character'[\s\S]*?data: SavedCharacterData/);
assert.match(storageSource, /if \(source\.kind === 'character'\)[\s\S]*?normalizeSavedCharacterData\(source\.data\)[\s\S]*?return null/);
assert.match(savedLibraryWorkspaceSource, /\['character', 'Characters'\]/);
assert.match(savedLibraryWorkspaceSource, /item\.kind === 'character'[\s\S]*?Character details/);
assert.match(uiSource, /saved-library-character-positive/);
assert.match(uiSource, /saved-library-character-negative/);
assert.match(uiSource, /saved-library-kind-selector[\s\S]*?name="saved-library-kind"[\s\S]*?data-library-kind="prompt"[\s\S]*?data-library-kind="artist-mix"[\s\S]*?data-library-kind="character"/);
assert.match(uiSource, /const manualCreate = !editing && libraryFormSource === 'manual';/);
assert.match(uiSource, /input\.dataset\.libraryKind === 'artist-mix' \? 'save-mix' : input\.dataset\.libraryKind === 'character' \? 'save-character' : 'save-prompt'/);
assert.match(uiSource, /libraryFormScrollTop = 0;[\s\S]*?\[data-library-kind="\$\{input\.dataset\.libraryKind\}"\].*?focus/);
assert.match(uiSource, /function requestCharacterRemoval\(characterId: string[\s\S]*?saveSoon\(\)[\s\S]*?character-remove/);
assert.match(styleSource, /\.saved-library-character-remove \{[^}]*border-radius: 50%/);
assert.match(styleSource, /\.saved-library-character-remove:hover, \.saved-library-character-remove:focus-visible \{[^}]*background: var\(--danger\)/);
assert.match(styleSource, /\.saved-library-form-scroll \{[^}]*padding: 4px 10px 8px 6px;[^}]*scrollbar-gutter: stable/);
assert.match(styleSource, /\.saved-library-character-add \{[^}]*justify-self: start;[^}]*border-radius: 999px/);
assert.match(styleSource, /\.saved-library-empty \{[^}]*grid-column: 1 \/ -1/);
assert.match(styleSource, /\.saved-library-create-card \{[^}]*align-self: stretch/);
assert.match(styleSource, /\.saved-library-kind-segment input:checked \+ span/);
assert.match(styleSource, /\.saved-library-form-modal \.saved-library-modal-actions \{[^}]*border-top: 0;[^}]*background: transparent;[^}]*box-shadow: none/);
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
// V0.7 compact Artist Mix rail contracts: title, contiguous controls, and
// status remain one settings section while Mix artists lives in the stage.
const mixSettingsMarkup = uiSource.match(/<section class="mix-random-settings"[\s\S]*?<\/section><section class="mix-stage"/)?.[0] ?? '';
assert.match(mixSettingsMarkup, /class="mix-random-settings"[\s\S]*?class="mix-settings-title"[\s\S]*?class="mix-control-rail"[\s\S]*?class="mix-range-pair"[\s\S]*?id="mix-anchor-weights-lock"[\s\S]*?id="mix-favorites-only"[\s\S]*?id="mix-reroll-strength"[\s\S]*?id="\$\{focusMode \? 'exit-mix-focus' : 'enter-mix-focus'\}"/);
assert.match(mixSettingsMarkup, /class="mix-control-rail"[\s\S]*?<\/div>\$\{status\}<\/section><section class="mix-stage"/);
assert.doesNotMatch(mixSettingsMarkup, /id="mix-artists"/);
assert.doesNotMatch(uiSource, /mix-behavior-toggles|mix-actions/);
assert.equal((uiSource.match(/id="mix-artists"/g) ?? []).length, 1);
const mixStageHeading = uiSource.match(/<div class="mix-stage-heading">[\s\S]*?<\/div>\$\{mixOrbitMarkup\(\)\}/)?.[0] ?? '';
assert.match(mixStageHeading, /class="mix-stage-summary"[\s\S]*?class="[^\"]*mix-stage-primary-action[^"]*"[\s\S]*?id="mix-artists"[\s\S]*?class="mix-stage-tools"/);
assert.match(mixStageHeading, /id="mix-artists"[\s\S]*?\$\{mixTransitionActive \? 'Mixing artists\.\.\.' : 'Mix artists'\}/);
assert.match(mixStageHeading, /id="mix-artists"[^>]*\$\{mixTransitionActive \? 'disabled aria-busy="true"' : ''\}/);
assert.match(styleSource, /\.mix-random-settings > \.random-notice \{[^}]*grid-column: 1 \/ -1/);
assert.match(styleSource, /\.mix-control-rail \{[^}]*gap: 6px/);
assert.match(styleSource, /\.mix-control-rail > button \{[^}]*min-height: 36px/);
assert.match(styleSource, /\.mix-range-pair \{[^}]*min-height: 38px[^}]*border: 1px solid var\(--line-strong\)[^}]*border-radius: 11px/);
assert.match(styleSource, /\.mix-range-pair:hover, \.mix-range-pair:focus-within \{/);
assert.match(styleSource, /\.mix-range-end input\[type="range"\]::\-webkit-slider-runnable-track/);
assert.match(styleSource, /\.mix-range-end input\[type="range"\]::\-webkit-slider-thumb/);
assert.match(styleSource, /\.mix-range-end input\[type="range"\]::\-moz-range-track/);
assert.match(styleSource, /\.mix-range-end input\[type="range"\]::\-moz-range-thumb/);
assert.match(styleSource, /\.mix-stage-heading \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
assert.match(styleSource, /\.mix-stage-primary-action \{[^}]*justify-self: center[^}]*border-radius: 999px/);
const mixMediumMedia = styleSource.match(/@media \(min-width: 761px\) and \(max-width: 1179px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
assert.match(mixMediumMedia, /\.mix-random-settings \{ grid-template-columns: minmax\(0, 1fr\); \}/);
assert.match(mixMediumMedia, /\.mix-control-rail \{ justify-content: flex-start; flex-wrap: wrap; \}/);
assert.match(mixMediumMedia, /\.mix-stage-primary-action \{ grid-column: 1 \/ -1; grid-row: 2; \}/);
const mixNarrowMedia = [...styleSource.matchAll(/@media \(max-width: 760px\) \{[\s\S]*?\n\}/g)].map(match => match[0]).find(media => media.includes('.mix-control-rail > .mix-range-pair')) ?? '';
assert.match(mixNarrowMedia, /\.mix-control-rail > \.mix-range-pair \{ flex: 1 1 100%; width: 100%; min-width: 0; \}/);
assert.match(mixNarrowMedia, /\.mix-stage-heading \{ grid-template-columns: minmax\(0, 1fr\);/);
assert.doesNotMatch(styleSource, /\.mix-random-settings > \.mix-(?:behavior-toggles|actions)/);
assert.match(styleSource, /#prompt-panel > \.workspace-intro, \.prompt-two-column \{[^}]*width: min\(1340px, 100%\); margin: 0 auto;/);
assert.match(styleSource, /\.prompt-two-column \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.doesNotMatch(styleSource, /\.prompt-two-column \{[^}]*1\.12fr|\.prompt-two-column \{[^}]*\.88fr/);
assert.match(styleSource, /@media \(max-width: 760px\) \{[\s\S]*?\.prompt-two-column \{ display: block; \}/);
assert.match(styleSource, /@media \(max-width: 760px\) \{[\s\S]*?\.mix-random-settings \{ grid-template-columns: minmax\(0, 1fr\); \}/);
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
assert.match(uiSource, /syncMixWeightState\(\{ \.\.\.artistMix, anchors: artistMix\.anchors\.map\(update\), companions: artistMix\.companions\.map\(update\) \}, \[target\], button\)/);
assert.match(uiSource, /function commitArtistMix\(nextMix: ArtistMixDraft, notice = ''\)/);
assert.match(uiSource, /function syncMixWeightState\([\s\S]*?notice = ''/);
assert.match(uiSource, /function randomizeMix\(\)[\s\S]*?commitArtistMix\(nextMix\);/);
assert.doesNotMatch(uiSource, /Mixed \$\{|Rerolled (?:anchor|companion|companion strengths|anchor and companion)|Anchor added\. Its strength|Anchor replaced\. Its strength|Artist pinned as an anchor|Artist unpinned and returned/);
for (const warning of ['The V5 catalog is still loading\.', 'Choose an anchor artist first\.', 'Artist Mix supports up to 12 artists\.', 'Artist Mix always keeps one anchor\.', 'At least one anchor must stay pinned\.']) assert.match(uiSource, new RegExp(warning));
assert.match(uiSource, /class="mix-orbit-primary mix-anchor-group \$\{anchors\.length > 1 \? 'is-multi-anchor' : 'is-single-anchor'\}\$\{anchors\.length > 4 \? ' is-dense-anchor' : ''\}"/);
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
assert.match(styleSource, /\.mix-anchor-group\.is-multi-anchor[\s\S]*grid-template-rows: minmax\(24px, auto\) minmax\(26px, auto\)/);
assert.match(styleSource, /\.mix-orbit-primary\.mix-anchor-group\.is-multi-anchor \{ max-width: min\(560px, calc\(100% - 20px\)\); \}/);
assert.match(styleSource, /\.mix-anchor-group\.is-dense-anchor[\s\S]*grid-template-columns: repeat\(4, minmax\(120px, 1fr\)\)[\s\S]*width: min\(720px, calc\(100% - 24px\)\)/);
assert.match(styleSource, /\.mix-anchor-group\.is-dense-anchor \.selected-artist-image \{ height: 78px; min-height: 78px; \}/);
assert.doesNotMatch(styleSource.match(/\.mix-orbit\[data-layout-density="compact"\] \.mix-anchor-group\.is-multi-anchor[\s\S]*?\n\}/)?.[0] ?? '', /width: 96px|height: 64px/);
// V0.7 Artist Mix card controls: symmetric insets, a full first-row slider,
// bounded centered second-row controls, and local Reroll focus treatment.
const terminalMixControls = styleSource.match(/\/\* v0\.7\.0 Artist Mix controls\.[\s\S]*$/)?.[0] ?? '';
assert.match(terminalMixControls, /grid-template-columns: minmax\(0, 1fr\) 44px 54px minmax\(0, 1fr\)/);
assert.match(terminalMixControls, /grid-template-rows: 24px 26px/);
assert.match(terminalMixControls, /width: calc\(100% - 4px\);[\s\S]*max-width: calc\(100% - 4px\)/);
assert.match(terminalMixControls, /input\[type="range"\][\s\S]*?grid-column: 1 \/ -1[\s\S]*?width: 100%/);
assert.match(terminalMixControls, /input\[type="number"\][\s\S]*?width: 44px;[\s\S]*?min-width: 44px;[\s\S]*?max-width: 44px/);
assert.match(terminalMixControls, /\.reroll-weight[\s\S]*?width: 54px;[\s\S]*?min-width: 54px;[\s\S]*?max-width: 54px/);
assert.match(terminalMixControls, /\.weight-controls :is\(input, button\):focus-visible[\s\S]*?outline: none;[\s\S]*?outline-offset: 0;[\s\S]*?box-shadow: inset 0 0 0 2px var\(--focus-ring\)/);
const rangeFocusSelector = '.mix-artist-card .weight-controls input[type="range"]:focus-visible';
const legacyRangeFocus = styleSource.indexOf(rangeFocusSelector);
const terminalRangeFocus = styleSource.lastIndexOf(rangeFocusSelector);
assert.ok(legacyRangeFocus >= 0 && terminalRangeFocus > legacyRangeFocus, 'terminal range focus rule must follow the higher-specificity legacy rule');
const terminalRangeFocusRule = styleSource.slice(terminalRangeFocus, styleSource.indexOf('}', terminalRangeFocus) + 1);
assert.match(terminalRangeFocusRule, /outline: none;[\s\S]*?outline-offset: 0;[\s\S]*?box-shadow: inset 0 0 0 2px var\(--focus-ring\)/);
assert.match(terminalMixControls, /\.mix-artist-card:has\(\.weight-controls :focus\):not\(:hover\) \{ transform: none; \}/);
assert.match(terminalMixControls, /\.mix-orbit-slot \.mix-artist-card:has\(\.weight-controls :focus\):not\(:hover\)[\s\S]*?border-color: var\(--line\)[\s\S]*?box-shadow: none/);
assert.match(terminalMixControls, /\.mix-orbit-primary \.mix-artist-card:has\(\.weight-controls :focus\):not\(:hover\)[\s\S]*?border-color: var\(--accent-bright\)[\s\S]*?box-shadow:/);
assert.match(terminalMixControls, /\.mix-orbit-slot \.mix-artist-card[\s\S]*?width: var\(--mix-companion-width, 164px\);[\s\S]*?height: var\(--mix-companion-height, 198px\)/);
assert.match(terminalMixControls, /data-layout-density="compact"[\s\S]*?width: var\(--mix-companion-width, 124px\);[\s\S]*?height: var\(--mix-companion-height, 152px\)/);
assert.match(terminalMixControls, /data-layout-density="micro"[\s\S]*?width: var\(--mix-companion-width, 88px\);[\s\S]*?height: var\(--mix-companion-height, 64px\)/);
assert.match(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /Eight interface themes/);
assert.equal(packageSource.version, '0.7.0');
assert.equal(lockSource.version, packageSource.version);
assert.equal(lockSource.packages[''].version, packageSource.version);
assert.match(installerBuildSource, /nsis-template-override\.cjs'\)\.replaceAll\('\\\\', '\/'\)/);
assert.match(installerBuildSource, /--require="\$\{nsisTemplateOverride\}"/);
console.log('library-mix-static tests passed.');

import './styles.css';
import { DEFAULT_CUSTOM_TAG_PRESET_ID, DEFAULT_CUSTOM_TAG_PRESET_NAME } from './custom-tag-presets.ts';
import { bindArtistCardPreview, clearArtistCardPreview } from './artist-card-preview';
import { artistDisplayName, canonicalArtistIdentity, customArtistCatalogId, mergeArtistCatalog, migrateArtistAliases, migrateArtistMixAliases, migrateFavoriteAliases } from './artist-catalog';
import { mixCompanionCapacity, mixCompanionScale, mixOrbitLayout } from './artist-mix-layout';
import { paginateArtists, paginateCharacters } from './catalog-browser';
import { MetadataWorkspace, type MetadataSaveKind, type MetadataSavePayload } from './metadata-workspace';
import { decodePreviews } from './preview-loader';
import { buildArtistsPrompt, buildBasePrompt, buildCharacterPrompt, serializeTag } from './prompt';
import { normalizeArtistWeight, randomArtistSelection, randomCount, reconcileSelectedArtists, rerollArtistWeight, rerollArtistWeights, resolveRandomPoolRange } from './random';
import { canonicalCustomTagIdentity, classifyGuideEntries, constructorCardTags, hasPromptTagGroup, mergeConstructorCards, qualityPresetTags, splitTagGroup, togglePromptTagGroup, type ConstructorCard, type ConstructorZone } from './prompt-constructor';
import { deleteLibraryImage, hasExistingProfile, loadArtistMix, loadCustomTagPresets, loadCustomTags, loadDraft, loadFavorites, loadSavedLibrary, loadSettings, loadSets, normalizeAnimationMode, normalizeArtistMix, normalizeCustomTagPresets, saveArtistMix, saveCustomTagPresets, saveCustomTags, saveDraft, saveFavorites, saveSavedLibrary, saveSettings, saveSets, saveLibraryImage } from './storage';
import type { AnimationMode, AppSettings, ArtistMixDraft, BasePrompt, CatalogCard, Character, CustomTag, CustomTagKind, CustomTagPreset, GuideExample, OfflineCatalog, PromptDraft, PromptSet, SavedArtistMixData, SavedLibraryItem, SavedPromptData, SavedPromptSnapshot, WeightedTag } from './types';
import type { UpdateManifest, UpdateProgress } from './global';

type Zone = 'frame' | 'scene' | 'render' | 'undesired';
type Modal = 'artists' | 'characters' | 'character-details' | 'constructor' | 'saved-library' | null;

const FALLBACK_TAGS = ['girl', 'boy', '1girl', '1boy', 'masterpiece', 'best quality', 'upper body', 'full body', 'looking at viewer'];
const DEFAULT_RANGE = { min: 2, max: 5 };
const APP_VERSION = '0.6.0';
const accordionOpenState: Record<Zone, boolean> = { frame: true, scene: true, render: true, undesired: false };
const existingProfileAtStartup = hasExistingProfile();
const restored = loadDraft();
let base: BasePrompt = restored?.base ?? emptyBase();
let characters: Character[] = restored?.characters ?? [];
let randomRange = normalizeRange(restored?.randomRange);
let settings: AppSettings = loadSettings(restored?.animationMode);
let animationMode: AnimationMode = normalizeAnimationMode(settings.animationMode);
let artistMix: ArtistMixDraft = loadArtistMix();
let sets: PromptSet[] = loadSets();
let savedLibrary: SavedLibraryItem[] = loadSavedLibrary();
let artistFavorites = loadFavorites('artists');
let characterFavorites = loadFavorites('characters');
let catalog: OfflineCatalog = emptyCatalog();
let officialArtists: CatalogCard[] = [];
let artistCatalogAliases = new Map<string, string>();
let shadowedCustomArtistIds = new Set<string>();
let artistSearch = '';
let artistPage = 1;
let mixArtistPage = 1;
let characterSearch = '';
let characterPage = 1;
let artistFavoritesOnly = false;
let artistRandomFavoritesOnly = false;
let favoriteRandomRange: { min: number; max: number } | null = null;
let characterFavoritesOnly = false;
let catalogState: 'loading' | 'ready' | 'error' = 'loading';
let catalogError = '';
let randomNotice = '';
let mixNotice = '';
let modal: Modal = null;
let detailCharacterId: string | null = null;
let artistPickerTrigger: HTMLElement | null = null;
let mixPickerTrigger: HTMLElement | null = null;
let characterPickerTrigger: HTMLElement | null = null;
let modalKeyHandlerBound = false;
let draftTimer: number | undefined;
let activeWorkspace: 'prompt' | 'artist-mix' | 'saved-library' | 'custom-tags' | 'metadata' | 'settings' = 'prompt';
let pendingWorkspaceTransition: 'prompt' | 'artist-mix' | 'saved-library' | 'custom-tags' | 'metadata' | 'settings' | null = null;
// Legacy compatibility marker: let pendingWorkspaceTransition: 'prompt' | 'custom-tags' | 'metadata' | null = null;
let focusMode = false;
let startupEntryPending = false;
let startupVisible = true;
let startupPhase = 'Loading catalog';
let startupCompleted = 0;
let startupTotal = 0;
let startupFailures: string[] = [];
let startupFailedCards: CatalogCard[] = [];
let startupBusy = false;
let startupReady = false;
let startupError = '';
let catalogUpdateUnsubscribe: (() => void) | null = null;
let catalogUpdateBusy = false;
let catalogUpdateStatus = '';
let catalogUpdateError = '';
type AppUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'installing' | 'up-to-date' | 'error';
let appUpdatePhase: AppUpdatePhase = 'idle';
let appUpdateManifest: UpdateManifest | null = null;
let appUpdateProgress: UpdateProgress = { phase: 'starting', completed: 0, total: 0, percent: 0, attempt: 0 };
let appUpdateMessage = '';
let appUpdateUnsubscribe: (() => void) | null = null;
let onboardingOpen = false;
let onboardingSteps: Array<{ id: string; title: string; copy: string }> = [];
let onboardingIndex = 0;
let mixThreadFrame: number | undefined;
let mixPickerMode: 'primary' | 'companion' = 'primary';
let constructorZone: ConstructorZone | null = null;
let constructorTrigger: HTMLElement | null = null;
let constructorSearch = '';
let guideCards: ConstructorCard[] = [];
let guideState: 'loading' | 'ready' | 'error' = 'loading';
let customTagPresets: CustomTagPreset[] = loadCustomTagPresets();
let customTags: CustomTag[] = loadCustomTags();
let selectedCustomPresetId = DEFAULT_CUSTOM_TAG_PRESET_ID;
let customTagSearch = '';
let customTagFilter: ConstructorZone | 'artist' | 'all' = 'all';
let customTagFormKind: CustomTagKind = 'tag';
let editingCustomTagId: string | null = null;
let creatingCustomPreset = false;
let renamingCustomPresetId: string | null = null;
let deletingCustomPresetId: string | null = null;
let customImageBytes: Uint8Array | null = null;
let customImageMime: CustomTag['mime'] | null = null;
let customImageName = '';
const customImageUrls = new Map<string, string>();
const savedLibraryImageUrls = new Map<string, string>();
let savedLibrarySearch = '';
let savedLibraryFilter: 'all' | 'prompt' | 'artist-mix' = 'all';
let libraryModalMode: 'save-prompt' | 'save-mix' | 'edit' | 'delete' | null = null;
let libraryModalItemId: string | null = null;
let libraryCoverBytes: Uint8Array | null = null;
let libraryCoverMime: SavedLibraryItem['mime'] = undefined;
let libraryCoverName = '';
let libraryCoverError = '';
let libraryCoverRemoved = false;
let libraryFormSource: SavedLibraryItem['source'] = 'manual';
let libraryFormName = '';
let libraryFormDescription = '';
let libraryFormPrompt: SavedPromptData = { positive: '', negative: '', characters: [] };
let libraryFormMix: SavedArtistMixData = { artists: [], serializedPrompt: '' };
let libraryFormScrollTop = 0;
const libraryPolarities = new Map<string, { base: 'positive' | 'negative'; characters: Array<'positive' | 'negative'> }>();
// Legacy compatibility marker: new MetadataWorkspace(() => catalog.artists)
const metadataWorkspace = new MetadataWorkspace(() => catalog.artists, card => catalogImage(card), saveMetadataToLibrary);

function revokeCustomImageUrl(key: string): void {
  const url = customImageUrls.get(key);
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  customImageUrls.delete(key);
}

function setCustomImageUrl(key: string, url: string): void {
  revokeCustomImageUrl(key);
  customImageUrls.set(key, url);
}

function clearDraftCustomImage(): void { revokeCustomImageUrl('__draft__'); }

function revokeSavedLibraryImageUrl(key: string): void {
  const url = savedLibraryImageUrls.get(key);
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  savedLibraryImageUrls.delete(key);
}

function libraryImageUrl(item: SavedLibraryItem): string {
  if (!item.imageAsset) return '';
  if (/^(?:nai-library|blob|data):\/\//i.test(item.imageAsset)) return item.imageAsset;
  return `nai-library://asset/${encodeURIComponent(item.imageAsset)}`;
}

function currentSavedPromptSnapshot(): SavedPromptSnapshot {
  return { version: 2, base: JSON.parse(JSON.stringify(base)), characters: JSON.parse(JSON.stringify(characters)), randomRange: { ...normalizeRange(randomRange) } };
}

function currentSavedMixSnapshot(): ArtistMixDraft { return JSON.parse(JSON.stringify(normalizeArtistMix(artistMix))) as ArtistMixDraft; }

function id(): string {
  try { return crypto.randomUUID(); } catch { return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function emptyBase(): BasePrompt {
  return { frame: '1girl, upper body, looking at viewer', artists: [], setting: 'indoors, soft lighting', render: 'anime coloring, masterpiece, best quality', undesired: '' };
}

function emptyCatalog(): OfflineCatalog { return { version: 2, catalogId: 'nai-v5', artists: [], characters: [], tags: FALLBACK_TAGS }; }
function normalizeRange(value?: { min: number; max: number }, available = 0): { min: number; max: number } {
  const requestedMin = Number(value?.min);
  const requestedMax = Number(value?.max);
  const fallbackMin = Number.isFinite(requestedMin) ? Math.round(requestedMin) : DEFAULT_RANGE.min;
  const fallbackMax = Number.isFinite(requestedMax) ? Math.round(requestedMax) : DEFAULT_RANGE.max;
  // Before the offline catalog is loaded, retain a restored range so that a
  // valid user choice is not lost. Once loaded, the catalog length is the cap.
  const upper = available > 0
    ? Math.max(1, Math.floor(available))
    : Math.max(DEFAULT_RANGE.max, fallbackMin, fallbackMax);
  const lower = Math.min(2, upper);
  const min = Math.max(lower, Math.min(upper, fallbackMin));
  const max = Math.max(min, Math.min(upper, fallbackMax));
  return { min, max };
}
function activeRandomPool(): CatalogCard[] {
  return artistRandomFavoritesOnly ? catalog.artists.filter(card => artistFavorites.has(card.catalogId ?? card.id)) : catalog.artists;
}
function effectiveRandomRange() {
  const requested = artistRandomFavoritesOnly ? (favoriteRandomRange ?? randomRange) : randomRange;
  return resolveRandomPoolRange(requested, activeRandomPool().length);
}
function escapeHtml(value: string): string { return value.replace(/[\u2014\u2013]/g, '-').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]!)); }
function clean(value: string): string { return value.trim().replace(/^,|,$/g, '').trim(); }
function resolvedCatalogPath(path: string): string {
  if (/^(?:nai-custom|nai-catalog):\/\//i.test(path) || /^(?:blob:|data:)/i.test(path) || /^(?:\.\/|\/)/.test(path)) return path;
  return `./catalog/${escapeHtml(path)}`;
}
function catalogImage(card: CatalogCard): string {
  const path = String(card.image || '');
  if (!path) return './plus.png';
  if (/^(?:nai-custom|nai-catalog):\/\//i.test(path) || /^(?:blob:|data:)/i.test(path) || /^(?:\.\/|\/)/.test(path)) return path;
  return card.runtime ? `nai-catalog://asset/${encodeURI(path).replace(/#/g, '%23')}` : resolvedCatalogPath(path);
}
function artistImage(item: WeightedTag): string {
  const card = catalog.artists.find(candidate => (candidate.catalogId ?? candidate.id) === (item.catalogId ?? item.id));
  return card ? catalogImage(card) : resolvedCatalogPath(String(item.image ?? './plus.png'));
}
function weighted(card: CatalogCard, weight = 1): WeightedTag { return { id: id(), catalogId: card.catalogId ?? card.id, image: card.image, tag: `artist: ${card.tag}`, weight: normalizeArtistWeight(weight) }; }
function newCharacter(label = `Character ${characters.length + 1}`, prompt = 'girl'): Character { return { id: id(), label, prompt, undesired: '' }; }
function prompt(): string { return buildBasePrompt(base); }

function applyAnimationMode(mode: AnimationMode): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.animationMode = mode;
}
function applyTheme(): void { document.documentElement.dataset.theme = settings.theme; }
const studioThemes: Array<{ id: AppSettings['theme']; label: string }> = [
  { id: 'arcane-gold', label: 'Arcane Gold' }, { id: 'midnight-blue', label: 'Midnight Blue' }, { id: 'raspberry-rose', label: 'Raspberry Rose' }, { id: 'noir', label: 'Noir' },
  { id: 'celestial-light', label: 'Celestial Light' }, { id: 'ember-peach', label: 'Ember Peach' }, { id: 'gothic-ivory', label: 'Gothic' }
];
function themeOptions(): string { return studioThemes.map(theme => `<option value="${theme.id}"${settings.theme === theme.id ? ' selected' : ''}>${theme.label}</option>`).join(''); }
function onboardingMarkup(): string {
  if (!onboardingOpen || !onboardingSteps.length) return '';
  const step = onboardingSteps[onboardingIndex];
  const isThemeStep = step.id === 'v060-themes';
  const chooser = isThemeStep ? `<div class="onboarding-theme-choices" role="group" aria-label="Choose a studio theme">${studioThemes.map(theme => `<button type="button" class="theme-swatch ${settings.theme === theme.id ? 'selected' : ''}" data-guide-theme="${theme.id}" aria-pressed="${settings.theme === theme.id}"><i data-theme-swatch="${theme.id}"></i>${theme.label}</button>`).join('')}</div>` : '';
  return `<div class="modal-backdrop onboarding-backdrop"><section class="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="guide-title"><p class="eyebrow">STUDIO GUIDE ${onboardingIndex + 1} / ${onboardingSteps.length}</p><h2 id="guide-title">${escapeHtml(step.title)}</h2><p>${escapeHtml(step.copy)}</p>${chooser}<div class="onboarding-actions"><button class="secondary" id="guide-skip" type="button">Skip guide</button><button class="primary" id="guide-next" type="button">${onboardingIndex + 1 === onboardingSteps.length ? 'Open studio' : 'Next'}</button></div></section></div>`;
}
function startGuide(replay = false): void {
  const overview = [
    { id: 'overview-prompt', title: 'Prompt Builder', copy: 'Build frame, scene, render, artist and character prompt blocks in one workspace.' },
    { id: 'overview-mix', title: 'Artist Mix', copy: 'Pin up to four anchor artists, then remix companions without changing your anchors.' },
    { id: 'overview-saved-library', title: 'Saved Library', copy: 'Create independent prompt and Artist Mix records, then edit or copy them from one library.' },
    { id: 'overview-custom', title: 'Custom Tags', copy: 'Create personal prompt cards and artist cards with images and notes.' },
    { id: 'overview-metadata', title: 'Image Metadata', copy: 'Drop a PNG or WebP image to inspect and copy its NovelAI generation data.' },
    { id: 'overview-settings', title: 'Settings', copy: 'Choose a theme, control motion and manage catalog or application updates.' }
  ];
  const update = [{ id: 'v040-mix-anchors', title: 'Multiple Artist Mix anchors', copy: 'Pin companion cards as anchors. Mix and global rerolls preserve every pinned artist.' }, { id: 'v040-theme-updates', title: 'Themes and updates', copy: 'Settings includes studio themes, catalog refresh controls and secure GitHub update checks.' }, { id: 'v050-saved-library', title: 'Saved Library', copy: 'Save complete prompt and Artist Mix records, then edit or copy them from one library.' }, { id: 'v060-themes', title: 'Seven studio themes', copy: 'Choose a theme now. Your selection applies immediately and stays on this device.' }];
  const candidates = replay || !existingProfileAtStartup ? overview : update;
  onboardingSteps = replay ? candidates : candidates.filter(step => !settings.seenGuideIds.includes(step.id));
  onboardingIndex = 0; onboardingOpen = onboardingSteps.length > 0;
  if (!replay && !onboardingOpen) { settings = { ...settings, lastSeenVersion: APP_VERSION }; saveSettings(settings); }
}
function finishGuide(): void { settings = { ...settings, seenGuideIds: [...new Set([...settings.seenGuideIds, ...onboardingSteps.map(step => step.id)])], lastSeenVersion: APP_VERSION }; saveSettings(settings); onboardingOpen = false; render(); }

function commitArtistMix(nextMix: ArtistMixDraft, notice: string): void {
  artistMix = nextMix;
  mixNotice = notice;
  saveArtistMixSoon();
  clearArtistCardPreview();
  render();
}

function currentDraft(): PromptDraft {
  return { version: 2, base, characters, randomRange, animationMode };
}

function saveSoon(): void {
  if (draftTimer) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    saveDraft(currentDraft());
    draftTimer = undefined;
  }, 180);
}

function animationModeMarkup(): string {
  return `<label class="animation-setting" for="animation-mode"><span id="animation-mode-label">Animations</span><select id="animation-mode" aria-labelledby="animation-mode-label"><option value="auto"${animationMode === 'auto' ? ' selected' : ''}>Auto</option><option value="on"${animationMode === 'on' ? ' selected' : ''}>On</option><option value="off"${animationMode === 'off' ? ' selected' : ''}>Off</option></select></label>`;
}
function settingsAnimationModeMarkup(): string { return animationModeMarkup(); }

function editor(kind: 'base' | 'character' | 'undesired', key: string, value: string, label: string, placeholder: string): string {
  return `<label class="field"><span>${label}</span><textarea data-editor="${kind}" data-editor-id="${key}" placeholder="${placeholder}" spellcheck="false">${escapeHtml(value)}</textarea><div class="suggestions" data-suggestions="${kind}:${key}"></div></label>`;
}

function manualEditor(zone: ConstructorZone, key: string, value: string, label: string, placeholder: string): string {
  const editorId = `editor-base-${key}`;
  return `<div class="manual-editor"><div class="prompt-editor-toolbar"><label class="prompt-editor-label" for="${editorId}">${label}</label>${constructorButton(zone)}</div><textarea id="${editorId}" data-editor="base" data-editor-id="${key}" placeholder="${placeholder}" spellcheck="false">${escapeHtml(value)}</textarea><div class="suggestions" data-suggestions="base:${key}"></div></div>`;
}

function constructorButton(zone: ConstructorZone): string {
  const labels: Record<ConstructorZone, string> = { frame: 'Browse frame tags', scene: 'Browse scene tags', render: 'Browse render tags' };
  return `<button class="secondary constructor-open" type="button" data-open-constructor="${zone}" aria-label="${labels[zone]}">✦ ${labels[zone]}</button>`;
}

function zoneDetails(): string {
  return `<aside class="zone zone-left" aria-label="Prompt sections">
    <div class="full-prompt"><div><span>FULL PROMPT</span><small>frame, artists, scene, render</small></div><code id="full-prompt-output">${escapeHtml(prompt())}</code><div class="full-prompt-actions"><button class="primary" id="copy-prompt" type="button">Copy prompt</button><button class="secondary" id="save-prompt-library" type="button">Save prompt</button></div></div>
    <details class="accordion" data-zone="frame"${accordionOpenState.frame ? ' open' : ''}><summary><span class="zone-number">01</span><span><b>Frame</b><small>Composition, shot, viewpoint</small></span></summary>${manualEditor('frame', 'frame', base.frame, 'Frame & composition', '1girl, upper body, looking at viewer')}</details>
    <details class="accordion" data-zone="scene"${accordionOpenState.scene ? ' open' : ''}><summary><span class="zone-number">02</span><span><b>Scene</b><small>Setting, light, atmosphere</small></span></summary>${manualEditor('scene', 'setting', base.setting, 'Scene & lighting', 'indoors, soft lighting')}</details>
    <details class="accordion" data-zone="render"${accordionOpenState.render ? ' open' : ''}><summary><span class="zone-number">03</span><span><b>Render / Quality</b><small>Medium, shading, quality</small></span></summary>${manualEditor('render', 'render', base.render, 'Render & quality', 'anime coloring, masterpiece, best quality')}</details>
    <details class="accordion" data-zone="undesired"${accordionOpenState.undesired ? ' open' : ''}><summary><span class="zone-number">UC</span><span><b>Undesired</b><small>Kept separate from base copy</small></span></summary>${editor('base', 'undesired', base.undesired, 'Undesired content', 'watermark, blurry, bad anatomy')}</details>
  </aside>`;
}

function selectedArtistMarkup(item: WeightedTag): string {
  const value = normalizeArtistWeight(item.weight);
  const image = item.image ? artistImage(item) : './plus.png';
  const previewPrompt = serializeTag(item) ?? item.tag;
  return `<article class="selected-artist" data-selected-artist="${escapeHtml(item.id)}" data-artist-preview-image="${image}" data-artist-preview-tag="${escapeHtml(item.tag)}" data-artist-preview-prompt="${escapeHtml(previewPrompt)}"><div class="selected-artist-image"><img src="${image}" alt="${escapeHtml(item.tag)}" loading="lazy"></div><div class="selected-artist-copy"><b>${escapeHtml(item.tag)}</b><code>${escapeHtml(previewPrompt)}</code><small>V5 artist</small><div class="weight-controls"><input type="range" min="0.1" max="2" step="0.1" value="${value.toFixed(1)}" data-artist-range="${escapeHtml(item.id)}" aria-label="Weight for ${escapeHtml(item.tag)}"><span class="number-stepper"><input type="number" min="0.1" max="2" step="0.1" value="${value.toFixed(1)}" data-artist-weight="${escapeHtml(item.id)}" aria-label="Numeric weight for ${escapeHtml(item.tag)}"><span class="number-stepper-buttons"><button type="button" data-number-step="up" aria-label="Increase weight for ${escapeHtml(item.tag)}" title="Increase weight">▲</button><button type="button" data-number-step="down" aria-label="Decrease weight for ${escapeHtml(item.tag)}" title="Decrease weight">▼</button></span></span><button class="tiny-copy reroll-weight" type="button" data-reroll-weight="${escapeHtml(item.id)}" aria-label="Reroll weight for ${escapeHtml(item.tag)}">Reroll</button></div></div><button class="icon-button" data-remove-artist="${escapeHtml(item.id)}" aria-label="Remove artist">×</button></article>`;
}

function artistCard(card: CatalogCard): string {
  const stableId = card.catalogId ?? card.id;
  const selected = base.artists.some(item => item.catalogId === stableId);
  const favorite = artistFavorites.has(stableId);
  const image = catalogImage(card);
  const promptText = `artist: ${card.tag}`;
  return `<article class="artist-card ${selected ? 'selected' : ''}"><button class="artist-pick" data-add-artist="${escapeHtml(stableId)}" data-artist-preview-image="${image}" data-artist-preview-tag="${escapeHtml(card.tag)}" data-artist-preview-prompt="${escapeHtml(promptText)}" ${selected ? 'aria-pressed="true"' : ''}><span class="card-image"><img src="${image}" alt="${escapeHtml(card.tag)}" loading="lazy"><img src="./plus.png" alt="" class="plus-overlay"></span><b>${escapeHtml(card.tag)}</b></button><div class="artist-card-actions"><button class="favorite-button ${favorite ? 'is-favorite' : ''}" data-favorite-artist="${escapeHtml(stableId)}" aria-label="${favorite ? 'Remove favorite' : 'Add favorite'}">★</button><button class="tiny-copy" data-copy-artist="${escapeHtml(stableId)}">Copy</button></div></article>`;
}

function promptArtistPickerPage(): ReturnType<typeof paginateArtists> {
  const page = paginateArtists(catalog.artists, { query: artistSearch, favoritesOnly: artistFavoritesOnly, favoriteIds: artistFavorites, page: artistPage });
  artistPage = page.page;
  return page;
}

function currentMixArtistPickerPage(): ReturnType<typeof paginateArtists> {
  const useFavorites = mixPickerMode === 'companion' && artistMix.favoritesOnly;
  const page = paginateArtists(catalog.artists, { query: artistSearch, favoritesOnly: useFavorites, favoriteIds: artistFavorites, page: mixArtistPage });
  mixArtistPage = page.page;
  return page;
}

function catalogStatusMarkup(): string {
  if (catalogState === 'loading') return '<p class="catalog-status loading" role="status" aria-live="polite"><span class="status-skeleton"></span>Loading the offline V5 card index...</p>';
  if (catalogState === 'error') return `<p class="catalog-status error" role="alert">${escapeHtml(catalogError || 'The offline V5 catalog could not be loaded.')} <button class="tiny-copy" id="retry-catalog" type="button">Retry</button></p>`;
  if (!catalog.artists.length) return '<p class="catalog-status empty" role="status">No V5 artist cards are available in this snapshot.</p>';
  return '';
}

function artistZone(): string {
  const activeRange = effectiveRandomRange();
  const rangeDisabled = !activeRange.feasible || catalogState !== 'ready';
  const controlMin = activeRange.feasible ? 2 : activeRange.min;
  const controlMax = activeRange.feasible ? activeRange.available : activeRange.max;
  const stepper = (idValue: string, value: number, label: string): string => `<span class="number-stepper"><input id="${idValue}" type="number" min="${controlMin}" max="${controlMax}" value="${value}" aria-label="${label} numeric" ${rangeDisabled ? 'disabled' : ''}><span class="number-stepper-buttons"><button type="button" data-number-step="up" aria-label="Increase ${label.toLocaleLowerCase()}" title="Increase">▲</button><button type="button" data-number-step="down" aria-label="Decrease ${label.toLocaleLowerCase()}" title="Decrease">▼</button></span></span>`;
  const rangeMarkup = `<div class="range-pair" aria-label="Random artist count"><input id="random-min-range" type="range" min="${controlMin}" max="${controlMax}" step="1" value="${activeRange.min}" aria-label="Random minimum" ${rangeDisabled ? 'disabled' : ''}>${stepper('random-min', activeRange.min, 'Random minimum')}<span>to</span><input id="random-max-range" type="range" min="${controlMin}" max="${controlMax}" step="1" value="${activeRange.max}" aria-label="Random maximum" ${rangeDisabled ? 'disabled' : ''}>${stepper('random-max', activeRange.max, 'Random maximum')}</div>`;
  const favoritePoolLabel = artistRandomFavoritesOnly ? `Favorites pool (${activeRange.available})` : 'Full V5 pool';
  const rangeNotice = !activeRange.feasible ? `<p class="random-notice" role="status" aria-live="polite">${artistRandomFavoritesOnly ? 'Favorites-only random needs at least 2 favorited V5 artists.' : 'Random replacement needs at least 2 V5 artist cards.'} Use the picker to add favorites or turn off Favorites-only.</p>` : '';
  return `<section class="zone zone-center" aria-label="V5 artist selection"><div class="zone-heading"><div><p class="eyebrow">V5 ARTISTS</p><h2>Artist cards</h2><p>Open the picker from the plus card, then adjust each selected artist.</p></div><div class="range-control"><label>Random replacement</label>${rangeMarkup}<div class="random-actions"><button class="secondary" id="random-artists">Replace cards</button><button class="chip ${artistRandomFavoritesOnly ? 'on' : ''}" id="random-favorites-only" type="button" aria-pressed="${artistRandomFavoritesOnly}">★ ${escapeHtml(favoritePoolLabel)}</button></div></div></div>${catalogStatusMarkup()}${rangeNotice}<p class="random-notice" id="random-notice" role="status" aria-live="polite" ${randomNotice ? '' : 'hidden'}>${escapeHtml(randomNotice)}</p><div class="live-prompt"><div><span>LIVE PROMPT</span><small>selected V5 artist weights</small></div><code id="artist-prompt-output">${escapeHtml(buildArtistsPrompt(base.artists))}</code></div><div class="selected-artists"><div class="subheading"><h3>Selected artists <span>${base.artists.length}</span></h3><div><button class="secondary" id="open-artist-picker">＋ Add artist</button><button class="secondary" id="copy-artists">Copy artists</button><button class="secondary reroll-action" id="reroll-all-weights" type="button">Reroll all weights</button></div></div><div class="selected-artist-grid">${base.artists.map(selectedArtistMarkup).join('')}<button class="empty-artist-card" id="open-artist-picker-empty" aria-label="Open artist picker"><img src="./plus.png" alt=""><b>Add V5 artist</b><small>Open searchable picker</small></button></div></div></section>`;
}

function mixArtists(): WeightedTag[] { return [...artistMix.anchors, ...artistMix.companions]; }
function mixPool(): CatalogCard[] {
  const anchorIds = new Set(artistMix.anchors.map(item => item.catalogId ?? item.id));
  return catalog.artists.filter(card => {
    const stableId = card.catalogId ?? card.id;
    return !anchorIds.has(stableId) && (!artistMix.favoritesOnly || artistFavorites.has(stableId));
  });
}
function reconcileArtistMix(value: ArtistMixDraft): ArtistMixDraft {
  const byId = new Map(catalog.artists.map(card => [card.catalogId ?? card.id, card]));
  const refresh = (item: WeightedTag): WeightedTag => {
    const card = byId.get(item.catalogId ?? item.id);
    return card ? { ...item, catalogId: card.catalogId ?? card.id, image: card.image, tag: `artist: ${card.tag}` } : item;
  };
  const anchors = value.anchors.map(refresh).slice(0, 4);
  const seen = new Set(anchors.map(item => item.catalogId ?? item.id));
  const companions = value.companions.map(refresh).filter((item): item is WeightedTag => Boolean(item && item.catalogId && !seen.has(item.catalogId) && seen.add(item.catalogId)));
  if (!anchors.length && companions.length) anchors.push(companions.shift()!);
  return { ...value, anchors, companions: companions.slice(0, mixCompanionCapacity(anchors.length)), randomRange: normalizeRange(value.randomRange, 12) };
}
function mixArtistCardMarkup(item: WeightedTag, anchor: boolean): string {
  const value = normalizeArtistWeight(item.weight);
  const image = artistImage(item);
  const label = item.tag.replace(/^artist:\s*/i, '');
  return `<article class="selected-artist mix-artist-card ${anchor ? 'mix-primary' : ''}" data-mix-artist="${escapeHtml(item.id)}" data-artist-preview-image="${image}" data-artist-preview-tag="${escapeHtml(label)}" data-artist-preview-prompt="${escapeHtml(serializeTag(item) ?? item.tag)}"><div class="selected-artist-image"><img src="${image}" alt="${escapeHtml(label)}" loading="lazy"></div><div class="selected-artist-copy"><small>${anchor ? 'ANCHOR ARTIST' : 'COMPANION ARTIST'}</small><b>${escapeHtml(label)}</b><div class="weight-controls"><input type="range" min="0.1" max="2" step="0.1" value="${value.toFixed(1)}" data-mix-weight-range="${escapeHtml(item.id)}" aria-label="Weight for ${escapeHtml(label)}"><input class="mix-weight-number" type="number" min="0.1" max="2" step="0.1" value="${value.toFixed(1)}" data-mix-weight="${escapeHtml(item.id)}" aria-label="Numeric weight for ${escapeHtml(label)}"><button class="tiny-copy reroll-weight" type="button" data-mix-reroll="${escapeHtml(item.id)}" aria-label="Reroll weight for ${escapeHtml(label)}">Reroll</button></div></div>${!anchor || artistMix.anchors.length > 1 ? `<button class="mix-pin ${anchor ? 'is-pinned' : ''}" type="button" data-mix-pin="${escapeHtml(item.id)}" aria-pressed="${anchor}" aria-label="${anchor ? 'Unpin' : 'Pin'} ${escapeHtml(label)}">${anchor ? '◆' : '◇'}</button>` : ''}<button class="icon-button" type="button" data-mix-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(label)}">×</button></article>`;
}
function mixOrbitMarkup(): string {
  const anchors = artistMix.anchors;
  const companions = artistMix.companions;
  const fallbackLayout = mixOrbitLayout(companions.length, anchors.length);
  const satellites = companions.map((item, index) => {
    const scale = mixCompanionScale(item.weight);
    const fallback = fallbackLayout.placements[index] ?? { x: 50, y: 50, row: 'top' as const };
    return `<div class="mix-orbit-slot" role="listitem" data-mix-orbit-id="${escapeHtml(item.id)}" data-orbit-row="${fallback.row}" style="--mix-weight-scale:${scale};--orbit-x:${fallback.x}%;--orbit-y:${fallback.y}%"><div class="mix-orbit-carrier"><div class="mix-orbit-connector" aria-hidden="true"></div><div class="mix-orbit-upright"><div class="mix-orbit-card-shell">${mixArtistCardMarkup(item, false)}</div></div></div></div>`;
  }).join('');
  const center = anchors.length
    ? `<div class="mix-orbit-primary mix-anchor-group" role="group" aria-label="Pinned anchor artists">${anchors.map(item => mixArtistCardMarkup(item, true)).join('')}</div>`
    : '<div class="mix-orbit-primary" role="listitem"><button class="empty-artist-card mix-orbit-empty" id="open-mix-primary-picker-empty" type="button"><img src="./plus.png" alt=""><b>Choose anchor artist</b><small>Your fixed center for this mix</small></button></div>';
  return `<div class="mix-orbit" role="list" aria-label="Primary artist surrounded by companion artists" data-layout-ready="true"><div class="mix-orbit-ring mix-orbit-ring-inner" aria-hidden="true"></div><div class="mix-orbit-ring mix-orbit-ring-outer" aria-hidden="true"></div>${center}${satellites}</div>`;
}

function rectangleEdge(rect: DOMRect, targetX: number, targetY: number): { x: number; y: number } {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const dx = targetX - x;
  const dy = targetY - y;
  const factor = 1 / Math.max(Math.abs(dx) / Math.max(1, rect.width / 2), Math.abs(dy) / Math.max(1, rect.height / 2));
  return { x: x + dx * factor, y: y + dy * factor };
}

function layoutMixOrbitThreads(): void {
  const orbit = document.querySelector<HTMLElement>('.mix-orbit');
  const anchor = orbit?.querySelector<HTMLElement>(':scope > .mix-orbit-primary');
  if (!orbit || !anchor) return;
  const orbitRect = orbit.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const slots = [...orbit.querySelectorAll<HTMLElement>('.mix-orbit-slot')];
  const requestedWidth = Math.min(168, Math.max(154, orbitRect.width * 0.135));
  const measuredLayout = mixOrbitLayout(slots.length, artistMix.anchors.length, { width: orbitRect.width, height: orbitRect.height, companionWidth: requestedWidth, companionHeight: 198, anchorWidth: anchorRect.width, anchorHeight: anchorRect.height });
  orbit.dataset.layoutDensity = measuredLayout.density;
  orbit.style.setProperty('--mix-companion-width', `${measuredLayout.companionWidth}px`);
  orbit.style.setProperty('--mix-companion-height', `${measuredLayout.companionHeight}px`);
  slots.forEach((slot, index) => {
    const placement = measuredLayout.placements[index];
    if (placement) { slot.style.setProperty('--orbit-x', `${placement.x}%`); slot.style.setProperty('--orbit-y', `${placement.y}%`); slot.dataset.orbitRow = placement.row; }
    const card = slot.querySelector<HTMLElement>('.mix-artist-card');
    const connector = slot.querySelector<HTMLElement>('.mix-orbit-connector');
    if (!card || !connector) return;
    const cardRect = card.getBoundingClientRect();
    const cardCenter = { x: cardRect.left + cardRect.width / 2, y: cardRect.top + cardRect.height / 2 };
    const anchorCenter = { x: anchorRect.left + anchorRect.width / 2, y: anchorRect.top + anchorRect.height / 2 };
    const start = rectangleEdge(anchorRect, cardCenter.x, cardCenter.y);
    const end = rectangleEdge(cardRect, anchorCenter.x, anchorCenter.y);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    connector.style.left = `${start.x - orbitRect.left}px`;
    connector.style.top = `${start.y - orbitRect.top}px`;
    connector.style.width = `${Math.hypot(dx, dy)}px`;
    connector.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  });
  // Markup ships deterministic fallback coordinates, so an unusually small
  // transient measurement never makes the artist cards disappear.
  orbit.dataset.layoutReady = 'true';
}

let mixThreadSettleFrame: number | undefined;
let mixThreadFallbackTimer: number | undefined;
let mixThreadObserver: ResizeObserver | undefined;
let observedMixOrbit: HTMLElement | undefined;

function observeMixOrbitSizing(): void {
  const orbit = document.querySelector<HTMLElement>('.mix-orbit');
  if (!orbit || orbit === observedMixOrbit) return;
  mixThreadObserver?.disconnect();
  observedMixOrbit = orbit;
  mixThreadObserver = new ResizeObserver(() => scheduleMixOrbitThreads());
  mixThreadObserver.observe(orbit);
  orbit.querySelectorAll<HTMLElement>('.mix-orbit-primary, .mix-artist-card').forEach(element => mixThreadObserver?.observe(element));
  orbit.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    if (!image.complete) image.addEventListener('load', scheduleMixOrbitThreads, { once: true });
  });
}

function scheduleMixOrbitThreads(): void {
  if (mixThreadFrame !== undefined) window.cancelAnimationFrame(mixThreadFrame);
  if (mixThreadSettleFrame !== undefined) window.cancelAnimationFrame(mixThreadSettleFrame);
  if (mixThreadFallbackTimer !== undefined) window.clearTimeout(mixThreadFallbackTimer);
  const settle = (): void => {
    if (mixThreadFallbackTimer !== undefined) window.clearTimeout(mixThreadFallbackTimer);
    mixThreadFallbackTimer = undefined;
    layoutMixOrbitThreads();
    observeMixOrbitSizing();
  };
  mixThreadFallbackTimer = window.setTimeout(settle, 40);
  mixThreadFrame = window.requestAnimationFrame(() => {
    mixThreadFrame = undefined;
    mixThreadSettleFrame = window.requestAnimationFrame(() => {
      mixThreadSettleFrame = undefined;
      settle();
    });
  });
}
function artistMixWorkspace(): string {
  const requiredMin = Math.min(12, Math.max(2, artistMix.anchors.length + (artistMix.anchors.length > 1 ? 1 : 0)));
  const maxTotal = artistMix.anchors.length + mixCompanionCapacity(artistMix.anchors.length);
  const normalizedRange = normalizeRange(artistMix.randomRange, 12);
  const range = { min: Math.min(maxTotal, Math.max(requiredMin, normalizedRange.min)), max: Math.min(maxTotal, Math.max(requiredMin, normalizedRange.max)) };
  const total = mixArtists();
  const poolSize = mixPool().length;
  const status = mixNotice ? `<p class="random-notice" role="status">${escapeHtml(mixNotice)}</p>` : '';
  const panelLabel = focusMode ? 'aria-label="Artist Mix"' : 'aria-labelledby="artist-mix-tab"';
  return `<section id="artist-mix-panel" class="artist-mix-workspace ${focusMode ? 'is-focus' : ''}" role="tabpanel" ${panelLabel}><section class="mix-random-settings" aria-label="Artist Mix random settings"><div><p class="eyebrow">ARTIST MIX</p><h3>Constellation controls</h3><small>Total artists, including anchors</small></div><label>From <input id="mix-random-min" type="number" min="2" max="${maxTotal}" value="${range.min}"></label><label>to <input id="mix-random-max" type="number" min="2" max="${maxTotal}" value="${range.max}"></label><button class="chip ${artistMix.favoritesOnly ? 'on' : ''}" id="mix-favorites-only" type="button" aria-pressed="${artistMix.favoritesOnly}">★ Favorites (${poolSize})</button><div class="mix-actions"><button class="primary" id="mix-artists" type="button">Mix artists</button><button class="secondary" id="mix-reroll-companion-weights" type="button">Reroll companions</button><button class="secondary mix-focus-button" id="${focusMode ? 'exit-mix-focus' : 'enter-mix-focus'}" type="button">${focusMode ? 'Exit focus' : 'Focus'}</button></div>${status}</section><section class="mix-stage" aria-label="Artist Mix selected artists"><div class="mix-stage-heading"><div><p class="eyebrow">CENTER STAGE</p><h3>${artistMix.anchors.length} anchor${artistMix.anchors.length === 1 ? '' : 's'} + ${artistMix.companions.length} companions</h3></div><div class="mix-stage-tools"><button class="secondary" id="open-mix-primary-picker" type="button">Add anchor</button><button class="secondary" id="open-mix-companion-picker" type="button">Add companion</button></div></div>${mixOrbitMarkup()}</section><section class="mix-output"><div><p class="eyebrow">ARTIST PROMPT</p><code id="mix-prompt-output">${escapeHtml(buildArtistsPrompt(total))}</code></div><div class="mix-output-actions"><button class="primary" id="copy-mix-prompt" type="button">Copy artists prompt</button><button class="secondary" id="save-mix-library" type="button">Save artist mix</button></div></section></section>`;
}

function mixPickerMarkup(): string {
  return `<div class="modal-backdrop mix-picker-backdrop" id="mix-picker-backdrop" hidden><section class="picker-modal artist-catalog-picker" role="dialog" aria-modal="true" aria-label="Choose a V5 artist for Artist Mix"><header><div><p class="eyebrow">ARTIST MIX · V5</p><h2>Choose an artist</h2><p id="mix-picker-count">${catalog.artists.length.toLocaleString()} cards</p></div><button class="icon-button" id="close-mix-picker" type="button" aria-label="Close artist picker">×</button></header><div class="picker-tools"><input id="mix-artist-search" value="${escapeHtml(artistSearch)}" placeholder="Search V5 artists..." aria-label="Search V5 artists"><button class="chip ${artistMix.favoritesOnly ? 'on' : ''}" id="mix-picker-favorites" type="button" aria-pressed="${artistMix.favoritesOnly}">★ Favorites</button></div><div class="artist-grid artist-catalog-grid" id="mix-artist-grid" tabindex="0"></div><footer class="catalog-pagination"><button class="secondary" id="mix-artist-previous" type="button" disabled>Previous</button><span id="mix-artist-page-status" role="status" aria-live="polite">Page 1</span><button class="secondary" id="mix-artist-next" type="button" disabled>Next</button></footer></section></div>`;
}

function formatUpdateBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${index === 0 ? Math.round(amount) : amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function appUpdatePhaseCopy(): string {
  if (appUpdatePhase === 'checking') return 'Checking official releases...';
  if (appUpdatePhase === 'available') return `Version ${appUpdateManifest?.version ?? ''} is available.`;
  if (appUpdatePhase === 'downloading') return 'Downloading update...';
  if (appUpdatePhase === 'paused') return 'Download paused. Your partial file is kept for resume.';
  if (appUpdatePhase === 'verifying') return 'Verifying update...';
  if (appUpdatePhase === 'ready') return 'Update verified and ready to install.';
  if (appUpdatePhase === 'installing') return 'Installing update...';
  if (appUpdatePhase === 'up-to-date') return 'NAI Prompt Studio is up to date.';
  if (appUpdatePhase === 'error') return appUpdateMessage || 'The update action failed.';
  return 'Ready to check.';
}

function appUpdateMarkup(browserOnly: boolean): string {
  if (browserOnly) return '<p class="settings-disabled" role="status">Updates are available in the desktop app.</p>';
  const activeTransfer = appUpdatePhase === 'downloading' || appUpdatePhase === 'verifying';
  const updateBusy = activeTransfer || appUpdatePhase === 'installing';
  const showProgress = activeTransfer || appUpdatePhase === 'paused' || appUpdatePhase === 'ready';
  const progress = appUpdateProgress;
  const manifest = appUpdateManifest;
  const details = manifest?.available ? `<div class="app-update-details"><b>Version ${escapeHtml(manifest.version)}</b><span>${formatUpdateBytes(manifest.size ?? 0)}</span>${manifest.releaseNotes ? `<p>${escapeHtml(manifest.releaseNotes)}</p>` : ''}</div>` : '';
  const progressMarkup = showProgress ? `<div class="app-update-progress" id="app-update-progress"><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}" aria-label="Application update download progress"><span style="width:${progress.percent}%"></span></div><small id="app-update-progress-label">Download ${progress.percent}% complete, ${formatUpdateBytes(progress.completed)} of ${formatUpdateBytes(progress.total)}.${progress.message ? ` ${escapeHtml(progress.message)}` : ''}</small></div>` : '';
  const actions = `<div class="settings-actions app-update-actions"><button class="secondary" id="check-app-update" type="button" ${appUpdatePhase === 'checking' || updateBusy ? 'disabled' : ''}>${appUpdatePhase === 'checking' ? 'Checking...' : 'Check for updates now'}</button>${appUpdatePhase === 'available' ? '<button class="primary" id="download-app-update" type="button">Download update</button>' : ''}${activeTransfer ? '<button class="secondary" id="cancel-app-update" type="button">Cancel download</button>' : ''}${appUpdatePhase === 'paused' || (appUpdatePhase === 'error' && Boolean(appUpdateManifest)) ? '<button class="primary" id="resume-app-update" type="button">Resume download</button>' : ''}${appUpdatePhase === 'ready' ? '<button class="primary" id="install-app-update" type="button">Install now</button>' : ''}</div>`;
  return `<div class="app-update-subsection"><div class="catalog-update-status app-update-status" id="app-update-status" role="status" aria-live="polite">${escapeHtml(appUpdatePhaseCopy())}</div>${details}${progressMarkup}${actions}</div>`;
}

function settingsWorkspace(): string {
  const browserOnly = !window.naiCatalog;
  const catalogControls = browserOnly ? '' : `<div class="catalog-update-status" id="catalog-update-status" role="status" aria-live="polite">${escapeHtml(catalogUpdateStatus || catalogUpdateError || 'Ready to check.')}</div><div class="catalog-update-progress" id="catalog-update-progress"${catalogUpdateBusy ? '' : ' hidden'}><div class="progress-track"><span style="width:0%"></span></div><small id="catalog-update-progress-label">Preparing...</small></div><div class="settings-actions"><button class="primary" id="download-missing-v5" type="button" ${catalogUpdateBusy ? 'disabled' : ''}>${catalogUpdateBusy ? 'Updating...' : 'Update catalog now'}</button><button class="secondary" id="cancel-v5-update" type="button"${catalogUpdateBusy ? '' : ' hidden'}>Cancel</button></div>`;
  return `<section id="settings-panel" class="settings-workspace" role="tabpanel" aria-labelledby="settings-tab"><header class="workspace-intro"><div><p class="eyebrow">STUDIO SETTINGS</p><h2>Make the studio yours.</h2><p>Preferences, catalog data and updates stay beside the application.</p></div></header><div class="settings-grid"><section class="settings-card"><p class="eyebrow">APPEARANCE</p><h3>Theme and motion</h3><label class="settings-field">Theme<select id="studio-theme">${themeOptions()}</select></label>${settingsAnimationModeMarkup()}</section><section class="settings-card"><p class="eyebrow">STARTUP</p><h3>Automatic checks</h3><label class="settings-toggle"><input id="startup-catalog-update" type="checkbox" ${settings.updateCatalogOnStartup ? 'checked' : ''}><span>Update V5 catalog on startup</span></label><label class="settings-toggle"><input id="startup-app-update" type="checkbox" ${settings.checkAppUpdatesOnStartup ? 'checked' : ''}><span>Check app updates on startup</span></label><label class="settings-toggle"><input id="preload-character-previews" type="checkbox" ${settings.preloadCharacterPreviews ? 'checked' : ''}><span>Preload character previews</span></label></section><section class="settings-card"><p class="eyebrow">GUIDE</p><h3>Studio tour</h3><p>Replay the English overview for every workspace.</p><button class="secondary" id="replay-guide" type="button">Replay guide</button></section><section class="settings-card settings-catalog-card"><div class="settings-card-heading"><div><p class="eyebrow">V5 ARTIST CATALOG</p><h3>Catalog and app updates</h3></div><span class="catalog-count">${officialArtists.length.toLocaleString()} official cards</span></div><p>Catalog checks use only the exact NAX V5 gallery. App updates use the official GitHub release manifest and verified SHA-512.</p>${appUpdateMarkup(browserOnly)}${catalogControls}</section></div></section>`;
}

function artistPickerMarkup(): string {
  return `<div class="modal-backdrop artist-picker-backdrop" id="artist-picker-backdrop" hidden><section class="picker-modal artist-catalog-picker" role="dialog" aria-modal="true" aria-label="V5 artist picker"><header><div><p class="eyebrow">V5 ARTISTS · OFFLINE</p><h2>Choose artist cards</h2><p id="artist-count">${catalog.artists.length.toLocaleString()} cards</p></div><button class="icon-button" id="close-artist-picker" aria-label="Close artist picker">×</button></header><div class="picker-tools"><input id="artist-search" value="${escapeHtml(artistSearch)}" placeholder="Search V5 artists..." aria-label="Search V5 artists"><button class="chip ${artistFavoritesOnly ? 'on' : ''}" id="artist-favorites" type="button" aria-pressed="${artistFavoritesOnly}">★ Favorites</button></div><div class="artist-grid artist-catalog-grid" id="artist-grid" tabindex="0"></div><footer class="catalog-pagination"><button class="secondary" id="artist-previous" type="button" disabled>Previous</button><span id="artist-page-status" role="status" aria-live="polite">Page 1</span><button class="secondary" id="artist-next" type="button" disabled>Next</button></footer></section></div>`;
}

function characterCard(card: CatalogCard): string {
  const favorite = characterFavorites.has(card.id);
  return `<article class="character-catalog-card"><button type="button" data-pick-character="${escapeHtml(card.id)}"><img src="${catalogImage(card)}" alt="${escapeHtml(card.tag)}" loading="lazy"><b>${escapeHtml(card.tag)}</b></button><button type="button" class="favorite-button ${favorite ? 'is-favorite' : ''}" data-favorite-character="${escapeHtml(card.id)}" aria-label="${favorite ? 'Remove favorite' : 'Add favorite'}">★</button></article>`;
}

function charactersZone(): string {
  return `<aside class="zone zone-right" aria-label="Character workflow"><div class="zone-heading"><div><p class="eyebrow">V4.5 CHARACTERS</p><h2>Characters <span id="character-total">${characters.length}</span></h2><p>Separate NovelAI character blocks. Character text never enters the base copy.</p></div><div class="character-entry-actions"><button class="primary" id="add-character" type="button">＋ Add manually</button><button class="secondary" id="open-character-picker" type="button">Browse ${catalog.characters.length.toLocaleString()} cards</button></div></div><div class="character-list">${characters.length ? characters.map(characterBlock).join('') : '<p class="empty-inline">Add a character from the catalog or browse the full catalog.</p>'}</div></aside>`;
}

function characterPickerStatus(page: ReturnType<typeof paginateCharacters>): string {
  if (catalogState === 'loading') return '<p class="catalog-status loading" role="status" aria-live="polite"><span class="status-skeleton"></span>Loading the offline V4.5 character catalog...</p>';
  if (catalogState === 'error') return `<p class="catalog-status error" role="alert">${escapeHtml(catalogError || 'The offline character catalog could not be loaded.')} <button class="tiny-copy" id="retry-catalog-character" type="button">Retry</button></p>`;
  if (!catalog.characters.length) return '<p class="catalog-status empty" role="status">No V4.5 character cards are available in this snapshot.</p>';
  if (!page.filteredCount) return `<p class="catalog-status empty" role="status">No characters match this search${characterFavoritesOnly ? ' in Favorites' : ''}.</p>`;
  return '';
}

function characterPickerMarkup(): string {
  const page = paginateCharacters(catalog.characters, { query: characterSearch, favoritesOnly: characterFavoritesOnly, favoriteIds: characterFavorites, page: characterPage });
  characterPage = page.page;
  const count = `${page.filteredCount.toLocaleString()} of ${catalog.characters.length.toLocaleString()} cards`;
  const pageLabel = page.pageCount ? `Page ${page.page} of ${page.pageCount}` : 'Page 0 of 0';
  return `<div class="modal-backdrop character-picker-backdrop" id="character-picker-backdrop" hidden><section class="picker-modal character-picker-modal" id="character-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="character-picker-title" aria-describedby="character-picker-status"><header><div><p class="eyebrow">V4.5 CHARACTERS · OFFLINE</p><h2 id="character-picker-title">Browse character cards</h2><p id="character-picker-count">${count}</p></div><button class="icon-button" id="close-character-picker" type="button" aria-label="Close character picker">×</button></header><div class="picker-tools"><input id="character-search" value="${escapeHtml(characterSearch)}" placeholder="Search all V4.5 characters..." aria-label="Search all V4.5 characters"><button class="chip ${characterFavoritesOnly ? 'on' : ''}" id="character-favorites" type="button" aria-pressed="${characterFavoritesOnly}">★ Favorites</button></div><div id="character-picker-status">${characterPickerStatus(page)}</div><div class="character-grid character-picker-grid" id="character-grid">${page.cards.map(characterCard).join('')}</div><footer class="catalog-pagination"><button class="secondary" id="character-previous" type="button" ${page.hasPrevious ? '' : 'disabled'}>Previous</button><span id="character-page-status" role="status" aria-live="polite">${pageLabel}</span><button class="secondary" id="character-next" type="button" ${page.hasNext ? '' : 'disabled'}>Next</button></footer></section></div>`;
}

function characterBlock(character: Character, index: number): string {
  return `<article class="character-block"><header><div class="character-title"><span class="number">${index + 1}</span><input class="character-name" value="${escapeHtml(character.label)}" data-character-name="${character.id}" aria-label="Character name"></div><div class="character-actions"><button class="small" data-character-details="${character.id}">Details</button><button class="small" data-copy-character="${character.id}">Copy</button><button class="icon-button" data-remove-character="${character.id}" aria-label="Remove character">×</button></div></header>${editor('character', character.id, character.prompt, 'Character prompt', 'girl, blue eyes, short hair')}${editor('undesired', character.id, character.undesired, 'Character undesired', 'hat, blurry')}</article>`;
}

function savedLibraryItems(): SavedLibraryItem[] {
  const query = savedLibrarySearch.trim().toLocaleLowerCase();
  return savedLibrary.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).filter(item => {
    const typeMatch = savedLibraryFilter === 'all' || item.kind === savedLibraryFilter;
    const detailText = item.kind === 'prompt' ? `${item.data?.positive ?? ''} ${item.data?.negative ?? ''} ${item.data?.characters.map(character => `${character.label} ${character.positive} ${character.negative}`).join(' ') ?? ''}` : `${item.data?.serializedPrompt ?? ''} ${item.data?.artists.map(artist => artist.tag).join(' ') ?? ''}`;
    const textMatch = !query || `${item.name} ${item.description ?? ''} ${item.prompt} ${item.originalName ?? ''} ${detailText}`.toLocaleLowerCase().includes(query);
    return typeMatch && textMatch;
  });
}

function savedLibraryCardMarkup(item: SavedLibraryItem): string {
  const image = libraryImageUrl(item);
  const label = item.kind === 'artist-mix' ? 'Artist Mix' : 'Prompt';
  const date = new Date(item.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const polarity = libraryPolarities.get(item.id) ?? { base: 'positive' as const, characters: (item.kind === 'prompt' ? item.data?.characters ?? [] : []).map(() => 'positive' as const) };
  libraryPolarities.set(item.id, polarity);
  const promptBlock = (labelValue: string, value: { positive: string; negative: string }, index: number, active: 'positive' | 'negative'): string => {
    const text = value[active] || '(No prompt recorded for this side.)';
    return `<article class="saved-library-prompt" data-library-block="${escapeHtml(item.id)}:${index}"><header><b>${escapeHtml(labelValue)}</b><div class="metadata-toggle" role="group" aria-label="${escapeHtml(labelValue)} polarity"><button type="button" class="${active === 'positive' ? 'on' : ''}" data-library-polarity="${escapeHtml(item.id)}" data-library-index="${index}" data-polarity="positive" aria-pressed="${active === 'positive'}">Positive</button><button type="button" class="${active === 'negative' ? 'on' : ''}" data-library-polarity="${escapeHtml(item.id)}" data-library-index="${index}" data-polarity="negative" aria-pressed="${active === 'negative'}">Negative</button></div></header><pre>${escapeHtml(text)}</pre><button class="library-copy-icon" type="button" data-library-copy="${escapeHtml(item.id)}" data-library-index="${index}" aria-label="Copy ${escapeHtml(labelValue)} ${active} prompt" title="Copy ${escapeHtml(labelValue)} ${active} prompt" ${value[active] ? '' : 'disabled'}></button></article>`;
  };
  const generationValues = item.kind === 'prompt' ? [item.data?.model, item.data?.steps && `${item.data.steps} steps`, item.data?.sampler, item.data?.width && item.data?.height && `${item.data.width} x ${item.data.height}`, item.data?.cfg && `CFG ${item.data.cfg}`].filter(Boolean) : [];
  const generationMarkup = generationValues.length ? `<div class="saved-library-generation"><span>Generation metadata</span><code>${escapeHtml(generationValues.join(' | '))}</code></div>` : '';
  const details = item.kind === 'prompt'
    ? `<details class="saved-library-details"><summary>Prompt details</summary>${promptBlock('Base prompt', { positive: item.data?.positive ?? item.prompt, negative: item.data?.negative ?? '' }, -1, polarity.base)}${(item.data?.characters ?? []).map((character, index) => promptBlock(character.label, character, index, polarity.characters[index] ?? 'positive')).join('')}${generationMarkup}</details>`
    : `<details class="saved-library-details"><summary>Artist details</summary><code>${escapeHtml(item.data?.artists.map(artist => `${artist.tag} (${artist.weight})`).join(', ') || 'No structured artists')}</code></details>`;
  const previewAttrs = image ? ` tabindex="0" role="img" aria-label="Preview cover for ${escapeHtml(item.name)}" data-library-preview-image="${escapeHtml(image)}" data-library-preview-tag="${escapeHtml(item.name)}" data-library-preview-prompt="${escapeHtml(item.kind === 'prompt' ? item.data?.positive ?? item.prompt : item.data?.serializedPrompt ?? item.prompt)}" data-library-preview-description="${escapeHtml(item.description ?? '')}"` : '';
  return `<article class="saved-library-card" data-saved-library-card="${escapeHtml(item.id)}"><div class="saved-library-cover${image ? ' has-image' : ''}"${previewAttrs}>${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : '<span aria-hidden="true">✦</span>'}</div><div class="saved-library-card-body"><div class="saved-library-card-heading"><div><p class="eyebrow">${label}</p><h3>${escapeHtml(item.name)}</h3></div><time datetime="${escapeHtml(item.updatedAt)}">${escapeHtml(date)}</time></div><p class="saved-library-description">${escapeHtml(item.description || 'No description.')}</p>${details}<div class="saved-library-actions"><button class="secondary saved-library-rounded" type="button" data-edit-library="${escapeHtml(item.id)}">Edit</button><button class="secondary saved-library-rounded" type="button" data-delete-library="${escapeHtml(item.id)}">Delete</button></div></div></article>`;
}

function savedLibraryWorkspace(): string {
  const items = savedLibraryItems();
  const emptyCopy = savedLibrary.length ? 'Try a different name or type filter.' : 'Create an independent prompt or Artist Mix record.';
  return `<section id="saved-library-panel" class="saved-library-workspace" role="tabpanel" aria-labelledby="saved-library-tab"><header class="workspace-intro"><div><p class="eyebrow">PERSONAL LIBRARY</p><h2 id="saved-library-title">Saved Library</h2><p>Create independent prompt and Artist Mix records on this device.</p></div><div class="saved-library-header-actions"><button class="primary" id="save-library-prompt" type="button">＋ New Prompt</button><button class="secondary" id="save-library-mix" type="button">＋ New Artist Mix</button></div></header><div class="saved-library-tools"><input id="saved-library-search" value="${escapeHtml(savedLibrarySearch)}" placeholder="Search saved items..." aria-label="Search Saved Library"><div class="saved-library-filter" role="group" aria-label="Filter Saved Library"><button class="chip ${savedLibraryFilter === 'all' ? 'on' : ''}" type="button" data-library-filter="all">All</button><button class="chip ${savedLibraryFilter === 'prompt' ? 'on' : ''}" type="button" data-library-filter="prompt">Prompts</button><button class="chip ${savedLibraryFilter === 'artist-mix' ? 'on' : ''}" type="button" data-library-filter="artist-mix">Artist Mix</button></div></div><div class="saved-library-grid" id="saved-library-grid">${items.length ? items.map(savedLibraryCardMarkup).join('') : `<div class="saved-library-empty"><span class="brand-mark">✦</span><h3>${savedLibrary.length ? 'No saved items match this search.' : 'Your Saved Library is ready.'}</h3><p>${emptyCopy}</p><button class="secondary" type="button" id="save-library-empty">New Prompt</button></div>`}</div></section>`;
}

function savedLibraryModalMarkup(): string {
  if (!libraryModalMode) return '';
  const item = libraryModalItemId ? savedLibrary.find(value => value.id === libraryModalItemId) : undefined;
  if (libraryModalMode === 'delete') {
    return `<div class="modal-backdrop saved-library-modal-backdrop"><section class="detail-modal saved-library-confirm" role="dialog" aria-modal="true" aria-labelledby="saved-library-confirm-title"><header><div><p class="eyebrow">SAVED LIBRARY</p><h2 id="saved-library-confirm-title">Delete this saved item?</h2></div><button class="icon-button" id="close-library-modal" type="button" aria-label="Close">×</button></header><p>Delete <b>${escapeHtml(item?.name ?? 'this item')}</b>? Its cover image will also be removed from this device.</p><div class="saved-library-modal-actions"><button class="danger-button" id="confirm-library-action" type="button">Delete item</button><button class="secondary" id="cancel-library-action" type="button">Cancel</button></div></section></div>`;
  }
  const editing = libraryModalMode === 'edit';
  const kind = editing ? item?.kind : libraryModalMode === 'save-mix' ? 'artist-mix' : 'prompt';
  const currentImage = libraryCoverRemoved ? '' : libraryCoverBytes && libraryCoverMime ? savedLibraryImageUrls.get('__draft__') ?? '' : item ? libraryImageUrl(item) : '';
  const imagePreview = currentImage ? `<div class="saved-library-cover-preview"><img src="${escapeHtml(currentImage)}" alt="Selected cover preview"><button class="tiny-copy" id="remove-library-cover" type="button">Remove cover</button></div>` : '<p class="saved-library-cover-empty">Optional PNG, JPEG, or WebP cover up to 20 MiB.</p>';
  const promptFields = kind === 'prompt'
    ? `<label class="field"><span>Description</span><textarea id="saved-library-description">${escapeHtml(libraryFormDescription)}</textarea></label><label class="field"><span>Base positive</span><textarea id="saved-library-positive">${escapeHtml(libraryFormPrompt.positive)}</textarea></label><label class="field"><span>Base negative</span><textarea id="saved-library-negative">${escapeHtml(libraryFormPrompt.negative)}</textarea></label><div class="saved-library-characters">${libraryFormPrompt.characters.map((character, index) => `<section data-library-character-section="${escapeHtml(character.id)}"><div class="saved-library-character-heading"><b>${escapeHtml(character.label || `Character ${index + 1}`)}</b><button class="saved-library-character-remove" type="button" data-remove-library-character="${escapeHtml(character.id)}" aria-label="Remove ${escapeHtml(character.label || `Character ${index + 1}`)}" title="Remove character"><span aria-hidden="true">−</span></button></div><label class="field"><span>Character label</span><input data-library-character-label="${index}" value="${escapeHtml(character.label)}"></label><label class="field"><span>Character positive</span><textarea data-library-character-positive="${index}">${escapeHtml(character.positive)}</textarea></label><label class="field"><span>Character negative</span><textarea data-library-character-negative="${index}">${escapeHtml(character.negative)}</textarea></label></section>`).join('')}<button class="secondary saved-library-character-add" id="add-library-character" type="button">Add character</button></div>`
    : `<label class="field"><span>Description</span><textarea id="saved-library-description">${escapeHtml(libraryFormDescription)}</textarea></label><label class="field"><span>Artist prompt</span><textarea id="saved-library-mix-prompt">${escapeHtml(libraryFormMix.serializedPrompt)}</textarea></label>`;
  return `<div class="modal-backdrop saved-library-modal-backdrop"><section class="picker-modal saved-library-form-modal" role="dialog" aria-modal="true" aria-labelledby="saved-library-form-title"><header><div><p class="eyebrow">${editing ? 'EDIT SAVED ITEM' : kind === 'artist-mix' ? 'SAVE ARTIST MIX' : 'SAVE PROMPT'}</p><h2 id="saved-library-form-title">${editing ? 'Edit Saved Library item' : 'Create an independent record'}</h2></div><button class="icon-button" id="close-library-modal" type="button" aria-label="Close">×</button></header><form id="saved-library-form"><div class="saved-library-form-scroll" data-library-form-scroll><label class="field"><span>Name</span><input id="saved-library-name" maxlength="120" required value="${escapeHtml(libraryFormName)}" placeholder="e.g. Soft portrait setup"></label>${promptFields}<label class="field saved-library-cover-field"><span>Preview <i>Optional</i></span><div class="saved-library-cover-drop${currentImage ? ' has-image' : ''}" id="saved-library-cover-drop"><input id="saved-library-cover-input" type="file" accept="image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp" hidden><button type="button" class="secondary" id="choose-library-cover">Choose preview</button><span>or drop an image here</span>${imagePreview}</div><p class="saved-library-cover-error" id="saved-library-cover-error" role="alert">${escapeHtml(libraryCoverError)}</p></label></div><div class="saved-library-modal-actions"><button class="primary" type="submit">${editing ? 'Save changes' : 'Save to library'}</button><button class="secondary" id="cancel-library-action" type="button">Cancel</button></div></form></section></div>`;
}

function customTagImageUrl(tag: CustomTag): string {
  const transient = customImageUrls.get(tag.id);
  if (transient) return transient;
  return tag.imageAsset ? `nai-custom://asset/${encodeURIComponent(tag.imageAsset)}` : './plus.png';
}

function customPreset(idValue?: string): CustomTagPreset {
  return customTagPresets.find(preset => preset.id === idValue) ?? customTagPresets[0] ?? { id: DEFAULT_CUSTOM_TAG_PRESET_ID, name: DEFAULT_CUSTOM_TAG_PRESET_NAME, createdAt: '', updatedAt: '' };
}

function customTagPresetId(tag: CustomTag): string {
  return customTagPresets.some(preset => preset.id === tag.presetId) ? tag.presetId! : DEFAULT_CUSTOM_TAG_PRESET_ID;
}

function customCard(tag: CustomTag): ConstructorCard {
  const preset = customPreset(customTagPresetId(tag));
  return { id: `custom-${tag.id}`, tag: tag.tag, tags: splitTagGroup(tag.tag), zone: tag.zone, section: 'Custom', image: customTagImageUrl(tag), kind: 'tag', group: preset.name, description: tag.description ?? '' };
}

function rebuildEffectiveArtistCatalog(): void {
  const merged = mergeArtistCatalog(officialArtists, customTags, customTagImageUrl);
  artistCatalogAliases = merged.aliases;
  shadowedCustomArtistIds = merged.shadowedCustomIds;
  catalog.artists = merged.cards;

  const previousArtists = JSON.stringify(base.artists);
  const previousMix = JSON.stringify(artistMix);
  base.artists = reconcileSelectedArtists(migrateArtistAliases(base.artists, artistCatalogAliases), catalog.artists);
  const migratedFavorites = migrateFavoriteAliases(artistFavorites, artistCatalogAliases);
  if ([...migratedFavorites].some(value => !artistFavorites.has(value)) || migratedFavorites.size !== artistFavorites.size) {
    artistFavorites = migratedFavorites;
    saveFavorites(artistFavorites, 'artists');
  }
  artistMix = reconcileArtistMix(migrateArtistMixAliases(artistMix, artistCatalogAliases));
  if (JSON.stringify(base.artists) !== previousArtists) saveDraft(currentDraft());
  if (JSON.stringify(artistMix) !== previousMix) saveArtistMix(artistMix);
}

function zonePrompt(zone: ConstructorZone): string {
  if (zone === 'frame') return base.frame;
  if (zone === 'scene') return base.setting;
  return base.render;
}

function setZonePrompt(zone: ConstructorZone, value: string): void {
  if (zone === 'frame') base.frame = value;
  else if (zone === 'scene') base.setting = value;
  else base.render = value;
}

function constructorCards(zone: ConstructorZone): ConstructorCard[] {
  const custom = customTags.filter(tag => tag.kind !== 'artist' && tag.zone === zone).map(customCard);
  return mergeConstructorCards(guideCards.filter(card => card.zone === zone), custom)
    .filter(card => !constructorSearch || `${card.tag} ${card.group ?? ''} ${card.description ?? ''}`.toLocaleLowerCase().includes(constructorSearch.toLocaleLowerCase()))
    .slice(0, 360);
}

function constructorCardMarkup(card: ConstructorCard, zone: ConstructorZone): string {
  const tags = card.kind === 'preset' ? (card.tags ?? qualityPresetTags()) : constructorCardTags(card);
  const selected = hasPromptTagGroup(zonePrompt(zone), tags);
  const hasImage = Boolean(card.image);
  const image = hasImage ? (card.image!.startsWith('nai-custom://') ? card.image : `./catalog/guide/${escapeHtml(card.image!)}`) : '';
  const description = card.description?.trim() ?? '';
  const visual = hasImage ? `<img src="${image}" alt="${escapeHtml(card.tag)}" loading="lazy">` : `<span class="constructor-card-text-icon" aria-hidden="true">✦</span>`;
  return `<article class="constructor-card ${selected ? 'selected' : ''} ${card.kind === 'preset' ? 'preset' : ''}" data-constructor-card="${escapeHtml(card.id)}"><button class="constructor-card-pick" type="button" data-constructor-tag="${escapeHtml(card.id)}" ${hasImage ? `data-constructor-preview-image="${escapeHtml(image)}"` : 'data-constructor-preview-no-image="true"'} data-constructor-preview-tag="${escapeHtml(card.tag)}" data-constructor-preview-description="${escapeHtml(description)}" aria-pressed="${selected}"><span class="constructor-card-image ${hasImage ? '' : 'no-image'}">${visual}</span><b>${escapeHtml(card.tag)}</b><small>${escapeHtml(card.group ?? 'Custom')}</small></button></article>`;
}

function constructorModalMarkup(): string {
  if (!constructorZone) return '';
  const cards = constructorCards(constructorZone);
  const title = constructorZone === 'frame' ? 'Frame constructor' : constructorZone === 'scene' ? 'Scene constructor' : 'Render and quality constructor';
  return `<div class="modal-backdrop constructor-backdrop" id="constructor-backdrop"><section class="picker-modal constructor-modal" role="dialog" aria-modal="true" aria-labelledby="constructor-title"><header><div><p class="eyebrow">CUSTOM PROMPT BUILDER</p><h2 id="constructor-title">${title}</h2><p>Click a card to add or remove it. The dialog stays open while you build.</p></div><button class="icon-button" id="close-constructor" type="button" aria-label="Close constructor">×</button></header><div class="picker-tools"><input id="constructor-search" value="${escapeHtml(constructorSearch)}" placeholder="Search tags and groups..." aria-label="Search constructor tags"><span class="constructor-count">${cards.length.toLocaleString()} cards</span></div><div class="constructor-grid" id="constructor-grid">${cards.length ? cards.map(card => constructorCardMarkup(card, constructorZone!)).join('') : '<p class="empty-inline">No constructor cards match this search.</p>'}</div><footer class="constructor-footer"><span>Selected tags are written directly into the prompt row.</span><button class="primary" id="done-constructor" type="button">Done</button></footer></section></div>`;
}



function customPresetCount(presetId: string): number {
  return customTags.filter(item => customTagPresetId(item) === presetId).length;
}

function customPresetMarkup(preset: CustomTagPreset): string {
  const selected = selectedCustomPresetId === preset.id;
  const renaming = renamingCustomPresetId === preset.id;
  const isDefault = preset.id === DEFAULT_CUSTOM_TAG_PRESET_ID;
  const controls = selected && !isDefault ? `<div class="preset-actions" aria-label="Actions for ${escapeHtml(preset.name)}"><button class="icon-button preset-action-icon" type="button" data-rename-preset="${escapeHtml(preset.id)}" aria-label="Rename ${escapeHtml(preset.name)}" title="Rename preset">✎</button><button class="icon-button preset-action-icon danger-copy" type="button" data-delete-preset="${escapeHtml(preset.id)}" aria-label="Delete ${escapeHtml(preset.name)}" title="Delete preset">×</button></div>` : '';
  const content = renaming
    ? `<form class="preset-rename-form" data-preset-rename-form="${escapeHtml(preset.id)}"><input id="preset-rename-${escapeHtml(preset.id)}" value="${escapeHtml(preset.name)}" maxlength="80" aria-label="Rename ${escapeHtml(preset.name)}"><button class="tiny-copy" type="submit">Save</button><button class="tiny-copy" type="button" data-cancel-rename="${escapeHtml(preset.id)}">Cancel</button></form>`
    : `<div class="preset-select-shell"><button class="preset-select" type="button" data-select-preset="${escapeHtml(preset.id)}" aria-pressed="${selected}"><span><b>${escapeHtml(preset.name)}</b><small>${customPresetCount(preset.id)} ${customPresetCount(preset.id) === 1 ? 'card' : 'cards'}</small></span></button>${controls}<span class="preset-check" aria-hidden="true">${selected ? '●' : '○'}</span></div>`;
  return `<div class="preset-row ${selected ? 'selected' : ''} ${isDefault ? 'default' : ''}">${content}</div>`;
}

function customZoneChoice(zone: ConstructorZone, current: ConstructorZone): string {
  const label = zone === 'render' ? 'Render / Quality' : zone[0].toUpperCase() + zone.slice(1);
  return `<label class="zone-choice ${current === zone ? 'selected' : ''}"><input type="radio" name="custom-tag-zone" value="${zone}" data-custom-zone="${zone}"${current === zone ? ' checked' : ''}><span>${label}</span></label>`;
}

function customTagKind(item?: CustomTag): CustomTagKind { return item ? (item.kind === 'artist' ? 'artist' : 'tag') : customTagFormKind; }
function customTypeSelector(kind: CustomTagKind): string {
  return `<label class="field custom-type-select"><span>Card type</span><select id="custom-card-kind" aria-label="Custom card type"><option value="tag"${kind === 'tag' ? ' selected' : ''}>Prompt tag</option><option value="artist"${kind === 'artist' ? ' selected' : ''}>Artist</option></select></label>`;
}

function customTagsWorkspace(): string {
  const editing = customTags.find(item => item.id === editingCustomTagId);
  const kind = customTagKind(editing);
  const destination = customPreset(selectedCustomPresetId);
  const visibleCards = customTags.filter(item => {
    const inPreset = selectedCustomPresetId === 'all' || customTagPresetId(item) === selectedCustomPresetId;
    const query = customTagSearch.trim().toLocaleLowerCase();
    const matchesSearch = !query || `${item.tag} ${item.description ?? ''}`.toLocaleLowerCase().includes(query);
    return inPreset && matchesSearch && (customTagFilter === 'all' || (customTagFilter === 'artist' ? item.kind === 'artist' : item.kind !== 'artist' && item.zone === customTagFilter));
  });
  const imageUrl = customImageBytes && customImageMime
    ? customImageUrls.get('__draft__') ?? ''
    : editing?.imageAsset
      ? customTagImageUrl(editing)
      : '';
  const hasImage = Boolean(imageUrl);
  const imagePreview = hasImage
    ? `<div class="custom-image-preview is-loaded" id="custom-image-preview"><img src="${escapeHtml(imageUrl)}" alt="${editing ? escapeHtml(editing.tag) : 'Selected custom tag image preview'}"></div>`
    : '<div class="custom-image-preview is-empty" id="custom-image-preview"><span class="custom-image-empty">Choose an image to preview it here.</span></div>';
  const deletePreset = deletingCustomPresetId ? customPreset(deletingCustomPresetId) : null;
  const deletePrompt = deletePreset ? `<div class="preset-delete-confirm" role="alert"><b>Delete ${escapeHtml(deletePreset.name)}?</b><p>${customPresetCount(deletePreset.id)} ${customPresetCount(deletePreset.id) === 1 ? 'card returns' : 'cards return'} to My Tags. Images stay safe.</p><div><button class="danger-button" type="button" data-confirm-delete-preset="${escapeHtml(deletePreset.id)}">Delete preset</button><button class="tiny-copy" type="button" id="cancel-delete-preset">Keep preset</button></div></div>` : '';
  const imageHelp = kind === 'artist' ? 'Optional PNG, JPEG, or WebP card, up to 20 MiB' : 'PNG, JPEG, or WebP, up to 20 MiB';
  const imageStatus = kind === 'artist' ? 'Optional. Without an image, the artist uses the plus-card placeholder.' : 'Click or press Enter to choose an image.';
  const nameLabel = kind === 'artist' ? 'Artist name' : 'Tag';
  const namePlaceholder = kind === 'artist' ? 'artist name' : '1girl, upper body, looking at viewer';
  const constructor = kind === 'artist' ? '<p class="custom-artist-note">Artist cards appear in Add Artist, random pools, Artist Mix, and metadata highlights.</p>' : `<fieldset class="field constructor-choices"><legend>Constructor</legend><div class="zone-choice-grid">${customZoneChoice('frame', editing?.zone ?? 'frame')}${customZoneChoice('scene', editing?.zone ?? 'frame')}${customZoneChoice('render', editing?.zone ?? 'frame')}</div></fieldset>`;
  return `<section class="custom-tags-workspace" aria-labelledby="custom-tags-title"><header class="workspace-intro"><div><p class="eyebrow">PERSONAL LIBRARY</p><h2 id="custom-tags-title">Custom Tag Builder</h2><p>Build prompt tags and artist cards for your studio.</p></div></header><div class="custom-tags-layout"><aside class="custom-preset-sidebar" aria-label="Custom tag presets"><div class="preset-sidebar-heading"><div><p class="eyebrow">PRESET FOLDERS</p><h3>My presets</h3></div><span class="preset-total">${customTags.length}</span></div><button class="preset-all ${selectedCustomPresetId === 'all' ? 'selected' : ''}" type="button" data-select-preset="all" aria-pressed="${selectedCustomPresetId === 'all'}"><span><b>All Tags</b><small>${customTags.length} ${customTags.length === 1 ? 'card' : 'cards'}</small></span><span aria-hidden="true">${selectedCustomPresetId === 'all' ? '●' : '○'}</span></button><div class="custom-preset-list">${customTagPresets.map(customPresetMarkup).join('')}</div>${creatingCustomPreset ? `<form class="preset-create-form" id="custom-preset-form"><label class="field"><span>New preset folder</span><input id="custom-preset-name" maxlength="80" placeholder="A short folder name" required></label><div><button class="primary" type="submit">Create preset</button><button class="tiny-copy" type="button" id="cancel-create-preset">Cancel</button></div></form>` : '<button class="secondary preset-create-button" type="button" id="create-preset">＋ New preset</button>'}${deletePrompt}</aside><form class="custom-tag-form" id="custom-tag-form"><div class="form-heading"><div><p class="eyebrow">CREATE OR EDIT</p><h3>${editing ? `Edit custom ${kind}` : `New custom ${kind}`}</h3></div>${editing ? '<button class="tiny-copy" type="button" id="cancel-custom-edit">Cancel edit</button>' : ''}</div><p class="custom-destination" role="status">Destination: <b>${escapeHtml(destination.name)}</b>${selectedCustomPresetId === 'all' ? ' <small>All Tags is a view. New cards go to My Tags.</small>' : ''}</p>${customTypeSelector(kind)}<div class="field image-field"><span>Image <i>${imageHelp}</i></span><div class="custom-image-drop${hasImage ? ' has-image' : ''}" id="custom-image-drop" aria-describedby="custom-image-status"><input id="custom-tag-image" class="custom-file-input" type="file" accept="image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp" tabindex="-1"><button class="custom-image-empty-content" type="button" id="custom-tag-choose"${hasImage ? ' hidden' : ''}><span class="drop-icon" aria-hidden="true">＋</span><b>Drop an image here</b><span>or</span><span class="secondary choose-image-label">Choose image</span></button>${imagePreview}</div><p class="custom-image-status" id="custom-image-status">${imageStatus}</p></div><label class="field"><span>${nameLabel}</span><input id="custom-tag-name" value="${escapeHtml(editing?.tag ?? '')}" required maxlength="180" placeholder="${namePlaceholder}"></label>${constructor}<label class="field"><span>Description / guide <i>(optional)</i></span><textarea id="custom-tag-description" maxlength="2000" placeholder="Explain what this card changes or when to use it.">${escapeHtml(editing?.description ?? '')}</textarea></label><p class="custom-tag-status" id="custom-tag-status" role="status" aria-live="polite"></p><button class="primary custom-save-button" type="submit">${editing ? 'Save changes' : `Save custom ${kind}`}</button></form><section class="custom-tag-library"><div class="subheading"><div><p class="eyebrow">SAVED CARDS</p><h3>${visibleCards.length} shown <span>·</span> ${customTags.length} total</h3></div><div class="custom-library-tools"><input id="custom-tag-search" value="${escapeHtml(customTagSearch)}" placeholder="Search your cards..." aria-label="Search custom cards"><div class="custom-zone-filter" role="group" aria-label="Filter saved cards"><button type="button" class="chip ${customTagFilter === 'all' ? 'on' : ''}" data-custom-filter="all" aria-pressed="${customTagFilter === 'all'}">All</button><button type="button" class="chip ${customTagFilter === 'artist' ? 'on' : ''}" data-custom-filter="artist" aria-pressed="${customTagFilter === 'artist'}">Artists</button><button type="button" class="chip ${customTagFilter === 'frame' ? 'on' : ''}" data-custom-filter="frame" aria-pressed="${customTagFilter === 'frame'}">Frame</button><button type="button" class="chip ${customTagFilter === 'scene' ? 'on' : ''}" data-custom-filter="scene" aria-pressed="${customTagFilter === 'scene'}">Scene</button><button type="button" class="chip ${customTagFilter === 'render' ? 'on' : ''}" data-custom-filter="render" aria-pressed="${customTagFilter === 'render'}">Render</button></div></div></div><div class="custom-tag-grid" tabindex="0">${visibleCards.length ? visibleCards.map(customLibraryCardMarkup).join('') : '<p class="empty-inline">No saved cards match this preset and filter yet.</p>'}</div></section></div></section>`;
}

function customLibraryCardMarkup(item: CustomTag): string {
  const description = item.description?.trim() ?? '';
  const preset = customPreset(customTagPresetId(item));
  const isArtist = item.kind === 'artist';
  const status = isArtist && shadowedCustomArtistIds.has(item.id) ? 'NAX card active' : isArtist ? 'Artist' : item.zone === 'render' ? 'Render / Quality' : item.zone[0].toUpperCase() + item.zone.slice(1);
  return `<article class="custom-library-card" data-constructor-preview-image="${escapeHtml(customTagImageUrl(item))}" data-constructor-preview-tag="${escapeHtml(item.tag)}" data-constructor-preview-description="${escapeHtml(description)}"><img src="${escapeHtml(customTagImageUrl(item))}" alt="${escapeHtml(item.tag)}" loading="lazy"><div><b>${escapeHtml(item.tag)}</b><small>${escapeHtml(preset.name)} · ${status}</small>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div><div class="custom-library-actions"><button class="tiny-copy" type="button" data-edit-custom-tag="${escapeHtml(item.id)}">Edit</button><button class="tiny-copy" type="button" data-delete-custom-tag="${escapeHtml(item.id)}">Delete</button></div></article>`;
}

function workspacePanelClass(workspace: 'prompt' | 'artist-mix' | 'saved-library' | 'custom-tags' | 'metadata' | 'settings'): string {
  return pendingWorkspaceTransition === workspace
    ? `workspace-panel workspace-panel-incoming workspace-panel-incoming-${workspace}`
    : 'workspace-panel';
}

function switchWorkspace(workspace: 'prompt' | 'artist-mix' | 'saved-library' | 'custom-tags' | 'metadata' | 'settings'): void {
  if (workspace === activeWorkspace) return;
  focusMode = false;
  activeWorkspace = workspace;
  pendingWorkspaceTransition = workspace;
  render();
}
// Legacy compatibility marker: function switchWorkspace(workspace: 'prompt' | 'custom-tags' | 'metadata'): void { if (workspace === activeWorkspace) return; activeWorkspace = workspace; pendingWorkspaceTransition = workspace; render(); }

function snapshotAccordionState(): void {
  document.querySelectorAll<HTMLDetailsElement>('.accordion[data-zone]').forEach(details => {
    const zone = details.dataset.zone as Zone | undefined;
    if (zone && zone in accordionOpenState) accordionOpenState[zone] = details.open;
  });
}

function render(): void {
  // Legacy test marker for the former topbar shape: <div class="top-actions">${animationModeMarkup()}${activeWorkspace === 'prompt'
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  document.documentElement.dataset.workspace = activeWorkspace;
  clearArtistCardPreview();
  const tabs = focusMode ? '' : `<div class="workspace-tabs" role="tablist" aria-label="Studio workspaces"><button id="prompt-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'prompt'}" aria-controls="prompt-panel" class="${activeWorkspace === 'prompt' ? 'on' : ''}">Prompt Builder</button><button id="artist-mix-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'artist-mix'}" aria-controls="artist-mix-panel" class="${activeWorkspace === 'artist-mix' ? 'on' : ''}">Artist Mix</button><button id="saved-library-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'saved-library'}" aria-controls="saved-library-panel" class="${activeWorkspace === 'saved-library' ? 'on' : ''}">Saved Library</button><button id="custom-tags-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'custom-tags'}" aria-controls="custom-tags-panel" class="${activeWorkspace === 'custom-tags' ? 'on' : ''}">Custom Tags</button><button id="metadata-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'metadata'}" aria-controls="metadata-panel" class="${activeWorkspace === 'metadata' ? 'on' : ''}">Image Metadata</button><button id="settings-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'settings'}" aria-controls="settings-panel" class="${activeWorkspace === 'settings' ? 'on' : ''}">Settings</button></div>`;
  snapshotAccordionState();
  const activeMarkup = activeWorkspace === 'prompt'
    ? `<section id="prompt-panel" class="${workspacePanelClass('prompt')}" role="tabpanel" aria-labelledby="prompt-tab"><section class="workspace-intro"><div><p class="eyebrow">FOUR-ZONE WORKSPACE</p><h2>Build the prompt in order.</h2><p>Frame → artists → scene → render. Undesired content and character blocks stay separate.</p></div></section><section class="four-zone-grid">${zoneDetails()}${artistZone()}${charactersZone()}</section><footer class="app-footer"><div class="footer-brand"><span>NAI Prompt Studio</span><span class="footer-links"><a href="https://nax.moe/?gallery=danbooru-artist-tags-2-v5" target="_blank" rel="noopener noreferrer">NAX · CC BY 4.0</a><a href="https://hothottuk.neocities.org/en" target="_blank" rel="noopener noreferrer">hothottuk's guide</a></span></div></footer></section>`
    : activeWorkspace === 'artist-mix' ? artistMixWorkspace()
    : activeWorkspace === 'saved-library' ? savedLibraryWorkspace()
    : activeWorkspace === 'custom-tags' ? `<section id="custom-tags-panel" class="${workspacePanelClass('custom-tags')}" role="tabpanel" aria-labelledby="custom-tags-tab">${customTagsWorkspace()}</section>`
    : activeWorkspace === 'metadata' ? `<section id="metadata-panel" class="${workspacePanelClass('metadata')}" role="tabpanel" aria-labelledby="metadata-tab">${metadataWorkspace.markup()}</section>`
    : settingsWorkspace();
  const shellClass = `${focusMode ? 'app-shell focus-shell' : 'app-shell'}${startupEntryPending ? ' startup-entry' : ''}`;
  app.innerHTML = `<main class="${shellClass}"><header class="topbar"${focusMode ? ' hidden' : ''}><div class="brand"><img class="brand-mark brand-icon" src="./app-icon.png" alt=""><div><h1>Prompt Studio</h1><p>NovelAI Diffusion · V5 artist workflow</p></div></div><div class="top-actions">${activeWorkspace === 'prompt' ? '<button class="reset-prompt" id="reset" type="button">Reset prompt</button>' : ''}</div></header>${tabs}${activeMarkup}</main>${activeWorkspace === 'prompt' ? `${artistPickerMarkup()}${characterPickerMarkup()}${constructorModalMarkup()}` : activeWorkspace === 'artist-mix' ? mixPickerMarkup() : ''}${savedLibraryModalMarkup()}${onboardingMarkup()}`;
  pendingWorkspaceTransition = null;
  bindEvents();
  document.querySelector('#guide-skip')?.addEventListener('click', finishGuide);
  document.querySelector('#guide-next')?.addEventListener('click', () => { if (onboardingIndex + 1 < onboardingSteps.length) { onboardingIndex += 1; render(); } else finishGuide(); });
  document.querySelectorAll<HTMLButtonElement>('[data-guide-theme]').forEach(button => button.addEventListener('click', () => {
    const theme = button.dataset.guideTheme;
    if (!studioThemes.some(item => item.id === theme)) return;
    settings = { ...settings, theme: theme as AppSettings['theme'] }; applyTheme(); saveSettings(settings); render();
  }));
  if (activeWorkspace === 'metadata') metadataWorkspace.bind(app, render);
  if (activeWorkspace === 'settings') bindSettingsEvents();
  if (activeWorkspace === 'artist-mix') bindArtistMixEvents();
  bindSavedLibraryEvents();
  if (activeWorkspace === 'artist-mix') scheduleMixOrbitThreads();
  if (startupEntryPending) { startupEntryPending = false; window.setTimeout(() => document.querySelector('.startup-entry')?.classList.remove('startup-entry'), 240); }
}

function updatePrompt(): void {
  const fullOutput = document.querySelector<HTMLElement>('#full-prompt-output');
  const artistOutput = document.querySelector<HTMLElement>('#artist-prompt-output');
  if (fullOutput) fullOutput.textContent = prompt();
  if (artistOutput) artistOutput.textContent = buildArtistsPrompt(base.artists);
}

function updateEditor(area: HTMLTextAreaElement): void {
  const kind = area.dataset.editor;
  const key = area.dataset.editorId!;
  if (kind === 'base' && key in base) base[key as keyof Omit<BasePrompt, 'artists'>] = area.value;
  if (kind === 'character' || kind === 'undesired') {
    const character = characters.find(item => item.id === key);
    if (character) character[kind === 'character' ? 'prompt' : 'undesired'] = area.value;
  }
  updatePrompt();
  showSuggestions(area);
  saveSoon();
}

function suggestions(area: HTMLTextAreaElement): string[] {
  const before = area.value.slice(0, area.selectionStart);
  const q = before.slice(before.lastIndexOf(',') + 1).trim().toLocaleLowerCase();
  if (!q) return [];
  return catalog.tags.filter(tag => tag.toLocaleLowerCase().includes(q)).slice(0, 8);
}
function showSuggestions(area: HTMLTextAreaElement): void {
  const host = document.querySelector<HTMLElement>(`[data-suggestions="${area.dataset.editor}:${area.dataset.editorId}"]`);
  if (!host) return;
  host.innerHTML = suggestions(area).map(tag => `<button type="button" data-suggestion="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
  host.querySelectorAll<HTMLButtonElement>('[data-suggestion]').forEach(button => button.onmousedown = event => { event.preventDefault(); insertSuggestion(area, button.dataset.suggestion!); });
}
function insertSuggestion(area: HTMLTextAreaElement, tag: string): void {
  const caret = area.selectionStart;
  const start = area.value.slice(0, caret).lastIndexOf(',') + 1;
  area.value = `${area.value.slice(0, start).trimEnd()}${start ? ' ' : ''}${tag}, ${area.value.slice(caret).trimStart()}`;
  area.selectionStart = area.selectionEnd = start + tag.length + (start ? 1 : 0);
  updateEditor(area);
  area.focus();
}

function modalFocusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(item => !item.hasAttribute('hidden') && item.getClientRects().length > 0);
}

function handleModalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (modal === 'characters') { event.preventDefault(); closeCharacterPicker(); }
    else if (modal === 'artists') { event.preventDefault(); if (document.querySelector<HTMLElement>('#mix-picker-backdrop:not([hidden])')) closeMixPicker(); else closeArtistPicker(); }
    else if (modal === 'character-details') { event.preventDefault(); closeDetails(); }
    else if (modal === 'constructor') { event.preventDefault(); closeConstructor(); }
    else if (modal === 'saved-library') { event.preventDefault(); closeLibraryModal(); }
    else if (!modal && focusMode && activeWorkspace === 'artist-mix') { event.preventDefault(); focusMode = false; render(); }
    return;
  }
  if (event.key !== 'Tab' || !modal) return;
  const dialog = document.querySelector<HTMLElement>('.modal-backdrop:not([hidden]) [role="dialog"]');
  if (!dialog) return;
  const focusable = modalFocusable(dialog);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function closeLibraryModal(): void {
  if (savedLibraryImageUrls.has('__draft__')) revokeSavedLibraryImageUrl('__draft__');
  libraryModalMode = null;
  libraryModalItemId = null;
  libraryCoverBytes = null;
  libraryCoverMime = undefined;
  libraryCoverName = '';
  libraryCoverError = '';
  libraryCoverRemoved = false;
  if (modal === 'saved-library') modal = null;
  render();
}

function promptDataFromBuilder(): SavedPromptData { return { positive: buildBasePrompt(base), negative: base.undesired, characters: characters.map(character => ({ id: character.id, label: character.label, positive: character.prompt, negative: character.undesired })) }; }
function mixDataFromBuilder(): SavedArtistMixData { const artists = JSON.parse(JSON.stringify(mixArtists())) as WeightedTag[]; return { artists, serializedPrompt: buildArtistsPrompt(artists) }; }
function structuredArtistsFromPrompt(value: string): WeightedTag[] {
  const artists: WeightedTag[] = [];
  const seen = new Set<string>();
  const matcher = /([0-9]+(?:\.[0-9]+)?)\s*::\s*([^,:]+?)\s*::/g;
  for (let match = matcher.exec(value); match; match = matcher.exec(value)) {
    const tag = `artist: ${match[2].trim()}`;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); artists.push({ id: `saved-${id()}`, tag, weight: normalizeArtistWeight(Number(match[1])) });
  }
  return artists;
}

function captureLibraryFormDraft(): void {
  if (!libraryModalMode || libraryModalMode === 'delete') return;
  libraryFormName = document.querySelector<HTMLInputElement>('#saved-library-name')?.value ?? libraryFormName;
  libraryFormDescription = document.querySelector<HTMLTextAreaElement>('#saved-library-description')?.value ?? libraryFormDescription;
  libraryFormPrompt = {
    ...libraryFormPrompt,
    positive: document.querySelector<HTMLTextAreaElement>('#saved-library-positive')?.value ?? libraryFormPrompt.positive,
    negative: document.querySelector<HTMLTextAreaElement>('#saved-library-negative')?.value ?? libraryFormPrompt.negative,
    characters: libraryFormPrompt.characters.map((character, index) => ({
      ...character,
      label: document.querySelector<HTMLInputElement>(`[data-library-character-label="${index}"]`)?.value ?? character.label,
      positive: document.querySelector<HTMLTextAreaElement>(`[data-library-character-positive="${index}"]`)?.value ?? character.positive,
      negative: document.querySelector<HTMLTextAreaElement>(`[data-library-character-negative="${index}"]`)?.value ?? character.negative
    }))
  };
  libraryFormMix = { ...libraryFormMix, serializedPrompt: document.querySelector<HTMLTextAreaElement>('#saved-library-mix-prompt')?.value ?? libraryFormMix.serializedPrompt };
  libraryFormScrollTop = document.querySelector<HTMLElement>('[data-library-form-scroll]')?.scrollTop ?? libraryFormScrollTop;
}

function openLibrarySaveModal(kind: 'prompt' | 'artist-mix', source: SavedLibraryItem['source'] = 'manual'): void {
  libraryModalMode = kind === 'artist-mix' ? 'save-mix' : 'save-prompt';
  libraryModalItemId = null;
  libraryCoverBytes = null;
  libraryCoverMime = undefined;
  libraryCoverName = '';
  libraryCoverError = '';
  libraryCoverRemoved = false;
  libraryFormSource = source;
  libraryFormName = '';
  libraryFormDescription = '';
  libraryFormScrollTop = 0;
  libraryFormPrompt = kind === 'prompt' && source === 'prompt-builder' ? promptDataFromBuilder() : { positive: '', negative: '', characters: [] };
  libraryFormMix = kind === 'artist-mix' && source === 'artist-mix' ? mixDataFromBuilder() : { artists: [], serializedPrompt: '' };
  modal = 'saved-library';
  render();
  window.setTimeout(() => document.querySelector<HTMLInputElement>('#saved-library-name')?.focus(), 0);
}

function openLibraryEditModal(itemId: string): void {
  const item = savedLibrary.find(value => value.id === itemId);
  if (!item) return;
  libraryFormSource = item.source ?? 'legacy';
  libraryFormName = item.name;
  libraryFormDescription = item.description ?? '';
  libraryFormScrollTop = 0;
  libraryFormPrompt = item.kind === 'prompt' ? JSON.parse(JSON.stringify(item.data ?? { positive: item.prompt, negative: '', characters: [] })) : { positive: '', negative: '', characters: [] };
  libraryFormMix = item.kind === 'artist-mix' ? JSON.parse(JSON.stringify(item.data ?? { artists: [], serializedPrompt: item.prompt })) : { artists: [], serializedPrompt: '' };
  libraryModalMode = 'edit'; libraryModalItemId = itemId; libraryCoverBytes = null; libraryCoverMime = undefined; libraryCoverName = ''; libraryCoverError = ''; libraryCoverRemoved = false; modal = 'saved-library'; render();
  window.setTimeout(() => document.querySelector<HTMLInputElement>('#saved-library-name')?.focus(), 0);
}

function openLibraryConfirmation(mode: 'delete', itemId: string): void {
  const item = savedLibrary.find(value => value.id === itemId);
  if (!item) return;
  libraryModalMode = mode; libraryModalItemId = itemId; modal = 'saved-library'; render();
}

function libraryCoverMimeFromBytes(bytes: Uint8Array): SavedLibraryItem['mime'] {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}

async function readLibraryCover(file?: File): Promise<void> {
  if (!file) return;
  captureLibraryFormDraft();
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Cover images must be 20 MiB or smaller.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = libraryCoverMimeFromBytes(bytes);
    if (!mime) throw new Error('Cover must be a PNG, JPEG, or WebP image.');
    libraryCoverBytes = bytes; libraryCoverMime = mime; libraryCoverName = file.name.slice(0, 255); libraryCoverError = '';
    revokeSavedLibraryImageUrl('__draft__');
    savedLibraryImageUrls.set('__draft__', URL.createObjectURL(new Blob([bytes], { type: mime })));
  } catch (error) { libraryCoverError = error instanceof Error ? error.message : 'The cover image could not be read.'; }
  captureLibraryFormDraft();
  render();
}

async function saveLibraryItemFromForm(): Promise<void> {
  if (!libraryModalMode || libraryModalMode === 'delete') return;
  captureLibraryFormDraft();
  const name = libraryFormName.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) { libraryCoverError = 'Enter a name for this saved item.'; render(); return; }
  const existing = libraryModalItemId ? savedLibrary.find(item => item.id === libraryModalItemId) : undefined;
  const now = new Date().toISOString();
  let imageAsset = existing?.imageAsset;
  let mime = existing?.mime;
  let originalName = existing?.originalName;
  try {
    if (libraryCoverBytes && libraryCoverMime) {
      const result = await saveLibraryImage({ id: existing?.id ?? id(), mime: libraryCoverMime, originalName: libraryCoverName }, libraryCoverBytes);
      if (existing?.imageAsset && existing.imageAsset !== result.imageAsset) await deleteLibraryImage(existing.imageAsset);
      imageAsset = result.imageAsset; mime = result.mime ?? libraryCoverMime; originalName = result.originalName ?? libraryCoverName;
    } else if (existing && libraryCoverRemoved) {
      if (existing.imageAsset) await deleteLibraryImage(existing.imageAsset);
      imageAsset = undefined; mime = undefined; originalName = undefined;
    }
    const description = libraryFormDescription.trim().slice(0, 2000);
    const common = { version: 4 as const, id: existing?.id ?? id(), kind: libraryModalMode === 'save-mix' || existing?.kind === 'artist-mix' ? 'artist-mix' as const : 'prompt' as const, source: existing?.source ?? libraryFormSource, name, ...(description ? { description } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now, ...(imageAsset ? { imageAsset, mime, originalName } : {}) };
    const item: SavedLibraryItem = common.kind === 'artist-mix'
      ? (() => { const serializedPrompt = libraryFormMix.serializedPrompt; return { ...common, kind: 'artist-mix' as const, prompt: serializedPrompt, data: { ...libraryFormMix, artists: libraryFormMix.artists.length ? libraryFormMix.artists : structuredArtistsFromPrompt(serializedPrompt), serializedPrompt }, snapshot: existing?.kind === 'artist-mix' ? existing.snapshot : normalizeArtistMix({ anchors: [], companions: [] }) }; })()
      : { ...common, kind: 'prompt', prompt: libraryFormPrompt.positive, data: { ...libraryFormPrompt, characters: libraryFormPrompt.characters.map(character => ({ ...character })) }, ...(existing?.kind === 'prompt' && existing.snapshot ? { snapshot: existing.snapshot } : {}) };
    savedLibrary = [item, ...savedLibrary.filter(value => value.id !== item.id)];
    saveSavedLibrary(savedLibrary);
    closeLibraryModal();
  } catch (error) {
    libraryCoverError = error instanceof Error ? error.message : 'The saved item could not be written.';
    render();
  }
}

async function deleteLibraryItem(item: SavedLibraryItem): Promise<void> {
  if (item.imageAsset) await deleteLibraryImage(item.imageAsset);
  savedLibrary = savedLibrary.filter(value => value.id !== item.id);
  saveSavedLibrary(savedLibrary);
  closeLibraryModal();
}

async function saveMetadataToLibrary(kind: MetadataSaveKind, payload: MetadataSavePayload): Promise<boolean> {
  const now = new Date().toISOString();
  const idValue = id();
  const cover = await saveLibraryImage({ id: idValue, mime: payload.preview.mime, originalName: payload.preview.originalName }, payload.preview.bytes);
  const filenameName = payload.filename.replace(/\.[^.]+$/, '').trim() || (kind === 'artist-mix' ? 'Artist Mix' : 'Metadata prompt');
  const item: SavedLibraryItem = kind === 'artist-mix' && payload.artistMix
    ? { version: 4, id: idValue, kind: 'artist-mix', source: 'metadata', name: filenameName, prompt: payload.artistMix.serializedPrompt, data: payload.artistMix, snapshot: normalizeArtistMix({ anchors: [], companions: [] }), createdAt: now, updatedAt: now, ...cover }
    : { version: 4, id: idValue, kind: 'prompt', source: 'metadata', name: filenameName, prompt: payload.prompt.positive, data: payload.prompt, createdAt: now, updatedAt: now, ...cover };
  savedLibrary = [item, ...savedLibrary];
  saveSavedLibrary(savedLibrary);
  return true;
}

function libraryPromptSide(item: SavedLibraryItem, index: number, polarity: 'positive' | 'negative'): string {
  if (item.kind !== 'prompt') return '';
  if (index < 0) return polarity === 'positive' ? item.data?.positive ?? item.prompt : item.data?.negative ?? '';
  return item.data?.characters[index]?.[polarity] ?? '';
}

function patchLibraryPromptBlock(button: HTMLButtonElement): void {
  const item = savedLibrary.find(value => value.id === button.dataset.libraryPolarity);
  if (!item || item.kind !== 'prompt') return;
  const index = Number(button.dataset.libraryIndex);
  const polarity = button.dataset.polarity === 'negative' ? 'negative' : 'positive';
  const state = libraryPolarities.get(item.id) ?? { base: 'positive' as const, characters: item.data?.characters.map(() => 'positive' as const) ?? [] };
  if (index < 0) state.base = polarity; else state.characters[index] = polarity;
  libraryPolarities.set(item.id, state);
  const block = button.closest<HTMLElement>('[data-library-block]');
  if (!block) return;
  block.querySelectorAll<HTMLButtonElement>('[data-library-polarity]').forEach(toggle => {
    const on = toggle.dataset.polarity === polarity;
    toggle.classList.toggle('on', on);
    toggle.setAttribute('aria-pressed', String(on));
  });
  const value = libraryPromptSide(item, index, polarity);
  const pre = block.querySelector<HTMLElement>('pre');
  if (pre) pre.textContent = value || '(No prompt recorded for this side.)';
  const copyButton = block.querySelector<HTMLButtonElement>('[data-library-copy]');
  if (copyButton) {
    const label = index < 0 ? 'Base prompt' : item.data?.characters[index]?.label ?? `Character ${index + 1}`;
    const copyLabel = `Copy ${label} ${polarity} prompt`;
    copyButton.disabled = !value;
    copyButton.setAttribute('aria-label', copyLabel);
    copyButton.title = copyLabel;
  }
}

function removeLibraryCharacter(characterId: string): void {
  captureLibraryFormDraft();
  const index = libraryFormPrompt.characters.findIndex(character => character.id === characterId);
  if (index < 0) return;
  const characters = libraryFormPrompt.characters.filter(character => character.id !== characterId);
  const focusId = characters[Math.min(index, Math.max(0, characters.length - 1))]?.id;
  libraryFormPrompt = { ...libraryFormPrompt, characters };
  render();
  window.setTimeout(() => {
    const removeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-remove-library-character]')];
    const target = focusId ? removeButtons.find(button => button.dataset.removeLibraryCharacter === focusId) : document.querySelector<HTMLButtonElement>('#add-library-character');
    target?.focus({ preventScroll: true });
    const scroll = document.querySelector<HTMLElement>('[data-library-form-scroll]');
    if (scroll) scroll.scrollTop = libraryFormScrollTop;
  }, 0);
}

function bindSavedLibraryEvents(): void {
  document.querySelector('#saved-library-tab')?.addEventListener('click', () => switchWorkspace('saved-library'));
  document.querySelector('#save-library-prompt')?.addEventListener('click', () => openLibrarySaveModal('prompt', 'manual'));
  document.querySelector('#save-library-mix')?.addEventListener('click', () => openLibrarySaveModal('artist-mix', 'manual'));
  document.querySelector('#save-library-empty')?.addEventListener('click', () => openLibrarySaveModal('prompt', 'manual'));
  document.querySelector('#saved-library-search')?.addEventListener('input', event => { savedLibrarySearch = (event.target as HTMLInputElement).value; render(); });
  document.querySelectorAll<HTMLButtonElement>('[data-library-filter]').forEach(button => button.addEventListener('click', () => { savedLibraryFilter = button.dataset.libraryFilter as typeof savedLibraryFilter; render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-library-copy]').forEach(button => button.addEventListener('click', () => {
    const item = savedLibrary.find(value => value.id === button.dataset.libraryCopy);
    if (!item) return;
    const index = Number(button.dataset.libraryIndex);
    const polarity = index < 0 ? libraryPolarities.get(item.id)?.base ?? 'positive' : libraryPolarities.get(item.id)?.characters[index] ?? 'positive';
    const value = libraryPromptSide(item, index, polarity);
    if (value) void copy(value, `[data-library-copy="${item.id}"][data-library-index="${index}"]`);
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-library-polarity]').forEach(button => button.addEventListener('click', () => patchLibraryPromptBlock(button)));
  document.querySelectorAll<HTMLButtonElement>('[data-edit-library]').forEach(button => button.addEventListener('click', () => openLibraryEditModal(button.dataset.editLibrary!)));
  document.querySelectorAll<HTMLButtonElement>('[data-delete-library]').forEach(button => button.addEventListener('click', () => openLibraryConfirmation('delete', button.dataset.deleteLibrary!)));
  if (!libraryModalMode) return;
  document.querySelector('#close-library-modal')?.addEventListener('click', closeLibraryModal);
  document.querySelector('#cancel-library-action')?.addEventListener('click', closeLibraryModal);
  document.querySelector('#saved-library-form')?.addEventListener('submit', event => { event.preventDefault(); void saveLibraryItemFromForm(); });
  const input = document.querySelector<HTMLInputElement>('#saved-library-cover-input');
  document.querySelector('#choose-library-cover')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => void readLibraryCover(input.files?.[0]));
  const drop = document.querySelector<HTMLElement>('#saved-library-cover-drop');
  for (const eventName of ['dragenter', 'dragover']) drop?.addEventListener(eventName, event => { event.preventDefault(); drop.classList.add('is-dragging'); });
  for (const eventName of ['dragleave', 'drop']) drop?.addEventListener(eventName, event => { event.preventDefault(); drop.classList.remove('is-dragging'); });
  drop?.addEventListener('drop', event => void readLibraryCover((event as DragEvent).dataTransfer?.files[0]));
  document.querySelector('#remove-library-cover')?.addEventListener('click', () => { captureLibraryFormDraft(); libraryCoverRemoved = true; libraryCoverBytes = null; libraryCoverMime = undefined; revokeSavedLibraryImageUrl('__draft__'); render(); });
  document.querySelector('#add-library-character')?.addEventListener('click', () => { captureLibraryFormDraft(); libraryFormPrompt = { ...libraryFormPrompt, characters: [...libraryFormPrompt.characters, { id: id(), label: `Character ${libraryFormPrompt.characters.length + 1}`, positive: '', negative: '' }] }; render(); });
  document.querySelectorAll<HTMLButtonElement>('[data-remove-library-character]').forEach(button => button.addEventListener('click', () => removeLibraryCharacter(button.dataset.removeLibraryCharacter!)));
  document.querySelector('#confirm-library-action')?.addEventListener('click', () => { const item = libraryModalItemId ? savedLibrary.find(value => value.id === libraryModalItemId) : undefined; if (item) void deleteLibraryItem(item); });
  const formScroll = document.querySelector<HTMLElement>('[data-library-form-scroll]');
  if (formScroll) formScroll.scrollTop = libraryFormScrollTop;
}

function bindEvents(): void {
  if (!modalKeyHandlerBound) {
    document.addEventListener('keydown', handleModalKeydown);
    modalKeyHandlerBound = true;
  }
  document.querySelectorAll<HTMLTextAreaElement>('[data-editor]').forEach(area => {
    area.dataset.editorBound = 'true';
    area.addEventListener('input', () => updateEditor(area));
    area.addEventListener('keydown', event => { if (event.key === 'Tab') { const first = suggestions(area)[0]; if (first) { event.preventDefault(); insertSuggestion(area, first); } } });
    area.addEventListener('blur', () => window.setTimeout(() => { const host = document.querySelector<HTMLElement>(`[data-suggestions="${area.dataset.editor}:${area.dataset.editorId}"]`); if (host) host.innerHTML = ''; }, 150));
  });
  document.querySelectorAll<HTMLDetailsElement>('.accordion[data-zone]').forEach(details => details.addEventListener('toggle', () => {
    const zone = details.dataset.zone as Zone | undefined;
    if (zone && zone in accordionOpenState) accordionOpenState[zone] = details.open;
  }));
  document.querySelector('#copy-prompt')?.addEventListener('click', () => void copy(prompt(), '#copy-prompt'));
  document.querySelector('#save-prompt-library')?.addEventListener('click', () => openLibrarySaveModal('prompt', 'prompt-builder'));
  document.querySelector('#copy-artists')?.addEventListener('click', () => void copy(buildArtistsPrompt(base.artists), '#copy-artists'));
  document.querySelector('#reset')?.addEventListener('click', resetPrompt);
  document.querySelector<HTMLSelectElement>('#animation-mode')?.addEventListener('change', event => {
    animationMode = normalizeAnimationMode((event.target as HTMLSelectElement).value);
    settings = { ...settings, animationMode };
    applyAnimationMode(animationMode);
    saveSettings(settings);
    saveDraft(currentDraft());
  });
  document.querySelector('#prompt-tab')?.addEventListener('click', () => switchWorkspace('prompt'));
  document.querySelector('#artist-mix-tab')?.addEventListener('click', () => switchWorkspace('artist-mix'));
  document.querySelector('#custom-tags-tab')?.addEventListener('click', () => switchWorkspace('custom-tags'));
  document.querySelector('#metadata-tab')?.addEventListener('click', () => switchWorkspace('metadata'));
  document.querySelector('#settings-tab')?.addEventListener('click', () => switchWorkspace('settings'));
  document.querySelector('#add-character')?.addEventListener('click', () => { characters.push(newCharacter()); saveSoon(); render(); });
  bindArtistEvents();
  bindCharacterEvents();
  document.querySelector('#open-artist-picker')?.addEventListener('click', event => openArtistPicker(event.currentTarget as HTMLElement));
  document.querySelector('#open-artist-picker-empty')?.addEventListener('click', event => openArtistPicker(event.currentTarget as HTMLElement));
  document.querySelector('#close-artist-picker')?.addEventListener('click', closeArtistPicker);
  document.querySelector('#artist-picker-backdrop')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeArtistPicker(); });
  document.querySelector('#artist-search')?.addEventListener('input', event => { artistSearch = (event.target as HTMLInputElement).value; artistPage = 1; refreshArtistGrid(); });
  document.querySelector('#artist-favorites')?.addEventListener('click', () => { artistFavoritesOnly = !artistFavoritesOnly; artistPage = 1; refreshArtistGrid(); });
  document.querySelector('#artist-previous')?.addEventListener('click', () => { artistPage -= 1; refreshArtistGrid(); });
  document.querySelector('#artist-next')?.addEventListener('click', () => { artistPage += 1; refreshArtistGrid(); });
  document.querySelector('#open-character-picker')?.addEventListener('click', event => openCharacterPicker(event.currentTarget as HTMLElement));
  document.querySelector('#close-character-picker')?.addEventListener('click', closeCharacterPicker);
  document.querySelector('#character-picker-backdrop')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeCharacterPicker(); });
  document.querySelector('#character-search')?.addEventListener('input', event => { characterSearch = (event.target as HTMLInputElement).value; characterPage = 1; refreshCharacterPicker(); });
  document.querySelector('#character-favorites')?.addEventListener('click', () => { characterFavoritesOnly = !characterFavoritesOnly; characterPage = 1; refreshCharacterPicker(); });
  document.querySelector('#character-previous')?.addEventListener('click', () => { characterPage -= 1; refreshCharacterPicker(); });
  document.querySelector('#character-next')?.addEventListener('click', () => { characterPage += 1; refreshCharacterPicker(); });
  document.querySelector('#random-favorites-only')?.addEventListener('click', () => {
    artistRandomFavoritesOnly = !artistRandomFavoritesOnly;
    const range = effectiveRandomRange();
    randomNotice = !range.feasible && artistRandomFavoritesOnly
      ? 'Favorites-only random needs at least 2 favorited V5 artists. Add favorites or turn off Favorites-only.'
      : '';
    render();
  });
  document.querySelector('#reroll-all-weights')?.addEventListener('click', rerollAllWeights);
  document.querySelector('#retry-catalog')?.addEventListener('click', () => { catalogState = 'loading'; catalogError = ''; render(); void loadCatalog(); });
  document.querySelector('#retry-catalog-character')?.addEventListener('click', () => { closeCharacterPicker(); catalogState = 'loading'; catalogError = ''; render(); void loadCatalog(); });
  document.querySelector('#random-artists')?.addEventListener('click', randomizeArtists);
  document.querySelectorAll<HTMLInputElement>('#random-min,#random-max,#random-min-range,#random-max-range').forEach(input => input.addEventListener('input', () => updateRandomRange(input.id)));
  document.querySelectorAll<HTMLButtonElement>('[data-number-step]').forEach(button => {
    const input = button.closest<HTMLElement>('.number-stepper')?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) return;
    button.disabled = input.disabled;
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (input.disabled) return;
      if (button.dataset.numberStep === 'up') input.stepUp();
      else input.stepDown();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-copy-set]').forEach(button => button.addEventListener('click', () => { const set = sets.find(item => item.id === button.dataset.copySet); if (set) void copy(set.prompt, `[data-copy-set="${set.id}"]`); }));
  document.querySelectorAll<HTMLButtonElement>('[data-delete-set]').forEach(button => button.addEventListener('click', () => { sets = sets.filter(item => item.id !== button.dataset.deleteSet); saveSets(sets); render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-open-constructor]').forEach(button => button.addEventListener('click', event => openConstructor((button.dataset.openConstructor as ConstructorZone), event.currentTarget as HTMLElement)));
  document.querySelector('#close-constructor')?.addEventListener('click', closeConstructor);
  document.querySelector('#done-constructor')?.addEventListener('click', closeConstructor);
  document.querySelector('#constructor-backdrop')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeConstructor(); });
  document.querySelector('#constructor-search')?.addEventListener('input', event => { constructorSearch = (event.target as HTMLInputElement).value; refreshConstructorGrid(); });
  document.querySelectorAll<HTMLButtonElement>('[data-constructor-tag]').forEach(button => button.addEventListener('click', () => toggleConstructorCard(button.dataset.constructorTag!)));
  bindCustomTagEvents();
  bindArtistCardPreview();
}

function openArtistPicker(trigger?: HTMLElement): void {
  const picker = document.querySelector<HTMLElement>('#artist-picker-backdrop');
  if (!picker) return;
  artistPickerTrigger = trigger ?? document.activeElement as HTMLElement;
  modal = 'artists';
  picker.hidden = false;
  refreshArtistGrid();
  document.querySelector<HTMLInputElement>('#artist-search')?.focus();
}

function openConstructor(zone: ConstructorZone, trigger?: HTMLElement): void {
  constructorZone = zone;
  constructorTrigger = trigger ?? document.activeElement as HTMLElement;
  constructorSearch = '';
  modal = 'constructor';
  render();
  window.setTimeout(() => document.querySelector<HTMLInputElement>('#constructor-search')?.focus(), 0);
}

function closeConstructor(): void {
  const trigger = constructorTrigger;
  const zone = constructorZone;
  constructorZone = null;
  constructorTrigger = null;
  if (modal === 'constructor') modal = null;
  render();
  const nextTrigger = trigger?.isConnected ? trigger : (zone ? document.querySelector<HTMLElement>(`[data-open-constructor="${zone}"]`) : null);
  if (nextTrigger) nextTrigger.focus();
}

function refreshConstructorGrid(): void {
  if (!constructorZone) return;
  const grid = document.querySelector<HTMLElement>('#constructor-grid');
  if (!grid) return;
  clearArtistCardPreview();
  grid.innerHTML = constructorCards(constructorZone).map(card => constructorCardMarkup(card, constructorZone!)).join('') || '<p class="empty-inline">No constructor cards match this search.</p>';
  document.querySelector<HTMLInputElement>('#constructor-search')?.focus();
  document.querySelectorAll<HTMLButtonElement>('[data-constructor-tag]').forEach(button => button.addEventListener('click', () => toggleConstructorCard(button.dataset.constructorTag!)));
  bindArtistCardPreview();
}

function toggleConstructorCard(cardId: string): void {
  if (!constructorZone) return;
  const card = constructorCards(constructorZone).find(item => item.id === cardId) ?? guideCards.find(item => item.id === cardId);
  if (!card) return;
  const tags = card.kind === 'preset' ? (card.tags ?? qualityPresetTags()) : constructorCardTags(card);
  setZonePrompt(constructorZone, togglePromptTagGroup(zonePrompt(constructorZone), tags));
  updatePrompt();
  saveSoon();
  refreshConstructorGrid();
}

function customImageError(message: string): void {
  const status = document.querySelector<HTMLElement>('#custom-tag-status');
  if (status) status.textContent = message;
}

function imageMime(bytes: Uint8Array): CustomTag['mime'] | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function presetNameKey(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }

function createCustomPreset(): void {
  const input = document.querySelector<HTMLInputElement>('#custom-preset-name');
  const name = input?.value.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '';
  if (!name) { input?.focus(); return; }
  if (customTagPresets.some(preset => presetNameKey(preset.name) === presetNameKey(name))) {
    input?.setCustomValidity('Preset names must be unique.');
    input?.reportValidity();
    return;
  }
  input?.setCustomValidity('');
  const now = new Date().toISOString();
  const preset: CustomTagPreset = { id: `preset-${id()}`, name, createdAt: now, updatedAt: now };
  customTagPresets = [...customTagPresets, preset];
  saveCustomTagPresets(customTagPresets);
  selectedCustomPresetId = preset.id;
  creatingCustomPreset = false;
  render();
}

function renameCustomPreset(presetId: string): void {
  if (presetId === DEFAULT_CUSTOM_TAG_PRESET_ID) { renamingCustomPresetId = null; render(); return; }
  const input = document.querySelector<HTMLInputElement>(`#preset-rename-${presetId}`);
  const name = input?.value.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '';
  if (!name) { input?.focus(); return; }
  if (customTagPresets.some(preset => preset.id !== presetId && presetNameKey(preset.name) === presetNameKey(name))) {
    input?.setCustomValidity('Preset names must be unique.');
    input?.reportValidity();
    return;
  }
  const now = new Date().toISOString();
  customTagPresets = customTagPresets.map(preset => preset.id === presetId ? { ...preset, name, updatedAt: now } : preset);
  saveCustomTagPresets(customTagPresets);
  renamingCustomPresetId = null;
  render();
}

function deleteCustomPreset(presetId: string): void {
  if (presetId === DEFAULT_CUSTOM_TAG_PRESET_ID || !customTagPresets.some(preset => preset.id === presetId)) return;
  customTags = customTags.map(item => customTagPresetId(item) === presetId ? { ...item, presetId: DEFAULT_CUSTOM_TAG_PRESET_ID, updatedAt: new Date().toISOString() } : item);
  customTagPresets = customTagPresets.filter(preset => preset.id !== presetId);
  selectedCustomPresetId = DEFAULT_CUSTOM_TAG_PRESET_ID;
  deletingCustomPresetId = null;
  saveCustomTagPresets(customTagPresets);
  saveCustomTags(customTags);
  render();
}

function bindCustomTagEvents(): void {
  if (activeWorkspace !== 'custom-tags') return;
  document.querySelector('#custom-tag-search')?.addEventListener('input', event => { customTagSearch = (event.target as HTMLInputElement).value; render(); });
  document.querySelectorAll<HTMLButtonElement>('[data-custom-filter]').forEach(button => button.addEventListener('click', () => { customTagFilter = button.dataset.customFilter as ConstructorZone | 'artist' | 'all'; render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-select-preset]').forEach(button => button.addEventListener('click', () => {
    selectedCustomPresetId = button.dataset.selectPreset === 'all' ? 'all' : (button.dataset.selectPreset ?? DEFAULT_CUSTOM_TAG_PRESET_ID);
    deletingCustomPresetId = null;
    render();
  }));
  document.querySelector('#create-preset')?.addEventListener('click', () => { creatingCustomPreset = true; render(); window.setTimeout(() => document.querySelector<HTMLInputElement>('#custom-preset-name')?.focus(), 0); });
  document.querySelector('#cancel-create-preset')?.addEventListener('click', () => { creatingCustomPreset = false; render(); });
  document.querySelector<HTMLFormElement>('#custom-preset-form')?.addEventListener('submit', event => { event.preventDefault(); createCustomPreset(); });
  document.querySelectorAll<HTMLButtonElement>('[data-rename-preset]').forEach(button => button.addEventListener('click', () => { renamingCustomPresetId = button.dataset.renamePreset!; deletingCustomPresetId = null; render(); window.setTimeout(() => document.getElementById(`preset-rename-${renamingCustomPresetId!}`)?.focus(), 0); }));
  document.querySelectorAll<HTMLButtonElement>('[data-cancel-rename]').forEach(button => button.addEventListener('click', () => { renamingCustomPresetId = null; render(); }));
  document.querySelectorAll<HTMLFormElement>('[data-preset-rename-form]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); renameCustomPreset(form.dataset.presetRenameForm!); }));
  document.querySelectorAll<HTMLButtonElement>('[data-delete-preset]').forEach(button => button.addEventListener('click', () => { deletingCustomPresetId = button.dataset.deletePreset!; renamingCustomPresetId = null; render(); }));
  document.querySelector('#cancel-delete-preset')?.addEventListener('click', () => { deletingCustomPresetId = null; render(); });
  document.querySelector<HTMLButtonElement>('[data-confirm-delete-preset]')?.addEventListener('click', () => deleteCustomPreset(document.querySelector<HTMLButtonElement>('[data-confirm-delete-preset]')!.dataset.confirmDeletePreset!));
  document.querySelector('#cancel-custom-edit')?.addEventListener('click', () => { editingCustomTagId = null; customTagFormKind = 'tag'; customImageBytes = null; customImageMime = null; customImageName = ''; clearDraftCustomImage(); render(); });
  document.querySelectorAll<HTMLButtonElement>('[data-edit-custom-tag]').forEach(button => button.addEventListener('click', () => { const item = customTags.find(tag => tag.id === button.dataset.editCustomTag); if (!item) return; editingCustomTagId = item.id; customTagFormKind = item.kind === 'artist' ? 'artist' : 'tag'; selectedCustomPresetId = customTagPresetId(item); customImageBytes = null; customImageMime = null; customImageName = ''; clearDraftCustomImage(); render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-delete-custom-tag]').forEach(button => button.addEventListener('click', () => void deleteCustomTag(button.dataset.deleteCustomTag!)));
  const fileInput = document.querySelector<HTMLInputElement>('#custom-tag-image');
  const dropZone = document.querySelector<HTMLElement>('#custom-image-drop');
  fileInput?.addEventListener('change', event => void readCustomImage((event.target as HTMLInputElement).files?.[0]));
  document.querySelector('#custom-tag-choose')?.addEventListener('click', event => { event.stopPropagation(); fileInput?.click(); });
  dropZone?.addEventListener('click', event => { if (event.target !== fileInput) fileInput?.click(); });
  dropZone?.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput?.click(); } });
  dropZone?.addEventListener('dragenter', event => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
  dropZone?.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
  dropZone?.addEventListener('dragleave', event => { event.preventDefault(); if (!dropZone.contains(event.relatedTarget as Node | null)) dropZone.classList.remove('is-dragging'); });
  dropZone?.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('is-dragging'); void readCustomImage(event.dataTransfer?.files?.[0]); });
  document.querySelector<HTMLSelectElement>('#custom-card-kind')?.addEventListener('change', event => {
    customTagFormKind = (event.target as HTMLSelectElement).value === 'artist' ? 'artist' : 'tag';
    render();
  });
  document.querySelectorAll<HTMLInputElement>('[data-custom-zone]').forEach(input => input.addEventListener('change', () => { document.querySelectorAll('.zone-choice').forEach(label => label.classList.toggle('selected', (label.querySelector('input') as HTMLInputElement | null)?.checked ?? false)); }));
  document.querySelector<HTMLFormElement>('#custom-tag-form')?.addEventListener('submit', event => { event.preventDefault(); void saveCustomTagFromForm(); });
}

async function readCustomImage(file?: File): Promise<void> {
  if (!file) return;
  const setImageStatus = (message: string) => { const status = document.querySelector<HTMLElement>('#custom-image-status'); if (status) status.textContent = message; };
  if (file.size > 20 * 1024 * 1024) { customImageError('The image is larger than 20 MiB.'); setImageStatus('Choose a smaller image.'); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = imageMime(bytes);
  if (!mime) { customImageError('The file signature is not a supported PNG, JPEG, or WebP image.'); setImageStatus('That file is not a supported image.'); return; }
  customImageBytes = bytes;
  customImageMime = mime;
  customImageName = file.name;
  setCustomImageUrl('__draft__', URL.createObjectURL(file));
  const preview = document.querySelector<HTMLElement>('#custom-image-preview');
  if (preview) {
    preview.classList.remove('is-empty');
    preview.classList.add('is-loaded');
    preview.innerHTML = `<img src="${escapeHtml(customImageUrls.get('__draft__')!)}" alt="New custom tag preview">`;
  }
  const drop = document.querySelector<HTMLElement>('#custom-image-drop');
  drop?.classList.remove('is-dragging');
  drop?.classList.add('has-image');
  drop?.querySelector<HTMLElement>('.custom-image-empty-content')?.setAttribute('hidden', '');
  customImageError('Image ready to save.');
  setImageStatus(`${file.name} is ready.`);
}

async function saveCustomTagFromForm(): Promise<void> {
  const kind: CustomTagKind = document.querySelector<HTMLSelectElement>('#custom-card-kind')?.value === 'artist' ? 'artist' : 'tag';
  const rawTag = document.querySelector<HTMLInputElement>('#custom-tag-name')?.value.trim() ?? '';
  const tag = kind === 'artist' ? artistDisplayName(rawTag) : rawTag;
  const zone = document.querySelector<HTMLInputElement>('[data-custom-zone]:checked')?.value as ConstructorZone;
  const description = document.querySelector<HTMLTextAreaElement>('#custom-tag-description')?.value ?? '';
  const existing = customTags.find(item => item.id === editingCustomTagId);
  const group = splitTagGroup(tag);
  const validZone = ['frame', 'scene', 'render'].includes(zone);
  if (!tag || (kind === 'tag' && (!group.length || !validZone))) { customImageError(kind === 'artist' ? 'Artist name is required.' : 'Tag and constructor are required.'); return; }
  if (kind === 'tag' && !existing?.imageAsset && !customImageBytes) { customImageError('Choose an image before saving a prompt tag.'); return; }
  const duplicate = customTags.find(item => {
    if (item.id === existing?.id || (item.kind === 'artist') !== (kind === 'artist')) return false;
    return kind === 'artist'
      ? canonicalArtistIdentity(item.tag) === canonicalArtistIdentity(tag)
      : canonicalCustomTagIdentity(item.zone, item.tag) === canonicalCustomTagIdentity(zone, tag);
  });
  if (duplicate) { customImageError('A custom tag with this name already exists in that constructor.'); return; }
  const now = new Date().toISOString();
  const destinationPresetId = selectedCustomPresetId === 'all' ? DEFAULT_CUSTOM_TAG_PRESET_ID : customPreset(selectedCustomPresetId).id;
  const effectiveZone = validZone ? zone : existing?.zone ?? 'frame';
  let saved: CustomTag = existing ? { ...existing, kind, tag, zone: effectiveZone, presetId: destinationPresetId, description, updatedAt: now } : { id: id(), kind, tag, zone: effectiveZone, presetId: destinationPresetId, description, ...(customImageBytes && customImageMime ? { imageAsset: `memory-${id()}`, mime: customImageMime, originalName: customImageName } : {}), createdAt: now, updatedAt: now };
  if (customImageBytes && customImageMime) {
    if (window.naiStorage?.saveCustomTag) {
      const previousAsset = existing?.imageAsset;
      try {
        saved = await window.naiStorage.saveCustomTag({ id: saved.id, kind, tag, zone: effectiveZone, presetId: destinationPresetId, description, mime: customImageMime, originalName: customImageName, createdAt: saved.createdAt, updatedAt: now }, customImageBytes);
        if (previousAsset && previousAsset !== saved.imageAsset) await window.naiStorage.deleteCustomTag?.(previousAsset);
      }
      catch (error) { customImageError(error instanceof Error ? error.message : 'The image could not be saved.'); return; }
    } else {
      const draftUrl = customImageUrls.get('__draft__');
      if (draftUrl) setCustomImageUrl(saved.id, draftUrl);
    }
  }
  customTags = [...customTags.filter(item => item.id !== saved.id), saved];
  rebuildEffectiveArtistCatalog();
  saveCustomTags(customTags);
  if (window.naiStorage?.saveCustomTag) clearDraftCustomImage();
  else {
    // The browser session keeps its blob URL as the card's live image. Drop
    // only the draft alias so saving does not revoke the image still in use.
    customImageUrls.delete('__draft__');
  }
  editingCustomTagId = null; customTagFormKind = 'tag'; customImageBytes = null; customImageMime = null; customImageName = '';
  render();
}

async function deleteCustomTag(tagId: string): Promise<void> {
  const item = customTags.find(tag => tag.id === tagId);
  if (!item) return;
  const customArtistId = item.kind === 'artist' ? customArtistCatalogId(item.id) : null;
  const shadowed = item.kind === 'artist' && shadowedCustomArtistIds.has(item.id);
  if (window.naiStorage?.deleteCustomTag && item.imageAsset && !item.imageAsset.startsWith('memory-')) await window.naiStorage.deleteCustomTag(item.imageAsset);
  customTags = customTags.filter(tag => tag.id !== tagId);
  if (customArtistId && !shadowed) {
    base.artists = base.artists.filter(item => (item.catalogId ?? item.id) !== customArtistId);
    artistFavorites.delete(customArtistId);
    artistMix = {
      ...artistMix,
      anchors: artistMix.anchors.filter(item => (item.catalogId ?? item.id) !== customArtistId),
      companions: artistMix.companions.filter(item => (item.catalogId ?? item.id) !== customArtistId)
    };
    saveFavorites(artistFavorites, 'artists');
  }
  rebuildEffectiveArtistCatalog();
  revokeCustomImageUrl(tagId);
  if (editingCustomTagId === tagId) {
    editingCustomTagId = null; customTagFormKind = 'tag';
    customImageBytes = null;
    customImageMime = null;
    customImageName = '';
    clearDraftCustomImage();
  }
  saveCustomTags(customTags);
  render();
}
function closeArtistPicker(): void {
  const picker = document.querySelector<HTMLElement>('#artist-picker-backdrop');
  if (picker) picker.hidden = true;
  if (modal === 'artists') modal = null;
  const trigger = artistPickerTrigger;
  artistPickerTrigger = null;
  if (trigger?.isConnected) trigger.focus();
}

function openCharacterPicker(trigger?: HTMLElement): void {
  const picker = document.querySelector<HTMLElement>('#character-picker-backdrop');
  if (!picker) return;
  characterPickerTrigger = trigger ?? document.activeElement as HTMLElement;
  modal = 'characters';
  picker.hidden = false;
  window.setTimeout(() => document.querySelector<HTMLInputElement>('#character-search')?.focus(), 0);
}

function closeCharacterPicker(): void {
  const picker = document.querySelector<HTMLElement>('#character-picker-backdrop');
  if (picker) picker.hidden = true;
  if (modal === 'characters') modal = null;
  const trigger = characterPickerTrigger;
  characterPickerTrigger = null;
  if (trigger?.isConnected) trigger.focus();
}

function focusField(selector: string): void { window.setTimeout(() => document.querySelector<HTMLInputElement>(selector)?.focus(), 0); }
function bindArtistEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-add-artist]').forEach(button => button.addEventListener('click', () => addArtist(button.dataset.addArtist!)));
  document.querySelectorAll<HTMLButtonElement>('[data-copy-artist]').forEach(button => button.addEventListener('click', () => { const card = catalog.artists.find(item => (item.catalogId ?? item.id) === button.dataset.copyArtist); if (card) void copy(serializeTag(weighted(card)) ?? '', `[data-copy-artist="${card.catalogId ?? card.id}"]`); }));
  document.querySelectorAll<HTMLButtonElement>('[data-favorite-artist]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    toggleFavorite(button.dataset.favoriteArtist!, 'artists', true);
  }));
  document.querySelectorAll<HTMLInputElement>('[data-artist-weight],[data-artist-range]').forEach(input => input.addEventListener('input', () => {
    const id = input.dataset.artistWeight ?? input.dataset.artistRange;
    const item = base.artists.find(artist => artist.id === id);
    if (!item) return;
    item.weight = normalizeArtistWeight(input.value);
    document.querySelectorAll<HTMLInputElement>(`[data-artist-weight="${id}"],[data-artist-range="${id}"]`).forEach(control => { control.value = item.weight.toFixed(1); });
    const code = document.querySelector<HTMLElement>(`[data-selected-artist="${id}"] code`);
    if (code) code.textContent = serializeTag(item) ?? '';
    updatePrompt();
    saveSoon();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-reroll-weight]').forEach(button => button.addEventListener('click', () => {
    const index = base.artists.findIndex(artist => artist.id === button.dataset.rerollWeight);
    if (index < 0) return;
    base.artists[index] = rerollArtistWeight(base.artists[index]);
    saveSoon();
    render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-remove-artist]').forEach(button => button.addEventListener('click', () => { base.artists = base.artists.filter(item => item.id !== button.dataset.removeArtist); render(); }));
}
function bindCharacterEvents(): void {
  bindCharacterBlockEvents();
  bindCharacterPickerEvents();
}
function bindCharacterBlockEvents(): void {
  document.querySelectorAll<HTMLTextAreaElement>('[data-editor]').forEach(area => {
    if (area.dataset.editor !== 'character' && area.dataset.editor !== 'undesired') return;
    if (area.dataset.editorBound === 'true') return;
    area.dataset.characterBound = 'true';
    area.dataset.editorBound = 'true';
    area.addEventListener('input', () => updateEditor(area));
    area.addEventListener('keydown', event => { if (event.key === 'Tab') { const first = suggestions(area)[0]; if (first) { event.preventDefault(); insertSuggestion(area, first); } } });
    area.addEventListener('blur', () => window.setTimeout(() => {
      const host = document.querySelector<HTMLElement>(`[data-suggestions="${area.dataset.editor}:${area.dataset.editorId}"]`);
      if (host) host.innerHTML = '';
    }, 150));
  });
  document.querySelectorAll<HTMLInputElement>('[data-character-name]').forEach(input => input.addEventListener('input', () => { const item = characters.find(character => character.id === input.dataset.characterName); if (item) { item.label = input.value; saveSoon(); } }));
  document.querySelectorAll<HTMLButtonElement>('[data-copy-character]').forEach(button => button.addEventListener('click', () => { const item = characters.find(character => character.id === button.dataset.copyCharacter); if (item) void copy(buildCharacterPrompt(item), `[data-copy-character="${item.id}"]`); }));
  document.querySelectorAll<HTMLButtonElement>('[data-remove-character]').forEach(button => button.addEventListener('click', () => { characters = characters.filter(item => item.id !== button.dataset.removeCharacter); render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-character-details]').forEach(button => button.addEventListener('click', () => { detailCharacterId = button.dataset.characterDetails!; modal = 'character-details'; renderDetailsModal(); }));
}
function bindCharacterPickerEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-pick-character]').forEach(button => button.addEventListener('click', () => {
    const card = catalog.characters.find(item => item.id === button.dataset.pickCharacter);
    if (!card) return;
    characters.push(newCharacter(card.tag, `girl, ${card.tag}`));
    saveSoon();
    renderCharacterList();
    refreshCharacterPicker();
    focusField('#character-search');
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-favorite-character]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    toggleFavorite(button.dataset.favoriteCharacter!, 'characters');
  }));
}

function refreshArtistGrid(options: { preserveScroll?: boolean; focusFavoriteId?: string } = {}): void {
  const grid = document.querySelector<HTMLElement>('#artist-grid');
  if (!grid) return;
  const previousScrollTop = options.preserveScroll ? grid.scrollTop : 0;
  const page = promptArtistPickerPage();
  grid.innerHTML = page.cards.map(artistCard).join('') || `<p class="empty-inline" role="status">${artistFavoritesOnly ? 'No favorited V5 artists match this search.' : 'No V5 artists match this search.'}</p>`;
  grid.scrollTop = previousScrollTop;
  const favoritesButton = document.querySelector<HTMLButtonElement>('#artist-favorites');
  favoritesButton?.classList.toggle('on', artistFavoritesOnly);
  favoritesButton?.setAttribute('aria-pressed', String(artistFavoritesOnly));
  const count = document.querySelector<HTMLElement>('#artist-count');
  if (count) count.textContent = `${page.filteredCount.toLocaleString()} of ${catalog.artists.length.toLocaleString()} cards`;
  const pageStatus = document.querySelector<HTMLElement>('#artist-page-status');
  if (pageStatus) pageStatus.textContent = page.pageCount ? `Page ${page.page} of ${page.pageCount}` : 'Page 0 of 0';
  const previous = document.querySelector<HTMLButtonElement>('#artist-previous');
  const next = document.querySelector<HTMLButtonElement>('#artist-next');
  if (previous) previous.disabled = !page.hasPrevious;
  if (next) next.disabled = !page.hasNext;
  bindArtistEvents();
  bindArtistCardPreview();
  if (options.focusFavoriteId) {
    const favoriteButton = Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-favorite-artist]'))
      .find(button => button.dataset.favoriteArtist === options.focusFavoriteId);
    favoriteButton?.focus({ preventScroll: true });
  }
}

function renderCharacterList(): void {
  const list = document.querySelector<HTMLElement>('.character-list');
  if (list) list.innerHTML = characters.length ? characters.map(characterBlock).join('') : '<p class="empty-inline">Add a character from the catalog or browse the full catalog.</p>';
  const total = document.querySelector<HTMLElement>('#character-total');
  if (total) total.textContent = String(characters.length);
  bindCharacterBlockEvents();
}

function refreshCharacterPicker(): void {
  const grid = document.querySelector<HTMLElement>('#character-grid');
  const status = document.querySelector<HTMLElement>('#character-picker-status');
  const count = document.querySelector<HTMLElement>('#character-picker-count');
  const pageStatus = document.querySelector<HTMLElement>('#character-page-status');
  const previous = document.querySelector<HTMLButtonElement>('#character-previous');
  const next = document.querySelector<HTMLButtonElement>('#character-next');
  if (!grid || !status || !count || !pageStatus || !previous || !next) return;
  const page = paginateCharacters(catalog.characters, { query: characterSearch, favoritesOnly: characterFavoritesOnly, favoriteIds: characterFavorites, page: characterPage });
  characterPage = page.page;
  grid.innerHTML = page.cards.map(characterCard).join('');
  status.innerHTML = characterPickerStatus(page);
  count.textContent = `${page.filteredCount.toLocaleString()} of ${catalog.characters.length.toLocaleString()} cards`;
  pageStatus.textContent = page.pageCount ? `Page ${page.page} of ${page.pageCount}` : 'Page 0 of 0';
  previous.disabled = !page.hasPrevious;
  next.disabled = !page.hasNext;
  const favoritesButton = document.querySelector<HTMLButtonElement>('#character-favorites');
  favoritesButton?.classList.toggle('on', characterFavoritesOnly);
  favoritesButton?.setAttribute('aria-pressed', String(characterFavoritesOnly));
  bindCharacterPickerEvents();
  status.querySelector('#retry-catalog-character')?.addEventListener('click', () => { closeCharacterPicker(); catalogState = 'loading'; catalogError = ''; render(); void loadCatalog(); });
}
function addArtist(cardId: string): void {
  const card = catalog.artists.find(item => (item.catalogId ?? item.id) === cardId);
  if (!card || base.artists.some(item => item.catalogId === (card.catalogId ?? card.id))) return;
  base.artists.push(weighted(card));
  render();
  openArtistPicker(document.querySelector<HTMLElement>('#open-artist-picker') ?? undefined);
  focusField('#artist-search');
}

function saveArtistMixSoon(): void { saveArtistMix(artistMix); }
function setMixPrimary(card: CatalogCard): void {
  const stableId = card.catalogId ?? card.id;
  if (artistMix.anchors.some(item => (item.catalogId ?? item.id) === stableId)) { closeMixPicker(); return; }
  if (artistMix.anchors.length >= 4) { mixNotice = 'Artist Mix supports up to 4 anchors.'; closeMixPicker(); render(); return; }
  const existing = artistMix.companions.find(item => (item.catalogId ?? item.id) === stableId);
  artistMix = { ...artistMix, anchors: [...artistMix.anchors, existing ?? weighted(card)], companions: artistMix.companions.filter(item => (item.catalogId ?? item.id) !== stableId) };
  mixNotice = 'Anchor added. It will stay fixed during Mix and companion rerolls.';
  saveArtistMixSoon();
  closeMixPicker();
  render();
}
function addMixCompanion(card: CatalogCard): void {
  const stableId = card.catalogId ?? card.id;
  if (artistMix.anchors.some(item => (item.catalogId ?? item.id) === stableId) || artistMix.companions.some(item => item.catalogId === stableId) || artistMix.companions.length >= mixCompanionCapacity(artistMix.anchors.length)) return;
  artistMix = { ...artistMix, companions: [...artistMix.companions, weighted(card)] };
  saveArtistMixSoon();
  closeMixPicker();
  render();
}
function randomizeMix(): void {
  if (!catalog.artists.length) { mixNotice = 'The V5 catalog is still loading.'; render(); return; }
  const anchors = artistMix.anchors;
  if (!anchors.length) { mixNotice = 'Choose an anchor artist first.'; render(); return; }
  const anchorIds = new Set(anchors.map(item => item.catalogId ?? item.id));
  const availablePool = catalog.artists.filter(card => !anchorIds.has(card.catalogId ?? card.id) && (!artistMix.favoritesOnly || artistFavorites.has(card.catalogId ?? card.id)));
  const minimum = Math.min(12, Math.max(2, anchors.length + (anchors.length > 1 ? 1 : 0)));
  const maxTotal = anchors.length + mixCompanionCapacity(anchors.length);
  const requested = { min: Math.max(minimum, Math.min(maxTotal, artistMix.randomRange.min)), max: Math.max(minimum, Math.min(maxTotal, artistMix.randomRange.max)) };
  const range = resolveRandomPoolRange(requested, Math.min(maxTotal, availablePool.length + anchors.length), minimum);
  if (!range.feasible) { mixNotice = artistMix.favoritesOnly ? 'Favorites-only Mix needs at least 1 companion card.' : 'Artist Mix needs at least 2 V5 artist cards. Your current mix was kept.'; render(); return; }
  const total = randomCount(range.min, range.max);
  const companions = randomArtistSelection(availablePool, Math.max(0, total - anchors.length)).map(({ card, weight }) => weighted(card, weight));
  const nextMix: ArtistMixDraft = { ...artistMix, anchors, companions, randomRange: { min: range.min, max: range.max } };
  const notice = `Mixed ${total} artists. ${anchors.length} anchor${anchors.length === 1 ? '' : 's'} stayed fixed.`;
  commitArtistMix(nextMix, notice);
}
function rerollMixCompanionWeights(): void {
  artistMix = { ...artistMix, companions: rerollArtistWeights(artistMix.companions) };
  mixNotice = artistMix.companions.length ? 'Rerolled companion weights. Anchors stayed unchanged.' : 'Add a companion before rerolling companion weights.';
  saveArtistMixSoon();
  render();
}
function closeMixPicker(): void {
  const picker = document.querySelector<HTMLElement>('#mix-picker-backdrop');
  if (picker) picker.hidden = true;
  if (modal === 'artists') modal = null;
  clearArtistCardPreview();
  const trigger = mixPickerTrigger;
  mixPickerTrigger = null;
  if (trigger?.isConnected) trigger.focus();
}
function openMixPicker(mode: 'primary' | 'companion' = 'primary', trigger?: HTMLElement): void {
  const picker = document.querySelector<HTMLElement>('#mix-picker-backdrop');
  if (!picker) return;
  mixPickerMode = mode;
  mixArtistPage = 1;
  mixPickerTrigger = trigger ?? document.activeElement as HTMLElement;
  modal = 'artists';
  picker.hidden = false;
  refreshMixPicker();
  window.setTimeout(() => document.querySelector<HTMLInputElement>('#mix-artist-search')?.focus(), 0);
}
function refreshMixPicker(): void {
  const grid = document.querySelector<HTMLElement>('#mix-artist-grid');
  if (!grid) return;
  const page = currentMixArtistPickerPage();
  grid.innerHTML = page.cards.map(card => { const stable = card.catalogId ?? card.id; const selected = artistMix.anchors.some(item => (item.catalogId ?? item.id) === stable); return `<article class="artist-card ${selected ? 'selected' : ''}"><button class="artist-pick" type="button" data-mix-pick="${escapeHtml(stable)}" data-artist-preview-image="${catalogImage(card)}" data-artist-preview-tag="${escapeHtml(card.tag)}" data-artist-preview-prompt="artist: ${escapeHtml(card.tag)}"><span class="card-image"><img src="${catalogImage(card)}" alt="${escapeHtml(card.tag)}" loading="lazy"></span><b>${escapeHtml(card.tag)}</b></button></article>`; }).join('') || '<p class="empty-inline">No V5 artists match this search.</p>';
  grid.scrollTop = 0;
  document.querySelector<HTMLElement>('#mix-picker-count')?.replaceChildren(document.createTextNode(`${page.filteredCount.toLocaleString()} of ${catalog.artists.length.toLocaleString()} cards`));
  const pageStatus = document.querySelector<HTMLElement>('#mix-artist-page-status');
  if (pageStatus) pageStatus.textContent = page.pageCount ? `Page ${page.page} of ${page.pageCount}` : 'Page 0 of 0';
  const previous = document.querySelector<HTMLButtonElement>('#mix-artist-previous');
  const next = document.querySelector<HTMLButtonElement>('#mix-artist-next');
  if (previous) previous.disabled = !page.hasPrevious;
  if (next) next.disabled = !page.hasNext;
  const favoritesButton = document.querySelector<HTMLButtonElement>('#mix-picker-favorites');
  favoritesButton?.classList.toggle('on', artistMix.favoritesOnly);
  favoritesButton?.setAttribute('aria-pressed', String(artistMix.favoritesOnly));
  grid.querySelectorAll<HTMLButtonElement>('[data-mix-pick]').forEach(button => button.addEventListener('click', () => { const card = catalog.artists.find(item => (item.catalogId ?? item.id) === button.dataset.mixPick); if (card) mixPickerMode === 'companion' ? addMixCompanion(card) : setMixPrimary(card); }));
  bindArtistCardPreview();
}
function bindArtistMixEvents(): void {
  document.querySelector('#enter-mix-focus')?.addEventListener('click', () => { focusMode = true; render(); });
  document.querySelector('#exit-mix-focus')?.addEventListener('click', () => { focusMode = false; render(); });
  document.querySelector('#mix-artists')?.addEventListener('click', randomizeMix);
  document.querySelector('#mix-reroll-companion-weights')?.addEventListener('click', rerollMixCompanionWeights);
  document.querySelector('#copy-mix-prompt')?.addEventListener('click', () => void copy(buildArtistsPrompt(mixArtists()), '#copy-mix-prompt'));
  document.querySelector('#save-mix-library')?.addEventListener('click', () => openLibrarySaveModal('artist-mix', 'artist-mix'));
  document.querySelector('#open-mix-primary-picker')?.addEventListener('click', event => openMixPicker('primary', event.currentTarget as HTMLElement));
  document.querySelector('#open-mix-primary-picker-empty')?.addEventListener('click', event => openMixPicker('primary', event.currentTarget as HTMLElement));
  document.querySelector('#open-mix-companion-picker')?.addEventListener('click', event => openMixPicker('companion', event.currentTarget as HTMLElement));
  document.querySelector('#close-mix-picker')?.addEventListener('click', closeMixPicker);
  document.querySelector('#mix-picker-backdrop')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeMixPicker(); });
  document.querySelector('#mix-artist-search')?.addEventListener('input', event => { artistSearch = (event.target as HTMLInputElement).value; mixArtistPage = 1; refreshMixPicker(); });
  document.querySelector('#mix-picker-favorites')?.addEventListener('click', () => { artistMix = { ...artistMix, favoritesOnly: !artistMix.favoritesOnly }; mixArtistPage = 1; saveArtistMixSoon(); refreshMixPicker(); });
  document.querySelector('#mix-artist-previous')?.addEventListener('click', () => { mixArtistPage -= 1; refreshMixPicker(); });
  document.querySelector('#mix-artist-next')?.addEventListener('click', () => { mixArtistPage += 1; refreshMixPicker(); });
  document.querySelector('#mix-favorites-only')?.addEventListener('click', () => { artistMix = { ...artistMix, favoritesOnly: !artistMix.favoritesOnly }; saveArtistMixSoon(); render(); });
  document.querySelectorAll<HTMLInputElement>('#mix-random-min,#mix-random-max').forEach(input => input.addEventListener('input', () => {
    const maxTotal = artistMix.anchors.length + mixCompanionCapacity(artistMix.anchors.length);
    const requiredMin = Math.min(maxTotal, Math.max(2, artistMix.anchors.length + (artistMix.anchors.length > 1 ? 1 : 0)));
    const min = Math.max(requiredMin, Number(document.querySelector<HTMLInputElement>('#mix-random-min')?.value) || 2);
    const max = Number(document.querySelector<HTMLInputElement>('#mix-random-max')?.value) || min;
    artistMix = { ...artistMix, randomRange: normalizeRange({ min, max }, maxTotal) };
    saveArtistMixSoon();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-mix-remove]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.mixRemove;
    const isAnchor = artistMix.anchors.some(item => item.id === target);
    if (isAnchor && artistMix.anchors.length === 1 && !artistMix.companions.length) { mixNotice = 'Artist Mix always keeps one anchor. Add another artist first.'; render(); return; }
    let anchors = artistMix.anchors.filter(item => item.id !== target);
    let companions = artistMix.companions.filter(item => item.id !== target);
    if (!anchors.length && companions.length) { anchors = [companions[0]]; companions = companions.slice(1); mixNotice = 'The first companion became the anchor.'; }
    artistMix = { ...artistMix, anchors, companions };
    saveArtistMixSoon(); render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-mix-pin]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.mixPin;
    const anchor = artistMix.anchors.find(item => item.id === target);
    if (anchor) {
      if (artistMix.anchors.length === 1) { mixNotice = 'At least one anchor must stay pinned.'; render(); return; }
      const anchors = artistMix.anchors.filter(item => item.id !== target);
      artistMix = { ...artistMix, anchors, companions: [...artistMix.companions, anchor].slice(0, mixCompanionCapacity(anchors.length)) };
      mixNotice = 'Artist unpinned and returned to the companion ring.';
    } else {
      const companion = artistMix.companions.find(item => item.id === target);
      if (!companion) return;
      if (artistMix.anchors.length >= 4) { mixNotice = 'Artist Mix supports up to 4 anchors.'; render(); return; }
      const anchors = [...artistMix.anchors, companion];
      artistMix = { ...artistMix, anchors, companions: artistMix.companions.filter(item => item.id !== target).slice(0, mixCompanionCapacity(anchors.length)) };
      mixNotice = 'Artist pinned as an anchor.';
    }
    saveArtistMixSoon(); render();
  }));
  document.querySelectorAll<HTMLInputElement>('[data-mix-weight],[data-mix-weight-range]').forEach(input => input.addEventListener('input', () => {
    const target = input.dataset.mixWeight ?? input.dataset.mixWeightRange;
    const update = (item: WeightedTag): WeightedTag => item.id === target ? { ...item, weight: normalizeArtistWeight(input.value) } : item;
    artistMix = { ...artistMix, anchors: artistMix.anchors.map(update), companions: artistMix.companions.map(update) };
    const current = mixArtists().find(item => item.id === target);
    document.querySelectorAll<HTMLInputElement>(`[data-mix-weight="${target}"],[data-mix-weight-range="${target}"]`).forEach(control => { control.value = String(current?.weight ?? 1); });
    const companion = artistMix.companions.find(item => item.id === target);
    const orbitSlot = input.closest<HTMLElement>('.mix-orbit-slot');
    if (companion && orbitSlot) orbitSlot.style.setProperty('--mix-weight-scale', String(mixCompanionScale(companion.weight)));
    document.querySelector('#mix-prompt-output')?.replaceChildren(document.createTextNode(buildArtistsPrompt(mixArtists())));
    saveArtistMixSoon();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-mix-reroll]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.mixReroll;
    artistMix = { ...artistMix, anchors: artistMix.anchors.map(item => item.id === target ? rerollArtistWeight(item) : item), companions: artistMix.companions.map(item => item.id === target ? rerollArtistWeight(item) : item) };
    saveArtistMixSoon(); render();
  }));
}

function bindSettingsEvents(): void {
  // Legacy compatibility marker: animationMode = normalizeAnimationMode(value); applyAnimationMode(animationMode); saveDraft(currentDraft());
  document.querySelector<HTMLSelectElement>('#animation-mode')?.addEventListener('change', event => {
    animationMode = normalizeAnimationMode((event.target as HTMLSelectElement).value);
    settings = { ...settings, animationMode };
    applyAnimationMode(animationMode);
    saveSettings(settings);
    saveDraft(currentDraft());
  });
  document.querySelector<HTMLInputElement>('#preload-character-previews')?.addEventListener('change', event => {
    settings = { ...settings, preloadCharacterPreviews: (event.target as HTMLInputElement).checked };
    saveSettings(settings);
    render();
  });
  document.querySelector<HTMLSelectElement>('#studio-theme')?.addEventListener('change', event => {
    const value = (event.target as HTMLSelectElement).value;
    settings = { ...settings, theme: studioThemes.some(theme => theme.id === value) ? value as AppSettings['theme'] : 'arcane-gold' };
    applyTheme(); saveSettings(settings);
  });
  document.querySelector<HTMLInputElement>('#startup-catalog-update')?.addEventListener('change', event => { settings = { ...settings, updateCatalogOnStartup: (event.target as HTMLInputElement).checked }; saveSettings(settings); });
  document.querySelector<HTMLInputElement>('#startup-app-update')?.addEventListener('change', event => { settings = { ...settings, checkAppUpdatesOnStartup: (event.target as HTMLInputElement).checked }; saveSettings(settings); });
  document.querySelector('#replay-guide')?.addEventListener('click', () => { startGuide(true); render(); });
  document.querySelector('#check-app-update')?.addEventListener('click', () => void checkAppUpdate(true));
  document.querySelector('#download-app-update')?.addEventListener('click', () => void downloadAppUpdate());
  document.querySelector('#resume-app-update')?.addEventListener('click', () => void downloadAppUpdate());
  document.querySelector('#cancel-app-update')?.addEventListener('click', () => void cancelAppUpdate());
  document.querySelector('#install-app-update')?.addEventListener('click', () => void installAppUpdate());
  document.querySelector('#download-missing-v5')?.addEventListener('click', () => void startCatalogUpdate());
  document.querySelector('#cancel-v5-update')?.addEventListener('click', () => void window.naiCatalog?.cancel());
  if (!catalogUpdateUnsubscribe && window.naiCatalog) {
    catalogUpdateUnsubscribe = window.naiCatalog.onProgress(event => {
      if (!catalogUpdateBusy) return;
      const percent = event.total ? Math.round((event.completed / event.total) * 100) : 0;
      const track = document.querySelector<HTMLElement>('#catalog-update-progress .progress-track span');
      if (track) track.style.width = `${percent}%`;
      const label = document.querySelector<HTMLElement>('#catalog-update-progress-label');
      if (label) label.textContent = `${event.phase} · ${event.completed.toLocaleString()} / ${event.total.toLocaleString()}${event.message ? ` · ${event.message}` : ''}`;
      if (event.phase === 'complete') catalogUpdateStatus = event.message || 'Catalog updated.';
    });
  }
}
function updateAppProgressDom(): void {
  const status = document.querySelector<HTMLElement>('#app-update-status');
  if (status) status.textContent = appUpdatePhaseCopy();
  const progress = document.querySelector<HTMLElement>('#app-update-progress');
  const track = progress?.querySelector<HTMLElement>('.progress-track span');
  if (track) track.style.width = `${appUpdateProgress.percent}%`;
  const bar = progress?.querySelector<HTMLElement>('.progress-track');
  if (bar) bar.setAttribute('aria-valuenow', String(appUpdateProgress.percent));
  const label = document.querySelector<HTMLElement>('#app-update-progress-label');
  if (label) label.textContent = `Download ${appUpdateProgress.percent}% complete, ${formatUpdateBytes(appUpdateProgress.completed)} of ${formatUpdateBytes(appUpdateProgress.total)}.${appUpdateProgress.message ? ` ${appUpdateProgress.message}` : ''}`;
}
function bindAppUpdateProgress(): void {
  if (appUpdateUnsubscribe || !window.naiUpdater) return;
  appUpdateUnsubscribe = window.naiUpdater.onProgress(event => {
    appUpdateProgress = { ...event };
    if (event.phase === 'downloading') appUpdatePhase = 'downloading';
    else if (event.phase === 'verifying') appUpdatePhase = 'verifying';
    else if (event.phase === 'paused') appUpdatePhase = 'paused';
    else if (event.phase === 'ready') appUpdatePhase = 'ready';
    else if (event.phase === 'error') { appUpdatePhase = 'error'; appUpdateMessage = event.message || 'The update download failed.'; }
    updateAppProgressDom();
  });
}
async function checkAppUpdate(interactive = false): Promise<void> {
  if (!window.naiUpdater || appUpdatePhase === 'downloading' || appUpdatePhase === 'verifying' || appUpdatePhase === 'installing') return;
  appUpdatePhase = 'checking'; appUpdateMessage = ''; if (interactive && activeWorkspace === 'settings') render();
  try {
    const result = await window.naiUpdater.check();
    if (appUpdatePhase !== 'checking') return;
    appUpdateManifest = result.available ? result : null;
    appUpdatePhase = result.available ? 'available' : 'up-to-date';
  } catch (error) {
    if (appUpdatePhase !== 'checking') return;
    appUpdatePhase = 'error'; appUpdateMessage = error instanceof Error ? error.message : 'The update check failed.';
  }
  if (activeWorkspace === 'settings') render();
}
async function downloadAppUpdate(): Promise<void> {
  if (!window.naiUpdater || !appUpdateManifest || appUpdatePhase === 'downloading' || appUpdatePhase === 'verifying') return;
  appUpdatePhase = 'downloading'; appUpdateMessage = ''; appUpdateProgress = { ...appUpdateProgress, phase: 'starting', completed: 0, total: appUpdateManifest.size ?? 0, percent: 0 }; render();
  try {
    const result = await window.naiUpdater.download(appUpdateManifest);
    if (result.state === 'ready') appUpdatePhase = 'ready';
    else if (result.state === 'cancelled') appUpdatePhase = 'paused';
    else appUpdatePhase = 'up-to-date';
  } catch (error) { appUpdatePhase = 'error'; appUpdateMessage = error instanceof Error ? error.message : 'The update download failed.'; }
  if (activeWorkspace === 'settings') render();
}
async function cancelAppUpdate(): Promise<void> {
  if (!window.naiUpdater) return;
  await window.naiUpdater.cancel();
  appUpdatePhase = 'paused';
  updateAppProgressDom();
  if (activeWorkspace === 'settings') render();
}
async function installAppUpdate(): Promise<void> {
  if (!window.naiUpdater || !appUpdateManifest || appUpdatePhase !== 'ready') return;
  appUpdatePhase = 'installing'; appUpdateMessage = ''; render();
  try { await window.naiUpdater.install(appUpdateManifest); } catch (error) { appUpdatePhase = 'error'; appUpdateMessage = error instanceof Error ? error.message : 'The update could not be installed.'; if (activeWorkspace === 'settings') render(); }
}
async function startCatalogUpdate(): Promise<void> {
  if (!window.naiCatalog || catalogUpdateBusy) return;
  catalogUpdateBusy = true;
  catalogUpdateError = '';
  catalogUpdateStatus = 'Discovering current V5 gallery pages...';
  render();
  try {
    const result = await window.naiCatalog.update();
    const previousArtists = officialArtists;
    const previousById = new Map(previousArtists.map(card => [card.catalogId ?? card.id, card]));
    officialArtists = result.catalog.artists;
    catalog = { ...result.catalog, artists: [] };
    rebuildEffectiveArtistCatalog();
    catalogState = 'ready';
    const changedCards = officialArtists.filter(card => {
      const previous = previousById.get(card.catalogId ?? card.id);
      return !previous || previous.sourceUrl !== card.sourceUrl || previous.image !== card.image;
    });
    if (changedCards.length) {
      catalogUpdateStatus = `Warming ${changedCards.length} new or changed previews...`;
      const status = document.querySelector<HTMLElement>('#catalog-update-status');
      if (status) status.textContent = catalogUpdateStatus;
    }
    const previewResult = await decodePreviews(changedCards, decodePreview, 6, (completed, total) => {
      const status = document.querySelector<HTMLElement>('#catalog-update-status');
      if (status) status.textContent = `Warming changed previews · ${completed.toLocaleString()} / ${total.toLocaleString()}`;
    });
    randomRange = normalizeRange(randomRange, catalog.artists.length);
    catalogUpdateStatus = `${result.added ? `+${result.added} artists` : '0 new artists'}${previewResult.failed.length ? `. ${previewResult.failed.length} preview${previewResult.failed.length === 1 ? '' : 's'} failed.` : ''}`;
    randomNotice = result.added ? `Catalog refreshed with +${result.added} artists.` : 'Catalog is already up to date.';
    saveSoon(); saveArtistMixSoon();
  } catch (error) {
    catalogUpdateStatus = '';
    catalogUpdateError = error instanceof Error ? error.message : 'The V5 catalog update failed.';
  } finally {
    catalogUpdateBusy = false;
    render();
  }
}
function randomizeArtists(): void {
  const pool = activeRandomPool();
  const requested = artistRandomFavoritesOnly ? (favoriteRandomRange ?? randomRange) : randomRange;
  const range = resolveRandomPoolRange(requested, pool.length);
  if (!range.feasible) {
    randomNotice = artistRandomFavoritesOnly
      ? 'Favorites-only random needs at least 2 favorited V5 artists. Add favorites or turn off Favorites-only. Your selected artists were kept.'
      : 'Random replacement needs at least 2 V5 artist cards. Your selected artists were kept.';
    render();
    return;
  }
  const count = randomCount(range.min, range.max);
  const selection = randomArtistSelection(pool, count);
  base.artists = selection.map(({ card, weight }) => weighted(card, weight));
  randomNotice = `Replaced ${selection.length} artists from the ${artistRandomFavoritesOnly ? 'favorites' : 'full'} pool.`;
  saveSoon();
  render();
}
function rerollAllWeights(): void {
  base.artists = rerollArtistWeights(base.artists);
  randomNotice = base.artists.length ? 'Rerolled weights for the selected artists.' : 'Select an artist before rerolling weights.';
  saveSoon();
  render();
}
function updateRandomRange(sourceId = ''): void {
  const source = sourceId ? document.querySelector<HTMLInputElement>(`#${sourceId}`) : null;
  const min = Number(sourceId.includes('min') ? source?.value : document.querySelector<HTMLInputElement>('#random-min')?.value);
  const max = Number(sourceId.includes('max') ? source?.value : document.querySelector<HTMLInputElement>('#random-max')?.value);
  const resolved = resolveRandomPoolRange({ min, max }, activeRandomPool().length);
  if (artistRandomFavoritesOnly) {
    if (resolved.feasible) favoriteRandomRange = { min: resolved.min, max: resolved.max };
  } else {
    randomRange = normalizeRange({ min, max }, catalog.artists.length);
  }
  const displayedRange = artistRandomFavoritesOnly ? (favoriteRandomRange ?? resolved) : randomRange;
  const minInput = document.querySelector<HTMLInputElement>('#random-min');
  const maxInput = document.querySelector<HTMLInputElement>('#random-max');
  const minRange = document.querySelector<HTMLInputElement>('#random-min-range');
  const maxRange = document.querySelector<HTMLInputElement>('#random-max-range');
  if (minInput) minInput.value = String(displayedRange.min);
  if (maxInput) maxInput.value = String(displayedRange.max);
  if (minRange) minRange.value = String(displayedRange.min);
  if (maxRange) maxRange.value = String(displayedRange.max);
  if (!artistRandomFavoritesOnly) saveSoon();
}
function toggleFavorite(cardId: string, kind: 'artists' | 'characters', preserveArtistScroll = false): void {
  const values = kind === 'artists' ? artistFavorites : characterFavorites;
  if (values.has(cardId)) values.delete(cardId); else values.add(cardId);
  saveFavorites(values, kind);
  if (kind === 'artists') {
    refreshArtistGrid({ preserveScroll: preserveArtistScroll, focusFavoriteId: preserveArtistScroll ? cardId : undefined });
  } else {
    refreshCharacterPicker();
  }
}
function resetPrompt(): void { base = emptyBase(); characters = []; randomRange = { ...DEFAULT_RANGE }; favoriteRandomRange = null; saveSoon(); render(); }
async function copy(value: string, selector: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); } catch { /* clipboard permissions are optional */ }
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (button?.classList.contains('library-copy-icon')) {
    const label = button.getAttribute('aria-label') ?? 'Copy prompt';
    button.dataset.copied = 'true'; button.setAttribute('aria-label', 'Copied'); button.title = 'Copied';
    window.setTimeout(() => { delete button.dataset.copied; button.setAttribute('aria-label', label); button.title = label; }, 900);
  } else if (button) { const initial = button.textContent; button.textContent = 'Copied'; window.setTimeout(() => { button.textContent = initial; }, 900); }
}
function saveCurrentSet(): void {
  openLibrarySaveModal('prompt');
}

function renderDetailsModal(): void {
  const character = characters.find(item => item.id === detailCharacterId);
  if (!character) return;
  const root = document.querySelector<HTMLDivElement>('#modal-root') ?? document.body.appendChild(document.createElement('div'));
  root.id = 'modal-root';
  root.innerHTML = `<div class="modal-backdrop"><section class="detail-modal" role="dialog" aria-modal="true" aria-label="Character details"><header><div><p class="eyebrow">CHARACTER PROMPT</p><h2>${escapeHtml(character.label)}</h2></div><button class="icon-button" id="close-details" aria-label="Close">×</button></header><p>Keep character prompt and character undesired content separate from the base prompt.</p><button class="primary" id="done-details">Done</button></section></div>`;
  document.querySelector('#close-details')?.addEventListener('click', closeDetails);
  document.querySelector('#done-details')?.addEventListener('click', closeDetails);
}
function closeDetails(): void { modal = null; const root = document.querySelector('#modal-root'); if (root) root.innerHTML = ''; }

async function loadCatalog(): Promise<void> {
  try {
    const loaded = window.naiCatalog
      ? await window.naiCatalog.load() as Partial<OfflineCatalog>
      : await (async () => { const response = await fetch('./catalog/catalog.json'); if (!response.ok) throw new Error(`Catalog request failed (${response.status})`); return await response.json() as Partial<OfflineCatalog>; })();
    if (!Array.isArray(loaded.artists) || !Array.isArray(loaded.characters)) throw new Error('Catalog snapshot is missing artist or character arrays');
    officialArtists = loaded.artists;
    catalog = { ...emptyCatalog(), ...loaded, artists: [], characters: loaded.characters, tags: loaded.tags ?? FALLBACK_TAGS } as OfflineCatalog;
    rebuildEffectiveArtistCatalog();
    catalogState = 'ready';
    catalogError = '';
  } catch (error) {
    officialArtists = [];
    catalog = emptyCatalog();
    catalogState = 'error';
    catalogError = error instanceof Error ? error.message : 'The offline V5 catalog could not be loaded.';
  }
  catalog.tags = catalog.tags?.length ? catalog.tags : FALLBACK_TAGS;
  randomRange = normalizeRange(randomRange, catalog.artists.length);
  if (!startupVisible) render();
}

async function loadGuide(): Promise<void> {
  try {
    const response = await fetch('./catalog/guide/manifest.json');
    if (!response.ok) throw new Error(`Guide request failed (${response.status})`);
    const value = await response.json() as GuideExample[] | { entries?: GuideExample[] };
    const entries = Array.isArray(value) ? value : (value.entries ?? []);
    guideCards = classifyGuideEntries(entries);
    guideState = 'ready';
  } catch (error) {
    guideCards = [];
    guideState = 'error';
    console.warn(error instanceof Error ? error.message : 'The offline guide could not be loaded.');
  }
  if (!startupVisible && activeWorkspace === 'prompt') render();
}

function startupMarkup(): string {
  const progress = startupTotal ? Math.min(100, Math.round(startupCompleted / startupTotal * 100)) : startupReady ? 100 : 0;
  const error = !startupBusy && startupError ? `<div class="startup-error" role="alert"><b>Catalog startup could not finish.</b><p>${escapeHtml(startupError)}</p><button class="secondary" id="startup-retry" type="button">Retry</button><button class="tiny-copy" id="startup-continue" type="button">Continue to app</button></div>` : '';
  const failure = !startupBusy && startupFailures.length ? `<div class="startup-failure" role="status"><b>${startupFailures.length} preview${startupFailures.length === 1 ? '' : 's'} failed.</b><p>The catalog is ready. You can retry failed previews or continue.</p><button class="secondary" id="startup-retry-failed" type="button">Retry failed</button><button class="tiny-copy" id="startup-continue-failed" type="button">Continue</button></div>` : '';
  return `<main class="startup-shell"><section class="startup-panel" aria-labelledby="startup-title"><img class="startup-mark startup-icon" src="./app-icon.png" alt=""><p class="eyebrow">NAI PROMPT STUDIO</p><h1 id="startup-title">Waking the V5 constellation</h1><p class="startup-copy">${escapeHtml(startupPhase)}. Preview data stays on this device.</p><div class="startup-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="Loading card previews"><div class="progress-track"><span style="width:${progress}%"></span></div><b>${progress}%</b></div>${error}${failure}</section></main>`;
}
function renderStartup(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  if (app.querySelector('.startup-shell')) {
    const progress = startupTotal ? Math.min(100, Math.round(startupCompleted / startupTotal * 100)) : startupReady ? 100 : 0;
    const track = app.querySelector<HTMLElement>('.startup-progress .progress-track span');
    if (track) track.style.width = `${progress}%`;
    const value = app.querySelector<HTMLElement>('.startup-progress b');
    if (value) value.textContent = `${progress}%`;
    const copy = app.querySelector<HTMLElement>('.startup-copy');
    if (copy) copy.textContent = `${startupPhase}. Preview data stays on this device.`;
    const bar = app.querySelector<HTMLElement>('.startup-progress');
    bar?.setAttribute('aria-valuenow', String(progress));
    if (!startupFailures.length && !startupError && !app.querySelector('.startup-error, .startup-failure')) return;
  }
  app.innerHTML = startupMarkup();
  document.querySelector('#startup-retry')?.addEventListener('click', () => void bootApp());
  document.querySelector('#startup-continue')?.addEventListener('click', openStudioAfterStartup);
  document.querySelector('#startup-continue-failed')?.addEventListener('click', openStudioAfterStartup);
  document.querySelector('#startup-retry-failed')?.addEventListener('click', () => void retryStartupFailures());
}
function openStudioAfterStartup(): void {
  startupVisible = false; startupEntryPending = animationMode !== 'off';
  startGuide(false);
  render();
  window.setTimeout(() => { if (settings.updateCatalogOnStartup) void startCatalogUpdate(); if (settings.checkAppUpdatesOnStartup) void checkAppUpdate(false); }, 500);
}
async function decodePreview(card: CatalogCard): Promise<boolean> {
  if (typeof Image === 'undefined') return true;
  const image = new Image();
  image.decoding = 'async';
  image.src = catalogImage(card);
  try {
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Image failed')); });
    return true;
  } catch { return false; }
  finally { image.onload = null; image.onerror = null; image.src = ''; }
}
async function preloadCards(cards: CatalogCard[], phase: string): Promise<CatalogCard[]> {
  startupPhase = phase;
  const completedBeforePhase = startupCompleted;
  const retryIds = new Set(cards.map(card => card.catalogId ?? card.id));
  startupFailedCards = startupFailedCards.filter(card => !retryIds.has(card.catalogId ?? card.id));
  renderStartup();
  const result = await decodePreviews(cards, decodePreview, 6, (completed) => { startupCompleted = completedBeforePhase + completed; renderStartup(); });
  startupFailedCards = [...startupFailedCards, ...result.failed];
  startupFailures = startupFailedCards.map(card => card.tag);
  renderStartup();
  return result.failed;
}
async function retryStartupFailures(): Promise<void> {
  const failed = [...startupFailedCards];
  if (!failed.length) return;
  startupBusy = true;
  startupCompleted = 0;
  startupTotal = failed.length;
  startupReady = failed.length === 0;
  await preloadCards(failed, 'Retrying failed previews');
  startupBusy = false;
  if (!startupFailedCards.length) {
    startupPhase = 'Opening studio';
    openStudioAfterStartup();
  } else {
    startupPhase = 'Preview loading paused';
    startupFailures = startupFailedCards.map(card => card.tag);
    renderStartup();
  }
}
async function bootApp(): Promise<void> {
  startupBusy = true;
  startupVisible = true;
  startupError = '';
  startupFailures = [];
  startupFailedCards = [];
  startupPhase = 'Loading catalog';
  startupCompleted = 0;
  startupTotal = 0;
  startupReady = false;
  renderStartup();
  await Promise.all([loadCatalog(), loadGuide()]);
  if (catalogState !== 'ready') { startupError = catalogError || 'The V5 catalog could not be loaded.'; startupBusy = false; renderStartup(); return; }
  startupTotal = catalog.artists.length + (settings.preloadCharacterPreviews ? catalog.characters.length : 0);
  if (!startupTotal) { startupReady = true; startupPhase = 'Opening studio'; startupBusy = false; renderStartup(); openStudioAfterStartup(); return; }
  await preloadCards(catalog.artists, 'Preparing V5 artist previews');
  if (settings.preloadCharacterPreviews && catalog.characters.length) await preloadCards(catalog.characters, 'Preparing character previews');
  startupBusy = false;
  startupReady = true;
  if (startupFailedCards.length) { startupPhase = 'Preview loading paused'; startupFailures = startupFailedCards.map(card => card.tag); renderStartup(); return; }
  startupPhase = 'Opening studio';
  openStudioAfterStartup();
}

applyAnimationMode(animationMode);
applyTheme();
bindAppUpdateProgress();
renderStartup();
void bootApp();
window.addEventListener('resize', scheduleMixOrbitThreads);
window.addEventListener('beforeunload', () => { if (mixThreadFrame !== undefined) window.cancelAnimationFrame(mixThreadFrame); if (mixThreadSettleFrame !== undefined) window.cancelAnimationFrame(mixThreadSettleFrame); if (mixThreadFallbackTimer !== undefined) window.clearTimeout(mixThreadFallbackTimer); mixThreadObserver?.disconnect(); metadataWorkspace.dispose(); for (const key of [...customImageUrls.keys()]) revokeCustomImageUrl(key); for (const key of [...savedLibraryImageUrls.keys()]) revokeSavedLibraryImageUrl(key); const draft = currentDraft(); saveDraft(draft); window.naiStorage?.saveSync('draft', draft); });

export { normalizeRange, randomizeArtists, prompt };

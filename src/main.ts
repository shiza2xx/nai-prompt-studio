import './styles.css';
import { DEFAULT_CUSTOM_TAG_PRESET_ID, DEFAULT_CUSTOM_TAG_PRESET_NAME } from './custom-tag-presets.ts';
import { bindArtistCardPreview, clearArtistCardPreview } from './artist-card-preview';
import { artistDisplayName, canonicalArtistIdentity, customArtistCatalogId, mergeArtistCatalog, migrateArtistAliases, migrateArtistMixAliases, migrateFavoriteAliases } from './artist-catalog';
import { mixCompanionScale, mixOrbitLayout } from './artist-mix-layout';
import { paginateArtists, paginateCharacters } from './catalog-browser';
import { MetadataWorkspace } from './metadata-workspace';
import { decodePreviews } from './preview-loader';
import { buildArtistsPrompt, buildBasePrompt, buildCharacterPrompt, serializeTag } from './prompt';
import { normalizeArtistWeight, randomArtistSelection, randomCount, reconcileSelectedArtists, rerollArtistWeight, rerollArtistWeights, resolveRandomPoolRange } from './random';
import { canonicalCustomTagIdentity, classifyGuideEntries, constructorCardTags, hasPromptTagGroup, mergeConstructorCards, qualityPresetTags, splitTagGroup, togglePromptTagGroup, type ConstructorCard, type ConstructorZone } from './prompt-constructor';
import { loadArtistMix, loadCustomTagPresets, loadCustomTags, loadDraft, loadFavorites, loadSettings, loadSets, normalizeAnimationMode, normalizeArtistMix, normalizeCustomTagPresets, saveArtistMix, saveCustomTagPresets, saveCustomTags, saveDraft, saveFavorites, saveSettings, saveSets } from './storage';
import type { AnimationMode, AppSettings, ArtistMixDraft, BasePrompt, CatalogCard, Character, CustomTag, CustomTagKind, CustomTagPreset, GuideExample, OfflineCatalog, PromptDraft, PromptSet, WeightedTag } from './types';

type Zone = 'frame' | 'scene' | 'render' | 'undesired';
type Modal = 'artists' | 'characters' | 'character-details' | 'constructor' | null;

const FALLBACK_TAGS = ['girl', 'boy', '1girl', '1boy', 'masterpiece', 'best quality', 'upper body', 'full body', 'looking at viewer'];
const DEFAULT_RANGE = { min: 2, max: 5 };
const accordionOpenState: Record<Zone, boolean> = { frame: true, scene: true, render: true, undesired: false };
const restored = loadDraft();
let base: BasePrompt = restored?.base ?? emptyBase();
let characters: Character[] = restored?.characters ?? [];
let randomRange = normalizeRange(restored?.randomRange);
let settings: AppSettings = loadSettings(restored?.animationMode);
let animationMode: AnimationMode = normalizeAnimationMode(settings.animationMode);
let artistMix: ArtistMixDraft = loadArtistMix();
let sets: PromptSet[] = loadSets();
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
let activeWorkspace: 'prompt' | 'artist-mix' | 'custom-tags' | 'metadata' | 'settings' = 'prompt';
let pendingWorkspaceTransition: 'prompt' | 'artist-mix' | 'custom-tags' | 'metadata' | 'settings' | null = null;
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
// Legacy compatibility marker: new MetadataWorkspace(() => catalog.artists)
const metadataWorkspace = new MetadataWorkspace(() => catalog.artists, card => catalogImage(card));

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
    <div class="full-prompt"><div><span>FULL PROMPT</span><small>frame, artists, scene, render</small></div><code id="full-prompt-output">${escapeHtml(prompt())}</code><button class="primary" id="copy-prompt" type="button">Copy prompt</button></div>
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

function mixArtists(): WeightedTag[] { return artistMix.primary ? [artistMix.primary, ...artistMix.companions] : [...artistMix.companions]; }
function mixPool(): CatalogCard[] {
  const primaryId = artistMix.primary?.catalogId;
  return catalog.artists.filter(card => {
    const stableId = card.catalogId ?? card.id;
    return stableId !== primaryId && (!artistMix.favoritesOnly || artistFavorites.has(stableId));
  });
}
function reconcileArtistMix(value: ArtistMixDraft): ArtistMixDraft {
  const byId = new Map(catalog.artists.map(card => [card.catalogId ?? card.id, card]));
  const refresh = (item: WeightedTag | null): WeightedTag | null => {
    if (!item) return null;
    const card = byId.get(item.catalogId ?? item.id);
    return card ? { ...item, catalogId: card.catalogId ?? card.id, image: card.image, tag: `artist: ${card.tag}` } : item;
  };
  const primary = refresh(value.primary);
  const seen = new Set(primary?.catalogId ? [primary.catalogId] : []);
  const companions = value.companions.map(refresh).filter((item): item is WeightedTag => Boolean(item && item.catalogId && !seen.has(item.catalogId) && seen.add(item.catalogId)));
  return { ...value, primary, companions, randomRange: normalizeRange(value.randomRange, Math.max(2, catalog.artists.length)) };
}
function mixArtistCardMarkup(item: WeightedTag, primary: boolean): string {
  const value = normalizeArtistWeight(item.weight);
  const image = artistImage(item);
  const label = item.tag.replace(/^artist:\s*/i, '');
  return `<article class="selected-artist mix-artist-card ${primary ? 'mix-primary' : ''}" data-mix-artist="${escapeHtml(item.id)}" data-artist-preview-image="${image}" data-artist-preview-tag="${escapeHtml(label)}" data-artist-preview-prompt="${escapeHtml(serializeTag(item) ?? item.tag)}"><div class="selected-artist-image"><img src="${image}" alt="${escapeHtml(label)}" loading="lazy"></div><div class="selected-artist-copy"><small>${primary ? 'PRIMARY ARTIST' : 'COMPANION ARTIST'}</small><b>${escapeHtml(label)}</b><code>${escapeHtml(serializeTag(item) ?? item.tag)}</code><div class="weight-controls"><input type="range" min="0.1" max="2" step="0.1" value="${value.toFixed(1)}" data-mix-weight-range="${escapeHtml(item.id)}" aria-label="Weight for ${escapeHtml(label)}"><input class="mix-weight-number" type="number" min="0.1" max="2" step="0.1" value="${value.toFixed(1)}" data-mix-weight="${escapeHtml(item.id)}" aria-label="Numeric weight for ${escapeHtml(label)}"><button class="tiny-copy reroll-weight" type="button" data-mix-reroll="${escapeHtml(item.id)}" aria-label="Reroll weight for ${escapeHtml(label)}">Reroll</button></div></div><button class="icon-button" type="button" data-mix-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(label)}">×</button></article>`;
}
function mixOrbitMarkup(): string {
  const primary = artistMix.primary;
  const companions = artistMix.companions;
  const layout = mixOrbitLayout(companions.length);
  const satellites = companions.map((item, index) => {
    const placement = layout.placements[index];
    const scale = mixCompanionScale(item.weight);
    return `<div class="mix-orbit-slot" role="listitem" data-mix-orbit-id="${escapeHtml(item.id)}" data-orbit-ring="${placement.ring + 1}" data-orbit-angle="${placement.angle}" data-orbit-radius="${placement.radius}" data-orbit-radius-cap="${placement.radiusCap}" style="--orbit-angle:${placement.angle}deg;--orbit-radius:${placement.radius}%;--orbit-radius-cap:${placement.radiusCap}px;--mix-weight-scale:${scale}"><div class="mix-orbit-carrier"><div class="mix-orbit-connector" aria-hidden="true"></div><div class="mix-orbit-upright"><div class="mix-orbit-card-shell">${mixArtistCardMarkup(item, false)}</div></div></div></div>`;
  }).join('');
  const center = primary
    ? `<div class="mix-orbit-primary" role="listitem">${mixArtistCardMarkup(primary, true)}</div>`
    : '<div class="mix-orbit-primary" role="listitem"><button class="empty-artist-card mix-orbit-empty" id="open-mix-primary-picker-empty" type="button"><img src="./plus.png" alt=""><b>Choose primary artist</b><small>Your fixed anchor for this mix</small></button></div>';
  return `<div class="mix-orbit" role="list" aria-label="Primary artist surrounded by companion artists" style="--mix-orbit-height:${layout.height}px;--mix-orbit-rings:${layout.ringCount}"><div class="mix-orbit-ring mix-orbit-ring-inner" aria-hidden="true"></div><div class="mix-orbit-ring mix-orbit-ring-outer" aria-hidden="true"></div>${center}${satellites}</div>`;
}
function artistMixWorkspace(): string {
  const range = normalizeRange(artistMix.randomRange, Math.max(2, catalog.artists.length));
  const total = mixArtists();
  const poolSize = mixPool().length;
  const status = mixNotice ? `<p class="random-notice" role="status">${escapeHtml(mixNotice)}</p>` : '';
  const panelLabel = focusMode ? 'aria-label="Artist Mix"' : 'aria-labelledby="artist-mix-tab"';
  return `<section id="artist-mix-panel" class="artist-mix-workspace ${focusMode ? 'is-focus' : ''}" role="tabpanel" ${panelLabel}><header class="workspace-intro mix-intro"><div><p class="eyebrow">ARTIST MIX</p><h2>Compose a constellation of artists.</h2><p>Keep one primary voice, then place controlled random companions around it.</p></div><button class="secondary mix-focus-button" id="${focusMode ? 'exit-mix-focus' : 'enter-mix-focus'}" type="button">${focusMode ? 'Exit focus' : 'Focus mode'}</button></header><section class="mix-random-settings" aria-label="Artist Mix random settings"><div><p class="eyebrow">MIX SETTINGS</p><h3>Random companions</h3><small>Total artists, including the primary</small></div><label>From <input id="mix-random-min" type="number" min="2" max="${Math.max(2, catalog.artists.length)}" value="${range.min}"></label><label>to <input id="mix-random-max" type="number" min="2" max="${Math.max(2, catalog.artists.length)}" value="${range.max}"></label><button class="chip ${artistMix.favoritesOnly ? 'on' : ''}" id="mix-favorites-only" type="button" aria-pressed="${artistMix.favoritesOnly}">★ Favorites pool (${poolSize})</button><div class="mix-actions"><button class="primary" id="mix-artists" type="button">Mix artists</button><button class="secondary" id="mix-reroll-companion-weights" type="button">Reroll companion weights</button></div></section>${status}<section class="mix-stage" aria-label="Artist Mix selected artists"><div class="mix-stage-heading"><div><p class="eyebrow">CENTER STAGE</p><h3>Selected artists <span>${total.length}</span></h3><small>Primary stays anchored while companions change.</small></div><div class="mix-stage-tools"><button class="secondary" id="open-mix-primary-picker" type="button">${artistMix.primary ? 'Replace primary' : 'Choose primary'}</button><button class="secondary" id="open-mix-companion-picker" type="button">Add companion</button></div></div>${mixOrbitMarkup()}</section><section class="mix-output"><div><p class="eyebrow">ARTIST PROMPT</p><code id="mix-prompt-output">${escapeHtml(buildArtistsPrompt(total))}</code></div><button class="primary" id="copy-mix-prompt" type="button">Copy artists prompt</button></section></section>`;
}

function mixPickerMarkup(): string {
  return `<div class="modal-backdrop mix-picker-backdrop" id="mix-picker-backdrop" hidden><section class="picker-modal artist-catalog-picker" role="dialog" aria-modal="true" aria-label="Choose a V5 artist for Artist Mix"><header><div><p class="eyebrow">ARTIST MIX · V5</p><h2>Choose an artist</h2><p id="mix-picker-count">${catalog.artists.length.toLocaleString()} cards</p></div><button class="icon-button" id="close-mix-picker" type="button" aria-label="Close artist picker">×</button></header><div class="picker-tools"><input id="mix-artist-search" value="${escapeHtml(artistSearch)}" placeholder="Search V5 artists..." aria-label="Search V5 artists"><button class="chip ${artistMix.favoritesOnly ? 'on' : ''}" id="mix-picker-favorites" type="button" aria-pressed="${artistMix.favoritesOnly}">★ Favorites</button></div><div class="artist-grid artist-catalog-grid" id="mix-artist-grid" tabindex="0"></div><footer class="catalog-pagination"><button class="secondary" id="mix-artist-previous" type="button" disabled>Previous</button><span id="mix-artist-page-status" role="status" aria-live="polite">Page 1</span><button class="secondary" id="mix-artist-next" type="button" disabled>Next</button></footer></section></div>`;
}

function settingsWorkspace(): string {
  const browserOnly = !window.naiCatalog;
  return `<section id="settings-panel" class="settings-workspace" role="tabpanel" aria-labelledby="settings-tab"><header class="workspace-intro"><div><p class="eyebrow">STUDIO SETTINGS</p><h2>Shape the studio to your rhythm.</h2><p>These preferences stay in the local profile on D: and never leave this app.</p></div></header><div class="settings-grid"><section class="settings-card"><p class="eyebrow">MOTION</p><h3>Interface animations</h3><p>Choose how transitions, hover previews, and focus mode move.</p>${settingsAnimationModeMarkup()}</section><section class="settings-card"><p class="eyebrow">STARTUP PREVIEWS</p><h3>Character preview preload</h3><p>Artist cards always warm up at launch. Character previews are optional and can add startup time.</p><label class="settings-toggle"><input id="preload-character-previews" type="checkbox" ${settings.preloadCharacterPreviews ? 'checked' : ''}><span>Preload all character previews</span></label><small>${settings.preloadCharacterPreviews ? 'Enabled for the next launch.' : 'Off by default. Character cards load when Browse Cards opens.'}</small></section><section class="settings-card settings-catalog-card"><div class="settings-card-heading"><div><p class="eyebrow">V5 ARTIST CATALOG</p><h3>Update missing cards</h3></div><span class="catalog-count">${officialArtists.length.toLocaleString()} official cards</span></div><p>Fetch only new cards from the exact NAX V5 gallery. Existing cards and favorites stay intact.</p>${browserOnly ? '<p class="settings-disabled" role="status">Catalog updates are available in the desktop app. Browser mode can use the embedded catalog only.</p>' : `<div class="catalog-update-status" id="catalog-update-status" role="status" aria-live="polite">${escapeHtml(catalogUpdateStatus || catalogUpdateError || 'Ready for a manual update.')}</div><div class="catalog-update-progress" id="catalog-update-progress"${catalogUpdateBusy ? '' : ' hidden'}><div class="progress-track"><span style="width:0%"></span></div><small id="catalog-update-progress-label">Preparing...</small></div><div class="settings-actions"><button class="primary" id="download-missing-v5" type="button" ${catalogUpdateBusy ? 'disabled' : ''}>${catalogUpdateBusy ? 'Updating...' : 'Download missing V5 artists'}</button><button class="secondary" id="cancel-v5-update" type="button"${catalogUpdateBusy ? '' : ' hidden'}>Cancel</button></div>`}</section></div></section>`;
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

function savedMenu(): string {
  return `<details class="saved-menu"><summary>Saved sets <span>${sets.length}</span></summary><div class="saved-list">${sets.length ? sets.map(set => `<button data-copy-set="${set.id}"><b>${escapeHtml(set.name)}</b><small>${escapeHtml(set.prompt)}</small></button><button class="delete-set" data-delete-set="${set.id}" aria-label="Delete set">×</button>`).join('') : '<small>No saved sets yet.</small>'}<button class="primary" id="save-set">＋ Save current</button></div></details>`;
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

function workspacePanelClass(workspace: 'prompt' | 'artist-mix' | 'custom-tags' | 'metadata' | 'settings'): string {
  return pendingWorkspaceTransition === workspace
    ? `workspace-panel workspace-panel-incoming workspace-panel-incoming-${workspace}`
    : 'workspace-panel';
}

function switchWorkspace(workspace: 'prompt' | 'artist-mix' | 'custom-tags' | 'metadata' | 'settings'): void {
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
  clearArtistCardPreview();
  const tabs = focusMode ? '' : `<div class="workspace-tabs" role="tablist" aria-label="Studio workspaces"><button id="prompt-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'prompt'}" aria-controls="prompt-panel" class="${activeWorkspace === 'prompt' ? 'on' : ''}">Prompt Builder</button><button id="artist-mix-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'artist-mix'}" aria-controls="artist-mix-panel" class="${activeWorkspace === 'artist-mix' ? 'on' : ''}">Artist Mix</button><button id="custom-tags-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'custom-tags'}" aria-controls="custom-tags-panel" class="${activeWorkspace === 'custom-tags' ? 'on' : ''}">Custom Tags</button><button id="metadata-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'metadata'}" aria-controls="metadata-panel" class="${activeWorkspace === 'metadata' ? 'on' : ''}">Image Metadata</button><button id="settings-tab" type="button" role="tab" aria-selected="${activeWorkspace === 'settings'}" aria-controls="settings-panel" class="${activeWorkspace === 'settings' ? 'on' : ''}">Settings</button></div>`;
  snapshotAccordionState();
  const promptMarkup = `<section id="prompt-panel" class="${workspacePanelClass('prompt')}" role="tabpanel" aria-labelledby="prompt-tab"><section class="workspace-intro"><div><p class="eyebrow">FOUR-ZONE WORKSPACE</p><h2>Build the prompt in order.</h2><p>Frame → artists → scene → render. Undesired content and character blocks stay separate.</p></div></section><section class="four-zone-grid">${zoneDetails()}${artistZone()}${charactersZone()}</section><footer class="app-footer"><div class="footer-brand"><span>NAI Prompt Studio</span><span class="footer-links"><a href="https://nax.moe/?gallery=danbooru-artist-tags-2-v5" target="_blank" rel="noopener noreferrer">NAX · CC BY 4.0</a><a href="https://hothottuk.neocities.org/en" target="_blank" rel="noopener noreferrer">hothottuk's guide</a></span></div></footer></section>`;
  const metadataMarkup = `<section id="metadata-panel" class="${workspacePanelClass('metadata')}" role="tabpanel" aria-labelledby="metadata-tab">${metadataWorkspace.markup()}</section>`;
  const customTagsMarkup = `<section id="custom-tags-panel" class="${workspacePanelClass('custom-tags')}" role="tabpanel" aria-labelledby="custom-tags-tab">${customTagsWorkspace()}</section>`;
  const activeMarkup = activeWorkspace === 'prompt' ? promptMarkup : activeWorkspace === 'artist-mix' ? artistMixWorkspace() : activeWorkspace === 'custom-tags' ? customTagsMarkup : activeWorkspace === 'metadata' ? metadataMarkup : settingsWorkspace();
  const shellClass = `${focusMode ? 'app-shell focus-shell' : 'app-shell'}${startupEntryPending ? ' startup-entry' : ''}`;
  app.innerHTML = `<main class="${shellClass}"><header class="topbar"${focusMode ? ' hidden' : ''}><div class="brand"><span class="brand-mark">N</span><div><h1>Prompt Studio</h1><p>NovelAI Diffusion · V5 artist workflow</p></div></div><div class="top-actions">${activeWorkspace === 'prompt' ? `${savedMenu()}<button class="reset-prompt" id="reset" type="button">Reset prompt</button>` : ''}</div></header>${tabs}${activeMarkup}</main>${activeWorkspace === 'prompt' ? `${artistPickerMarkup()}${characterPickerMarkup()}${constructorModalMarkup()}` : activeWorkspace === 'artist-mix' ? mixPickerMarkup() : ''}`;
  pendingWorkspaceTransition = null;
  bindEvents();
  if (activeWorkspace === 'metadata') metadataWorkspace.bind(app, render);
  if (activeWorkspace === 'settings') bindSettingsEvents();
  if (activeWorkspace === 'artist-mix') bindArtistMixEvents();
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
  document.querySelector('#save-set')?.addEventListener('click', saveCurrentSet);
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
      primary: (artistMix.primary?.catalogId ?? artistMix.primary?.id) === customArtistId ? null : artistMix.primary,
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
  const samePrimary = (artistMix.primary?.catalogId ?? artistMix.primary?.id) === stableId;
  const previous = samePrimary ? artistMix.primary : weighted(card);
  artistMix = { ...artistMix, primary: previous, companions: samePrimary ? artistMix.companions : [] };
  mixNotice = samePrimary ? '' : 'Primary artist replaced. Choose new companions or start a fresh mix.';
  saveArtistMixSoon();
  closeMixPicker();
  render();
}
function addMixCompanion(card: CatalogCard): void {
  const stableId = card.catalogId ?? card.id;
  if (stableId === artistMix.primary?.catalogId || artistMix.companions.some(item => item.catalogId === stableId)) return;
  artistMix = { ...artistMix, companions: [...artistMix.companions, weighted(card)] };
  saveArtistMixSoon();
  closeMixPicker();
  render();
}
function randomizeMix(): void {
  if (!catalog.artists.length) { mixNotice = 'The V5 catalog is still loading.'; render(); return; }
  const primary = artistMix.primary;
  if (!primary) { mixNotice = 'Choose a primary artist first.'; render(); return; }
  const availablePool = catalog.artists.filter(card => (card.catalogId ?? card.id) !== primary.catalogId && (!artistMix.favoritesOnly || artistFavorites.has(card.catalogId ?? card.id)));
  const range = resolveRandomPoolRange(artistMix.randomRange, availablePool.length + 1);
  if (!range.feasible) { mixNotice = artistMix.favoritesOnly ? 'Favorites-only Mix needs at least 1 companion card.' : 'Artist Mix needs at least 2 V5 artist cards. Your current mix was kept.'; render(); return; }
  const total = randomCount(range.min, range.max);
  const companions = randomArtistSelection(availablePool, Math.max(0, total - 1)).map(({ card, weight }) => weighted(card, weight));
  const nextMix: ArtistMixDraft = { ...artistMix, primary, companions, randomRange: { min: range.min, max: range.max } };
  const notice = `Mixed ${total} artists. The primary artist stayed anchored.`;
  commitArtistMix(nextMix, notice);
}
function rerollMixCompanionWeights(): void {
  artistMix = { ...artistMix, companions: rerollArtistWeights(artistMix.companions) };
  mixNotice = artistMix.companions.length ? 'Rerolled companion weights. The primary stayed unchanged.' : 'Add a companion before rerolling companion weights.';
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
  grid.innerHTML = page.cards.map(card => { const stable = card.catalogId ?? card.id; const selected = stable === artistMix.primary?.catalogId; return `<article class="artist-card ${selected ? 'selected' : ''}"><button class="artist-pick" type="button" data-mix-pick="${escapeHtml(stable)}" data-artist-preview-image="${catalogImage(card)}" data-artist-preview-tag="${escapeHtml(card.tag)}" data-artist-preview-prompt="artist: ${escapeHtml(card.tag)}"><span class="card-image"><img src="${catalogImage(card)}" alt="${escapeHtml(card.tag)}" loading="lazy"></span><b>${escapeHtml(card.tag)}</b></button></article>`; }).join('') || '<p class="empty-inline">No V5 artists match this search.</p>';
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
    const min = Number(document.querySelector<HTMLInputElement>('#mix-random-min')?.value) || 2;
    const max = Number(document.querySelector<HTMLInputElement>('#mix-random-max')?.value) || min;
    artistMix = { ...artistMix, randomRange: normalizeRange({ min, max }, catalog.artists.length) };
    saveArtistMixSoon();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-mix-remove]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.mixRemove;
    if (target === artistMix.primary?.id) artistMix = { ...artistMix, primary: null, companions: [] };
    else artistMix = { ...artistMix, companions: artistMix.companions.filter(item => item.id !== target) };
    saveArtistMixSoon(); render();
  }));
  document.querySelectorAll<HTMLInputElement>('[data-mix-weight],[data-mix-weight-range]').forEach(input => input.addEventListener('input', () => {
    const target = input.dataset.mixWeight ?? input.dataset.mixWeightRange;
    const update = (item: WeightedTag): WeightedTag => item.id === target ? { ...item, weight: normalizeArtistWeight(input.value) } : item;
    if (artistMix.primary) artistMix = { ...artistMix, primary: update(artistMix.primary), companions: artistMix.companions.map(update) };
    else artistMix = { ...artistMix, companions: artistMix.companions.map(update) };
    const currentPrimary = artistMix.primary;
    document.querySelectorAll<HTMLInputElement>(`[data-mix-weight="${target}"],[data-mix-weight-range="${target}"]`).forEach(control => { control.value = String((currentPrimary && currentPrimary.id === target ? currentPrimary.weight : artistMix.companions.find(item => item.id === target)?.weight) ?? 1); });
    const companion = artistMix.companions.find(item => item.id === target);
    const orbitSlot = input.closest<HTMLElement>('.mix-orbit-slot');
    if (companion && orbitSlot) orbitSlot.style.setProperty('--mix-weight-scale', String(mixCompanionScale(companion.weight)));
    document.querySelector('#mix-prompt-output')?.replaceChildren(document.createTextNode(buildArtistsPrompt(mixArtists())));
    saveArtistMixSoon();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-mix-reroll]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.mixReroll;
    const primary = artistMix.primary;
    if (primary && primary.id === target) artistMix = { ...artistMix, primary: rerollArtistWeight(primary) };
    else artistMix = { ...artistMix, companions: artistMix.companions.map(item => item.id === target ? rerollArtistWeight(item) : item) };
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
    catalogUpdateStatus = `+${result.added} artists added.${previewResult.failed.length ? ` ${previewResult.failed.length} preview${previewResult.failed.length === 1 ? '' : 's'} failed.` : ''}`;
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
  if (button) { const initial = button.textContent; button.textContent = 'Copied'; window.setTimeout(() => { button.textContent = initial; }, 900); }
}
function saveCurrentSet(): void {
  const name = window.prompt('Set name:');
  if (!name?.trim() || !prompt()) return;
  sets.unshift({ id: id(), name: name.trim(), prompt: prompt(), createdAt: new Date().toISOString() });
  saveSets(sets);
  render();
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
  const progress = startupTotal ? Math.min(100, Math.round(startupCompleted / startupTotal * 100)) : 0;
  const error = !startupBusy && startupError ? `<div class="startup-error" role="alert"><b>Catalog startup could not finish.</b><p>${escapeHtml(startupError)}</p><button class="secondary" id="startup-retry" type="button">Retry</button><button class="tiny-copy" id="startup-continue" type="button">Continue to app</button></div>` : '';
  const failure = !startupBusy && startupFailures.length ? `<div class="startup-failure" role="status"><b>${startupFailures.length} preview${startupFailures.length === 1 ? '' : 's'} failed.</b><p>The catalog is ready. You can retry failed previews or continue.</p><button class="secondary" id="startup-retry-failed" type="button">Retry failed</button><button class="tiny-copy" id="startup-continue-failed" type="button">Continue</button></div>` : '';
  return `<main class="startup-shell"><section class="startup-panel" aria-labelledby="startup-title"><div class="startup-mark">N</div><p class="eyebrow">NAI PROMPT STUDIO</p><h1 id="startup-title">Waking the V5 constellation</h1><p class="startup-copy">${escapeHtml(startupPhase)}. Preview data stays on this device.</p><div class="startup-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${startupTotal || 1}" aria-valuenow="${startupCompleted}" aria-label="Loading card previews"><div class="progress-track"><span style="width:${progress}%"></span></div><b>${startupCompleted.toLocaleString()} / ${startupTotal.toLocaleString()}</b></div>${error}${failure}</section></main>`;
}
function renderStartup(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  if (app.querySelector('.startup-shell')) {
    const progress = startupTotal ? Math.min(100, Math.round(startupCompleted / startupTotal * 100)) : 0;
    const track = app.querySelector<HTMLElement>('.startup-progress .progress-track span');
    if (track) track.style.width = `${progress}%`;
    const value = app.querySelector<HTMLElement>('.startup-progress b');
    if (value) value.textContent = `${startupCompleted.toLocaleString()} / ${startupTotal.toLocaleString()}`;
    const copy = app.querySelector<HTMLElement>('.startup-copy');
    if (copy) copy.textContent = `${startupPhase}. Preview data stays on this device.`;
    const bar = app.querySelector<HTMLElement>('.startup-progress');
    bar?.setAttribute('aria-valuenow', String(startupCompleted));
    if (!startupFailures.length && !startupError && !app.querySelector('.startup-error, .startup-failure')) return;
  }
  app.innerHTML = startupMarkup();
  document.querySelector('#startup-retry')?.addEventListener('click', () => void bootApp());
  document.querySelector('#startup-continue')?.addEventListener('click', () => { startupVisible = false; render(); });
  document.querySelector('#startup-continue-failed')?.addEventListener('click', () => { startupVisible = false; render(); });
  document.querySelector('#startup-retry-failed')?.addEventListener('click', () => void retryStartupFailures());
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
  startupCompleted = 0;
  startupTotal = cards.length;
  const retryIds = new Set(cards.map(card => card.catalogId ?? card.id));
  startupFailedCards = startupFailedCards.filter(card => !retryIds.has(card.catalogId ?? card.id));
  renderStartup();
  const result = await decodePreviews(cards, decodePreview, 6, (completed) => { startupCompleted = completed; renderStartup(); });
  startupFailedCards = [...startupFailedCards, ...result.failed];
  startupFailures = startupFailedCards.map(card => card.tag);
  renderStartup();
  return result.failed;
}
async function retryStartupFailures(): Promise<void> {
  const failed = [...startupFailedCards];
  if (!failed.length) return;
  startupBusy = true;
  await preloadCards(failed, 'Retrying failed previews');
  startupBusy = false;
  if (!startupFailedCards.length) {
    startupPhase = 'Opening studio';
    startupVisible = false;
    startupEntryPending = animationMode !== 'off';
    render();
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
  renderStartup();
  await Promise.all([loadCatalog(), loadGuide()]);
  if (catalogState !== 'ready') { startupError = catalogError || 'The V5 catalog could not be loaded.'; startupBusy = false; renderStartup(); return; }
  await preloadCards(catalog.artists, 'Preparing V5 artist previews');
  if (settings.preloadCharacterPreviews && catalog.characters.length) await preloadCards(catalog.characters, 'Preparing character previews');
  startupBusy = false;
  if (startupFailedCards.length) { startupPhase = 'Preview loading paused'; startupFailures = startupFailedCards.map(card => card.tag); renderStartup(); return; }
  startupPhase = 'Opening studio';
  startupVisible = false;
  startupEntryPending = animationMode !== 'off';
  render();
}

applyAnimationMode(animationMode);
renderStartup();
void bootApp();
window.addEventListener('beforeunload', () => { metadataWorkspace.dispose(); for (const key of [...customImageUrls.keys()]) revokeCustomImageUrl(key); const draft = currentDraft(); saveDraft(draft); window.naiStorage?.saveSync('draft', draft); });

export { normalizeRange, randomizeArtists, prompt };

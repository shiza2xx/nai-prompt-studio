import { DEFAULT_CUSTOM_TAG_PRESET_ID, DEFAULT_CUSTOM_TAG_PRESET_NAME } from './custom-tag-presets.ts';
import { mixCompanionCapacity } from './artist-mix-layout.ts';
import { MAX_PROMPT_RANDOM_ARTISTS } from './random.ts';
import { CUSTOM_TAG_MAX_LENGTH, type AnimationMode, type AppSettings, type ArtistMixDraft, type CustomTag, type CustomTagPackResult, type CustomTagPreset, type InterfaceScale, type PreviewCachePreset, type PromptDraft, type PromptSet, type SavedArtistMixData, type SavedCharacterData, type SavedLibraryItem, type SavedPromptData, type SavedPromptItem, type SavedPromptSnapshot, type StudioTheme, type WeightedTag } from './types.ts';

export type FavoriteKind = 'artists' | 'characters';

const KEY = 'nai-prompt-studio:sets';
const ARTIST_FAVORITES_KEY = 'nai-prompt-studio:v5-artist-favorites';
const CHARACTER_FAVORITES_KEY = 'nai-prompt-studio:character-favorites';
const LEGACY_FAVORITES_KEY = 'nai-prompt-studio:favorites';
const LEGACY_ARTIST_FAVORITES_KEY = 'nai-prompt-studio:favorite-artists';
const DRAFT_KEY = 'nai-prompt-studio:draft';
const RANDOM_RANGE_KEY = 'nai-prompt-studio:random-range';
const SETTINGS_KEY = 'nai-prompt-studio:settings';
const ARTIST_MIX_KEY = 'nai-prompt-studio:artist-mix';
export const SAVED_LIBRARY_KEY = 'nai-prompt-studio:saved-library';

function normalizeArtistWeight(value: unknown): number {
  const parsed = Number(value);
  const source = Number.isFinite(parsed) ? parsed : 1;
  return Number(Math.max(0.1, Math.min(2, Math.round(source * 10) / 10)).toFixed(1));
}

type DesktopSnapshot = { state?: 'missing' | 'ready' | 'error'; exists?: boolean; error?: string; data?: { version?: number; sets?: PromptSet[]; savedLibrary?: unknown; favorites?: string[]; characterFavorites?: string[]; draft?: unknown; settings?: unknown; artistMix?: unknown; customTags?: CustomTag[]; customTagPresets?: CustomTagPreset[]; customTagLibrary?: { version: 1; presets: CustomTagPreset[]; tags: CustomTag[]; warning?: string } } };

function bridge(): typeof window.naiStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.naiStorage; } catch { return undefined; }
}

function localArray<T>(key: string): T[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const value = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value as T[] : [];
  } catch { return []; }
}

function localValue<T>(key: string, fallback: T): T {
  try { return typeof localStorage === 'undefined' ? fallback : JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)) as T; }
  catch { return fallback; }
}

const desktopSnapshot: DesktopSnapshot = (() => {
  try { return bridge()?.load() as DesktopSnapshot ?? {}; } catch { return {}; }
})();
let cachedCustomTagPresets: CustomTagPreset[] | null = null;

export function workspaceRecoveryError(): string {
  return desktopSnapshot.state === 'error' ? (desktopSnapshot.error || 'The workspace file needs recovery before it can be opened.') : '';
}

export function loadCustomTagLibraryWarning(): string { return desktopSnapshot.data?.customTagLibrary?.warning ?? ''; }

/** True only when a profile existed before this renderer initialized. */
export function hasExistingProfile(): boolean {
  if (desktopSnapshot.exists) return true;
  if (typeof localStorage === 'undefined') return false;
  try {
    return [KEY, SAVED_LIBRARY_KEY, ARTIST_FAVORITES_KEY, CHARACTER_FAVORITES_KEY, DRAFT_KEY, SETTINGS_KEY, ARTIST_MIX_KEY]
      .some(key => localStorage.getItem(key) !== null);
  } catch { return false; }
}

export function loadSets(): PromptSet[] {
  const local = localArray<PromptSet>(KEY);
  const remote = desktopSnapshot.exists && Array.isArray(desktopSnapshot.data?.sets) ? desktopSnapshot.data!.sets! : null;
  const values = remote ?? local;
  if (!remote && values.length) bridge()?.save('sets', values);
  return values;
}

export function saveSets(sets: PromptSet[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(sets)); } catch { /* private browsing */ }
  bridge()?.save('sets', sets);
}

function cloneValue<T>(value: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch { /* fall through to the JSON-safe clone */ }
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSavedName(value: unknown, fallback: string): string {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return name || fallback;
}

function normalizeSavedTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeSavedMime(value: unknown): SavedLibraryItem['mime'] | undefined {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' ? value : undefined;
}

export function normalizeSavedPromptSnapshot(value: unknown): SavedPromptSnapshot | undefined {
  const draft = normalizeDraft(value);
  return draft ? cloneValue({ version: 3, base: draft.base, characters: draft.characters, randomRange: draft.randomRange ?? { min: 2, max: 5 } }) : undefined;
}

function normalizeSavedPromptData(value: unknown, prompt: string): SavedPromptData | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<SavedPromptData>;
  const characters = Array.isArray(source.characters) ? source.characters.flatMap((character, index) => {
    if (!character || typeof character !== 'object') return [];
    const value = character as Partial<SavedPromptData['characters'][number]>;
    return [{ id: typeof value.id === 'string' && value.id ? value.id : `character-${index + 1}`, label: normalizeSavedName(value.label, `Character ${index + 1}`), positive: typeof value.positive === 'string' ? value.positive : '', negative: typeof value.negative === 'string' ? value.negative : '' }];
  }) : [];
  return {
    ...(typeof source.model === 'string' ? { model: source.model.slice(0, 160) } : {}),
    ...(typeof source.steps === 'string' ? { steps: source.steps.slice(0, 80) } : {}),
    ...(typeof source.sampler === 'string' ? { sampler: source.sampler.slice(0, 160) } : {}),
    ...(typeof source.width === 'string' ? { width: source.width.slice(0, 32) } : {}),
    ...(typeof source.height === 'string' ? { height: source.height.slice(0, 32) } : {}),
    ...(typeof source.cfg === 'string' ? { cfg: source.cfg.slice(0, 80) } : {}),
    positive: typeof source.positive === 'string' ? source.positive : prompt,
    negative: typeof source.negative === 'string' ? source.negative : '',
    characters
  };
}

function snapshotToPromptData(snapshot: SavedPromptSnapshot | undefined, prompt: string): SavedPromptData | undefined {
  if (!snapshot) return undefined;
  return { positive: prompt || [snapshot.base.foundation, snapshot.base.frame, snapshot.base.artists.map(item => item.tag).join(', '), snapshot.base.setting, snapshot.base.render].filter(Boolean).join(', '), negative: snapshot.base.undesired, characters: snapshot.characters.map(character => ({ id: character.id, label: character.label, positive: character.prompt, negative: character.undesired })) };
}

function normalizeSavedArtistMixData(value: unknown, prompt: string, fallback?: ArtistMixDraft): SavedArtistMixData | undefined {
  const source = value && typeof value === 'object' ? value as Partial<SavedArtistMixData> : {};
  const artists = Array.isArray(source.artists) ? source.artists.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Partial<WeightedTag>;
    const tag = typeof item.tag === 'string' ? item.tag.trim().slice(0, 300) : '';
    if (!tag) return [];
    return [{ id: typeof item.id === 'string' && item.id ? item.id : `saved-artist-${index + 1}`, ...(typeof item.catalogId === 'string' ? { catalogId: item.catalogId } : {}), ...(typeof item.image === 'string' ? { image: item.image } : {}), tag, weight: normalizeArtistWeight(item.weight) }];
  }) : [...(fallback?.anchors ?? []), ...(fallback?.companions ?? [])];
  const serializedPrompt = typeof source.serializedPrompt === 'string' ? source.serializedPrompt : prompt;
  return artists.length || serializedPrompt ? { artists, serializedPrompt } : undefined;
}

function normalizeSavedCharacterData(value: unknown): SavedCharacterData | undefined {
  // Character records are a separate document kind. A malformed character
  // must be rejected rather than silently becoming a prompt record.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Partial<SavedCharacterData>;
  if (typeof source.positive !== 'string' || typeof source.negative !== 'string') return undefined;
  return { positive: source.positive, negative: source.negative };
}

export function normalizeSavedLibraryItem(value: unknown, fallbackNow = new Date().toISOString()): SavedLibraryItem | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<SavedLibraryItem> & { snapshot?: unknown; draft?: unknown; data?: unknown; source?: unknown; description?: unknown };
  if (source.kind === 'character') {
    const idValue = typeof source.id === 'string' ? source.id.trim() : '';
    if (!idValue || !/^[a-zA-Z0-9_-]+$/.test(idValue)) return null;
    const data = normalizeSavedCharacterData(source.data);
    if (!data) return null;
    const createdAt = normalizeSavedTimestamp(source.createdAt, fallbackNow);
    const updatedAt = normalizeSavedTimestamp(source.updatedAt, createdAt);
    const hasImageAsset = Object.prototype.hasOwnProperty.call(source, 'imageAsset');
    const hasMime = Object.prototype.hasOwnProperty.call(source, 'mime');
    const imageAsset = typeof source.imageAsset === 'string' && /^[a-zA-Z0-9._-]+$/.test(source.imageAsset) && !source.imageAsset.includes('..') ? source.imageAsset : undefined;
    const mime = normalizeSavedMime(source.mime);
    if ((hasImageAsset && !imageAsset) || (hasMime && !mime) || (hasImageAsset !== hasMime)) return null;
    return cloneValue({
      version: 4 as const,
      id: idValue,
      kind: 'character' as const,
      source: source.source === 'manual' || source.source === 'prompt-builder' || source.source === 'artist-mix' || source.source === 'metadata' || source.source === 'legacy' ? source.source : 'manual',
      name: normalizeSavedName(source.name, 'Saved character'),
      ...(typeof source.description === 'string' && source.description.trim() ? { description: source.description.trim().slice(0, 2000) } : {}),
      // Compatibility/search contract: prompt always mirrors positive.
      prompt: data.positive,
      ...(imageAsset && mime ? { imageAsset, mime, ...(typeof source.originalName === 'string' ? { originalName: source.originalName.slice(0, 255) } : {}) } : {}),
      createdAt,
      updatedAt,
      data
    });
  }
  const kind = source.kind === 'artist-mix' ? 'artist-mix' : 'prompt';
  const idValue = typeof source.id === 'string' ? source.id.trim() : '';
  if (!idValue || !/^[a-zA-Z0-9_-]+$/.test(idValue)) return null;
  const createdAt = normalizeSavedTimestamp(source.createdAt, fallbackNow);
  const updatedAt = normalizeSavedTimestamp(source.updatedAt, createdAt);
  const prompt = typeof source.prompt === 'string' ? source.prompt : '';
  const common = {
    version: 4 as const,
    id: idValue,
    name: normalizeSavedName(source.name, kind === 'artist-mix' ? 'Artist Mix' : 'Saved prompt'),
    source: source.source === 'manual' || source.source === 'prompt-builder' || source.source === 'artist-mix' || source.source === 'metadata' || source.source === 'legacy' ? source.source : 'legacy',
    ...(typeof source.description === 'string' && source.description.trim() ? { description: source.description.trim().slice(0, 2000) } : {}),
    prompt,
    ...(typeof source.imageAsset === 'string' && /^[a-zA-Z0-9._-]+$/.test(source.imageAsset) && !source.imageAsset.includes('..') ? { imageAsset: source.imageAsset } : {}),
    ...(normalizeSavedMime(source.mime) ? { mime: normalizeSavedMime(source.mime) } : {}),
    ...(typeof source.originalName === 'string' ? { originalName: source.originalName.slice(0, 255) } : {}),
    createdAt,
    updatedAt
  };
  if (kind === 'artist-mix') {
    const snapshot = normalizeArtistMix(source.snapshot);
    const data = normalizeSavedArtistMixData(source.data, prompt, snapshot);
    if (!snapshot.anchors.length && !snapshot.companions.length && !data) return null;
    return cloneValue({ ...common, kind, snapshot, ...(data ? { data } : {}) });
  }
  const snapshot = normalizeSavedPromptSnapshot(source.snapshot ?? source.draft);
  const data = normalizeSavedPromptData(source.data, prompt) ?? snapshotToPromptData(snapshot, prompt);
  const legacy = (source as { legacy?: unknown }).legacy === true || !snapshot;
  return cloneValue({ ...common, kind, ...(snapshot ? { snapshot } : {}), ...(data ? { data } : {}), ...(legacy ? { legacy: true } : {}) } satisfies SavedPromptItem);
}

export function normalizeSavedLibrary(values: unknown): SavedLibraryItem[] {
  if (!Array.isArray(values)) return [];
  const result: SavedLibraryItem[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    const item = normalizeSavedLibraryItem(value);
    if (item && !ids.has(item.id)) { ids.add(item.id); result.push(item); }
  }
  return result;
}

function migrateLegacySets(values: unknown): SavedLibraryItem[] {
  if (!Array.isArray(values)) return [];
  const result: SavedLibraryItem[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const source = value as Partial<PromptSet>;
    const item = normalizeSavedLibraryItem({
      id: source.id,
      kind: 'prompt',
      name: source.name,
      prompt: source.prompt,
      createdAt: source.createdAt,
      updatedAt: source.createdAt,
      legacy: true
    });
    if (item) result.push(item);
  }
  return result;
}

/** Load v3 Saved Library data, migrating legacy PromptSet records once. */
export function loadSavedLibrary(): SavedLibraryItem[] {
  const remote = desktopSnapshot.exists ? desktopSnapshot.data?.savedLibrary : undefined;
  const local = localArray<unknown>(SAVED_LIBRARY_KEY);
  let localHasSavedLibrary = false;
  try { localHasSavedLibrary = typeof localStorage !== 'undefined' && localStorage.getItem(SAVED_LIBRARY_KEY) !== null; } catch { /* private browsing */ }
  let values: SavedLibraryItem[];
  if (Array.isArray(remote)) values = normalizeSavedLibrary(remote);
  else if (localHasSavedLibrary) values = normalizeSavedLibrary(local);
  else values = migrateLegacySets(desktopSnapshot.exists ? desktopSnapshot.data?.sets : localArray<PromptSet>(KEY));
  if (!Array.isArray(remote) && (!localHasSavedLibrary || values.length)) saveSavedLibrary(values);
  return cloneValue(values);
}

export function saveSavedLibrary(values: SavedLibraryItem[]): void {
  const normalized = normalizeSavedLibrary(values);
  try { localStorage.setItem(SAVED_LIBRARY_KEY, JSON.stringify(normalized)); } catch { /* private browsing */ }
  bridge()?.save('savedLibrary', cloneValue(normalized));
}

export async function saveLibraryImage(metadata: { id: string; mime: SavedLibraryItem['mime']; originalName?: string }, bytes: Uint8Array): Promise<{ imageAsset: string; mime?: SavedLibraryItem['mime']; originalName?: string }> {
  const saver = bridge()?.saveLibraryImage;
  if (!saver) throw new Error('Cover images require the desktop app and cannot persist in a browser tab.');
  return saver(metadata, bytes);
}

export async function deleteLibraryImage(asset: string): Promise<boolean> {
  const deleter = bridge()?.deleteLibraryImage;
  if (!deleter) return false;
  return deleter(asset);
}

function favoriteKey(kind: FavoriteKind): string { return kind === 'artists' ? ARTIST_FAVORITES_KEY : CHARACTER_FAVORITES_KEY; }

export function loadFavorites(kind: FavoriteKind = 'artists'): Set<string> {
  const key = favoriteKey(kind);
  const local = localArray<string>(key);
  const remote = desktopSnapshot.exists
    ? (kind === 'characters'
      ? (desktopSnapshot.data?.characterFavorites ?? desktopSnapshot.data?.favorites?.filter(value => value.startsWith('character-')))
      : (desktopSnapshot.data?.version && desktopSnapshot.data.version >= 2 ? desktopSnapshot.data?.favorites : undefined))
    : undefined;
  // V4/V4.5 artist IDs are not stable in V5. Legacy artist favorites are
  // intentionally discarded; character favorites remain in their own store.
  const legacy = kind === 'artists'
    ? [...localArray<string>(LEGACY_ARTIST_FAVORITES_KEY), ...localArray<string>(LEGACY_FAVORITES_KEY)]
    : localArray<string>(LEGACY_FAVORITES_KEY).filter(value => value.startsWith('character-'));
  const values = remote ? remote : (local.length ? local : legacy);
  if (!remote && kind === 'characters' && values.length) {
    try { localStorage.setItem(CHARACTER_FAVORITES_KEY, JSON.stringify(values)); } catch { /* private browsing */ }
    bridge()?.save('characterFavorites', values);
  }
  if (!remote && kind === 'artists' && legacy.length && !local.length) {
    try { localStorage.setItem(ARTIST_FAVORITES_KEY, '[]'); } catch { /* noop */ }
  }
  return new Set(values);
}

export function saveFavorites(favorites: Set<string>, kind: FavoriteKind = 'artists'): void {
  const values = [...favorites];
  try { localStorage.setItem(favoriteKey(kind), JSON.stringify(values)); } catch { /* private browsing */ }
  bridge()?.save(kind === 'characters' ? 'characterFavorites' : 'favorites', values);
}

/** Normalize persisted replacement counts to the Prompt Builder safety cap. */
export function normalizeRandomRange(value: unknown): { min: number; max: number } {
  const source = value && typeof value === 'object' ? value as { min?: unknown; max?: unknown } : {};
  const rawMin = Number(source.min);
  const rawMax = Number(source.max);
  const min = Math.min(MAX_PROMPT_RANDOM_ARTISTS, Math.max(2, Number.isFinite(rawMin) ? Math.round(rawMin) : 2));
  const requestedMax = Number.isFinite(rawMax) ? Math.round(rawMax) : 5;
  return { min, max: Math.min(MAX_PROMPT_RANDOM_ARTISTS, Math.max(min, requestedMax)) };
}

/**
 * Normalize Artist Mix totals independently from the legacy Prompt Builder
 * replacement range. Mix totals are allowed to be 1..12 and anchor count is
 * a floor only while anchors are present; removing anchors therefore does not
 * silently shrink a user's saved range.
 */
export function normalizeArtistMixRange(value: unknown, anchorCount = 0): { min: number; max: number } {
  const source = value && typeof value === 'object' ? value as { min?: unknown; max?: unknown } : {};
  const floor = Math.max(1, Math.min(12, Math.floor(Number(anchorCount) || 0)));
  const rawMin = Number(source.min);
  const rawMax = Number(source.max);
  const min = Math.max(floor, Math.min(12, Number.isFinite(rawMin) ? Math.round(rawMin) : floor));
  const max = Math.max(min, Math.min(12, Number.isFinite(rawMax) ? Math.round(rawMax) : Math.max(floor, 5)));
  return { min, max };
}

export function normalizeAnimationMode(value: unknown): AnimationMode {
  return value === 'on' || value === 'off' ? value : 'auto';
}
export function normalizeTheme(value: unknown): StudioTheme {
  return value === 'midnight-blue' || value === 'raspberry-rose' || value === 'noir' || value === 'celestial-light' || value === 'ember-peach' || value === 'gothic-ivory' || value === 'galaxy' ? value : 'arcane-gold';
}

export function normalizePreviewCachePreset(value: unknown): PreviewCachePreset {
  return value === 'balanced' ? 'balanced' : 'large';
}

export function normalizeSettings(value: unknown, legacyAnimationMode?: unknown): AppSettings {
  const source = value && typeof value === 'object' ? value as Partial<AppSettings> : {};
  const legacy = source as Partial<AppSettings> & { scale?: unknown; uiScale?: unknown; displayScale?: unknown };
  return {
    animationMode: normalizeAnimationMode(source.animationMode ?? legacyAnimationMode),
    preloadCharacterPreviews: source.preloadCharacterPreviews === true,
    theme: normalizeTheme(source.theme),
    updateCatalogOnStartup: source.updateCatalogOnStartup !== false,
    checkAppUpdatesOnStartup: source.checkAppUpdatesOnStartup !== false,
    seenGuideIds: Array.isArray(source.seenGuideIds) ? source.seenGuideIds.filter((item): item is string => typeof item === 'string').slice(0, 100) : [],
    lastSeenVersion: typeof source.lastSeenVersion === 'string' ? source.lastSeenVersion : '',
    previewCachePreset: normalizePreviewCachePreset(source.previewCachePreset),
    interfaceScale: normalizeInterfaceScale(source.interfaceScale ?? legacy.scale ?? legacy.uiScale ?? legacy.displayScale)
  };
}

export function normalizeInterfaceScale(value: unknown): InterfaceScale {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return parsed === 110 || parsed === 125 ? parsed : 100;
}

export function loadSettings(legacyAnimationMode?: unknown): AppSettings {
  const remote = desktopSnapshot.exists ? desktopSnapshot.data?.settings : undefined;
  const local = localValue<unknown>(SETTINGS_KEY, null);
  const value = normalizeSettings(remote ?? local, legacyAnimationMode);
  // Persist additive migrations (including the large preview-cache default)
  // when an older desktop profile omits the new field.
  if (remote === undefined) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* private browsing */ }
  }
  if (bridge() && (remote === undefined || JSON.stringify(remote) !== JSON.stringify(value))) bridge()?.save('settings', value);
  return value;
}

export function saveSettings(settings: AppSettings): void {
  const value = normalizeSettings(settings);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* private browsing */ }
  bridge()?.save('settings', value);
}

function normalizeMixTag(value: unknown): WeightedTag | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<WeightedTag>;
  const id = typeof item.id === 'string' ? item.id : '';
  const catalogId = typeof item.catalogId === 'string' ? item.catalogId : id;
  if (!catalogId || !/^artist-v5-/.test(catalogId)) return null;
  return { id: id || catalogId, catalogId, image: typeof item.image === 'string' ? item.image : undefined, tag: String(item.tag ?? ''), weight: normalizeArtistWeight(item.weight) };
}

export function normalizeArtistMix(value: unknown): ArtistMixDraft {
  const source = value && typeof value === 'object' ? value as Partial<ArtistMixDraft> & { primary?: unknown } : {};
  const rawAnchors = Array.isArray(source.anchors) ? source.anchors : source.primary ? [source.primary] : [];
  const anchors: WeightedTag[] = [];
  const seen = new Set<string>();
  for (const raw of rawAnchors) {
    const item = normalizeMixTag(raw); const key = item?.catalogId;
    if (item && key && !seen.has(key) && anchors.length < 12) { seen.add(key); anchors.push(item); }
  }
  const companions: WeightedTag[] = [];
  const companionLimit = mixCompanionCapacity(anchors.length);
  if (Array.isArray(source.companions)) for (const raw of source.companions) {
    const item = normalizeMixTag(raw);
    const key = item?.catalogId;
    if (item && key && !seen.has(key) && companions.length < companionLimit) { seen.add(key); companions.push(item); }
  }
  return { version: 2, anchors, companions, randomRange: normalizeArtistMixRange(source.randomRange, anchors.length), favoritesOnly: source.favoritesOnly === true, anchorWeightsLocked: source.anchorWeightsLocked !== false };
}

export function loadArtistMix(): ArtistMixDraft {
  const remote = desktopSnapshot.exists ? desktopSnapshot.data?.artistMix : undefined;
  return normalizeArtistMix(remote ?? localValue<unknown>(ARTIST_MIX_KEY, null));
}

export function saveArtistMix(mix: ArtistMixDraft): void {
  const value = normalizeArtistMix(mix);
  try { localStorage.setItem(ARTIST_MIX_KEY, JSON.stringify(value)); } catch { /* private browsing */ }
  bridge()?.save('artistMix', value);
}

export function normalizeDraft(value: unknown): PromptDraft | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PromptDraft> & { base?: Partial<PromptDraft['base']> };
  if (!candidate.base || typeof candidate.base !== 'object') return null;
  const base = candidate.base;
  const artists = Array.isArray(base.artists)
    ? (base.artists as WeightedTag[]).filter(item => {
      if (!item || typeof item !== 'object') return false;
      const stableId = typeof item.catalogId === 'string' ? item.catalogId : item.id;
      // Preserve legacy Prompt Builder artist rows even when their catalog no
      // longer exists. They remain readable in the draft and are deliberately
      // excluded from output unless the user enables the Artist Mix link.
      return typeof stableId === 'string' && Boolean(stableId.trim());
    }).map(item => {
      const stableId = (typeof item.catalogId === 'string' ? item.catalogId : item.id) as string;
      return {
        id: String(item.id || stableId), catalogId: stableId, image: item.image, tag: String(item.tag ?? ''), weight: normalizeArtistWeight(item.weight)
      };
    })
    : [];
  const characters = Array.isArray(candidate.characters) ? candidate.characters.filter(item => item && typeof item === 'object').map(item => ({
    id: String(item.id || crypto.randomUUID()), label: String(item.label || 'Character'), prompt: String(item.prompt || ''), undesired: String(item.undesired || '')
  })) : [];
  const randomRange = candidate.randomRange && typeof candidate.randomRange === 'object' ? candidate.randomRange : localValue(RANDOM_RANGE_KEY, { min: 2, max: 5 });
  return {
    version: 4,
    base: { foundation: String(base.foundation || ''), frame: String(base.frame || ''), artists, setting: String(base.setting || ''), render: String(base.render || ''), undesired: String(base.undesired || '') },
    characters,
    randomRange: normalizeRandomRange(randomRange),
    useArtistMix: candidate.useArtistMix === true,
    animationMode: normalizeAnimationMode(candidate.animationMode)
  };
}

export function loadDraft(): PromptDraft | null {
  const remote = desktopSnapshot.exists ? desktopSnapshot.data?.draft : undefined;
  let raw = remote;
  if (raw === undefined) {
    try { raw = typeof localStorage === 'undefined' ? null : JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { raw = null; }
  }
  const value = normalizeDraft(raw);
  if (value && remote === undefined) bridge()?.save('draft', value);
  return value;
}

export function saveDraft(draft: PromptDraft): void {
  const value = normalizeDraft(draft) ?? draft;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
    localStorage.setItem(RANDOM_RANGE_KEY, JSON.stringify(value.randomRange ?? { min: 2, max: 5 }));
  } catch { /* private browsing */ }
  bridge()?.save('draft', value);
}

export function normalizeCustomTag(value: unknown): CustomTag | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<CustomTag>;
  const tag = typeof item.tag === 'string' ? item.tag.trim() : '';
  if (typeof item.id !== 'string' || !item.id || !tag || tag.length > CUSTOM_TAG_MAX_LENGTH) return null;
  if (item.zone !== 'frame' && item.zone !== 'scene' && item.zone !== 'render' && item.zone !== 'character') return null;
  const kind = item.kind === 'artist' ? 'artist' : 'tag';
  const asset = typeof item.imageAsset === 'string' ? item.imageAsset.replace(/\\/g, '/') : '';
  const hasAsset = /^(?:[a-zA-Z0-9._-]+|memory-[a-zA-Z0-9_-]+|[a-zA-Z0-9_-]+\/previews\/[a-f0-9]{64}\.(?:png|jpg|webp))$/.test(asset) && !asset.includes('..');
  const mime = item.mime === 'image/png' || item.mime === 'image/jpeg' || item.mime === 'image/webp' ? item.mime : null;
  const description = typeof item.description === 'string' ? item.description.slice(0, 2000) : '';
  // Existing prompt-constructor cards remain strict. Artists may be text-only
  // and intentionally use the built-in plus-card placeholder.
  if (kind === 'tag' && (!hasAsset || !mime)) return null;
  if ((hasAsset && !mime) || (!hasAsset && mime)) return null;
  const now = new Date().toISOString();
  return {
    id: item.id,
    kind,
    tag,
    zone: item.zone,
    presetId: typeof item.presetId === 'string' && /^[a-zA-Z0-9_-]+$/.test(item.presetId.trim()) ? item.presetId.trim() : DEFAULT_CUSTOM_TAG_PRESET_ID,
    description,
    ...(hasAsset && mime ? { imageAsset: asset, mime } : {}),
    originalName: typeof item.originalName === 'string' ? item.originalName : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now
  };
}

function normalizedPresetName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function presetNameKey(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }

function normalizedTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function normalizeCustomTagPreset(value: unknown, fallbackNow = new Date().toISOString()): CustomTagPreset | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<CustomTagPreset>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const name = normalizedPresetName(item.name);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || id === DEFAULT_CUSTOM_TAG_PRESET_ID || !name) return null;
  const createdAt = normalizedTimestamp(item.createdAt, fallbackNow);
  const updatedAt = normalizedTimestamp(item.updatedAt, createdAt);
  return { id, name, createdAt, updatedAt };
}

function defaultPreset(now = new Date().toISOString()): CustomTagPreset {
  return { id: DEFAULT_CUSTOM_TAG_PRESET_ID, name: DEFAULT_CUSTOM_TAG_PRESET_NAME, createdAt: now, updatedAt: now };
}

/** Normalize preset folders and always return the stable built-in destination. */
export function normalizeCustomTagPresets(values: unknown): CustomTagPreset[] {
  const result: CustomTagPreset[] = [];
  const seenIds = new Set<string>([DEFAULT_CUSTOM_TAG_PRESET_ID]);
  const seenNames = new Set<string>([presetNameKey(DEFAULT_CUSTOM_TAG_PRESET_NAME)]);
  let defaultValue: CustomTagPreset | null = null;
  if (Array.isArray(values)) {
    for (const value of values) {
      if (value && typeof value === 'object' && (value as Partial<CustomTagPreset>).id === DEFAULT_CUSTOM_TAG_PRESET_ID) {
        const source = value as Partial<CustomTagPreset>;
        const now = new Date().toISOString();
        defaultValue = {
          id: DEFAULT_CUSTOM_TAG_PRESET_ID,
          name: DEFAULT_CUSTOM_TAG_PRESET_NAME,
          createdAt: normalizedTimestamp(source.createdAt, now),
          updatedAt: normalizedTimestamp(source.updatedAt, normalizedTimestamp(source.createdAt, now))
        };
        continue;
      }
      const preset = normalizeCustomTagPreset(value);
      if (!preset || seenIds.has(preset.id) || seenNames.has(presetNameKey(preset.name))) continue;
      seenIds.add(preset.id);
      seenNames.add(presetNameKey(preset.name));
      result.push(preset);
    }
  }
  result.unshift(defaultValue ?? defaultPreset());
  return result;
}

/** Migrate legacy or unknown folder references to the stable default folder. */
export function normalizeCustomTagPresetId(value: unknown, presets: readonly CustomTagPreset[]): string {
  return typeof value === 'string' && presets.some(preset => preset.id === value) ? value : DEFAULT_CUSTOM_TAG_PRESET_ID;
}

export function loadCustomTagPresets(): CustomTagPreset[] {
  if (cachedCustomTagPresets) return cachedCustomTagPresets;
  if (!bridge()) { cachedCustomTagPresets = [defaultPreset()]; return cachedCustomTagPresets; }
  const remote = Array.isArray(desktopSnapshot.data?.customTagLibrary?.presets) ? desktopSnapshot.data!.customTagLibrary!.presets : desktopSnapshot.exists && Array.isArray(desktopSnapshot.data?.customTagPresets)
    ? desktopSnapshot.data!.customTagPresets
    : [];
  const normalized = normalizeCustomTagPresets(remote);
  cachedCustomTagPresets = normalized;
  return normalized;
}

export function saveCustomTagPresets(presets: CustomTagPreset[]): void {
  // Browser mode intentionally keeps preset folders in the active renderer
  // session. Electron persists only normalized metadata in workspace.json.
  cachedCustomTagPresets = normalizeCustomTagPresets(presets);
  if (!bridge()) return;
}

export function loadCustomTags(): CustomTag[] {
  // Browser mode is deliberately session-only. Image bytes are not persisted,
  // so loading metadata from localStorage would recreate broken asset URLs.
  if (!bridge()) return [];
  const presets = loadCustomTagPresets();
  const source = Array.isArray(desktopSnapshot.data?.customTagLibrary?.tags) ? desktopSnapshot.data!.customTagLibrary!.tags : desktopSnapshot.data?.customTags;
  const remote = Array.isArray(source)
    ? source.map(normalizeCustomTag).filter((item): item is CustomTag => Boolean(item)).map(item => ({
      ...item,
      presetId: normalizeCustomTagPresetId(item.presetId, presets)
    }))
    : null;
  return remote ?? [];
}

export function saveCustomTags(tags: CustomTag[]): void {
  const normalized = tags.map(normalizeCustomTag).filter((item): item is CustomTag => Boolean(item));
  // Desktop/CMD persists metadata in workspace.json. Browser mode keeps the
  // caller's in-memory array only and never writes metadata without bytes.
  void normalized;
}

export async function transactCustomTags(operation: 'preset:create' | 'preset:update' | 'preset:delete' | 'card:upsert' | 'card:delete' | 'card:move' | 'card:reorder' | 'card:bulk-move' | 'card:bulk-delete', payload: object, bytes?: Uint8Array): Promise<{ version: 1; presets: CustomTagPreset[]; tags: CustomTag[]; warning?: string } | null> {
  const storage = bridge();
  if (!storage?.transactCustomTags) return null;
  return storage.transactCustomTags(operation, payload, bytes);
}

export async function importCustomTags(): Promise<CustomTagPackResult | null> {
  const action = bridge()?.importCustomTags;
  return action ? action() : null;
}

export async function importCustomTagsPath(filePath: string): Promise<CustomTagPackResult | null> {
  const action = bridge()?.importCustomTagsPath;
  return action ? action(filePath) : null;
}

export async function exportCustomTags(presetId: string): Promise<CustomTagPackResult | null> {
  const action = bridge()?.exportCustomTags;
  return action ? action(presetId) : null;
}

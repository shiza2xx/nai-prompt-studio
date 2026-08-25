import { DEFAULT_CUSTOM_TAG_PRESET_ID, DEFAULT_CUSTOM_TAG_PRESET_NAME } from './custom-tag-presets.ts';
import type { AnimationMode, AppSettings, ArtistMixDraft, CustomTag, CustomTagPreset, PromptDraft, PromptSet, StudioTheme, WeightedTag } from './types';

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

function normalizeArtistWeight(value: unknown): number {
  const parsed = Number(value);
  const source = Number.isFinite(parsed) ? parsed : 1;
  return Number(Math.max(0.1, Math.min(2, Math.round(source * 10) / 10)).toFixed(1));
}

type DesktopSnapshot = { exists?: boolean; data?: { version?: number; sets?: PromptSet[]; favorites?: string[]; characterFavorites?: string[]; draft?: unknown; settings?: unknown; artistMix?: unknown; customTags?: CustomTag[]; customTagPresets?: CustomTagPreset[] } };

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

/** True only when a profile existed before this renderer initialized. */
export function hasExistingProfile(): boolean {
  if (desktopSnapshot.exists) return true;
  if (typeof localStorage === 'undefined') return false;
  try {
    return [KEY, ARTIST_FAVORITES_KEY, CHARACTER_FAVORITES_KEY, DRAFT_KEY, SETTINGS_KEY, ARTIST_MIX_KEY]
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

/** Normalize the persisted count range without imposing a catalog-size cap. */
export function normalizeRandomRange(value: unknown): { min: number; max: number } {
  const source = value && typeof value === 'object' ? value as { min?: unknown; max?: unknown } : {};
  const rawMin = Number(source.min);
  const rawMax = Number(source.max);
  const min = Math.max(2, Number.isFinite(rawMin) ? Math.round(rawMin) : 2);
  const requestedMax = Number.isFinite(rawMax) ? Math.round(rawMax) : 5;
  return { min, max: Math.max(min, requestedMax) };
}

export function normalizeAnimationMode(value: unknown): AnimationMode {
  return value === 'on' || value === 'off' ? value : 'auto';
}
export function normalizeTheme(value: unknown): StudioTheme { return value === 'midnight-blue' ? 'midnight-blue' : 'arcane-gold'; }

export function normalizeSettings(value: unknown, legacyAnimationMode?: unknown): AppSettings {
  const source = value && typeof value === 'object' ? value as Partial<AppSettings> : {};
  return {
    animationMode: normalizeAnimationMode(source.animationMode ?? legacyAnimationMode),
    preloadCharacterPreviews: source.preloadCharacterPreviews === true,
    theme: normalizeTheme(source.theme),
    updateCatalogOnStartup: source.updateCatalogOnStartup !== false,
    checkAppUpdatesOnStartup: source.checkAppUpdatesOnStartup !== false,
    seenGuideIds: Array.isArray(source.seenGuideIds) ? source.seenGuideIds.filter((item): item is string => typeof item === 'string').slice(0, 100) : [],
    lastSeenVersion: typeof source.lastSeenVersion === 'string' ? source.lastSeenVersion : ''
  };
}

export function loadSettings(legacyAnimationMode?: unknown): AppSettings {
  const remote = desktopSnapshot.exists ? desktopSnapshot.data?.settings : undefined;
  const local = localValue<unknown>(SETTINGS_KEY, null);
  const value = normalizeSettings(remote ?? local, legacyAnimationMode);
  if (remote === undefined && bridge()) bridge()?.save('settings', value);
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
  const range = normalizeRandomRange(source.randomRange);
  const rawAnchors = Array.isArray(source.anchors) ? source.anchors : source.primary ? [source.primary] : [];
  const anchors: WeightedTag[] = [];
  const seen = new Set<string>();
  for (const raw of rawAnchors) {
    const item = normalizeMixTag(raw); const key = item?.catalogId;
    if (item && key && !seen.has(key) && anchors.length < 4) { seen.add(key); anchors.push(item); }
  }
  const companions: WeightedTag[] = [];
  if (Array.isArray(source.companions)) for (const raw of source.companions) {
    const item = normalizeMixTag(raw);
    const key = item?.catalogId;
    if (item && key && !seen.has(key) && anchors.length + companions.length < 12) { seen.add(key); companions.push(item); }
  }
  if (!anchors.length && companions.length) anchors.push(companions.shift()!);
  return { version: 2, anchors, companions, randomRange: { min: Math.min(12, range.min), max: Math.min(12, range.max) }, favoritesOnly: source.favoritesOnly === true };
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
      return typeof stableId === 'string' && /^artist-v5-/.test(stableId);
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
    version: 2,
    base: { frame: String(base.frame || ''), artists, setting: String(base.setting || ''), render: String(base.render || ''), undesired: String(base.undesired || '') },
    characters,
    randomRange: normalizeRandomRange(randomRange),
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
  if (typeof item.id !== 'string' || !item.id || typeof item.tag !== 'string' || !item.tag.trim()) return null;
  if (item.zone !== 'frame' && item.zone !== 'scene' && item.zone !== 'render') return null;
  const kind = item.kind === 'artist' ? 'artist' : 'tag';
  const hasAsset = typeof item.imageAsset === 'string' && !item.imageAsset.startsWith('memory-') && /^[a-zA-Z0-9._-]+$/.test(item.imageAsset);
  const mime = item.mime === 'image/png' || item.mime === 'image/jpeg' || item.mime === 'image/webp' ? item.mime : null;
  // Existing prompt-constructor cards remain strict. Artists may be text-only
  // and intentionally use the built-in plus-card placeholder.
  if (kind === 'tag' && (!hasAsset || !mime)) return null;
  if ((hasAsset && !mime) || (!hasAsset && mime)) return null;
  const now = new Date().toISOString();
  return {
    id: item.id,
    kind,
    tag: item.tag.trim(),
    zone: item.zone,
    presetId: typeof item.presetId === 'string' && /^[a-zA-Z0-9_-]+$/.test(item.presetId.trim()) ? item.presetId.trim() : DEFAULT_CUSTOM_TAG_PRESET_ID,
    description: typeof item.description === 'string' ? item.description : '',
    ...(hasAsset && mime ? { imageAsset: item.imageAsset, mime } : {}),
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
  const remote = desktopSnapshot.exists && Array.isArray(desktopSnapshot.data?.customTagPresets)
    ? desktopSnapshot.data!.customTagPresets
    : [];
  const normalized = normalizeCustomTagPresets(remote);
  if (!desktopSnapshot.data?.customTagPresets || JSON.stringify(remote) !== JSON.stringify(normalized)) bridge()?.save('customTagPresets', normalized);
  cachedCustomTagPresets = normalized;
  return normalized;
}

export function saveCustomTagPresets(presets: CustomTagPreset[]): void {
  // Browser mode intentionally keeps preset folders in the active renderer
  // session. Electron persists only normalized metadata in workspace.json.
  cachedCustomTagPresets = normalizeCustomTagPresets(presets);
  if (!bridge()) return;
  bridge()?.save('customTagPresets', cachedCustomTagPresets);
}

export function loadCustomTags(): CustomTag[] {
  // Browser mode is deliberately session-only. Image bytes are not persisted,
  // so loading metadata from localStorage would recreate broken asset URLs.
  if (!bridge()) return [];
  const presets = loadCustomTagPresets();
  const remote = desktopSnapshot.exists && Array.isArray(desktopSnapshot.data?.customTags)
    ? desktopSnapshot.data!.customTags!.map(normalizeCustomTag).filter((item): item is CustomTag => Boolean(item)).map(item => ({
      ...item,
      presetId: normalizeCustomTagPresetId(item.presetId, presets)
    }))
    : null;
  if (remote && desktopSnapshot.data?.customTags && JSON.stringify(remote) !== JSON.stringify(desktopSnapshot.data.customTags)) bridge()?.save('customTags', remote);
  return remote ?? [];
}

export function saveCustomTags(tags: CustomTag[]): void {
  const normalized = tags.map(normalizeCustomTag).filter((item): item is CustomTag => Boolean(item));
  // Desktop/CMD persists metadata in workspace.json. Browser mode keeps the
  // caller's in-memory array only and never writes metadata without bytes.
  bridge()?.save('customTags', normalized);
}

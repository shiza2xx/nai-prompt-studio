export type Subject = 'girl' | 'boy' | 'mixed' | 'other';

export type AnimationMode = 'auto' | 'on' | 'off';
export type StudioTheme = 'arcane-gold' | 'midnight-blue' | 'raspberry-rose' | 'noir' | 'celestial-light' | 'ember-peach' | 'gothic-ivory' | 'galaxy';
export type PreviewCachePreset = 'large' | 'balanced';
export type InterfaceScale = 100 | 110 | 125;

export interface PreviewCacheBudgets {
  grid: number;
  content: number;
  hover: number;
}

export const PREVIEW_CACHE_BUDGETS: Record<PreviewCachePreset, PreviewCacheBudgets> = {
  large: { grid: 1024 * 1024 * 1024, content: 384 * 1024 * 1024, hover: 128 * 1024 * 1024 },
  balanced: { grid: 384 * 1024 * 1024, content: 128 * 1024 * 1024, hover: 64 * 1024 * 1024 }
};

export interface WeightedTag {
  id: string;
  /** Stable V5 catalog identity used to restore cards across snapshots. */
  catalogId?: string;
  /** Relative offline card image path, retained with the draft for migration. */
  image?: string;
  tag: string;
  weight: number;
}

export interface Character {
  id: string;
  label: string;
  prompt: string;
  undesired: string;
}

export interface PromptSet {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
}

/** Structured Prompt Builder state captured by a Saved Library prompt item. */
export interface SavedPromptSnapshot {
  version: 3;
  base: BasePrompt;
  characters: Character[];
  randomRange: { min: number; max: number };
}

export interface SavedLibraryCommon {
  /** V4 records are autonomous documents, never pointers into live workspaces. */
  version?: 4;
  id: string;
  kind: 'prompt' | 'artist-mix' | 'character';
  source?: 'manual' | 'prompt-builder' | 'artist-mix' | 'metadata' | 'legacy';
  name: string;
  description?: string;
  /** Flattened base or artist prompt retained for quick copy and migration. */
  prompt: string;
  imageAsset?: string;
  mime?: 'image/png' | 'image/jpeg' | 'image/webp';
  originalName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPromptCharacterData {
  id: string;
  label: string;
  positive: string;
  negative: string;
}

export interface SavedPromptData {
  model?: string;
  steps?: string;
  sampler?: string;
  width?: string;
  height?: string;
  cfg?: string;
  positive: string;
  negative: string;
  characters: SavedPromptCharacterData[];
}

export interface SavedArtistMixData {
  artists: WeightedTag[];
  serializedPrompt: string;
}

export interface SavedPromptItem extends SavedLibraryCommon {
  kind: 'prompt';
  data?: SavedPromptData;
  /** Missing only for migrated legacy PromptSet records, which are copy-only. */
  snapshot?: SavedPromptSnapshot;
  legacy?: boolean;
}

export interface SavedArtistMixItem extends SavedLibraryCommon {
  kind: 'artist-mix';
  data?: SavedArtistMixData;
  snapshot: ArtistMixDraft;
}

/** Autonomous character document in Saved Library. It never points at the live builder. */
export interface SavedCharacterData {
  positive: string;
  negative: string;
}

export interface SavedCharacterItem extends SavedLibraryCommon {
  kind: 'character';
  data: SavedCharacterData;
}

export type SavedLibraryItem = SavedPromptItem | SavedArtistMixItem | SavedCharacterItem;

export interface BasePrompt {
  /** Opaque user-authored prompt text placed before Frame. */
  foundation: string;
  frame: string;
  artists: WeightedTag[];
  setting: string;
  render: string;
  undesired: string;
}

export interface PromptDraft {
  version?: number;
  base: BasePrompt;
  characters: Character[];
  randomRange?: { min: number; max: number };
  /** Link Prompt Builder output to the current Artist Mix selection. */
  useArtistMix: boolean;
  animationMode?: AnimationMode;
}

export interface AppSettings {
  animationMode: AnimationMode;
  preloadCharacterPreviews: boolean;
  theme: StudioTheme;
  updateCatalogOnStartup: boolean;
  checkAppUpdatesOnStartup: boolean;
  seenGuideIds: string[];
  lastSeenVersion: string;
  /** Runtime preview memory ceilings. Missing legacy values migrate to large. */
  previewCachePreset: PreviewCachePreset;
  /** Persisted renderer scale, restricted to the supported allowlist. */
  interfaceScale: InterfaceScale;
}

export interface ArtistMixDraft {
  version: 2;
  anchors: WeightedTag[];
  companions: WeightedTag[];
  randomRange: { min: number; max: number };
  favoritesOnly: boolean;
  /** Whether Mix and strength rerolls leave anchor weights unchanged. */
  anchorWeightsLocked: boolean;
}

export interface GuideExample {
  tag: string;
  section: string;
  image: string;
  description?: string;
  group?: string;
}

export type CustomTagZone = 'frame' | 'scene' | 'render' | 'character';
export type CustomTagKind = 'tag' | 'artist';
export const CUSTOM_TAG_MAX_LENGTH = 4096;

export interface CustomTagPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomTag {
  id: string;
  /** Legacy records without a kind are prompt-constructor tags. */
  kind?: CustomTagKind;
  tag: string;
  zone: CustomTagZone;
  /** Optional for schema-v2 compatibility. Missing values migrate to default. */
  presetId?: string;
  description?: string;
  /** Prompt tags require an image. Artist cards may deliberately use the plus-card fallback. */
  imageAsset?: string;
  mime?: 'image/png' | 'image/jpeg' | 'image/webp';
  originalName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomTagLibrarySnapshot {
  version: 1;
  presets: CustomTagPreset[];
  tags: CustomTag[];
  warning?: string;
}

export type CustomTagPackResult =
  | { status: 'imported'; snapshot: CustomTagLibrarySnapshot; presetId: string; name: string; imported: number; skipped: number }
  | { status: 'no-new-cards'; snapshot: CustomTagLibrarySnapshot; presetId: null; name: null; imported: 0; skipped: number }
  | { status: 'exported'; presetId: string; name: string; cardCount: number; path?: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface CatalogCard {
  id: string;
  catalogId?: string;
  tag: string;
  gallery: string;
  image: string;
  score: number;
  sourceUrl?: string;
  runtime?: boolean;
  /** A local artist authored in Custom Tags, never included in NAX update counts. */
  custom?: boolean;
}

export interface OfflineCatalog {
  version: number;
  catalogId?: string;
  artists: CatalogCard[];
  characters: CatalogCard[];
  tags: string[];
  danbooruTags?: Array<{ tag: string; category: number; count: number }>;
  generatedAt?: string;
  sources?: Record<string, unknown>;
}

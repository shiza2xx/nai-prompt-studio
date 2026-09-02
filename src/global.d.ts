import type { AppSettings, ArtistMixDraft, CustomTag, CustomTagPackResult, CustomTagPreset, OfflineCatalog, PromptDraft, PromptSet, SavedLibraryItem } from './types';

interface DesktopStorageData {
    version: number;
    sets: PromptSet[];
    savedLibrary?: SavedLibraryItem[];
    favorites: string[];
    characterFavorites: string[];
    draft: PromptDraft | null;
    customTags: CustomTag[];
    customTagPresets: CustomTagPreset[];
    customTagLibrary?: CustomTagLibrarySnapshot;
    settings?: AppSettings;
    artistMix?: ArtistMixDraft;
}
type DesktopStorageSnapshot =
  | { state: 'missing'; exists: false; data: DesktopStorageData }
  | { state: 'ready'; exists: true; data: DesktopStorageData }
  | { state: 'error'; exists: true; error: string };

interface NAIStorageBridge {
  load(): DesktopStorageSnapshot;
  retryLoad?(): DesktopStorageSnapshot;
  openProfileFolder?(): Promise<boolean>;
  save<K extends keyof DesktopStorageSectionMap>(section: K, value: DesktopStorageSectionMap[K]): void;
  saveSync<K extends keyof DesktopStorageSectionMap>(section: K, value: DesktopStorageSectionMap[K]): boolean;
  transactCustomTags?(operation: CustomTagLibraryOperation, payload: object, bytes?: Uint8Array): Promise<CustomTagLibrarySnapshot>;
  importCustomTags?(): Promise<CustomTagPackResult>;
  importCustomTagsPath?(filePath: string): Promise<CustomTagPackResult>;
  exportCustomTags?(presetId: string): Promise<CustomTagPackResult>;
  getPathForFile?(file: File): string;
  saveLibraryImage?(metadata: { id: string; mime?: SavedLibraryItem['mime']; originalName?: string }, bytes: Uint8Array): Promise<{ imageAsset: string; mime?: SavedLibraryItem['mime']; originalName?: string }>;
  deleteLibraryImage?(imageAsset: string): Promise<boolean>;
}

interface DesktopStorageSectionMap {
  sets: PromptSet[];
  savedLibrary: SavedLibraryItem[];
  favorites: string[];
  characterFavorites: string[];
  draft: PromptDraft | null;
  settings: AppSettings;
  artistMix: ArtistMixDraft;
}

interface MetadataPostResult {
  site: 'danbooru' | 'konachan' | 'safebooru';
  siteName: string;
  id: string;
  page: string;
  pageUrl: string;
  source: string;
  tags: string;
  width: string;
  height: string;
  rating: string;
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  name: string;
  originalName: string;
  imageUrl?: string;
}

interface NAIMetadataBridge {
  loadPost(url: string): Promise<MetadataPostResult>;
  cancel(): Promise<boolean>;
  cancelPost(): Promise<boolean>;
}

interface NAIExternalBridge {
  openFeedback(): Promise<boolean>;
}

type CustomTagLibraryOperation = 'preset:create' | 'preset:update' | 'preset:delete' | 'card:upsert' | 'card:delete' | 'card:move' | 'card:reorder';
interface CustomTagLibrarySnapshot { version: 1; presets: CustomTagPreset[]; tags: CustomTag[]; warning?: string; }

declare global {
  interface Window {
    naiStorage?: NAIStorageBridge;
    naiMetadata?: NAIMetadataBridge;
    naiCatalog?: NAICatalogBridge;
    naiUpdater?: NAIUpdaterBridge;
    naiExternal?: NAIExternalBridge;
  }
}

export interface UpdateManifest { available: boolean; schemaVersion?: 1; version: string; asset?: string; url?: string; size?: number; sha512?: string; releaseNotes?: string; }
export interface UpdateProgress { phase: 'starting' | 'downloading' | 'retrying' | 'verifying' | 'ready' | 'paused' | 'error'; completed: number; total: number; percent: number; attempt: number; message?: string; }
export type UpdateDownloadResult = { state: 'ready' | 'cancelled' | 'up-to-date'; version: string; downloaded: boolean };
export type UpdateInstallResult = { state: 'installing'; started: boolean };
export interface NAIUpdaterBridge {
  check(): Promise<UpdateManifest>;
  download(manifest: UpdateManifest): Promise<UpdateDownloadResult>;
  cancel(): Promise<boolean>;
  install(manifest?: UpdateManifest): Promise<UpdateInstallResult>;
  version(): Promise<string>;
  onProgress(listener: (event: UpdateProgress) => void): () => void;
}

export interface NAICatalogBridge {
  packaged?: boolean;
  load(): Promise<OfflineCatalog>;
  mode?(): Promise<{ packaged: boolean }>;
  components?(): Promise<{ descriptors: CatalogComponentDescriptor[]; components: CatalogComponentStatus[]; selected: Record<string, boolean>; state: unknown }>;
  ensureSelected?(): Promise<{ selected: Record<string, boolean>; results: CatalogComponentStatus[]; total: number; missingManifest?: boolean }>;
  downloadComponent?(id: string, repair?: boolean): Promise<CatalogComponentStatus>;
  repairComponent?(id: string): Promise<CatalogComponentStatus>;
  cancelComponent?(): Promise<boolean>;
  onComponentProgress?(listener: (event: CatalogComponentProgress) => void): () => void;
  update(): Promise<{ catalog: OfflineCatalog; added: number; changed: number }>;
  cancel(): Promise<boolean>;
  onProgress(listener: (event: { phase: string; completed: number; total: number; added?: number; message?: string }) => void): () => void;
}

export interface CatalogComponentDescriptor { id: 'artists' | 'characters' | 'guide' | string; filename: string; url: string; size: number; sha512: string; expectedRoot: string; count: number; version: string; }
export interface CatalogComponentStatus extends CatalogComponentDescriptor { path?: string; status: 'Installed' | 'Migrated' | 'Missing' | 'Downloading' | 'Damaged' | string; error?: string; }
export interface CatalogComponentProgress { id: string; phase: 'Checking' | 'Downloading' | 'Verifying' | 'Opening' | 'Retrying' | string; completed: number; total: number; percent: number; attempt?: number; message?: string; }

export {};

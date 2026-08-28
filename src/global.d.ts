import type { AppSettings, ArtistMixDraft, CustomTag, CustomTagPreset, OfflineCatalog, PromptDraft, PromptSet, SavedLibraryItem } from './types';

interface DesktopStorageSnapshot {
  exists: boolean;
  data: {
    version: number;
    sets: PromptSet[];
    savedLibrary?: SavedLibraryItem[];
    favorites: string[];
    characterFavorites: string[];
    draft: PromptDraft | null;
    customTags: CustomTag[];
    customTagPresets: CustomTagPreset[];
    settings?: AppSettings;
    artistMix?: ArtistMixDraft;
  };
}

interface NAIStorageBridge {
  load(): DesktopStorageSnapshot;
  save(section: 'sets' | 'savedLibrary' | 'favorites' | 'characterFavorites' | 'draft' | 'customTags' | 'customTagPresets' | 'settings' | 'artistMix', value: PromptSet[] | SavedLibraryItem[] | string[] | PromptDraft | CustomTag[] | CustomTagPreset[] | AppSettings | ArtistMixDraft): void;
  saveSync(section: 'sets' | 'savedLibrary' | 'favorites' | 'characterFavorites' | 'draft' | 'customTags' | 'customTagPresets' | 'settings' | 'artistMix', value: PromptSet[] | SavedLibraryItem[] | string[] | PromptDraft | CustomTag[] | CustomTagPreset[] | AppSettings | ArtistMixDraft): boolean;
  saveCustomTag?(metadata: Omit<CustomTag, 'imageAsset'|'createdAt'|'updatedAt'> & { createdAt?: string; updatedAt?: string }, bytes: Uint8Array): Promise<CustomTag>;
  deleteCustomTag?(imageAsset: string): Promise<boolean>;
  saveLibraryImage?(metadata: { id: string; mime?: SavedLibraryItem['mime']; originalName?: string }, bytes: Uint8Array): Promise<{ imageAsset: string; mime?: SavedLibraryItem['mime']; originalName?: string }>;
  deleteLibraryImage?(imageAsset: string): Promise<boolean>;
}

declare global {
  interface Window {
  naiStorage?: NAIStorageBridge;
    naiCatalog?: NAICatalogBridge;
    naiUpdater?: NAIUpdaterBridge;
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

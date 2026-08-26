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
  load(): Promise<OfflineCatalog>;
  update(): Promise<{ catalog: OfflineCatalog; added: number; changed: number }>;
  cancel(): Promise<boolean>;
  onProgress(listener: (event: { phase: string; completed: number; total: number; added?: number; message?: string }) => void): () => void;
}

export {};

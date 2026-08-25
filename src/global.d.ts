import type { AppSettings, ArtistMixDraft, CustomTag, CustomTagPreset, OfflineCatalog, PromptDraft, PromptSet } from './types';

interface DesktopStorageSnapshot {
  exists: boolean;
  data: {
    version: number;
    sets: PromptSet[];
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
  save(section: 'sets' | 'favorites' | 'characterFavorites' | 'draft' | 'customTags' | 'customTagPresets' | 'settings' | 'artistMix', value: PromptSet[] | string[] | PromptDraft | CustomTag[] | CustomTagPreset[] | AppSettings | ArtistMixDraft): void;
  saveSync(section: 'sets' | 'favorites' | 'characterFavorites' | 'draft' | 'customTags' | 'customTagPresets' | 'settings' | 'artistMix', value: PromptSet[] | string[] | PromptDraft | CustomTag[] | CustomTagPreset[] | AppSettings | ArtistMixDraft): boolean;
  saveCustomTag?(metadata: Omit<CustomTag, 'imageAsset'|'createdAt'|'updatedAt'> & { createdAt?: string; updatedAt?: string }, bytes: Uint8Array): Promise<CustomTag>;
  deleteCustomTag?(imageAsset: string): Promise<boolean>;
}

declare global {
  interface Window {
  naiStorage?: NAIStorageBridge;
    naiCatalog?: NAICatalogBridge;
    naiUpdater?: NAIUpdaterBridge;
  }
}

export interface UpdateManifest { available: boolean; schemaVersion?: 1; version: string; asset?: string; url?: string; size?: number; sha512?: string; releaseNotes?: string; }
export interface NAIUpdaterBridge {
  check(): Promise<UpdateManifest>;
  downloadAndInstall(manifest: UpdateManifest): Promise<{ started: boolean; downloaded?: boolean }>;
  version(): Promise<string>;
}

export interface NAICatalogBridge {
  load(): Promise<OfflineCatalog>;
  update(): Promise<{ catalog: OfflineCatalog; added: number; changed: number }>;
  cancel(): Promise<boolean>;
  onProgress(listener: (event: { phase: string; completed: number; total: number; added?: number; message?: string }) => void): () => void;
}

export {};

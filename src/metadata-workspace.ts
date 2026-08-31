import { bindArtistCardPreview } from './artist-card-preview';
import { extractImageMetadata, type ImageMetadata, type MetadataCharacter } from './image-metadata';
import { escapeMetadataHtml, MetadataArtistHighlighter, serializeMetadataArtists } from './metadata-artist-highlight';
import { metadataTagPopoverPlacement, type MetadataTagRect } from './metadata-tag-placement';
import { dispatchMetadataTagSave, type MetadataTagCategory, type MetadataTagSaveHandler } from './metadata-tag-save';
import { createMetadataDisplayPreview } from './metadata-display-preview';
import { CUSTOM_TAG_MAX_LENGTH, type CatalogCard, type CustomTagPreset, type SavedArtistMixData, type SavedPromptData } from './types';

type State = 'empty' | 'loading' | 'success' | 'error';
type SourceKind = 'local' | 'remote';
const escapeHtml = escapeMetadataHtml;

interface RemoteMetadata extends ImageMetadata {
  site: 'danbooru' | 'konachan' | 'safebooru';
  siteName: string;
  postId: string;
  pageUrl: string;
  sourceUrl: string;
  rating: string;
}

export interface MetadataSavePayload {
  source: 'metadata';
  filename: string;
  preview: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' | 'image/webp'; originalName: string };
  prompt: SavedPromptData;
  artistMix?: SavedArtistMixData;
}

export type MetadataSaveKind = 'prompt' | 'artist-mix';
/** Checks whether a previously-created Saved Library record still exists. */
export type MetadataSavedIdExists = (id: string) => boolean;

export type { MetadataTagCategory, MetadataTagSaveHandler, MetadataTagSavePayload } from './metadata-tag-save';

type Folder = Pick<CustomTagPreset, 'id' | 'name'>;

interface SelectionState {
  text: string;
  readToken: number;
  sourceGeneration: number;
  range: Range;
  pre: HTMLElement;
  rect: MetadataTagRect;
}

const elementFromNode = (node: Node | null): Element | null => node instanceof Element ? node : node?.parentElement ?? null;

function closestPromptPre(node: Node | null): HTMLElement | null {
  return elementFromNode(node)?.closest<HTMLElement>('.metadata-prompt pre') ?? null;
}

function finiteRect(rect: DOMRect | DOMRectReadOnly): MetadataTagRect | null {
  if (![rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function finalRangeRect(range: Range): MetadataTagRect | null {
  const rects = [...range.getClientRects()].map(finiteRect).filter((rect): rect is MetadataTagRect => Boolean(rect));
  return rects.at(-1) ?? finiteRect(range.getBoundingClientRect());
}

function nodeInside(node: Node, container: HTMLElement): boolean {
  return node.isConnected && (node === container || container.contains(node));
}

export class MetadataWorkspace {
  private state: State = 'empty';
  private result: ImageMetadata | null = null;
  private remoteResult: RemoteMetadata | null = null;
  private sourceKind: SourceKind = 'local';
  private error = '';
  private status = '';
  private urlInput = '';
  private basePolarity: 'positive' | 'negative' = 'positive';
  private characterPolarities: Array<'positive' | 'negative'> = [];
  private highlightedArtists: readonly CatalogCard[] | null = null;
  private highlighter = new MetadataArtistHighlighter([]);
  private sourceObjectUrl: string | null = null;
  private sourceFilename = '';
  private sourceBytes: Uint8Array | null = null;
  private sourceMime: MetadataSavePayload['preview']['mime'] | null = null;
  private readonly savedIds = new Map<MetadataSaveKind, string>();
  private cachedSavePayload: MetadataSavePayload | null | undefined;
  private cachedPayloadCatalog: readonly CatalogCard[] | null = null;
  private cachedArtistMix: SavedArtistMixData | null | undefined;
  private cachedArtistMixCatalog: readonly CatalogCard[] | null = null;
  private highlightedPromptMarkup = new Map<string, string>();
  private readToken = 0;
  private sourceGeneration = 0;

  private root: HTMLElement | null = null;
  private selection: SelectionState | null = null;
  private selectionText = '';
  private selectionReadToken = -1;
  private selectionSourceGeneration = -1;
  private selectionRaf: number | undefined;
  private tagDialogOpen = false;
  private tagDialogError = '';
  private tagDialogCategory: MetadataTagCategory = 'frame';
  private tagDialogPresetId = 'default';
  /** The selected metadata-tag destination is intentionally session-only. */
  private lastMetadataTagFolderId: string | null = null;
  /** The selected metadata-tag category is intentionally session-only. */
  private lastMetadataTagCategory: MetadataTagCategory = 'frame';
  private tagDialogReturnFocus: HTMLElement | null = null;
  private tagDialogCleanup: (() => void) | null = null;
  private selectionCleanup: (() => void) | null = null;
  private selectionWindowCleanup: (() => void) | null = null;
  private readonly catalogArtists: () => readonly CatalogCard[];
  private readonly imageResolver?: (card: CatalogCard) => string;
  private readonly onSave?: (kind: MetadataSaveKind, payload: MetadataSavePayload) => Promise<string | null> | string | null;
  private readonly onSavedId?: MetadataSavedIdExists;
  private readonly customTagFolders: () => readonly Folder[];
  private readonly onSaveTag?: MetadataTagSaveHandler;
  private tagFolderOpen = false;

  constructor(
    catalogArtists: () => readonly CatalogCard[] = () => [],
    imageResolver?: (card: CatalogCard) => string,
    onSave?: (kind: MetadataSaveKind, payload: MetadataSavePayload) => Promise<string | null> | string | null,
    customTagFolders: () => readonly Folder[] = () => [{ id: 'default', name: 'My Tags' }],
    onSaveTag?: MetadataTagSaveHandler,
    onSavedId?: MetadataSavedIdExists
  ) {
    this.catalogArtists = catalogArtists;
    this.imageResolver = imageResolver;
    this.onSave = onSave;
    this.customTagFolders = customTagFolders;
    this.onSaveTag = onSaveTag;
    this.onSavedId = onSavedId;
  }

  markup(): string {
    this.reconcileSavedKinds();
    const statusText = this.state === 'loading' ? 'Loading image metadata...' : this.state === 'error' ? this.error : this.status;
    const statusClass = `metadata-status${this.state === 'error' ? ' error' : ''}${statusText ? '' : ' is-empty'}`;
    const status = `<p class="${statusClass}" id="metadata-status" role="${this.state === 'error' ? 'alert' : 'status'}">${this.state === 'loading' ? '<i class="status-skeleton"></i>' : ''}${escapeHtml(statusText)}</p>`;
    const content = this.result
      ? this.resultMarkup(this.result)
      : `<div class="metadata-empty"><img class="brand-mark brand-icon" src="./app-icon.png" alt=""><h2>Read an image's hidden prompt.</h2><p>Choose or drop a NovelAI Image. Analysis stays entirely on this device and never changes your prompt builder. You can also load an HTTPS booru post.</p></div>`;
    return `<section class="metadata-workspace" aria-labelledby="metadata-title"><header class="workspace-intro metadata-intro"><div><p class="eyebrow">IMAGE METADATA</p><h2 id="metadata-title">Reveal the image's data.</h2><p>Metadata extraction is based on <a href="https://github.com/NovelAI/novelai-image-metadata" target="_blank" rel="noopener noreferrer">NovelAI's official image metadata repository</a>.</p></div></header><div class="metadata-url-row"><label><span>BOORU POST URL</span><input id="metadata-url" value="${escapeHtml(this.urlInput)}" placeholder="https://danbooru.donmai.us/posts/123" autocomplete="off" spellcheck="false"></label><button class="primary" type="button" id="metadata-load-url"${this.state === 'loading' ? ' disabled' : ''}>Load image</button></div><div class="metadata-drop ${this.state === 'loading' ? 'is-loading' : ''}" id="metadata-drop" tabindex="0" role="button" aria-label="Choose a NovelAI image or drop one here"><input id="metadata-file" type="file" accept="image/png,.png,image/webp,.webp" hidden><b>Drop an image here</b><span>or</span><button class="secondary" type="button" id="metadata-choose">Choose image</button></div>${status}<div id="metadata-result">${content}</div></section>`;
  }

  /** Rendered beside the app shell so viewport-fixed UI is not captured by the panel animation transform. */
  overlayMarkup(): string {
    const folders = this.customTagFolders();
    const selectedFolder = folders.find(folder => folder.id === this.tagDialogPresetId) ?? { id: this.tagDialogPresetId, name: 'Folder unavailable' };
    const folderOptions = folders.map(folder => `<li id="metadata-tag-folder-option-${escapeHtml(folder.id)}" role="option" data-metadata-folder-option="${escapeHtml(folder.id)}" aria-selected="${folder.id === selectedFolder.id}" tabindex="${folder.id === selectedFolder.id ? '0' : '-1'}">${escapeHtml(folder.name)}</li>`).join('');
    const tagPreviewAvailable = this.hasSelectionSavePreview() && Boolean(this.selectionText);
    const listboxId = 'metadata-tag-folder-listbox';
    return `<div class="metadata-tag-dialog-backdrop${this.tagDialogOpen ? '' : ' is-hidden'}" id="metadata-tag-dialog" aria-hidden="${!this.tagDialogOpen}"><section class="metadata-tag-dialog" role="dialog" aria-modal="true" aria-labelledby="metadata-tag-dialog-title"><header><div><p class="eyebrow">CUSTOM TAG</p><h3 id="metadata-tag-dialog-title">Save selected tag</h3></div><button class="icon-button" type="button" id="metadata-tag-cancel" aria-label="Close Save tag dialog">×</button></header><label class="field"><span>Tag text</span><input id="metadata-tag-text" value="${escapeHtml(this.selectionText)}" readonly></label><div class="field metadata-tag-folder-field"><span id="metadata-tag-folder-label">Folder</span><button id="metadata-tag-folder" class="metadata-tag-folder" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="${this.tagFolderOpen}" aria-controls="${listboxId}" aria-labelledby="metadata-tag-folder-label metadata-tag-folder-value"><span id="metadata-tag-folder-value">${escapeHtml(selectedFolder.name)}</span><span class="metadata-tag-folder-arrow" aria-hidden="true"></span></button><ul id="${listboxId}" class="metadata-tag-folder-listbox${this.tagFolderOpen ? '' : ' is-hidden'}" role="listbox" aria-labelledby="metadata-tag-folder-label">${folderOptions || '<li id="metadata-tag-folder-option-default" role="option" data-metadata-folder-option="default" aria-selected="true" tabindex="0">My Tags</li>'}</ul></div><fieldset class="field metadata-tag-category-field"><legend>Category</legend><div class="metadata-tag-category"><label><input type="radio" name="metadata-tag-category" value="frame"${this.tagDialogCategory === 'frame' ? ' checked' : ''}> Frame</label><label><input type="radio" name="metadata-tag-category" value="scene"${this.tagDialogCategory === 'scene' ? ' checked' : ''}> Scene</label><label><input type="radio" name="metadata-tag-category" value="render"${this.tagDialogCategory === 'render' ? ' checked' : ''}> Quality</label><label><input type="radio" name="metadata-tag-category" value="character"${this.tagDialogCategory === 'character' ? ' checked' : ''}> Character</label></div></fieldset><p class="metadata-tag-dialog-error" id="metadata-tag-dialog-error" role="alert">${escapeHtml(this.tagDialogError)}</p><footer><button class="secondary" type="button" id="metadata-tag-cancel-footer">Cancel</button><button class="primary" type="button" id="metadata-tag-save"${tagPreviewAvailable && this.onSaveTag && this.selectionText.length <= CUSTOM_TAG_MAX_LENGTH ? '' : ' disabled'}>Save tag</button></footer></section></div><div class="metadata-tag-popover is-hidden" id="metadata-tag-popover" aria-hidden="true"><div class="metadata-tag-popover-surface"><button class="primary" type="button" id="metadata-save-selection">Save tag</button></div></div>`;
  }

  bind(root: HTMLElement, refresh: () => void): void {
    this.selectionCleanup?.();
    this.selectionCleanup = null;
    this.selectionWindowCleanup?.();
    this.selectionWindowCleanup = null;
    this.root = root;
    this.reconcileSavedKinds();

    const input = root.querySelector<HTMLInputElement>('#metadata-file');
    const choose = root.querySelector<HTMLButtonElement>('#metadata-choose');
    const drop = root.querySelector<HTMLElement>('#metadata-drop');
    const url = root.querySelector<HTMLInputElement>('#metadata-url');
    const loadUrl = () => {
      this.urlInput = url?.value ?? this.urlInput;
      if (this.urlInput.trim()) void this.readRemote(this.urlInput.trim(), refresh);
    };
    const select = (file?: File) => { if (file) void this.read(file, refresh); };
    choose?.addEventListener('click', event => { event.stopPropagation(); input?.click(); });
    input?.addEventListener('change', () => select(input.files?.[0]));
    url?.addEventListener('input', () => { this.urlInput = url.value; });
    url?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); loadUrl(); } });
    root.querySelector<HTMLButtonElement>('#metadata-load-url')?.addEventListener('click', loadUrl);
    drop?.addEventListener('click', () => input?.click());
    drop?.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input?.click(); } });
    for (const eventName of ['dragenter', 'dragover']) drop?.addEventListener(eventName, event => { event.preventDefault(); drop.classList.add('is-dragging'); });
    for (const eventName of ['dragleave', 'drop']) drop?.addEventListener(eventName, event => { event.preventDefault(); drop.classList.remove('is-dragging'); });
    drop?.addEventListener('drop', event => select(event.dataTransfer?.files[0]));
    root.querySelectorAll<HTMLButtonElement>('[data-metadata-polarity]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.metadataPolarity);
      const polarity = button.dataset.polarity === 'negative' ? 'negative' : 'positive';
      if (index < 0) this.basePolarity = polarity; else this.characterPolarities[index] = polarity;
      this.patchPolarityBlock(button.closest<HTMLElement>('[data-metadata-block]'), index, polarity);
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-metadata-copy]').forEach(button => button.addEventListener('click', () => {
      const value = this.activePrompt(Number(button.dataset.metadataCopy));
      if (value) void this.copyPrompt(value, button);
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-metadata-save]').forEach(button => button.addEventListener('click', () => {
      if (this.tagDialogOpen || this.isPopoverVisible()) return;
      void this.saveToLibrary(button.dataset.metadataSave === 'artist-mix' ? 'artist-mix' : 'prompt', refresh);
    }));
    this.bindSelection(root, refresh);
    this.bindTagDialog(root);
    bindArtistCardPreview(root);
  }

  private bindSelection(root: HTMLElement, refresh: () => void): void {
    const scheduleInspect = () => {
      if (this.selectionRaf !== undefined) return;
      const callback = () => {
        this.selectionRaf = undefined;
        this.inspectSelection();
      };
      if (typeof window.requestAnimationFrame === 'function') this.selectionRaf = window.requestAnimationFrame(callback);
      else this.selectionRaf = window.setTimeout(callback, 0);
    };
    const stopOverlayEvent = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('#metadata-tag-popover, #metadata-tag-dialog')) event.stopPropagation();
    };
    const blockLibraryDispatch = (event: Event) => {
      if (!this.tagDialogOpen && !this.isPopoverVisible()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-metadata-save]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const pointerup = () => scheduleInspect();
    const keyup = (event: KeyboardEvent) => { if (event.shiftKey || event.key.startsWith('Arrow') || event.key === 'Escape') scheduleInspect(); };
    const selectionchange = () => scheduleInspect();
    root.addEventListener('pointerup', pointerup);
    root.addEventListener('keyup', keyup);
    root.addEventListener('click', blockLibraryDispatch, true);
    root.addEventListener('pointerdown', blockLibraryDispatch, true);
    root.addEventListener('pointerdown', stopOverlayEvent);
    root.addEventListener('click', stopOverlayEvent);
    document.addEventListener('selectionchange', selectionchange);
    this.selectionCleanup = () => {
      root.removeEventListener('pointerup', pointerup);
      root.removeEventListener('keyup', keyup);
      root.removeEventListener('click', blockLibraryDispatch, true);
      root.removeEventListener('pointerdown', blockLibraryDispatch, true);
      root.removeEventListener('pointerdown', stopOverlayEvent);
      root.removeEventListener('click', stopOverlayEvent);
      document.removeEventListener('selectionchange', selectionchange);
      this.cancelSelectionRaf();
    };
    const reposition = () => scheduleInspect();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    this.selectionWindowCleanup = () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };

    const trigger = root.querySelector<HTMLButtonElement>('#metadata-save-selection');
    const open = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.tagDialogOpen) return;
      if (!this.isSelectionCurrent()) return;
      this.tagDialogReturnFocus = trigger?.isConnected ? trigger : null;
      this.tagDialogOpen = true;
      this.tagDialogError = this.selectionText.length > CUSTOM_TAG_MAX_LENGTH ? `Tags must be ${CUSTOM_TAG_MAX_LENGTH.toLocaleString()} characters or fewer.` : '';
      this.tagDialogCategory = this.lastMetadataTagCategory;
      const folders = this.customTagFolders();
      const retained = folders.find(folder => folder.id === this.lastMetadataTagFolderId)?.id;
      this.tagDialogPresetId = retained ?? folders[0]?.id ?? 'default';
      if (this.tagDialogPresetId) this.lastMetadataTagFolderId = this.tagDialogPresetId;
      this.hideSelectionPopover();
      this.syncTagDialogDom();
      window.setTimeout(() => this.root?.querySelector<HTMLInputElement>('#metadata-tag-save')?.focus(), 0);
    };
    trigger?.addEventListener('click', open);
  }

  private syncTagDialogDom(): void {
    const dialog = this.root?.querySelector<HTMLElement>('#metadata-tag-dialog');
    if (!dialog) return;
    dialog.classList.toggle('is-hidden', !this.tagDialogOpen);
    dialog.setAttribute('aria-hidden', String(!this.tagDialogOpen));
    const text = dialog.querySelector<HTMLInputElement>('#metadata-tag-text');
    if (text) text.value = this.selectionText;
    const folders = this.customTagFolders();
    const selectedFolder = folders.find(folder => folder.id === this.tagDialogPresetId) ?? { id: this.tagDialogPresetId, name: 'Folder unavailable' };
    const folder = dialog.querySelector<HTMLButtonElement>('#metadata-tag-folder');
    if (folder) {
      folder.setAttribute('aria-expanded', String(this.tagFolderOpen));
      folder.setAttribute('aria-activedescendant', `metadata-tag-folder-option-${selectedFolder.id}`);
      const value = folder.querySelector<HTMLElement>('#metadata-tag-folder-value');
      if (value) value.textContent = selectedFolder.name;
    }
    const listbox = dialog.querySelector<HTMLElement>('#metadata-tag-folder-listbox');
    if (listbox) {
      listbox.classList.toggle('is-hidden', !this.tagFolderOpen);
      listbox.querySelectorAll<HTMLElement>('[data-metadata-folder-option]').forEach(option => {
        const selected = option.dataset.metadataFolderOption === selectedFolder.id;
        option.setAttribute('aria-selected', String(selected));
        option.tabIndex = selected ? 0 : -1;
      });
    }
    dialog.querySelectorAll<HTMLInputElement>('input[name="metadata-tag-category"]').forEach(input => { input.checked = input.value === this.tagDialogCategory; });
    const error = dialog.querySelector<HTMLElement>('#metadata-tag-dialog-error');
    if (error) error.textContent = this.tagDialogError;
    const save = dialog.querySelector<HTMLButtonElement>('#metadata-tag-save');
    if (save) save.disabled = !this.hasSelectionSavePreview() || !this.selectionText || this.selectionText.length > CUSTOM_TAG_MAX_LENGTH || !this.onSaveTag;
  }

  private bindTagDialog(root: HTMLElement): void {
    this.tagDialogCleanup?.();
    this.tagDialogCleanup = null;
    const close = () => {
      const returnFocus = this.tagDialogReturnFocus;
      this.tagDialogReturnFocus = null;
      this.tagDialogOpen = false;
      this.tagFolderOpen = false;
      this.tagDialogError = '';
      this.resetSelectionContext(true);
      this.syncTagDialogDom();
      window.setTimeout(() => {
        const fallback = returnFocus?.isConnected ? returnFocus : this.root?.querySelector<HTMLElement>('#metadata-url') ?? this.root?.querySelector<HTMLElement>('#metadata-load-url');
        fallback?.focus({ preventScroll: true });
      }, 0);
    };
    root.querySelectorAll<HTMLInputElement>('input[name="metadata-tag-category"]').forEach(input => input.addEventListener('change', () => { this.tagDialogCategory = input.value as MetadataTagCategory; this.lastMetadataTagCategory = this.tagDialogCategory; }));
    const folderButton = root.querySelector<HTMLButtonElement>('#metadata-tag-folder');
    const folderList = root.querySelector<HTMLElement>('#metadata-tag-folder-listbox');
    const folderValues = () => this.customTagFolders().map(folder => folder.id);
    const setFolder = (id: string, focus = false) => {
      if (!folderValues().includes(id)) return;
      this.tagDialogPresetId = id;
      this.lastMetadataTagFolderId = id;
      if (focus) root.querySelector<HTMLElement>(`[data-metadata-folder-option="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      this.syncTagDialogDom();
    };
    folderButton?.addEventListener('click', event => {
      event.preventDefault();
      this.tagFolderOpen = !this.tagFolderOpen;
      this.syncTagDialogDom();
      if (this.tagFolderOpen) root.querySelector<HTMLElement>(`[data-metadata-folder-option="${CSS.escape(this.tagDialogPresetId)}"]`)?.focus({ preventScroll: true });
    });
    folderButton?.addEventListener('keydown', event => {
      const values = folderValues();
      if (!values.length) return;
      const current = Math.max(0, values.indexOf(this.tagDialogPresetId));
      if (event.key === 'Escape') { if (this.tagFolderOpen) { event.preventDefault(); this.tagFolderOpen = false; this.syncTagDialogDom(); } return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.tagFolderOpen = !this.tagFolderOpen; this.syncTagDialogDom(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : Math.min(values.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)));
      this.tagFolderOpen = true;
      setFolder(values[next], true);
    });
    folderList?.addEventListener('click', event => {
      const option = (event.target as Element | null)?.closest<HTMLElement>('[data-metadata-folder-option]');
      if (!option) return;
      event.preventDefault();
      setFolder(option.dataset.metadataFolderOption ?? '');
      this.tagFolderOpen = false;
      this.syncTagDialogDom();
      folderButton?.focus({ preventScroll: true });
    });
    folderList?.addEventListener('keydown', event => {
      const values = folderValues();
      if (!values.length) return;
      const current = Math.max(0, values.indexOf(this.tagDialogPresetId));
      if (event.key === 'Escape') { event.preventDefault(); this.tagFolderOpen = false; this.syncTagDialogDom(); folderButton?.focus({ preventScroll: true }); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.tagFolderOpen = false; this.syncTagDialogDom(); folderButton?.focus({ preventScroll: true }); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : Math.min(values.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)));
      setFolder(values[next], true);
    });
    const outsideFolderClick = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (this.tagFolderOpen && target && !folderButton?.contains(target) && !folderList?.contains(target)) { this.tagFolderOpen = false; this.syncTagDialogDom(); }
    };
    document.addEventListener('mousedown', outsideFolderClick);
    const originalClose = close;
    const closeWithFolder = () => { this.tagFolderOpen = false; originalClose(); };
    root.querySelector<HTMLButtonElement>('#metadata-tag-save')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void this.saveSelectedTag(); });
    root.querySelector<HTMLElement>('#metadata-tag-dialog')?.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeWithFolder(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...root.querySelectorAll<HTMLElement>('#metadata-tag-dialog button, #metadata-tag-dialog input, #metadata-tag-dialog [role="option"]')].filter(item => !item.hasAttribute('disabled') && !item.closest('.is-hidden'));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    });
    root.querySelectorAll<HTMLButtonElement>('#metadata-tag-cancel, #metadata-tag-cancel-footer').forEach(button => button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); closeWithFolder(); }));
    this.tagDialogCleanup = () => document.removeEventListener('mousedown', outsideFolderClick);
  }

  private inspectSelection(): void {
    if (this.tagDialogOpen) return;
    const selection = window.getSelection();
    const resultRoot = this.root?.querySelector<HTMLElement>('#metadata-result');
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed || !resultRoot) { this.resetSelectionContext(); return; }
    const range = selection.getRangeAt(0);
    const startPre = closestPromptPre(range.startContainer);
    const endPre = closestPromptPre(range.endContainer);
    if (!startPre || startPre !== endPre || !startPre.isConnected || !resultRoot.contains(startPre)
      || !nodeInside(range.startContainer, startPre) || !nodeInside(range.endContainer, startPre)) {
      this.resetSelectionContext();
      return;
    }
    const text = selection.toString().trim();
    const rect = finalRangeRect(range);
    // Keep the selection affordance available for over-limit text so the
    // dialog can explain the validation failure instead of silently dropping
    // the user's selection. Persistence remains disabled until it is valid.
    if (!text || !rect) { this.resetSelectionContext(); return; }
    this.selection = { text, readToken: this.readToken, sourceGeneration: this.sourceGeneration, range: range.cloneRange(), pre: startPre, rect };
    this.selectionText = text;
    this.selectionReadToken = this.readToken;
    this.selectionSourceGeneration = this.sourceGeneration;
    this.positionSelectionPopover(rect);
  }

  private positionSelectionPopover(selectionRect: MetadataTagRect): void {
    const popover = this.root?.querySelector<HTMLElement>('#metadata-tag-popover');
    if (!popover || !this.selection) return;
    const popoverRect = popover.getBoundingClientRect();
    const placement = metadataTagPopoverPlacement({ selection: selectionRect, popover: { width: popoverRect.width, height: popoverRect.height }, viewport: { width: window.innerWidth, height: window.innerHeight } });
    popover.style.transform = `translate3d(${placement.x}px, ${placement.y}px, 0)`;
    popover.classList.toggle('is-above', placement.above);
    popover.classList.remove('is-hidden');
    popover.setAttribute('aria-hidden', 'false');
  }

  /** Revalidate the snapshot against the live DOM immediately before a save. */
  private isSelectionCurrent(): boolean {
    const current = this.selection;
    if (!current || this.selectionReadToken !== this.readToken || this.selectionSourceGeneration !== this.sourceGeneration || current.readToken !== this.readToken || current.sourceGeneration !== this.sourceGeneration) return false;
    const resultRoot = this.root?.querySelector<HTMLElement>('#metadata-result');
    const pre = current.pre;
    const range = current.range;
    return Boolean(resultRoot && pre.isConnected && resultRoot.contains(pre) && nodeInside(range.startContainer, pre) && nodeInside(range.endContainer, pre));
  }

  private isPopoverVisible(): boolean {
    const popover = this.root?.querySelector<HTMLElement>('#metadata-tag-popover');
    return Boolean(popover && !popover.classList.contains('is-hidden') && popover.getAttribute('aria-hidden') !== 'true');
  }

  private cancelSelectionRaf(): void {
    if (this.selectionRaf === undefined) return;
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(this.selectionRaf);
    else window.clearTimeout(this.selectionRaf);
    this.selectionRaf = undefined;
  }

  private resetSelectionContext(clearBrowserSelection = false): void {
    this.cancelSelectionRaf();
    this.selection = null;
    this.selectionText = '';
    this.selectionReadToken = -1;
    this.selectionSourceGeneration = -1;
    if (clearBrowserSelection) {
      try { window.getSelection()?.removeAllRanges(); } catch {}
    }
    this.hideSelectionPopover();
  }

  private hideSelectionPopover = (): void => {
    const popover = this.root?.querySelector<HTMLElement>('#metadata-tag-popover');
    if (!popover) return;
    popover.classList.add('is-hidden');
    popover.classList.remove('is-above');
    popover.setAttribute('aria-hidden', 'true');
  };

  private async saveSelectedTag(): Promise<void> {
    const selection = this.selection;
    if (!selection || !this.onSaveTag || !this.hasSelectionSavePreview()) return;
    if (this.selectionText.length > CUSTOM_TAG_MAX_LENGTH) {
      this.tagDialogError = `Tags must be ${CUSTOM_TAG_MAX_LENGTH.toLocaleString()} characters or fewer.`;
      this.syncTagDialogDom();
      return;
    }
    if (!this.isSelectionCurrent()) {
      this.resetSelectionContext(true);
      return;
    }
    const folder = this.customTagFolders().find(item => item.id === this.tagDialogPresetId);
    if (!folder) {
      this.tagDialogError = 'The selected folder is no longer available. Choose another folder before saving.';
      this.syncTagDialogDom();
      return;
    }
    const category = (this.root?.querySelector<HTMLInputElement>('input[name="metadata-tag-category"]:checked')?.value ?? this.tagDialogCategory) as MetadataTagCategory;
    this.lastMetadataTagCategory = category;
    const readToken = this.readToken;
    const sourceGeneration = this.sourceGeneration;
    this.tagDialogError = '';
    try {
      if (!this.isSelectionCurrent()) {
        this.resetSelectionContext(true);
        return;
      }
      // Copy source bytes only at the desktop persistence boundary. Opening the
      // dialog and ordinary markup remain zero-copy even for large images.
      const preview = this.getSelectionSavePreview();
      if (!preview) return;
      const saved = await dispatchMetadataTagSave(this.onSaveTag, this.selectionText, category, folder.id, preview);
      if (readToken !== this.readToken || sourceGeneration !== this.sourceGeneration) return;
      if (saved) {
        this.lastMetadataTagFolderId = folder.id;
        this.status = 'Tag saved to Custom Tags.';
        this.tagDialogOpen = false;
        this.tagFolderOpen = false;
        this.resetSelectionContext(true);
        this.syncTagDialogDom();
        this.patchStatusDom();
      }
    } catch (error) {
      this.tagDialogError = error instanceof Error ? error.message : 'The tag could not be saved.';
      this.syncTagDialogDom();
    }
  }

  private async readRemote(url: string, refresh: () => void): Promise<void> {
    const request = ++this.readToken;
    this.sourceGeneration += 1;
    this.resetSelectionContext(true);
    this.releaseSourceImage();
    this.sourceKind = 'remote';
    this.result = null;
    this.remoteResult = null;
    this.error = '';
    this.status = '';
    this.tagDialogOpen = false;
    this.tagFolderOpen = false;
    this.state = 'loading';
    refresh();
    try {
      if (!window.naiMetadata) throw new Error('Booru loading is available in the desktop app only.');
      const remote = await window.naiMetadata.loadPost(url);
      if (request !== this.readToken) return;
      const bytes = new Uint8Array(remote.bytes);
      const displayBlob = await createMetadataDisplayPreview(new Blob([bytes], { type: remote.mime }));
      if (request !== this.readToken) return;
      const source: RemoteMetadata = { model: '', steps: '', sampler: '', width: remote.width, height: remote.height, scale: '', base: { positive: remote.tags, negative: '' }, characters: [], site: remote.site, siteName: remote.siteName, postId: remote.id, pageUrl: remote.pageUrl, sourceUrl: remote.source, rating: remote.rating };
      this.remoteResult = source;
      this.result = source;
      this.sourceObjectUrl = URL.createObjectURL(displayBlob);
      this.sourceFilename = remote.name || remote.originalName || `${remote.site}-${remote.id}`;
      this.sourceBytes = bytes;
      this.sourceMime = remote.mime;
      this.savedIds.clear();
      this.cachedSavePayload = undefined;
      this.cachedPayloadCatalog = null;
      this.basePolarity = 'positive';
      this.characterPolarities = [];
      this.state = 'success';
      this.resetSelectionContext(true);
    } catch (error) {
      if (request !== this.readToken) return;
      this.state = 'error';
      this.error = error instanceof Error ? error.message : 'The booru image could not be loaded.';
    }
    refresh();
  }

  private async read(file: File, refresh: () => void): Promise<void> {
    const request = ++this.readToken;
    this.sourceGeneration += 1;
    this.resetSelectionContext(true);
    try {
      const cancellation = window.naiMetadata?.cancel?.() ?? window.naiMetadata?.cancelPost?.();
      void Promise.resolve(cancellation).catch(() => {});
    } catch {}
    this.releaseSourceImage();
    this.sourceKind = 'local';
    this.remoteResult = null;
    this.state = 'loading';
    this.result = null;
    this.error = '';
    this.status = '';
    this.tagDialogOpen = false;
    this.tagFolderOpen = false;
    refresh();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime: MetadataSavePayload['preview']['mime'] = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? 'image/webp' : 'image/png';
      const result = await extractImageMetadata(file, bytes);
      if (request !== this.readToken) return;
      const displayBlob = await createMetadataDisplayPreview(new Blob([bytes], { type: mime }));
      if (request !== this.readToken) return;
      this.result = result;
      this.sourceObjectUrl = URL.createObjectURL(displayBlob);
      this.sourceFilename = file.name;
      this.sourceBytes = bytes;
      this.sourceMime = mime;
      this.savedIds.clear();
      this.cachedSavePayload = undefined;
      this.cachedPayloadCatalog = null;
      this.basePolarity = 'positive';
      this.characterPolarities = result.characters.map(() => 'positive');
      this.state = 'success';
      this.resetSelectionContext(true);
    } catch (error) {
      if (request !== this.readToken) return;
      this.state = 'error';
      this.error = error instanceof Error ? error.message : 'The image metadata could not be read.';
    }
    refresh();
  }

  deactivate(): void {
    this.readToken += 1;
    this.sourceGeneration += 1;
    try {
      const cancellation = window.naiMetadata?.cancel?.() ?? window.naiMetadata?.cancelPost?.();
      void Promise.resolve(cancellation).catch(() => {});
    } catch {}
    this.resetSelectionContext(true);
    this.tagDialogOpen = false;
    this.tagDialogError = '';
    this.tagDialogReturnFocus = null;
    this.selectionCleanup?.();
    this.selectionCleanup = null;
    this.selectionWindowCleanup?.();
    this.selectionWindowCleanup = null;
    this.tagDialogCleanup?.();
    this.tagDialogCleanup = null;
    this.tagFolderOpen = false;
    if (this.state === 'loading') { this.state = 'empty'; this.error = ''; this.status = ''; }
    this.root = null;
  }

  dispose(): void { this.deactivate(); this.releaseSourceImage(); }

  private reconcileSavedKinds(): void {
    if (!this.onSavedId) return;
    for (const [kind, id] of this.savedIds) if (!this.onSavedId(id)) this.savedIds.delete(kind);
  }

  /** Returns only validated image bytes and structured fields for library actions. */
  getSavePayload(): MetadataSavePayload | null {
    if (!this.result || !this.sourceBytes || !this.sourceMime || !this.sourceFilename) return null;
    const catalog = this.catalogArtists();
    if (this.cachedSavePayload !== undefined && catalog === this.cachedPayloadCatalog) return this.cachedSavePayload;
    const prompt: SavedPromptData = {
      model: this.remoteResult ? undefined : this.result.model,
      steps: this.remoteResult ? undefined : this.result.steps,
      sampler: this.remoteResult ? undefined : this.result.sampler,
      width: this.result.width,
      height: this.result.height,
      cfg: this.remoteResult ? undefined : this.result.scale,
      positive: this.result.base.positive,
      negative: this.result.base.negative,
      characters: this.result.characters.map((item, index) => ({ id: `metadata-character-${index + 1}`, label: `Character ${index + 1}`, positive: item.positive, negative: item.negative }))
    };
    const artistMix = this.artistMixPayload();
    this.cachedPayloadCatalog = catalog;
    this.cachedSavePayload = { source: 'metadata', filename: this.sourceFilename, preview: { bytes: this.sourceBytes.slice(), mime: this.sourceMime, originalName: this.sourceFilename }, prompt, ...(artistMix ? { artistMix } : {}) };
    return this.cachedSavePayload;
  }

  /** Preview-only payload for the selected-tag callback; never builds library data. */
  getSelectionSavePreview(): MetadataSavePayload['preview'] | null {
    const bytes = this.sourceBytes;
    const mime = this.sourceMime;
    const originalName = this.sourceFilename;
    if (!this.result || !bytes || !mime || !originalName) return null;
    return { bytes: bytes.slice(), mime, originalName };
  }

  private hasSelectionSavePreview(): boolean {
    return Boolean(this.result && this.sourceBytes && this.sourceMime && this.sourceFilename);
  }

  private patchStatusDom(): void {
    const status = this.root?.querySelector<HTMLElement>('#metadata-status');
    if (!status) return;
    status.textContent = this.status;
    status.classList.toggle('is-empty', !this.status);
    status.classList.remove('error');
  }

  private artistMixPayload(): SavedArtistMixData | null {
    if (!this.result) return null;
    const catalog = this.catalogArtists();
    if (catalog === this.cachedArtistMixCatalog && this.cachedArtistMix !== undefined) return this.cachedArtistMix;
    const artists = this.artistHighlighter().extract(this.result.base.positive);
    this.cachedArtistMixCatalog = catalog;
    this.cachedArtistMix = artists.length ? { artists, serializedPrompt: serializeMetadataArtists(artists) } : null;
    return this.cachedArtistMix;
  }

  private async saveToLibrary(kind: MetadataSaveKind, refresh: () => void): Promise<void> {
    const payload = this.getSavePayload();
    if (!payload || !this.onSave || (kind === 'artist-mix' && !payload.artistMix) || this.savedIds.has(kind)) return;
    try {
      const savedId = await this.onSave(kind, payload);
      if (typeof savedId === 'string' && savedId) this.savedIds.set(kind, savedId);
    } catch (error) { this.error = error instanceof Error ? error.message : 'The item could not be saved.'; }
    refresh();
  }

  private polarityBlock(label: string, prompt: MetadataCharacter, index: number, polarity: 'positive' | 'negative'): string {
    const activeValue = prompt[polarity];
    const value = activeValue || '(No prompt recorded for this side.)';
    const copyLabel = `Copy ${label} ${polarity} prompt`;
    return `<article class="metadata-prompt" data-metadata-block="${index}"><header><b>${label}</b><div class="metadata-toggle" role="group" aria-label="${escapeHtml(label)} polarity"><button type="button" class="${polarity === 'positive' ? 'on' : ''}" data-metadata-polarity="${index}" data-polarity="positive" aria-pressed="${polarity === 'positive'}">Positive</button><button type="button" class="${polarity === 'negative' ? 'on' : ''}" data-metadata-polarity="${index}" data-polarity="negative" aria-pressed="${polarity === 'negative'}">Negative</button></div></header><pre>${this.renderHighlighted(value)}</pre><div class="metadata-prompt-actions"><button class="secondary metadata-copy" type="button" data-metadata-copy="${index}" aria-label="${escapeHtml(copyLabel)}" ${activeValue ? '' : 'disabled'}>Copy prompt</button></div></article>`;
  }

  private patchPolarityBlock(block: HTMLElement | null, index: number, polarity: 'positive' | 'negative'): void {
    this.resetSelectionContext(true);
    if (!block || !this.result) return;
    const prompt = index < 0 ? this.result.base : this.result.characters[index];
    if (!prompt) return;
    block.querySelectorAll<HTMLButtonElement>('[data-metadata-polarity]').forEach(button => {
      const on = button.dataset.polarity === polarity;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const pre = block.querySelector<HTMLElement>('pre');
    if (pre) pre.innerHTML = this.renderHighlighted(prompt[polarity] || '(No prompt recorded for this side.)');
    const copy = block.querySelector<HTMLButtonElement>('[data-metadata-copy]');
    if (copy) { copy.disabled = !prompt[polarity]; copy.setAttribute('aria-label', `Copy ${index < 0 ? 'Base prompt' : `Character ${index + 1}`} ${polarity} prompt`); }
    bindArtistCardPreview(block);
  }

  private resultMarkup(result: ImageMetadata): string {
    const remote = this.remoteResult;
    const settings = remote ? [result.width && result.height && `${result.width} x ${result.height}`, remote.rating && `Rating ${remote.rating}`].filter(Boolean).join('  ·  ') || 'Settings unavailable' : [result.steps && `${result.steps} steps`, result.sampler, result.width && result.height && `${result.width} x ${result.height}`, result.scale && `CFG ${result.scale}`].filter(Boolean).join('  ·  ') || 'Settings unavailable';
    const characters = remote ? '' : result.characters.length ? result.characters.map((item, index) => this.polarityBlock(`Character ${index + 1}`, item, index, this.characterPolarities[index] ?? 'positive')).join('') : '<p class="metadata-no-characters">No character prompts were recorded in this image.</p>';
    const artistMix = this.artistMixPayload();
    const saveActions = this.hasSelectionSavePreview() ? `<div class="metadata-save-actions"><button class="primary" type="button" data-metadata-save="prompt" ${this.savedIds.has('prompt') ? 'disabled' : ''}>${this.savedIds.has('prompt') ? 'Saved' : 'Add to Saved Library'}</button>${artistMix ? `<button class="secondary" type="button" data-metadata-save="artist-mix" ${this.savedIds.has('artist-mix') ? 'disabled' : ''}>${this.savedIds.has('artist-mix') ? 'Saved' : 'Save Artist Mix'}</button>` : ''}</div>` : '';
    const sourceImage = this.sourceObjectUrl ? `<figure class="metadata-source-image"><img src="${escapeHtml(this.sourceObjectUrl)}" alt="Loaded image: ${escapeHtml(this.sourceFilename)}"><figcaption>${escapeHtml(this.sourceFilename)}</figcaption>${saveActions}</figure>` : '';
    const heading = remote ? `<div class="metadata-source"><span>SOURCE</span><b>${escapeHtml(remote.siteName)} · Post #${escapeHtml(remote.postId)}</b></div>` : `<div class="metadata-model"><span>MODEL</span><b>${escapeHtml(result.model)}</b></div>`;
    return `<section class="metadata-results">${sourceImage}${heading}<div class="metadata-settings"><span>SETTINGS</span><b>${escapeHtml(settings)}</b></div>${this.polarityBlock('Base prompt', result.base, -1, this.basePolarity)}${characters}</section>`;
  }

  private activePrompt(index: number): string { if (!this.result) return ''; if (index < 0) return this.result.base[this.basePolarity]; const character = this.result.characters[index]; return character ? character[this.characterPolarities[index] ?? 'positive'] : ''; }

  private async copyPrompt(value: string, button: HTMLButtonElement): Promise<void> { try { await navigator.clipboard.writeText(value); } catch {} const initial = button.textContent; button.textContent = 'Copied'; window.setTimeout(() => { button.textContent = initial; }, 900); }

  private renderHighlighted(value: string): string {
    const highlighter = this.artistHighlighter();
    const cached = this.highlightedPromptMarkup.get(value);
    if (cached !== undefined) return cached;
    const rendered = highlighter.render(value);
    this.highlightedPromptMarkup.set(value, rendered);
    return rendered;
  }

  private releaseSourceImage(): void { if (this.sourceObjectUrl) URL.revokeObjectURL(this.sourceObjectUrl); this.sourceObjectUrl = null; this.sourceFilename = ''; this.sourceBytes = null; this.sourceMime = null; this.savedIds.clear(); this.tagDialogOpen = false; this.tagFolderOpen = false; this.tagDialogError = ''; this.cachedSavePayload = undefined; this.cachedPayloadCatalog = null; this.cachedArtistMix = undefined; this.cachedArtistMixCatalog = null; this.highlightedPromptMarkup.clear(); }

  private artistHighlighter(): MetadataArtistHighlighter { const artists = this.catalogArtists(); if (artists !== this.highlightedArtists) { this.highlightedArtists = artists; this.highlighter = new MetadataArtistHighlighter(artists, this.imageResolver); this.highlightedPromptMarkup.clear(); } return this.highlighter; }
}

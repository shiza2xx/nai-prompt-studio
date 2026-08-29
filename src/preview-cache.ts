/**
 * Renderer-side, in-memory preview cache.
 *
 * A cache instance represents one image variant. The renderer uses separate
 * instances for official grid thumbnails, user/content images, and short
 * lived hover originals. Consequently an entry can never accidentally use
 * an original where a thumbnail was requested (or transform user bytes).
 */

export type PreviewPriority = 'visible' | 'current-page' | 'background' | 'idle';
export type PreviewEntryState = 'queued' | 'loading' | 'ready' | 'failed';

export interface PreviewEntry {
  readonly source: string;
  state: PreviewEntryState;
  url?: string;
  width: number;
  height: number;
  bytes: number;
  error?: unknown;
  variant?: string;
}

export interface PreviewImageLike {
  src?: string;
  alt?: string;
  decoding?: string;
  complete?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
  isConnected?: boolean;
  dataset: Record<string, string | undefined>;
  classList: { add(...tokens: string[]): void; remove?(...tokens: string[]): void };
  parentElement?: { classList: { add(...tokens: string[]): void } } | null;
  addEventListener?(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export interface PreviewRootLike {
  querySelectorAll(selector: string): ArrayLike<PreviewImageLike>;
  isConnected?: boolean;
}

export interface PreviewTransformContext {
  source: string;
  signal: AbortSignal;
  variant: string;
}

export type PreviewBlobTransform = (blob: unknown, context: PreviewTransformContext) => unknown | Promise<unknown>;

export interface PreviewCacheOptions {
  fetch?: (input: string, signal?: AbortSignal) => Promise<{ ok?: boolean; status?: number; blob(): Promise<unknown> }>;
  createObjectURL?: (blob: unknown) => string;
  revokeObjectURL?: (url: string) => void;
  createImage?: () => PreviewImageLike;
  /** Optional async transform. It is deliberately absent for content/hover. */
  transform?: PreviewBlobTransform;
  /** Alias for callers that think in terms of preparing a variant. */
  prepare?: PreviewBlobTransform;
  /** Explicit variant namespace; separate instances do not require this. */
  variant?: string;
  maxBytes?: number;
  foregroundConcurrency?: number;
  backgroundConcurrency?: number;
  /** Maximum time allowed for fetch, blob, transform, and image decode together. */
  timeoutMs?: number;
  /** Injectable timer hooks make timeout behavior deterministic in tests. */
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Injectable scheduler makes queue behavior deterministic in tests. */
  schedule?: (callback: () => void, priority: PreviewPriority) => unknown;
}

export interface HydrateOptions {
  priority?: PreviewPriority;
  /** Optional caller token; scope validity is supplied by isCurrent. */
  token?: number;
  /** Return false when the view that requested hydration has been replaced. */
  isCurrent?: () => boolean;
}

export interface HydrateResult {
  source: string;
  state: PreviewEntryState;
  promise: Promise<PreviewEntry>;
}

export interface PreviewLease {
  readonly scope: string;
  readonly sources: readonly string[];
  release(): void;
  update(sources: Iterable<string>): void;
}

interface InternalEntry extends PreviewEntry {
  promise?: Promise<PreviewEntry>;
  resolve?: (entry: PreviewEntry) => void;
  priority?: PreviewPriority;
  settled?: boolean;
  consumers: Set<PreviewImageLike>;
  controller: AbortController;
  lastUsed: number;
  sequence: number;
  key: string;
  timeoutHandle?: unknown;
  timedOut?: boolean;
  slotReleased?: boolean;
  pendingUrl?: string;
  revokedUrls: Set<string>;
}

const PREVIEW_SELECTOR = 'img[data-preview-src], img[data-constructor-image-src]';
const DEFAULT_MAX_BYTES = 192 * 1024 * 1024;
const DEFAULT_ENTRY_TIMEOUT_MS = 15_000;

function nativeFetch(source: string, signal?: AbortSignal): Promise<{ ok?: boolean; status?: number; blob(): Promise<unknown> }> {
  return globalThis.fetch(source, { signal }) as Promise<{ ok?: boolean; status?: number; blob(): Promise<unknown> }>;
}

function nativeCreateImage(): PreviewImageLike {
  return new Image() as unknown as PreviewImageLike;
}

function nativeCreateObjectURL(blob: unknown): string {
  return URL.createObjectURL(blob as Blob);
}

function nativeRevokeObjectURL(url: string): void {
  URL.revokeObjectURL(url);
}

function finiteDimension(value: unknown): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0;
}

/** A stable, priority-aware queue with explicit retention leases. */
export class PreviewCache {
  private readonly entries = new Map<string, InternalEntry>();
  private readonly queue: InternalEntry[] = [];
  private readonly fetchSource: (input: string, signal?: AbortSignal) => Promise<{ ok?: boolean; status?: number; blob(): Promise<unknown> }>;
  private readonly makeObjectURL: (blob: unknown) => string;
  private readonly revokeURL: (url: string) => void;
  private readonly makeImage: () => PreviewImageLike;
  private readonly transform?: PreviewBlobTransform;
  private readonly variant: string;
  private maxBytesValue: number;
  private readonly foregroundConcurrency: number;
  private readonly backgroundConcurrency: number;
  private readonly timeoutMs: number;
  private readonly setTimeoutWork: (callback: () => void, delayMs: number) => unknown;
  private readonly clearTimeoutWork: (handle: unknown) => void;
  private readonly scheduleWork: (callback: () => void, priority: PreviewPriority) => unknown;
  private readonly leases = new Map<string, Set<string>>();
  private foregroundActive = 0;
  private backgroundActive = 0;
  private bytesUsed = 0;
  private clock = 0;
  private sequence = 0;
  private generation = 0;
  private disposed = false;
  private revision = '';

  constructor(options: PreviewCacheOptions = {}) {
    this.fetchSource = options.fetch ?? nativeFetch;
    this.makeObjectURL = options.createObjectURL ?? nativeCreateObjectURL;
    this.revokeURL = options.revokeObjectURL ?? nativeRevokeObjectURL;
    this.makeImage = options.createImage ?? nativeCreateImage;
    this.transform = options.transform ?? options.prepare;
    this.variant = String(options.variant ?? 'default');
    this.maxBytesValue = Math.max(1, Number(options.maxBytes ?? DEFAULT_MAX_BYTES));
    this.foregroundConcurrency = Math.max(1, Math.floor(options.foregroundConcurrency ?? 4));
    this.backgroundConcurrency = Math.max(1, Math.floor(options.backgroundConcurrency ?? 2));
    const configuredTimeout = Number(options.timeoutMs ?? DEFAULT_ENTRY_TIMEOUT_MS);
    this.timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_ENTRY_TIMEOUT_MS;
    this.setTimeoutWork = options.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimeoutWork = options.clearTimeout ?? (handle => globalThis.clearTimeout(handle as number));
    this.scheduleWork = options.schedule ?? ((callback, priority) => {
      const idle = globalThis as typeof globalThis & { requestIdleCallback?: (callback: () => void) => unknown };
      if (priority === 'idle' && typeof idle.requestIdleCallback === 'function') idle.requestIdleCallback(callback);
      else globalThis.setTimeout(callback, priority === 'idle' ? 16 : 0);
    });
  }

  get size(): number { return this.entries.size; }
  get totalBytes(): number { return this.bytesUsed; }
  get maxBytes(): number { return this.maxBytesValue; }
  get currentRevision(): string { return this.revision; }
  get activeLeases(): number { return this.leases.size; }

  /** Change the LRU ceiling immediately; this never rewrites source data. */
  setMaxBytes(value: number): void {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    this.maxBytesValue = Math.max(1, Math.floor(next));
    this.evict();
  }

  setBudget(value: number): void { this.setMaxBytes(value); }

  /** Record the revision without evicting unrelated entries. */
  setRevision(revision: string): void { this.revision = revision; }

  /** Start a new revision and drop this cache's decoded URLs. */
  invalidate(revision = ''): void {
    this.revision = revision;
    this.clear();
  }

  /** Invalidate only catalog-owned sources; user/content caches are separate. */
  invalidateCatalog(revision: string, isCatalogSource: (source: string) => boolean): void {
    if (revision === this.revision) return;
    this.revision = revision;
    for (const [key, entry] of this.entries) {
      if (!isCatalogSource(entry.source)) continue;
      this.entries.delete(key);
      this.cancelEntry(entry, new Error('Catalog preview invalidated.'));
      this.revokeEntry(entry);
    }
    this.dropLeaseSources(isCatalogSource);
    this.pump();
  }

  reset(revision = ''): void { this.invalidate(revision); }

  invalidateSources(sources: Iterable<string>): void {
    const keys = new Set([...sources].map(source => this.key(String(source))));
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      this.entries.delete(key);
      this.cancelEntry(entry, new Error('Preview invalidated.'));
      this.revokeEntry(entry);
    }
    for (const leased of this.leases.values()) for (const key of [...leased]) if (keys.has(key)) leased.delete(key);
    this.pump();
  }

  get(source: string): PreviewEntry | undefined {
    const entry = this.entries.get(this.key(source));
    if (entry) this.touch(entry);
    return entry;
  }

  has(source: string): boolean { return this.entries.has(this.key(source)); }

  /** Retain entries independent of DOM connectivity. */
  acquireLease(scope: string, sources: Iterable<string>): PreviewLease {
    const scopeKey = String(scope || '').trim();
    if (!scopeKey) throw new Error('Preview lease scope is required.');
    const retained = new Set([...sources].map(source => this.key(String(source))).filter(Boolean));
    this.leases.set(scopeKey, retained);
    const cache = this;
    const lease: PreviewLease = {
      scope: scopeKey,
      get sources() { return [...retained].map(key => key.slice(key.indexOf('\u0000') + 1)); },
      release: () => { if (cache.leases.get(scopeKey) === retained) cache.leases.delete(scopeKey); cache.evict(); },
      update: next => { retained.clear(); for (const source of next) { const key = cache.key(String(source)); if (key) retained.add(key); } cache.evict(); }
    };
    this.evict();
    return lease;
  }

  lease(scope: string, sources: Iterable<string>): PreviewLease { return this.acquireLease(scope, sources); }

  setLease(scope: string, sources: Iterable<string>): PreviewLease {
    this.releaseLease(scope);
    return this.acquireLease(scope, sources);
  }

  releaseLease(scope: string): void { this.leases.delete(String(scope || '').trim()); this.evict(); }
  clearLeases(): void { this.leases.clear(); this.evict(); }

  /** Request one source; duplicate queued/loading requests share one promise. */
  load(source: string, priority: PreviewPriority = 'background'): Promise<PreviewEntry> {
    const value = String(source || '').trim();
    if (!value || this.disposed) return Promise.reject(new Error('Preview cache is unavailable.'));
    const key = this.key(value);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.state === 'queued' && this.priorityRank(priority) > this.priorityRank(existing.priority)) {
        existing.priority = priority;
        this.pump();
      }
      this.touch(existing);
      return existing.promise ?? Promise.resolve(existing);
    }
    const entry: InternalEntry = {
      source: value, variant: this.variant, state: 'queued', width: 0, height: 0, bytes: 0,
      consumers: new Set(), controller: new AbortController(), lastUsed: ++this.clock, sequence: ++this.sequence, key,
      revokedUrls: new Set()
    };
    entry.promise = new Promise<PreviewEntry>(resolve => { entry.resolve = resolve; });
    this.entries.set(key, entry); this.enqueue(entry, priority);
    return entry.promise;
  }

  request(source: string, priority: PreviewPriority = 'background'): Promise<PreviewEntry> { return this.load(source, priority); }

  hydrateImage(image: PreviewImageLike, options: HydrateOptions = {}): HydrateResult | null {
    if (this.disposed) return null;
    const generation = this.generation;
    const source = String(image.dataset.previewSrc ?? image.dataset.constructorImageSrc ?? '').trim();
    if (!source) return null;
    const priority = options.priority ?? 'current-page';
    const current = () => !this.disposed && generation === this.generation && (options.isCurrent?.() ?? true) && image.isConnected !== false;
    const existing = this.entries.get(this.key(source));
    if (existing?.state === 'ready' && existing.url) {
      this.touch(existing); if (current()) this.mount(image, existing);
      return { source, state: existing.state, promise: Promise.resolve(existing) };
    }
    const promise = this.load(source, priority);
    const entry = this.entries.get(this.key(source));
    if (entry) entry.consumers.add(image);
    void promise.then(value => {
      if (!current()) { this.releaseImage(image); return value; }
      if (value.state === 'ready') this.mount(image, value as InternalEntry);
      else this.markFailure(image, value.error ?? new Error('Preview failed.'));
      return value;
    }).catch(() => { this.releaseImage(image); });
    return { source, state: entry?.state ?? 'queued', promise };
  }

  hydrate(root: PreviewRootLike, options: HydrateOptions = {}): HydrateResult[] {
    if (this.disposed) return [];
    const results: HydrateResult[] = [];
    for (const image of Array.from(root.querySelectorAll(PREVIEW_SELECTOR))) {
      const result = this.hydrateImage(image, { ...options, isCurrent: () => root.isConnected !== false && (options.isCurrent?.() ?? true) });
      if (result) results.push(result);
    }
    return results;
  }

  releaseImage(image: PreviewImageLike): void { for (const entry of this.entries.values()) entry.consumers.delete(image); }

  /** Abort queued/in-flight work, settle all promises, and revoke URLs. */
  clear(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) { this.cancelEntry(entry, new Error('Preview cache cleared.')); this.revokeEntry(entry); }
    this.entries.clear(); this.queue.length = 0; this.bytesUsed = 0; this.pump();
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.clear(); this.leases.clear(); }

  private key(source: string): string {
    const value = String(source || '').trim();
    return value ? `${this.variant}\u0000${value}` : '';
  }
  private enqueue(entry: InternalEntry, priority: PreviewPriority): void { entry.priority = priority; this.queue.push(entry); this.scheduleWork(() => this.pump(), priority); this.pump(); }

  private pump(): void {
    if (this.disposed) return;
    const foreground = this.queue.filter(entry => entry.priority !== 'background' && entry.priority !== 'idle').sort((a, b) => this.priorityRank(b.priority) - this.priorityRank(a.priority) || a.sequence - b.sequence);
    const background = this.queue.filter(entry => entry.priority === 'background' || entry.priority === 'idle').sort((a, b) => this.priorityRank(b.priority) - this.priorityRank(a.priority) || a.sequence - b.sequence);
    while (this.foregroundActive < this.foregroundConcurrency && foreground.length) { const entry = foreground.shift()!; this.removeQueued(entry); this.start(entry, true); }
    while (this.backgroundActive < this.backgroundConcurrency && background.length) { const entry = background.shift()!; this.removeQueued(entry); this.start(entry, false); }
  }

  private priorityRank(priority: PreviewPriority | undefined): number { return priority === 'visible' ? 4 : priority === 'current-page' ? 3 : priority === 'background' ? 2 : 1; }
  private removeQueued(entry: InternalEntry): void { const index = this.queue.indexOf(entry); if (index >= 0) this.queue.splice(index, 1); }

  private start(entry: InternalEntry, foreground: boolean): void {
    if (this.disposed || entry.controller.signal.aborted) return;
    entry.state = 'loading'; if (foreground) this.foregroundActive += 1; else this.backgroundActive += 1;
    entry.timeoutHandle = this.setTimeoutWork(() => this.timeoutEntry(entry, foreground), this.timeoutMs);
    void this.decode(entry).then(value => {
      this.clearEntryTimeout(entry);
      if (entry.controller.signal.aborted || entry.timedOut || this.disposed || this.entries.get(entry.key) !== entry) { this.revokeDecodedURL(entry, value.url); return; }
      entry.state = 'ready'; entry.url = value.url; entry.width = value.width; entry.height = value.height; entry.bytes = value.bytes;
      this.bytesUsed += entry.bytes; this.touch(entry); this.evict(entry);
      // If this item alone cannot fit the active ceiling, evict() revokes it
      // and removes the entry. Surface a terminal failure rather than handing
      // hydration a ready entry with no usable object URL.
      if (this.entries.get(entry.key) !== entry || !entry.url) {
        entry.state = 'failed';
        entry.error = new Error('Preview exceeds the active cache budget.');
      }
      this.resolveEntry(entry, entry);
    }).catch(error => {
      this.clearEntryTimeout(entry);
      if (!this.disposed && this.entries.get(entry.key) === entry && !entry.timedOut) { entry.state = 'failed'; entry.error = error; this.resolveEntry(entry, entry); }
    }).finally(() => { this.releaseWorkerSlot(entry, foreground); this.pump(); });
  }

  private async decode(entry: InternalEntry): Promise<{ url: string; width: number; height: number; bytes: number }> {
    const signal = entry.controller.signal;
    const response = await this.fetchSource(entry.source, signal);
    if (signal.aborted) throw new Error('Preview request aborted.');
    if (response.ok === false) throw new Error(`Preview request failed (${response.status ?? 'unknown'}).`);
    let blob = await response.blob();
    if (signal.aborted) throw new Error('Preview request aborted.');
    if (this.transform) blob = await this.transform(blob, { source: entry.source, signal, variant: this.variant });
    if (signal.aborted) throw new Error('Preview request aborted.');
    const url = this.makeObjectURL(blob); entry.pendingUrl = url; const image = this.makeImage(); image.decoding = 'async';
    try {
      if (typeof (image as unknown as { decode?: () => Promise<void> }).decode === 'function') { image.src = url; await (image as unknown as { decode: () => Promise<void> }).decode(); }
      else await new Promise<void>((resolve, reject) => { const load = () => resolve(); const fail = () => reject(new Error('Preview image failed to decode.')); image.addEventListener?.('load', load, { once: true }); image.addEventListener?.('error', fail, { once: true }); image.src = url; if (image.complete && finiteDimension(image.naturalWidth) > 0) resolve(); });
      if (signal.aborted) throw new Error('Preview request aborted.');
      const width = finiteDimension(image.naturalWidth); const height = finiteDimension(image.naturalHeight);
      if (!width || !height) throw new Error('Preview image has no dimensions.');
      return { url, width, height, bytes: width * height * 4 };
    } catch (error) { this.revokeDecodedURL(entry, url); throw error; }
    finally { if (entry.pendingUrl === url) entry.pendingUrl = undefined; }
  }

  private touch(entry: InternalEntry): void { entry.lastUsed = ++this.clock; }
  private mount(image: PreviewImageLike, entry: InternalEntry): void {
    if (entry.state !== 'ready' || !entry.url) return;
    image.src = entry.url; image.dataset.previewState = 'ready'; delete image.dataset.previewError; image.classList.remove?.('is-preview-error'); image.classList.add('is-decoded', 'is-loaded', 'is-preview-ready'); image.parentElement?.classList.add('is-preview-ready'); entry.consumers.add(image); this.touch(entry);
  }
  private markFailure(image: PreviewImageLike, error: unknown): void { image.dataset.previewState = 'error'; image.dataset.previewError = 'true'; image.classList.add('is-preview-error', 'is-preview-ready'); image.parentElement?.classList.add('is-preview-ready'); if (!image.alt) image.alt = 'Preview unavailable'; if (!image.src) image.src = './plus.png'; void error; }
  private isLeased(entry: InternalEntry): boolean { for (const keys of this.leases.values()) if (keys.has(entry.key)) return true; return false; }
  private evict(protectedEntry?: InternalEntry): void {
    if (this.bytesUsed <= this.maxBytesValue) return;
    const candidates = [...this.entries.values()].filter(entry => entry !== protectedEntry && entry.state === 'ready' && entry.url && !this.isLeased(entry)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of candidates) { if (this.bytesUsed <= this.maxBytesValue) break; this.entries.delete(entry.key); this.revokeEntry(entry); }
    // A single decoded item may itself exceed a newly reduced budget. Do not
    // violate the ceiling indefinitely merely because it was just completed;
    // a lease is the only explicit reason to retain such an item.
    if (this.bytesUsed > this.maxBytesValue && protectedEntry && protectedEntry.state === 'ready' && !this.isLeased(protectedEntry)) {
      this.entries.delete(protectedEntry.key);
      this.revokeEntry(protectedEntry);
    }
  }
  private revokeEntry(entry: InternalEntry): void { if (entry.url) this.revokeDecodedURL(entry, entry.url); this.revokePendingURL(entry); this.bytesUsed = Math.max(0, this.bytesUsed - entry.bytes); entry.url = undefined; entry.consumers.clear(); }
  private resolveEntry(entry: InternalEntry, value: PreviewEntry): void { if (!entry.settled) { entry.settled = true; entry.resolve?.(value); } }
  private cancelEntry(entry: InternalEntry, error: Error): void { this.clearEntryTimeout(entry); entry.controller.abort(); this.removeQueued(entry); this.revokePendingURL(entry); if (entry.state === 'queued' || entry.state === 'loading') { entry.state = 'failed'; entry.error = error; this.resolveEntry(entry, entry); } }
  private timeoutEntry(entry: InternalEntry, foreground: boolean): void {
    entry.timeoutHandle = undefined;
    if (entry.state !== 'loading' || entry.settled || this.entries.get(entry.key) !== entry) return;
    entry.timedOut = true;
    entry.state = 'failed';
    entry.error = new Error(`Preview timed out after ${this.timeoutMs}ms.`);
    entry.controller.abort();
    this.revokePendingURL(entry);
    this.resolveEntry(entry, entry);
    this.releaseWorkerSlot(entry, foreground);
    this.pump();
  }
  private clearEntryTimeout(entry: InternalEntry): void { if (entry.timeoutHandle !== undefined) { this.clearTimeoutWork(entry.timeoutHandle); entry.timeoutHandle = undefined; } }
  private releaseWorkerSlot(entry: InternalEntry, foreground: boolean): void {
    if (entry.slotReleased) return;
    entry.slotReleased = true;
    if (foreground) this.foregroundActive = Math.max(0, this.foregroundActive - 1);
    else this.backgroundActive = Math.max(0, this.backgroundActive - 1);
  }
  private revokePendingURL(entry: InternalEntry): void {
    const url = entry.pendingUrl;
    if (!url) return;
    entry.pendingUrl = undefined;
    entry.revokedUrls.add(url);
    this.revokeURL(url);
  }
  private revokeDecodedURL(entry: InternalEntry, url: string): void { if (entry.revokedUrls.has(url)) { entry.revokedUrls.delete(url); return; } this.revokeURL(url); }
  private dropLeaseSources(predicate: (source: string) => boolean): void { for (const [scope, keys] of this.leases) { for (const key of [...keys]) { const source = key.slice(key.indexOf('\u0000') + 1); if (predicate(source)) keys.delete(key); } if (!keys.size) this.leases.delete(scope); } }
}

export const PREVIEW_IMAGE_SELECTOR = PREVIEW_SELECTOR;

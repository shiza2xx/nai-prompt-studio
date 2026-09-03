const PREVIEW_SELECTOR = '[data-artist-preview-image], [data-artist-preview-message], [data-constructor-preview-tag], [data-library-preview-image]';

export interface ArtistCardPreviewDimensions { width: number; height: number; }

/** Fit an image inside the shared preview bounds without changing its aspect ratio. */
export function fitArtistCardPreview(intrinsicWidth: number, intrinsicHeight: number, maxWidth = 380, maxHeight = 520): ArtistCardPreviewDimensions {
  // A failed decode reports zero intrinsic dimensions.  Returning a synthetic
  // 1x1 result here makes a broken image look like a valid thumbnail, so leave
  // that decision to the caller's fallback path instead.
  if (!Number.isFinite(intrinsicWidth) || intrinsicWidth <= 0 || !Number.isFinite(intrinsicHeight) || intrinsicHeight <= 0) return { width: 0, height: 0 };
  const width = intrinsicWidth;
  const height = intrinsicHeight;
  const boundWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : width;
  const boundHeight = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : height;
  const scale = Math.min(boundWidth / width, boundHeight / height);
  return { width: width * scale, height: height * scale };
}

type PreviewMode = 'image' | 'message' | 'text';

let previewHost: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;
let activeByPointer = false;
let activeByFocus = false;
let previewRequestToken = 0;
let previewDragSuppressed = false;
const boundTargets = new WeakSet<HTMLElement>();
let previewImageLoader: ((source: string) => Promise<string | undefined>) | null = null;

/** Let the renderer provide the short-lived full-original hover loader. */
export function configureArtistCardPreview(loader: ((source: string) => Promise<string | undefined>) | null): void {
  previewImageLoader = loader;
}

function ensurePreviewHost(): HTMLElement {
  if (previewHost?.isConnected) return previewHost;
  previewHost = document.createElement('aside');
  previewHost.id = 'artist-card-preview';
  previewHost.className = 'artist-card-preview';
  previewHost.setAttribute('aria-hidden', 'true');
  previewHost.innerHTML = '<img alt=""><div class="artist-card-preview-copy"><b></b><code></code><p></p></div>';
  document.body.appendChild(previewHost);
  return previewHost;
}

function viewportPreviewBounds(): { width: number; height: number } {
  return {
    width: Math.min(380, Math.max(1, window.innerWidth - 24)),
    height: Math.min(520, Math.max(1, window.innerHeight * 0.68))
  };
}

function resetPreviewVisual(host: HTMLElement, image: HTMLImageElement, copy: HTMLElement): void {
  host.classList.remove('is-image', 'is-message', 'is-text-only', 'is-loading', 'is-visible');
  host.dataset.previewMode = '';
  host.style.removeProperty('width');
  host.style.removeProperty('height');
  image.removeAttribute('src');
  image.removeAttribute('width');
  image.removeAttribute('height');
  image.style.removeProperty('width');
  image.style.removeProperty('height');
  image.classList.remove('is-preview-error');
  copy.hidden = false;
}

function updatePosition(target: HTMLElement, host: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const bounds = viewportPreviewBounds();
  const measuredWidth = host.offsetWidth || Number.parseFloat(host.style.width) || bounds.width;
  const width = host.dataset.previewMode === 'image' ? Math.min(bounds.width, measuredWidth) : Math.min(bounds.width, Math.max(240, measuredWidth));
  // Image mode's measured width is the outer (border-box) width. Writing that
  // measurement back to the content width grows the host by its border on
  // every reposition. Keep the fitted intrinsic content size untouched and
  // use the outer measurement only for placement/clamping.
  if (host.dataset.previewMode !== 'image') host.style.width = `${width}px`;
  const gap = 14;
  const leftSpace = rect.left - gap;
  const rightSpace = window.innerWidth - rect.right - gap;
  const placeRight = rightSpace >= width || rightSpace >= leftSpace;
  const rawLeft = placeRight ? rect.right + gap : rect.left - width - gap;
  const maxLeft = Math.max(12, window.innerWidth - width - 12);
  const left = Math.max(12, Math.min(maxLeft, rawLeft));
  const rawTop = rect.top + Math.min(24, Math.max(0, (rect.height - 24) / 2));
  const height = host.offsetHeight || Number.parseFloat(host.style.height) || 280;
  const maxTop = Math.max(12, window.innerHeight - height - 12);
  const top = Math.max(12, Math.min(maxTop, rawTop));
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

function isPreviewCurrent(requestToken: number, target: HTMLElement, image: HTMLImageElement): boolean {
  return requestToken === previewRequestToken && activeTarget === target && image.isConnected;
}

function waitForImage(image: HTMLImageElement): Promise<boolean> {
  if (image.complete) return Promise.resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
  return new Promise(resolve => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };
    const ready = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.addEventListener('load', ready, { once: true });
    image.addEventListener('error', () => finish(false), { once: true });
    // Some browser engines complete cached images through decode without
    // dispatching a second load event. The load/error listeners remain the
    // source of truth; decode is merely an eager readiness signal.
    if (typeof image.decode === 'function') void image.decode().then(ready).catch(() => undefined);
  });
}

function revealImagePreview(target: HTMLElement, host: HTMLElement, image: HTMLImageElement, requestToken: number): boolean {
  if (!isPreviewCurrent(requestToken, target, image)) return false;
  const bounds = viewportPreviewBounds();
  const dimensions = fitArtistCardPreview(image.naturalWidth, image.naturalHeight, bounds.width, bounds.height);
  if (dimensions.width <= 0 || dimensions.height <= 0) return false;
  host.dataset.previewMode = 'image';
  host.classList.remove('is-message', 'is-text-only', 'is-loading');
  host.classList.add('is-image');
  host.style.width = `${dimensions.width}px`;
  host.style.height = `${dimensions.height}px`;
  image.style.width = `${dimensions.width}px`;
  image.style.height = `${dimensions.height}px`;
  image.classList.remove('is-preview-error');
  host.querySelector<HTMLElement>('.artist-card-preview-copy')?.setAttribute('hidden', '');
  updatePosition(target, host);
  host.setAttribute('aria-hidden', 'false');
  restartPreviewReveal(host);
  return true;
}

function revealTextPreview(target: HTMLElement, host: HTMLElement, mode: 'message' | 'text'): void {
  host.dataset.previewMode = mode;
  host.classList.remove('is-image', 'is-loading');
  host.classList.toggle('is-message', mode === 'message');
  host.classList.toggle('is-text-only', mode === 'text');
  host.style.removeProperty('height');
  host.style.width = `${Math.min(380, Math.max(240, window.innerWidth - 24))}px`;
  const copy = host.querySelector<HTMLElement>('.artist-card-preview-copy');
  if (copy) copy.hidden = false;
  updatePosition(target, host);
  host.setAttribute('aria-hidden', 'false');
  restartPreviewReveal(host);
}

function restartPreviewReveal(host: HTMLElement): void {
  host.classList.remove('is-visible');
  // Force the hidden state to commit before revealing the next target. This
  // keeps first-show and target-to-target reveals deterministic without an
  // asynchronous callback that could resurrect a stale preview.
  void host.offsetWidth;
  host.classList.add('is-visible');
}

function showPreview(target: HTMLElement, byPointer: boolean): void {
  if (previewDragSuppressed) {
    clearArtistCardPreview();
    return;
  }
  activeTarget = target;
  const requestToken = ++previewRequestToken;
  if (byPointer) activeByPointer = true;
  const host = ensurePreviewHost();
  const priorImage = host.querySelector<HTMLImageElement>('img');
  const previewImage = document.createElement('img');
  if (priorImage) priorImage.replaceWith(previewImage); else host.prepend(previewImage);
  const tag = host.querySelector<HTMLElement>('b');
  const prompt = host.querySelector<HTMLElement>('code');
  const description = host.querySelector<HTMLElement>('p');
  if (!previewImage || !tag || !prompt || !description) return;
  const kind = target.dataset.artistPreviewKind === 'message' ? 'message' : 'known';
  const constructor = target.hasAttribute('data-constructor-preview-tag');
  const library = target.hasAttribute('data-library-preview-image');
  const imageSource = constructor ? target.dataset.constructorPreviewImage : library ? target.dataset.libraryPreviewImage : target.dataset.artistPreviewImage;
  const displayTag = constructor ? target.dataset.constructorPreviewTag : library ? target.dataset.libraryPreviewTag : target.dataset.artistPreviewTag;
  const displayDescription = constructor ? target.dataset.constructorPreviewDescription : '';
  resetPreviewVisual(host, previewImage, host.querySelector<HTMLElement>('.artist-card-preview-copy') ?? host);
  previewImage.removeAttribute('src');
  previewImage.alt = '';
  tag.textContent = displayTag ?? '';
  prompt.textContent = '';
  description.textContent = displayDescription ?? '';
  description.hidden = !displayDescription;
  if (kind === 'message') {
    prompt.textContent = target.dataset.artistPreviewMessage ?? '';
    revealTextPreview(target, host, 'message');
  } else {
    const source = imageSource ?? '';
    const fallback = () => {
      if (requestToken !== previewRequestToken || activeTarget !== target) return;
      previewImage.removeAttribute('src');
      prompt.textContent = constructor ? 'No preview image available.' : 'Preview unavailable.';
      revealTextPreview(target, host, 'text');
    };
    if (!source) { fallback(); return; }
    // Only official NAX artist cards request a full original through the
    // hover cache. User-owned/custom/constructor/library bytes remain on their
    // existing direct source and are never transformed.
    const officialArtist = target.dataset.artistPreviewOfficial === 'true';
    const targetAtRequest = target;
    const sourcePromise = source && officialArtist && previewImageLoader ? previewImageLoader(source) : Promise.resolve(source || undefined);
    host.classList.add('is-loading');
    void sourcePromise.then(url => {
      if (!url || !isPreviewCurrent(requestToken, targetAtRequest, previewImage)) { if (!url && isPreviewCurrent(requestToken, targetAtRequest, previewImage)) fallback(); return; }
      previewImage.alt = displayTag ?? '';
      previewImage.src = url;
      return waitForImage(previewImage).then(ready => {
        if (!ready) { fallback(); return; }
        if (!revealImagePreview(targetAtRequest, host, previewImage, requestToken)) fallback();
      });
    }).catch(() => fallback());
    return;
  }
}

function hidePreview(target: HTMLElement): void {
  if (activeTarget !== target || activeByPointer || activeByFocus) return;
  clearArtistCardPreview();
}

/** Hide the shared preview before its active card is removed or replaced. */
export function clearArtistCardPreview(): void {
  previewRequestToken += 1;
  activeByPointer = false;
  activeByFocus = false;
  activeTarget = null;
  const host = previewHost;
  if (!host) return;
  const image = host.querySelector<HTMLImageElement>('img');
  const copy = host.querySelector<HTMLElement>('.artist-card-preview-copy');
  if (image && copy) resetPreviewVisual(host, image, copy);
  host.classList.remove('is-visible');
  host.setAttribute('aria-hidden', 'true');
}

/** Suppress the shared hover/focus preview for the native Custom Tags drag lifecycle. */
export function beginArtistCardPreviewDrag(): void {
  previewDragSuppressed = true;
  clearArtistCardPreview();
}

/** End Custom Tags drag suppression and leave the shared preview in its hidden state. */
export function endArtistCardPreviewDrag(): void {
  previewDragSuppressed = false;
  clearArtistCardPreview();
}

function bindTarget(target: HTMLElement): void {
  if (boundTargets.has(target)) return;
  boundTargets.add(target);

  // Interactive descendants focus themselves as part of a pointer press. That
  // focus is transient pointer state, not keyboard ownership of the shared
  // preview. Keep it local to the preview target so pointerleave can close the
  // preview while keyboard focus still pins it. Native ranges additionally
  // take pointer capture while their thumb is dragged, so their captured exit
  // path remains range-specific below.
  let rangePointerFocusPending = false;
  const isRangeControl = (event: Event): boolean => event.target instanceof HTMLInputElement && event.target.type === 'range';
  const isPointerFocusableControl = (event: Event): boolean => {
    if (!(event.target instanceof Element)) return false;
    const control = event.target.closest<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]');
    return Boolean(control && target.contains(control));
  };
  const isPointerInside = (event: PointerEvent): boolean => {
    const rect = target.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  const finishPointerFocus = (event: PointerEvent): void => {
    rangePointerFocusPending = false;
    if (!isRangeControl(event) || activeTarget !== target) return;
    if (event.type === 'pointercancel' || !isPointerInside(event)) {
      activeByPointer = false;
      hidePreview(target);
    }
  };

  target.addEventListener('pointerenter', () => showPreview(target, true));
  target.addEventListener('pointerleave', () => { activeByPointer = false; hidePreview(target); });
  target.addEventListener('pointerdown', event => {
    if (!isPointerFocusableControl(event)) return;
    rangePointerFocusPending = true;
    if (activeTarget === target) activeByFocus = false;
  }, true);
  target.addEventListener('pointerup', finishPointerFocus, true);
  target.addEventListener('pointercancel', finishPointerFocus, true);
  target.addEventListener('lostpointercapture', finishPointerFocus, true);
  target.addEventListener('focusin', () => {
    const pointerOriginatedRangeFocus = rangePointerFocusPending;
    rangePointerFocusPending = false;
    if (pointerOriginatedRangeFocus) return;
    activeByFocus = true;
    showPreview(target, false);
  });
  target.addEventListener('focusout', event => {
    if (target.contains(event.relatedTarget as Node | null)) return;
    activeByFocus = false;
    hidePreview(target);
  });
}

function repositionPreview(): void {
  if (activeTarget && !activeTarget.isConnected) {
    clearArtistCardPreview();
    return;
  }
  if (activeTarget && previewHost?.classList.contains('is-visible')) {
    const image = previewHost.querySelector<HTMLImageElement>('img');
    if (image && previewHost.dataset.previewMode === 'image' && image.naturalWidth > 0 && image.naturalHeight > 0) {
      const bounds = viewportPreviewBounds();
      const dimensions = fitArtistCardPreview(image.naturalWidth, image.naturalHeight, bounds.width, bounds.height);
      previewHost.style.width = `${dimensions.width}px`;
      previewHost.style.height = `${dimensions.height}px`;
      image.style.width = `${dimensions.width}px`;
      image.style.height = `${dimensions.height}px`;
    }
    updatePosition(activeTarget, previewHost);
  }
}

/** Bind previews to both selected artist cards and picker cards. Safe to call after each grid refresh. */
export function bindArtistCardPreview(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(PREVIEW_SELECTOR).forEach(bindTarget);
  if (!window.__naiArtistPreviewResizeBound) {
    window.addEventListener('resize', repositionPreview);
    window.__naiArtistPreviewResizeBound = true;
  }
}

declare global {
  interface Window { __naiArtistPreviewResizeBound?: boolean; }
}

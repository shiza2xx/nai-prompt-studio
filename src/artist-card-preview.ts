const PREVIEW_SELECTOR = '[data-artist-preview-image], [data-artist-preview-message], [data-constructor-preview-tag], [data-library-preview-image]';

let previewHost: HTMLElement | null = null;
let activeTarget: HTMLElement | null = null;
let activeByPointer = false;
let activeByFocus = false;
const boundTargets = new WeakSet<HTMLElement>();

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

function updatePosition(target: HTMLElement, host: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const width = Math.min(380, Math.max(240, window.innerWidth - 24));
  host.style.width = `${width}px`;
  const gap = 14;
  const leftSpace = rect.left - gap;
  const rightSpace = window.innerWidth - rect.right - gap;
  const placeRight = rightSpace >= width || rightSpace >= leftSpace;
  const rawLeft = placeRight ? rect.right + gap : rect.left - width - gap;
  const maxLeft = Math.max(12, window.innerWidth - width - 12);
  const left = Math.max(12, Math.min(maxLeft, rawLeft));
  const rawTop = rect.top + Math.min(24, Math.max(0, (rect.height - 24) / 2));
  const height = host.offsetHeight || 280;
  const maxTop = Math.max(12, window.innerHeight - height - 12);
  const top = Math.max(12, Math.min(maxTop, rawTop));
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
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
  activeTarget = target;
  if (byPointer) activeByPointer = true;
  const host = ensurePreviewHost();
  const previewImage = host.querySelector<HTMLImageElement>('img');
  const tag = host.querySelector<HTMLElement>('b');
  const prompt = host.querySelector<HTMLElement>('code');
  const description = host.querySelector<HTMLElement>('p');
  if (!previewImage || !tag || !prompt || !description) return;
  const kind = target.dataset.artistPreviewKind === 'message' ? 'message' : 'known';
  const constructor = target.hasAttribute('data-constructor-preview-tag');
  const library = target.hasAttribute('data-library-preview-image');
  const imageSource = constructor ? target.dataset.constructorPreviewImage : library ? target.dataset.libraryPreviewImage : target.dataset.artistPreviewImage;
  const displayTag = constructor ? target.dataset.constructorPreviewTag : library ? target.dataset.libraryPreviewTag : target.dataset.artistPreviewTag;
  const displayDescription = constructor ? target.dataset.constructorPreviewDescription : library ? target.dataset.libraryPreviewDescription : '';
  previewImage.removeAttribute('src');
  previewImage.alt = '';
  tag.textContent = displayTag ?? '';
  prompt.textContent = '';
  description.textContent = displayDescription ?? '';
  description.hidden = !displayDescription;
  host.classList.toggle('is-message', kind === 'message');
  host.classList.toggle('is-text-only', constructor && target.dataset.constructorPreviewNoImage === 'true');
  if (kind === 'message') {
    prompt.textContent = target.dataset.artistPreviewMessage ?? '';
  } else {
    previewImage.src = imageSource ?? '';
    previewImage.alt = displayTag ?? '';
    prompt.textContent = constructor ? 'Prompt builder tag' : library ? target.dataset.libraryPreviewPrompt ?? '' : target.dataset.artistPreviewPrompt ?? '';
  }
  updatePosition(target, host);
  host.setAttribute('aria-hidden', 'false');
  restartPreviewReveal(host);
}

function hidePreview(target: HTMLElement): void {
  if (activeTarget !== target || activeByPointer || activeByFocus) return;
  clearArtistCardPreview();
}

/** Hide the shared preview before its active card is removed or replaced. */
export function clearArtistCardPreview(): void {
  activeByPointer = false;
  activeByFocus = false;
  activeTarget = null;
  const host = previewHost;
  if (!host) return;
  host.classList.remove('is-visible');
  host.setAttribute('aria-hidden', 'true');
}

function bindTarget(target: HTMLElement): void {
  if (boundTargets.has(target)) return;
  boundTargets.add(target);

  // Native range inputs take pointer capture while their thumb is dragged. A
  // pointer press also focuses the range, which used to make the shared
  // preview believe it had keyboard focus after the cursor had already left
  // the card. Keep that focus source local to the preview target: keyboard
  // focus still pins the preview, pointer-originated range focus does not.
  let rangePointerFocusPending = false;
  const isRangeControl = (event: Event): boolean => event.target instanceof HTMLInputElement && event.target.type === 'range';
  const isPointerInside = (event: PointerEvent): boolean => {
    const rect = target.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  const finishRangePointer = (event: PointerEvent): void => {
    if (!isRangeControl(event) || activeTarget !== target) return;
    rangePointerFocusPending = false;
    if (event.type === 'pointercancel' || !isPointerInside(event)) {
      activeByPointer = false;
      hidePreview(target);
    }
  };

  target.addEventListener('pointerenter', () => showPreview(target, true));
  target.addEventListener('pointerleave', () => { activeByPointer = false; hidePreview(target); });
  target.addEventListener('pointerdown', event => {
    if (!isRangeControl(event)) return;
    rangePointerFocusPending = true;
    if (activeTarget === target) activeByFocus = false;
  }, true);
  target.addEventListener('pointerup', finishRangePointer, true);
  target.addEventListener('pointercancel', finishRangePointer, true);
  target.addEventListener('lostpointercapture', finishRangePointer, true);
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
  if (activeTarget && previewHost?.classList.contains('is-visible')) updatePosition(activeTarget, previewHost);
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

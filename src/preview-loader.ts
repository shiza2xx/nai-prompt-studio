export interface PreviewLoadResult<T> {
  failed: T[];
  completed: number;
  total: number;
}

/** Decode a bounded batch without retaining image objects or exceeding concurrency. */
export async function decodePreviews<T>(items: readonly T[], decode: (item: T) => Promise<boolean>, concurrency = 6, onProgress: (completed: number, total: number) => void = () => {}): Promise<PreviewLoadResult<T>> {
  const queue = [...items];
  const failed: T[] = [];
  const total = queue.length;
  let completed = 0;
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      let success = false;
      try { success = await decode(item); } catch { success = false; }
      if (!success) failed.push(item);
      completed += 1;
      onProgress(completed, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency) || 1), Math.max(1, total)) }, worker));
  return { failed, completed, total };
}

/** A scoped, generation-gated viewport scheduler for stable grid image slots. */
export class ViewportPreviewLoader {
  private observer: IntersectionObserver | null = null;
  private scope: HTMLElement | null = null;
  private generation = 0;
  dispose(): void { this.generation += 1; this.observer?.disconnect(); this.observer = null; this.scope = null; }
  hydrate(scope: HTMLElement, selector: string, load: (image: HTMLImageElement, priority: 'visible' | 'current-page') => void): void {
    // Rescans replace their observer even for the same scope. Generations
    // make old callbacks harmless; disconnecting prevents them accumulating.
    this.observer?.disconnect(); this.observer = null;
    if (this.scope !== scope) this.generation += 1;
    this.scope = scope;
    const generation = ++this.generation;
    const images = [...scope.querySelectorAll<HTMLImageElement>(selector)];
    const current = () => this.scope === scope && scope.isConnected && generation === this.generation;
    const scrollRoot = scope.scrollHeight > scope.clientHeight + 1 || scope.scrollWidth > scope.clientWidth + 1;
    const viewport = () => {
      if (scrollRoot) return scope.getBoundingClientRect();
      const documentElement = typeof document === 'undefined' ? undefined : document.documentElement;
      return { top: 0, left: 0, bottom: globalThis.innerHeight || documentElement?.clientHeight || 0, right: globalThis.innerWidth || documentElement?.clientWidth || 0 };
    };
    const visible = (image: HTMLImageElement) => {
      const box = image.getBoundingClientRect(); const root = viewport();
      return box.bottom >= root.top - 360 && box.top <= root.bottom + 360;
    };
    for (const image of images) if (visible(image)) load(image, 'visible');
    if (typeof IntersectionObserver === 'undefined') {
      for (const image of images) if (current() && !visible(image)) load(image, 'current-page');
      return;
    }
    this.observer = new IntersectionObserver(entries => {
      if (!current()) return;
      for (const entry of entries) if (entry.isIntersecting) { load(entry.target as HTMLImageElement, 'visible'); this.observer?.unobserve(entry.target); }
    }, { root: scrollRoot ? scope : null, rootMargin: '360px 0px' });
    for (const image of images) if (!visible(image)) this.observer.observe(image);
  }
}

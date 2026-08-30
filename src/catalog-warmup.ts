import type { CatalogCard } from './types';

export interface WarmupPlanOptions {
  selected?: readonly string[];
  anchors?: readonly string[];
  companions?: readonly string[];
  visible?: readonly string[];
  initialLimit?: number;
  /** Keep the plan bounded when callers only need first/likely pages. */
  includeCatalogRemainder?: boolean;
}

export interface IdleWarmupOptions {
  /** Delay the first idle slice so startup gets a quiet grace period. */
  initialGraceMs?: number;
  /** Re-check this predicate before each slice; true postpones background work. */
  shouldBackoff?: () => boolean;
  /** Keep each idle callback to one background job. */
  onePerSlice?: boolean;
  /** Delay used while backoff is active. */
  backoffMs?: number;
}

/**
 * Prefer the browser's idle queue and retain a conservative timer fallback for
 * older Electron/WebViews and deterministic callers.
 */
export function scheduleIdleCallback(callback: () => void, fallbackDelayMs = 64, timeoutMs = 1500): unknown {
  const host = globalThis as typeof globalThis & {
    requestIdleCallback?: (idleCallback: () => void, options?: { timeout?: number }) => unknown;
  };
  if (typeof host.requestIdleCallback === 'function') return host.requestIdleCallback(callback, { timeout: timeoutMs });
  return globalThis.setTimeout(callback, Math.max(0, fallbackDelayMs));
}

/**
 * Keep a warmup queue stable when several startup groups overlap. The first
 * occurrence owns the work, so callers can put higher-value groups first and
 * still retain one bounded job per source.
 */
export function uniqueWarmupItems<T>(items: readonly T[], sourceOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const source = String(sourceOf(item) || '').trim();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    unique.push(item);
  }
  return unique;
}

/**
 * Produce a deterministic, deduplicated preview order. Only the bounded
 * prefix is used before the studio opens; callers may schedule the suffix on
 * idle time. This keeps startup independent of total catalog size.
 */
export function buildWarmupPlan(cards: readonly CatalogCard[], options: WarmupPlanOptions = {}): CatalogCard[] {
  const limit = Math.max(1, Math.floor(options.initialLimit ?? 48));
  if (options.includeCatalogRemainder === false) {
    // Bounded startup plans scan the catalog only to resolve requested IDs and
    // a bounded fill prefix. In particular, do not build a whole-catalog Map
    // (or an intermediate array) before the limit is known to be satisfied.
    const requestedIds: string[] = [];
    const requestedSet = new Set<string>();
    const collectRequested = (ids: readonly string[] | undefined): void => {
      for (const id of ids ?? []) {
        if (id && !requestedSet.has(id)) {
          requestedSet.add(id);
          requestedIds.push(id);
        }
      }
    };
    collectRequested(options.selected);
    collectRequested(options.anchors);
    collectRequested(options.companions);
    collectRequested(options.visible);
    const requestedCards = new Map<string, CatalogCard>();
    const fillCards: CatalogCard[] = [];
    const fillIds = new Set<string>();
    for (const card of cards) {
      const key = card.catalogId ?? card.id;
      if (!key) continue;
      if (requestedSet.has(key)) requestedCards.set(key, card);
      else if (fillCards.length < limit && !fillIds.has(key)) {
        fillIds.add(key);
        fillCards.push(card);
      }
      if (requestedCards.size === requestedSet.size && requestedCards.size + fillCards.length >= limit) break;
    }
    const order: CatalogCard[] = [];
    const seen = new Set<string>();
    for (const id of requestedIds) {
      const card = requestedCards.get(id);
      const key = card?.catalogId ?? card?.id;
      if (card && key && !seen.has(key)) {
        seen.add(key);
        order.push(card);
      }
      if (order.length >= limit) return order;
    }
    for (const card of fillCards) {
      const key = card.catalogId ?? card.id;
      if (key && !seen.has(key)) {
        seen.add(key);
        order.push(card);
      }
      if (order.length >= limit) break;
    }
    return order.slice(0, limit);
  }
  const byId = new Map(cards.map(card => [card.catalogId ?? card.id, card]));
  const order: CatalogCard[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => { const card = id ? byId.get(id) : undefined; const key = card?.catalogId ?? card?.id; if (card && key && !seen.has(key)) { seen.add(key); order.push(card); } };
  for (const id of options.selected ?? []) add(id);
  for (const id of options.anchors ?? []) add(id);
  for (const id of options.companions ?? []) add(id);
  for (const id of options.visible ?? []) add(id);
  for (const card of cards) add(card.catalogId ?? card.id);
  return order.slice(0, limit).concat(order.slice(limit));
}

export function scheduleIdleWarmup<T>(items: readonly T[], work: (item: T) => Promise<boolean>, initialLimit = 48, idle: (callback: () => void) => unknown = callback => scheduleIdleCallback(callback), concurrency = 4, options: IdleWarmupOptions = {}): { initial: T[]; startIdle: () => void; cancel: () => void } {
  const initial = items.slice(0, Math.max(0, Math.floor(initialLimit)));
  const remainder = items.slice(initial.length);
  let stopped = false;
  let started = false;
  const graceMs = Math.max(0, Math.floor(options.initialGraceMs ?? 0));
  const backoffMs = Math.max(16, Math.floor(options.backoffMs ?? 250));
  let firstSlice = true;
  return {
    initial,
    startIdle: () => {
      if (started) return;
      started = true;
      let index = 0;
      let active = 0;
      const schedule = (callback: () => void): void => {
        if (stopped) return;
        if (firstSlice && graceMs > 0) {
          firstSlice = false;
          globalThis.setTimeout(() => idle(callback), graceMs);
          return;
        }
        firstSlice = false;
        if (options.shouldBackoff?.()) {
          globalThis.setTimeout(() => schedule(callback), backoffMs);
          return;
        }
        idle(callback);
      };
      const pump = () => {
        if (stopped) return;
        const capacity = options.onePerSlice ? 1 : Math.max(1, Math.floor(concurrency));
        while (active < capacity && index < remainder.length) {
          const item = remainder[index++];
          active += 1;
          Promise.resolve(work(item)).catch(() => false).finally(() => { active -= 1; schedule(pump); });
        }
        if (index >= remainder.length && active === 0) stopped = true;
      };
      schedule(pump);
    },
    cancel: () => { stopped = true; }
  };
}

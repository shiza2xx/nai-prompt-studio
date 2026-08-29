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

export function scheduleIdleWarmup<T>(items: readonly T[], work: (item: T) => Promise<boolean>, initialLimit = 48, idle: (callback: () => void) => unknown = callback => globalThis.setTimeout(callback, 0), concurrency = 4): { initial: T[]; startIdle: () => void; cancel: () => void } {
  const initial = items.slice(0, Math.max(0, Math.floor(initialLimit)));
  const remainder = items.slice(initial.length);
  let stopped = false;
  let started = false;
  return {
    initial,
    startIdle: () => {
      if (started) return;
      started = true;
      let index = 0;
      let active = 0;
      const pump = () => {
        if (stopped) return;
        while (active < Math.max(1, Math.floor(concurrency)) && index < remainder.length) {
          const item = remainder[index++];
          active += 1;
          Promise.resolve(work(item)).catch(() => false).finally(() => { active -= 1; idle(pump); });
        }
        if (index >= remainder.length && active === 0) stopped = true;
      };
      idle(pump);
    },
    cancel: () => { stopped = true; }
  };
}

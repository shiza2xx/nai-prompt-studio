import type { CatalogCard } from './types';

export interface WarmupPlanOptions {
  selected?: readonly string[];
  anchors?: readonly string[];
  companions?: readonly string[];
  visible?: readonly string[];
  initialLimit?: number;
}

/**
 * Produce a deterministic, deduplicated preview order. Only the bounded
 * prefix is used before the studio opens; callers may schedule the suffix on
 * idle time. This keeps startup independent of total catalog size.
 */
export function buildWarmupPlan(cards: readonly CatalogCard[], options: WarmupPlanOptions = {}): CatalogCard[] {
  const byId = new Map(cards.map(card => [card.catalogId ?? card.id, card]));
  const order: CatalogCard[] = [];
  const seen = new Set<string>();
  const add = (id: string | undefined) => { const card = id ? byId.get(id) : undefined; const key = card?.catalogId ?? card?.id; if (card && key && !seen.has(key)) { seen.add(key); order.push(card); } };
  for (const id of options.selected ?? []) add(id);
  for (const id of options.anchors ?? []) add(id);
  for (const id of options.companions ?? []) add(id);
  for (const id of options.visible ?? []) add(id);
  for (const card of cards) add(card.catalogId ?? card.id);
  const limit = Math.max(1, Math.floor(options.initialLimit ?? 48));
  return order.slice(0, limit).concat(order.slice(limit));
}

export function scheduleIdleWarmup<T>(items: readonly T[], work: (item: T) => Promise<boolean>, initialLimit = 48, idle: (callback: () => void) => unknown = callback => globalThis.setTimeout(callback, 0), concurrency = 4): { initial: T[]; startIdle: () => void } {
  const initial = items.slice(0, Math.max(0, Math.floor(initialLimit)));
  const remainder = items.slice(initial.length);
  return {
    initial,
    startIdle: () => {
      let index = 0;
      let active = 0;
      let stopped = false;
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
    }
  };
}

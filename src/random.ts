import type { CatalogCard, WeightedTag } from './types';

export interface RandomArtistSelection {
  card: CatalogCard;
  weight: number;
}

export const MIN_ARTIST_WEIGHT = 0.1;
export const MAX_ARTIST_WEIGHT = 2.0;
export const ARTIST_WEIGHT_STEPS = 20;

export interface RandomPoolRange {
  min: number;
  max: number;
  available: number;
  feasible: boolean;
}

/** Keep injected random sources deterministic and safe at their endpoints. */
function randomUnit(random: () => number): number {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0;
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
}

/** Return a unique sample without replacement, bounded by the available pool. */
export function pickUniqueCards(cards: CatalogCard[], count: number, random = Math.random): CatalogCard[] {
  const pool = [...cards];
  const chosen: CatalogCard[] = [];
  const requested = Math.max(0, Math.floor(Number(count) || 0));
  while (chosen.length < requested && pool.length) chosen.push(pool.splice(Math.floor(randomUnit(random) * pool.length), 1)[0]);
  return chosen;
}

/** Pick an inclusive integer count without mutating the catalog or range. */
export function randomCount(min: number, max: number, random = Math.random): number {
  const lower = Math.max(0, Math.ceil(Number(min) || 0));
  const upper = Math.max(lower, Math.floor(Number(max) || lower));
  return lower + Math.floor(randomUnit(random) * (upper - lower + 1));
}

/**
 * Resolve a persisted random range against the active pool without asking the
 * sampler for more cards than exist. A pool below two is intentionally marked
 * infeasible so callers can preserve the current selection and explain how to
 * continue instead of silently producing a one-card replacement.
 */
export function resolveRandomPoolRange(value: { min?: unknown; max?: unknown } | undefined, available: number, minimum = 2): RandomPoolRange {
  const pool = Math.max(0, Math.floor(Number(available) || 0));
  const floor = Math.max(1, Math.floor(Number(minimum) || 2));
  if (pool < floor) return { min: pool, max: pool, available: pool, feasible: false };
  const requestedMin = Number(value?.min);
  const requestedMax = Number(value?.max);
  const min = Math.max(floor, Math.min(pool, Number.isFinite(requestedMin) ? Math.round(requestedMin) : floor));
  const max = Math.max(min, Math.min(pool, Number.isFinite(requestedMax) ? Math.round(requestedMax) : pool));
  return { min, max, available: pool, feasible: true };
}

/** Alias kept short for UI callers and deterministic consumers. */
export const randomPoolRange = resolveRandomPoolRange;

/** Pick an independent V5 weight on the exact 0.1..2.0 discrete grid. */
export function randomWeight(random = Math.random): number {
  return Number((MIN_ARTIST_WEIGHT + Math.floor(randomUnit(random) * ARTIST_WEIGHT_STEPS) * 0.1).toFixed(1));
}

/** Normalize user or persisted values onto the exact V5 weight grid. */
export function normalizeArtistWeight(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  const source = Number.isFinite(parsed) ? parsed : fallback;
  return Number(Math.max(MIN_ARTIST_WEIGHT, Math.min(MAX_ARTIST_WEIGHT, Math.round(source * 10) / 10)).toFixed(1));
}

/** Reroll every selected weight while preserving card order and identity. */
export function rerollArtistWeights(artists: WeightedTag[], random = Math.random): WeightedTag[] {
  return artists.map(artist => ({ ...artist, weight: randomWeight(random) }));
}

/** Reroll exactly one selected weight without changing any other field. */
export function rerollArtistWeight(artist: WeightedTag, random = Math.random): WeightedTag {
  return { ...artist, weight: randomWeight(random) };
}

/**
 * Reconcile a persisted selection with the current catalog by stable catalogId.
 * Missing cards stay in place with their last known metadata so a catalog refresh
 * cannot silently erase a user's prompt. Matching cards receive current labels
 * and image paths while retaining their row id, order, and weight.
 */
export function reconcileSelectedArtists(selected: WeightedTag[], cards: CatalogCard[]): WeightedTag[] {
  const byCatalogId = new Map(cards.map(card => [card.catalogId ?? card.id, card]));
  const seen = new Set<string>();
  return selected.flatMap(artist => {
    const stableId = artist.catalogId ?? artist.id;
    if (!stableId || seen.has(stableId)) return [];
    seen.add(stableId);
    const card = byCatalogId.get(stableId);
    if (!card) return [{ ...artist, catalogId: stableId, weight: normalizeArtistWeight(artist.weight) }];
    return [{
      ...artist,
      catalogId: card.catalogId ?? card.id,
      image: card.image,
      tag: `artist: ${card.tag}`,
      weight: normalizeArtistWeight(artist.weight)
    }];
  });
}

/** Select unique cards and independently assign each card a discrete weight. */
export function randomArtistSelection(cards: CatalogCard[], count: number, random = Math.random): RandomArtistSelection[] {
  return pickUniqueCards(cards, count, random).map(card => ({ card, weight: randomWeight(random) }));
}

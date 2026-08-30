import type { CatalogCard } from './types';

export const CHARACTER_PAGE_SIZE = 96;
export const ARTIST_PAGE_SIZE = 72;

export interface CharacterPageOptions {
  query?: string;
  favoritesOnly?: boolean;
  favoriteIds?: ReadonlySet<string>;
  page?: number;
  pageSize?: number;
}

export interface CharacterPage {
  cards: CatalogCard[];
  /** Alias for consumers that describe the page payload as items. */
  items: CatalogCard[];
  total: number;
  filteredCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  firstIndex: number;
  lastIndex: number;
  startIndex: number;
  endIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

interface SearchIndex {
  cards: readonly CatalogCard[];
  normalizedTags: readonly string[];
  results: Map<string, readonly number[]>;
}

const SEARCH_CACHE_LIMIT = 32;
const characterSearchIndexes = new WeakMap<object, SearchIndex>();

function searchIndexFor(cards: readonly CatalogCard[]): SearchIndex {
  const existing = characterSearchIndexes.get(cards);
  if (existing) return existing;
  const index = { cards, normalizedTags: cards.map(card => card.tag.toLocaleLowerCase()), results: new Map<string, readonly number[]>() };
  characterSearchIndexes.set(cards, index);
  return index;
}

function cachedSearchHits(cards: readonly CatalogCard[], query: string): readonly number[] {
  const index = searchIndexFor(cards);
  const cached = index.results.get(query);
  if (cached) {
    // Map insertion order is the LRU list: refreshing a hit moves it to MRU.
    index.results.delete(query); index.results.set(query, cached);
    return cached;
  }
  const hits: number[] = [];
  for (let position = 0; position < cards.length; position += 1) if (!query || index.normalizedTags[position]!.includes(query)) hits.push(position);
  index.results.set(query, hits);
  if (index.results.size > SEARCH_CACHE_LIMIT) index.results.delete(index.results.keys().next().value!);
  return hits;
}

/** Return every catalog match before pagination is applied. */
export function filterCharacters(
  cards: readonly CatalogCard[],
  query = '',
  favoritesOnly = false,
  favoriteIds: ReadonlySet<string> = new Set<string>(),
): CatalogCard[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  // Favorites are intentionally evaluated after cached text hits: the favorite
  // set is mutable while the catalog array is not, so caching it would stale.
  return cachedSearchHits(cards, normalizedQuery).map(position => cards[position]!).filter(card => {
    const isFavorite = favoriteIds.has(card.catalogId ?? card.id) || favoriteIds.has(card.id);
    return !favoritesOnly || isFavorite;
  });
}

/** Build a bounded, 1-based page over the complete filtered catalog. */
export function paginateCharacters(cards: readonly CatalogCard[], options: CharacterPageOptions = {}): CharacterPage {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? CHARACTER_PAGE_SIZE));
  const filtered = filterCharacters(cards, options.query, options.favoritesOnly, options.favoriteIds);
  const pageCount = Math.ceil(filtered.length / pageSize);
  const requestedPage = Number.isFinite(options.page) ? Math.floor(options.page as number) : 1;
  const page = pageCount ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const firstIndex = pageCount ? (page - 1) * pageSize : 0;
  const pageCards = filtered.slice(firstIndex, firstIndex + pageSize);
  return {
    cards: pageCards,
    items: pageCards,
    total: filtered.length,
    filteredCount: filtered.length,
    page,
    pageCount,
    pageSize,
    firstIndex,
    lastIndex: pageCards.length ? firstIndex + pageCards.length - 1 : -1,
    startIndex: firstIndex,
    endIndex: pageCards.length ? firstIndex + pageCards.length - 1 : -1,
    hasPrevious: page > 1,
    hasNext: pageCount > 0 && page < pageCount,
  };
}

/** Paginate the full V5 artist catalog without placing thousands of cards in the DOM. */
export function paginateArtists(cards: readonly CatalogCard[], options: CharacterPageOptions = {}): CharacterPage {
  return paginateCharacters(cards, { ...options, pageSize: options.pageSize ?? ARTIST_PAGE_SIZE });
}

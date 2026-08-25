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

/** Return every catalog match before pagination is applied. */
export function filterCharacters(
  cards: readonly CatalogCard[],
  query = '',
  favoritesOnly = false,
  favoriteIds: ReadonlySet<string> = new Set<string>(),
): CatalogCard[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return cards.filter(card => {
    const isFavorite = favoriteIds.has(card.catalogId ?? card.id) || favoriteIds.has(card.id);
    return (!favoritesOnly || isFavorite)
      && (!normalizedQuery || card.tag.toLocaleLowerCase().includes(normalizedQuery));
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

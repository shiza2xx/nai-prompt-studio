import type { ArtistMixDraft, CatalogCard, CustomTag, WeightedTag } from './types';

const ARTIST_PREFIX = /^\s*artist\s*:\s*/i;

/** Decode the small entity subset commonly copied from gallery labels. */
function decodeEntities(value: string): string {
  return value.replace(/&(amp|quot|apos|lt|gt|nbsp);|&#(\d+);|&#x([\da-f]+);/gi, (_match, named?: string, decimal?: string, hexadecimal?: string) => {
    if (named) return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' } as Record<string, string>)[named.toLowerCase()] ?? _match;
    const code = Number.parseInt(decimal ?? hexadecimal ?? '', hexadecimal ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _match;
  });
}

/** Strip an optional prompt prefix while retaining a readable saved display name. */
export function artistDisplayName(value: unknown): string {
  return decodeEntities(String(value ?? '')).normalize('NFKC').replace(ARTIST_PREFIX, '').trim().replace(/\s+/g, ' ');
}

/** Stable cross-source identity: punctuation stays meaningful, visual spacing does not. */
export function canonicalArtistIdentity(value: unknown): string {
  return artistDisplayName(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function customArtistCatalogId(tagId: string): string { return `artist-v5-custom-${tagId}`; }

export interface EffectiveArtistCatalog {
  cards: CatalogCard[];
  aliases: Map<string, string>;
  shadowedCustomIds: Set<string>;
}

/**
 * Official NAX V5 cards always win. Shadowed personal records remain stored so
 * they become active again if that official snapshot no longer contains them.
 */
export function mergeArtistCatalog(
  officialCards: readonly CatalogCard[],
  customTags: readonly CustomTag[],
  customImage: (tag: CustomTag) => string
): EffectiveArtistCatalog {
  const officialByName = new Map<string, CatalogCard>();
  const cards: CatalogCard[] = [];
  for (const card of officialCards) {
    const key = canonicalArtistIdentity(card.tag);
    if (!key || officialByName.has(key)) continue;
    officialByName.set(key, card);
    cards.push(card);
  }
  const aliases = new Map<string, string>();
  const shadowedCustomIds = new Set<string>();
  const customNames = new Set<string>();
  for (const tag of customTags) {
    if (tag.kind !== 'artist') continue;
    const key = canonicalArtistIdentity(tag.tag);
    if (!key || customNames.has(key)) continue;
    customNames.add(key);
    const id = customArtistCatalogId(tag.id);
    const official = officialByName.get(key);
    if (official) {
      aliases.set(id, official.catalogId ?? official.id);
      shadowedCustomIds.add(tag.id);
      continue;
    }
    cards.push({ id, catalogId: id, tag: artistDisplayName(tag.tag), gallery: 'custom', image: customImage(tag), score: 0, custom: true });
  }
  return { cards, aliases, shadowedCustomIds };
}

export function migrateArtistAliases(items: readonly WeightedTag[], aliases: ReadonlyMap<string, string>): WeightedTag[] {
  return items.map(item => {
    const catalogId = item.catalogId ?? item.id;
    const replacement = aliases.get(catalogId);
    return replacement ? { ...item, catalogId: replacement } : item;
  });
}

export function migrateArtistMixAliases(value: ArtistMixDraft, aliases: ReadonlyMap<string, string>): ArtistMixDraft {
  const primary = value.primary ? migrateArtistAliases([value.primary], aliases)[0] : null;
  const companions = migrateArtistAliases(value.companions, aliases);
  return { ...value, primary, companions };
}

export function migrateFavoriteAliases(favorites: ReadonlySet<string>, aliases: ReadonlyMap<string, string>): Set<string> {
  return new Set([...favorites].map(id => aliases.get(id) ?? id));
}

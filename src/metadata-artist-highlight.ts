import { serializeTag } from './prompt.ts';
import type { CatalogCard, WeightedTag } from './types';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' };
const NAMED_ENTITIES: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };
const WORD_CHARACTER = '[\\p{L}\\p{N}_]';

export function escapeMetadataHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => HTML_ESCAPES[character]!);
}

/** Decode the entity forms present in the NAX catalog before matching prompt text. */
export function decodeCatalogEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|apos|gt|lt|quot);/gi, (entity, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLocaleLowerCase()] ?? entity;
    const hex = body[1]?.toLocaleLowerCase() === 'x';
    const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
}

function normalizeName(value: string): string {
  return decodeCatalogEntities(value).normalize('NFKC').toLocaleLowerCase().trim();
}

function artistKey(value: string): string {
  return normalizeName(value).replace(/[ _]+/g, ' ');
}

function artistName(value: string): string {
  return decodeCatalogEntities(value).replace(/^artist\s*:\s*/iu, '').trim();
}

/** A structured, DOM-free artist extraction API for Metadata saves. */
export function extractMetadataArtists(basePositive: string, cards: readonly CatalogCard[]): WeightedTag[] {
  const catalog = new Map<string, CatalogCard>();
  for (const card of cards) {
    const key = artistKey(artistName(card.tag));
    if (key && !catalog.has(key)) catalog.set(key, card);
  }
  const found: WeightedTag[] = [];
  const foundByIdentity = new Map<string, { index: number; authority: number; position: number }>();
  const add = (name: string, weight: number, authority: number, position: number, card?: CatalogCard): void => {
    const cleaned = artistName(name);
    if (!cleaned) return;
    const canonical = card ? (card.catalogId ?? card.id) : `unknown:${artistKey(cleaned)}`;
    if (!canonical) return;
    const item: WeightedTag = { id: canonical, catalogId: card?.catalogId ?? card?.id, image: card?.image, tag: `artist: ${card ? artistName(card.tag) : cleaned}`, weight: Number.isFinite(weight) && weight > 0 ? weight : 1 };
    const existing = foundByIdentity.get(canonical);
    if (!existing) {
      foundByIdentity.set(canonical, { index: found.length, authority, position });
      found.push(item);
    } else if (authority > existing.authority) {
      found[existing.index] = item;
      existing.authority = authority;
      existing.position = Math.min(existing.position, position);
    }
  };

  // Canonical NovelAI serialization is the highest-authority explicit form.
  // Require its `artist:` marker so an arbitrary weighted prompt segment is
  // never promoted into an unknown artist.
  const canonical = /([0-9]+(?:\.[0-9]+)?)\s*::\s*artist\s*:\s*([^,:\n]+?)\s*::/giu;
  for (let match = canonical.exec(basePositive); match; match = canonical.exec(basePositive)) {
    const name = match[2].trim();
    add(name, Number(match[1]), 3, match.index, catalog.get(artistKey(name)));
  }
  // Older canonical records omit `artist:`. They are catalog-only so an
  // unrelated weighted segment cannot become an unknown artist.
  const canonicalKnown = /([0-9]+(?:\.[0-9]+)?)\s*::\s*([^,:\n]+?)\s*::/giu;
  for (let match = canonicalKnown.exec(basePositive); match; match = canonicalKnown.exec(basePositive)) {
    const name = artistName(match[2]);
    const card = catalog.get(artistKey(name));
    if (card) add(name, Number(match[1]), 3, match.index, card);
  }
  // Older metadata can instead encode `artist: name::weight`.
  const legacyWeighted = /(?<![\p{L}\p{N}_])artist\s*:\s*([^,:\n\}\]]+?)\s*::\s*([0-9]+(?:\.[0-9]+)?)(?=\s*(?:,|\n|\}|\]|$))/giu;
  for (let match = legacyWeighted.exec(basePositive); match; match = legacyWeighted.exec(basePositive)) {
    const name = match[1].trim();
    add(name, Number(match[2]), 2, match.index, catalog.get(artistKey(name)));
  }
  // Explicit values are deliberately retained even when absent from the catalog.
  const explicit = /(?<![\p{L}\p{N}_])artist\s*:\s*([^,:\n\}\]]+?)(?=\s*(?:,|\n|\}|\]|$))/giu;
  for (let match = explicit.exec(basePositive); match; match = explicit.exec(basePositive)) {
    const name = match[1].trim();
    add(name, 1, 1, match.index, catalog.get(artistKey(name)));
  }
  // Known names may occur as ordinary positive tags. Boundary matching avoids substrings.
  const normalized = normalizePrompt(basePositive);
  for (const [key, card] of catalog) {
    const pattern = new RegExp(`(?<!${WORD_CHARACTER})${namePattern(normalizeName(artistName(card.tag)))}(?!${WORD_CHARACTER})`, 'giu');
    if (pattern.test(normalized.text)) add(card.tag, 1, 0, basePositive.length, card);
  }
  return found
    .map(item => ({ item, position: foundByIdentity.get(item.id)?.position ?? basePositive.length }))
    .sort((left, right) => left.position - right.position)
    .map(({ item }) => item);
}

/** Serialize the extracted records with the same digit-ending safeguard as the prompt builder. */
export function serializeMetadataArtists(artists: readonly WeightedTag[]): string {
  return artists.map(item => serializeTag(item)).filter((item): item is string => Boolean(item)).join(', ');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namePattern(normalizedName: string): string {
  return normalizedName.split(/([ _]+)/).filter(Boolean).map(part => /^[ _]+$/.test(part) ? '[ _]+' : escapeRegex(part)).join('');
}

interface NormalizedPrompt {
  text: string;
  starts: number[];
  ends: number[];
}

/** NFKC-normalize one source character at a time so result ranges retain the original prompt text. */
function normalizePrompt(value: string): NormalizedPrompt {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of value) {
    const normalized = character.normalize('NFKC').toLocaleLowerCase();
    text += normalized;
    for (let index = 0; index < normalized.length; index += 1) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    offset += character.length;
  }
  return { text, starts, ends };
}

interface ArtistMatch {
  card: CatalogCard;
  normalizedName: string;
}

interface ExplicitArtistCandidate {
  start: number;
  end: number;
  card?: CatalogCard;
}

/**
 * Render catalog-aware artist highlights for already-parsed metadata. The catalog
 * is the only source of names: image metadata itself remains catalog-agnostic.
 */
export class MetadataArtistHighlighter {
  private readonly matchesByKey = new Map<string, ArtistMatch>();
  private readonly matcher: RegExp | null;
  private readonly imageResolver: (card: CatalogCard) => string;

  constructor(cards: readonly CatalogCard[], imageResolver: (card: CatalogCard) => string = card => `./catalog/${card.image}`) {
    this.imageResolver = imageResolver;
    const matches = cards
      .map(card => ({ card, normalizedName: normalizeName(card.tag) }))
      .filter((item): item is ArtistMatch => Boolean(item.normalizedName))
      .sort((left, right) => right.normalizedName.length - left.normalizedName.length);

    for (const match of matches) {
      const key = artistKey(match.normalizedName);
      if (!this.matchesByKey.has(key)) this.matchesByKey.set(key, match);
    }
    const patterns = [...this.matchesByKey.values()].map(match => namePattern(match.normalizedName));
    this.matcher = patterns.length ? new RegExp(`(?<!${WORD_CHARACTER})(?:${patterns.join('|')})(?!${WORD_CHARACTER})`, 'gu') : null;
  }

  render(prompt: string): string {
    if (!prompt) return '';
    const normalized = normalizePrompt(prompt);
    const explicitCandidates = this.explicitCandidates(prompt, normalized);
    const matches: Array<{ start: number; end: number; markup: string }> = explicitCandidates.map(candidate => ({
      start: candidate.start,
      end: candidate.end,
      markup: candidate.card
        ? this.highlight(prompt.slice(candidate.start, candidate.end), candidate.card)
        : this.unknownHighlight(prompt.slice(candidate.start, candidate.end))
    }));

    if (this.matcher) {
      this.matcher.lastIndex = 0;
      for (let match = this.matcher.exec(normalized.text); match; match = this.matcher.exec(normalized.text)) {
        const start = normalized.starts[match.index];
        const end = normalized.ends[match.index + match[0].length - 1];
        const artist = this.matchesByKey.get(artistKey(match[0]));
        if (start === undefined || end === undefined || !artist || explicitCandidates.some(candidate => start < candidate.end && end > candidate.start)) continue;
        matches.push({ start, end, markup: this.highlight(prompt.slice(start, end), artist.card) });
      }
    }

    matches.sort((left, right) => left.start - right.start || right.end - left.end);
    let cursor = 0;
    let markup = '';
    for (const match of matches) {
      if (match.start < cursor) continue;
      markup += escapeMetadataHtml(prompt.slice(cursor, match.start));
      markup += match.markup;
      cursor = match.end;
    }
    return markup + escapeMetadataHtml(prompt.slice(cursor));
  }

  private explicitCandidates(prompt: string, normalized: NormalizedPrompt): ExplicitArtistCandidate[] {
    const candidates: ExplicitArtistCandidate[] = [];
    const prefix = new RegExp(`(?<!${WORD_CHARACTER})artist\\s*:\\s*`, 'gu');
    for (let match = prefix.exec(normalized.text); match; match = prefix.exec(normalized.text)) {
      const normalizedStart = match.index + match[0].length;
      const remainder = normalized.text.slice(normalizedStart);
      const terminator = /::|[,\n}\]]/u.exec(remainder);
      const normalizedEnd = terminator ? normalizedStart + terminator.index : normalized.text.length;
      const candidate = normalized.text.slice(normalizedStart, normalizedEnd);
      const leadingWhitespace = candidate.length - candidate.trimStart().length;
      const trailingWhitespace = candidate.length - candidate.trimEnd().length;
      const trimmedStart = normalizedStart + leadingWhitespace;
      const trimmedEnd = normalizedEnd - trailingWhitespace;
      const start = normalized.starts[trimmedStart];
      const end = normalized.ends[trimmedEnd - 1];
      if (start === undefined || end === undefined || start >= end) continue;
      candidates.push({ start, end, card: this.matchesByKey.get(artistKey(prompt.slice(start, end)))?.card });
    }
    return candidates;
  }

  private highlight(text: string, card: CatalogCard): string {
    const image = escapeMetadataHtml(this.imageResolver(card));
    const previewTag = decodeCatalogEntities(card.tag);
    const previewPrompt = `artist: ${previewTag}`;
    return `<span class="metadata-artist-highlight" tabindex="0" aria-label="Show artist card preview for ${escapeMetadataHtml(previewTag)}" data-artist-preview-kind="known" data-artist-preview-image="${image}" data-artist-preview-tag="${escapeMetadataHtml(previewTag)}" data-artist-preview-prompt="${escapeMetadataHtml(previewPrompt)}">${escapeMetadataHtml(text)}</span>`;
  }

  private unknownHighlight(text: string): string {
    const message = 'This artist is not in the local catalog, so a preview is unavailable. You can test it directly on the NovelAI website.';
    return `<span class="metadata-artist-highlight unknown" tabindex="0" aria-label="Artist preview unavailable for ${escapeMetadataHtml(text)}" data-artist-preview-kind="message" data-artist-preview-tag="${escapeMetadataHtml(text)}" data-artist-preview-message="${escapeMetadataHtml(message)}">${escapeMetadataHtml(text)}</span>`;
  }
}

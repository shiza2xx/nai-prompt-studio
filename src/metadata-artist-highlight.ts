import type { CatalogCard } from './types';

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

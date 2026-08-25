import type { GuideExample } from './types';

export type ConstructorZone = 'frame' | 'scene' | 'render';

export interface ConstructorCard extends GuideExample {
  id: string;
  zone: ConstructorZone;
  kind?: 'tag' | 'quality' | 'preset';
  group?: string;
  description?: string;
  tags?: string[];
}

export const CONSTRUCTOR_SECTIONS: Record<ConstructorZone, readonly string[]> = {
  frame: ['5.1.', '5.2.', '5.3.', '5.4.'],
  scene: ['4.5.', '4.8.'],
  render: ['4.1.', '4.2.', '4.3.', '4.4.', '4.6.', '4.7.']
};

const QUALITY_TAGS = ['solo artist', '-5.3::artist collaboration::', 'year 2024', 'year 2023', 'year 2022', 'year 2021', '-1::clean text::', '-1::flat color::', 'natural', 'incredibly absurdres', 'very aesthetic', 'highres', 'masterpiece', 'best quality', 'amazing quality', '-3::simple illustration::', 'best illustration', 'novel illustration'];
const QUALITY_CARD_TAGS = ['masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'best illustration', 'novel illustration', 'highres', 'absurdres', 'incredibly absurdres', 'ultra-detailed', 'intricate details', 'solo artist', 'artist collaboration'];

export function normalizePromptToken(value: string): string {
  return value.trim().replace(/^\s+|\s+$/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * A custom card stores one display string. Commas are component separators
 * only when the card is applied to a prompt, never record separators.
 * Empty components and canonical duplicates are ignored for application while
 * the original card string remains available for display and preview.
 */
export function splitTagGroup(value: string | readonly string[]): string[] {
  const source: readonly string[] = typeof value === 'string' ? value.split(',') : value;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of source) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = canonicalPromptTag(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/** Split a comma prompt while preserving all non-comma text around each token. */
export function promptTokens(prompt: string): string[] {
  return prompt.split(',').map(value => value.trim()).filter(Boolean);
}

function unwrapWeight(token: string): string {
  return token.trim().replace(/^[-+]?\d+(?:\.\d+)?\s*::\s*/, '').replace(/\s*::\s*$/, '').trim();
}

function canonicalPromptTag(value: string): string {
  return normalizePromptToken(unwrapWeight(value));
}

export function tokenMatches(token: string, tag: string): boolean {
  return canonicalPromptTag(token) === canonicalPromptTag(tag);
}

export function hasPromptTag(prompt: string, tag: string): boolean {
  return promptTokens(prompt).some(token => tokenMatches(token, tag));
}

/** Stable identity for a group, independent of order, whitespace, case, or weight. */
export function canonicalGroupIdentity(value: string | readonly string[]): string {
  return splitTagGroup(value).map(canonicalPromptTag).sort().join('|');
}

export const customTagGroupComponents = splitTagGroup;
export const canonicalCustomTagGroup = canonicalGroupIdentity;

export function canonicalCustomTagIdentity(zone: ConstructorZone, value: string | readonly string[]): string {
  return `${zone}:${canonicalGroupIdentity(value)}`;
}

export function constructorCardTags(card: Pick<ConstructorCard, 'tag' | 'tags'>): string[] {
  return splitTagGroup(card.tags?.length ? card.tags : [card.tag]);
}

export function hasPromptTagGroup(prompt: string, group: string | readonly string[]): boolean {
  const tags = splitTagGroup(group);
  return tags.length > 0 && tags.every(tag => hasPromptTag(prompt, tag));
}

/** Toggle a group atomically while retaining unrelated prompt tokens. */
export function togglePromptTagGroup(prompt: string, group: string | readonly string[]): string {
  const tags = splitTagGroup(group);
  if (!tags.length) return prompt.trim();
  const allSelected = tags.every(tag => hasPromptTag(prompt, tag));
  let value = prompt;
  for (const tag of tags) {
    value = allSelected ? togglePromptTag(value, tag) : (!hasPromptTag(value, tag) ? togglePromptTag(value, tag) : value);
  }
  return value;
}

/** Toggle one exact normalized tag without touching neighboring prompt tokens. */
export function togglePromptTag(prompt: string, tag: string): string {
  const source = prompt.trim();
  const tokens = promptTokens(source);
  const hadMatch = tokens.some(token => tokenMatches(token, tag));
  if (hadMatch) {
    // One click removes every exact normalized occurrence, including weighted,
    // case, underscore and whitespace variants. Unrelated tokens are retained
    // in their original order and contents.
    return tokens.filter(token => !tokenMatches(token, tag)).join(', ');
  }
  tokens.push(tag.trim());
  return tokens.join(', ');
}

export function qualityPresetTags(): string[] { return [...QUALITY_TAGS]; }

export function qualityPresetLabel(): string { return 'Recommended Quality'; }

export function isGuideSectionInZone(section: string, zone: ConstructorZone): boolean {
  return CONSTRUCTOR_SECTIONS[zone].some(prefix => section.startsWith(prefix));
}

export function classifyGuideEntries(entries: GuideExample[]): ConstructorCard[] {
  const cards: ConstructorCard[] = [];
  for (const entry of entries) {
    const zone = (Object.keys(CONSTRUCTOR_SECTIONS) as ConstructorZone[]).find(item => isGuideSectionInZone(entry.section, item));
    if (!zone) continue;
    cards.push({
      ...entry,
      id: `guide-${zone}-${normalizePromptToken(entry.section)}-${normalizePromptToken(entry.tag)}`.replace(/[^a-z0-9]+/g, '-'),
      zone,
      kind: 'tag',
      group: entry.section,
      description: entry.description ?? ''
    });
  }
  for (const tag of QUALITY_CARD_TAGS) cards.push({ id: `quality-${normalizePromptToken(tag).replace(/[^a-z0-9]+/g, '-')}`, tag, section: '6.1. Quality tags', image: '', zone: 'render', kind: 'quality', group: 'Quality tags', description: 'Positive quality tag from the guide.' });
  const preset: ConstructorCard = {
    id: 'quality-recommended-preset', tag: qualityPresetLabel(), section: '6. Quality', image: '', zone: 'render', kind: 'preset', group: 'Quality', tags: qualityPresetTags(), description: 'A balanced positive quality group from the guide.'
  };
  cards.push(preset);
  return cards;
}

export function mergeConstructorCards(builtIns: ConstructorCard[], custom: ConstructorCard[]): ConstructorCard[] {
  const customKeys = new Set(custom.map(card => canonicalCustomTagIdentity(card.zone, constructorCardTags(card))));
  return [...builtIns.filter(card => !customKeys.has(canonicalCustomTagIdentity(card.zone, constructorCardTags(card)))), ...custom];
}

export function guideVisualCount(entries: GuideExample[]): Record<ConstructorZone, number> {
  const result: Record<ConstructorZone, number> = { frame: 0, scene: 0, render: 0 };
  for (const entry of entries) {
    const zone = (Object.keys(CONSTRUCTOR_SECTIONS) as ConstructorZone[]).find(item => isGuideSectionInZone(entry.section, item));
    if (zone) result[zone] += 1;
  }
  return result;
}

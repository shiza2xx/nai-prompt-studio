import type { BasePrompt, Character, WeightedTag } from './types';

export function serializeTag({ tag, weight }: WeightedTag): string | null {
  if (!tag.trim()) return null;
  // V5 artist tags are always explicitly weighted. Keeping one decimal place
  // makes the serialized form stable for clipboard output and migrations.
  const value = Math.max(0.1, Math.min(2, Math.round(weight * 10) / 10)).toFixed(1);
  const text = tag.trim();
  // NovelAI treats a digit immediately before the closing separator as part of
  // the weight syntax. Preserve an intentional separator for digit-ending tags.
  return `${value}::${text}${/[0-9]$/.test(text) ? ' ' : ''}::`;
}

function clean(part: string): string { return part.trim().replace(/^,|,$/g, '').trim(); }

export function buildBasePrompt(base: BasePrompt): string {
  return [base.frame, ...base.artists.map(serializeTag).filter((tag): tag is string => Boolean(tag)), base.setting, base.render]
    .map(clean).filter(Boolean).join(', ');
}

export function buildArtistsPrompt(artists: WeightedTag[]): string {
  return artists.map(serializeTag).filter((tag): tag is string => Boolean(tag)).join(', ');
}

export function buildCharacterPrompt(character: Character): string {
  return clean(character.prompt);
}

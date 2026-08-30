/**
 * Build the V5 artist snapshot from NAX's rendered gallery pages.
 *
 * NAX exposes positive pages as `?gallery=...&page=N`; this updater discovers
 * those page numbers from the first response, parses only the gallery card
 * markup, downloads validated WebP files into a staging directory, and swaps
 * the catalog and artist directory only after the whole stage succeeds.
 */
import { closeSync, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GALLERY = 'danbooru-artist-tags-2-v5';
export const GALLERY_URL = `https://nax.moe/?gallery=${GALLERY}`;
export const EXPECTED_CARD_COUNT = 4198;
const root = resolve(import.meta.dirname, '..');
const GALLERY_PAGE_CONCURRENCY = 4;
const IMAGE_CONCURRENCY = 6;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (entity, hexadecimal, decimal) => {
      const codePoint = Number.parseInt(hexadecimal || decimal, hexadecimal ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
      try { return String.fromCodePoint(codePoint); } catch { return entity; }
    })
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function normalizeTag(value) { return decodeHtml(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function normalizeImageUrl(value) {
  const url = decodeHtml(value).trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'cdn.zele.st' || !parsed.pathname.startsWith(`/data/NAX/Images/${GALLERY}/`) || !parsed.pathname.endsWith('.webp')) return null;
    return parsed.href;
  } catch { return null; }
}

/** Parse one NAX HTML page. Exported for deterministic fixture tests. */
export function parseGalleryPage(html) {
  const pages = [...html.matchAll(/data-page="(\d+)"/g)].map(match => Number(match[1])).filter(Number.isInteger);
  const cards = [];
  const seen = new Set();
  for (const panel of html.matchAll(/<figure[^>]*class="[^"]*imagePanel[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const block = panel[1];
    const image = normalizeImageUrl(block.match(/<img[^>]+src="([^"]+)"/i)?.[1] ?? '');
    const tag = normalizeTag(block.match(/<figurecaption[^>]*class="[^"]*imageText[^"]*"[^>]*>([\s\S]*?)<\/figurecaption>/i)?.[1] ?? '');
    if (!image || !tag) continue;
    const dedupe = image;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    cards.push({ tag, image, score: Number(block.match(/data-score="(-?\d+)"/i)?.[1] ?? 0) });
  }
  return { pages: [...new Set(pages)].sort((a, b) => a - b), cards };
}

export function isWebp(buffer) {
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

async function fetchPage(page, fetchImpl) {
  const url = `${GALLERY_URL}&page=${page}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`NAX page ${page}: HTTP ${response.status}`);
  return response.text();
}

export async function discoverCards(fetchImpl = fetch) {
  const first = await fetchPage(1, fetchImpl);
  const firstParsed = parseGalleryPage(first);
  const pages = firstParsed.pages.length ? firstParsed.pages : [1];
  const remaining = pages.filter(page => page !== 1);
  const results = new Array(remaining.length);
  let nextPage = 0;
  const worker = async () => {
    while (true) {
      const index = nextPage++;
      if (index >= remaining.length) return;
      results[index] = parseGalleryPage(await fetchPage(remaining[index], fetchImpl));
    }
  };
  await Promise.all(Array.from({ length: Math.min(GALLERY_PAGE_CONCURRENCY, remaining.length) }, worker));
  const allCards = [firstParsed, ...results].flatMap(result => result.cards);
  const seen = new Set();
  return allCards.filter(card => { const key = card.image; if (seen.has(key)) return false; seen.add(key); return true; });
}

function loadDanbooruTags(existing) {
  if (Array.isArray(existing?.danbooruTags)) return existing.danbooruTags;
  const csv = join(root, '.nax-cache', 'danbooru_tags.csv');
  if (!existsSync(csv)) return [];
  return readFileSync(csv, 'utf8').split(/\r?\n/).slice(1).flatMap(line => {
    const match = line.match(/^([^,]+),(\d+),(\d+),/);
    return match ? [{ tag: match[1].replaceAll('_', ' '), category: Number(match[2]), count: Number(match[3]) }] : [];
  });
}

export function stableCatalogId(card) {
  const slug = String(card.tag ?? 'artist').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48) || 'artist';
  let hash = 2166136261;
  for (const character of String(card.sourceUrl ?? card.image ?? '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `artist-v5-${slug}-${(hash >>> 0).toString(36)}`;
}

export function stableAssetFilename(card) {
  return `${stableCatalogId(card)}.webp`;
}

export function makeCatalog(cards, existing) {
  const existingBySource = new Map();
  for (const previous of (existing?.artists ?? [])) {
    const source = String(previous?.sourceUrl ?? '');
    if (source && !existingBySource.has(source)) existingBySource.set(source, previous);
  }
  const artists = cards.map(card => {
    const sourceUrl = String(card.sourceUrl ?? card.image ?? '');
    const previous = existingBySource.get(sourceUrl);
    const catalogId = String(previous?.catalogId ?? previous?.id ?? stableCatalogId({ ...card, sourceUrl }));
    const id = String(previous?.id ?? catalogId);
    const priorImage = String(previous?.image ?? '');
    const priorFilename = priorImage.split(/[\\/]/).pop();
    const image = priorFilename && /^[a-zA-Z0-9._-]+\.webp$/i.test(priorFilename)
      ? `cards/artist/${GALLERY}/${priorFilename}`
      : `cards/artist/${GALLERY}/${stableAssetFilename({ ...card, sourceUrl })}`;
    return { id, catalogId, tag: card.tag, gallery: GALLERY, image, sourceUrl, score: card.score };
  });
  const danbooruTags = loadDanbooruTags(existing);
  return { version: 2, catalogId: 'nai-v5', generatedAt: new Date().toISOString(), sources: { nax: { url: GALLERY_URL, license: 'CC BY 4.0', gallery: GALLERY }, danbooru: { url: 'https://huggingface.co/datasets/SpadeA/danbooru-tag-csv', license: 'MIT' } }, artists, characters: existing?.characters ?? [], tags: [...new Set(danbooruTags.filter(item => item.category !== 1).map(item => item.tag))], danbooruTags };
}

function loadStageState(stageStateFile) {
  try {
    const value = JSON.parse(readFileSync(stageStateFile, 'utf8'));
    return value && typeof value === 'object' && value.entries && typeof value.entries === 'object' ? value : { entries: {} };
  } catch { return { entries: {} }; }
}

function saveStageState(stageStateFile, state) {
  if (stageStateFile) writeFileSync(stageStateFile, JSON.stringify(state, null, 2));
}

/** Seed a stable stage from validated live assets before touching the network. */
export function seedStageFromLive(cards, existingArtists, stageArtistDir, liveArtistDir, stageStateFile = null) {
  let reused = 0;
  const state = loadStageState(stageStateFile);
  state.entries ??= {};
  // Preserve Array.find's former first-match behavior without scanning the
  // whole previous catalog for every incoming card.
  const existingBySource = new Map();
  for (const previous of existingArtists) {
    const source = String(previous?.sourceUrl ?? '');
    if (source && !existingBySource.has(source)) existingBySource.set(source, previous);
  }
  for (const card of cards) {
    const cardImage = String(card.image ?? '');
    const filename = /^https?:\/\//i.test(cardImage)
      ? stableAssetFilename(card)
      : cardImage.split(/[\\/]/).pop();
    if (!filename || !/^[a-zA-Z0-9._-]+\.webp$/i.test(filename)) continue;
    const sourceUrl = String(card.sourceUrl ?? card.image ?? '');
    const catalogId = String(card.catalogId ?? card.id ?? '');
    const target = join(stageArtistDir, filename);
    const staged = state.entries[filename];
    if (existsSync(target) && staged?.sourceUrl === sourceUrl && staged?.catalogId === catalogId) {
      try { if (validWebpPart(target)) { reused += 1; continue; } } catch { /* redownload below */ }
    }
    const previous = existingBySource.get(sourceUrl);
    const candidates = [filename, String(previous?.image ?? '').split(/[\\/]/).pop()].filter(Boolean);
    let copied = false;
    for (const candidate of candidates) {
      const source = join(liveArtistDir, candidate);
      if (!existsSync(source)) continue;
      try {
        if (!validWebpPart(source)) continue;
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        state.entries[filename] = { sourceUrl, catalogId };
        reused += 1;
        copied = true;
        break;
      } catch { /* the downloader will report a useful source error */ }
    }
    if (!copied) delete state.entries[filename];
  }
  saveStageState(stageStateFile, state);
  return reused;
}

async function downloadCards(cards, stageRoot, fetchImpl) {
  const statePath = join(stageRoot, 'v5-download-state.json');
  const targetRoot = join(stageRoot, 'catalog');
  let prior = {};
  try { prior = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run */ }
  const state = { completed: 0, total: cards.length, downloaded: 0, reused: 0, failed: [], entries: prior.entries && typeof prior.entries === 'object' ? prior.entries : {}, updatedAt: new Date().toISOString() };
  let cursor = 0;
  const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= cards.length) return;
      const card = cards[index];
      const target = join(targetRoot, card.image);
      const part = `${target}.part`;
      mkdirSync(dirname(target), { recursive: true });
      let complete = false;
      const filename = String(card.image).split(/[\\/]/).pop();
      const sourceUrl = String(card.sourceUrl ?? '');
      const catalogId = String(card.catalogId ?? card.id ?? '');
      const staged = state.entries[filename];
      if (existsSync(target) && staged?.sourceUrl === sourceUrl && staged?.catalogId === catalogId) {
        try { complete = validWebpPart(target); } catch { complete = false; }
      }
      if (complete) state.reused += 1;
      if (!complete) {
        for (let attempt = 1; attempt <= 4 && !complete; attempt += 1) {
          try {
            const response = await fetchImpl(card.sourceUrl, { signal: AbortSignal.timeout(45_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const contentLength = Number(response.headers?.get?.('content-length') ?? response.headers?.['content-length']);
            if (Number.isFinite(contentLength) && (contentLength < 12 || contentLength > MAX_IMAGE_BYTES)) throw new Error('response exceeds WebP size limit');
            await streamWebpPart(response, part);
            if (!validWebpPart(part)) throw new Error('response is not WebP');
            renameSync(part, target);
            state.downloaded += 1;
            state.entries[filename] = { sourceUrl, catalogId };
            complete = true;
          } catch (error) {
            try { unlinkSync(part); } catch { /* no partial file */ }
            if (attempt === 4) state.failed.push({ id: card.id, url: card.sourceUrl, error: String(error) });
            else await new Promise(resolveWait => setTimeout(resolveWait, attempt * 700));
          }
        }
      }
      if (!complete) delete state.entries[filename];
      state.completed += 1;
      if (state.completed % 25 === 0 || state.completed === state.total) saveState();
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, cards.length) }, worker));
  saveState();
  if (state.failed.length) throw new Error(`V5 card validation failed for ${state.failed.length} card(s)`);
  return state;
}

async function streamWebpPart(response, part) {
  const output = createWriteStream(part, { flags: 'w' });
  let bytes = 0;
  const write = async value => {
    const chunk = Buffer.from(value);
    bytes += chunk.length;
    if (bytes > MAX_IMAGE_BYTES) throw new Error('response exceeds WebP size limit');
    if (!output.write(chunk)) await once(output, 'drain');
  };
  try {
    const body = response.body;
    if (body?.getReader) {
      const reader = body.getReader();
      try { while (true) { const item = await reader.read(); if (item.done) break; await write(item.value); } } finally { reader.releaseLock?.(); }
    } else if (body?.[Symbol.asyncIterator]) {
      for await (const chunk of body) await write(chunk);
    } else {
      await write(await response.arrayBuffer());
    }
    const finished = once(output, 'finish'); output.end(); await finished;
  } catch (error) { output.destroy(); try { unlinkSync(part); } catch {} throw error; }
}

function validWebpPart(file) {
  let descriptor;
  try { descriptor = openSync(file, 'r'); const header = Buffer.alloc(12); return readSync(descriptor, header, 0, 12, 0) === 12 && isWebp(header); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function moveIntoPlace(source, target, backups) {
  if (!existsSync(source)) throw new Error(`Missing staged path: ${source}`);
  const backup = `${target}.previous-${process.pid}-${Date.now()}`;
  if (existsSync(target)) renameSync(target, backup);
  try {
    renameSync(source, target);
    backups.push({ backup, target });
  } catch (error) {
    if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    throw error;
  }
}

/** Atomically replace the catalog and artist cards, restoring both on failure. */
export function commitSnapshot({ stageCatalogPath, stageArtistDir, catalogPath, liveArtistDir }) {
  const backups = [];
  try {
    moveIntoPlace(stageCatalogPath, catalogPath, backups);
    moveIntoPlace(stageArtistDir, liveArtistDir, backups);
  } catch (error) {
    for (const { backup, target } of backups.reverse()) {
      try { if (existsSync(target)) rmSync(target, { recursive: true, force: true }); } catch { /* best effort restore */ }
      try { if (existsSync(backup)) renameSync(backup, target); } catch { /* leave backup for recovery */ }
    }
    throw error;
  }
  // Keep no stale live snapshot copies after a successful commit.
  for (const { backup } of backups) { try { rmSync(backup, { recursive: true, force: true }); } catch { /* recoverable backup */ } }
}

export async function updateSnapshot({ fetchImpl = fetch, cards: suppliedCards } = {}) {
  const cards = suppliedCards ?? await discoverCards(fetchImpl);
  const catalogPath = join(root, 'public', 'catalog', 'catalog.json');
  const existing = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : { characters: [], danbooruTags: [] };
  if (!suppliedCards && cards.length !== EXPECTED_CARD_COUNT) throw new Error(`NAX gallery discovery expected ${EXPECTED_CARD_COUNT} cards, found ${cards.length}`);
  if (!suppliedCards) {
    const discoveredSources = new Set(cards.map(card => String(card.sourceUrl ?? card.image ?? '')));
    const removed = (existing.artists ?? []).filter(card => {
      const source = String(card?.sourceUrl ?? '');
      return source && !discoveredSources.has(source);
    });
    if (removed.length) throw new Error(`NAX gallery discovery would remove ${removed.length} existing card(s)`);
  }
  const output = makeCatalog(cards, existing);
  // A stable stage makes interrupted runs resumable: valid `.webp` files are
  // retained and skipped on the next invocation, while the live snapshot is
  // never touched until commitSnapshot succeeds.
  const stageRoot = join(root, '.nax-cache', 'v5-stage');
  const stageCatalogPath = join(stageRoot, 'catalog.json');
  const stageArtistDir = join(stageRoot, 'catalog', 'cards', 'artist', GALLERY);
  const liveArtistDir = join(root, 'public', 'catalog', 'cards', 'artist', GALLERY);
  mkdirSync(stageRoot, { recursive: true });
  if (existsSync(stageArtistDir)) {
    const expected = new Set(output.artists.map(card => card.image.split('/').pop()));
    for (const file of readdirSync(stageArtistDir)) if (!expected.has(file)) rmSync(join(stageArtistDir, file), { force: true });
  }
  const seeded = seedStageFromLive(output.artists, existing.artists ?? [], stageArtistDir, liveArtistDir, join(stageRoot, 'v5-download-state.json'));
  writeFileSync(stageCatalogPath, JSON.stringify(output));
  try {
    await downloadCards(output.artists, stageRoot, fetchImpl);
    const state = existsSync(join(stageRoot, 'v5-download-state.json'))
      ? JSON.parse(readFileSync(join(stageRoot, 'v5-download-state.json'), 'utf8'))
      : { downloaded: 0, reused: seeded };
    output.update = {
      old: Array.isArray(existing.artists) ? existing.artists.length : 0,
      new: Math.max(0, output.artists.length - (Array.isArray(existing.artists) ? existing.artists.length : 0)),
      reused: Math.max(seeded, Number(state.reused) || 0),
      downloaded: Number(state.downloaded) || 0
    };
    writeFileSync(stageCatalogPath, JSON.stringify(output));
    commitSnapshot({ stageCatalogPath, stageArtistDir, catalogPath, liveArtistDir });
  } catch (error) {
    // The old public catalog remains untouched; keep the stage for diagnosis.
    throw error;
  } finally {
    if (!existsSync(stageCatalogPath)) { try { rmSync(stageRoot, { recursive: true, force: true }); } catch { /* best effort cleanup */ } }
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Discovering positive pages from ${GALLERY_URL}...`);
  const output = await updateSnapshot();
  console.log(`Wrote ${output.artists.length} V5 cards and preserved ${output.characters.length} character cards; old ${output.update?.old ?? 0}, new ${output.update?.new ?? 0}, reused ${output.update?.reused ?? 0}, downloaded ${output.update?.downloaded ?? 0}.`);
}

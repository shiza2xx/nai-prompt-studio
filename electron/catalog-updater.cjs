const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GALLERY = 'danbooru-artist-tags-2-v5';
const GALLERY_URL = `https://nax.moe/?gallery=${GALLERY}`;
const CDN_PREFIX = `https://cdn.zele.st/data/NAX/Images/${GALLERY}/`;

function decodeHtml(value) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function normalizeTag(value) { return decodeHtml(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function normalizeImageUrl(value) {
  const raw = decodeHtml(value).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.zele.st' || !url.pathname.startsWith(`/data/NAX/Images/${GALLERY}/`) || !url.pathname.endsWith('.webp')) return null;
    return raw;
  } catch { return null; }
}
function parseGalleryPage(html) {
  const pages = [...String(html).matchAll(/data-page="(\d+)"/g)].map(m => Number(m[1])).filter(Number.isInteger);
  const cards = [];
  const seen = new Set();
  for (const panel of String(html).matchAll(/<figure[^>]*class="[^"]*imagePanel[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi)) {
    const block = panel[1];
    const image = normalizeImageUrl(block.match(/<img[^>]+src="([^"]+)"/i)?.[1]);
    const tag = normalizeTag(block.match(/<figurecaption[^>]*class="[^"]*imageText[^"]*"[^>]*>([\s\S]*?)<\/figurecaption>/i)?.[1]);
    if (!image || !tag) continue;
    // Keep the raw URL as the identity.  Lowercasing or decoding here would
    // merge distinct CDN keys (notably URLs containing %2520).
    const key = image;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ tag, sourceUrl: image, score: Number(block.match(/data-score="(-?\d+)"/i)?.[1] || 0) });
  }
  return { pages: [...new Set(pages)].sort((a, b) => a - b), cards };
}
function isWebp(buffer) { return Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'; }
function stableCatalogId(card) {
  const slug = String(card.tag || 'artist').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 48) || 'artist';
  const hash = crypto.createHash('sha1').update(String(card.sourceUrl || '')).digest('hex').slice(0, 10);
  return `artist-v5-${slug}-${parseInt(hash.slice(0, 8), 16).toString(36)}`;
}
function safeFilename(id) { return `${id}.webp`; }
function contained(base, relative) {
  const root = path.resolve(base);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Catalog asset escaped its profile directory');
  return target;
}
function containedCatalogAsset(base, relative) {
  const target = contained(base, relative);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Catalog asset must be a regular file');
    const baseReal = fs.realpathSync(base);
    const targetReal = fs.realpathSync(target);
    if (targetReal !== baseReal && !targetReal.startsWith(baseReal + path.sep)) throw new Error('Catalog asset redirected outside its generation');
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  return target;
}
function validGeneration(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value); }
function validCardAsset(relative) {
  return typeof relative === 'string' && new RegExp(`^cards/artist/${GALLERY}/[a-zA-Z0-9._-]+\\.webp$`).test(relative);
}
function catalogAssetFromProtocolUrl(value) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'nai-catalog:') throw new Error('Invalid runtime catalog protocol');
  const pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  // Electron treats the first segment of a standard custom-scheme URL as its
  // hostname. New URLs use a fixed "asset" host; retain the old "cards" form
  // so already-rendered cards recover without another catalog download.
  const asset = parsed.hostname === 'asset'
    ? pathname
    : parsed.hostname === 'cards'
      ? `cards${pathname ? `/${pathname}` : ''}`
      : '';
  if (!validCardAsset(asset)) throw new Error('Invalid runtime catalog card asset');
  return asset;
}
function activeGeneration(catalogDir) {
  const pointerPath = path.join(catalogDir, 'active.json');
  try {
    const pointerStat = fs.lstatSync(pointerPath);
    if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) throw new Error('Active catalog pointer must be a regular file');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  let pointer;
  try { pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8')); }
  catch { throw new Error('Invalid active catalog pointer: expected JSON'); }
  if (!pointer || typeof pointer !== 'object' || !validGeneration(pointer.generation)) throw new Error('Invalid active catalog pointer generation');
  const directory = contained(catalogDir, path.join('generations', pointer.generation));
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Active catalog generation must be a real directory');
    const rootReal = fs.realpathSync(catalogDir);
    const generationReal = fs.realpathSync(directory);
    if (generationReal !== rootReal && !generationReal.startsWith(rootReal + path.sep)) throw new Error('Active catalog generation escaped its catalog directory');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Invalid active catalog generation directory');
    throw error;
  }
  return { generation: pointer.generation, directory };
}
function resolveActiveCatalogAsset(catalogDir, relative) {
  if (!validCardAsset(relative)) throw new Error('Invalid runtime catalog card asset');
  const active = activeGeneration(catalogDir);
  if (!active) throw new Error('No active runtime catalog generation');
  return containedCatalogAsset(active.directory, relative);
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function mergedCatalog(embedded, overlay) {
  if (!overlay || !Array.isArray(overlay.artists)) return embedded;
  const byId = new Map((embedded.artists || []).map(card => [card.catalogId || card.id, card]));
  for (const card of overlay.artists) byId.set(card.catalogId || card.id, card);
  return { ...embedded, ...overlay, artists: [...byId.values()], characters: embedded.characters || [], tags: overlay.tags || embedded.tags || [] };
}
function loadCatalog({ embeddedPath, catalogDir }) {
  const embedded = readJson(embeddedPath, { version: 2, artists: [], characters: [], tags: [] });
  const active = activeGeneration(catalogDir);
  let overlay = null;
  if (active) {
    const overlayPath = contained(active.directory, 'catalog.json');
    try { overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8')); }
    catch { throw new Error('Invalid active catalog generation catalog'); }
    if (!overlay || typeof overlay !== 'object' || !Array.isArray(overlay.artists)) throw new Error('Invalid active catalog generation catalog');
  }
  return mergedCatalog(embedded, overlay);
}
async function discoverCards(fetchImpl = fetch, signal, progress = () => {}) {
  const get = async page => {
    const url = `${GALLERY_URL}&page=${page}`;
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`NAX page ${page}: HTTP ${response.status}`);
    const final = response.url || url;
    const parsed = new URL(final);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'nax.moe' || parsed.searchParams.get('gallery') !== GALLERY) throw new Error('NAX page redirect is outside the exact V5 gallery');
    return response.text();
  };
  const first = parseGalleryPage(await get(1));
  const pages = first.pages.length ? first.pages : [1];
  progress({ phase: 'discovering', completed: 1, total: pages.length });
  const rest = await Promise.all(pages.filter(page => page !== 1).map(async page => parseGalleryPage(await get(page))));
  const cards = [first, ...rest].flatMap(result => result.cards);
  const seen = new Set();
  const unique = cards.filter(card => { const key = card.sourceUrl; if (seen.has(key)) return false; seen.add(key); return true; });
  progress({ phase: 'discovered', completed: pages.length, total: pages.length, message: `${unique.length} V5 cards found` });
  return unique;
}
function assertNotCancelled(signal) { if (signal?.aborted) throw new Error('Update cancelled'); }
function validateCardResponse(response, expectedUrl) {
  if (!response.ok) throw new Error(`Card request failed: HTTP ${response.status}`);
  const final = response.url || expectedUrl;
  const normalized = normalizeImageUrl(final);
  if (!normalized || final !== expectedUrl) throw new Error('Card redirect or URL is outside the V5 CDN allowlist');
}
async function runUpdate({ catalogDir, embeddedPath, fetchImpl = fetch, signal, onProgress = () => {} }) {
  const embedded = readJson(embeddedPath, { version: 2, artists: [], characters: [], tags: [] });
  const old = loadCatalog({ embeddedPath, catalogDir });
  const discovered = await discoverCards(fetchImpl, signal, onProgress);
  assertNotCancelled(signal);
  const existingByTag = new Map();
  for (const card of old.artists || []) {
    const key = normalizeTag(card.tag).toLocaleLowerCase();
    if (!existingByTag.has(key)) existingByTag.set(key, []);
    existingByTag.get(key).push(card);
  }
  const active = activeGeneration(catalogDir);
  const activeOverlay = active ? readJson(contained(active.directory, 'catalog.json'), null) : null;
  const runtimeArtists = new Map();
  const discoveredSources = new Set(discovered.map(card => card.sourceUrl));
  const currentRuntimeIds = new Set();
  const generation = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stage = contained(catalogDir, path.join('.staging', generation));
  const stageCards = contained(stage, path.join('cards', 'artist', GALLERY));
  fs.mkdirSync(stageCards, { recursive: true });
  let added = 0;
  let changed = 0;
  let renamed = false;

  // The overlay is a delta, not a second copy of the embedded catalog.  Seed
  // only the previous runtime delta into the new generation so its cards stay
  // usable after a subsequent update.
  try {
    for (const previous of (activeOverlay?.artists || [])) {
      if (!previous?.runtime) continue;
      const previousImage = String(previous.image || '');
      if (!discoveredSources.has(String(previous.sourceUrl || ''))) continue;
      if (!validCardAsset(previousImage)) throw new Error(`Invalid runtime catalog asset for ${previous.tag || previous.id || 'artist'}`);
      const source = resolveActiveCatalogAsset(catalogDir, previousImage);
      const destination = contained(stage, previousImage);
      if (!fs.existsSync(source) || !isWebp(fs.readFileSync(source))) throw new Error(`Runtime catalog asset is missing for ${previous.tag || previous.id || 'artist'}`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      runtimeArtists.set(previous.catalogId || previous.id, { ...previous, runtime: true });
    }

    for (let index = 0; index < discovered.length; index += 1) {
      assertNotCancelled(signal);
      const source = discovered[index];
      // Exact raw identity is authoritative.  A source URL change can only be
      // classified by the unique normalized tag fallback below.
      const exact = (old.artists || []).find(card => String(card.sourceUrl || '') === source.sourceUrl);
      const tagMatches = existingByTag.get(normalizeTag(source.tag).toLocaleLowerCase()) || [];
      const existing = exact || (tagMatches.length === 1 ? tagMatches[0] : null);
      const embeddedExact = (embedded.artists || []).find(card => String(card.sourceUrl || '') === source.sourceUrl);
      const isEmbeddedExact = Boolean(embeddedExact || (exact && !exact.runtime && exact.sourceUrl === source.sourceUrl));
      if (isEmbeddedExact) {
        const embeddedId = embeddedExact?.catalogId || embeddedExact?.id;
        const runtimeId = exact?.runtime ? (exact.catalogId || exact.id) : null;
        if (embeddedId) { runtimeArtists.delete(embeddedId); currentRuntimeIds.delete(embeddedId); }
        if (runtimeId) { runtimeArtists.delete(runtimeId); currentRuntimeIds.delete(runtimeId); }
        onProgress({ phase: 'downloading', completed: index + 1, total: discovered.length, added, changed, message: `${source.tag} already embedded` });
        continue;
      }

      const catalogId = existing?.catalogId || existing?.id || stableCatalogId(source);
      const filename = safeFilename(catalogId);
      const relative = `cards/artist/${GALLERY}/${filename}`;
      const target = contained(stage, relative);
      const sameRuntimeSource = Boolean(exact?.runtime && exact.sourceUrl === source.sourceUrl);
      let reused = false;
      if (sameRuntimeSource) {
        const seeded = runtimeArtists.get(catalogId);
        if (seeded && validCardAsset(String(seeded.image || ''))) {
          const seededPath = contained(stage, String(seeded.image));
          if (fs.existsSync(seededPath) && isWebp(fs.readFileSync(seededPath))) {
            // Keep the previous path when it is already valid.  This avoids a
            // needless fetch and preserves a stable overlay asset.
            runtimeArtists.set(catalogId, { ...seeded, tag: source.tag, score: source.score, sourceUrl: source.sourceUrl });
            currentRuntimeIds.add(catalogId);
            reused = true;
          }
        }
      }
      if (!reused) {
        const response = await fetchImpl(source.sourceUrl, { signal });
        validateCardResponse(response, source.sourceUrl);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!isWebp(bytes)) throw new Error(`Invalid WebP payload for ${source.tag}`);
        fs.writeFileSync(target, bytes);
        if (existing) changed += 1; else added += 1;
      }
      runtimeArtists.set(catalogId, { id: catalogId, catalogId, tag: source.tag, gallery: GALLERY, image: relative, sourceUrl: source.sourceUrl, score: source.score, runtime: true });
      currentRuntimeIds.add(catalogId);
      onProgress({ phase: 'downloading', completed: index + 1, total: discovered.length, added, changed, message: source.tag });
    }
    assertNotCancelled(signal);
    const artists = [...runtimeArtists.entries()].filter(([catalogId]) => currentRuntimeIds.has(catalogId)).map(([, card]) => card);
    const overlay = { version: 2, catalogId: 'nai-v5-runtime', generatedAt: new Date().toISOString(), artists, characters: [], tags: embedded.tags || [] };
    onProgress({ phase: 'validation', completed: 0, total: artists.length, added, changed, message: 'Validating staged catalog' });
    const ids = new Set();
    for (let index = 0; index < artists.length; index += 1) {
      assertNotCancelled(signal);
      const card = artists[index];
      const cardId = card.catalogId || card.id;
      if (!cardId || ids.has(cardId)) throw new Error(`Duplicate runtime catalog identity: ${cardId || 'missing id'}`);
      ids.add(cardId);
      if (!validCardAsset(card.image)) throw new Error(`Invalid runtime catalog asset for ${card.tag || cardId}`);
      const asset = containedCatalogAsset(stage, card.image);
      if (!fs.existsSync(asset) || !isWebp(fs.readFileSync(asset))) throw new Error(`Invalid staged WebP for ${card.tag || cardId}`);
      if (!normalizeImageUrl(card.sourceUrl)) throw new Error(`Invalid runtime source URL for ${card.tag || cardId}`);
      onProgress({ phase: 'validation', completed: index + 1, total: artists.length, added, changed, message: card.tag });
    }
    const stageCatalog = contained(stage, 'catalog.json');
    fs.writeFileSync(stageCatalog, JSON.stringify(overlay));
    JSON.parse(fs.readFileSync(stageCatalog, 'utf8'));
    onProgress({ phase: 'validation', completed: artists.length, total: artists.length, added, changed, message: 'Staged catalog validated' });
    assertNotCancelled(signal);
    const generationDir = contained(catalogDir, path.join('generations', generation));
    fs.mkdirSync(path.dirname(generationDir), { recursive: true });
    assertNotCancelled(signal);
    fs.renameSync(stage, generationDir);
    renamed = true;
    // Commit is intentionally short and non-cancellable.  The old pointer
    // remains active until this atomic rename succeeds.
    onProgress({ phase: 'commit', completed: 0, total: 1, added, changed, message: 'Activating catalog generation' });
    const pointerTemp = contained(catalogDir, 'active.json.tmp');
    fs.writeFileSync(pointerTemp, JSON.stringify({ generation }));
    fs.renameSync(pointerTemp, contained(catalogDir, 'active.json'));
    onProgress({ phase: 'commit', completed: 1, total: 1, added, changed, message: 'Catalog generation active' });
    onProgress({ phase: 'complete', completed: discovered.length, total: discovered.length, added, changed, message: `+${added} artists` });
    return { catalog: loadCatalog({ embeddedPath, catalogDir }), added, changed };
  } catch (error) {
    if (!renamed) {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* keep old generation active */ }
    }
    throw error;
  }
}

module.exports = { GALLERY, GALLERY_URL, CDN_PREFIX, parseGalleryPage, isWebp, stableCatalogId, loadCatalog, discoverCards, runUpdate, normalizeImageUrl, catalogAssetFromProtocolUrl, containedCatalogAsset, resolveActiveCatalogAsset };

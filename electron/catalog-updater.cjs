const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const GALLERY = 'danbooru-artist-tags-2-v5';
const GALLERY_URL = `https://nax.moe/?gallery=${GALLERY}`;
const CDN_PREFIX = `https://cdn.zele.st/data/NAX/Images/${GALLERY}/`;
const GALLERY_PAGE_CONCURRENCY = 4;
const PROGRESS_INTERVAL_MS = 100;

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
  const raw = decodeHtml(value).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.zele.st' || !url.pathname.startsWith(`/data/NAX/Images/${GALLERY}/`) || !url.pathname.endsWith('.webp')) return null;
    // Match the build updater's URL canonicalization so genuinely new cards
    // receive the same FNV-derived identity in both environments.
    return url.href;
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
    // Preserve encoded path segments in the canonical URL. Lowercasing or
    // decoding the path would merge distinct CDN keys (notably %2520).
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
  let hash = 2166136261;
  for (const character of String(card.sourceUrl ?? card.image ?? '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `artist-v5-${slug}-${(hash >>> 0).toString(36)}`;
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
function validCharacterAsset(relative) {
  return typeof relative === 'string' && /^cards\/character\/danbooru-character-tags-v4\.5\/[a-zA-Z0-9._-]+\.jpg$/.test(relative);
}
function validGuideAsset(relative) {
  return typeof relative === 'string' && /^guide\/[a-zA-Z0-9._-]+\.png$/.test(relative);
}
function validCatalogAsset(relative) { return validCardAsset(relative) || validCharacterAsset(relative) || validGuideAsset(relative); }
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
  if (!validCatalogAsset(asset)) throw new Error('Invalid runtime catalog card asset or guide asset');
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
function componentAssetDescriptor(catalogDir, relative, options = {}) {
  const { resolveComponentAssetDescriptor } = require('./catalog-components.cjs');
  return resolveComponentAssetDescriptor(catalogDir, relative, options);
}

function resolveActiveCatalogAssetDescriptor(catalogDir, relative, { embeddedPath } = {}) {
  if (!validCatalogAsset(relative)) throw new Error('Invalid runtime catalog card asset or guide asset');
  const active = activeGeneration(catalogDir);
  if (active) {
    const overlayAsset = containedCatalogAsset(active.directory, relative);
    if (fs.existsSync(overlayAsset) && (!validCardAsset(relative) || validWebpFile(overlayAsset))) return { kind: 'file', path: overlayAsset };
  }
  if (embeddedPath) {
    const looseAsset = resolveBaseCatalogAsset({ embeddedPath, catalogDir, relative });
    if (looseAsset) return looseAsset;
  }
  return componentAssetDescriptor(catalogDir, relative);
}

/**
 * Compatibility resolver. New protocol/runtime callers consume the descriptor
 * or bytes directly; this string form remains for older tests and tooling.
 */
function resolveActiveCatalogAsset(catalogDir, relative, options = {}) {
  const descriptor = resolveActiveCatalogAssetDescriptor(catalogDir, relative, options);
  return descriptor.kind === 'file' ? descriptor.path : `${descriptor.archivePath}${path.sep}${descriptor.innerPath}`;
}

async function readActiveCatalogAsset(catalogDir, relative, options = {}) {
  const descriptor = resolveActiveCatalogAssetDescriptor(catalogDir, relative, options);
  if (descriptor.kind === 'file') return fs.promises.readFile(descriptor.path);
  const { readArchiveEntryAsync } = require('./catalog-components.cjs');
  return readArchiveEntryAsync(descriptor.archivePath, descriptor.innerPath);
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function validWebpFile(file) {
  let descriptor;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    descriptor = fs.openSync(file, 'r');
    const header = Buffer.allocUnsafe(12);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return bytesRead === header.length && isWebp(header);
  } catch { return false; }
  finally { if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* best effort */ } } }
}
function validWebpBuffer(bytes) { return Buffer.isBuffer(bytes) && isWebp(bytes); }
function resolveBaseCatalogAsset({ embeddedPath, catalogDir, relative }) {
  const looseRelative = typeof relative === 'string' && relative.toLowerCase().endsWith('.webp') && !relative.includes('\\') && !relative.split('/').some(segment => segment === '.' || segment === '..');
  if (!validCatalogAsset(relative) && !looseRelative) return null;
  if (embeddedPath) {
    try {
      const loose = containedCatalogAsset(path.dirname(embeddedPath), relative);
      const requiresWebpValidation = validCardAsset(relative) || looseRelative;
      if (fs.existsSync(loose) && (!requiresWebpValidation || validWebpFile(loose))) return { kind: 'file', path: loose };
    } catch { /* packaged/component fallback below */ }
  }
  if (!validCardAsset(relative)) return null;
  try {
    // A verified component record plus a regular, packed ASAR entry is enough
    // to establish base availability. Do not extract every component image
    // while merging metadata; payload validation is reserved for the actual
    // protocol read and loose files retain their WebP signature check above.
    return componentAssetDescriptor(catalogDir, relative);
  } catch { /* missing or damaged component is not a usable base */ }
  return null;
}
function createBaseAssetResolver({ embeddedPath, catalogDir, cache = new Map() }) {
  return relative => {
    const key = String(relative || '');
    if (cache.has(key)) return cache.get(key);
    const value = resolveBaseCatalogAsset({ embeddedPath, catalogDir, relative });
    cache.set(key, value);
    return value;
  };
}
function cardId(card) { return String(card?.catalogId ?? card?.id ?? ''); }
function cardSource(card) { return String(card?.sourceUrl ?? ''); }
function overlayHasAsset(card, activeDirectory) {
  if (!activeDirectory || !validCardAsset(card?.image)) return false;
  try { return validWebpFile(contained(activeDirectory, card.image)); } catch { return false; }
}
function mergedCatalog(embedded, overlay, { catalogDir, embeddedPath, activeDirectory, baseAssets } = {}) {
  if (!overlay || !Array.isArray(overlay.artists)) return embedded;
  // Asset validation can hit disk. Cache only within this one synchronous merge
  // pass so a later update never trusts an earlier filesystem observation.
  const resolveBase = createBaseAssetResolver({ embeddedPath, catalogDir, cache: baseAssets });
  const cards = [];
  const byId = new Map();
  const bySource = new Map();
  const remove = card => {
    const index = cards.indexOf(card);
    if (index >= 0) cards.splice(index, 1);
    if (cardId(card) && byId.get(cardId(card)) === card) byId.delete(cardId(card));
    if (cardSource(card) && bySource.get(cardSource(card)) === card) bySource.delete(cardSource(card));
  };
  const add = card => {
    const id = cardId(card);
    const source = cardSource(card);
    const idMatch = id ? byId.get(id) : null;
    const sourceMatch = source ? bySource.get(source) : null;
    if (idMatch) remove(idMatch);
    if (sourceMatch && sourceMatch !== idMatch) remove(sourceMatch);
    cards.push(card);
    if (id) byId.set(id, card);
    if (source) bySource.set(source, card);
  };
  for (const card of (embedded.artists || [])) add(card);
  for (const card of overlay.artists) {
    const id = cardId(card);
    const source = cardSource(card);
    const idMatch = id ? byId.get(id) : null;
    const sourceMatch = source ? bySource.get(source) : null;
    const sameBaseIdentity = Boolean(idMatch && sourceMatch && idMatch === sourceMatch && cardId(idMatch) === id && cardSource(idMatch) === source);
    const baseAvailable = sameBaseIdentity && Boolean(resolveBase(idMatch.image));
    const ownsAsset = overlayHasAsset(card, activeDirectory);
    // An embedded card may replace a runtime card only after its bytes have
    // been resolved and validated. Metadata alone is never proof of a base.
    if (sameBaseIdentity && baseAvailable) continue;
    // If the overlay has no usable bytes but the same-source base does, keep
    // the working base card. A valid overlay wins when it owns the asset.
    if (idMatch && !ownsAsset && resolveBase(idMatch.image)) continue;
    if (sourceMatch && !ownsAsset && resolveBase(sourceMatch.image)) continue;
    add(card);
  }
  return { ...embedded, ...overlay, artists: cards, characters: embedded.characters || [], tags: overlay.tags || embedded.tags || [] };
}
function loadCatalog({ embeddedPath, catalogDir, embedded: suppliedEmbedded, baseAssets }) {
  const embedded = suppliedEmbedded ?? readJson(embeddedPath, { version: 2, artists: [], characters: [], tags: [] });
  const active = activeGeneration(catalogDir);
  let overlay = null;
  if (active) {
    const overlayPath = contained(active.directory, 'catalog.json');
    try { overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8')); }
    catch { throw new Error('Invalid active catalog generation catalog'); }
    if (!overlay || typeof overlay !== 'object' || !Array.isArray(overlay.artists)) throw new Error('Invalid active catalog generation catalog');
  }
  return mergedCatalog(embedded, overlay, { catalogDir, embeddedPath, activeDirectory: active?.directory, baseAssets: baseAssets ?? new Map() });
}
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
function createProgressReporter(onProgress) {
  let lastEmission = 0;
  let pending = null;
  let timer = null;
  const emit = event => {
    lastEmission = Date.now();
    onProgress(event);
  };
  const report = event => {
    const terminal = event.phase === 'complete' || event.phase === 'commit' || event.phase === 'discovered' || (event.phase === 'validation' && (event.completed === 0 || event.completed === event.total));
    if (terminal) {
      pending = null;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      emit(event);
      return;
    }
    pending = event;
    const wait = Math.max(0, PROGRESS_INTERVAL_MS - (Date.now() - lastEmission));
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (pending) { const next = pending; pending = null; emit(next); }
    }, wait);
  };
  report.stop = () => { if (timer !== null) clearTimeout(timer); timer = null; pending = null; };
  return report;
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
  const rest = await mapWithConcurrency(pages.filter(page => page !== 1), GALLERY_PAGE_CONCURRENCY, async page => parseGalleryPage(await get(page)));
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
  const progress = createProgressReporter(onProgress);
  const embedded = readJson(embeddedPath, { version: 2, artists: [], characters: [], tags: [] });
  // The map belongs to this update only: it avoids repeated probes of the
  // same immutable base asset while never carrying trust across operations.
  const baseAssets = new Map();
  const resolveBase = createBaseAssetResolver({ embeddedPath, catalogDir, cache: baseAssets });
  const old = loadCatalog({ embeddedPath, catalogDir, embedded, baseAssets });
  let discovered;
  try { discovered = await discoverCards(fetchImpl, signal, progress); }
  catch (error) { progress.stop(); throw error; }
  assertNotCancelled(signal);
  const existingBySource = new Map();
  for (const card of old.artists || []) {
    const source = cardSource(card);
    if (source && !existingBySource.has(source)) existingBySource.set(source, card);
  }
  const embeddedBySource = new Map();
  for (const card of embedded.artists || []) {
    const source = cardSource(card);
    if (source && !embeddedBySource.has(source)) embeddedBySource.set(source, card);
  }
  const active = activeGeneration(catalogDir);
  const activeOverlay = active ? readJson(contained(active.directory, 'catalog.json'), null) : null;
  const runtimeArtists = new Map();
  const discoveredSources = new Set(discovered.map(card => card.sourceUrl));
  const currentRuntimeIds = new Set();
  const generation = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const stage = contained(catalogDir, path.join('.staging', generation));
  const stageCards = contained(stage, path.join('cards', 'artist', GALLERY));
  let added = 0;
  let changed = 0;
  let renamed = false;

  // The overlay is a delta, not a second copy of the embedded catalog.  Seed
  // only the previous runtime delta into the new generation so its cards stay
  // usable after a subsequent update.
  try {
    await fsp.mkdir(stageCards, { recursive: true });
    for (const previous of (activeOverlay?.artists || [])) {
      if (!previous?.runtime) continue;
      const previousImage = String(previous.image || '');
      if (!discoveredSources.has(String(previous.sourceUrl || ''))) continue;
      if (!validCardAsset(previousImage)) continue;
      let source;
      try { source = resolveActiveCatalogAssetDescriptor(catalogDir, previousImage); } catch { continue; }
      const destination = contained(stage, previousImage);
      let sourceBytes;
      if (source.kind === 'file') {
        if (!validWebpFile(source.path)) continue;
      } else {
        try {
          const { readArchiveEntryAsync } = require('./catalog-components.cjs');
          sourceBytes = await readArchiveEntryAsync(source.archivePath, source.innerPath);
        } catch { continue; }
        if (!validWebpBuffer(sourceBytes)) continue;
      }
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      if (source.kind === 'file') await fsp.copyFile(source.path, destination);
      else await fsp.writeFile(destination, sourceBytes);
      runtimeArtists.set(previous.catalogId || previous.id, { ...previous, runtime: true });
    }

    for (let index = 0; index < discovered.length; index += 1) {
      assertNotCancelled(signal);
      const source = discovered[index];
      // Exact raw source URL is the only reuse identity. A changed URL is a
      // genuinely new card even when its display tag stayed the same.
      const exact = existingBySource.get(source.sourceUrl) || null;
      const embeddedExact = embeddedBySource.get(source.sourceUrl) || null;
      const embeddedId = cardId(embeddedExact);
      const runtimeId = exact?.runtime ? cardId(exact) : '';
      const embeddedBaseAvailable = embeddedExact
        ? Boolean(resolveBase(embeddedExact.image))
        : false;
      const canPruneRuntime = Boolean(embeddedExact && embeddedBaseAvailable && (!runtimeId || runtimeId === embeddedId));
      if (embeddedExact && canPruneRuntime) {
        if (embeddedId) { runtimeArtists.delete(embeddedId); currentRuntimeIds.delete(embeddedId); }
        if (runtimeId) { runtimeArtists.delete(runtimeId); currentRuntimeIds.delete(runtimeId); }
        progress({ phase: 'downloading', completed: index + 1, total: discovered.length, added, changed, message: `${source.tag} already embedded` });
        continue;
      }
      // If the embedded metadata is present but its bytes are unavailable, or
      // an older runtime identity differs, retain the runtime card and its
      // image/favorites. The seeded stage will reuse it; a missing asset is
      // repaired by the normal source download path below.
      const existing = exact;
      const catalogId = cardId(existing) || stableCatalogId(source);
      const priorImage = validCardAsset(existing?.image) ? String(existing.image) : '';
      const filename = priorImage ? priorImage.split('/').pop() : safeFilename(catalogId);
      const relative = priorImage || `cards/artist/${GALLERY}/${filename}`;
      const target = contained(stage, relative);
      const sameRuntimeSource = Boolean(exact?.runtime && cardSource(exact) === source.sourceUrl);
      let reused = false;
      if (sameRuntimeSource) {
        const seeded = runtimeArtists.get(catalogId);
        if (seeded && validCardAsset(String(seeded.image || ''))) {
          const seededPath = contained(stage, String(seeded.image));
          if (fs.existsSync(seededPath) && validWebpFile(seededPath)) {
            // Keep the previous path when it is already valid.  This avoids a
            // needless fetch and preserves a stable overlay asset.
            runtimeArtists.set(catalogId, { ...seeded, id: existing.id || catalogId, catalogId: existing.catalogId || catalogId, tag: source.tag, score: source.score, sourceUrl: source.sourceUrl });
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
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, bytes);
        if (existing) changed += 1; else added += 1;
      }
      runtimeArtists.set(catalogId, { id: existing?.id || catalogId, catalogId: existing?.catalogId || catalogId, tag: source.tag, gallery: GALLERY, image: relative, sourceUrl: source.sourceUrl, score: source.score, runtime: true });
      currentRuntimeIds.add(catalogId);
      progress({ phase: 'downloading', completed: index + 1, total: discovered.length, added, changed, message: source.tag });
    }
    assertNotCancelled(signal);
    const artists = [...runtimeArtists.entries()].filter(([catalogId]) => currentRuntimeIds.has(catalogId)).map(([, card]) => card);
    const overlay = { version: 2, catalogId: 'nai-v5-runtime', generatedAt: new Date().toISOString(), artists, characters: [], tags: embedded.tags || [] };
    progress({ phase: 'validation', completed: 0, total: artists.length, added, changed, message: 'Validating staged catalog' });
    const ids = new Set();
    const sources = new Set();
    for (let index = 0; index < artists.length; index += 1) {
      assertNotCancelled(signal);
      if (index > 0 && index % 32 === 0) await new Promise(resolve => setImmediate(resolve));
      const card = artists[index];
      const cardId = card.catalogId || card.id;
      if (!cardId || ids.has(cardId)) throw new Error(`Duplicate runtime catalog identity: ${cardId || 'missing id'}`);
      ids.add(cardId);
      const source = String(card.sourceUrl || '');
      if (!source || sources.has(source)) throw new Error(`Duplicate runtime catalog source: ${source || 'missing source'}`);
      sources.add(source);
      if (!validCardAsset(card.image)) throw new Error(`Invalid runtime catalog asset for ${card.tag || cardId}`);
      const asset = containedCatalogAsset(stage, card.image);
      if (!fs.existsSync(asset) || !validWebpFile(asset)) throw new Error(`Invalid staged WebP for ${card.tag || cardId}`);
      if (!normalizeImageUrl(card.sourceUrl)) throw new Error(`Invalid runtime source URL for ${card.tag || cardId}`);
      progress({ phase: 'validation', completed: index + 1, total: artists.length, added, changed, message: card.tag });
    }
    const stageCatalog = contained(stage, 'catalog.json');
    await fsp.writeFile(stageCatalog, JSON.stringify(overlay));
    JSON.parse(await fsp.readFile(stageCatalog, 'utf8'));
    progress({ phase: 'validation', completed: artists.length, total: artists.length, added, changed, message: 'Staged catalog validated' });
    assertNotCancelled(signal);
    const generationDir = contained(catalogDir, path.join('generations', generation));
    await fsp.mkdir(path.dirname(generationDir), { recursive: true });
    assertNotCancelled(signal);
    await fsp.rename(stage, generationDir);
    renamed = true;
    // Commit is intentionally short and non-cancellable.  The old pointer
    // remains active until this atomic rename succeeds.
    progress({ phase: 'commit', completed: 0, total: 1, added, changed, message: 'Activating catalog generation' });
    const pointerTemp = contained(catalogDir, 'active.json.tmp');
    await fsp.writeFile(pointerTemp, JSON.stringify({ generation }));
    await fsp.rename(pointerTemp, contained(catalogDir, 'active.json'));
    progress({ phase: 'commit', completed: 1, total: 1, added, changed, message: 'Catalog generation active' });
    progress({ phase: 'complete', completed: discovered.length, total: discovered.length, added, changed, message: `+${added} artists` });
    return { catalog: loadCatalog({ embeddedPath, catalogDir, embedded, baseAssets }), added, changed };
  } catch (error) {
    if (!renamed) {
      try { await fsp.rm(stage, { recursive: true, force: true }); } catch { /* keep old generation active */ }
    }
    progress.stop();
    throw error;
  }
}

module.exports = { GALLERY, GALLERY_URL, CDN_PREFIX, GALLERY_PAGE_CONCURRENCY, parseGalleryPage, isWebp, stableCatalogId, loadCatalog, discoverCards, runUpdate, normalizeImageUrl, catalogAssetFromProtocolUrl, containedCatalogAsset, resolveActiveCatalogAssetDescriptor, readActiveCatalogAsset, resolveActiveCatalogAsset, validCardAsset, validCharacterAsset, validGuideAsset, validCatalogAsset };

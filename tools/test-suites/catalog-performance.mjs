import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createPackage } from '@electron/asar';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const {
  COMPONENTS, componentFile, componentPaths, loadState, saveState
} = require('../../electron/catalog-components.cjs');
const {
  loadCatalog, readActiveCatalogAsset, resolveActiveCatalogAssetDescriptor
} = require('../../electron/catalog-updater.cjs');

const componentsSource = readFileSync(new URL('../../electron/catalog-components.cjs', import.meta.url), 'utf8');
const updaterSource = readFileSync(new URL('../../electron/catalog-updater.cjs', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
assert.match(componentsSource, /require\(['"]original-fs['"]\)/, 'catalog outer-file facts use Electron original-fs');
assert.match(componentsSource, /require\(['"]@electron\/asar['"]\)/, 'catalog entry reads use @electron/asar');
const activeReaderSource = updaterSource.slice(updaterSource.indexOf('async function readActiveCatalogAsset'), updaterSource.indexOf('function readJson'));
assert.match(activeReaderSource, /readArchiveEntry/);
assert.doesNotMatch(activeReaderSource, /fs\.promises\.readFile\([^)]*archivePath|path\.join\([^)]*archivePath/, 'hot runtime ASAR reads must not open archive.asar/inner virtual paths');
const protocolStart = mainSource.indexOf("protocol.handle('nai-catalog'");
const protocolSource = mainSource.slice(protocolStart, mainSource.indexOf('\n  });', protocolStart) + 5);
assert.match(protocolSource, /readActiveCatalogAsset/);
assert.doesNotMatch(protocolSource.replace(/\/\/.*$/gm, ''), /fs\.promises\.readFile\(target\)|net\.fetch|file:\/\//, 'catalog protocol handler must not read a virtual ASAR path');

const root = mkdtempSync(join(process.cwd(), '.test-tmp-v063', `catalog-performance-${process.pid}-`));
try {
  const source = join(root, 'source');
  const catalogDir = join(root, 'catalog');
  const embeddedPath = join(root, 'embedded.json');
  const generation = join(catalogDir, 'generations', 'fixture-generation');
  mkdirSync(source, { recursive: true });
  mkdirSync(generation, { recursive: true });

  // A valid header is enough for the runtime read assertion. The merge guard
  // is about avoiding payload extraction, not image decoding quality.
  const imageBytes = Buffer.from('RIFFfixtureWEBP', 'ascii');
  const cards = ['one', 'two', 'three'].map((id, index) => ({
    id: `artist-${id}`,
    catalogId: `artist-${id}`,
    tag: `artist: ${id}`,
    gallery: 'danbooru-artist-tags-2-v5',
    image: `cards/artist/danbooru-artist-tags-2-v5/${id}.webp`,
    sourceUrl: `https://cdn.zele.st/data/NAX/Images/danbooru-artist-tags-2-v5/${id}.webp`,
    score: index,
    runtime: false
  }));
  for (const card of cards) {
    const file = join(source, ...card.image.split('/'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, imageBytes);
  }
  const archivePath = componentFile(catalogDir, COMPONENTS.artists);
  mkdirSync(join(archivePath, '..'), { recursive: true });
  const archiveStream = await createPackage(source, archivePath);
  if (!archiveStream.writableFinished) await once(archiveStream, 'finish');
  const archiveStat = statSync(archivePath);
  const archiveBytes = readFileSync(archivePath);
  const state = loadState(catalogDir);
  state.components.artists = {
    status: 'Installed', filename: COMPONENTS.artists.filename, size: archiveStat.size,
    sha512: createHash('sha512').update(archiveBytes).digest('hex'), mtimeMs: archiveStat.mtimeMs,
    version: '0.6.3', expectedRoot: COMPONENTS.artists.expectedRoot, count: COMPONENTS.artists.count
  };
  saveState(catalogDir, state);

  writeFileSync(embeddedPath, JSON.stringify({ version: 2, artists: cards, characters: [], tags: [] }));
  writeFileSync(join(catalogDir, 'active.json'), JSON.stringify({ generation: 'fixture-generation' }));
  // The overlay repeats the base metadata. This is the merge branch that
  // historically validated every base image by extracting its full payload.
  writeFileSync(join(generation, 'catalog.json'), JSON.stringify({ version: 2, artists: cards, characters: [], tags: [] }));

  const extracted = [];
  const originalExtract = asar.extractFile;
  asar.extractFile = (file, entry, ...args) => {
    if (String(file) === archivePath) extracted.push(String(entry).replaceAll('\\', '/'));
    return originalExtract(file, entry, ...args);
  };
  let merged;
  try {
    merged = loadCatalog({ embeddedPath, catalogDir });
  } finally {
    asar.extractFile = originalExtract;
  }
  assert.deepEqual(merged.artists.map(card => card.id), cards.map(card => card.id));
  assert.deepEqual(extracted, [], 'loadCatalog metadata merge must not extract one ASAR payload per base artist card');

  const descriptor = resolveActiveCatalogAssetDescriptor(catalogDir, cards[0].image);
  assert.equal(descriptor.kind, 'component');
  assert.equal(Object.prototype.hasOwnProperty.call(descriptor, 'path'), false, 'runtime component descriptors must not expose a virtual archive.asar/inner path');
  const bytes = await readActiveCatalogAsset(catalogDir, cards[0].image);
  assert.deepEqual(Buffer.from(bytes), imageBytes, 'runtime ASAR reads return the requested entry bytes');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Catalog performance/direct-read tests passed.');

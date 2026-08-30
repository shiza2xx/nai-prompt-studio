import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createPackageFromFiles, listPackage } from '@electron/asar';
import { projectRoot } from './local-env.mjs';
import { COMPONENT_VERSION, resolveCatalogComponentVersion } from './catalog-packs-version.mjs';

export { COMPONENT_VERSION } from './catalog-packs-version.mjs';

// Build independently verifiable ASAR components directly from public/catalog.
// No image staging tree is created, and public catalog inputs are never moved,
// optimized, or deleted.
const catalog = join(projectRoot, 'public', 'catalog');
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length) || join(projectRoot, 'release-v5', 'catalog-packs'));
const version = resolveCatalogComponentVersion();
mkdirSync(output, { recursive: true });

function walkFiles(root) {
  const result = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result.push(file);
      else throw new Error(`Catalog component input is not a regular file: ${file}`);
    }
  };
  visit(root);
  return result;
}
function relativeFiles(root) { return walkFiles(root).map(file => relative(catalog, file).replaceAll('\\', '/')).sort(); }
async function sha512(file) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function ensureSafeRelative(file) {
  if (!file || file.startsWith('/') || file.split('/').some(segment => segment === '.' || segment === '..')) throw new Error(`Unsafe catalog component path: ${file}`);
}
function guideEntriesOf(value) { return Array.isArray(value) ? value : Array.isArray(value?.entries) ? value.entries : []; }
function guideImageInputs(entries) {
  return [...new Set(entries.map(entry => {
    if (typeof entry?.image !== 'string') throw new Error('Guide manifest contains an invalid image path.');
    const image = entry.image.replaceAll('\\', '/');
    ensureSafeRelative(image);
    if (!image.toLowerCase().endsWith('.png') || !existsSync(join(catalog, 'guide', image))) throw new Error(`Guide manifest image is missing: ${image}`);
    return `guide/${image}`;
  }))].sort();
}
async function awaitArchive(streamPromise) {
  const stream = await streamPromise;
  if (!stream?.writableFinished) await once(stream, 'finish');
}

const sourceCatalog = JSON.parse(readFileSync(join(catalog, 'catalog.json'), 'utf8'));
const guideManifest = JSON.parse(readFileSync(join(catalog, 'guide', 'manifest.json'), 'utf8'));
const guideEntries = guideEntriesOf(guideManifest);
const definitions = [
  { id: 'artists', filename: 'nai-v5-artists.asar', expectedRoot: 'cards/artist', source: join(catalog, 'cards', 'artist'), count: sourceCatalog.artists.length, extension: '.webp', extra: ['catalog.json'] },
  { id: 'characters', filename: 'nai-characters.asar', expectedRoot: 'cards/character', source: join(catalog, 'cards', 'character'), count: sourceCatalog.characters.length, extension: '.jpg', extra: [] },
  { id: 'guide', filename: 'nai-constructor-guide.asar', expectedRoot: 'guide', source: join(catalog, 'guide'), count: 281, extension: '.png', extra: [] }
];
if (!Array.isArray(sourceCatalog.artists) || sourceCatalog.artists.length !== 4198) throw new Error(`Artist metadata count must be 4198 (found ${sourceCatalog.artists?.length || 0}).`);
if (!Array.isArray(sourceCatalog.characters) || sourceCatalog.characters.length !== 5457) throw new Error(`Character metadata count must be 5457 (found ${sourceCatalog.characters?.length || 0}).`);
if (guideEntries.length !== 281) throw new Error(`Guide manifest count must be 281 (found ${guideEntries.length}).`);
const guideInputs = guideImageInputs(guideEntries);

const descriptors = [];
for (const definition of definitions) {
  const sourceFiles = relativeFiles(definition.source);
  const imageFiles = sourceFiles.filter(file => file.toLowerCase().endsWith(definition.extension));
  if (definition.id !== 'guide' && imageFiles.length !== definition.count) throw new Error(`${definition.id} image count mismatch: expected ${definition.count}, found ${imageFiles.length}`);
  let filenames;
  if (definition.id === 'guide') {
    // The manifest describes 281 cards but intentionally reuses some artwork.
    // Package only unique referenced images, plus metadata needed at runtime;
    // unreferenced PNGs in public/catalog/guide are not release payload.
    const actualImages = new Set(imageFiles);
    for (const image of guideInputs) if (!actualImages.has(image)) throw new Error(`Guide manifest image is not packaged: ${image}`);
    filenames = [...guideInputs, 'guide/manifest.json'];
    if (existsSync(join(catalog, 'guide', 'quality.json'))) filenames.push('guide/quality.json');
  } else {
    filenames = [...sourceFiles, ...definition.extra];
  }
  for (const file of filenames) ensureSafeRelative(file);
  for (const file of filenames) if (!existsSync(join(catalog, file))) throw new Error(`Catalog component input is missing: ${file}`);
  const target = join(output, definition.filename);
  rmSync(target, { force: true });
  // createPackageFromFiles reads directly from public/catalog and streams each
  // source file into the ASAR; there is no second multi-GB staging copy.
  // The asar API resolves each filename before inserting it, so pass absolute
  // source paths while retaining the catalog-relative archive names.
  await awaitArchive(createPackageFromFiles(catalog, target, filenames.map(file => join(catalog, file))));
  const entries = listPackage(target).map(value => String(value).replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!entries.some(entry => entry === definition.expectedRoot || entry.startsWith(`${definition.expectedRoot}/`))) throw new Error(`${definition.filename} is missing ${definition.expectedRoot}`);
  if (definition.id === 'artists' && !entries.includes('catalog.json')) throw new Error('Artist component must include compact catalog.json');
  const size = statSync(target).size;
  if (!Number.isSafeInteger(size) || size <= 0 || size >= 2 * 1024 * 1024 * 1024) throw new Error(`${definition.filename} has an invalid size or exceeds the GitHub 2 GiB asset limit.`);
  descriptors.push({ id: definition.id, filename: definition.filename, url: `https://github.com/shiza2xx/nai-prompt-studio/releases/download/v${version}/${definition.filename}`, size, sha512: await sha512(target), expectedRoot: definition.expectedRoot, count: definition.count, version });
}
const manifest = { version, catalogs: descriptors };
const descriptorPath = join(output, 'catalog-components.json');
const { writeFile } = await import('node:fs/promises');
await writeFile(descriptorPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));

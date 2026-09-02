import { createHash } from 'node:crypto';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './local-env.mjs';
import { normalizeDescriptors } from '../electron/catalog-components.cjs';
const pkg = JSON.parse(await fs.readFile(join(projectRoot, 'package.json'), 'utf8'));
const releaseNotesPath = join(projectRoot, 'src', 'release-notes.json');
const releaseNotes = JSON.parse(await fs.readFile(releaseNotesPath, 'utf8'));
const forbiddenReleasePunctuation = /[\u2014\u2013]/;
const validReleaseCopy = value => typeof value === 'string' && Boolean(value.trim()) && !forbiddenReleasePunctuation.test(value);
const cleanupNotice = releaseNotes?.cleanupNotice;
if (!releaseNotes || typeof releaseNotes !== 'object' || releaseNotes.version !== pkg.version || !validReleaseCopy(releaseNotes.summary) || !Array.isArray(releaseNotes.whatsNew) || releaseNotes.whatsNew.length < 1 || releaseNotes.whatsNew.some(item => !item || !validReleaseCopy(item.title) || !validReleaseCopy(item.copy)) || !cleanupNotice || !validReleaseCopy(cleanupNotice.title) || !validReleaseCopy(cleanupNotice.copy) || !Array.isArray(cleanupNotice.steps) || cleanupNotice.steps.length < 3 || cleanupNotice.steps.some(step => !validReleaseCopy(step))) {
  throw new Error(`Release notes must be a valid ${pkg.version} record: ${releaseNotesPath}`);
}
const asset = `NAI-Prompt-Studio-V5-Setup-${pkg.version}.exe`;
const file = join(projectRoot, 'release-v5', asset);
if (!existsSync(file)) throw new Error(`Build the single-file setup first: ${file}`);
const sha = createHash('sha512'); for await (const chunk of createReadStream(file)) sha.update(chunk);
const stat = await fs.stat(file);
const catalogDescriptorPath = join(projectRoot, 'release-v5', 'catalog-packs', 'catalog-components.json');
if (!existsSync(catalogDescriptorPath)) throw new Error(`Complete v0.6.3 catalog descriptors are required: ${catalogDescriptorPath}`);
let catalogs;
try {
  const value = JSON.parse(await fs.readFile(catalogDescriptorPath, 'utf8'));
  catalogs = normalizeDescriptors(value);
  if (catalogs.length !== 3 || catalogs.some(item => !existsSync(join(projectRoot, 'release-v5', 'catalog-packs', item.filename)))) throw new Error('Catalog descriptor does not have all three ASAR files.');
} catch (error) { throw new Error(`Invalid catalog component descriptor: ${error instanceof Error ? error.message : String(error)}`); }
const manifest = {
  schemaVersion: 1,
  version: pkg.version,
  asset,
  url: `https://github.com/shiza2xx/nai-prompt-studio/releases/download/v${pkg.version}/${asset}`,
  size: stat.size,
  sha512: sha.digest('hex'),
  releaseNotes: releaseNotes.summary,
  // Additive field: schema-1 clients ignore catalogs while v0.6.4 reuses the
  // v0.6.3 descriptors to verify and hydrate selected ASAR components.
  catalogs
};
await fs.writeFile(join(projectRoot, 'release-v5', 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));

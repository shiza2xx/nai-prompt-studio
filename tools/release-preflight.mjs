import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { projectRoot } from './local-env.mjs';

const forbiddenAsset = 'card.png';
const roots = ['src', 'electron', 'tools', 'build', 'public', 'dist'];
const textExtensions = new Set(['.ts', '.cjs', '.mjs', '.js', '.json', '.html', '.css', '.nsh', '.yml', '.yaml']);
const references = [];
function visit(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.isFile() && textExtensions.has(extname(entry.name).toLowerCase()) && !/release-preflight|test-groups|(?:legacy-)?tests\.mjs/.test(target.replaceAll('\\', '/'))) {
      if (readFileSync(target, 'utf8').toLowerCase().includes(forbiddenAsset)) references.push(relative(projectRoot, target));
    }
  }
}
for (const root of roots) visit(join(projectRoot, root));
if (references.length) throw new Error(`Removed card asset is still referenced by: ${references.join(', ')}`);
if (existsSync(join(projectRoot, 'public', forbiddenAsset))) throw new Error('public/card.png is an unconsumed release input and must stay removed.');

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
if (pkg.version !== '0.7.0') throw new Error(`v0.7.0 release preflight expected version 0.7.0 (found ${pkg.version}).`);
const catalogFile = join(projectRoot, 'public', 'catalog', 'catalog.json');
if (existsSync(catalogFile)) {
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
  if (catalog.artists?.length !== 4198 || catalog.characters?.length !== 5457) throw new Error('Catalog release inputs are incomplete.');
}
console.log('Release/static preflight passed: version, catalog inputs, and removed-asset consumers are clean.');

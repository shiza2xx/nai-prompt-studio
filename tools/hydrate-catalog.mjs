import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { extractAll } from '@electron/asar';
import { projectRoot } from './local-env.mjs';
const packs = process.argv.slice(2).map(resolve);
if (!packs.length) throw new Error('Pass one or more downloaded catalog pack paths.');
const destination = join(projectRoot, 'public', 'catalog'); mkdirSync(destination, { recursive: true });
for (const pack of packs) {
  if (!existsSync(pack) || !/\.asar$/i.test(pack)) throw new Error(`Invalid catalog ASAR component: ${pack}`);
  try { extractAll(pack, destination); } catch (error) { throw new Error(`Could not hydrate ${basename(pack)}: ${error instanceof Error ? error.message : String(error)}`); }
}
console.log(`Catalog hydrated at ${destination}`);

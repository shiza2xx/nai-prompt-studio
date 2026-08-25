import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLocalEnvironment, projectRoot } from './local-env.mjs';
const sevenZip = join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe');
const packs = process.argv.slice(2).map(resolve);
if (!packs.length) throw new Error('Pass one or more downloaded catalog pack paths.');
if (!existsSync(sevenZip)) throw new Error('The packaged 7-Zip helper is missing.');
const destination = join(projectRoot, 'public', 'catalog'); mkdirSync(destination, { recursive: true });
for (const pack of packs) {
  if (!existsSync(pack) || !/\.zip$/i.test(pack)) throw new Error(`Invalid catalog pack: ${pack}`);
  const result = spawnSync(sevenZip, ['x', '-y', `-o${destination}`, pack], { cwd: destination, env: createLocalEnvironment(), stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not hydrate ${basename(pack)}.`);
}
console.log(`Catalog hydrated at ${destination}`);

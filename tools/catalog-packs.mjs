import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { localPaths, projectRoot, createLocalEnvironment } from './local-env.mjs';
const sevenZip = join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe');
if (!existsSync(sevenZip)) throw new Error('The packaged 7-Zip helper is missing. Install project dependencies first.');
const catalog = join(projectRoot, 'public', 'catalog'); const output = join(projectRoot, 'release-v5', 'catalog-packs'); mkdirSync(output, { recursive: true });
const packs = [
  ['nai-v5-artists.zip', join('cards', 'artist'), 'catalog.json'],
  ['nai-characters.zip', join('cards', 'character')],
  ['nai-constructor-guide.zip', 'guide']
];
for (const [name, ...sources] of packs) {
  const target = join(output, name); const args = ['a', '-tzip', '-mx=6', target, ...sources.filter(source => existsSync(join(catalog, source)))];
  rmSync(target, { force: true });
  const result = spawnSync(sevenZip, args, { cwd: catalog, env: createLocalEnvironment(), stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not create ${name}.`);
  if (statSync(target).size >= 2 * 1024 * 1024 * 1024) throw new Error(`${name} exceeds the GitHub 2 GiB asset limit.`);
}
console.log(readdirSync(output).join('\n'));

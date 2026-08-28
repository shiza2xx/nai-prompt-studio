import { createHash } from 'node:crypto';
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './local-env.mjs';
const pkg = JSON.parse(await fs.readFile(join(projectRoot, 'package.json'), 'utf8'));
const asset = `NAI-Prompt-Studio-V5-Setup-${pkg.version}.exe`;
const file = join(projectRoot, 'release-v5', asset);
if (!existsSync(file)) throw new Error(`Build the single-file setup first: ${file}`);
const sha = createHash('sha512'); for await (const chunk of createReadStream(file)) sha.update(chunk);
const stat = await fs.stat(file);
const manifest = {
  schemaVersion: 1,
  version: pkg.version,
  asset,
  url: `https://github.com/shiza2xx/nai-prompt-studio/releases/download/v${pkg.version}/${asset}`,
  size: stat.size,
  sha512: sha.digest('hex'),
  releaseNotes: 'Prompt Builder constructor tags are now organized into expandable source folders with smoother disclosure and preloaded visual cards. This release also prepares the Custom Tags foundation for future folder import and export.'
};
await fs.writeFile(join(projectRoot, 'release-v5', 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));

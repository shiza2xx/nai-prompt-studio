import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './local-env.mjs';

const source = join(projectRoot, 'icon.png');
const publicDir = join(projectRoot, 'public');
const buildDir = join(projectRoot, 'build');
const publicIcon = join(publicDir, 'app-icon.png');
const icoPath = join(buildDir, 'icon.ico');
if (!existsSync(source)) throw new Error(`User-owned source icon is missing: ${source}`);
const png = readFileSync(source);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!png.subarray(0, 8).equals(signature)) throw new Error('icon.png is not a valid PNG');
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (!width || !height) throw new Error('icon.png has invalid dimensions');
mkdirSync(publicDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });
copyFileSync(source, publicIcon);

// ICO accepts PNG-compressed frames. The local PowerShell helper creates
// lossless ARGB frames at each Windows size without dependencies or C-drive
// temp usage.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const resize = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'tools', 'prepare-icon.ps1'), '-Source', source, '-OutputDirectory', buildDir], { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
if (resize.error) throw resize.error;
if (resize.status !== 0) throw new Error(`Icon frame preparation exited with ${resize.status}.`);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const entries = Buffer.alloc(16 * sizes.length);
const frames = [];
let offset = 6 + entries.length;
sizes.forEach((size, index) => {
  const entry = index * 16;
  entries[index * 16] = size >= 256 ? 0 : size;
  entries[index * 16 + 1] = size >= 256 ? 0 : size;
  entries.writeUInt8(0, entry + 2);
  entries.writeUInt8(0, entry + 3);
  entries.writeUInt16LE(1, entry + 4);
  entries.writeUInt16LE(32, entry + 6);
  entries.writeUInt32LE(png.length, entry + 8);
  entries.writeUInt32LE(offset, entry + 12);
  const frame = readFileSync(join(buildDir, `icon-${size}.png`));
  frames.push(frame);
  entries.writeUInt32LE(frame.length, entry + 8);
  offset += frame.length;
});
writeFileSync(icoPath, Buffer.concat([header, entries, ...frames]));
console.log(`Prepared app icon ${width}x${height}: ${publicIcon}`);
console.log(`Prepared ICO with ${sizes.length} PNG frames: ${icoPath}`);

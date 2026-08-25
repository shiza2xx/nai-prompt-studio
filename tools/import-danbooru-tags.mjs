import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = resolve(import.meta.dirname, '..');
const target = join(root, '.nax-cache', 'danbooru_tags.csv');
const url = 'https://huggingface.co/datasets/SpadeA/danbooru-tag-csv/resolve/main/danbooru_tags.csv?download=true';

mkdirSync(join(root, '.nax-cache'), { recursive: true });
const response = await fetch(url);
if (!response.ok || !response.body) throw new Error(`Danbooru tag download failed: ${response.status}`);
await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
console.log(`Danbooru 2025 tag list saved to ${target}`);

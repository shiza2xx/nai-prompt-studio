import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cache = join(root, '.nax-cache', 'hothottuk-v45.html');
const html = existsSync(cache) ? readFileSync(cache, 'utf8') : await (await fetch('https://hothottuk.neocities.org/en')).text();
if (!existsSync(cache)) writeFileSync(cache, html);
const headings = [];
for (const match of html.matchAll(/<(summary|h3)[^>]*>([\s\S]*?)<\/\1>/gi)) {
  headings.push({ index: match.index ?? 0, title: clean(match[2]) });
}
function clean(value) { return value.replace(/<[^>]+>/g, '').replace(/&nbsp;|▶|&amp;|&#39;|&ldquo;|&rdquo;/g, match => ({ '&nbsp;': ' ', '▶': ' ', '&amp;': '&', '&#39;': "'", '&ldquo;': '"', '&rdquo;': '"' }[match] ?? match)).replace(/\s+/g, ' ').trim(); }
function nearestHeading(index) { return headings.filter(heading => heading.index < index).at(-1)?.title ?? 'Guide examples'; }
const examples = [];
for (const cell of html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)) {
  const content = cell[1];
  const image = content.match(/src="images\/([^"]+)"/i)?.[1];
  const tag = clean(content.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] ?? '').replace(/:$/, '');
  if (!image || !tag || tag.toLowerCase().startsWith('reference')) continue;
  const section = nearestHeading(cell.index ?? 0);
  const description = clean(content.replace(/<img[^>]*>/gi, '').replace(/<strong>[\s\S]*?<\/strong>/i, '').replace(/<br\s*\/?>(?:\s*)/gi, ' '));
  examples.push({ tag, section, image, description, group: section });
}
const uniqueExamples = [...new Map(examples.map(example => [`${example.section}:${example.tag}:${example.image}`, example])).values()];
// Keep only the approved visual constructor sections. The 2.3 style-reference
// and 2.4 character-reference examples are explanatory controls, not tag cards.
const approvedExamples = uniqueExamples.filter(example => /^(?:4\.[1-8]|5\.[1-4])\./.test(example.section));
const destination = join(root, 'public', 'catalog', 'guide');
mkdirSync(destination, { recursive: true });
writeFileSync(join(destination, 'manifest.json'), JSON.stringify(approvedExamples));
// Section 6 is text-only in the source and intentionally has no image cards.
writeFileSync(join(destination, 'quality.json'), JSON.stringify({
  source: 'https://hothottuk.neocities.org/en',
  positive: ['masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'best illustration', 'novel illustration', 'highres', 'absurdres', 'incredibly absurdres', 'ultra-detailed', 'intricate details', 'solo artist', 'artist collaboration'],
  recommended: ['solo artist', '-5.3::artist collaboration::', 'year 2024', 'year 2023', 'year 2022', 'year 2021', '-1::clean text::', '-1::flat color::', 'natural', 'incredibly absurdres', 'very aesthetic', 'highres', 'masterpiece', 'best quality', 'amazing quality', '-3::simple illustration::', 'best illustration', 'novel illustration']
}));
const images = [...new Set(approvedExamples.map(example => example.image))];
const queue = [...images];
let downloaded = 0;
let failed = 0;
async function worker() {
  while (queue.length) {
    const image = queue.shift();
    const target = join(destination, basename(image));
    if (existsSync(target)) continue;
    try {
      const response = await fetch(`https://hothottuk.neocities.org/images/${image}`, { signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(String(response.status));
      writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      downloaded += 1;
    } catch { failed += 1; queue.push(image); if (failed > images.length * 3) throw new Error('Too many guide image download failures.'); }
    if ((downloaded + failed) % 25 === 0) console.log(`Guide images: ${downloaded}/${images.length}, retries ${failed}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`Guide imported: ${approvedExamples.length} approved visual examples, ${downloaded} new local images.`);

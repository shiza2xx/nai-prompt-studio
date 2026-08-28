import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('NAISETUPV0630000', 'ascii');
export const FOOTER_SIZE = 96;

async function appendFile(source, destination, hash) {
  await pipeline(createReadStream(source), async function* (chunks) { for await (const chunk of chunks) { if (hash) hash.update(chunk); yield chunk; } }, createWriteStream(destination, { flags: 'a' }));
}
export async function buildSelfExtractingSetup(launcher, payload, output) {
  await fs.copyFile(launcher, output);
  const launcherStat = await fs.stat(launcher); const payloadStat = await fs.stat(payload); const hash = createHash('sha512');
  await appendFile(payload, output, hash);
  const footer = Buffer.alloc(FOOTER_SIZE); MAGIC.copy(footer, 0); footer.writeBigInt64LE(BigInt(launcherStat.size), 16); footer.writeBigInt64LE(BigInt(payloadStat.size), 24); hash.digest().copy(footer, 32);
  await fs.appendFile(output, footer);
  return { offset: launcherStat.size, size: payloadStat.size };
}

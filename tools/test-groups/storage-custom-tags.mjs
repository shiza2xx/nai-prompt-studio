await import('../test-suites/storage-custom-tags.mjs');

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCustomTagLibrary } = require('../../electron/custom-tag-library.cjs');
const root = mkdtempSync(join(tmpdir(), 'nai-preset-state-'));
try {
  const customTagsDir = join(root, 'custom-tags'); const workspaceFile = join(root, 'workspace.json');
  writeFileSync(workspaceFile, JSON.stringify({ version: 3, customTags: [], customTagPresets: [] }));
  const library = createCustomTagLibrary({ customTagsDir, workspaceFile, now: () => '2026-08-31T00:00:00.000Z' });
  library.load();
  const indexFile = join(customTagsDir, 'library-v1', 'index.json');
  let index = JSON.parse(readFileSync(indexFile, 'utf8'));
  assert.equal(index.presetState.default.revision, 1);
  library.transact('preset:create', { id: 'portraits', name: 'Portraits' });
  index = JSON.parse(readFileSync(indexFile, 'utf8')); assert.equal(index.presetState.portraits.revision, 1);
  library.transact('card:upsert', { id: 'artist-one', kind: 'artist', tag: 'artist: one', presetId: 'default', description: '' });
  const afterCreate = JSON.parse(readFileSync(indexFile, 'utf8'));
  library.transact('card:upsert', { id: 'artist-one', kind: 'artist', tag: 'artist: one', presetId: 'portraits', description: '' });
  const afterMove = JSON.parse(readFileSync(indexFile, 'utf8'));
  assert.equal(afterMove.presetState.default.revision, afterCreate.presetState.default.revision + 1);
  assert.equal(afterMove.presetState.portraits.revision, 2);
  delete afterMove.presetState; writeFileSync(indexFile, JSON.stringify(afterMove));
  createCustomTagLibrary({ customTagsDir, workspaceFile, now: () => '2026-08-31T00:00:01.000Z' }).load();
  assert.match(JSON.parse(readFileSync(indexFile, 'utf8')).presetState.portraits.sha256, /^[a-f0-9]{64}$/);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('Custom Tags revision/digest tests passed.');

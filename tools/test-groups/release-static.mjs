import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const runnerSource = readFileSync(new URL('../test-runner.mjs', import.meta.url), 'utf8');
const groupSources = ['renderer', 'storage-custom-tags', 'catalogs', 'metadata-preview', 'release-static'].map(name => readFileSync(new URL(`./${name}.mjs`, import.meta.url), 'utf8')).join('\n');
assert.doesNotMatch(groupSources, /legacy-(?:tests|core)\.mjs/, 'no subsystem group may import a monolithic legacy suite');
assert.match(groupSources, /metadata-workspace-tests\.mjs/, 'the production manifest includes executable MetadataWorkspace tests');
for (const suite of ['renderer-domain', 'renderer-static', 'library-mix-static', 'storage-custom-tags', 'catalog-components', 'catalog-runtime', 'metadata-preview', 'metadata-highlight', 'release-updater', 'release-static-contracts']) {
  assert.match(groupSources, new RegExp(`test-suites/${suite}\\.mjs`), `production groups include ${suite}`);
}
for (const name of ['renderer', 'storage-custom-tags', 'catalogs', 'metadata-preview', 'release-static']) assert.match(runnerSource, new RegExp(`['"]${name}['"]`));
import { prepareIsolatedNsisTemplates, templateChecksum, upstreamNsisTemplatesDir } from '../electron-builder-nsis-store.mjs';
await import('../test-suites/release-updater.mjs');
await import('../test-suites/release-static-contracts.mjs');

const before = templateChecksum();
for (const failAt of [null, 'after-copy', 'after-patch']) {
  const root = mkdtempSync(join(tmpdir(), 'nai-nsis-test-'));
  const cacheRoot = join(root, 'templates');
  try {
    if (failAt) assert.throws(() => prepareIsolatedNsisTemplates({ cacheRoot, failpoint: phase => { if (phase === failAt) throw new Error('simulated hard stop'); } }), /simulated hard stop/);
    else {
      const result = prepareIsolatedNsisTemplates({ cacheRoot });
      assert.notEqual(result.patchedChecksum, result.upstreamChecksum);
      assert.match(readFileSync(join(result.templatesDir, 'include', 'installer.nsh'), 'utf8'), /never persist the full installer/);
    }
    assert.equal(templateChecksum(), before, `upstream checksum changed at ${failAt ?? 'success'} boundary`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
assert.ok(upstreamNsisTemplatesDir.includes('node_modules'));
console.log('Release/static isolation tests passed.');

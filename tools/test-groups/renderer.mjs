import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
await import('../test-suites/renderer-domain.mjs');
await import('../test-suites/renderer-static.mjs');
await import('../test-suites/library-mix-static.mjs');

const window = new Window({ url: 'https://localhost/' });
Object.assign(globalThis, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLFormElement: window.HTMLFormElement, KeyboardEvent: window.KeyboardEvent });
const { WorkspaceController } = await import('../../src/workspace-controller.ts');
const { SavedLibraryWorkspaceModule } = await import('../../src/workspaces/saved-library-workspace.ts');
const { CustomTagsWorkspaceModule, swapCardOrderSlots } = await import('../../src/workspaces/custom-tags-workspace.ts');
const { PreviewCache } = await import('../../src/preview-cache.ts');
const { bindArtistCardPreview, beginArtistCardPreviewDrag, endArtistCardPreviewDrag } = await import('../../src/artist-card-preview.ts');
const root = document.createElement('div'); document.body.append(root);
let delegated = 0; let workspaceRouter = null;
const controller = new WorkspaceController(root, event => { delegated += 1; workspaceRouter?.(event); });
const rootIdentity = root; const shellIdentity = controller.shell; const hostIdentity = controller.workspaceHost;
controller.updateChrome('app-shell', '<button role="tab" id="prompt-tab">Prompt</button>');
controller.mount('prompt', '<section id="prompt-panel"><input id="focus"><div id="output">one</div></section>');
const focus = document.querySelector('#focus'); focus.focus();
assert.equal(controller.patch({ kind: 'text', selector: '#output', value: 'two' }), true);
assert.equal(document.activeElement, focus, 'local patches retain focus');
assert.equal(document.querySelector('#output').textContent, 'two');
controller.mount('settings', '<section id="settings-panel">Settings</section>');
assert.equal(root, rootIdentity); assert.equal(controller.shell, shellIdentity); assert.equal(controller.workspaceHost, hostIdentity);
document.querySelector('#prompt-tab').click();
assert.equal(delegated, 1, 'one delegated router handles a shell action once');
controller.updateChrome('app-shell', '<button role="tab" id="prompt-tab">Prompt</button>');
document.querySelector('#prompt-tab').click();
assert.equal(delegated, 2, 'stable chrome updates do not duplicate delegated listeners');
for (let index = 0; index < 4; index += 1) { controller.mount('settings', `<section id="settings-panel">Settings ${index}</section>`); controller.updateChrome('app-shell', '<button role="tab" id="prompt-tab">Prompt</button>'); }
document.querySelector('#prompt-tab').click();
assert.equal(delegated, 3, 'repeated ordinary renders and workspace switches still dispatch one tab action');

const now = '2026-08-31T00:00:00.000Z'; let librarySearch = ''; let librarySearchCalls = 0;
const library = new SavedLibraryWorkspaceModule(() => ({ items: [{ version: 4, id: 'one', kind: 'character', source: 'manual', name: 'Mira', description: '', prompt: 'blue eyes', data: { positive: 'blue eyes', negative: 'blurry' }, createdAt: now, updatedAt: now }], search: librarySearch, filter: 'all', polarities: new Map(), panelClass: 'workspace-panel', imageUrl: () => '', escape: String }), { search: value => { librarySearch = value; librarySearchCalls += 1; }, filter: () => {}, create: () => {}, edit: () => {}, delete: () => {}, copy: () => {} });
controller.mount('saved-library', library.markup());
workspaceRouter = event => library.route(event);
const search = document.querySelector('#saved-library-search'); search.focus(); search.value = 'mira'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
assert.equal(librarySearchCalls, 1, 'Saved Library delegated input fires exactly once');
library.refresh(controller); assert.equal(controller.workspaceHost, hostIdentity); assert.equal(document.activeElement, search, 'Saved Library scoped refresh retains focus and host identity');

let customSearch = ''; let customSearchCalls = 0;
const custom = new CustomTagsWorkspaceModule(() => ({ tags: [{ id: 'tag-one', kind: 'tag', tag: 'blue eyes', zone: 'frame', presetId: 'default', description: '', createdAt: now, updatedAt: now }], presets: [{ id: 'default', name: 'My Tags', createdAt: now, updatedAt: now }], selectedPresetId: 'default', editingId: null, formKind: 'tag', search: customSearch, filter: 'all', creatingPreset: false, renamingPresetId: null, deletingPresetId: null, deleteError: '', warning: '', packStatus: '', packStatusKind: '', packAvailable: false, draftImageUrl: '', shadowedArtistIds: new Set(), defaultPresetId: 'default', imageUrl: () => 'nai-custom://asset/one', escape: String }), { search: value => { customSearch = value; customSearchCalls += 1; }, filter: () => {}, selectPreset: () => {}, beginCreatePreset: () => {}, cancelCreatePreset: () => {}, createPreset: () => {}, beginRenamePreset: () => {}, cancelRenamePreset: () => {}, renamePreset: () => {}, beginDeletePreset: () => {}, cancelDeletePreset: () => {}, confirmDeletePreset: () => {}, editTag: () => {}, deleteTag: () => {}, cancelEdit: () => {}, setKind: () => {}, readImage: () => {}, saveTag: () => {}, importPack: () => {}, exportPreset: () => {} });
controller.mount('custom-tags', custom.markup('workspace-panel'));
workspaceRouter = event => custom.route(event);
const customInput = document.querySelector('#custom-tag-search'); customInput.focus(); customInput.value = 'blue'; customInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert.equal(customSearchCalls, 1, 'Custom Tags delegated input fires exactly once');
custom.refresh(controller); assert.equal(document.activeElement, customInput, 'Custom Tags scoped refresh retains focus'); assert.match(controller.workspaceHost.textContent, /blue eyes/);

// Custom Tags patches preserve card and image identities while only changing
// the DOM slots. A changed card is replaced and clears a live shared hover;
// a newly added card is hydrated and receives the same preview binding.
const identityNow = '2026-08-31T00:00:00.000Z';
const identityTags = [
  { id: 'identity-a', kind: 'artist', tag: 'artist: Alpha', zone: 'frame', presetId: 'default', imageAsset: 'a.png', description: 'A', createdAt: identityNow, updatedAt: identityNow },
  { id: 'identity-b', kind: 'tag', tag: 'Blue eyes', zone: 'scene', presetId: 'default', imageAsset: 'b.png', description: 'B', createdAt: identityNow, updatedAt: identityNow },
  { id: 'identity-c', kind: 'tag', tag: 'Crimson light', zone: 'render', presetId: 'second', imageAsset: 'c.png', description: 'C', createdAt: identityNow, updatedAt: identityNow }
];
const escapeFixtureHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const identityState = {
  tags: identityTags, presets: [{ id: 'default', name: 'My Tags', createdAt: identityNow, updatedAt: identityNow }, { id: 'second', name: 'Second', createdAt: identityNow, updatedAt: identityNow }], selectedPresetId: 'default', editingId: null, formKind: 'tag', search: '', filter: 'all', creatingPreset: false, sort: 'default', renamingPresetId: null, deletingPresetId: null, deleteError: '', warning: '', packStatus: '', packStatusKind: '', packAvailable: false, draftImageUrl: '', shadowedArtistIds: new Set(), defaultPresetId: 'default', movePendingId: null, moveError: '', imageUrl: tag => `nai-custom://asset/${tag.imageAsset}`, escape: escapeFixtureHtml
};
const identityMoveCalls = [];
const identityActions = { search: value => { identityState.search = value; }, filter: value => { identityState.filter = value; }, selectPreset: value => { identityState.selectedPresetId = value; }, sort: value => { identityState.sort = value; }, moveTag: (id, presetId) => identityMoveCalls.push([id, presetId]), reorder: () => {}, beginCreatePreset: () => {}, cancelCreatePreset: () => {}, createPreset: () => {}, beginRenamePreset: () => {}, cancelRenamePreset: () => {}, renamePreset: () => {}, beginDeletePreset: () => {}, cancelDeletePreset: () => {}, confirmDeletePreset: () => {}, editTag: () => {}, deleteTag: () => {}, cancelEdit: () => {}, setKind: () => {}, readImage: () => {}, saveTag: () => {}, importPack: () => {}, exportPreset: () => {} };
const identityModule = new CustomTagsWorkspaceModule(() => identityState, identityActions);
controller.mount('custom-tags', identityModule.markup('workspace-panel'));
workspaceRouter = event => identityModule.route(event);
const identityGrid = document.querySelector('#custom-tag-grid');
const identityBefore = new Map([...identityGrid.querySelectorAll('[data-custom-card-id]')].map(node => [node.dataset.customCardId, { node, image: node.querySelector('img') }]));
identityGrid.scrollTop = 37;
const previewFetches = [];
const previewCache = new PreviewCache({
  fetch: async source => { previewFetches.push(source); return { ok: true, blob: async () => Buffer.from('preview') }; },
  createObjectURL: () => 'blob:custom-preview', revokeObjectURL: () => {},
  createImage: () => ({ dataset: {}, complete: true, naturalWidth: 2, naturalHeight: 2, classList: { add: () => {}, remove: () => {} }, decode: async () => {} }),
  schedule: callback => { callback(); return 0; }, setTimeout: () => 0, clearTimeout: () => {}
});
const hydrateAndBind = scope => { previewCache.hydrate(scope); bindArtistCardPreview(scope); };
identityState.tags = [identityTags[1], identityTags[0], identityTags[2]];
identityModule.refresh(controller, hydrateAndBind);
assert.deepEqual([...identityGrid.querySelectorAll('[data-custom-card-id]')].map(node => node.dataset.customCardId), ['identity-b', 'identity-a'], 'default folder retains its filtered order');
for (const id of ['identity-a', 'identity-b']) {
  const current = identityGrid.querySelector(`[data-custom-card-id="${id}"]`);
  assert.equal(current, identityBefore.get(id).node, `${id} card node is reused during reorder`);
  assert.equal(current.querySelector('img'), identityBefore.get(id).image, `${id} image node is reused during reorder`);
}
assert.equal(identityGrid.scrollTop, 37, 'Custom Tags patches retain grid scroll position');
const alpha = identityGrid.querySelector('[data-custom-card-id="identity-a"]'); alpha.dispatchEvent(new window.Event('pointerenter'));
const sharedPreview = document.querySelector('#artist-card-preview'); assert.equal(sharedPreview.classList.contains('is-visible'), true, 'custom artist cards bind the shared hover preview');
const beforeSourceChange = identityGrid.querySelector('[data-custom-card-id="identity-b"]'); beforeSourceChange.dispatchEvent(new window.Event('pointerenter'));
identityState.tags = identityState.tags.map(tag => tag.id === 'identity-b' ? { ...tag, imageAsset: 'b-replaced.png' } : tag);
identityModule.refresh(controller, hydrateAndBind);
const afterSourceChange = identityGrid.querySelector('[data-custom-card-id="identity-b"]');
assert.notEqual(afterSourceChange, beforeSourceChange, 'changed card content is replaced');
assert.notEqual(afterSourceChange.querySelector('img'), identityBefore.get('identity-b').image, 'changed card image is replaced with its new source');
assert.equal(sharedPreview.classList.contains('is-visible'), false, 'replacing an active card clears its shared hover preview');
const beforeRemoval = identityGrid.querySelector('[data-custom-card-id="identity-a"]'); beforeRemoval.dispatchEvent(new window.Event('pointerenter'));
identityState.tags = identityState.tags.filter(tag => tag.id !== 'identity-a');
identityModule.refresh(controller, hydrateAndBind);
assert.equal(identityGrid.querySelector('[data-custom-card-id="identity-a"]'), null, 'removed cards leave the grid');
assert.equal(sharedPreview.classList.contains('is-visible'), false, 'removing an active card clears its shared hover preview');
identityState.tags = [...identityState.tags, { id: 'identity-new', kind: 'artist', tag: 'artist: New', zone: 'frame', presetId: 'default', imageAsset: 'new.png', description: '', createdAt: identityNow, updatedAt: identityNow }];
identityModule.refresh(controller, hydrateAndBind);
const added = identityGrid.querySelector('[data-custom-card-id="identity-new"]');
assert.ok(added, 'new cards are mounted by the local patch');
assert.ok(previewFetches.includes('nai-custom://asset/new.png'), 'new cards are hydrated through the content preview cache');
added.dispatchEvent(new window.Event('pointerenter'));
assert.equal(sharedPreview.classList.contains('is-visible'), true, 'new artist cards receive the shared preview binding');

// Move controls expose pending/disabled state, update folder counts from a
// snapshot, preserve the workspace host, and recover after an error.
identityState.selectedPresetId = 'all'; identityState.movePendingId = 'identity-new';
identityModule.refresh(controller, hydrateAndBind);
const pendingCard = identityGrid.querySelector('[data-custom-card-id="identity-new"]');
assert.equal(pendingCard.getAttribute('aria-busy'), 'true');
assert.equal(pendingCard.querySelector('summary').getAttribute('aria-disabled'), 'true');
assert.equal(pendingCard.querySelector('[data-move-custom-tag]')?.hasAttribute('disabled'), true, 'pending move disables destination actions');
identityState.movePendingId = null; identityState.moveError = '';
identityState.tags = identityState.tags.map(tag => tag.id === 'identity-new' ? { ...tag, presetId: 'second' } : tag);
identityModule.refresh(controller, hydrateAndBind);
assert.equal(controller.workspaceHost, hostIdentity, 'move snapshot patch retains WorkspaceController host identity');
assert.match(document.querySelector('.preset-row[data-preset-id="second"] small').textContent, /2 cards/);
assert.match(document.querySelector('#custom-tag-move-status').textContent, /^$/);
identityState.moveError = 'simulated move failure';
identityState.tags = identityState.tags.map(tag => tag.id === 'identity-new' ? { ...tag, presetId: 'default' } : tag);
identityModule.refresh(controller, hydrateAndBind);
assert.equal(identityGrid.querySelector('[data-custom-card-id="identity-new"] small').textContent.includes('My Tags'), true, 'failed move snapshot keeps the source folder');
assert.equal(document.querySelector('#custom-tag-move-status').textContent, 'simulated move failure');
identityState.moveError = '';
const repeatMove = identityGrid.querySelector('[data-move-custom-tag="identity-new"][data-move-destination="second"]');
repeatMove.dispatchEvent(new window.Event('click', { bubbles: true }));
assert.deepEqual(identityMoveCalls.at(-1), ['identity-new', 'second'], 'a later move remains actionable after rollback');
previewCache.dispose();

const dragNow = '2026-08-31T00:00:00.000Z';
assert.deepEqual(swapCardOrderSlots(['a', 'b', 'c', 'd'], 'a', 'c'), ['c', 'b', 'a', 'd'], 'left-to-right swap preserves exact slots');
assert.deepEqual(swapCardOrderSlots(['a', 'b', 'c', 'd'], 'd', 'b'), ['a', 'd', 'c', 'b'], 'right-to-left swap preserves exact slots');
assert.deepEqual(swapCardOrderSlots(['a', 'b', 'c', 'd'], 'a', 'd'), ['d', 'b', 'c', 'a'], 'cross-row swap preserves exact slots');
assert.equal(swapCardOrderSlots(['a', 'b', 'c', 'd'], 'b', 'b'), null, 'same slot is a no-op');
assert.equal(swapCardOrderSlots(['a', 'b', 'c', 'd'], 'x', 'b'), null, 'unknown source is a no-op');
assert.equal(swapCardOrderSlots(['a', 'b', 'c', 'd'], 'a', 'x'), null, 'unknown target is a no-op');
const dragTags = ['a', 'b', 'c', 'd'].map((id, index) => ({ id, kind: 'tag', tag: id.toUpperCase(), zone: 'frame', presetId: 'default', description: '', createdAt: dragNow, updatedAt: dragNow }));
const dragState = { tags: dragTags, presets: [{ id: 'default', name: 'My Tags', createdAt: dragNow, updatedAt: dragNow }], selectedPresetId: 'default', editingId: null, formKind: 'tag', search: '', filter: 'all', creatingPreset: false, sort: 'default', renamingPresetId: null, deletingPresetId: null, deleteError: '', warning: '', packStatus: '', packStatusKind: '', packAvailable: false, draftImageUrl: '', shadowedArtistIds: new Set(), defaultPresetId: 'default', imageUrl: () => '', escape: String };
const reorderCalls = [];
const dragModule = new CustomTagsWorkspaceModule(() => dragState, { search: () => {}, filter: () => {}, selectPreset: () => {}, sort: () => {}, beginCreatePreset: () => {}, cancelCreatePreset: () => {}, createPreset: () => {}, beginRenamePreset: () => {}, cancelRenamePreset: () => {}, renamePreset: () => {}, beginDeletePreset: () => {}, cancelDeletePreset: () => {}, confirmDeletePreset: () => {}, editTag: () => {}, deleteTag: () => {}, cancelEdit: () => {}, setKind: () => {}, readImage: () => {}, saveTag: () => {}, moveTag: () => {}, reorder: ids => reorderCalls.push(ids), importPack: () => {}, exportPreset: () => {} });
controller.mount('custom-tags', dragModule.markup('workspace-panel'));
workspaceRouter = event => dragModule.route(event);
const dragCards = [...document.querySelectorAll('[data-custom-card-id]')];
const transfer = { effectAllowed: '', value: '', setData(_type, value) { this.value = value; }, getData() { return this.value; } };
dragCards[0].dispatchEvent(new window.Event('dragstart', { bubbles: true, cancelable: true }));
assert.equal(dragCards[1].getAttribute('draggable'), 'true');
dragCards[2].dispatchEvent(Object.assign(new window.Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: Object.assign(transfer, { value: 'a' }) }));
assert.deepEqual(reorderCalls.at(-1), ['c', 'b', 'a', 'd'], 'dropping A on C swaps exact target slots');
assert.deepEqual(reorderCalls.at(-1), ['c', 'b', 'a', 'd'], 'cross-row ordering uses DOM slot order');
dragCards[2].dispatchEvent(new window.Event('dragstart', { bubbles: true, cancelable: true }));
const imageTarget = document.querySelector('[data-custom-card-id="a"] img');
imageTarget.dispatchEvent(Object.assign(new window.Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: Object.assign(transfer, { value: 'c' }) }));
assert.deepEqual(reorderCalls.at(-1), ['c', 'b', 'a', 'd'], 'card images remain valid drop slots without becoming native drag sources');
const editButton = document.querySelector('[data-edit-custom-tag="a"]');
const guarded = new window.Event('dragstart', { bubbles: true, cancelable: true }); editButton.dispatchEvent(guarded);
assert.equal(guarded.defaultPrevented, true, 'card controls never start a reorder drag');
const guardedDrop = Object.assign(new window.Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: Object.assign(transfer, { value: 'c' }) });
editButton.dispatchEvent(guardedDrop);
assert.deepEqual(reorderCalls.at(-1), ['c', 'b', 'a', 'd'], 'card controls never become reorder drop targets');
dragCards[2].dispatchEvent(new window.Event('dragend', { bubbles: true }));
assert.equal(document.querySelector('[data-custom-card-id="a"]').querySelector('img').getAttribute('draggable'), 'false', 'card images opt out of native image dragging');
assert.deepEqual(reorderCalls.at(-1), ['c', 'b', 'a', 'd'], 'control drag does not reorder');
const reorderCountBeforeArrow = reorderCalls.length;
const arrowDown = document.querySelector('[data-custom-card-id="a"] [data-reorder-custom-tag="down"]');
arrowDown.dispatchEvent(new window.Event('click', { bubbles: true }));
assert.deepEqual(reorderCalls.at(-1), ['b', 'a', 'c', 'd'], 'default-folder arrow reorder swaps exact adjacent slots');
dragState.filter = 'frame';
arrowDown.dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(reorderCalls.length, reorderCountBeforeArrow + 1, 'filtered views are view-only for arrow reorder');
dragState.filter = 'all'; dragState.sort = 'a-z';
arrowDown.dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(reorderCalls.length, reorderCountBeforeArrow + 1, 'A-Z views are view-only for arrow reorder');
dragState.sort = 'default'; dragState.selectedPresetId = 'all';
const blockedAllDrag = new window.Event('dragstart', { bubbles: true, cancelable: true });
document.querySelector('[data-custom-card-id="a"]').dispatchEvent(blockedAllDrag);
assert.equal(blockedAllDrag.defaultPrevented, true, 'All Tags view disables drag reorder');
assert.equal(reorderCalls.length, reorderCountBeforeArrow + 1, 'All Tags drag does not reorder');

const previewTarget = document.createElement('article'); previewTarget.dataset.artistPreviewImage = ''; previewTarget.dataset.artistPreviewTag = 'Preview card'; document.body.append(previewTarget); bindArtistCardPreview(document);
previewTarget.dispatchEvent(new window.Event('pointerenter'));
const previewHost = document.querySelector('#artist-card-preview'); assert.equal(previewHost.classList.contains('is-visible'), true);
beginArtistCardPreviewDrag(); previewTarget.dispatchEvent(new window.Event('pointerenter')); assert.equal(previewHost.classList.contains('is-visible'), false, 'native Custom Tags drag suppresses shared hover preview');
endArtistCardPreviewDrag(); assert.equal(previewHost.classList.contains('is-visible'), false, 'ending drag leaves shared preview cleared');
controller.dispose();
console.log('Renderer behavior tests passed.');

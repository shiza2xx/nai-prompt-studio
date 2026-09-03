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
const { bindArtistCardPreview, beginArtistCardPreviewDrag, endArtistCardPreviewDrag, clearArtistCardPreview, configureArtistCardPreview, fitArtistCardPreview } = await import('../../src/artist-card-preview.ts');
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

const escapeFixtureHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const now = '2026-08-31T00:00:00.000Z'; let librarySearch = ''; let librarySearchCalls = 0;
const library = new SavedLibraryWorkspaceModule(() => ({ items: [{ version: 4, id: 'one', kind: 'character', source: 'manual', name: 'Mira', description: '', prompt: 'blue eyes', data: { positive: 'blue eyes', negative: 'blurry' }, createdAt: now, updatedAt: now }], search: librarySearch, filter: 'all', polarities: new Map(), panelClass: 'workspace-panel', imageUrl: () => '', escape: String }), { search: value => { librarySearch = value; librarySearchCalls += 1; }, filter: () => {}, create: () => {}, edit: () => {}, delete: () => {}, copy: () => {} });
controller.mount('saved-library', library.markup());
workspaceRouter = event => library.route(event);
const search = document.querySelector('#saved-library-search'); search.focus(); search.value = 'mira'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
assert.equal(librarySearchCalls, 1, 'Saved Library delegated input fires exactly once');
library.refresh(controller); assert.equal(controller.workspaceHost, hostIdentity); assert.equal(document.activeElement, search, 'Saved Library scoped refresh retains focus and host identity');
assert.equal(document.querySelector('#saved-library-grid').firstElementChild?.id, 'save-library-prompt', 'Saved Library creation remains the first grid item');
librarySearch = 'not found'; library.refresh(controller);
assert.equal(document.querySelector('#saved-library-grid').firstElementChild?.id, 'save-library-prompt', 'Saved Library creation remains first when search is empty');
assert.ok(document.querySelector('.saved-library-empty'), 'Saved Library presents its empty state beside the persistent creation path');
librarySearch = 'mira'; library.refresh(controller);

const libraryState = {
  items: [{ version: 4, id: 'library-preview', kind: 'character', source: 'manual', name: 'Preview character', description: '', prompt: 'silver eyes', data: { positive: 'silver eyes', negative: 'blurry' }, createdAt: now, updatedAt: now }],
  search: '', filter: 'all', polarities: new Map(), panelClass: 'workspace-panel', imageUrl: () => 'nai-custom://asset/library-preview.png', escape: escapeFixtureHtml
};
const previewLibrary = new SavedLibraryWorkspaceModule(() => libraryState, { search: () => {}, filter: () => {}, create: () => {}, edit: () => {}, delete: () => {}, copy: () => {} });
controller.mount('saved-library', previewLibrary.markup());
let libraryAfterPatch = 0;
previewLibrary.refresh(controller, () => { libraryAfterPatch += 1; });
const stableLibraryCard = document.querySelector('[data-saved-library-card="library-preview"]');
const stableLibraryImage = stableLibraryCard.querySelector('img');
previewLibrary.refresh(controller, () => { libraryAfterPatch += 1; });
assert.equal(document.querySelector('[data-saved-library-card="library-preview"]'), stableLibraryCard, 'unchanged Saved Library cards retain node identity');
assert.equal(document.querySelector('[data-saved-library-card="library-preview"] img'), stableLibraryImage, 'unchanged Saved Library covers retain image identity');
const stableLibraryCover = stableLibraryCard.querySelector('[data-library-preview-image]');
stableLibraryCover.dispatchEvent(new window.Event('pointerenter'));
const libraryPreviewHost = document.querySelector('#artist-card-preview');
const libraryPreviewImage = libraryPreviewHost.querySelector('img');
Object.defineProperty(libraryPreviewImage, 'naturalWidth', { configurable: true, value: 900 });
Object.defineProperty(libraryPreviewImage, 'naturalHeight', { configurable: true, value: 1600 });
await Promise.resolve(); await Promise.resolve(); libraryPreviewImage.dispatchEvent(new window.Event('load')); await Promise.resolve();
assert.equal(libraryPreviewHost.classList.contains('is-visible'), true, 'Saved Library covers bind the shared image preview');
const removedLibraryItem = libraryState.items[0];
libraryState.items = [];
previewLibrary.refresh(controller, () => { libraryAfterPatch += 1; });
assert.equal(document.querySelector('[data-saved-library-card="library-preview"]'), null, 'removed Saved Library cards leave the grid');
assert.equal(libraryPreviewHost.classList.contains('is-visible'), false, 'removing a Saved Library cover clears its active preview');
libraryState.items = [{ ...removedLibraryItem, name: 'Updated preview character', updatedAt: '2026-09-01T00:00:00.000Z' }];
previewLibrary.refresh(controller, () => { libraryAfterPatch += 1; });
assert.ok(document.querySelector('[data-saved-library-card="library-preview"] [data-library-preview-image]'), 're-added Saved Library covers mount with preview metadata');
assert.equal(libraryAfterPatch, 4, 'Saved Library refresh invokes hydration after every scoped patch');

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
const sharedPreview = document.querySelector('#artist-card-preview'); const alphaPreviewImage = sharedPreview.querySelector('img');
Object.defineProperty(alphaPreviewImage, 'naturalWidth', { configurable: true, value: 1200 }); Object.defineProperty(alphaPreviewImage, 'naturalHeight', { configurable: true, value: 800 });
await Promise.resolve(); await Promise.resolve(); alphaPreviewImage.dispatchEvent(new window.Event('load')); await Promise.resolve();
assert.equal(sharedPreview.classList.contains('is-visible'), true, 'custom artist cards bind the shared hover preview');
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
const addedPreviewImage = sharedPreview.querySelector('img');
Object.defineProperty(addedPreviewImage, 'complete', { configurable: true, value: false });
Object.defineProperty(addedPreviewImage, 'naturalWidth', { configurable: true, value: 1200 });
Object.defineProperty(addedPreviewImage, 'naturalHeight', { configurable: true, value: 800 });
await Promise.resolve(); await Promise.resolve(); addedPreviewImage.dispatchEvent(new window.Event('load')); await Promise.resolve();
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

// Custom Tags selection patches must update the already-rendered toolbar when
// a checkbox changes. This guards the stateful path separately from the
// initial markup path: stale counts/disabled controls would make batch actions
// appear available while sending an empty selection.
const selectState = {
  tags: ['one', 'two'].map((id, index) => ({ id, kind: 'tag', tag: id.toUpperCase(), zone: 'frame', presetId: 'default', description: '', createdAt: dragNow, updatedAt: dragNow })),
  presets: [{ id: 'default', name: 'My Tags', createdAt: dragNow, updatedAt: dragNow }, { id: 'target', name: 'Target', createdAt: dragNow, updatedAt: dragNow }], selectedPresetId: 'default', editingId: null, formKind: 'tag', search: '', filter: 'all', sort: 'default', creatingPreset: false, renamingPresetId: null, deletingPresetId: null, deleteError: '', warning: '', packStatus: '', packStatusKind: '', packAvailable: true, draftImageUrl: '', shadowedArtistIds: new Set(), defaultPresetId: 'default', movePendingId: null, moveError: '', selectMode: true, selectedIds: new Set(), batchPending: false, batchError: '', imageUrl: () => '', escape: escapeFixtureHtml
};
let selectModule;
const batchMoveCalls = [];
const selectActions = { search: () => {}, filter: () => {}, selectPreset: () => {}, sort: () => {}, beginCreatePreset: () => {}, cancelCreatePreset: () => {}, createPreset: () => {}, beginRenamePreset: () => {}, cancelRenamePreset: () => {}, renamePreset: () => {}, beginDeletePreset: () => {}, cancelDeletePreset: () => {}, confirmDeletePreset: () => {}, editTag: () => {}, deleteTag: () => {}, cancelEdit: () => {}, setKind: () => {}, readImage: () => {}, saveTag: () => {}, moveTag: () => {}, reorder: () => {}, importPack: () => {}, exportPreset: () => {}, toggleSelect: id => { if (selectState.selectedIds.has(id)) selectState.selectedIds.delete(id); else selectState.selectedIds.add(id); selectModule.refresh(controller); }, toggleSelectMode: () => {}, selectVisible: () => {}, clearSelection: () => {}, batchMove: destination => { batchMoveCalls.push(destination); }, batchDelete: () => {} };
selectModule = new CustomTagsWorkspaceModule(() => selectState, selectActions);
controller.mount('custom-tags', selectModule.markup('workspace-panel'));
workspaceRouter = event => selectModule.route(event);
const selectCheckbox = document.querySelector('[data-select-custom-tag="one"]'); assert.ok(selectCheckbox);
selectCheckbox.checked = true; selectCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.equal(document.querySelector('.custom-select-toolbar b').textContent, '1 selected', 'selection patches refresh the toolbar count');
assert.equal(document.querySelector('[data-batch-move-combobox]').hasAttribute('disabled'), false, 'batch move enables after selecting a card');
assert.equal(document.querySelector('[data-batch-delete]').hasAttribute('disabled'), false, 'batch delete enables after selecting a card');
const batchMoveCombo = document.querySelector('[data-batch-move-combobox]');
batchMoveCombo.dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(batchMoveCombo.getAttribute('aria-expanded'), 'true', 'batch move opens its themed listbox');
assert.equal(document.querySelector('[data-batch-move-listbox]').classList.contains('is-hidden'), false, 'batch move listbox is visible while expanded');
batchMoveCombo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
batchMoveCombo.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
assert.deepEqual(batchMoveCalls, ['target'], 'keyboard selection sends the chosen preset to batch move');
batchMoveCombo.dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(batchMoveCombo.getAttribute('aria-expanded'), 'true');
document.body.dispatchEvent(new window.Event('mousedown', { bubbles: true }));
assert.equal(batchMoveCombo.getAttribute('aria-expanded'), 'false', 'outside pointer interaction closes the batch move listbox');
const deleteIcon = document.querySelector('[data-batch-delete]').innerHTML;
selectState.batchPending = true; selectModule.refresh(controller);
assert.equal(document.querySelector('[data-batch-move-combobox]').hasAttribute('disabled'), true, 'batch move disables while the transaction is pending');
const pendingDelete = document.querySelector('[data-batch-delete]');
assert.equal(pendingDelete.getAttribute('aria-label'), 'Delete selected', 'batch delete keeps its accessible label while pending');
assert.equal(pendingDelete.innerHTML, deleteIcon, 'batch delete keeps its trash icon while pending');
assert.equal(document.querySelector('[data-batch-status]').textContent, 'Working…', 'batch status reports pending work separately from the icon');
assert.equal(document.querySelector('.custom-select-toolbar').getAttribute('aria-busy'), 'true', 'batch toolbar exposes pending state');
assert.equal(document.querySelector('[data-select-custom-tag="one"]').disabled, true, 'selection checkboxes lock while their batch is in flight');
selectState.batchPending = false; selectState.batchError = 'Batch move failed'; selectModule.refresh(controller);
assert.equal(document.querySelector('.custom-batch-error').hidden, false, 'batch failures become visible without replacing cards');
assert.equal(document.querySelector('.custom-batch-error').textContent, 'Batch move failed');

// Select Mode routes non-interactive card surfaces to one selection toggle;
// explicit controls and a pending batch remain isolated/locked.
const selectableCard = document.querySelector('[data-custom-card-id="one"]');
selectableCard.querySelector('b').dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(selectState.selectedIds.has('one'), false, 'card text toggles selection');
selectableCard.querySelector('img').dispatchEvent(new window.Event('click', { bubbles: true }));
assert.equal(selectState.selectedIds.has('one'), true, 'card image toggles selection');
const checkboxClick = selectableCard.querySelector('[data-select-custom-tag="one"]');
checkboxClick.checked = false; checkboxClick.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.equal(selectState.selectedIds.has('one'), false, 'checkbox toggles selection once');
const selectedBeforePendingClick = new Set(selectState.selectedIds);
selectState.batchPending = true; selectModule.refresh(controller);
document.querySelector('[data-custom-card-id="two"] img').dispatchEvent(new window.Event('click', { bubbles: true }));
assert.deepEqual([...selectState.selectedIds], [...selectedBeforePendingClick], 'pending batches lock card-body selection');
selectState.batchPending = false; selectModule.refresh(controller);

assert.deepEqual(fitArtistCardPreview(1000, 1000, 380, 520), { width: 380, height: 380 }, 'square previews fit the width bound');
assert.deepEqual(fitArtistCardPreview(1600, 900, 380, 520), { width: 380, height: 213.75 }, 'landscape previews preserve intrinsic ratio');
assert.deepEqual(fitArtistCardPreview(900, 1600, 380, 520), { width: 292.5, height: 520 }, 'portrait previews fit the height bound');
assert.deepEqual(fitArtistCardPreview(100, 100, 380, 520), { width: 380, height: 380 }, 'small previews upscale to the largest fitting bounds');
assert.deepEqual(fitArtistCardPreview(0, 100, 380, 520), { width: 0, height: 0 }, 'invalid intrinsic dimensions do not create a fake 1x1 preview');

const previewTarget = document.createElement('article'); previewTarget.dataset.artistPreviewImage = ''; previewTarget.dataset.artistPreviewTag = 'Preview card'; document.body.append(previewTarget); bindArtistCardPreview(document);
previewTarget.dispatchEvent(new window.Event('pointerenter'));
const previewHost = document.querySelector('#artist-card-preview'); assert.equal(previewHost.classList.contains('is-visible'), true);
beginArtistCardPreviewDrag(); previewTarget.dispatchEvent(new window.Event('pointerenter')); assert.equal(previewHost.classList.contains('is-visible'), false, 'native Custom Tags drag suppresses shared hover preview');
endArtistCardPreviewDrag(); assert.equal(previewHost.classList.contains('is-visible'), false, 'ending drag leaves shared preview cleared');

// Pointer activation of an interactive descendant must not transfer keyboard
// ownership to the shared preview. This covers the Reroll button, numeric
// weight input, and native range input; a real keyboard focus still pins until
// focusout.
const focusOwnershipTarget = document.createElement('article'); focusOwnershipTarget.dataset.artistPreviewImage = ''; focusOwnershipTarget.dataset.artistPreviewTag = 'Focus ownership card';
const focusOwnershipControls = [document.createElement('button'), document.createElement('input'), document.createElement('input')];
focusOwnershipControls[0].type = 'button'; focusOwnershipControls[0].textContent = 'Reroll'; focusOwnershipControls[1].type = 'number'; focusOwnershipControls[2].type = 'range'; focusOwnershipTarget.append(...focusOwnershipControls); document.body.append(focusOwnershipTarget); bindArtistCardPreview(document);
const dispatchPointer = (control, type) => { const event = new window.Event(type, { bubbles: true }); Object.defineProperty(event, 'clientX', { value: 0 }); Object.defineProperty(event, 'clientY', { value: 0 }); control.dispatchEvent(event); };
for (const control of focusOwnershipControls) {
  clearArtistCardPreview(); focusOwnershipTarget.dispatchEvent(new window.Event('pointerenter'));
  dispatchPointer(control, 'pointerdown'); control.focus(); dispatchPointer(control, 'pointerup');
  focusOwnershipTarget.dispatchEvent(new window.Event('pointerleave'));
  assert.equal(previewHost.classList.contains('is-visible'), false, `${control.type} pointer focus does not pin the preview`);
  control.blur();
}
clearArtistCardPreview(); focusOwnershipTarget.dispatchEvent(new window.Event('pointerenter')); focusOwnershipControls[1].focus();
focusOwnershipTarget.dispatchEvent(new window.Event('pointerleave'));
assert.equal(previewHost.classList.contains('is-visible'), true, 'keyboard focus pins the preview after pointer leaves');
focusOwnershipControls[1].blur(); assert.equal(previewHost.classList.contains('is-visible'), false, 'keyboard focusout releases the pinned preview');
controller.dispose();
console.log('Renderer behavior tests passed.');

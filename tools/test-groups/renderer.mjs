import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
await import('../test-suites/renderer-domain.mjs');
await import('../test-suites/renderer-static.mjs');
await import('../test-suites/library-mix-static.mjs');

const window = new Window({ url: 'https://localhost/' });
Object.assign(globalThis, { window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement, HTMLFormElement: window.HTMLFormElement, KeyboardEvent: window.KeyboardEvent });
const { WorkspaceController } = await import('../../src/workspace-controller.ts');
const { SavedLibraryWorkspaceModule } = await import('../../src/workspaces/saved-library-workspace.ts');
const { CustomTagsWorkspaceModule } = await import('../../src/workspaces/custom-tags-workspace.ts');
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
controller.dispose();
console.log('Renderer behavior tests passed.');

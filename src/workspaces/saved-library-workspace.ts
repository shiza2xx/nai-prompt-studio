import type { SavedLibraryItem } from '../types';
import type { WorkspaceController } from '../workspace-controller';

export type SavedLibraryFilter = 'all' | SavedLibraryItem['kind'];
type Polarity = 'positive' | 'negative';
export interface SavedLibraryPolarityState { base: Polarity; characters: Polarity[]; }
export interface SavedLibraryWorkspaceState {
  items: SavedLibraryItem[]; search: string; filter: SavedLibraryFilter;
  polarities: Map<string, SavedLibraryPolarityState>; panelClass: string;
  imageUrl(item: SavedLibraryItem): string; escape(value: unknown): string;
}
export interface SavedLibraryWorkspaceActions {
  search(value: string): void; filter(value: SavedLibraryFilter): void;
  create(kind: SavedLibraryItem['kind']): void; edit(id: string): void; delete(id: string): void;
  copy(value: string, selector: string): void;
}

export class SavedLibraryWorkspaceModule {
  private readonly state: () => SavedLibraryWorkspaceState;
  private readonly actions: SavedLibraryWorkspaceActions;
  constructor(state: () => SavedLibraryWorkspaceState, actions: SavedLibraryWorkspaceActions) { this.state = state; this.actions = actions; }

  private visible(state = this.state()): SavedLibraryItem[] {
    const query = state.search.trim().toLocaleLowerCase();
    return state.items.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).filter(item => {
      const detail = item.kind === 'prompt'
        ? `${item.data?.positive ?? ''} ${item.data?.negative ?? ''} ${item.data?.characters.map(c => `${c.label} ${c.positive} ${c.negative}`).join(' ') ?? ''}`
        : item.kind === 'artist-mix' ? `${item.data?.serializedPrompt ?? ''} ${item.data?.artists.map(a => a.tag).join(' ') ?? ''}` : `${item.data?.positive ?? ''} ${item.data?.negative ?? ''}`;
      return (state.filter === 'all' || item.kind === state.filter) && (!query || `${item.name} ${item.description ?? ''} ${item.prompt} ${item.originalName ?? ''} ${detail}`.toLocaleLowerCase().includes(query));
    });
  }
  private side(item: SavedLibraryItem, index: number, polarity: Polarity): string {
    if (item.kind === 'character') return item.data[polarity];
    if (item.kind !== 'prompt') return '';
    return index < 0 ? (polarity === 'positive' ? item.data?.positive ?? item.prompt : item.data?.negative ?? '') : item.data?.characters[index]?.[polarity] ?? '';
  }
  private card(item: SavedLibraryItem, state: SavedLibraryWorkspaceState): string {
    const e = state.escape; const image = state.imageUrl(item); const label = item.kind === 'artist-mix' ? 'Artist Mix' : item.kind === 'character' ? 'Character' : 'Prompt';
    const polarity = state.polarities.get(item.id) ?? { base: 'positive' as const, characters: (item.kind === 'prompt' ? item.data?.characters ?? [] : []).map(() => 'positive' as const) }; state.polarities.set(item.id, polarity);
    const block = (name: string, value: { positive: string; negative: string }, index: number, active: Polarity) => `<article class="saved-library-prompt" data-library-block="${e(item.id)}:${index}"><header><b>${e(name)}</b><div class="metadata-toggle" role="group" aria-label="${e(name)} polarity"><button type="button" class="${active === 'positive' ? 'on' : ''}" data-library-polarity="${e(item.id)}" data-library-index="${index}" data-polarity="positive" aria-pressed="${active === 'positive'}">Positive</button><button type="button" class="${active === 'negative' ? 'on' : ''}" data-library-polarity="${e(item.id)}" data-library-index="${index}" data-polarity="negative" aria-pressed="${active === 'negative'}">Negative</button></div></header><pre>${e(value[active] || '(No prompt recorded for this side.)')}</pre><button class="library-copy-icon" type="button" data-library-copy="${e(item.id)}" data-library-index="${index}" aria-label="Copy ${e(name)} ${active} prompt" title="Copy ${e(name)} ${active} prompt" ${value[active] ? '' : 'disabled'}></button></article>`;
    const generation = item.kind === 'prompt' ? [item.data?.model, item.data?.steps && `${item.data.steps} steps`, item.data?.sampler, item.data?.width && item.data?.height && `${item.data.width} x ${item.data.height}`, item.data?.cfg && `CFG ${item.data.cfg}`].filter(Boolean) : [];
    const details = item.kind === 'prompt' ? `<details class="saved-library-details"><summary>Prompt details</summary>${block('Base prompt', { positive: item.data?.positive ?? item.prompt, negative: item.data?.negative ?? '' }, -1, polarity.base)}${(item.data?.characters ?? []).map((c, i) => block(c.label, c, i, polarity.characters[i] ?? 'positive')).join('')}${generation.length ? `<div class="saved-library-generation"><span>Generation metadata</span><code>${e(generation.join(' | '))}</code></div>` : ''}</details>` : item.kind === 'artist-mix' ? `<details class="saved-library-details"><summary>Artist details</summary><code>${e(item.data?.artists.map(a => `${a.tag} (${a.weight})`).join(', ') || 'No structured artists')}</code></details>` : `<details class="saved-library-details"><summary>Character details</summary>${block(item.name, item.data, -1, polarity.base)}</details>`;
    const prompt = item.kind === 'prompt' ? item.data?.positive ?? item.prompt : item.kind === 'artist-mix' ? item.data?.serializedPrompt ?? item.prompt : item.data.positive;
    const preview = image ? ` tabindex="0" role="img" aria-label="Preview cover for ${e(item.name)}" data-library-preview-image="${e(image)}" data-library-preview-tag="${e(item.name)}" data-library-preview-prompt="${e(prompt)}" data-library-preview-description="${e(item.description ?? '')}"` : '';
    return `<article class="saved-library-card" data-saved-library-card="${e(item.id)}"><div class="saved-library-cover${image ? ' has-image' : ''}"${preview}>${image ? `<img data-preview-cache="content" data-preview-src="${e(image)}" alt="" loading="lazy">` : '<span aria-hidden="true">✦</span>'}</div><div class="saved-library-card-body"><div class="saved-library-card-heading"><div><p class="eyebrow">${label}</p><h3>${e(item.name)}</h3></div><time datetime="${e(item.updatedAt)}">${e(new Date(item.updatedAt).toLocaleDateString())}</time></div><p class="saved-library-description">${e(item.description || 'No description.')}</p>${details}<div class="saved-library-actions"><button class="secondary saved-library-rounded" type="button" data-edit-library="${e(item.id)}">Edit</button><button class="secondary saved-library-rounded" type="button" data-delete-library="${e(item.id)}">Delete</button></div></div></article>`;
  }
  private grid(state = this.state()): string {
    const items = this.visible(state); if (items.length) return items.map(item => this.card(item, state)).join('');
    return `<div class="saved-library-empty"><span class="brand-mark">✦</span><h3>${state.items.length ? 'No saved items match this search.' : 'Your Saved Library is ready.'}</h3><p>${state.items.length ? 'Try a different name or type filter.' : 'Create an independent prompt, Artist Mix, or Character record.'}</p><button class="secondary" type="button" id="save-library-empty">New Prompt</button></div>`;
  }
  markup(): string {
    const s = this.state(); const e = s.escape; const filters: Array<[SavedLibraryFilter, string]> = [['all', 'All'], ['prompt', 'Prompts'], ['artist-mix', 'Artist Mix'], ['character', 'Characters']];
    return `<section id="saved-library-panel" class="${s.panelClass} saved-library-workspace" role="tabpanel" aria-labelledby="saved-library-tab"><header class="workspace-intro"><div><p class="eyebrow">PERSONAL LIBRARY</p><h2 id="saved-library-title">Saved Library</h2><p>Create independent prompt, Artist Mix, and Character records on this device.</p></div><div class="saved-library-header-actions"><button class="primary" id="save-library-prompt" type="button">＋ New Prompt</button><button class="secondary" id="save-library-mix" type="button">＋ New Artist Mix</button><button class="secondary" id="save-library-character" type="button">＋ New Character</button></div></header><div class="saved-library-tools"><input id="saved-library-search" value="${e(s.search)}" placeholder="Search saved items..." aria-label="Search Saved Library"><div class="saved-library-filter" role="group" aria-label="Filter Saved Library">${filters.map(([value, label]) => `<button class="chip ${s.filter === value ? 'on' : ''}" type="button" data-library-filter="${value}" aria-pressed="${s.filter === value}">${label}</button>`).join('')}</div></div><div class="saved-library-grid" id="saved-library-grid">${this.grid(s)}</div></section>`;
  }
  refresh(controller: WorkspaceController): void { const s = this.state(); controller.patch({ kind: 'fragment', selector: '#saved-library-grid', markup: this.grid(s) }); document.querySelectorAll<HTMLButtonElement>('[data-library-filter]').forEach(b => { const on = b.dataset.libraryFilter === s.filter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  route(event: Event): boolean {
    const element = event.target instanceof Element ? event.target : null;
    if (event.type === 'input' && element instanceof HTMLInputElement && element.id === 'saved-library-search') { this.actions.search(element.value); return true; }
    if (event.type !== 'click') return false; const button = element?.closest<HTMLButtonElement>('button'); if (!button) return false;
    if (button.dataset.libraryFilter) { this.actions.filter(button.dataset.libraryFilter as SavedLibraryFilter); return true; }
    if (button.id === 'save-library-prompt' || button.id === 'save-library-empty') { this.actions.create('prompt'); return true; } if (button.id === 'save-library-mix') { this.actions.create('artist-mix'); return true; } if (button.id === 'save-library-character') { this.actions.create('character'); return true; }
    if (button.dataset.editLibrary) { this.actions.edit(button.dataset.editLibrary); return true; } if (button.dataset.deleteLibrary) { this.actions.delete(button.dataset.deleteLibrary); return true; }
    const s = this.state(); const item = s.items.find(x => x.id === (button.dataset.libraryPolarity ?? button.dataset.libraryCopy)); if (!item || (item.kind !== 'prompt' && item.kind !== 'character')) return false;
    const index = Number(button.dataset.libraryIndex); const stored = s.polarities.get(item.id) ?? { base: 'positive' as const, characters: item.kind === 'prompt' ? item.data?.characters.map(() => 'positive' as const) ?? [] : [] };
    if (button.dataset.libraryPolarity) { const polarity = button.dataset.polarity === 'negative' ? 'negative' : 'positive'; if (index < 0) stored.base = polarity; else stored.characters[index] = polarity; s.polarities.set(item.id, stored); const block = button.closest<HTMLElement>('[data-library-block]'); block?.querySelectorAll<HTMLButtonElement>('[data-library-polarity]').forEach(b => { const on = b.dataset.polarity === polarity; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); const value = this.side(item, index, polarity); const pre = block?.querySelector<HTMLElement>('pre'); if (pre) pre.textContent = value || '(No prompt recorded for this side.)'; const copy = block?.querySelector<HTMLButtonElement>('[data-library-copy]'); if (copy) copy.disabled = !value; return true; }
    if (button.dataset.libraryCopy) { const polarity = index < 0 ? stored.base : stored.characters[index] ?? 'positive'; const value = this.side(item, index, polarity); if (value) this.actions.copy(value, `[data-library-copy="${item.id}"][data-library-index="${index}"]`); return true; }
    return false;
  }
}

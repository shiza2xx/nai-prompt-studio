import type { CustomTag, CustomTagKind, CustomTagPreset, CustomTagZone } from '../types';
import type { WorkspaceController } from '../workspace-controller';
import { beginArtistCardPreviewDrag, clearArtistCardPreview, endArtistCardPreviewDrag, bindArtistCardPreview } from '../artist-card-preview.ts';

export type CustomTagFilter = CustomTagZone | 'artist' | 'all';
export type CustomTagSort = 'default' | 'a-z';
export interface CustomTagFormDraft { tag: string; description: string; zone: CustomTagZone; }
export interface CustomTagsWorkspaceState {
  tags: CustomTag[]; presets: CustomTagPreset[]; selectedPresetId: string; editingId: string | null;
  formKind: CustomTagKind; search: string; filter: CustomTagFilter; creatingPreset: boolean;
  formDraft?: CustomTagFormDraft | null;
  sort: CustomTagSort;
  renamingPresetId: string | null; deletingPresetId: string | null; deleteError: string; warning: string;
  packStatus: string; packStatusKind: '' | 'success' | 'error' | 'cancelled'; packAvailable: boolean;
  draftImageUrl: string; shadowedArtistIds: ReadonlySet<string>; defaultPresetId: string;
  movePendingId: string | null; moveError: string;
  selectMode?: boolean; selectedIds?: ReadonlySet<string>; batchPending?: boolean; batchError?: string;
  imageUrl(tag: CustomTag): string; escape(value: unknown): string;
}
export interface CustomTagsWorkspaceActions {
  search(value: string): void; filter(value: CustomTagFilter): void; selectPreset(id: string): void; sort(value: CustomTagSort): void;
  beginCreatePreset(): void; cancelCreatePreset(): void; createPreset(name: string): void;
  beginRenamePreset(id: string): void; cancelRenamePreset(): void; renamePreset(id: string, name: string): void;
  beginDeletePreset(id: string): void; cancelDeletePreset(): void; confirmDeletePreset(id: string, mode: 'move' | 'delete'): void;
  editTag(id: string): void; deleteTag(id: string): void; cancelEdit(): void; setKind(kind: CustomTagKind): void;
  readImage(file?: File): void; saveTag(): void; moveTag(id: string, presetId: string): void; reorder(ids: string[]): void; importPack(): void; exportPreset(id: string): void;
  toggleSelect(id: string): void; toggleSelectMode(): void; selectVisible(ids: string[]): void; clearSelection(): void; batchMove(destinationPresetId: string): void; batchDelete(): void;
}

/** Return a new card order with the two exact slots exchanged, or null when no swap is valid. */
export function swapCardOrderSlots(ids: readonly string[], sourceId: string, targetId: string): string[] | null {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (!sourceId || !targetId || sourceId === targetId || sourceIndex < 0 || targetIndex < 0) return null;
  const swapped = [...ids];
  [swapped[sourceIndex], swapped[targetIndex]] = [swapped[targetIndex], swapped[sourceIndex]];
  return swapped;
}

export class CustomTagsWorkspaceModule {
  private readonly state: () => CustomTagsWorkspaceState;
  private readonly actions: CustomTagsWorkspaceActions;
  private draggingCardId: string | null = null;
  private batchMoveToolbar: HTMLElement | null = null;
  private batchMoveOpen = false;
  private batchMoveActiveId: string | null = null;
  private batchMoveOutsideHandler: ((event: MouseEvent) => void) | null = null;
  constructor(state: () => CustomTagsWorkspaceState, actions: CustomTagsWorkspaceActions) { this.state = state; this.actions = actions; }
  private presetId(tag: CustomTag, state: CustomTagsWorkspaceState): string { return tag.presetId || state.defaultPresetId; }
  private reorderEnabled(state: CustomTagsWorkspaceState): boolean {
    return !state.selectMode && state.selectedPresetId !== 'all' && state.sort === 'default' && state.filter === 'all' && !state.search.trim() && state.presets.some(preset => preset.id === state.selectedPresetId);
  }
  private sortKey(value: string): string[] { return value.toLocaleLowerCase().split(/(\d+)/).map(part => /^\d+$/.test(part) ? part.padStart(12, '0') : part); }
  visible(state = this.state()): CustomTag[] {
    const query = state.search.trim().toLocaleLowerCase();
    const cards = state.tags.filter(tag => (state.selectedPresetId === 'all' || this.presetId(tag, state) === state.selectedPresetId)
      && (!query || `${tag.tag} ${tag.description ?? ''}`.toLocaleLowerCase().includes(query))
      && (state.filter === 'all' || (state.filter === 'artist' ? tag.kind === 'artist' : tag.kind !== 'artist' && tag.zone === state.filter)));
    if (state.sort !== 'a-z') return cards;
    return cards.map((tag, index) => ({ tag, index })).sort((a, b) => {
      const left = this.sortKey(a.tag.tag); const right = this.sortKey(b.tag.tag);
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) { const comparison = (left[i] ?? '').localeCompare(right[i] ?? '', undefined, { numeric: false }); if (comparison) return comparison; }
      return a.index - b.index;
    }).map(item => item.tag);
  }
  private count(id: string, state: CustomTagsWorkspaceState): number { return state.tags.filter(tag => this.presetId(tag, state) === id).length; }
  private cardSignature(tag: CustomTag, state: CustomTagsWorkspaceState): string {
    const description = tag.description?.trim() ?? ''; const image = state.imageUrl(tag); const canReorder = this.reorderEnabled(state);
    const artist = tag.kind === 'artist';
    const status = artist && state.shadowedArtistIds.has(tag.id) ? 'NAX card active' : artist ? 'Artist' : tag.zone === 'render' ? 'Render / Quality' : tag.zone[0].toUpperCase() + tag.zone.slice(1);
    // Folder membership and the global move state are patched into retained
    // nodes below. Keeping them out of this structural signature means a
    // filter/sort/tab return, or another card's move, never replaces images
    // whose original bytes are still in the content cache.
    return JSON.stringify({ id: tag.id, tag: tag.tag, kind: tag.kind, zone: tag.zone, description, image, status, canReorder, selectMode: state.selectMode });
  }
  private moveMarkup(tag: CustomTag, state: CustomTagsWorkspaceState): string {
    const esc = state.escape; const currentPreset = this.presetId(tag, state); const moving = state.movePendingId === tag.id; const moveDisabled = Boolean(state.movePendingId);
    const destinations = state.presets.filter(item => item.id !== currentPreset).map(item => `<button class="tiny-copy custom-move-option" type="button" data-move-custom-tag="${esc(tag.id)}" data-move-destination="${esc(item.id)}"${moveDisabled ? ' disabled' : ''}>${esc(item.name)}</button>`).join('');
    return `<details class="custom-move-details" draggable="false"><summary class="tiny-copy" draggable="false"${moveDisabled ? ' aria-disabled="true"' : ''}>${moving ? 'Moving…' : 'Move'}</summary><div class="custom-move-menu" role="menu" aria-label="Move ${esc(tag.tag)} to a folder">${destinations || '<span class="custom-move-empty">No other folders</span>'}</div></details>`;
  }
  private selectedCount(cards: readonly CustomTag[], state: CustomTagsWorkspaceState): number {
    return [...(state.selectedIds ?? new Set<string>())].filter(id => cards.some(card => card.id === id)).length;
  }
  private batchMoveOptions(state: CustomTagsWorkspaceState): string {
    const esc = state.escape;
    return state.presets.map(preset => {
      const selected = preset.id === this.batchMoveActiveId;
      return `<li id="custom-batch-move-option-${esc(preset.id)}" role="option" data-batch-move-option="${esc(preset.id)}" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}">${esc(preset.name)}</li>`;
    }).join('');
  }
  private selectToolbar(cards: readonly CustomTag[], state: CustomTagsWorkspaceState): string {
    const selectedCount = this.selectedCount(cards, state); const disabled = Boolean(state.batchPending || !selectedCount); const esc = state.escape;
    const active = state.presets.find(preset => preset.id === this.batchMoveActiveId);
    const listboxId = 'custom-batch-move-listbox';
    return `<div class="custom-select-toolbar" role="toolbar" aria-label="Selected cards" aria-busy="${Boolean(state.batchPending)}"><b data-selected-count>${selectedCount} selected</b><button class="tiny-copy custom-select-action" type="button" data-select-visible="true"${state.batchPending ? ' disabled' : ''}>Select all visible</button><div class="custom-batch-move-field"><span id="custom-batch-move-label">Move to</span><button id="custom-batch-move" class="custom-batch-move" data-batch-move-combobox type="button" role="combobox" aria-haspopup="listbox" aria-expanded="${this.batchMoveOpen && !disabled}" aria-controls="${listboxId}" aria-labelledby="custom-batch-move-label custom-batch-move-value"${disabled ? ' disabled' : ''}><span id="custom-batch-move-value" data-batch-move-value>${esc(active?.name ?? 'Choose folder')}</span><span class="custom-batch-move-arrow" aria-hidden="true"></span></button><ul id="${listboxId}" class="custom-batch-move-listbox${this.batchMoveOpen && !disabled ? '' : ' is-hidden'}" data-batch-move-listbox role="listbox" aria-labelledby="custom-batch-move-label">${this.batchMoveOptions(state)}</ul></div><button class="danger-button custom-batch-delete" type="button" data-batch-delete aria-label="Delete selected" title="Delete selected" aria-busy="${Boolean(state.batchPending)}"${disabled ? ' disabled' : ''}>&#x1F5D1;&#xFE0E;</button><span class="custom-batch-status" data-batch-status role="status" aria-live="polite"${state.batchPending ? '' : ' hidden'}>${state.batchPending ? 'Working…' : ''}</span><button class="tiny-copy custom-select-action" type="button" data-clear-selection="true"${state.batchPending ? ' disabled' : ''}>Clear</button><span class="custom-batch-error" role="alert"${state.batchError ? '' : ' hidden'}>${state.batchError ? esc(state.batchError) : ''}</span></div>`;
  }
  private bindBatchMoveToolbar(toolbar: HTMLElement): void {
    this.batchMoveToolbar = toolbar;
  }
  private bindBatchMoveOutside(): void {
    if (this.batchMoveOutsideHandler) return;
    this.batchMoveOutsideHandler = (event: MouseEvent) => {
      const toolbar = this.batchMoveToolbar;
      const target = event.target;
      if (this.batchMoveOpen && toolbar && (!target || !toolbar.contains(target as Node))) this.closeBatchMove(false);
    };
    document.addEventListener('mousedown', this.batchMoveOutsideHandler);
  }
  private unbindBatchMoveOutside(): void {
    if (!this.batchMoveOutsideHandler) return;
    document.removeEventListener('mousedown', this.batchMoveOutsideHandler);
    this.batchMoveOutsideHandler = null;
  }
  private closeBatchMove(returnFocus: boolean, reset = false): void {
    this.batchMoveOpen = false;
    this.unbindBatchMoveOutside();
    if (reset) this.batchMoveActiveId = null;
    const toolbar = this.batchMoveToolbar;
    if (!toolbar) return;
    const combo = toolbar.querySelector<HTMLButtonElement>('[data-batch-move-combobox]');
    const listbox = toolbar.querySelector<HTMLElement>('[data-batch-move-listbox]');
    if (combo) combo.setAttribute('aria-expanded', 'false');
    if (listbox) listbox.classList.add('is-hidden');
    if (returnFocus && combo?.isConnected) combo.focus({ preventScroll: true });
  }
  private syncBatchMoveDom(toolbar: HTMLElement, state: CustomTagsWorkspaceState, disabled: boolean): void {
    this.batchMoveToolbar = toolbar;
    this.bindBatchMoveToolbar(toolbar);
    if (!state.presets.some(preset => preset.id === this.batchMoveActiveId)) this.batchMoveActiveId = null;
    if (disabled) this.closeBatchMove(false);
    else if (this.batchMoveOpen) this.bindBatchMoveOutside();
    const combo = toolbar.querySelector<HTMLButtonElement>('[data-batch-move-combobox]');
    const listbox = toolbar.querySelector<HTMLElement>('[data-batch-move-listbox]');
    if (!combo || !listbox) return;
    const focusedOptionId = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-batch-move-option]')?.dataset.batchMoveOption
      : undefined;
    combo.disabled = disabled;
    combo.setAttribute('aria-expanded', String(this.batchMoveOpen && !disabled));
    combo.setAttribute('aria-activedescendant', this.batchMoveActiveId ? `custom-batch-move-option-${this.batchMoveActiveId}` : '');
    const value = toolbar.querySelector<HTMLElement>('[data-batch-move-value]');
    value && (value.textContent = state.presets.find(preset => preset.id === this.batchMoveActiveId)?.name ?? 'Choose folder');
    listbox.classList.toggle('is-hidden', !this.batchMoveOpen || disabled);
    listbox.innerHTML = this.batchMoveOptions(state);
    if (this.batchMoveOpen && !disabled) {
      const active = this.batchMoveActiveId ?? this.batchMoveValues()[0];
      if (active) this.setBatchMoveActive(active);
      const optionToFocus = focusedOptionId && this.batchMoveValues().includes(focusedOptionId)
        ? focusedOptionId : undefined;
      if (optionToFocus) [...listbox.querySelectorAll<HTMLElement>('[data-batch-move-option]')]
        .find(option => option.dataset.batchMoveOption === optionToFocus)?.focus({ preventScroll: true });
    }
  }
  private batchMoveValues(): string[] { return [...(this.batchMoveToolbar?.querySelectorAll<HTMLElement>('[data-batch-move-option]') ?? [])].map(option => option.dataset.batchMoveOption ?? '').filter(Boolean); }
  private openBatchMove(toolbar: HTMLElement): void {
    this.batchMoveToolbar = toolbar;
    this.batchMoveOpen = true;
    this.bindBatchMoveOutside();
    const combo = toolbar.querySelector<HTMLButtonElement>('[data-batch-move-combobox]');
    const listbox = toolbar.querySelector<HTMLElement>('[data-batch-move-listbox]');
    combo?.setAttribute('aria-expanded', 'true');
    listbox?.classList.remove('is-hidden');
    const active = this.batchMoveActiveId ?? this.batchMoveValues()[0];
    if (active) this.setBatchMoveActive(active);
  }
  private setBatchMoveActive(id: string): void {
    if (!this.batchMoveValues().includes(id)) return;
    this.batchMoveActiveId = id;
    const state = this.state(); const toolbar = this.batchMoveToolbar; if (!toolbar) return;
    const combo = toolbar.querySelector<HTMLButtonElement>('[data-batch-move-combobox]');
    if (combo) combo.setAttribute('aria-activedescendant', `custom-batch-move-option-${id}`);
    const value = toolbar.querySelector<HTMLElement>('[data-batch-move-value]');
    value && (value.textContent = state.presets.find(preset => preset.id === id)?.name ?? 'Choose folder');
    toolbar.querySelectorAll<HTMLElement>('[data-batch-move-option]').forEach(option => {
      const selected = option.dataset.batchMoveOption === id;
      option.setAttribute('aria-selected', String(selected)); option.tabIndex = selected ? 0 : -1;
    });
  }
  private chooseBatchMove(id: string): void {
    if (!id || !this.batchMoveValues().includes(id)) return;
    this.closeBatchMove(true, true);
    this.actions.batchMove(id);
  }
  private interactiveCardDescendant(element: Element | null): boolean {
    return Boolean(element?.closest('button, input, label, select, textarea, a, summary, details, [role="button"], [role="combobox"], [role="option"], [role="menuitem"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="slider"], [role="textbox"]'));
  }
  private patchSelectToolbar(library: HTMLElement | null, cards: readonly CustomTag[], state: CustomTagsWorkspaceState): void {
    if (!library) return;
    let toolbar = library.querySelector<HTMLElement>('.custom-select-toolbar');
    if (!state.selectMode) { this.closeBatchMove(false, true); this.batchMoveToolbar = null; toolbar?.remove(); return; }
    const selectedCount = this.selectedCount(cards, state); const disabled = Boolean(state.batchPending || !selectedCount);
    if (!toolbar) {
      const template = document.createElement('template'); template.innerHTML = this.selectToolbar(cards, state);
      toolbar = template.content.firstElementChild as HTMLElement | null;
      const anchor = library.querySelector<HTMLElement>('.custom-order-hint, #custom-tag-move-status, #custom-tag-grid');
      if (toolbar && anchor) anchor.before(toolbar); else if (toolbar) library.append(toolbar);
      if (toolbar) this.syncBatchMoveDom(toolbar, state, disabled);
      return;
    }
    const count = toolbar.querySelector<HTMLElement>('[data-selected-count]'); if (count) count.textContent = `${selectedCount} selected`;
    this.syncBatchMoveDom(toolbar, state, disabled);
    toolbar.setAttribute('aria-busy', String(Boolean(state.batchPending)));
    const batchDelete = toolbar.querySelector<HTMLButtonElement>('[data-batch-delete]'); if (batchDelete) { batchDelete.disabled = disabled; batchDelete.setAttribute('aria-busy', String(Boolean(state.batchPending))); batchDelete.innerHTML = '&#x1F5D1;&#xFE0E;'; }
    const pendingStatus = toolbar.querySelector<HTMLElement>('[data-batch-status]'); if (pendingStatus) { pendingStatus.textContent = state.batchPending ? 'Working…' : ''; pendingStatus.hidden = !state.batchPending; }
    for (const control of toolbar.querySelectorAll<HTMLButtonElement>('[data-select-visible], [data-clear-selection]')) control.disabled = Boolean(state.batchPending);
    const error = toolbar.querySelector<HTMLElement>('.custom-batch-error'); if (error) { error.textContent = state.batchError ?? ''; error.hidden = !state.batchError; }
  }
  private card(tag: CustomTag, state: CustomTagsWorkspaceState): string {
    const esc = state.escape; const description = tag.description?.trim() ?? ''; const image = state.imageUrl(tag); const canReorder = this.reorderEnabled(state); const currentPreset = this.presetId(tag, state);
    const preset = state.presets.find(item => item.id === this.presetId(tag, state)); const artist = tag.kind === 'artist';
    const status = artist && state.shadowedArtistIds.has(tag.id) ? 'NAX card active' : artist ? 'Artist' : tag.zone === 'render' ? 'Render / Quality' : tag.zone[0].toUpperCase() + tag.zone.slice(1);
    const moving = state.movePendingId === tag.id;
    const move = state.selectMode ? '' : this.moveMarkup(tag, state);
    const drag = canReorder ? ' draggable="true"' : '';
    const reorder = canReorder ? `<div class="custom-reorder-actions" draggable="false" aria-label="Reorder ${esc(tag.tag)}"><button draggable="false" class="icon-button" type="button" data-reorder-custom-tag="up" data-reorder-id="${esc(tag.id)}" aria-label="Move ${esc(tag.tag)} up" title="Move up">↑</button><button draggable="false" class="icon-button" type="button" data-reorder-custom-tag="down" data-reorder-id="${esc(tag.id)}" aria-label="Move ${esc(tag.tag)} down" title="Move down">↓</button></div>` : '';
    const signature = this.cardSignature(tag, state);
    const selected = state.selectedIds?.has(tag.id) ?? false;
    const selection = state.selectMode ? `<label class="custom-card-select"><input type="checkbox" data-select-custom-tag="${esc(tag.id)}"${selected ? ' checked' : ''}${state.batchPending ? ' disabled' : ''} aria-label="Select ${esc(tag.tag)}"><span>Select</span></label>` : '';
    return `<article class="custom-library-card${canReorder ? ' is-reorderable' : ''}${state.selectMode ? ' is-selectable' : ''}${moving ? ' is-moving' : ''}${selected ? ' is-selected' : ''}" data-custom-card-id="${esc(tag.id)}" data-custom-card-signature="${esc(signature)}" aria-selected="${selected}"${moving ? ' aria-busy="true"' : ''}${drag} data-constructor-preview-image="${esc(image)}"${image ? '' : ' data-constructor-preview-no-image="true"'} data-constructor-preview-tag="${esc(tag.tag)}"><img draggable="false" data-custom-original="true" data-preview-cache="content" data-preview-src="${esc(image)}" alt="${esc(tag.tag)}" loading="lazy"><div><b>${esc(tag.tag)}</b><small>${esc(preset?.name ?? 'My Tags')} · ${status}</small>${description ? `<p>${esc(description)}</p>` : ''}</div><div class="custom-library-actions" draggable="false">${selection}${move}${reorder}${state.selectMode ? '' : `<button draggable="false" class="tiny-copy" type="button" data-edit-custom-tag="${esc(tag.id)}">Edit</button><button draggable="false" class="tiny-copy" type="button" data-delete-custom-tag="${esc(tag.id)}">Delete</button>`}</div></article>`;
  }
  private patchCardState(node: HTMLElement, tag: CustomTag, state: CustomTagsWorkspaceState): void {
    const currentPreset = this.presetId(tag, state); const preset = state.presets.find(item => item.id === currentPreset); const artist = tag.kind === 'artist';
    const status = artist && state.shadowedArtistIds.has(tag.id) ? 'NAX card active' : artist ? 'Artist' : tag.zone === 'render' ? 'Render / Quality' : tag.zone[0].toUpperCase() + tag.zone.slice(1);
    const moving = state.movePendingId === tag.id;
    const selected = state.selectedIds?.has(tag.id) ?? false;
    node.classList.toggle('is-moving', moving); if (moving) node.setAttribute('aria-busy', 'true'); else node.removeAttribute('aria-busy');
    node.classList.toggle('is-selected', selected); node.setAttribute('aria-selected', String(selected));
    const checkbox = node.querySelector<HTMLInputElement>('[data-select-custom-tag]'); if (checkbox) { checkbox.checked = selected; checkbox.disabled = Boolean(state.batchPending); }
    const label = node.children[1]?.querySelector<HTMLElement>('small'); const labelText = `${preset?.name ?? 'My Tags'} · ${status}`;
    const details = node.querySelector<HTMLElement>('.custom-move-details');
    if (details && (Boolean(state.movePendingId) || details.querySelector('summary')?.hasAttribute('aria-disabled') || label?.textContent !== labelText)) {
      const moving = state.movePendingId === tag.id; const disabled = Boolean(state.movePendingId);
      const summary = details.querySelector<HTMLElement>('summary'); if (summary) { summary.textContent = moving ? 'Moving…' : 'Move'; if (disabled) summary.setAttribute('aria-disabled', 'true'); else summary.removeAttribute('aria-disabled'); }
      const menu = details.querySelector<HTMLElement>('.custom-move-menu');
      if (menu) {
        menu.setAttribute('aria-label', `Move ${tag.tag} to a folder`); menu.replaceChildren();
        const destinations = state.presets.filter(item => item.id !== currentPreset);
        if (!destinations.length) { const empty = document.createElement('span'); empty.className = 'custom-move-empty'; empty.textContent = 'No other folders'; menu.append(empty); }
        else for (const destination of destinations) { const button = document.createElement('button'); button.className = 'tiny-copy custom-move-option'; button.type = 'button'; button.dataset.moveCustomTag = tag.id; button.dataset.moveDestination = destination.id; button.textContent = destination.name; button.disabled = disabled; menu.append(button); }
      }
    }
    if (label) label.textContent = labelText;
  }
  private preset(preset: CustomTagPreset, state: CustomTagsWorkspaceState): string {
    const esc = state.escape; const selected = state.selectedPresetId === preset.id; const renaming = state.renamingPresetId === preset.id; const isDefault = preset.id === state.defaultPresetId; const count = this.count(preset.id, state);
    const controls = selected && !isDefault ? `<div class="preset-actions" aria-label="Actions for ${esc(preset.name)}"><button class="icon-button preset-action-icon" type="button" data-rename-preset="${esc(preset.id)}" aria-label="Rename ${esc(preset.name)}" title="Rename preset">✎</button><button class="icon-button preset-action-icon danger-copy" type="button" data-delete-preset="${esc(preset.id)}" aria-label="Delete ${esc(preset.name)}" title="Delete preset">×</button></div>` : '<div class="preset-actions" aria-hidden="true"></div>';
    const body = renaming ? `<form class="preset-rename-form" data-preset-rename-form="${esc(preset.id)}"><input id="preset-rename-${esc(preset.id)}" value="${esc(preset.name)}" maxlength="80"><button class="tiny-copy" type="submit">Save</button><button class="tiny-copy" type="button" data-cancel-rename="${esc(preset.id)}">Cancel</button></form>` : `<div class="preset-row-top"><button class="preset-select" type="button" data-select-preset="${esc(preset.id)}" aria-pressed="${selected}"><span><b>${esc(preset.name)}</b><small>${count} ${count === 1 ? 'card' : 'cards'}</small></span></button>${controls}<span class="preset-check" aria-hidden="true">${selected ? '●' : '○'}</span></div>`;
    const footer = !isDefault && count ? `<button class="preset-export-footer" type="button" data-export-preset="${esc(preset.id)}" aria-label="Export ${esc(preset.name)} as a .naipack" title="${state.packAvailable ? 'Export .naipack' : 'Export is available in the desktop app'}"${state.packAvailable ? '' : ' disabled'}>Export .naipack</button>` : '';
    return `<div class="preset-row ${selected ? 'selected' : ''} ${isDefault ? 'default' : ''}" data-preset-id="${esc(preset.id)}">${body}${footer}</div>`;
  }
  private zoneChoice(zone: CustomTagZone, current: CustomTagZone): string { const label = zone === 'render' ? 'Render / Quality' : zone[0].toUpperCase() + zone.slice(1); return `<label class="zone-choice ${current === zone ? 'selected' : ''}"><input type="radio" name="custom-tag-zone" value="${zone}" data-custom-zone="${zone}"${current === zone ? ' checked' : ''}><span>${label}</span></label>`; }
  markup(panelClass: string): string {
    // A full workspace mount replaces the old toolbar. Close its popup and
    // detach the stable document handler before producing replacement HTML.
    this.closeBatchMove(false, true); this.batchMoveToolbar = null;
    const s = this.state(); const e = s.escape; const editing = s.tags.find(tag => tag.id === s.editingId); const kind: CustomTagKind = s.formKind;
    const draft = s.formDraft; const formTag = draft?.tag ?? editing?.tag ?? ''; const formDescription = draft?.description ?? editing?.description ?? ''; const formZone = draft?.zone ?? editing?.zone ?? 'frame';
    const destination = s.presets.find(p => p.id === (s.selectedPresetId === 'all' ? s.defaultPresetId : s.selectedPresetId)) ?? s.presets[0]; const cards = this.visible(s);
    const image = s.draftImageUrl || (editing?.imageAsset ? s.imageUrl(editing) : ''); const preview = image ? `<div class="custom-image-preview is-loaded" id="custom-image-preview"><img src="${e(image)}" alt="${editing ? e(editing.tag) : 'Selected custom tag image preview'}"></div>` : '<div class="custom-image-preview is-empty" id="custom-image-preview"><span class="custom-image-empty">Choose an image to preview it here.</span></div>';
    const deleting = s.deletingPresetId ? s.presets.find(p => p.id === s.deletingPresetId) : undefined; const deleteCount = deleting ? this.count(deleting.id, s) : 0;
    const deletePrompt = deleting ? `<div class="preset-delete-confirm" role="alert"><b>Delete ${e(deleting.name)}?</b><p>${deleteCount} ${deleteCount === 1 ? 'card is' : 'cards are'} in this folder.</p>${s.deleteError ? `<p class="preset-delete-error">${e(s.deleteError)}</p>` : ''}<div><button class="danger-button" type="button" data-confirm-delete-preset="${e(deleting.id)}" data-delete-mode="move">Delete folder only</button><button class="danger-button" type="button" data-confirm-delete-preset="${e(deleting.id)}" data-delete-mode="delete">Delete folder and cards</button><button class="tiny-copy" type="button" id="cancel-delete-preset">Cancel</button></div></div>` : '';
    const constructor = kind === 'artist' ? '<p class="custom-artist-note">Artist cards appear in Add Artist, random pools, Artist Mix, and metadata highlights.</p>' : `<fieldset class="field constructor-choices"><legend>Constructor</legend><div class="zone-choice-grid">${(['frame','scene','render','character'] as CustomTagZone[]).map(zone => this.zoneChoice(zone, formZone)).join('')}</div><small class="custom-character-note">Character cards are saved for Custom Tags and are not used by Prompt Builder yet.</small></fieldset>`;
    const filters: CustomTagFilter[] = ['all','artist','frame','scene','render','character']; const warning = s.warning ? `<p class="custom-tag-status" role="alert">${e(s.warning)}</p>` : '';
    const typeSelector = `<fieldset class="field custom-type-selector"><legend>Card type</legend><div class="custom-type-segments"><label class="custom-type-segment"><input type="radio" name="custom-card-kind" value="tag" data-custom-card-kind="tag"${kind === 'tag' ? ' checked' : ''}><span>Prompt tag</span></label><label class="custom-type-segment"><input type="radio" name="custom-card-kind" value="artist" data-custom-card-kind="artist"${kind === 'artist' ? ' checked' : ''}><span>Artist</span></label></div></fieldset>`;
    const canReorder = this.reorderEnabled(s); let orderHint = canReorder ? 'Drag cards or use arrows to set the saved folder order.' : s.sort === 'a-z' ? 'A–Z is a view-only sort.' : s.selectedPresetId === 'all' ? 'Select a preset folder to reorder its cards.' : s.search.trim() || s.filter !== 'all' ? 'Clear search and filters to reorder cards.' : '';
    const sortControls = `<div class="custom-sort" role="group" aria-label="Card order"><button type="button" class="chip ${s.sort === 'default' ? 'on' : ''}" data-custom-sort="default" aria-pressed="${s.sort === 'default'}">Default</button><button type="button" class="chip ${s.sort === 'a-z' ? 'on' : ''}" data-custom-sort="a-z" aria-pressed="${s.sort === 'a-z'}">A–Z</button><button type="button" class="chip ${s.selectMode ? 'on' : ''}" data-toggle-select-mode aria-pressed="${s.selectMode}">${s.selectMode ? 'Done' : 'Select'}</button></div>`;
    const selectToolbar = s.selectMode ? this.selectToolbar(cards, s) : '';
    const orderHintMarkup = orderHint ? `<p class="custom-order-hint${canReorder ? '' : ' is-disabled'}">${orderHint}</p>` : '';
    return `<section id="custom-tags-panel" class="${panelClass}" role="tabpanel" aria-labelledby="custom-tags-tab"><section class="custom-tags-workspace" aria-labelledby="custom-tags-title"><header class="workspace-intro"><div><p class="eyebrow">PERSONAL LIBRARY</p><h2 id="custom-tags-title">Custom Tag Builder</h2><p>Build prompt tags and artist cards for your studio.</p></div><div class="custom-tag-pack-tools"><button class="secondary custom-tag-import" id="custom-tag-import" type="button" aria-describedby="custom-tag-pack-help"${s.packAvailable ? '' : ' disabled'}>⇧ Import .naipack</button><span id="custom-tag-pack-help">${s.packAvailable ? 'Import a shared Custom Tags preset.' : 'Import/export packs are available in the desktop app.'}</span></div></header><p id="custom-tag-pack-status" class="custom-tag-pack-status ${s.packStatusKind}" role="status" aria-live="polite">${e(s.packStatus)}</p>${warning}<div class="custom-tags-layout"><aside class="custom-preset-sidebar" aria-label="Custom tag presets"><div class="preset-sidebar-heading"><div><p class="eyebrow">PRESET FOLDERS</p><h3>My presets</h3></div><span class="preset-total">${s.tags.length}</span></div><button class="preset-all ${s.selectedPresetId === 'all' ? 'selected' : ''}" type="button" data-select-preset="all" aria-pressed="${s.selectedPresetId === 'all'}"><span><b>All Tags</b><small>${s.tags.length} cards</small></span><span aria-hidden="true">${s.selectedPresetId === 'all' ? '●' : '○'}</span></button><div class="custom-preset-list">${s.presets.map(p => this.preset(p, s)).join('')}</div>${s.creatingPreset ? '<form class="preset-create-form" id="custom-preset-form"><label class="field"><span>New preset folder</span><input id="custom-preset-name" maxlength="80" required></label><div><button class="primary" type="submit">Create preset</button><button class="tiny-copy" type="button" id="cancel-create-preset">Cancel</button></div></form>' : '<button class="secondary preset-create-button" type="button" id="create-preset">＋ New preset</button>'}${deletePrompt}</aside><form class="custom-tag-form" id="custom-tag-form"><div class="form-heading"><div><p class="eyebrow">CREATE OR EDIT</p><h3>${editing ? `Edit custom ${kind}` : `New custom ${kind}`}</h3></div>${editing ? '<button class="tiny-copy" type="button" id="cancel-custom-edit">Cancel edit</button>' : ''}</div><p class="custom-destination" role="status">Destination: <b>${e(destination?.name ?? 'My Tags')}</b>${s.selectedPresetId === 'all' ? ' <small>All Tags is a view. New cards go to My Tags.</small>' : ''}</p>${typeSelector}<div class="field image-field"><span>Image <i>${kind === 'artist' ? 'Optional' : 'Required'} PNG, JPEG, or WebP, up to 20 MiB</i></span><div class="custom-image-drop${image ? ' has-image' : ''}" id="custom-image-drop" tabindex="0" aria-describedby="custom-image-status"><input id="custom-tag-image" class="custom-file-input" type="file" accept="image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp" tabindex="-1"><button class="custom-image-empty-content" type="button" id="custom-tag-choose"${image ? ' hidden' : ''}><span class="drop-icon">＋</span><b>Drop an image here</b><span>or choose image</span></button>${preview}</div><p class="custom-image-status" id="custom-image-status">${kind === 'artist' ? 'Optional. Without an image, the artist uses the plus-card placeholder.' : 'Click or press Enter to choose an image.'}</p></div><label class="field"><span>${kind === 'artist' ? 'Artist name' : 'Tag'}</span><input id="custom-tag-name" value="${e(formTag)}" required maxlength="4096"></label>${constructor}<label class="field"><span>Description / guide <i>(optional)</i></span><textarea id="custom-tag-description" maxlength="2000">${e(formDescription)}</textarea></label><p class="custom-tag-status" id="custom-tag-status" role="status" aria-live="polite"></p><button class="primary custom-save-button" type="submit">${editing ? 'Save changes' : `Save custom ${kind}`}</button></form><section class="custom-tag-library"><div class="subheading"><div><p class="eyebrow">SAVED CARDS</p><h3>${cards.length} shown <span>·</span> ${s.tags.length} total</h3></div><div class="custom-library-tools"><input id="custom-tag-search" aria-label="Search custom cards" value="${e(s.search)}" placeholder="Search your cards...">${sortControls}<div class="custom-zone-filter" role="group" aria-label="Filter saved cards">${filters.map(f => `<button type="button" class="chip ${s.filter === f ? 'on' : ''}" data-custom-filter="${f}" aria-pressed="${s.filter === f}">${f === 'all' ? 'All' : f === 'artist' ? 'Artists' : f === 'render' ? 'Render' : f[0].toUpperCase()+f.slice(1)}</button>`).join('')}</div></div></div>${selectToolbar}${orderHintMarkup}<p id="custom-tag-move-status" class="custom-tag-status" role="status" aria-live="polite">${e(s.moveError || (s.movePendingId ? 'Moving card…' : ''))}</p><div class="custom-tag-grid" id="custom-tag-grid" tabindex="0">${cards.length ? cards.map(tag => this.card(tag, s)).join('') : '<p class="empty-inline">No saved cards match this preset and filter yet.</p>'}</div></section></div><div id="custom-tag-pack-drop-overlay" class="custom-tag-pack-drop-toast" hidden aria-hidden="true" role="status" aria-live="polite"><b>Drop .naipack to import</b><span>One Custom Tags pack will be imported.</span></div></section></section>`;
  }
  refresh(_controller: WorkspaceController, afterPatch?: (scope: ParentNode) => void): void {
    const s = this.state(); const cards = this.visible(s); const grid = document.querySelector<HTMLElement>('#custom-tag-grid');
    if (!grid) return;
    const scrollTop = grid.scrollTop;
    const existing = new Map<string, HTMLElement>();
    for (const child of Array.from(grid.children)) {
      const node = child as HTMLElement; const id = node.dataset.customCardId;
      if (id) existing.set(id, node);
    }
    const desiredIds = new Set(cards.map(tag => tag.id));
    const desired = cards.map(tag => ({ tag, signature: this.cardSignature(tag, s) }));
    const requiresPreviewClear = Array.from(existing.values()).some(node => !desiredIds.has(node.dataset.customCardId ?? ''))
      || desired.some(item => { const prior = existing.get(item.tag.id); return Boolean(prior && prior.dataset.customCardSignature !== item.signature); });
    if (requiresPreviewClear) clearArtistCardPreview();
    for (const item of desired) {
      const prior = existing.get(item.tag.id);
      if (prior && prior.dataset.customCardSignature === item.signature) { this.patchCardState(prior, item.tag, s); grid.appendChild(prior); continue; }
      const template = document.createElement('template'); template.innerHTML = this.card(item.tag, s);
      const next = template.content.firstElementChild as HTMLElement | null; if (!next) continue;
      if (prior) prior.replaceWith(next); else grid.appendChild(next);
    }
    for (const [id, node] of existing) if (!desiredIds.has(id)) node.remove();
    const empty = grid.querySelector<HTMLElement>('.empty-inline');
    if (!cards.length) { if (!empty) { const placeholder = document.createElement('p'); placeholder.className = 'empty-inline'; placeholder.textContent = 'No saved cards match this preset and filter yet.'; grid.appendChild(placeholder); } }
    else empty?.remove();
    grid.scrollTop = scrollTop;
    const library = grid.closest<HTMLElement>('.custom-tag-library'); this.patchSelectToolbar(library, cards, s); const heading = library?.querySelector<HTMLElement>('.subheading h3'); if (heading) heading.innerHTML = `${cards.length} shown <span>·</span> ${s.tags.length} total`;
    document.querySelectorAll<HTMLButtonElement>('[data-custom-filter]').forEach(button => { const on = button.dataset.customFilter === s.filter; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll<HTMLButtonElement>('[data-custom-sort]').forEach(button => { const on = button.dataset.customSort === s.sort; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); });
    const hint = library?.querySelector<HTMLElement>('.custom-order-hint'); if (hint) { const canReorder = this.reorderEnabled(s); hint.textContent = canReorder ? 'Drag cards or use arrows to set the saved folder order.' : s.sort === 'a-z' ? 'A–Z is a view-only sort.' : s.selectedPresetId === 'all' ? 'Select a preset folder to reorder its cards.' : s.search.trim() || s.filter !== 'all' ? 'Clear search and filters to reorder cards.' : ''; hint.classList.toggle('is-disabled', !canReorder); }
    const moveStatus = library?.querySelector<HTMLElement>('#custom-tag-move-status'); if (moveStatus) moveStatus.textContent = s.moveError || (s.movePendingId ? 'Moving card…' : '');
    const total = document.querySelector<HTMLElement>('.preset-total'); if (total) total.textContent = String(s.tags.length);
    const all = document.querySelector<HTMLElement>('.preset-all'); if (all) { const selected = s.selectedPresetId === 'all'; all.classList.toggle('selected', selected); all.setAttribute('aria-pressed', String(selected)); const count = all.querySelector('small'); if (count) count.textContent = `${s.tags.length} cards`; const check = all.querySelector(':scope > span:last-child'); if (check) check.textContent = selected ? '●' : '○'; }
    document.querySelectorAll<HTMLElement>('.preset-row[data-preset-id]').forEach(row => { const id = row.dataset.presetId ?? ''; const selected = id === s.selectedPresetId; row.classList.toggle('selected', selected); const select = row.querySelector<HTMLButtonElement>('[data-select-preset]'); if (select) select.setAttribute('aria-pressed', String(selected)); const check = row.querySelector<HTMLElement>('.preset-check'); if (check) check.textContent = selected ? '●' : '○'; const count = row.querySelector('small'); if (count) { const totalCards = this.count(id, s); count.textContent = `${totalCards} ${totalCards === 1 ? 'card' : 'cards'}`; } });
    bindArtistCardPreview(grid); afterPatch?.(grid);
  }
  route(event: Event): boolean {
    const element = event.target instanceof Element ? event.target : null;
    const state = this.state();
    const reorderEnabled = this.reorderEnabled(state);
    const card = element?.closest<HTMLElement>('[data-custom-card-id]') ?? null;
    const customPanel = element?.closest<HTMLElement>('#custom-tags-panel');
    const dragEvent = event.type === 'dragstart' || event.type === 'dragover' || event.type === 'drop' || event.type === 'dragend';
    const dragSourceBlocked = Boolean(element?.closest('button, summary, details, input, textarea, select, img'));
    const dropTargetBlocked = Boolean(element?.closest('button, summary, details, input, textarea, select'));
    if (dragEvent && event.type !== 'dragend' && !customPanel) return false;
    if (event.type === 'dragstart' && card) {
      if (!reorderEnabled || dragSourceBlocked) { event.preventDefault(); return true; }
      this.draggingCardId = card.dataset.customCardId ?? null;
      if (!this.draggingCardId) return false;
      card.classList.add('is-dragging');
      beginArtistCardPreviewDrag();
      (event as DragEvent).dataTransfer?.setData('text/plain', card.dataset.customCardId ?? '');
      if ((event as DragEvent).dataTransfer) (event as DragEvent).dataTransfer!.effectAllowed = 'move';
      return true;
    }
    if (event.type === 'dragover' && card) {
      if (!reorderEnabled || dropTargetBlocked || !this.draggingCardId) return false;
      event.preventDefault();
      document.querySelectorAll<HTMLElement>('.custom-library-card.is-drop-target').forEach(card => card.classList.remove('is-drop-target'));
      card.classList.add('is-drop-target');
      return true;
    }
    if (event.type === 'dragend') {
      if (!this.draggingCardId) return false;
      this.draggingCardId = null;
      endArtistCardPreviewDrag();
      document.querySelectorAll<HTMLElement>('.custom-library-card.is-dragging, .custom-library-card.is-drop-target').forEach(card => card.classList.remove('is-dragging', 'is-drop-target'));
      return true;
    }
    if (event.type === 'drop' && card) {
      if (!reorderEnabled || dropTargetBlocked || !this.draggingCardId) return false;
      event.preventDefault();
      const draggedId = (event as DragEvent).dataTransfer?.getData('text/plain') || this.draggingCardId;
      const targetId = card.dataset.customCardId ?? '';
      const swapped = swapCardOrderSlots(this.visible(state).map(item => item.id), draggedId, targetId);
      if (swapped) this.actions.reorder(swapped);
      this.draggingCardId = null;
      endArtistCardPreviewDrag();
      document.querySelectorAll<HTMLElement>('.custom-library-card.is-dragging, .custom-library-card.is-drop-target').forEach(card => card.classList.remove('is-dragging', 'is-drop-target'));
      return true;
    }
    if (event.type === 'click' && element?.closest('[data-custom-sort]')) { this.actions.sort(element.closest<HTMLElement>('[data-custom-sort]')?.dataset.customSort === 'a-z' ? 'a-z' : 'default'); return true; }
    if (event.type === 'click' && element?.closest('[data-reorder-custom-tag]')) {
      if (!reorderEnabled) return true;
      const button = element.closest<HTMLButtonElement>('[data-reorder-custom-tag]'); const id = button?.dataset.reorderId ?? ''; const ids = this.visible(state).map(card => card.id); const index = ids.indexOf(id); const direction = button?.dataset.reorderCustomTag === 'up' ? -1 : 1; const next = index + direction;
      if (index >= 0 && next >= 0 && next < ids.length) { [ids[index], ids[next]] = [ids[next], ids[index]]; this.actions.reorder(ids); } return true;
    }
    if (event.type === 'click' && element?.closest('[data-move-custom-tag]')) { const button = element.closest<HTMLButtonElement>('[data-move-custom-tag]'); if (button?.dataset.moveDestination) this.actions.moveTag(button.dataset.moveCustomTag ?? '', button.dataset.moveDestination); return true; }
    if (event.type === 'click' && element?.closest('[data-toggle-select-mode]')) { this.closeBatchMove(false, true); this.actions.toggleSelectMode(); return true; }
    if (event.type === 'click' && element?.closest('[data-select-visible]')) { if (state.batchPending) return true; this.closeBatchMove(false); this.actions.selectVisible(this.visible(state).map(item => item.id)); return true; }
    if (event.type === 'click' && element?.closest('[data-clear-selection]')) { if (state.batchPending) return true; this.closeBatchMove(false, true); this.actions.clearSelection(); return true; }
    if (event.type === 'click' && element?.closest('[data-batch-delete]')) { if (state.batchPending || !this.selectedCount(this.visible(state), state)) return true; this.closeBatchMove(false, true); this.actions.batchDelete(); return true; }
    if (event.type === 'click' && element?.closest('[data-batch-move-combobox]')) {
      const combo = element.closest<HTMLButtonElement>('[data-batch-move-combobox]');
      if (!combo || combo.disabled) return true;
      this.batchMoveToolbar = combo.closest<HTMLElement>('.custom-select-toolbar');
      if (this.batchMoveOpen) this.closeBatchMove(false); else if (this.batchMoveToolbar) this.openBatchMove(this.batchMoveToolbar);
      return true;
    }
    if (event.type === 'click' && element?.closest('[data-batch-move-option]')) { this.chooseBatchMove(element.closest<HTMLElement>('[data-batch-move-option]')?.dataset.batchMoveOption ?? ''); return true; }
    if (event.type === 'keydown' && element?.closest('[data-batch-move-combobox]')) {
      const combo = element.closest<HTMLButtonElement>('[data-batch-move-combobox]');
      if (!combo || combo.disabled) return true;
      this.batchMoveToolbar = combo.closest<HTMLElement>('.custom-select-toolbar');
      const values = this.batchMoveValues(); if (!values.length) return true;
      const current = Math.max(0, values.indexOf(this.batchMoveActiveId ?? values[0]));
      if (event instanceof KeyboardEvent && event.key === 'Escape') { if (this.batchMoveOpen) { event.preventDefault(); this.closeBatchMove(true); } return true; }
      if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (this.batchMoveOpen && this.batchMoveActiveId) this.chooseBatchMove(this.batchMoveActiveId); else if (this.batchMoveToolbar) this.openBatchMove(this.batchMoveToolbar); return true; }
      if (!(event instanceof KeyboardEvent) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return true;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : Math.min(values.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)));
      if (!this.batchMoveOpen && this.batchMoveToolbar) this.openBatchMove(this.batchMoveToolbar);
      this.setBatchMoveActive(values[next]); return true;
    }
    if (event.type === 'keydown' && element?.closest('[data-batch-move-option]')) {
      const option = element.closest<HTMLElement>('[data-batch-move-option]'); const values = this.batchMoveValues(); if (!option || !values.length) return true;
      const current = Math.max(0, values.indexOf(option.dataset.batchMoveOption ?? this.batchMoveActiveId ?? values[0]));
      if (event instanceof KeyboardEvent && event.key === 'Escape') { event.preventDefault(); this.closeBatchMove(true); return true; }
      if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.chooseBatchMove(option.dataset.batchMoveOption ?? ''); return true; }
      if (event instanceof KeyboardEvent && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : Math.min(values.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1))); this.setBatchMoveActive(values[next]); [...(this.batchMoveToolbar?.querySelectorAll<HTMLElement>('[data-batch-move-option]') ?? [])].find(option => option.dataset.batchMoveOption === values[next])?.focus({ preventScroll: true }); return true; }
      return true;
    }
    if (event.type === 'change' && element instanceof HTMLInputElement && element.dataset.selectCustomTag) { if (!state.batchPending) this.actions.toggleSelect(element.dataset.selectCustomTag); return true; }
    if (event.type === 'input' && element instanceof HTMLInputElement && element.id === 'custom-tag-search') { this.actions.search(element.value); return true; }
    if (event.type === 'change' && element instanceof HTMLInputElement && element.id === 'custom-tag-image') { this.actions.readImage(element.files?.[0]); return true; }
    if (event.type === 'change' && element instanceof HTMLInputElement && element.dataset.customCardKind) { this.actions.setKind(element.value === 'artist' ? 'artist' : 'tag'); return true; }
    if (event.type === 'change' && element instanceof HTMLInputElement && element.dataset.customZone) { document.querySelectorAll('.zone-choice').forEach(label => label.classList.toggle('selected', (label.querySelector('input') as HTMLInputElement | null)?.checked ?? false)); return true; }
    if (event.type === 'click' && state.selectMode && !state.batchPending && card && !this.interactiveCardDescendant(element)) { this.actions.toggleSelect(card.dataset.customCardId ?? ''); return true; }
    if (event.type === 'submit' && element instanceof HTMLFormElement) { event.preventDefault(); if (element.id === 'custom-tag-form') this.actions.saveTag(); else if (element.id === 'custom-preset-form') this.actions.createPreset(element.querySelector<HTMLInputElement>('#custom-preset-name')?.value ?? ''); else if (element.dataset.presetRenameForm) this.actions.renamePreset(element.dataset.presetRenameForm, element.querySelector('input')?.value ?? ''); else return false; return true; }
    if (event.type === 'keydown' && element?.closest('#custom-image-drop') && event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); document.querySelector<HTMLInputElement>('#custom-tag-image')?.click(); return true; }
    if (event.type !== 'click') return false; const button = element?.closest<HTMLButtonElement>('button'); if (!button) return false;
    if (button.dataset.customFilter) this.actions.filter(button.dataset.customFilter as CustomTagFilter); else if (button.dataset.selectPreset) this.actions.selectPreset(button.dataset.selectPreset); else if (button.id === 'create-preset') this.actions.beginCreatePreset(); else if (button.id === 'cancel-create-preset') this.actions.cancelCreatePreset(); else if (button.dataset.renamePreset) this.actions.beginRenamePreset(button.dataset.renamePreset); else if (button.dataset.cancelRename) this.actions.cancelRenamePreset(); else if (button.dataset.deletePreset) this.actions.beginDeletePreset(button.dataset.deletePreset); else if (button.id === 'cancel-delete-preset') this.actions.cancelDeletePreset(); else if (button.dataset.confirmDeletePreset) this.actions.confirmDeletePreset(button.dataset.confirmDeletePreset, button.dataset.deleteMode === 'delete' ? 'delete' : 'move'); else if (button.dataset.editCustomTag) this.actions.editTag(button.dataset.editCustomTag); else if (button.dataset.deleteCustomTag) this.actions.deleteTag(button.dataset.deleteCustomTag); else if (button.id === 'cancel-custom-edit') this.actions.cancelEdit(); else if (button.id === 'custom-tag-choose' || button.closest('#custom-image-drop')) document.querySelector<HTMLInputElement>('#custom-tag-image')?.click(); else if (button.id === 'custom-tag-import') this.actions.importPack(); else if (button.dataset.exportPreset) this.actions.exportPreset(button.dataset.exportPreset); else return false; return true;
  }
}

import type { CustomTag, CustomTagKind, CustomTagPreset, CustomTagZone } from '../types';
import type { WorkspaceController } from '../workspace-controller';
import { beginArtistCardPreviewDrag, endArtistCardPreviewDrag } from '../artist-card-preview.ts';

export type CustomTagFilter = CustomTagZone | 'artist' | 'all';
export type CustomTagSort = 'default' | 'a-z';
export interface CustomTagsWorkspaceState {
  tags: CustomTag[]; presets: CustomTagPreset[]; selectedPresetId: string; editingId: string | null;
  formKind: CustomTagKind; search: string; filter: CustomTagFilter; creatingPreset: boolean;
  sort: CustomTagSort;
  renamingPresetId: string | null; deletingPresetId: string | null; deleteError: string; warning: string;
  packStatus: string; packStatusKind: '' | 'success' | 'error' | 'cancelled'; packAvailable: boolean;
  draftImageUrl: string; shadowedArtistIds: ReadonlySet<string>; defaultPresetId: string;
  imageUrl(tag: CustomTag): string; escape(value: unknown): string;
}
export interface CustomTagsWorkspaceActions {
  search(value: string): void; filter(value: CustomTagFilter): void; selectPreset(id: string): void; sort(value: CustomTagSort): void;
  beginCreatePreset(): void; cancelCreatePreset(): void; createPreset(name: string): void;
  beginRenamePreset(id: string): void; cancelRenamePreset(): void; renamePreset(id: string, name: string): void;
  beginDeletePreset(id: string): void; cancelDeletePreset(): void; confirmDeletePreset(id: string, mode: 'move' | 'delete'): void;
  editTag(id: string): void; deleteTag(id: string): void; cancelEdit(): void; setKind(kind: CustomTagKind): void;
  readImage(file?: File): void; saveTag(): void; moveTag(id: string, presetId: string): void; reorder(ids: string[]): void; importPack(): void; exportPreset(id: string): void;
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
  constructor(state: () => CustomTagsWorkspaceState, actions: CustomTagsWorkspaceActions) { this.state = state; this.actions = actions; }
  private presetId(tag: CustomTag, state: CustomTagsWorkspaceState): string { return tag.presetId || state.defaultPresetId; }
  private reorderEnabled(state: CustomTagsWorkspaceState): boolean {
    return state.selectedPresetId !== 'all' && state.sort === 'default' && state.filter === 'all' && !state.search.trim() && state.presets.some(preset => preset.id === state.selectedPresetId);
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
  private card(tag: CustomTag, state: CustomTagsWorkspaceState): string {
    const esc = state.escape; const description = tag.description?.trim() ?? ''; const image = state.imageUrl(tag); const canReorder = this.reorderEnabled(state); const currentPreset = this.presetId(tag, state);
    const preset = state.presets.find(item => item.id === this.presetId(tag, state)); const artist = tag.kind === 'artist';
    const status = artist && state.shadowedArtistIds.has(tag.id) ? 'NAX card active' : artist ? 'Artist' : tag.zone === 'render' ? 'Render / Quality' : tag.zone[0].toUpperCase() + tag.zone.slice(1);
    const destinations = state.presets.filter(item => item.id !== currentPreset).map(item => `<button class="tiny-copy custom-move-option" type="button" data-move-custom-tag="${esc(tag.id)}" data-move-destination="${esc(item.id)}">${esc(item.name)}</button>`).join('');
    const move = `<details class="custom-move-details" draggable="false"><summary class="tiny-copy" draggable="false">Move</summary><div class="custom-move-menu" role="menu" aria-label="Move ${esc(tag.tag)} to a folder">${destinations || '<span class="custom-move-empty">No other folders</span>'}</div></details>`;
    const drag = canReorder ? ' draggable="true"' : '';
    const reorder = canReorder ? `<div class="custom-reorder-actions" draggable="false" aria-label="Reorder ${esc(tag.tag)}"><button draggable="false" class="icon-button" type="button" data-reorder-custom-tag="up" data-reorder-id="${esc(tag.id)}" aria-label="Move ${esc(tag.tag)} up" title="Move up">↑</button><button draggable="false" class="icon-button" type="button" data-reorder-custom-tag="down" data-reorder-id="${esc(tag.id)}" aria-label="Move ${esc(tag.tag)} down" title="Move down">↓</button></div>` : '';
    return `<article class="custom-library-card${canReorder ? ' is-reorderable' : ''}" data-custom-card-id="${esc(tag.id)}"${drag} data-constructor-preview-image="${esc(image)}" data-constructor-preview-tag="${esc(tag.tag)}" data-constructor-preview-description="${esc(description)}"><img draggable="false" data-preview-cache="content" data-preview-src="${esc(image)}" alt="${esc(tag.tag)}" loading="lazy"><div><b>${esc(tag.tag)}</b><small>${esc(preset?.name ?? 'My Tags')} · ${status}</small>${description ? `<p>${esc(description)}</p>` : ''}</div><div class="custom-library-actions" draggable="false">${move}${reorder}<button draggable="false" class="tiny-copy" type="button" data-edit-custom-tag="${esc(tag.id)}">Edit</button><button draggable="false" class="tiny-copy" type="button" data-delete-custom-tag="${esc(tag.id)}">Delete</button></div></article>`;
  }
  private preset(preset: CustomTagPreset, state: CustomTagsWorkspaceState): string {
    const esc = state.escape; const selected = state.selectedPresetId === preset.id; const renaming = state.renamingPresetId === preset.id; const isDefault = preset.id === state.defaultPresetId; const count = this.count(preset.id, state);
    const controls = selected && !isDefault ? `<div class="preset-actions" aria-label="Actions for ${esc(preset.name)}"><button class="icon-button preset-action-icon" type="button" data-rename-preset="${esc(preset.id)}" aria-label="Rename ${esc(preset.name)}" title="Rename preset">✎</button><button class="icon-button preset-action-icon danger-copy" type="button" data-delete-preset="${esc(preset.id)}" aria-label="Delete ${esc(preset.name)}" title="Delete preset">×</button></div>` : '<div class="preset-actions" aria-hidden="true"></div>';
    const body = renaming ? `<form class="preset-rename-form" data-preset-rename-form="${esc(preset.id)}"><input id="preset-rename-${esc(preset.id)}" value="${esc(preset.name)}" maxlength="80"><button class="tiny-copy" type="submit">Save</button><button class="tiny-copy" type="button" data-cancel-rename="${esc(preset.id)}">Cancel</button></form>` : `<div class="preset-row-top"><button class="preset-select" type="button" data-select-preset="${esc(preset.id)}" aria-pressed="${selected}"><span><b>${esc(preset.name)}</b><small>${count} ${count === 1 ? 'card' : 'cards'}</small></span></button>${controls}<span class="preset-check" aria-hidden="true">${selected ? '●' : '○'}</span></div>`;
    const footer = !isDefault && count ? `<button class="preset-export-footer" type="button" data-export-preset="${esc(preset.id)}" aria-label="Export ${esc(preset.name)} as a .naipack" title="${state.packAvailable ? 'Export .naipack' : 'Export is available in the desktop app'}"${state.packAvailable ? '' : ' disabled'}>Export .naipack</button>` : '';
    return `<div class="preset-row ${selected ? 'selected' : ''} ${isDefault ? 'default' : ''}">${body}${footer}</div>`;
  }
  private zoneChoice(zone: CustomTagZone, current: CustomTagZone): string { const label = zone === 'render' ? 'Render / Quality' : zone[0].toUpperCase() + zone.slice(1); return `<label class="zone-choice ${current === zone ? 'selected' : ''}"><input type="radio" name="custom-tag-zone" value="${zone}" data-custom-zone="${zone}"${current === zone ? ' checked' : ''}><span>${label}</span></label>`; }
  markup(panelClass: string): string {
    const s = this.state(); const e = s.escape; const editing = s.tags.find(tag => tag.id === s.editingId); const kind: CustomTagKind = editing ? (editing.kind === 'artist' ? 'artist' : 'tag') : s.formKind;
    const destination = s.presets.find(p => p.id === (s.selectedPresetId === 'all' ? s.defaultPresetId : s.selectedPresetId)) ?? s.presets[0]; const cards = this.visible(s);
    const image = s.draftImageUrl || (editing?.imageAsset ? s.imageUrl(editing) : ''); const preview = image ? `<div class="custom-image-preview is-loaded" id="custom-image-preview"><img src="${e(image)}" alt="${editing ? e(editing.tag) : 'Selected custom tag image preview'}"></div>` : '<div class="custom-image-preview is-empty" id="custom-image-preview"><span class="custom-image-empty">Choose an image to preview it here.</span></div>';
    const deleting = s.deletingPresetId ? s.presets.find(p => p.id === s.deletingPresetId) : undefined; const deleteCount = deleting ? this.count(deleting.id, s) : 0;
    const deletePrompt = deleting ? `<div class="preset-delete-confirm" role="alert"><b>Delete ${e(deleting.name)}?</b><p>${deleteCount} ${deleteCount === 1 ? 'card is' : 'cards are'} in this folder.</p>${s.deleteError ? `<p class="preset-delete-error">${e(s.deleteError)}</p>` : ''}<div><button class="danger-button" type="button" data-confirm-delete-preset="${e(deleting.id)}" data-delete-mode="move">Delete folder only</button><button class="danger-button" type="button" data-confirm-delete-preset="${e(deleting.id)}" data-delete-mode="delete">Delete folder and cards</button><button class="tiny-copy" type="button" id="cancel-delete-preset">Cancel</button></div></div>` : '';
    const constructor = kind === 'artist' ? '<p class="custom-artist-note">Artist cards appear in Add Artist, random pools, Artist Mix, and metadata highlights.</p>' : `<fieldset class="field constructor-choices"><legend>Constructor</legend><div class="zone-choice-grid">${(['frame','scene','render','character'] as CustomTagZone[]).map(zone => this.zoneChoice(zone, editing?.zone ?? 'frame')).join('')}</div><small class="custom-character-note">Character cards are saved for Custom Tags and are not used by Prompt Builder yet.</small></fieldset>`;
    const filters: CustomTagFilter[] = ['all','artist','frame','scene','render','character']; const warning = s.warning ? `<p class="custom-tag-status" role="alert">${e(s.warning)}</p>` : '';
    const canReorder = this.reorderEnabled(s); const orderHint = canReorder ? 'Drag cards or use arrows to set the saved folder order.' : s.sort === 'a-z' ? 'A–Z is a view-only sort.' : s.selectedPresetId === 'all' ? 'Select a preset folder to reorder its cards.' : s.search.trim() || s.filter !== 'all' ? 'Clear search and filters to reorder cards.' : '';
    const sortControls = `<div class="custom-sort" role="group" aria-label="Card order"><button type="button" class="chip ${s.sort === 'default' ? 'on' : ''}" data-custom-sort="default" aria-pressed="${s.sort === 'default'}">Default</button><button type="button" class="chip ${s.sort === 'a-z' ? 'on' : ''}" data-custom-sort="a-z" aria-pressed="${s.sort === 'a-z'}">A–Z</button></div>`;
    return `<section id="custom-tags-panel" class="${panelClass}" role="tabpanel" aria-labelledby="custom-tags-tab"><section class="custom-tags-workspace" aria-labelledby="custom-tags-title"><header class="workspace-intro"><div><p class="eyebrow">PERSONAL LIBRARY</p><h2 id="custom-tags-title">Custom Tag Builder</h2><p>Build prompt tags and artist cards for your studio.</p></div><div class="custom-tag-pack-tools"><button class="secondary custom-tag-import" id="custom-tag-import" type="button" aria-describedby="custom-tag-pack-help"${s.packAvailable ? '' : ' disabled'}>⇧ Import .naipack</button><span id="custom-tag-pack-help">${s.packAvailable ? 'Import a shared Custom Tags preset.' : 'Import/export packs are available in the desktop app.'}</span></div></header><p id="custom-tag-pack-status" class="custom-tag-pack-status ${s.packStatusKind}" role="status" aria-live="polite">${e(s.packStatus)}</p>${warning}<div class="custom-tags-layout"><aside class="custom-preset-sidebar" aria-label="Custom tag presets"><div class="preset-sidebar-heading"><div><p class="eyebrow">PRESET FOLDERS</p><h3>My presets</h3></div><span class="preset-total">${s.tags.length}</span></div><button class="preset-all ${s.selectedPresetId === 'all' ? 'selected' : ''}" type="button" data-select-preset="all" aria-pressed="${s.selectedPresetId === 'all'}"><span><b>All Tags</b><small>${s.tags.length} cards</small></span><span aria-hidden="true">${s.selectedPresetId === 'all' ? '●' : '○'}</span></button><div class="custom-preset-list">${s.presets.map(p => this.preset(p, s)).join('')}</div>${s.creatingPreset ? '<form class="preset-create-form" id="custom-preset-form"><label class="field"><span>New preset folder</span><input id="custom-preset-name" maxlength="80" required></label><div><button class="primary" type="submit">Create preset</button><button class="tiny-copy" type="button" id="cancel-create-preset">Cancel</button></div></form>' : '<button class="secondary preset-create-button" type="button" id="create-preset">＋ New preset</button>'}${deletePrompt}</aside><form class="custom-tag-form" id="custom-tag-form"><div class="form-heading"><div><p class="eyebrow">CREATE OR EDIT</p><h3>${editing ? `Edit custom ${kind}` : `New custom ${kind}`}</h3></div>${editing ? '<button class="tiny-copy" type="button" id="cancel-custom-edit">Cancel edit</button>' : ''}</div><p class="custom-destination" role="status">Destination: <b>${e(destination?.name ?? 'My Tags')}</b>${s.selectedPresetId === 'all' ? ' <small>All Tags is a view. New cards go to My Tags.</small>' : ''}</p><label class="field custom-type-select"><span>Card type</span><select id="custom-card-kind" aria-label="Custom card type"><option value="tag"${kind === 'tag' ? ' selected' : ''}>Prompt tag</option><option value="artist"${kind === 'artist' ? ' selected' : ''}>Artist</option></select></label><div class="field image-field"><span>Image <i>${kind === 'artist' ? 'Optional' : 'Required'} PNG, JPEG, or WebP, up to 20 MiB</i></span><div class="custom-image-drop${image ? ' has-image' : ''}" id="custom-image-drop" tabindex="0" aria-describedby="custom-image-status"><input id="custom-tag-image" class="custom-file-input" type="file" accept="image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp" tabindex="-1"><button class="custom-image-empty-content" type="button" id="custom-tag-choose"${image ? ' hidden' : ''}><span class="drop-icon">＋</span><b>Drop an image here</b><span>or choose image</span></button>${preview}</div><p class="custom-image-status" id="custom-image-status">${kind === 'artist' ? 'Optional. Without an image, the artist uses the plus-card placeholder.' : 'Click or press Enter to choose an image.'}</p></div><label class="field"><span>${kind === 'artist' ? 'Artist name' : 'Tag'}</span><input id="custom-tag-name" value="${e(editing?.tag ?? '')}" required maxlength="4096"></label>${constructor}<label class="field"><span>Description / guide <i>(optional)</i></span><textarea id="custom-tag-description" maxlength="2000">${e(editing?.description ?? '')}</textarea></label><p class="custom-tag-status" id="custom-tag-status" role="status" aria-live="polite"></p><button class="primary custom-save-button" type="submit">${editing ? 'Save changes' : `Save custom ${kind}`}</button></form><section class="custom-tag-library"><div class="subheading"><div><p class="eyebrow">SAVED CARDS</p><h3>${cards.length} shown <span>·</span> ${s.tags.length} total</h3></div><div class="custom-library-tools"><input id="custom-tag-search" aria-label="Search custom cards" value="${e(s.search)}" placeholder="Search your cards...">${sortControls}<div class="custom-zone-filter" role="group" aria-label="Filter saved cards">${filters.map(f => `<button type="button" class="chip ${s.filter === f ? 'on' : ''}" data-custom-filter="${f}" aria-pressed="${s.filter === f}">${f === 'all' ? 'All' : f === 'artist' ? 'Artists' : f === 'render' ? 'Render' : f[0].toUpperCase()+f.slice(1)}</button>`).join('')}</div></div></div>${orderHint ? `<p class="custom-order-hint${canReorder ? '' : ' is-disabled'}">${orderHint}</p>` : ''}<div class="custom-tag-grid" id="custom-tag-grid" tabindex="0">${cards.length ? cards.map(tag => this.card(tag, s)).join('') : '<p class="empty-inline">No saved cards match this preset and filter yet.</p>'}</div></section></div><div id="custom-tag-pack-drop-overlay" class="custom-tag-pack-drop-toast" hidden aria-hidden="true" role="status" aria-live="polite"><b>Drop .naipack to import</b><span>One Custom Tags pack will be imported.</span></div></section></section>`;
  }
  refresh(controller: WorkspaceController, afterPatch?: (scope: ParentNode) => void): void { const s = this.state(); const cards = this.visible(s); const grid = document.querySelector<HTMLElement>('#custom-tag-grid'); if (!grid) return; controller.patch({ kind: 'fragment', selector: '#custom-tag-grid', markup: cards.length ? cards.map(tag => this.card(tag, s)).join('') : '<p class="empty-inline">No saved cards match this preset and filter yet.</p>' }); const heading = grid.closest('.custom-tag-library')?.querySelector<HTMLElement>('.subheading h3'); if (heading) heading.innerHTML = `${cards.length} shown <span>·</span> ${s.tags.length} total`; document.querySelectorAll<HTMLButtonElement>('[data-custom-filter]').forEach(button => { const on = button.dataset.customFilter === s.filter; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); }); document.querySelectorAll<HTMLButtonElement>('[data-custom-sort]').forEach(button => { const on = button.dataset.customSort === s.sort; button.classList.toggle('on', on); button.setAttribute('aria-pressed', String(on)); }); const hint = grid.closest('.custom-tag-library')?.querySelector<HTMLElement>('.custom-order-hint'); if (hint) { const canReorder = this.reorderEnabled(s); hint.textContent = canReorder ? 'Drag cards or use arrows to set the saved folder order.' : s.sort === 'a-z' ? 'A–Z is a view-only sort.' : s.selectedPresetId === 'all' ? 'Select a preset folder to reorder its cards.' : s.search.trim() || s.filter !== 'all' ? 'Clear search and filters to reorder cards.' : ''; hint.classList.toggle('is-disabled', !canReorder); } afterPatch?.(grid); }
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
    if (event.type === 'input' && element instanceof HTMLInputElement && element.id === 'custom-tag-search') { this.actions.search(element.value); return true; }
    if (event.type === 'change' && element instanceof HTMLInputElement && element.id === 'custom-tag-image') { this.actions.readImage(element.files?.[0]); return true; }
    if (event.type === 'change' && element instanceof HTMLSelectElement && element.id === 'custom-card-kind') { this.actions.setKind(element.value === 'artist' ? 'artist' : 'tag'); return true; }
    if (event.type === 'change' && element instanceof HTMLInputElement && element.dataset.customZone) { document.querySelectorAll('.zone-choice').forEach(label => label.classList.toggle('selected', (label.querySelector('input') as HTMLInputElement | null)?.checked ?? false)); return true; }
    if (event.type === 'submit' && element instanceof HTMLFormElement) { event.preventDefault(); if (element.id === 'custom-tag-form') this.actions.saveTag(); else if (element.id === 'custom-preset-form') this.actions.createPreset(element.querySelector<HTMLInputElement>('#custom-preset-name')?.value ?? ''); else if (element.dataset.presetRenameForm) this.actions.renamePreset(element.dataset.presetRenameForm, element.querySelector('input')?.value ?? ''); else return false; return true; }
    if (event.type === 'keydown' && element?.closest('#custom-image-drop') && event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); document.querySelector<HTMLInputElement>('#custom-tag-image')?.click(); return true; }
    if (event.type !== 'click') return false; const button = element?.closest<HTMLButtonElement>('button'); if (!button) return false;
    if (button.dataset.customFilter) this.actions.filter(button.dataset.customFilter as CustomTagFilter); else if (button.dataset.selectPreset) this.actions.selectPreset(button.dataset.selectPreset); else if (button.id === 'create-preset') this.actions.beginCreatePreset(); else if (button.id === 'cancel-create-preset') this.actions.cancelCreatePreset(); else if (button.dataset.renamePreset) this.actions.beginRenamePreset(button.dataset.renamePreset); else if (button.dataset.cancelRename) this.actions.cancelRenamePreset(); else if (button.dataset.deletePreset) this.actions.beginDeletePreset(button.dataset.deletePreset); else if (button.id === 'cancel-delete-preset') this.actions.cancelDeletePreset(); else if (button.dataset.confirmDeletePreset) this.actions.confirmDeletePreset(button.dataset.confirmDeletePreset, button.dataset.deleteMode === 'delete' ? 'delete' : 'move'); else if (button.dataset.editCustomTag) this.actions.editTag(button.dataset.editCustomTag); else if (button.dataset.deleteCustomTag) this.actions.deleteTag(button.dataset.deleteCustomTag); else if (button.id === 'cancel-custom-edit') this.actions.cancelEdit(); else if (button.id === 'custom-tag-choose' || button.closest('#custom-image-drop')) document.querySelector<HTMLInputElement>('#custom-tag-image')?.click(); else if (button.id === 'custom-tag-import') this.actions.importPack(); else if (button.dataset.exportPreset) this.actions.exportPreset(button.dataset.exportPreset); else return false; return true;
  }
}

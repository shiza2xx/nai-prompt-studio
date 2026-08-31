export type WorkspaceId = 'prompt' | 'artist-mix' | 'saved-library' | 'custom-tags' | 'metadata' | 'settings';

export interface WorkspaceLifecycle {
  mount(host: HTMLElement): void;
  update?(change: WorkspaceChange): void;
  deactivate?(): void;
  dispose(): void;
}

export type WorkspaceChange =
  | { kind: 'structure'; markup: string }
  | { kind: 'fragment'; selector: string; markup: string }
  | { kind: 'text'; selector: string; value: string }
  | { kind: 'attributes'; selector: string; values: Record<string, string | boolean | null> };

function replaceMarkup(host: HTMLElement, markup: string): void {
  const template = document.createElement('template');
  template.innerHTML = markup;
  host.replaceChildren(template.content.cloneNode(true));
}

class DomWorkspaceLifecycle implements WorkspaceLifecycle {
  private readonly host: HTMLElement;
  private markup: string;
  constructor(host: HTMLElement, markup: string) { this.host = host; this.markup = markup; }
  mount(): void { replaceMarkup(this.host, this.markup); }
  update(change: WorkspaceChange): void {
    if (change.kind === 'structure') { this.markup = change.markup; replaceMarkup(this.host, change.markup); return; }
    const target = this.host.querySelector<HTMLElement>(change.selector);
    if (!target) return;
    if (change.kind === 'fragment') replaceMarkup(target, change.markup);
    else if (change.kind === 'text') target.textContent = change.value;
    else for (const [name, value] of Object.entries(change.values)) {
      if (value == null || value === false) target.removeAttribute(name);
      else target.setAttribute(name, value === true ? '' : value);
    }
  }
  deactivate(): void { this.host.setAttribute('aria-busy', 'true'); }
  dispose(): void { this.host.removeAttribute('aria-busy'); this.host.replaceChildren(); }
}

/** Stable application shell. Its root and host nodes survive every workspace switch. */
export class WorkspaceController {
  readonly shell: HTMLElement;
  readonly chromeHost: HTMLElement;
  readonly workspaceHost: HTMLElement;
  readonly overlayHost: HTMLElement;
  private active: WorkspaceId | null = null;
  private activeLifecycle: WorkspaceLifecycle | null = null;
  private chromeMarkup = '';
  private overlayMarkup = '';
  readonly root: HTMLElement;
  private readonly onAction: (event: Event) => void;

  constructor(root: HTMLElement, onAction: (event: Event) => void) {
    this.root = root;
    this.onAction = onAction;
    root.innerHTML = '<main class="app-shell"><div data-app-chrome-host></div><div data-workspace-host></div></main><div data-overlay-host></div>';
    this.shell = root.querySelector<HTMLElement>('.app-shell')!;
    this.chromeHost = root.querySelector<HTMLElement>('[data-app-chrome-host]')!;
    this.workspaceHost = root.querySelector<HTMLElement>('[data-workspace-host]')!;
    this.overlayHost = root.querySelector<HTMLElement>('[data-overlay-host]')!;
    for (const type of ['click', 'input', 'change', 'submit', 'keydown', 'dragstart', 'dragover', 'drop', 'dragend'] as const) root.addEventListener(type, this.onAction);
  }

  updateChrome(shellClass: string, markup: string): void {
    this.shell.className = shellClass;
    if (markup === this.chromeMarkup) return;
    this.chromeMarkup = markup;
    replaceMarkup(this.chromeHost, markup);
  }

  mount(workspace: WorkspaceId, markup: string): boolean {
    const changed = workspace !== this.active;
    if (!changed && this.activeLifecycle) { this.activeLifecycle.update?.({ kind: 'structure', markup }); return false; }
    this.activeLifecycle?.deactivate?.();
    this.activeLifecycle?.dispose();
    this.active = workspace;
    this.activeLifecycle = new DomWorkspaceLifecycle(this.workspaceHost, markup);
    this.activeLifecycle.mount(this.workspaceHost);
    return changed;
  }

  updateOverlays(markup: string): void {
    if (markup === this.overlayMarkup) return;
    this.overlayMarkup = markup;
    replaceMarkup(this.overlayHost, markup);
  }

  patch(change: WorkspaceChange): boolean {
    if (!this.activeLifecycle) return false;
    this.activeLifecycle.update?.(change);
    return true;
  }

  dispose(): void {
    this.activeLifecycle?.deactivate?.();
    this.activeLifecycle?.dispose();
    this.activeLifecycle = null;
    for (const type of ['click', 'input', 'change', 'submit', 'keydown', 'dragstart', 'dragover', 'drop', 'dragend'] as const) this.root.removeEventListener(type, this.onAction);
    this.root.replaceChildren();
  }
}

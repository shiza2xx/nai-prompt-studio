import { bindArtistCardPreview } from './artist-card-preview';
import { extractImageMetadata, type ImageMetadata, type MetadataCharacter } from './image-metadata';
import { escapeMetadataHtml, MetadataArtistHighlighter } from './metadata-artist-highlight';
import type { CatalogCard } from './types';

type State = 'empty' | 'loading' | 'success' | 'error';
const escapeHtml = escapeMetadataHtml;

export class MetadataWorkspace {
  private state: State = 'empty';
  private result: ImageMetadata | null = null;
  private error = '';
  private basePolarity: 'positive' | 'negative' = 'positive';
  private characterPolarities: Array<'positive' | 'negative'> = [];
  private highlightedArtists: readonly CatalogCard[] | null = null;
  private highlighter = new MetadataArtistHighlighter([]);
  private sourceObjectUrl: string | null = null;
  private sourceFilename = '';
  private readToken = 0;

  constructor(private readonly catalogArtists: () => readonly CatalogCard[] = () => [], private readonly imageResolver?: (card: CatalogCard) => string) {}

  markup(): string {
    const status = this.state === 'loading' ? '<p class="metadata-status" role="status"><i class="status-skeleton"></i>Reading local image metadata...</p>'
      : this.state === 'error' ? `<p class="metadata-status error" role="alert">${escapeHtml(this.error)}</p>` : '';
    const content = this.result ? this.resultMarkup(this.result) : `<div class="metadata-empty"><span class="brand-mark">N</span><h2>Read an image's hidden prompt.</h2><p>Choose or drop a NovelAI Image. Analysis stays entirely on this device and never changes your prompt builder.</p></div>`;
    return `<section class="metadata-workspace" aria-labelledby="metadata-title"><header class="workspace-intro metadata-intro"><div><p class="eyebrow">IMAGE METADATA</p><h2 id="metadata-title">Reveal the image's data.</h2><p>Metadata extraction is based on <a href="https://github.com/NovelAI/novelai-image-metadata" target="_blank" rel="noopener noreferrer">NovelAI's official image metadata repository</a>.</p></div></header><div class="metadata-drop ${this.state === 'loading' ? 'is-loading' : ''}" id="metadata-drop" tabindex="0" role="button" aria-label="Choose a NovelAI image or drop one here"><input id="metadata-file" type="file" accept="image/png,.png,image/webp,.webp" hidden><b>Drop a image here</b><span>or</span><button class="secondary" type="button" id="metadata-choose">Choose image</button></div>${status}<div id="metadata-result">${content}</div></section>`;
  }

  bind(root: HTMLElement, refresh: () => void): void {
    const input = root.querySelector<HTMLInputElement>('#metadata-file');
    const choose = root.querySelector<HTMLButtonElement>('#metadata-choose');
    const drop = root.querySelector<HTMLElement>('#metadata-drop');
    const select = (file?: File) => { if (file) void this.read(file, refresh); };
    choose?.addEventListener('click', event => { event.stopPropagation(); input?.click(); });
    input?.addEventListener('change', () => select(input.files?.[0]));
    drop?.addEventListener('click', () => input?.click());
    drop?.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input?.click(); } });
    for (const eventName of ['dragenter', 'dragover']) drop?.addEventListener(eventName, event => { event.preventDefault(); drop.classList.add('is-dragging'); });
    for (const eventName of ['dragleave', 'drop']) drop?.addEventListener(eventName, event => { event.preventDefault(); drop.classList.remove('is-dragging'); });
    drop?.addEventListener('drop', event => select(event.dataTransfer?.files[0]));
    root.querySelectorAll<HTMLButtonElement>('[data-metadata-polarity]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.metadataPolarity);
      const polarity = button.dataset.polarity === 'negative' ? 'negative' : 'positive';
      if (index < 0) this.basePolarity = polarity; else this.characterPolarities[index] = polarity;
      refresh();
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-metadata-copy]').forEach(button => button.addEventListener('click', () => {
      const value = this.activePrompt(Number(button.dataset.metadataCopy));
      if (value) void this.copyPrompt(value, button);
    }));
    bindArtistCardPreview(root);
  }

  private async read(file: File, refresh: () => void): Promise<void> {
    const request = ++this.readToken;
    this.releaseSourceImage();
    this.state = 'loading'; this.result = null; this.error = ''; refresh();
    try {
      const result = await extractImageMetadata(file);
      if (request !== this.readToken) return;
      this.result = result; this.sourceObjectUrl = URL.createObjectURL(file); this.sourceFilename = file.name; this.basePolarity = 'positive'; this.characterPolarities = this.result.characters.map(() => 'positive'); this.state = 'success';
    }
    catch (error) {
      if (request !== this.readToken) return;
      this.state = 'error'; this.error = error instanceof Error ? error.message : 'The image metadata could not be read.';
    }
    refresh();
  }

  dispose(): void { this.readToken += 1; this.releaseSourceImage(); }

  private polarityBlock(label: string, prompt: MetadataCharacter, index: number, polarity: 'positive' | 'negative'): string {
    const activeValue = prompt[polarity];
    const value = activeValue || '(No prompt recorded for this side.)';
    const copyLabel = `Copy ${label} ${polarity} prompt`;
    return `<article class="metadata-prompt"><header><b>${label}</b><div class="metadata-toggle" role="group" aria-label="${escapeHtml(label)} polarity"><button type="button" class="${polarity === 'positive' ? 'on' : ''}" data-metadata-polarity="${index}" data-polarity="positive" aria-pressed="${polarity === 'positive'}">Positive</button><button type="button" class="${polarity === 'negative' ? 'on' : ''}" data-metadata-polarity="${index}" data-polarity="negative" aria-pressed="${polarity === 'negative'}">Negative</button></div></header><pre>${this.artistHighlighter().render(value)}</pre><div class="metadata-prompt-actions"><button class="secondary metadata-copy" type="button" data-metadata-copy="${index}" aria-label="${escapeHtml(copyLabel)}" ${activeValue ? '' : 'disabled'}>Copy prompt</button></div></article>`;
  }

  private resultMarkup(result: ImageMetadata): string {
    const settings = [result.steps && `${result.steps} steps`, result.sampler, result.width && result.height && `${result.width} x ${result.height}`, result.scale && `CFG ${result.scale}`].filter(Boolean).join('  ·  ') || 'Settings unavailable';
    const characters = result.characters.length ? result.characters.map((item, index) => this.polarityBlock(`Character ${index + 1}`, item, index, this.characterPolarities[index] ?? 'positive')).join('') : '<p class="metadata-no-characters">No character prompts were recorded in this image.</p>';
    const sourceImage = this.sourceObjectUrl ? `<figure class="metadata-source-image"><img src="${escapeHtml(this.sourceObjectUrl)}" alt="Uploaded image: ${escapeHtml(this.sourceFilename)}"><figcaption>${escapeHtml(this.sourceFilename)}</figcaption></figure>` : '';
    return `<section class="metadata-results">${sourceImage}<div class="metadata-model"><span>MODEL</span><b>${escapeHtml(result.model)}</b></div><div class="metadata-settings"><span>SETTINGS</span><b>${escapeHtml(settings)}</b></div>${this.polarityBlock('Base prompt', result.base, -1, this.basePolarity)}${characters}</section>`;
  }

  private activePrompt(index: number): string {
    if (!this.result) return '';
    if (index < 0) return this.result.base[this.basePolarity];
    const character = this.result.characters[index];
    return character ? character[this.characterPolarities[index] ?? 'positive'] : '';
  }

  private async copyPrompt(value: string, button: HTMLButtonElement): Promise<void> {
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard permissions are optional */ }
    const initial = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => { button.textContent = initial; }, 900);
  }

  private releaseSourceImage(): void {
    if (this.sourceObjectUrl) URL.revokeObjectURL(this.sourceObjectUrl);
    this.sourceObjectUrl = null;
    this.sourceFilename = '';
  }

  private artistHighlighter(): MetadataArtistHighlighter {
    const artists = this.catalogArtists();
    if (artists !== this.highlightedArtists) {
      this.highlightedArtists = artists;
      this.highlighter = new MetadataArtistHighlighter(artists, this.imageResolver);
    }
    return this.highlighter;
  }
}

# NAI Prompt Studio

NAI Prompt Studio is a local Windows desktop workspace for building NovelAI prompts, experimenting with V5 artist combinations, managing visual prompt references, and reading image metadata.

## Features

- Prompt Builder with visual constructors for Frame, Scene, Render/Quality, and the active character prompt, plus separate undesired-content and character prompts
- V5 artist browser with favorites, weighted tags, animated card previews, random artist counts, and per-card or global weight rerolls
- Artist Mix workspace with one or more fixed primary artists and shuffled companion artists, favorites-only pools, focus mode, and one-click prompt copying
- Searchable character card browser with separate positive and negative character prompts
- Custom Tags presets with personal images, descriptions, character-zone prompt cards, and custom artist cards; a matching future NAX entry can replace a personal artist preview automatically
- Custom Tags folders can be shared with one `.naipack` file. Packs include the cards, descriptions, and original PNG/JPEG/WebP previews and can be moved between app profiles.
- Saved Library for independent prompt, Artist Mix, and Character records with optional cover images, editable descriptions, positive/negative switching, character details, and per-field copy actions
- NovelAI PNG/WebP metadata inspection plus Danbooru, Konachan, and Safebooru post loading, with selective tag saving, artist highlighting, preview cards, and direct Saved Library actions
- Manual and optional startup checks for additions to the exact NAX V5 artist catalog, with live catalog refresh after downloading
- App-local settings, caches, catalog data, logs, and verified GitHub update downloads
- Eight interface themes: Arcane Gold, Midnight Blue, Raspberry Rose, Noir, Celestial Light, Ember Peach, Gothic, and Galaxy
- First-run guide, percentage-based startup loading screen, configurable interface animations, and hover previews for visual cards

The source repository intentionally excludes the multi-gigabyte offline catalog. Public releases provide separate catalog packs and a Windows installer.

v0.6.3 uses a lightweight installer. During installation, V5 artist and Prompt Builder components are selected by default, while the optional V4.5 character catalog is off by default; selected missing components download when the application first launches. Upgrades preserve installed data and catalogs, while the v0.6.2 legacy pack is migrated. The V5 artist component contains exactly 4,198 cards; after downloading, refresh additions manually from Settings or enable the optional startup check.

## Saved Library and updates

Saved Library keeps independent prompt, Artist Mix, and Character records, including metadata-derived prompts and optional cover images, in the local application profile. Each prompt or character section can be inspected and copied separately. Nothing is uploaded automatically.

The Settings workspace can check for a newer public release, show download progress, verify the installer size and SHA-512 digest, and launch the new installer for the same installation folder while preserving the existing `data` directory.

## Roadmap

- **Constructor folders:** Prompt Builder folders and shareable Custom Tags `.naipack` export/import are available now.

## Source-only clones and catalog hydration

The Git repository contains application code, tests and build tooling only. Download the V5 artists, characters and constructor-guide ASAR components from the matching GitHub Release, then hydrate a development checkout:

```powershell
npm run catalog:hydrate -- D:\Downloads\nai-v5-artists.asar D:\Downloads\nai-characters.asar D:\Downloads\nai-constructor-guide.asar
```

The command extracts only into `public/catalog` in the current checkout. Release maintainers can create the three assets with `npm run release:catalog-packs`; every pack is checked against GitHub's 2 GiB asset limit.

## Development

Requirements:

- Windows 10 or newer
- Node.js 22 or newer
- npm 10 or newer

Install dependencies and start the desktop development build:

```powershell
npm install
npm run dev
```

Run the verification suite:

```powershell
npm test
npm run build
```

Create the Windows installer:

```powershell
npm run desktop:build
```

The generated setup is a single-file Windows installer. It lets the user choose an installation directory, creates the application folder there, offers Start Menu and Desktop shortcut options, and can launch the app from the finish page. The uninstaller can preserve or remove the local profile. Installed settings, catalogs, custom cards, and update cache remain beside the application instead of moving to another drive.

All project commands route temporary files and package caches into project-local folders on the current drive. Development state lives in `.app-data`. An installed copy stores mutable data in its own `data` folder beside the application files.

The Windows setup is currently unsigned, so Microsoft SmartScreen may show an unknown-publisher warning. Download releases only from this repository and compare the setup SHA-512 with `update-manifest.json`. The in-app updater validates the release host, size and SHA-512 before it launches the installer. Updates preserve the app-local `data` folder.

## Catalog sources

The V5 artist catalog is derived from the exact [NAX V5 artist gallery](https://nax.moe/?gallery=danbooru-artist-tags-2-v5). NAX artist preview assets are distributed under CC BY 4.0 and retain source attribution.

Built-in visual tag references are based on [hothottuk's NovelAI guide](https://hothottuk.neocities.org/en). The metadata reader is based on concepts and compatible behavior from the official [NovelAI image metadata repository](https://github.com/NovelAI/novelai-image-metadata).

Danbooru tag names used by the catalog tooling come from the [SpadeA/danbooru-tag-csv dataset](https://huggingface.co/datasets/SpadeA/danbooru-tag-csv).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and license boundaries.

## Privacy

NAI Prompt Studio runs locally. Personal custom-tag images, settings, prompt drafts, catalogs, caches, and extracted image metadata stay on the device unless the user explicitly exports or copies them.

## License

Application source code is released under the [MIT License](LICENSE). Catalog images, guide references, names, trademarks, and third-party material remain under their respective terms and are not relicensed by the MIT License.

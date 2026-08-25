# NAI Prompt Studio

NAI Prompt Studio is a local Windows desktop workspace for building NovelAI prompts, mixing V5 artist tags, managing custom visual tags, and reading image metadata.

## Features

- Prompt Builder with visual tag constructors for frame, scene, and render choices
- V5 artist browser with favorites, weighted tags, card previews, and random selection
- Artist Mix workspace for keeping one or more primary artists fixed while shuffling companions
- Character prompt workspace with searchable card browser
- Custom Tags presets with personal preview images and descriptions
- Saved Library for editable Prompt Builder and Artist Mix snapshots, optional cover images, search and restore
- Local NovelAI image metadata inspection for PNG and WebP files
- App-local settings, cache, catalog data, logs, and verified GitHub updates
- Four interface themes: Arcane Gold, Midnight Blue, Raspberry Rose and Noir

The source repository intentionally excludes the multi-gigabyte offline catalog. Public releases provide separate catalog packs and a Windows installer.

## Saved Library and updates

Saved Library keeps prompt snapshots, Artist Mix snapshots and optional cover images in the local application profile. Nothing is uploaded automatically. The Settings workspace can check for a newer public release, verify its size and SHA-512 digest, and launch the new installer in the same installation folder while preserving the existing `data` directory.

## Source-only clones and catalog hydration

The Git repository contains application code, tests and build tooling only. Download the V5 artists, characters and constructor-guide packs from the matching GitHub Release, then hydrate a development checkout:

```powershell
npm run catalog:hydrate -- D:\Downloads\nai-v5-artists.zip D:\Downloads\nai-characters.zip D:\Downloads\nai-constructor-guide.zip
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

The generated setup is a single-file Windows installer. It lets the user choose an installation directory, creates the application folder there, and keeps the installed profile and update cache beside the executable.

All project commands route temporary files and package caches into project-local folders on the current drive. Development state lives in `.app-data`. An installed copy stores mutable data in its own `data` folder beside the application files.

The Windows setup is currently unsigned, so Microsoft SmartScreen may show an unknown-publisher warning. Download releases only from this repository and compare the setup SHA-512 with `update-manifest.json`. The in-app updater validates the release host, size and SHA-512 before it launches the installer. Updates preserve the app-local `data` folder.

## Catalog sources

The V5 artist catalog is derived from the exact [NAX V5 artist gallery](https://nax.moe/?gallery=danbooru-artist-tags-2-v5). NAX artist preview assets are distributed under CC BY 4.0 and retain source attribution.

Built-in visual tag references are based on [hothottuk's NovelAI guide](https://hothottuk.neocities.org/en). The metadata reader is based on concepts and compatible behavior from the official [NovelAI image metadata repository](https://github.com/NovelAI/novelai-image-metadata).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and license boundaries.

## Privacy

NAI Prompt Studio runs locally. Personal custom-tag images, settings, prompt drafts, catalogs, caches, and extracted image metadata stay on the device unless the user explicitly exports or copies them.

## License

Application source code is released under the [MIT License](LICENSE). Catalog images, guide references, names, trademarks, and third-party material remain under their respective terms and are not relicensed by the MIT License.

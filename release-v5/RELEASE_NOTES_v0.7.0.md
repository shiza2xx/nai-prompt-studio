# NAI Prompt Studio v0.7.0

## Highlights

### Create

- Prompt Builder now has a dedicated Base Prompt area with quick clear, so the prompt flow is easier to read and edit.
- Custom Tags Select Mode lets you select multiple cards and move or delete them together.

### Mix

- Turn on Use Artist Mix in Prompt Builder to include one shared mix, keep multiple anchor artists, and work with up to 12 total artists.
- Set a range, clear the mix quickly, and tune weights with readable controls and mouse-wheel support. Successful Artist Mix updates stay quiet while warnings remain visible.

### Library

- Saved Library has one New tile for Prompt, Artist Mix, and Character records.
- Use in Builder replaces the current Base Prompt, Undesired content, and Characters with editable saved content while Frame, Scene, Render, Artist Mix, and random range remain unchanged.

### Performance and UI

- Grid previews stay ready while browsing, filtering, and changing folders. Image-only hover previews adapt to each card, and original files stay unchanged.
- Choose 100%, 110%, or 125% interface scale and keep it between sessions. A glass header and stable hover focus make controls and text easier to follow.

## Compatibility, privacy, and storage

- Existing v0.6.9 profiles remain compatible. Prompts, saved work, Custom Tags, and settings stay in place. V5 catalog components are unchanged v0.6.3 assets.
- NAI Prompt Studio runs locally. Personal prompts, custom images, settings, and extracted metadata stay on the device unless explicitly exported or copied.
- Runtime temporary files stay in the app profile under `data/temp`, and cache files stay under `data/cache`. Historical Windows `%TEMP%` leftovers are not removed automatically. Close the app and installer, review Windows temporary files first, and remove only clearly identifiable old NAI Prompt Studio, Electron, or ASAR-related leftovers. Skip anything in use or uncertain.

## Installer note

The Windows installer is unsigned, so Microsoft SmartScreen may show an unknown-publisher warning. Download releases only from this repository and compare the setup SHA-512 with `update-manifest.json`.

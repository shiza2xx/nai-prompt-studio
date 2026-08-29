# NAI Prompt Studio v0.6.4

## Catalog recovery and stable artist cards

- Fixed verified catalog component recovery after an interrupted download, including completed partial files and HTTP 416 resume failures.
- Repair now validates an existing healthy component locally instead of downloading it again.
- Fixed V5 artist card thumbnails in Prompt Builder and Artist Mix pickers: cards remain visible after scrolling, searching, changing pages, or switching Favorites.

## Lightweight installer and catalog assets

- The lightweight installer keeps V5 artist and Prompt Builder libraries selected by default; the optional V4.5 character library remains off by default.
- Existing catalogs, Custom Tags, settings, Saved Library records, and other local data are preserved during upgrades.
- This release includes the verified V5 artist, V4.5 character, and Prompt Builder reference packs for direct downloads.

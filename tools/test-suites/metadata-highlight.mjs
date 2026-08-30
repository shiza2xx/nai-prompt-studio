import assert from 'node:assert/strict'; import {readFileSync,readdirSync} from 'node:fs'; import { EXPECTED_CARD_COUNT } from '../update-v5-catalog.mjs'; import {MetadataArtistHighlighter,decodeCatalogEntities,escapeMetadataHtml,extractMetadataArtists,serializeMetadataArtists} from '../../src/metadata-artist-highlight.ts'; import {ARTIST_PAGE_SIZE,CHARACTER_PAGE_SIZE,filterCharacters,paginateArtists,paginateCharacters} from '../../src/catalog-browser.ts';
const catalog = JSON.parse(readFileSync(new URL('../../public/catalog/catalog.json', import.meta.url), 'utf8'));
assert.equal(EXPECTED_CARD_COUNT, 4198);
assert.equal(catalog.artists.length, EXPECTED_CARD_COUNT);
assert.equal(catalog.characters.length, 5457);
assert.ok(catalog.artists.length > 0);
assert.ok(catalog.artists.every(card => card.id.startsWith('artist-v5-') && card.gallery === 'danbooru-artist-tags-2-v5' && card.image.startsWith('cards/artist/danbooru-artist-tags-2-v5/') && card.image.endsWith('.webp')));
assert.ok(catalog.characters.every(card => card.gallery === 'danbooru-character-tags-v4.5' && card.image.startsWith('cards/character/danbooru-character-tags-v4.5/')));
assert.ok(catalog.tags.every(tag => !catalog.danbooruTags.some(item => item.category === 1 && item.tag === tag)));
assert.equal(catalog.artists.filter(card => /[0-9]$/.test(card.tag)).length, 166);
const highlightFixture = [
  { id: 'aogisa', tag: 'aogisa', gallery: 'v5', image: 'aogisa.webp', score: 0 },
  { id: 'aogisa88', tag: 'aogisa88', gallery: 'v5', image: 'aogisa88.webp', score: 0 },
  { id: 'aki99', tag: 'aki99', gallery: 'v5', image: 'aki99.webp', score: 0 },
  { id: 'spice', tag: '13 (spice!!)', gallery: 'v5', image: 'spice.webp', score: 0 },
  { id: 'gin', tag: 'gin&#039;ichi', gallery: 'v5', image: 'gin.webp', score: 0 },
  { id: 'space', tag: 'space artist', gallery: 'v5', image: 'space.webp', score: 0 },
  { id: 'fullwidth', tag: 'Aki99', gallery: 'v5', image: 'fullwidth.webp', score: 0 },
  { id: 'colon', tag: 'n:go', gallery: 'v5', image: 'n-go.webp', score: 0 },
  { id: 'unsafe', tag: '<unsafe>', gallery: 'v5', image: 'unsafe.webp', score: 0 }
];
const highlighter = new MetadataArtistHighlighter(highlightFixture);
const extractionPrompt = 'artist: missing artist, 1.3::artist: aki99::, artist: aogisa88::0.7, gin&#039;ichi, aki99';
assert.deepEqual(highlighter.extract(extractionPrompt), extractMetadataArtists(extractionPrompt, highlightFixture), 'indexed extraction preserves the public helper contract');
const highlighted = highlighter.render("artist: aogisa88, AOGISA, aki99, 13 (spice!!), gin'ichi, <unsafe>, <script>");
assert.match(highlighted, /data-artist-preview-image="\.\/catalog\/aki99\.webp"/);
assert.match(highlighted, /data-artist-preview-tag="aki99" data-artist-preview-prompt="artist: aki99"/);
assert.match(highlighted, /tabindex="0"/);
assert.match(highlighted, /artist: aogisa88/);
assert.match(highlighted, /13 \(spice!!\)/);
assert.match(highlighted, /gin&#039;ichi/);
assert.match(highlighted, /&lt;script&gt;/);
assert.equal((highlighter.render('aogisa88').match(/metadata-artist-highlight/g) ?? []).length, 1);
assert.equal((highlighter.render('aogisa88x').match(/metadata-artist-highlight/g) ?? []).length, 0);
const whitespaceEquivalent = highlighter.render('space__artist and space   artist then ＡＫＩ９９');
assert.equal((whitespaceEquivalent.match(/metadata-artist-highlight/g) ?? []).length, 3);
assert.match(whitespaceEquivalent, />space__artist<|>space   artist</);
assert.match(whitespaceEquivalent, /ＡＫＩ９９/);
assert.equal(escapeMetadataHtml('<'), '&lt;');
assert.equal(decodeCatalogEntities('&amp; &lt; &gt; &quot; &#x27; &#039;'), "& < > \" ' '");
const actualAki99 = catalog.artists.find(card => card.tag === 'aki99');
assert.ok(actualAki99);
assert.match(new MetadataArtistHighlighter([actualAki99]).render('artist: aki99'), /metadata-artist-highlight/);
const catalogHighlighter = new MetadataArtistHighlighter(catalog.artists);
const catalogHighlight = catalogHighlighter.render("artist: aki99, gin'ichi (akacia), 13 (spice!!)");
assert.equal((catalogHighlight.match(/metadata-artist-highlight/g) ?? []).length, 3);
const explicitKnown = highlighter.render('1.2::artist: aogisa88::, artist: n:go, artist: space__artist');
assert.equal((explicitKnown.match(/metadata-artist-highlight/g) ?? []).length, 3);
assert.match(explicitKnown, /data-artist-preview-kind="known"/);
assert.match(explicitKnown, />aogisa88<.*?>n:go<.*?>space__artist</);
const explicitUnknown = highlighter.render('artist: aogisa-extra, artist: unknown person, aogisa');
assert.equal((explicitUnknown.match(/metadata-artist-highlight unknown/g) ?? []).length, 2);
assert.equal((explicitUnknown.match(/metadata-artist-highlight/g) ?? []).length, 3);
assert.match(explicitUnknown, /data-artist-preview-kind="message"/);
assert.match(explicitUnknown, /This artist is not in the local catalog, so a preview is unavailable\. You can test it directly on the NovelAI website\./);
assert.doesNotMatch(explicitUnknown, /data-artist-preview-image="[^"]*aogisa-extra/);
assert.equal((highlighter.render('unknown person').match(/metadata-artist-highlight/g) ?? []).length, 0);
assert.equal((highlighter.render('notartist: unknown').match(/metadata-artist-highlight unknown/g) ?? []).length, 0);
assert.equal((highlighter.render('some_artist: unknown').match(/metadata-artist-highlight unknown/g) ?? []).length, 0);
assert.equal((highlighter.render('{{artist: unknown}}').match(/metadata-artist-highlight unknown/g) ?? []).length, 1);
assert.equal((highlighter.render('ＡＲＴＩＳＴ：unknown').match(/metadata-artist-highlight unknown/g) ?? []).length, 1);
for (const terminator of [', next', ':: next', '\nnext', '} next', '] next']) {
  const rendered = highlighter.render(`artist: aogisa${terminator}`);
  assert.equal((rendered.match(/metadata-artist-highlight/g) ?? []).length, 1);
}
const normalizedExplicit = highlighter.render('artist: ＡＫＩ９９, artist: space___artist, artist: gin&#039;ichi');
assert.equal((normalizedExplicit.match(/metadata-artist-highlight/g) ?? []).length, 3);
const escapedUnknown = highlighter.render('artist: <unknown "artist">');
assert.match(escapedUnknown, /&lt;unknown &quot;artist&quot;&gt;/);
assert.doesNotMatch(escapedUnknown, /data-artist-preview-image/);
assert.doesNotMatch(escapedUnknown, /data-artist-preview-prompt/);

const assetDir = new URL('../../public/catalog/cards/artist/danbooru-artist-tags-2-v5', import.meta.url);
const assetCount = readdirSync(assetDir).filter(file => file.endsWith('.webp')).length;
assert.equal(assetCount, catalog.artists.length);
const characterAssetDir = new URL('../../public/catalog/cards/character/danbooru-character-tags-v4.5', import.meta.url);
assert.equal(readdirSync(characterAssetDir).filter(file => file.endsWith('.jpg')).length, 5457);
const browserFixture = Array.from({ length: 197 }, (_, index) => ({ id: `character-${index}`, tag: index === 150 ? 'Synthetic Beyond First Page' : `Character ${index}`, gallery: 'danbooru-character-tags-v4.5', image: `cards/character/${index}.jpg`, score: 0 }));
const firstCharacterPage = paginateCharacters(browserFixture, { page: 1 });
const lastCharacterPage = paginateCharacters(browserFixture, { page: 99 });
assert.equal(CHARACTER_PAGE_SIZE, 96);
assert.equal(firstCharacterPage.cards.length, 96);
assert.equal(lastCharacterPage.page, 3);
assert.equal(lastCharacterPage.cards.at(-1)?.id, 'character-196');
assert.equal(filterCharacters(browserFixture, 'beyond first page').length, 1);
assert.equal(paginateCharacters(browserFixture, { query: 'beyond first page' }).cards[0].id, 'character-150');
assert.equal(paginateCharacters(browserFixture, { favoritesOnly: true, favoriteIds: new Set(['character-150']) }).filteredCount, 1);
const artistBrowserFixture = Array.from({ length: 4198 }, (_, index) => ({ id: `artist-v5-${index}`, catalogId: `artist-v5-${index}`, tag: index === 3410 ? 'Synthetic Artist Beyond First Page' : `Artist ${index}`, gallery: 'danbooru-artist-tags-2-v5', image: `cards/artist/${index}.webp`, score: 0 }));
const firstArtistPage = paginateArtists(artistBrowserFixture, { page: 1 });
const lastArtistPage = paginateArtists(artistBrowserFixture, { page: 999 });
assert.equal(ARTIST_PAGE_SIZE, 72);
assert.equal(firstArtistPage.cards.length, 72);
assert.equal(lastArtistPage.pageCount, 59);
assert.equal(lastArtistPage.cards.length, 22);
assert.equal(paginateArtists(artistBrowserFixture, { query: 'beyond first page' }).cards[0].id, 'artist-v5-3410');

const artistExtractionFixture = [{ id: 'artist-v5-known', catalogId: 'artist-v5-known', tag: 'Known Artist 7', gallery: 'v5', image: 'known.webp', score: 0 }];
const extractedMetadataArtists = extractMetadataArtists('artist: Unknown Painter::1.4, 0.8::Known Artist 7 ::, Known Artist 7', artistExtractionFixture);
assert.equal(extractedMetadataArtists.length, 2);
assert.equal(extractedMetadataArtists[0].tag, 'artist: Unknown Painter');
assert.equal(extractedMetadataArtists[0].weight, 1.4);
assert.equal(extractedMetadataArtists[1].catalogId, 'artist-v5-known');
assert.match(serializeMetadataArtists(extractedMetadataArtists), /Known Artist 7 ::/);
const canonicalSerializedMetadataArtists = extractMetadataArtists('1.4::artist: Known Artist 7::', artistExtractionFixture);
assert.equal(canonicalSerializedMetadataArtists.length, 1);
assert.equal(canonicalSerializedMetadataArtists[0].weight, 1.4);
const canonicalUnknownMetadataArtist = extractMetadataArtists('1.4::artist: Unknown Painter::', []);
assert.equal(canonicalUnknownMetadataArtist.length, 1);
assert.equal(canonicalUnknownMetadataArtist[0].tag, 'artist: Unknown Painter');
assert.equal(canonicalUnknownMetadataArtist[0].weight, 1.4);

console.log('metadata-highlight tests passed.');

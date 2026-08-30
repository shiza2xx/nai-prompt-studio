# NAI Prompt Studio v0.6.6 — read-only audit

Дата аудита: 2026-08-30
Проверенный commit: `9f8a2cf75f4314a31211a634c4c91c8abee06fb3`
Режим: контролируемый read-only аудит с Luna Medium под надзором основного Sol-агента.

## Ограничения аудита

- Исходники, тесты, конфигурация, документация и release-файлы не изменялись.
- Git index, commit, branch, tag, remote и GitHub Release не изменялись.
- Приложение, Electron, установщик, деинсталлятор и updater не запускались.
- Сеть и реальные GitHub/NAX/booru-запросы не использовались.
- Тесты, создающие временные каталоги или fixtures, намеренно не запускались.
- Единственное разрешённое изменение рабочей директории — этот файл.

Это не security-сертификация и не замена ручному Windows runtime-тестированию. Выводы ниже отделяют подтверждённое кодом поведение от вероятных рисков и необязательных улучшений.

## Итог

Критических или High-проблем не найдено. Сохранены:

- две подтверждённые проблемы уровня Medium: release-команда catalog packs и обработка повреждённого профиля;
- один вероятный runtime-риск уровня Medium: конкурирующие загрузки каталога/гайда;
- один узкий build-риск уровня Low;
- пять улучшений контрактов, packaging, тестируемости и поддержки проекта.

Проверка не обнаружила подтверждённых обходов path containment, `.naipack` traversal, booru SSRF, нарушения проверки SHA-512 установщика или потери скачанного обновления при восстановимом partial-файле.

## Приоритетный список

| ID | Категория | Уровень | Уверенность | Кратко |
|---|---|---:|---:|---|
| AUD-001 | Confirmed maintenance defect | Medium | High | `release:catalog-packs` гарантированно отклоняет текущую версию 0.6.6 |
| AUD-002 | Confirmed logic/UX defect | Medium | High | Повреждённый `workspace.json` представляется как отсутствующий профиль |
| AUD-003 | Probable runtime race | Medium | Medium | Старый `loadCatalog()`/`loadGuide()` может примениться после нового запроса |
| AUD-004 | Probable build residue | Low | Medium | Hard termination может оставить изменённый шаблон внутри `node_modules` |
| AUD-005 | Contract hygiene | Low | High | TypeScript bridge обещает секции, которые main process молча отклоняет |
| AUD-006 | Packaging enhancement | Low | Medium | `public/card.png` не имеет найденных consumers и, вероятно, попадает в пакет |
| AUD-007 | Testability enhancement | Low | High | Часть тестов проверяет текст исходников вместо исполняемого поведения |
| AUD-008 | Automation enhancement | Low | High | В tracked tree нет CI workflow |
| AUD-009 | Maintainability enhancement | Low | High | Главный renderer и общий test-файл стали крупными точками связности |

---

## AUD-001 — catalog-pack команда несовместима с текущим checkout

Категория: confirmed maintenance defect
Уровень: Medium
Уверенность: High

### Доказательство

- `package.json:25` публикует команду `npm run release:catalog-packs`.
- `README.md:42` говорит release-maintainer'у использовать эту команду для создания трёх ASAR-компонентов.
- `tools/catalog-packs.mjs:14-15` читает текущий `package.json` и немедленно выбрасывает исключение, если версия не равна строго `0.6.3`.
- Текущая версия package — `0.6.6`.

### Сценарий

Maintainer клонирует или открывает текущий `main` v0.6.6 и запускает документированную команду. Скрипт останавливается до чтения каталога и до создания packs.

### Воздействие

Runtime установленного приложения не затронут: v0.6.6 намеренно переиспользует immutable catalog packs версии 0.6.3. Проблема находится в публично описанном release/maintenance workflow: команда текущего checkout не может выполнить обещанное действие.

### Направление улучшения

Отделить версию приложения от версии immutable catalog component set. Возможные направления для будущего решения:

- явный catalog-version в machine-readable descriptor;
- обязательный аргумент/флаг для pack generator;
- отдельный скрипт для восстановления immutable v0.6.3 set;
- либо убрать недоступную команду из README текущей версии.

### Нужный regression test

Preflight-тест: documented release command должна либо успешно пройти совместимую предварительную проверку, либо дать точное сообщение с рабочей командой/checkout, а не рекламироваться как доступная в текущем `main`.

---

## AUD-002 — повреждённый workspace выглядит как новый профиль

Категория: confirmed logic/UX defect
Уровень: Medium
Уверенность: High

### Доказательство

- `electron/main.cjs:58-84` обрабатывает отсутствие файла отдельно, но затем объединяет ошибки чтения и `JSON.parse` в общий `catch`.
- Этот `catch` возвращает `exists: false` и пустой snapshot для prompt sets, Saved Library, favorites, draft, settings и Artist Mix.
- `src/storage.ts:51-57` использует `desktopSnapshot.exists` как главный признак существующего desktop-профиля.
- `src/main.ts:28` сохраняет этот результат в `existingProfileAtStartup`.
- `src/main.ts:404-416` выбирает полный first-run overview, когда `existingProfileAtStartup` ложен.

### Сценарий

`workspace.json` существует, но обрезан, повреждён либо недоступен для чтения; browser `localStorage` при этом пуст. Приложение получает `exists: false` и открывает onboarding как для нового пользователя.

### Воздействие

- Пользователь видит пустые данные и first-run guide вместо понятного сообщения о повреждённом профиле.
- Это выглядит как потеря данных, даже если оригинальный файл остаётся на диске.
- Аудит не подтвердил физическую перезапись повреждённого файла: downstream writer имеет отдельные защитные проверки. Проблема — неверная классификация состояния и отсутствие recovery UX.

### Направление улучшения

Вернуть из main process явный статус, например `missing`, `ready`, `malformed`, `io-error`, плюс безопасное диагностическое сообщение. Renderer должен отличать настоящий первый запуск от профиля, требующего восстановления, и не предлагать misleading new-profile flow.

### Нужный regression test

Матрица: missing file; invalid JSON; permission error; valid legacy snapshot; valid current snapshot. Для invalid/permission вариантов проверить отсутствие first-run masquerade, сохранность исходных bytes и понятный recovery action.

---

## AUD-003 — возможна гонка результатов catalog/guide loaders

Категория: probable runtime race
Уровень: Medium
Уверенность: Medium

### Доказательство

- `src/main.ts:2989-3007` (`loadCatalog`) без request generation/token присваивает глобальные `officialArtists`, `catalog`, `catalogState` и `catalogError` после завершения await.
- `src/main.ts:3012-3027` (`loadGuide`) аналогично безусловно заменяет `guideCards`/`guideState`.
- Вызовы существуют из retry-обработчиков (`src/main.ts:1589-1590`, `2371`), после component transfer (`2727`) и во время startup (`3267`).
- Общей single-flight блокировки либо проверки «этот ответ принадлежит последнему запросу» нет.

### Сценарий

Два loader-вызова перекрываются — например, повторный startup/retry либо component refresh совпадает с уже выполняющейся загрузкой. Более новый запрос завершается успешно, затем старый завершается позже с ошибкой или старым snapshot и перезаписывает актуальное состояние.

Обычный retry частично защищён немедленной перерисовкой кнопки, поэтому проблема не объявляется подтверждённой runtime-регрессией. Однако все loader entry points не объединены одной блокировкой, а `bootApp()` выполняет await до установки части busy-state.

### Воздействие

В редком timing-сценарии готовый каталог/гайд может вернуться в error или stale state, после чего изменятся picker contents, random range и preview plan.

### Направление улучшения

Добавить monotonic request generation либо `AbortController`; применять данные и ошибки только от текущего запроса. Startup, component refresh и manual retry должны использовать единый resource-loader contract.

### Нужный regression test

Две контролируемые promises завершаются в обратном порядке: новая success → старая failure и новая success → старая success со старым snapshot. Финальное состояние всегда должно соответствовать последнему начатому запросу.

---

## AUD-004 — build может оставить patched dependency после hard termination

Категория: probable build reproducibility risk
Уровень: Low
Уверенность: Medium

### Доказательство

- `tools/electron-builder-nsis-store.mjs:9-23` напрямую изменяет `node_modules/app-builder-lib/.../installer.nsh`.
- `tools/build-installer.mjs:40-45` уже использует корректный `try/finally` для обычных ошибок и исключений.
- Hard process kill, power loss или падение хоста не выполняют JavaScript `finally`.

### Сценарий

Сборочный процесс завершается после `patchInstallerStoreCopy()`, но до `restoreInstallerStoreCopy()`.

### Воздействие

Следующая сборка в том же dependency tree начинается со скрыто изменённого файла сторонней зависимости. Это не runtime-дефект пользователя, но снижает воспроизводимость и усложняет диагностику сборки.

### Направление улучшения

Не патчить установленную dependency in-place: использовать изолированную копию template либо выполнять startup self-check/self-repair перед каждой сборкой. Добавление ещё одного `try/finally` проблему hard termination не решит — он уже присутствует.

---

## AUD-005 — renderer type contract шире runtime whitelist

Категория: enhancement / dormant contract mismatch
Уровень: Low
Уверенность: High в расхождении, Medium в практическом риске

### Доказательство

- `src/global.d.ts:22-23` разрешает generic `save`/`saveSync` для `customTags` и `customTagPresets`.
- `electron/main.cjs:86-92` не включает эти секции в runtime whitelist и молча возвращает управление.
- Текущий Custom Tags workflow использует отдельный transaction bridge; действующего production call site для generic save этих двух секций не найдено.

### Воздействие

Сейчас это не подтверждённая потеря данных. Но legacy или будущий renderer-код может считать вызов поддержанным на основании TypeScript-типа, тогда как main process выполнит silent no-op.

### Направление улучшения

Синхронизировать declaration, preload и runtime whitelist. Unsupported section должна либо отсутствовать в типе, либо возвращать диагностируемую ошибку вместо молчаливого игнорирования.

---

## AUD-006 — вероятно неиспользуемый `public/card.png`

Категория: packaging enhancement
Уровень: Low
Уверенность: Medium

### Доказательство

- Tracked asset `public/card.png` имеет размер 1,737,290 bytes.
- Поиск tracked text consumers не нашёл runtime-ссылок на `card.png`.
- Для `public/app-icon.png` и `public/plus.png` consumers найдены, что подтверждает корректность того же метода поиска.
- Vite обычно копирует содержимое `public` в output, поэтому asset, вероятно, попадает в упакованное приложение.

### Воздействие

Около 1.7 MB необязательных исходных данных и потенциальный лишний payload. Это не баг интерфейса.

### Направление улучшения

Сначала вручную подтвердить отсутствие runtime/installer use в собранном package. Только затем удалить или исключить asset отдельным согласованным изменением.

---

## AUD-007 — source-regex assertions ограничивают ценность части тестов

Категория: testability enhancement
Уровень: Low
Уверенность: High

### Доказательство

`tools/tests.mjs` содержит много полезных behavioral filesystem/network fixtures, но крупный участок также читает production source как текст и проверяет его через `assert.match`/`assert.doesNotMatch` (примерно с `tools/tests.mjs:1147` и далее).

### Воздействие

- Неработающий код с ожидаемой строковой формой способен пройти source assertion.
- Безопасный рефакторинг может сломать тест без изменения поведения.
- Наиболее заметный пробел — отсутствие executable test для перекрывающихся `loadCatalog`/`loadGuide` и полного malformed-profile → renderer flow.

### Направление улучшения

Сохранить source-contract checks только для действительно статических invariants. Lifecycle/state behavior вынести в импортируемые controllers и проверять controlled promises, IPC fakes и временные isolated profiles.

---

## AUD-008 — нет tracked CI workflow

Категория: automation enhancement
Уровень: Low
Уверенность: High

### Доказательство

`git ls-files '.github/**'` не вернул tracked workflow-файлов. Проверки зависят от ручного локального запуска перед релизом.

### Воздействие

Pull request или прямой push может попасть в `main` без автоматической проверки syntax, TypeScript и test suite.

### Направление улучшения

Когда изменения снова будут разрешены, добавить Windows CI с фиксированной Node-версией и отдельными jobs для TypeScript, syntax, deterministic unit tests и release-tool preflight. Installer execution в CI не обязателен; packaging можно оставить отдельным gated job.

---

## AUD-009 — крупные модули повышают стоимость регрессий

Категория: maintainability enhancement
Уровень: Low
Уверенность: High

### Доказательство

- `src/main.ts`: 3,133 lines / 260,817 bytes.
- `tools/tests.mjs`: 2,854 lines / 263,319 bytes.
- `src/styles.css`: 1,249 lines / 123,148 bytes.

`src/main.ts` одновременно управляет Prompt Builder, Artist Mix, Saved Library, Custom Tags, Settings, startup, pickers, onboarding и часть cache/resource lifecycle.

### Воздействие

Это не самостоятельный runtime-баг. Но глобальное состояние и повторные full-render paths сложнее изолировать, что повышает вероятность stale-state ошибок и заставляет тесты проверять исходный текст вместо маленьких импортируемых controllers.

### Направление улучшения

Постепенно выделять workspace controllers/resource loaders с явными входами и dispose contract. Не делать одномоментный большой rewrite; начинать с catalog/guide loader и malformed-profile startup state, потому что они уже связаны с findings.

---

## Выполненные безопасные проверки

### Полный tracked coverage

Проверены и классифицированы все 78 tracked paths:

| Группа | Количество | Метод |
|---|---:|---|
| `src/` | 24 | Полное/chunked чтение, cross-reference поиск |
| `electron/` | 11 | Полное чтение, IPC/filesystem/trust-boundary аудит |
| Основные `tools/` | 21 | Полное/chunked чтение |
| Root config/docs | 10 | Полное либо targeted чтение lockfile |
| `build/` | 1 | Полное чтение NSIS include |
| Release metadata | 4 | Полное чтение и version consistency |
| HTML fixture | 1 | Статическая проверка parser fixture |
| Installer-proof files | 2 | Полное чтение |
| Raster assets | 4 | Существование, размеры и consumer references |

### Исполненные no-write проверки

- `node --check` последовательно прошёл для всех 29 tracked `.cjs`/`.mjs` файлов.
- Прямой `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false` завершился без diagnostics.
- Пять pure inline scenario groups завершились с exit code 0:
  1. artist prompt serialization, включая `artist: aogisa88` и пробел перед closing `::`;
  2. random uniqueness, weight bounds и pool-range normalization;
  3. catalog pagination/search/favorites;
  4. Artist Mix placement bounds, anchor/companion collision и too-small stage;
  5. metadata popover edge clamp и prompt-constructor toggle semantics.
- До и после каждой исполняемой фазы `git status --short` оставался пустым.

### Почему не запускались обычные suites

- `tools/tests.mjs` создаёт `.test-tmp-v063`, множество files/directories/ASAR fixtures и выполняет cleanup.
- `tools/metadata-workspace-tests.mjs` использует `mkdtempSync`, `mkdirSync`, `writeFileSync` и `rmSync` в системном temp.

Их запуск нарушил бы прямой запрет на любые изменения, кроме этого отчёта. Это осознанный audit blind spot, а не пропущенная команда.

## Отклонённые ложные срабатывания и проверенные защиты

### Отклонено

- `fs.rename` поверх существующего target не является Windows-дефектом сам по себе. Официальный Node.js contract говорит, что существующий `newPath` перезаписывается: <https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback>.
- App updater проверяет полный partial до promotion. Если процесс прерывается до rename, verified partial остаётся и следующий запуск способен снова выполнить promotion; обязательная повторная загрузка не доказана.
- Не найден broad destructive cleanup за пределами рассчитанных build/profile/cache roots.

### Статически проверено без найденного обхода

- `.naipack`: allowlist entries, path containment, size/count/hash/MIME validation.
- Custom Tag assets: `lstat`/`realpath`/contained paths и запрет symbolic links в критических местах.
- Booru adapter: exact supported hosts, HTTPS, redirect revalidation, MIME и bounded response.
- Catalog component downloads: trusted URL/redirect restrictions, expected size и SHA-512.
- Self-extract setup: footer bounds, payload length и SHA-512 validation.
- Renderer markup: проверенные dynamic values проходят escape/highlight chain; подтверждённый HTML injection не найден.
- Preview caches: revoke/dispose/invalidate и stale-generation guards присутствуют; подтверждённый object URL leak не найден.

## Неустранённые blind spots

- Реальный Electron/CMD startup и переключение всех вкладок.
- Визуальная проверка layout, тем, keyboard-only navigation и screen reader semantics.
- Установка, обновление поверх предыдущих версий и удаление на Windows.
- Power-loss/process-kill fault injection.
- Реальные network stalls, redirects и partial resume с GitHub/NAX/booru.
- Junction/reparse-point TOCTOU под конкурентным внешним процессом.
- Измерение CPU/GPU/RAM при загрузке тысяч реальных карточек.
- `package-lock.json` проверен targeted-поиском, а не построчным dependency audit.

## Рекомендуемый порядок будущей работы

1. Исправить различение missing/malformed/I/O profile state и добавить recovery UI.
2. Ввести request identity для catalog/guide loaders и regression test out-of-order completion.
3. Привести `release:catalog-packs` и README к явному immutable catalog-version contract.
4. Синхронизировать storage bridge type/runtime whitelist.
5. Изолировать installer template patch от `node_modules`.
6. Проверить и при подтверждении исключить `public/card.png`.
7. Добавить behavioral tests и Windows CI.
8. Постепенно декомпозировать `src/main.ts` и общий test-файл без большого rewrite.

## Изменения, которые намеренно не выполнялись

Ни один пункт выше не исправлен. Патчи, commit, push, release и изменения установленного приложения отсутствуют.

---

## Дополнение: построчный аудит быстродействия

Этот проход отдельно искал не новые функции, а повторную работу на горячих путях: декодирование изображений, построение карточек, переключение вкладок, поиск, IPC и обработку больших каталогов. Числа времени здесь не выдумывались: приложение и обычные suites не запускались из-за запрета на побочные записи. Поэтому ниже явно разделены подтверждённые повторные операции и направления, которым перед изменением нужен profiler.

### Краткий приоритет

| ID | Тип | Приоритет | Суть |
|---|---|---:|---|
| PERF-001 | Confirmed duplicate work | High | Локальное изображение Metadata полностью читается дважды |
| PERF-002 | Confirmed algorithmic hot path | High | Определение official artist делает линейный поиск по всему каталогу для каждой карточки |
| PERF-003 | Confirmed algorithmic hot path | High | Извлечение Artist Mix из Metadata строит и запускает regex для каждого артиста |
| PERF-004 | Confirmed repeated I/O/parse | High | Каждый Custom Tags preview заново читает и проверяет всю canonical library |
| PERF-005 | Confirmed repeated queue work | Medium | Preview cache фильтрует/сортирует очереди и eviction-кандидатов при каждом pump |
| PERF-006 | Confirmed repeated catalog scan | Medium | Поиск и перелистывание picker повторно фильтруют весь каталог и нормализуют строки |
| PERF-007 | Confirmed whole-library work | Medium | Одна правка Custom Tags клонирует и хеширует всю библиотеку |
| PERF-008 | Confirmed IPC amplification | Medium | Загрузка component отправляет renderer IPC на каждый сетевой chunk |
| PERF-009 | Confirmed structural work | Medium | Общий `render()` пересоздаёт весь DOM и все listeners |
| PERF-010 | Confirmed tooling inconsistency | High | Legacy catalog updater открывает все gallery pages одновременно |
| PERF-011 | Confirmed unbounded buffering | High | Legacy downloader держит полные ответы изображений в RAM без byte ceiling |
| PERF-012 | Confirmed tooling overhead | Medium | Download workers используют `queue.shift()` и seeding полностью читает уже имеющиеся WebP |
| PERF-013 | Confirmed duplicate parse/probes | Medium | Electron catalog updater повторно парсит catalog и многократно проверяет одни base assets |
| PERF-014 | Confirmed repeated archive work | Medium | `.naipack` повторно читает ASAR header и preview bytes в одной операции |

## PERF-001 — Metadata дважды читает один локальный файл

### Доказательство

- `src/metadata-workspace.ts:567-569` сначала делает `await file.arrayBuffer()`, чтобы сохранить bytes и определить MIME, затем вызывает `extractImageMetadata(file)`.
- `src/image-metadata.ts:315-316` внутри `extractImageMetadata()` снова делает `await file.arrayBuffer()`.
- Для stealth PNG после этого дополнительно выполняются bitmap/canvas/alpha операции (`src/image-metadata.ts:317-320`), но именно они необходимы для stealth extraction; второй полный `arrayBuffer()` — нет.

### Воздействие и направление

На каждом локальном PNG/WebP выполняются две полные аллокации и два чтения файла. Следует сделать byte-oriented extractor или передавать уже прочитанный `Uint8Array`. Нельзя менять MIME validation, stealth/PNG/WebP fallback order, request-token cancellation и тексты ошибок.

## PERF-002 — выбор preview cache выполняет O(page × catalog) сравнений

### Доказательство

- `src/main.ts:300-301`: `isOfficialArtistCard()` вызывает `officialArtists.some(...)`.
- Эта функция вызывается при построении и hydration карточек, включая `src/main.ts:2554-2557`, `3067-3070`, `3106` и другие пути.
- Одна стандартная artist page содержит 72 карточки (`src/catalog-browser.ts:3-5`). При примерно четырёх тысячах official artists одна отрисовка страницы может выполнить порядка 72 × N сравнений только для выбора cache variant.

### Воздействие и направление

Создать `Set` official stable IDs и пересобирать его только при замене official catalog. Это сохраняет текущие правила `custom !== true`, shadowing пользовательского артиста и разделение grid/content caches, но превращает membership lookup в O(1).

## PERF-003 — Artist Mix из Metadata строит тысячи RegExp

### Доказательство

- `src/metadata-artist-highlight.ts:89-93` проходит по всему catalog `Map`.
- Для каждого артиста создаётся новый `RegExp`, после чего он проверяется на полном normalized positive prompt.
- Вызов находится на пути подготовки сохраняемого metadata payload (`src/metadata-workspace.ts:626-639`, `667-672`).

### Воздействие и направление

При первом разборе нового metadata prompt стоимость растёт как N × длина prompt плюс тысячи regex allocations. Следует переиспользовать уже построенный индекс highlighter либо один catalog-derived matcher. Обязательные инварианты: explicit `artist:` остаётся сильнее обычного совпадения, неизвестные артисты сохраняются, порядок prompt остаётся прежним, digit-ending serialization не меняется.

## PERF-004 — каждый Custom Tags preview перечитывает canonical library

### Доказательство

- `electron/main.cjs:403-411` направляет каждый `nai-custom://.../previews/...` запрос в `customTagLibrary.resolvePreview()`.
- `electron/custom-tag-library.cjs:549-552` на каждый такой запрос вызывает `readCanonical()`, затем линейно ищет preset и preview.
- `readCanonical()` (`electron/custom-tag-library.cjs:243-251`) читает index и все manifest JSON, нормализует карточки, проверяет глобальную уникальность и пересчитывает mirror digest.

### Воздействие и направление

Открытие страницы с несколькими пользовательскими карточками повторяет синхронный disk I/O и полный parse для каждой картинки. Подход: revision-keyed in-memory index `presetId + preview file`, инвалидируемый после commit/import/recovery/load. Нельзя убирать reference authorization, path containment, real-file и symlink checks.

## PERF-005 — PreviewCache многократно сортирует одни очереди

### Доказательство

- `src/preview-cache.ts:349-356`: каждый enqueue/completion вызывает `pump()`, а каждый `pump()` дважды фильтрует и сортирует всю queue; затем `removeQueued()` ещё выполняет `indexOf/splice` (`:360`).
- `src/preview-cache.ts:412-420`: при превышении бюджета создаётся массив всех ready entries, для каждой записи сканируются leases и весь массив сортируется по LRU.

### Воздействие и направление

Это подтверждённая лишняя работа при background prefetch больших страниц, но её фактическую долю CPU нужно измерить profiler-ом. Безопасное направление — отдельные priority queues/buckets и LRU/reverse-lease индекс с lazy removal. Нельзя менять foreground/background concurrency, приоритет visible/current-page, stale-generation guards, revoke и lease semantics.

## PERF-006 — picker повторно сканирует весь каталог

### Доказательство

- `src/catalog-browser.ts:31-54`: каждый `paginate*()` заново фильтрует весь массив, вычисляет `toLocaleLowerCase()` для tag и только затем делает `slice()` страницы.
- Artist и Character pickers вызывают этот путь при поиске, favorites и pagination; после этого страница отдельно прогревается и перерисовывается (`src/main.ts:2287-2305`, `2540-2563`).

### Воздействие и направление

Pagination правильно ограничивает DOM, но не CPU поиска. Полезны заранее нормализованный search text и memoized filtered-ID list по ключу `{catalogRevision, query, favoritesRevision}`. Нельзя кэшировать только видимую страницу: `filteredCount`, порядок, favorites и соседний prefetch должны оставаться точными.

## PERF-007 — одна Custom Tags transaction обрабатывает всю библиотеку

### Доказательство

- `electron/custom-tag-library.cjs:509-511` читает canonical state и глубоко клонирует все manifests/cards.
- `:538-547` выполняет global semantic validation и сравнивает stable serialization для поиска изменившихся presets.
- `:412-417` снова строит compatibility arrays, mirror digest, journal со всеми manifests и runtime snapshot.

### Воздействие и направление

Цена добавления одной карточки растёт от общего числа пользовательских карточек, хотя preview bytes уже обновляются точечно. Возможное развитие — per-preset revisions/digests и incremental derived mirror с периодической полной проверкой. Это не простой patch: journal replay, atomic recovery, global semantic uniqueness, preset order и совместимый `workspace.json` нельзя ослаблять.

## PERF-008 — component progress усиливается до IPC на каждый chunk

### Доказательство

- `electron/catalog-components.cjs:577-587` вызывает `onProgress()` после каждого прочитанного chunk.
- Aggregate wrapper немедленно пересчитывает общий прогресс (`:692-695`).
- `electron/main.cjs:262-264` тут же отправляет каждый event во все renderer windows.

### Воздействие и направление

На больших ASAR число IPC и UI updates зависит от chunking транспорта, а не от видимого изменения процентов. Следует coalesce/throttle промежуточные события по времени или изменению процента; события Checking/Retrying/Verifying/Opening/complete, cancel и точные final totals должны доставляться немедленно.

## PERF-009 — общий render пересоздаёт всё приложение

### Доказательство

- `src/main.ts:1112-1132` строит полный active workspace и заменяет `app.innerHTML`.
- `:1134-1148` после каждой замены заново вызывает binders, querySelector/querySelectorAll и создаёт listeners.
- Частичные пути уже существуют (`updatePrompt()`, `refreshArtistGrid()`, `refreshMixPicker()`), то есть полный render нужен не для каждого изменения.

### Воздействие и направление

Это наиболее широкая потенциальная оптимизация переключений/состояний, но требует browser profiler и постепенного внедрения. Начинать следует с часто повторяемых локальных state changes и event delegation, а не с rewrite framework. Нельзя терять focus restoration, scroll/accordion snapshots, modal return focus, animation lifecycle, cache leases и accessibility attributes.

## PERF-010 — legacy catalog discovery не ограничивает concurrency

### Доказательство

- `tools/update-v5-catalog.mjs:66-73` запускает `Promise.all()` сразу для всех найденных gallery pages.
- Runtime updater уже использует ограничение `GALLERY_PAGE_CONCURRENCY = 4` (`electron/catalog-updater.cjs:9`, `288-294`), поэтому два поддерживаемых пути имеют разные resource contracts.

### Воздействие и направление

С ростом gallery одновременно растут sockets, response bodies и parser work. Следует использовать bounded worker pool и вернуть результаты в прежнем page order. Полнота discovery и deduplication по image не должны измениться.

## PERF-011 — legacy downloader буферизует ответы без лимита

### Доказательство

- `tools/update-v5-catalog.mjs:182-205` запускает шесть workers и в каждом делает `Buffer.from(await response.arrayBuffer())`.
- До полной аллокации нет проверки `Content-Length` или максимального количества прочитанных bytes.

### Воздействие и направление

До шести полных ответов одновременно находятся в памяти; ошибочный либо чрезмерно большой remote response способен создать сильное давление на RAM. Следует stream в `.part` с byte ceiling, затем проверить WebP и атомарно переименовать. Retry, timeout, stage recovery и запрет promotion повреждённого файла обязательны.

## PERF-012 — avoidable O(N²)-shape queue и лишний полный read при seeding

### Доказательство

- `tools/update-v5-catalog.mjs:182-188`: workers многократно удаляют первый элемент массива через `queue.shift()`; front removal требует перемещения оставшегося хвоста.
- `:140-169`: для каждого повторно используемого WebP выполняется полный `readFileSync()` для signature validation, затем отдельный `copyFileSync()`.

### Воздействие и направление

Для каталога в тысячи файлов безопаснее общий numeric cursor по immutable cards и bounded header read перед copy. Следует сохранить counters, resumable stage state, source/catalog identity и WebP validation.

## PERF-013 — runtime catalog update повторно парсит catalog и проверяет assets

### Доказательство

- `electron/catalog-updater.cjs:303-306`: `runUpdate()` читает embedded JSON, затем `loadCatalog()` (`:223-233`) читает тот же JSON снова.
- После commit функция снова вызывает полный `loadCatalog()` (`:449`).
- Merge/base resolution проходит по карточкам и повторяет component pointer/state/filesystem/header probes (`:181-220` и `electron/catalog-components.cjs:741-770`).

### Воздействие и направление

Внутри одной операции можно переиспользовать уже проверенный embedded object и operation-local map валидных base assets. Нельзя кэшировать через смену active generation без revision invalidation; overlay precedence, damaged-overlay rejection и embedded/component fallback должны сохраниться.

## PERF-014 — `.naipack` повторно читает header и preview bytes

### Доказательство

- `electron/custom-tag-pack.cjs:137-158`: каждый `readArchiveFile()` отдельно вызывает ASAR stat, `statSync`, open/read header и extract.
- `:188-205` делает это для pack, manifest и каждого preview.
- При staging те же preview повторно извлекаются в `:209-218`.

### Воздействие и направление

В одной import validation операции можно один раз сохранить verified archive facts и проверенные preview buffers/streams, затем использовать их при staging. Нельзя убирать entry allowlist, offset/layout, 512 MiB/count limits, block integrity, SHA-256, MIME и unreferenced-entry checks.

## Отдельно проверенные, но не заявленные как дефекты

- Catalog pagination нужна: оптимизировать следует индекс поиска, а не точность `filteredCount` или полноту выдачи.
- SHA-512 component/setup verification, atomic rename/journal и path/symlink checks не являются «лишней работой», которую можно удалить ради скорости.
- Booru responses ограничены 20 MiB; безлимитное buffering там не подтверждено.
- Updater progress уже throttled в `electron/catalog-updater.cjs`; проблема PERF-008 относится только к component downloader.
- Object URL cleanup, metadata RAF scheduling и hover lifecycle имеют явные cleanup/stale guards; leak или race не подтверждены.
- Galaxy/CSS animations могут требовать GPU profiling, но статического доказательства проблемы нет, поэтому отдельный пункт не создан.

## Предлагаемый порядок измерений перед будущими исправлениями

1. Добавить performance marks только в development build вокруг Metadata local read, picker filter/render и Custom Tags preview resolution.
2. Снять CPU profile первого открытия 72 artist cards, повторного открытия той же страницы и открытия страницы с пользовательскими previews.
3. Отдельно измерить `PreviewCache.pump/evict`, не смешивая их с image decode и filesystem fetch.
4. После каждого точечного изменения сравнить cold/warm timings и проверить, что cache invalidation не показывает старые карточки.
5. Для updater/tooling использовать bounded synthetic fixtures, а не реальный массовый download; целостность archive/hash проверять теми же assertions.

Ни одна из этих оптимизаций не реализована. Это список проверяемых направлений с точными границами поведения, а не разрешение на изменение кода.

---

## Implementation Roadmap — future v0.6.7

Release rule: v0.6.7 is published only after all three iterations are complete and manually accepted. Individual iterations do not bump the application version and do not produce an installer, commit, push, tag, or release unless separately authorized.

### Iteration 1 — profile reliability and fast hot paths

Status: **Implemented, independently verified, and manually accepted through CMD**.

1. Distinguish missing, valid, and damaged/unreadable `workspace.json`; preserve damaged data unchanged, block writes, and present an English recovery screen with Retry and Open profile folder.
2. Add request-generation guards so stale catalog/guide successes or failures cannot overwrite newer state; a direct catalog update invalidates older loads.
3. Replace per-card linear official-artist membership scans with a rebuilt stable-ID `Set`, preserving custom artist shadowing and preview-cache routing.
4. Read each local Metadata PNG/WebP once and reuse the same bytes for extraction, display preparation, and persistence without changing stealth metadata behavior.
5. Cache verified Custom Tags preview references in memory and invalidate the index after every canonical mutation/recovery boundary while retaining per-request containment and real-file checks.
6. Coalesce component-download progress to at most one intermediate Downloading update per 100 ms, while delivering first, phase/id/attempt changes, retries, cancellation/error, and terminal progress immediately.

Acceptance: focused regressions for every contract, full test suite, strict TypeScript, production build, and diff checks pass. Final runtime acceptance remains a manual CMD run; no installer is produced.

### Iteration 2 — catalogs, search, and queues

Status: **Implemented and independently verified; pending manual CMD acceptance**.

- Add normalized/memoized artist and character picker search indexes without changing result order, counts, Favorites, or pagination.
- Reuse a catalog-derived Metadata artist matcher instead of constructing one RegExp per artist.
- Replace repeated PreviewCache queue sorting and lease scans with bounded priority/LRU indexes while preserving decode concurrency, leases, stale guards, and URL revocation.
- Bound and stream the legacy V5 catalog tooling path, replace front-removal queues and full-file seed validation, and reduce duplicate runtime catalog parsing/asset probes.
- Reuse verified `.naipack` archive facts/preview bytes within one import operation.
- Separate immutable catalog-component versioning from the application version so `release:catalog-packs` works for later application releases.

### Iteration 3 — renderer and maintenance architecture

Status: **Implemented and independently verified; pending combined manual CMD/GUI acceptance with Iteration 2**.

- Replace high-frequency whole-root `app.innerHTML` renders with targeted DOM updates and stable/delegated events, preserving focus, scroll, modal, animation, cache-lease, and accessibility behavior.
- Move Custom Tags transactions toward incremental per-preset revisions/digests without weakening journal replay, global semantic uniqueness, compatibility mirrors, or atomic recovery.
- Decompose the renderer and monolithic test file along subsystem boundaries.
- Add executable behavioral coverage for release/tooling subprocess contracts and Windows CI.
- Isolate installer-template patching from `node_modules`, align the storage bridge type/runtime contract, and remove assets only after runtime/package consumer verification.

Implementation evidence (2026-08-31): the renderer bootstraps a persistent shell/workspace/overlay host and routes typed workspace lifecycle changes without replacing the application root during ordinary renders or workspace switches. Saved Library and Custom Tags now own their presentation, filtering, scoped grid refresh, and delegated action routing in cohesive workspace modules; Prompt owns stable output fragments. Structural actions may still replace the active workspace, while ordinary search/filter/polarity/output paths patch local fragments and retain shell/host identity. This is an incremental boundary, not a completed renderer decomposition: `main.ts` remains large and still owns substantial Prompt Builder, Artist Mix, Settings, modal, and composition behavior that should move behind workspace interfaces in later maintenance. Custom Tags index schema 1 remains compatible and now carries optional per-preset revision/SHA-256 state; ordinary transactions retain runtime card/semantic/preview indexes and target changed manifests while journal/mirror recovery stays complete. The former cross-domain test monolith was physically split into independently executable renderer, storage/Custom Tags, catalog runtime, metadata/preview, and release/tooling suites. Production groups run them sequentially with the executable MetadataWorkspace suite and DOM lifecycle/focus/single-listener checks; a manifest regression rejects legacy umbrella imports and requires every suite. Windows Node 22 quality CI, isolated NSIS template preparation, strict generic-storage diagnostics, and release/static asset preflight are present. `public/card.png` was removed only after the preflight found no tracked, runtime, dist, or package consumer. Application and lockfile versions remain 0.6.6.

Automated gates passed: changed CJS/MJS syntax, strict TypeScript, sequential `npm test`, production `npm run build`, release/static preflight, and `git diff --check`. No installer was built or executed. Manual CMD acceptance is intentionally not claimed.

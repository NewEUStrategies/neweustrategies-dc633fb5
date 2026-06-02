# Block Editor dla wpisów (Gutenberg/Foxiz-style)

## Cel

Wpisy edytowane domyślnie w nowym **block editorze** (liniowy strumień bloków + sidebar Blok/Dokument w stylu Foxiz). Obecny **Builder** zostaje jako opcja przełączana per wpis i pozostaje domyślnym edytorem stron.

## Architektura

```text
admin.posts.$id.tsx
 └─ editor: "blocks" | "builder" | "richtext" | "markdown"
     ├─ "blocks"  → <PostBlockEditor>     ← NOWE, domyślne dla wpisów
     ├─ "builder" → <Builder>             ← istnieje, opt-in dla wpisów
     ├─ "richtext"→ <PostEditor> (TipTap) ← legacy
     └─ "markdown"→ split view             ← legacy
```

`<PostBlockEditor>` = 3 kolumny:
- **Lewa (~260px)**: lista bloków (drag-handle, drop-zone, "+" pomiędzy)
- **Środek**: kanwa — bloki renderowane jeden pod drugim, klik = aktywny blok, inline toolbar nad blokiem
- **Prawa (~280px)**: sidebar z **dwiema zakładkami**: `Blok` (ustawienia aktywnego) / `Dokument` (metadane wpisu — kategorie, tagi, cover, excerpt, SEO, format, layout_overrides, takeaways, czas czytania)

## Zestaw bloków (15)

| # | Block type        | Opis / mapowanie z buildera                        |
|---|-------------------|----------------------------------------------------|
| 1 | `paragraph`       | TipTap inline (bold/italic/link/code)              |
| 2 | `heading`         | H2/H3/H4 + id (anchor)                             |
| 3 | `image`           | + caption, alt, alignment, link                    |
| 4 | `gallery`         | grid / masonry, lightbox                           |
| 5 | `list`            | ul / ol, zagnieżdżone                              |
| 6 | `quote`           | tekst + cite                                       |
| 7 | `code`            | język + kopiowanie                                 |
| 8 | `embed`           | YouTube / Vimeo / X / oembed URL                   |
| 9 | `video`           | upload / URL, poster                               |
| 10| `separator`       | hr (linia / kropki / spacer)                       |
| 11| `callout`         | info / warning / success / danger + ikona          |
| 12| `table`           | rows × cols, header                                |
| 13| `button`          | label, link, wariant, align                        |
| 14| `columns`         | 2-kolumnowy kontener (każda kolumna = bloki)       |
| 15| `html`            | raw HTML (sanityzowany przy renderze)              |

Każdy blok ma jednolity interfejs: `{ id, type, data, style? }`. Sidebar `Blok` renderuje pola na podstawie **rejestru bloków** (analogicznie do `WIDGET_SCHEMAS`).

## Schemat danych

Nowa kolumna w `posts`:

```sql
ALTER TABLE public.posts
  ADD COLUMN blocks_data jsonb;
```

```ts
type BlocksDoc = { version: 1; blocks: Block[] };
type Block = { id: string; type: BlockType; data: Record<string, Json>; style?: BlockStyle };
```

`editor` enum dostaje nową wartość: `"blocks"`. Migracja: wszystkie istniejące wpisy konwertowane (`builder_data` + `content_pl/en` → `blocks_data`). **Strony (`pages`) nietknięte** — zostają w `builder_data`.

## Migracja danych (wpisy)

Skrypt po stronie serwera (server function `migratePostsToBlocks`), uruchamiany jednorazowo z UI w `admin/settings`. Algorytm:

1. Jeśli `editor = 'richtext' | 'markdown'` → parsuj `content_pl/en` (HTML/MD) na sekwencję bloków (paragraph, heading, image, list, quote, code, embed). HTML rzadko mapowalny → blok `html` (fallback).
2. Jeśli `editor = 'builder'` → mapuj widgety:
   - `heading` → `heading`
   - `text` → `paragraph` (HTML wewnątrz)
   - `image` → `image`
   - `gallery` → `gallery`
   - `video` → `video`
   - `button` → `button`
   - `divider` / `spacer` → `separator`
   - `accordion` / `tabs` / `pricing` / dynamiczne widgety / pozostałe → renderuj do HTML i zapisz jako `html` (z notatką `_originalWidget: <type>` w `data`)
3. Ustaw `editor = 'blocks'`, zapisz `blocks_data`. **Zachowaj `builder_data` i `content_*` jako backup** (nic nie kasujemy).
4. Per wpis flaga `_migration_warnings` (jsonb w `blocks_data.meta`) z listą nie-w-pełni-zmapowanych widgetów — autor zobaczy ostrzeżenie w edytorze.

UI: przycisk **"Migruj wpisy do block editora"** + progress bar + raport (X zmigrowanych, Y z ostrzeżeniami).

## Publiczny renderer

Nowy `<BlocksRenderer doc={blocksDoc} lang={lang} />` w `src/components/blocks/BlocksRenderer.tsx`. Route `/post/$slug` wybiera renderer na podstawie `post.editor`:

```ts
post.editor === "blocks"  → <BlocksRenderer />
post.editor === "builder" → <BuilderRenderer />
else (legacy)             → dangerouslySetInnerHTML / ReactMarkdown
```

SSR-friendly, każdy blok ma czysty komponent prezentacyjny w `src/components/blocks/render/<Type>.tsx`.

## Zmiany w `admin.posts.$id.tsx`

- Dodać `"blocks"` do typu `EditorType` i jako pierwszą opcję w dropdownie (domyślną dla nowych wpisów).
- Wczytywać/zapisywać `blocks_data` obok istniejących pól.
- Renderować `<PostBlockEditor>` gdy `editor === "blocks"`.

## Plik tree (NOWE)

```text
src/lib/blocks/
  types.ts                # BlocksDoc, Block, BlockStyle, BlockType
  registry.ts             # rejestr 15 bloków + schemas dla sidebar
  serialize.ts            # blocks → HTML (dla SEO/RSS/excerpt)
  migrate.ts              # konwersje: html→blocks, markdown→blocks, builder→blocks

src/components/admin/blocks/
  PostBlockEditor.tsx     # główny edytor (3 kolumny)
  BlockCanvas.tsx         # środek, render listy bloków + drop zones
  BlockOutline.tsx        # lewa kolumna, lista bloków
  BlockSidebar.tsx        # prawa kolumna, tabs Blok/Dokument
  BlockSidebarBlock.tsx   # zakładka Blok (schema-driven)
  BlockSidebarDocument.tsx# zakładka Dokument (metadane wpisu)
  BlockInserter.tsx       # popover "+"
  BlockToolbar.tsx        # inline toolbar nad aktywnym blokiem
  edit/<Type>.tsx         # 15 plików — komponent edycji każdego bloku

src/components/blocks/
  BlocksRenderer.tsx      # public renderer
  render/<Type>.tsx       # 15 plików — komponent renderu publicznego

src/lib/server/posts/
  migrate-to-blocks.functions.ts  # server fn: jednorazowa migracja
```

## Etapy realizacji (kolejność)

1. **Migracja DB**: `ALTER TABLE posts ADD COLUMN blocks_data jsonb` + rozszerzyć enum `editor` o `"blocks"`.
2. **Fundament**: `types.ts`, `registry.ts`, pusty `PostBlockEditor` z 3-kolumnowym layoutem, sidebar z zakładkami Blok/Dokument.
3. **5 bloków core**: paragraph, heading, image, list, quote (edit + render). Działający end-to-end zapis/odczyt + publiczny render dla wpisu.
4. **Pozostałe 10 bloków**: code, embed, video, gallery, separator, callout, table, button, columns, html.
5. **Slash commands** (`/`), markdown shortcuts (`##`, `>`, `-`), drag&drop reorder, undo/redo (per-blok historia).
6. **Migracja istniejących wpisów**: server fn + UI w `admin/settings` + raport ostrzeżeń.
7. **Default editor = blocks** dla nowych wpisów; obecny Builder zostaje jako wybór w dropdownie.
8. **Polish**: skróty klawiszowe, kopiuj/duplikuj/usuń blok, multi-select, mobile preview w sidebarze Dokument.

## Co NIE zmieniam

- Builder dla **stron** (`pages`) — bez zmian, zostaje domyślny.
- Istniejące `builder_data`, `content_pl/en` — zachowane jako backup po migracji.
- Public render stron (`$.tsx`, `index.tsx`) — bez zmian.
- TipTap (`PostEditor`) — zostaje jako legacy `richtext`.

## Ryzyka

- **Migracja widgetów builderowych do HTML fallbacku** straci interaktywność (np. accordion, tabs). Wpisy te dostaną ostrzeżenie i autor może przełączyć z powrotem na builder (`builder_data` zachowane).
- **TipTap inline w `paragraph`** — TipTap jest single-instance heavy; przy 50+ paragrafach trzeba lazy mount (tylko aktywny paragraf ma pełny editor, reszta = static render).
- **Skala**: 30+ nowych plików komponentowych. Realnie 1–2 tygodnie pracy w iteracjach.

## Pytanie kontrolne

Czy ruszamy w tej kolejności (etapy 1→8), zatwierdzając każdy etap osobno? Po etapie 3 będziesz mógł zobaczyć działający block editor z 5 blokami i ocenić UX zanim wbiję pozostałe 10.

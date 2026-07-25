## Audyt (potwierdzenie stanu)

Twoja diagnoza się broni w kodzie:

- `src/routes/$.tsx` (linie 596-608) - JEDYNA trasa która woła `processDocFootnotes` + `processHtmlFootnotes` + `processManualToc` i przekazuje `notes` do `<FootnotesList>` / `<FootnoteTooltips>`.
- `src/routes/preview.$token.tsx` (l. 92-98) - `ContentRenderer` woływany z surowym `builderDoc` i sanitizowanym `html`. Bez pre-passu shortcode zostaje dosłowny; sekcji przypisów w ogóle nie ma. Silnik `blocks` przypadkiem działa, bo ma własny `precomputeFootnotes` w `BlocksRenderer` — ale numeracja i wygląd rozjadą się z produkcją.
- `src/routes/index.tsx` (l. 303) - `BuilderRenderer` dostaje surowy `doc`. `[fn]` na home page zostaje dosłowny.
- Dwa silniki (`src/lib/footnotes.ts` vs `src/components/blocks/renderer/footnotes.ts`) rozjeżdżają się w:
  - **pustym `[fn][/fn]`**: `blocks` opuszcza cicho i NIE zużywa numeru; `lib/footnotes.ts` emituje numerowany link z pustym wpisem → migracja wpisu między silnikami przenumerowuje przypisy i psuje udostępnione `#fn-N`.
  - **wyjściu `<a>`**: `blocks` dokłada `title="…"`, `class="text-primary no-underline hover:underline"`; `lib/footnotes.ts` emituje sam link z `aria-describedby`.
  - **zasięgu**: builder tylko `text`/`heading` (2/73 widgetów); blocks tylko 6 typów (brak `callout`, `accordion`, `figure.caption`, `details`).
- Kanwa buildera (`RichHtmlView`) świadomie obsługuje tylko przypisy „zapieczone" migracją WP - świeżo wpisany `[fn]` widoczny jest wyłącznie po publikacji.
- Widget `global-content` (żywy overlay) po hydratacji podmienia `content`, więc już rozwinięty `[1]` wraca do dosłownego `[fn]…[/fn]`, a sekcja końcowa zostaje osierocona.

Nie znaleziono wektora XSS - sanityzacja i escape `title` są poprawne w obu silnikach.

## Cel

Jedno źródło prawdy dla `[fn]…[/fn]` + `<!--TOC-->` we wszystkich trasach i we wszystkich typach treści (builder, blocks, richtext/legacy). Autor widzi w podglądzie dokładnie to samo, co odbiorca po publikacji. Numeracja stabilna między silnikami. Wygląd `<sup class="fn-ref"><a …>` identyczny wszędzie.

## Zakres zmian

### 1) Wspólny helper `prepareContentForRender`

Nowy plik `src/lib/content/prepareContent.ts`:

```ts
prepareContentForRender({
  editor, builderData, blocksData, contentPl, contentEn, lang
}) → {
  engine: "builder" | "blocks" | "html",
  builderDoc, blocksDoc, html,
  notes: Footnote[],   // stabilna, wspólna kolejność (document order)
  toc: TocEntry[],
}
```

- W środku: `parseBuilderDoc` → `processDocFootnotes` (rozszerzony, patrz p. 3) → `processManualToc` (dla html) → wybór silnika przez `resolveContentEngine`.
- Dla `blocks` liczy notes przez wspólny `precompute` (patrz p. 2), żeby trasa mogła je pokazać w `<FootnotesList>` gdy chcemy jednolitego układu (opcjonalnie - domyślnie sekcję dalej rysuje `BlocksRenderer`, ale numeracja pochodzi z tego samego kolektora).
- Zwraca `notes` = `[]` jeśli silnik sam renderuje sekcję (blocks).

Wywołania:

- `src/routes/$.tsx` — zastąpić trzy oddzielne wywołania jednym.
- `src/routes/preview.$token.tsx` — dodać pre-pass, przekazać `notes` do `<ContentRenderer>` + wyrenderować `<FootnotesList>` / `<FootnoteTooltips>` pod artykułem (parytet z produkcją).
- `src/routes/index.tsx` — analogicznie dla `homePage` (builder).

`ContentRenderer` dostaje opcjonalny prop `footnotes?: Footnote[]` i renderuje `<FootnoteTooltips>` w swoim korzeniu; sekcję `<FootnotesList>` trasy montują nad `<FloatingShareBar>` (tak jak dziś `$.tsx`).

### 2) Zejście do jednego silnika przypisów

- `src/components/blocks/renderer/footnotes.ts` przestaje mieć własną implementację `replaceFootnotes` - staje się cienką warstwą nad `processHtmlFootnotes` z `src/lib/footnotes.ts`, dzielącą **ten sam** kolektor (`{ counter, notes }`).
- Ujednolicony output `<sup class="fn-ref"><a href="#fn-N" id="fnref-N" data-fn="N" title="…" aria-describedby="footnotes-heading">[N]</a></sup>` (title + a11y, bez klas tailwind - styl przez `.fn-ref` w `PostContentStyle`).
- **Puste `[fn][/fn]` → drop bez zużycia numeru** (przenosimy zachowanie z blocks). Testy pokrywają regresję.
- Numeracja: jeden `counter` przez cały dokument (builder → blocks → html w kolejności dokumentu, gdyby ktoś mieszał źródła).

### 3) Rozszerzenie zasięgu pre-passu

`processDocFootnotes` chodzi teraz po WSZYSTKICH widgetach z polami tekstowymi. Deklaratywna mapa `WIDGET_TEXT_FIELDS`:

```
text:      html_*
heading:   text_*, html_*
callout:   body_*, title_*
accordion: items[].title_*, items[].body_*
image:     caption_*
figure:    caption_*
quote:     text_*, cite_*
button:    label_*, tooltip_*
list:      items[]._*
card:      title_*, body_*
timeline:  items[].title_*, items[].body_*
```

Mapa żyje w `src/lib/builder/widgetTextFields.ts` (typowana, bez `any`) - jedno miejsce dla całego zespołu, łatwe testy. Nieznane widgety bez mapy są pomijane (safe default).

Analogicznie w `blocks/renderer/footnotes.ts` dochodzą typy `callout`, `figure`, `details`, `card`, `admonition` (pełna lista z `blocks/types.ts`).

### 4) Naprawa widgetu `global-content` (hydration swap)

`GlobalContentWidget` (żywy rekord) po hydratacji nadpisuje `content` surowym HTML → `[fn]` wraca do dosłownej postaci. Poprawka:

- Klient przy podmianie treści wywołuje `processHtmlFootnotes(html, offset)` z `offset = window.__fnCounter ?? 1`, aktualizuje licznik globalny (`useSyncExternalStore` na module-level store `footnoteCounterStore.ts`) i dopisuje przypisy do listy przez `dispatchEvent('footnotes:append', notes)`.
- `<FootnotesList>` nasłuchuje eventu i dokleja pozycje, `<FootnoteTooltips>` re-skanuje kontener.
- Rezultat: numeracja bez kolizji, sekcja końcowa nie sieroci wpisów.

### 5) Podgląd w kanwie buildera

`RichHtmlView` traci warunek „tylko zapieczone przypisy":

- Jeśli `html` zawiera `[fn]`, przepuszczamy przez `processHtmlFootnotes` (lokalny licznik od 1 - kanwa jest izolowana), montujemy `<FootnoteTooltips>` i pod widgetem rysujemy mały „preview footer" z listą (variant `compact`, tylko w trybie edytora, ukryty w produkcji przez `data-preview-only`).
- Redaktor od razu widzi `[1] [2]`, tooltipy i listę - koniec „widoczne dopiero po publikacji".

### 6) i18n / a11y / dark-mode

- Tytuł sekcji i „powrót do treści" przez `blocksUi.footnotesTitle` / `blocksUi.footnotesBack` (istniejące klucze PL/EN).
- `aria-describedby="footnotes-heading"`, `role="doc-noteref"` na `<a>`, `role="doc-endnotes"` na `<section>` (dodane w `<FootnotesList>`).
- Style w `PostContentStyle` przez tokeny `--td-*` (nie hardkodujemy kolorów).

### 7) Testy

- Rozszerzyć `src/components/blocks/renderer/__tests__/footnotes.test.ts` o pusty `[fn][/fn]` → drop + brak zużycia numeru.
- Nowy `src/lib/__tests__/prepareContent.test.ts`:
  - builder-only, blocks-only, html-only, mieszany;
  - stabilność numeracji między silnikami;
  - parytet output HTML (regex na `<sup class="fn-ref">`).
- Nowy `src/lib/__tests__/widgetTextFields.test.ts` - snapshot mapy pól per widget.
- E2E (Playwright) `e2e/footnotes-parity.spec.ts`: wpisz `[fn] test [/fn]` w admin → otwórz `/preview/$token` i `/…/slug` → oba pokazują `[1]` i tę samą sekcję.

## Nie w zakresie (do osobnego ticketu)

- Migracja starych `content_pl/en` z dosłownym `[fn]` do bloków (osobny skrypt raz).
- WYSIWYG-owy przycisk „wstaw przypis" w Word-style toolbar (dziś autor wpisuje shortcode ręcznie).

## Szczegóły techniczne

- Bez `any` / `as any`. Wspólny typ `FootnoteCollector = { counter: number; notes: Footnote[] }`.
- `tenant_id` nie dotyczy - przypisy są bezstanowe.
- Atomic design: `Footnotes.tsx` pozostaje molekułą; `FootnoteTooltips` atomem.
- Zero regresji istniejących testów `parseBakedFootnotes` - `parseBakedFootnotes` zostaje jak jest (recovery z zapieczonego HTML).

## Ryzyka

- Zmiana output `<a>` (drop klas tailwind) - kompensujemy CSS w `PostContentStyle`. Jednokrotny cache-bust w SW nie jest potrzebny; klasa `.fn-ref` już istnieje.
- Pusty `[fn][/fn]`: zmiana semantyki dla wpisów zbudowanych builderem z pustymi shortcodami. Realnie: dziś dają „ślepy [N]" - drop jest poprawą. Migracja: jednorazowy skrypt czyszczący puste tagi (opcjonalny).

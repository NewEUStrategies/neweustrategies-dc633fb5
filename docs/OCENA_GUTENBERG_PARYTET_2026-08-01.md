# Parytet edytora bloków z WordPress Gutenberg - ocena wdrożenia + przewagi (2026-08-01)

**Data:** 2026-08-01 · **HEAD:** `11efccd` (main po PR #132) · **Gałąź:** `claude/cms-gutenberg-wordpress-comparison-6ft8za`

Dokument ocenia, czy edytor bloków ("Gutenberg builder") zachowuje się jak WordPress
Gutenberg po fali zmian z PR #132 (4 commity: `8bcc61e`, `1a062e7`, `320992a`, `c4c2fa9`),
wskazuje pozostałe luki oraz - kluczowe - obszary, w których NES jest **lepszy od WP core**.
Wzorzec porównawczy: rzeczywiste zachowanie WP Gutenberg (nagrania redakcji z instancji
"Historyczny ambasador", WP 6.x, locale PL). Ocena oparta o kod, nie deklaracje; sekcja 3
zawiera wynik niezależnego adwersaryjnego przeglądu 8 przepływów end-to-end.

Skala: **✓** pełny parytet · **±** parytet częściowy (świadomy kompromis) · **✗** brak.

> **Aktualizacja 2026-08-03:** zaznaczenie w poprzek bloków zostało domknięte -
> patrz `WDROZENIE_CROSS_BLOCK_SELECTION_2026-08-03.md`. Wiersze §1.2 i §1.1
> (slash) są zaktualizowane poniżej; wnioski i rekomendacje z 2026-08-01
> pozostają jako zapis stanu z tamtej daty.

---

## 1. Matryca parytetu zachowań

### 1.1 Pisanie (writing flow)

| Zachowanie                                                                             | WP Gutenberg                                                      | NES                                                                                | Status                                                                                                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Enter dzieli akapit; karetka od razu w nowym bloku                                     | tak                                                               | tak (`Paragraph.tsx` Enter -> `insertAt` -> `requestBlockFocus`)                   | ✓                                                                                                                        |
| Enter w nagłówku przenosi ogon do nowego akapitu                                       | tak                                                               | tak (`Heading.tsx`, split z `getHTMLFromFragment`)                                 | ✓                                                                                                                        |
| Shift+Enter = miękki `<br>`                                                            | tak                                                               | tak                                                                                | ✓                                                                                                                        |
| Backspace na pustym bloku usuwa go, karetka na koniec poprzedniego                     | tak                                                               | tak (`deleteEmptyAt`)                                                              | ✓                                                                                                                        |
| Backspace na POCZĄTKU niepustego bloku scala z poprzednim, karetka w punkcie złączenia | tak                                                               | tak (`mergeWithPrevious` + `lib/blocks/merge.ts` + karetka offsetowa w `focus.ts`) | ✓                                                                                                                        |
| Strzałki góra/dół na krawędzi wizualnej linii przechodzą do sąsiedniego bloku          | tak                                                               | tak (ProseMirror `endOfTextblock` - respektuje zawijanie i bidi)                   | ✓                                                                                                                        |
| Strzałki lewo/prawo na początku/końcu treści przechodzą do sąsiedniego bloku           | tak                                                               | tak                                                                                | ✓                                                                                                                        |
| Slash `/` otwiera wybór bloku                                                          | tylko w PUSTYM kontekście bloku (`allowContext` autouzupełniacza) | pusty akapit + filtrowanie inline `/zapytanie`                                     | ✓ (2026-08-03: weryfikacja WP potwierdziła ten sam warunek; różnica została w polach innych niż akapit - nagłówek/lista) |
| Skróty markdown (`##`, `>`, `-`, `1.`, `---`, ``` )                                    | tak                                                               | tak; transformacja nie gubi karetki                                                | ✓                                                                                                                        |
| Placeholder "Wpisz / aby wybrać blok"                                                  | tak                                                               | tak (akapit + appender)                                                            | ✓                                                                                                                        |

### 1.2 Zaznaczanie i operacje zbiorcze

| Zachowanie                                                         | WP Gutenberg                                 | NES                                                                                                             | Status |
| ------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| Dwustopniowe Ctrl/Cmd+A (treść bloku -> wszystkie bloki)           | tak                                          | tak (paragraph + heading; selekcja DOM czyszczona przy eskalacji)                                               | ✓      |
| Shift+klik zaznacza zakres bloków                                  | tak                                          | tak (`blockRange`, kotwica = ostatni zwykły klik)                                                               | ✓      |
| Ctrl/Cmd+klik przełącza pojedynczy blok                            | tak                                          | tak (`toggleInSelection`, kolejność dokumentu)                                                                  | ✓      |
| Delete/Backspace usuwa zaznaczone; Escape czyści                   | tak                                          | tak                                                                                                             | ✓      |
| Ctrl+Shift+D duplikuje (też podczas pisania)                       | tak                                          | tak (`duplicateSelection`; świeże id również w zagnieżdżeniach)                                                 | ✓      |
| Shift+strzałki rozszerzają zaznaczenie blokowe                     | tak                                          | tak (kotwica + ognisko; odwrotny kierunek ZAWĘŻA, eskalacja z wnętrza akapitu/nagłówka na krawędzi treści)      | ✓      |
| Zaznaczenie w poprzek bloków przeciągnięciem myszą                 | tak - przechodzi w zaznaczenie CAŁYCH bloków | tak (`useCrossBlockSelection`: obserwator selekcji + wygaszenie natywnego podświetlenia w trakcie przeciągania) | ✓      |
| Shift+klik w treść INNEGO bloku zaznacza zakres bloków             | tak                                          | tak                                                                                                             | ✓      |
| Pisanie / Enter przy zaznaczeniu >= 2 bloków zastępuje je akapitem | tak (`onBeforeInput`)                        | tak (znak escapowany, jeden blok NIE jest nadpisywany)                                                          | ✓      |
| Shift+Home / Shift+End - zaznaczenie do krawędzi dokumentu         | nie                                          | tak                                                                                                             | ✓+     |
| Komunikat `aria-live` o liczbie zaznaczonych bloków                | tak (`speak()`)                              | tak (PL/EN z pluralizacją)                                                                                      | ✓      |

### 1.3 Schowek

| Zachowanie                                                                | WP Gutenberg | NES                                                                                | Status |
| ------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- | ------ |
| Ctrl+C/X na zaznaczonych blokach + toast "Skopiowano N bloków do schowka" | tak          | tak (pluralizacja PL: blok/bloki/bloków + EN)                                      | ✓      |
| Ctrl+V odtwarza bloki (nowe id, też między wpisami/kartami)               | tak          | tak (sentinel JSON bezstratny)                                                     | ✓      |
| Wklejanie bloków SKOPIOWANYCH W WORDPRESSIE                               | n/d          | tak - parsujemy markup `<!-- wp:… -->` (HTML i plain-text z widoku kodu WP)        | ✓+     |
| Wklejanie NASZYCH bloków DO WordPressa                                    | n/d          | tak - payload niesie równolegle markup Gutenberga                                  | ✓+     |
| Wklejka z Worda/Google Docs: nagłówki, listy zagnieżdżone, tabele, cytaty | tak          | tak (`wordPaste.ts`; tabele -> strukturalny blok `table` ze spanami i wyrównaniem) | ✓      |
| Wklejka plików graficznych (zrzut ekranu) -> blok obrazu                  | tak          | tak (`imagePaste.ts`; kanwa + wnętrze akapitu)                                     | ✓      |
| Zwykły tekst -> akapity po pustych liniach                                | tak          | tak                                                                                | ✓      |
| Zagnieżdżone kanwy (edytor w modalu buildera) bez podwójnej wklejki       | n/d          | tak (stos kanw w `useBlockClipboard`; obsługuje wierzchnia)                        | ✓+     |

### 1.4 Transformacje, inserter, appender

| Zachowanie                                                           | WP Gutenberg  | NES                                                                                                        | Status |
| -------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| Menu "Przekształć w" na przycisku typu bloku                         | tak           | tak (11 typów rodziny tekstowej, z zachowaniem treści; toolbar + menu kontekstowe)                         | ✓      |
| Podgląd transformacji przy hover                                     | tak           | nie (sama lista z ikonami)                                                                                 | ±      |
| Szybki inserter: najczęściej używane + "Przeglądaj wszystko"         | tak (6 kafli) | tak (6 kafli + rozwijana pełna biblioteka 8 kategorii)                                                     | ✓      |
| Nawigacja klawiaturą po wynikach insertera                           | tak           | tak (strzałki po siatce 3-kol., Home/End, Enter; `aria-activedescendant`, `role=option`, scroll-into-view) | ✓      |
| Appender "Wpisz / aby wybrać blok" pod treścią i w pustym dokumencie | tak           | tak (`BlockAppender`; klik = akapit z karetką)                                                             | ✓      |
| Inserter "+" między blokami (hover)                                  | tak           | tak                                                                                                        | ✓      |
| Zakładki Bloki / Wzorce / Media w bibliotece                         | tak           | nie (tylko bloki)                                                                                          | ✗      |

### 1.5 Media i trwałość

| Zachowanie                                     | WP Gutenberg        | NES                                                                                                                                                | Status |
| ---------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Wklejone grafiki trafiają do biblioteki mediów | ręcznie / wtyczki   | **automatycznie przy zapisie** (`persistImages.ts`: upload + podmiana URL, cache anty-duplikacyjny, izolacja `tenant_id`, allowlista MIME bez SVG) | ✓+     |
| Autosave                                       | interwał ~60 s      | debounce 1,5 s, serializacja zapisów, guard niezapisanych zmian                                                                                    | ✓+     |
| Rewizje                                        | lista + prosty diff | 19 pól, limit 50, throttle 5 min, diff DWÓCH dowolnych rewizji, restore nie zmienia statusu publikacji                                             | ✓+     |

---

## 2. Czego nadal NIE mamy z Gutenberga (uczciwa lista)

> Lista jest zapisem stanu z 2026-08-01. Punkty 1-4 zostały wdrożone w PR #134
> (`NestedBlocksEditor`, `BlockListView`, zakładka „Wzorce" w insererze,
> `CodeViewDialog`), a punkt 6 doprecyzowany 2026-08-03 - patrz poniżej.

1. **Edycja zagnieżdżeń w UI** - `group`/`columns`/`row`/`stack`/`grid` istnieją w modelu
   i renderują się na froncie, ale edytor nie pozwala edytować dzieci (Etap 1b: nested editor).
2. **Patterns / synced patterns (reusable blocks)** - brak odpowiednika; `patterns/library.ts`
   istnieje po stronie buildera, bez insertera.
3. **List View** - `DocumentOutline` pokazuje tylko nagłówki, nie drzewo wszystkich bloków z DnD.
4. **Widok kodu dokumentu** (Ctrl+Shift+Alt+M) - serializator `blocksToGutenberg` jest w użyciu
   w schowku, ale nie ma UI podglądu markupu całego dokumentu.
5. **Blokady bloków (lock/templateLock)**, **tryby fullscreen/spotlight**, **podgląd urządzeń
   w edytorze** (jest link "Zobacz preview" w nowej karcie).
6. Slash `/` w polach innych niż akapit (nagłówek, element listy) - w WP autouzupełniacz
   żyje w każdym RichText; u nas w akapicie (warunek „pusty kontekst bloku" jest ten sam).
   Zaznaczenie w poprzek bloków i Shift+strzałki NIE są już brakiem (2026-08-03).

Żaden z braków nie dotyczy pisania artykułu (rdzeń przepływu redakcyjnego = pełny parytet);
wszystkie dotyczą kompozycji layoutów, do której w NES służy builder (architektura hybrydowa,
`ARCHITECTURE.md` §2).

---

## 3. Weryfikacja techniczna (adwersaryjny przegląd 8 przepływów)

Niezależny przegląd nastawiony na ZNALEZIENIE błędów (nie potwierdzenie sukcesu) prześledził
8 przepływów end-to-end po kodzie, łącznie z wnętrzami zależności (prosemirror-view, @tiptap/core).
Werdykty przed poprawkami i stan po poprawkach (wszystkie naprawione w tym PR):

| #   | Przepływ            | Werdykt przeglądu                                                                                                                                                                                                                                             | Stan po poprawkach                                                                                                                                                                                                                                                 |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Enter-split + fokus | **BUG (krytyczny, sprzed tej fali)**: `insertAt` czytał `docRef` aktualizowany dopiero przy re-renderze, więc przycięcie bloku źródłowego (`deleteRange`) przegrywało z wstawieniem ogona - treść się duplikowała ("Hello World" -> "Hello World" + " World") | **NAPRAWIONE**: `emitChange` aktualizuje `docRef` optymistycznie - sekwencyjne mutacje w jednym ticku się składają; wszystkie 12 mutatorów + schowek przechodzą tędy                                                                                               |
| 2   | Merge Backspace     | OK merytorycznie (offsety/encje/`<br>`/prev-heading poprawne); RYZYKO wyścigu `setContent` (mapuje selekcję na koniec) z pętlą rAF fokusu                                                                                                                     | **DOMKNIĘTE**: rejestr oczekującego fokusu w `focus.ts`; `Paragraph`/`Heading` po własnym `setContent` wołają `reapplyPendingBlockFocus` - karetka deterministycznie ląduje w punkcie złączenia                                                                    |
| 3   | Schowek             | **BUG**: stos kanw trzymał ELEMENTY - po podmianie węzła (pusty<->niepusty dokument) arbitraż wskazywał odpięty div i Ctrl+C/X/V milkło; RYZYKO: Firefox/Safari nie gwarantują zdarzenia `copy` przy fokusie na `<body>`                                      | **NAPRAWIONE**: stos trzyma REFERENCJE (`ref.current` zawsze żywy); kanwa ma `tabIndex=-1`, a `selectAllBlocks` fokusuje kanwę - zdarzenia schowka mają target wewnątrz `[data-block-canvas]` (wzorzec WP). Podwójne paste: przegląd potwierdził, że NIE występuje |
| 4   | Persist images      | OK (kolejność przed `update$`, `File` z `Uint8Array` poprawny, brak pętli); RYZYKO: zbędny drugi zapis przez głęboki klon `builder_data` bez zmian                                                                                                            | **ZMITYGOWANE**: `replaceDataUrlImages` zwraca oryginalną referencję przy braku trafień; synchronizacja formularza nie tworzy pozornych zmian                                                                                                                      |
| 5   | Transforms          | **OK** (kompletność ikon/i18n wymuszona typami; cache na `[t]` unieważnia się przy zmianie języka)                                                                                                                                                            | bez zmian; bonus: `details` dodane do typów z fokusem po transformacji                                                                                                                                                                                             |
| 6   | Inserter            | **OK** (kolejność `visibleSpecs` = kolejność renderu we wszystkich 3 trybach; clamp odporny na kurczące się wyniki; slash-menu działa)                                                                                                                        | bez zmian                                                                                                                                                                                                                                                          |
| 7   | Appender            | **OK** (fokus na świeżym akapicie; retry 30 klatek pokrywa montowanie TipTapa)                                                                                                                                                                                | bez zmian                                                                                                                                                                                                                                                          |
| 8   | Regresje            | **BUG (mały)**: heurystyka "pierwszy edytowalny" w `focus.ts` trafiała w pole JĘZYKA bloku `code` (input przed textarea) i mieliła podgląd bloku `html`; brak retry gdy pole montuje się po hoście                                                            | **NAPRAWIONE**: opt-in marker `[data-block-editable]` (paragraph/heading/code), retry gdy host jest a pola brak, `html` usunięty z typów fokusowanych (edycja żyje w sidebarze)                                                                                    |

Sygnały jakości na HEAD gałęzi po poprawkach: `vitest` - pełna suita zielona (**3928 testów**,
w tym 73 testy jednostkowe modułów tej fali: clipboard round-trip + interop WP, merge z offsetem
karetki, zakresy zaznaczeń, imagePaste, persistImages z identycznością referencji, transforms,
focus z markerem/retry/reapply); `tsc --noEmit` czysto; `eslint` na zmienionych plikach 0 błędów;
zero `any`/`as any` w kodzie fali.

---

## 4. W czym jesteśmy LEPSI od WordPress Gutenberg

1. **Dwujęzyczność natywna (PL/EN)** - osobne dokumenty bloków i OSOBNE stosy undo per język.
   W WP to teren wtyczek (WPML/Polylang), bez izolacji historii edycji.
2. **Dwukierunkowy interop schowka z samym WordPressem** - kopiuj u nas -> wklej w WP,
   kopiuj w WP (edytor bloków LUB widok kodu) -> wklej u nas. WP nie oferuje interoperacyjności
   z zewnętrznymi edytorami; my traktujemy jego format jako lingua franca.
3. **Wklejka z Worda klasy enterprise** - struktura + listy zagnieżdżone + TABELE (spany,
   wyrównania, wykrywanie wiersza nagłówkowego) + **automatyczna konwersja przypisów dolnych**
   (Word/GDocs/LibreOffice/PDF-superscript) na shortcode `[fn]`. WP core gubi przypisy z Worda.
4. **Wklejone grafiki -> biblioteka mediów automatycznie przy zapisie**, z podmianą URL w treści,
   cache anty-duplikacyjnym, izolacją `tenant_id` i allowlistą MIME (bez SVG = anty-stored-XSS).
   W WP obrazy z Worda zostają jako zewnętrzne/data-URL, dopóki redaktor nie kliknie
   "Wgraj obrazy zewnętrzne".
5. **Trwałość pracy redakcji** - autosave 1,5 s (WP ~60 s), rewizje z diffem dwóch dowolnych
   wersji i restore niezmieniającym statusu publikacji, optimistic-lock na zapisie.
6. **Import całych serwisów** - pipeline WXR: Gutenberg + Elementor + shortcode'y Foxiz/SU
   z raportem pokrycia i mirroringiem mediów (dedup sha256, SSRF-guard). WP nie importuje
   z Elementora do bloków.
7. **Bloki, których WP core nie ma** - `chart`/`data-map` (silnik wizualizacji think-tanku),
   `review`, `poll` (RPC głosowania), `liveblog`, `faq`/`toc`/`compare`/`proscons`, formularze
   auth jako bloki strukturalne. Łącznie 100 typów w 8 kategoriach.
8. **Bezpieczeństwo multi-tenant od pierwszej linii** - każda ścieżka uploadu przechodzi przez
   `uploadAndRegisterMedia` (walidacja przed wysyłką, rejestracja, sprzątanie po odrzuceniu)
   z serwerową rewalidacją `tenant_id`; wklejka nie omija tych bramek.
9. **Architektura lżejsza od WP** - brak iframe'owanej kanwy i ładowania setek skryptów;
   TipTap/ProseMirror + dnd-kit, memoizowane menu transformacji, czyste moduły domenowe
   (`merge`/`selection`/`clipboard`/`imagePaste`/`persistImages`/`transforms`) w 100%
   pokryte testami jednostkowymi - WP testuje edytor głównie e2e.
10. **Dostępność insertera** na poziomie wzorca combobox+listbox z `aria-activedescendant` -
    parytet z WP osiągnięty świadomie, z synchronizacją hover<->klawiatura.

---

## 5. Rekomendacje (kolejność wg wartości dla redakcji)

1. **Nested editor (Etap 1b)** - edycja dzieci `group`/`columns` w kanwie; model i renderer są
   gotowe, brakuje wyłącznie UI.
2. **List View** - drzewo wszystkich bloków z DnD i multi-select (mamy już `blockRange`
   i `toggleInSelection` jako fundament).
3. **Patterns** - inserter wzorców na bazie istniejącego `patterns/library.ts`.
4. **Slash inline** - filtrowanie `/zapytanie` bez osobnego pola (parytet 1:1 z WP).
5. **Widok kodu dokumentu** - podgląd/kopiowanie markupu Gutenberga całego wpisu
   (`blocksToGutenberg` już to potrafi).

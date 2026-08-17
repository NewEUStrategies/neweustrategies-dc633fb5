# Domknięcie cross-block selection w edytorze bloków (2026-08-03)

**Data:** 2026-08-03 · **Gałąź:** `claude/gutenberg-parity-audit-ebo2gw` ·
**Zamyka:** trzy świadome braki z `OCENA_GUTENBERG_PARYTET_2026-08-01.md` §1.2 i §2.6

Audyt parytetu z WordPress Gutenberg zostawił zaznaczenie blokowe jako jedyny
obszar rdzenia redakcyjnego z twardym `✗`: Shift+strzałki nie rozszerzały
zaznaczenia, a przeciągnięcie myszą przez granicę bloku nie robiło nic
(natywna selekcja gubiła się między osobnymi instancjami edytora inline).
To wdrożenie domyka temat: zaznaczenie w poprzek bloków ma pełną semantykę WP,
a wszystkie operacje zbiorcze (schowek, usuwanie, duplikacja, pisanie po
zaznaczeniu) działają na nim bez zmian w swoich modułach.

---

## 1. Co doszło (matryca zachowań)

| Zachowanie                                                                                  | WP Gutenberg                 | NES przed          | NES po        |
| ------------------------------------------------------------------------------------------- | ---------------------------- | ------------------ | ------------- |
| Przeciągnięcie myszą przez granicę bloku zaznacza CAŁE bloki                                | tak (`useSelectionObserver`) | brak               | ✓             |
| Shift+strzałka w dół/górę rozszerza zaznaczenie blokowe                                     | tak                          | brak               | ✓             |
| Shift+strzałka ZAWĘŻA zaznaczenie przy odwrotnym kierunku                                   | tak                          | brak               | ✓             |
| Shift+strzałka z wnętrza akapitu/nagłówka na krawędzi treści eskaluje do zaznaczenia bloków | tak                          | brak               | ✓             |
| Shift+klik w treść INNEGO bloku zaznacza zakres bloków                                      | tak                          | tylko poza treścią | ✓             |
| Zwykła strzałka w trybie blokowym zwija zaznaczenie do jednego bloku                        | tak                          | brak               | ✓             |
| Pisanie znaku przy zaznaczeniu >= 2 bloków zastępuje je akapitem                            | tak (`onBeforeInput`)        | brak               | ✓             |
| Enter przy zaznaczeniu >= 2 bloków zastępuje je pustym akapitem                             | tak                          | brak               | ✓             |
| Shift+Home / Shift+End - zaznaczenie do krawędzi dokumentu                                  | nie                          | brak               | ✓+ (ponad WP) |
| Komunikat `aria-live` o liczbie zaznaczonych bloków                                         | tak (`speak()`)              | brak               | ✓             |

**Uwaga o „zaznaczaniu tekstu w poprzek bloków”:** WP core także NIE pozwala
zaznaczyć fragmentu tekstu przez granicę bloku - przeciągnięcie przez granicę
przechodzi w zaznaczenie CAŁYCH bloków (każdy blok to osobny host edycji).
Nasza implementacja odwzorowuje dokładnie to zachowanie, więc wiersz z audytu
„cross-block text selection: ✗” jest domknięty w sensie parytetu, a nie przez
wprowadzenie zachowania, którego WP nie ma.

**Slash `/`:** weryfikacja kodu WP (`allowContext` autouzupełniacza bloków:
`!(/\S/.test(before) || /\S/.test(after))`) potwierdza, że WP też otwiera menu
tylko w PUSTYM kontekście bloku - nasze „`/` w pustym akapicie + filtrowanie
inline” to parytet, nie kompromis. Pozostała różnica: WP oferuje slash w każdym
polu RichText (także nagłówek, element listy), my na razie w akapicie.

---

## 2. Architektura (atomic design + separacja warstw)

| Warstwa                  | Plik                                                            | Rola                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domena (czysta, bez DOM) | `src/lib/blocks/crossSelection.ts`                              | Model kotwica + ognisko, `extendSelection`, `extendSelectionToEdge`, `moveSelection`, `currentSelectionRange`, `isPrintableKey`. Zero zależności od Reacta i DOM. |
| Most do DOM              | `src/lib/blocks/selectionDom.ts`                                | `topLevelBlockIdFromNode`, `domSelectionEnds`, `enterBlockSelectionMode`, `isEditableTarget` - tłumaczenie natywnej selekcji na bloki top-level.                  |
| Arbitraż kanw            | `src/components/admin/blocks/hooks/canvasStack.ts`              | Wspólny rejestr zamontowanych kanw (`useCanvasStack`, `canvasOwnsEvent`) - używany TERAZ i przez schowek, i przez zaznaczenie.                                    |
| Zachowanie (hook)        | `src/components/admin/blocks/hooks/useCrossBlockSelection.ts`   | Jedyny właściciel zaznaczenia blokowego: obserwator przeciągania, klawiatura trybu blokowego, kontroler dla kanwy.                                                |
| Atom                     | `src/components/admin/blocks/atoms/BlockSelectionAnnouncer.tsx` | Region `aria-live` (sr-only) z liczbą zaznaczonych bloków (PL/EN, pluralizacja).                                                                                  |
| Molekuła                 | `src/components/admin/blocks/molecules/BlockListView.tsx`       | Podpowiedź skrótów zaznaczenia w panelu struktury dokumentu.                                                                                                      |
| Organizm                 | `src/components/admin/blocks/BlockCanvas.tsx`                   | Konsument kontrolera; sama kanwa nie składa już list id ręcznie.                                                                                                  |
| Edytory inline           | `edit/Paragraph.tsx`, `edit/Heading.tsx`                        | Eskalacja Shift+strzałki na krawędzi treści (`onExtendBlockSelection`).                                                                                           |

Zyski międzymodułowe:

- **Jedno źródło prawdy dla zaznaczenia.** `BlockCanvas` straciło własną
  kotwicę (`anchorIdRef`) i ręczne `setSelectedIds` - kontroler (`anchorTo`,
  `extendTo`, `selectRange`, `toggle`, `selectAll`, `clear`, `extendFromBlock`)
  jest wołany zarówno przez klik, jak i przez klawiaturę oraz duplikację.
- **Arbitraż zagnieżdżonych kanw wyjęty ze schowka** do `canvasStack` - schowek
  i zaznaczenie używają tej samej reguły (target wewnątrz kanwy wygrywa, poza
  kanwami wygrywa kanwa zamontowana najpóźniej), więc edytor bloków w modalu
  buildera nie rusza zaznaczenia kanwy pod nim.
- **`escapeInlineText` wspólny** dla transformacji i dla treści pochodzącej
  z klawiatury (`inlineHtml.ts`) - zniknęła jedna z dwóch kopii escapowania.
- **Kontrakt optymistycznych referencji** ten sam co dla `docRef`:
  `selectedIdsRef` jest aktualizowany od razu, więc trzymany Shift+strzałka
  składa kolejne rozszerzenia zamiast czytać stan sprzed re-renderu.

---

## 3. Bezpieczeństwo i izolacja najemców (tenant_id)

- Wdrożenie jest w 100% klienckie i **nie dodaje ani jednej ścieżki danych**:
  brak zapytań, brak RPC, brak nowych tabel/polityk RLS. Zaznaczenie operuje
  na id bloków dokumentu, który jest już wczytany w edytorze aktywnego
  najemcy - nie ma czym przekroczyć granicy `tenant_id`.
- Ścieżki, które faktycznie dotykają danych (schowek -> `persistImages` ->
  `uploadAndRegisterMedia` z serwerową rewalidacją `tenant_id`, allowlista MIME
  bez SVG), pozostają nietknięte; zaznaczenie tylko wskazuje im zbiór bloków.
- **Anty-wstrzyknięcie markupu:** znak wpisany po zaznaczeniu wielu bloków
  trafia do treści przez `escapeInlineText`, więc `<`, `>` i `&` z klawiatury
  są znakami, a nie znacznikami (test w `inlineHtml.test.ts`).
- **Brak przypadkowej utraty treści:** nadpisanie zaznaczenia pisaniem wymaga
  `>= 2` zaznaczonych bloków (WP tak samo - `hasMultiSelection`), a każda taka
  zmiana idzie przez `emitChange` -> stos undo/redo per język.
- Zdarzenia klawiatury są przyjmowane wyłącznie, gdy `canvasOwnsEvent` uzna je
  za należące do tej kanwy - klawisz wpisany w dowolne inne pole formularza
  w adminie nigdy nie zmodyfikuje dokumentu bloków.

---

## 4. i18n (PL/EN) i warstwa wizualna

- Nowe klucze (bramkowany prefiks `blocks`, więc CI wymusza obie wersje):
  `blocks.selection.count` (pluralizacja PL: 1 blok / 2-4 bloki / 5+ bloków +
  EN one/other) oraz `blocks.selection.hint` (skróty w panelu struktury).
- Warstwa wizualna nie rusza gridu ani responsywności: podświetlenie
  zaznaczonych bloków korzysta z istniejących klas wiersza, doszła jedna reguła
  w `styles.css` gasząca natywne `::selection` i karetkę w trakcie przeciągania
  (`.block-canvas[data-multi-selecting="true"]`), żeby redakcja nie widziała
  dwóch nachodzących zaznaczeń. Komunikat dla czytników jest `sr-only`.

---

## 5. Testy

| Plik                                                                          | Zakres                                                                                                                                                                                                                                                                                                                                                   | Liczba |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `src/lib/blocks/__tests__/crossSelection.test.ts`                             | semantyka zakresów: rozszerzanie, zawężanie, przejście przez kotwicę, krawędzie, Home/End, odtwarzanie końców, klawisze znakowe                                                                                                                                                                                                                          | 24     |
| `src/lib/blocks/__tests__/selectionDom.test.ts`                               | mapowanie węzeł -> blok top-level (także z zagnieżdżenia), końce selekcji DOM, rozpoznawanie pól edytowalnych, wejście w tryb blokowy                                                                                                                                                                                                                    | 13     |
| `src/components/admin/blocks/hooks/__tests__/useCrossBlockSelection.test.tsx` | przeciąganie przez granicę bloku (start/koniec/powrót do jednego bloku/prawy przycisk), Shift+strzałki i Shift+Home/End, zwykłe strzałki, pisanie i Enter po zaznaczeniu, kontroler (anchor/extend/toggle/selectAll/selectRange/clear/extendFromBlock), zasięg klawiatury (poza kanwą / zgubiony fokus), arbitraż dwóch kanw, sprzątanie po odmontowaniu | 32     |
| `src/lib/blocks/__tests__/inlineHtml.test.ts`                                 | escapowanie tekstu wstawianego do treści bloku                                                                                                                                                                                                                                                                                                           | +1     |

Razem 70 nowych testów. Pełna suita: `vitest run` zielony (4722 testy zdane, 50 pominiętych),
`tsc --noEmit` czysto, `eslint` na zmienionych plikach 0 błędów, bramka
parytetu i18n PL/EN zielona. Zero `any` / `as any` w kodzie wdrożenia.

Przy okazji naprawiona **czerwona bramka `labelsEn`** (niezależna od tego
wdrożenia): widget `social-icons` wniósł 5 etykiet schematu bez tłumaczeń EN,
co blokowało całą suitę.

---

## 6. Świadome ograniczenia

1. **Kompozycja IME** (chiński/japoński/koreański) przy zaznaczeniu wielu
   bloków nie zastępuje ich pierwszym znakiem - kanwa nie jest
   `contenteditable`, więc nie dostaje `beforeinput`; obsługa idzie przez
   `keydown` i pokrywa klawiatury alfabetyczne. Skutek: przy IME trzeba nacisnąć
   Delete przed pisaniem.
2. **Zaznaczenie blokowe wewnątrz kontenerów** (`group`/`columns`) nadal jest
   zaznaczeniem tekstowym - drzewo zaznaczeń zagnieżdżonych to osobny krok
   (fundament jest: `topLevelBlockIdFromNode` już mapuje dziecko na korzeń).
3. **Slash w nagłówku/liście** - patrz §1; wymaga wyniesienia stanu menu slash
   z akapitu do wspólnego hooka.

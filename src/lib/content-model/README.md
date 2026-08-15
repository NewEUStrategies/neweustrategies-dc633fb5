# `lib/content-model` - warstwa wspólna pod oba silniki treści

## Po co ta warstwa istnieje

Platforma ma **dwa** silniki treści:

| silnik      | kod                                                             | model dokumentu                          |
| ----------- | --------------------------------------------------------------- | ---------------------------------------- |
| **bloki**   | `lib/blocks`, `components/blocks`, `components/admin/blocks`     | `BlocksDoc` -> `Block[]`                 |
| **builder** | `lib/builder`, `components/admin/builder` (edytor), `components/builder` (publiczny renderer) | `BuilderDocument` -> sekcje -> kolumny -> widgety |

Przez sześć kolejnych wydań audytu (`docs/AUDYT_PLATFORMY_MODULY_FUNKCJE_*`)
para `bloki <-> builder` była **jedynym realnym cyklem w repozytorium** - i
rosła, zamiast maleć:

| data  | bloki -> builder | builder -> bloki |
| ----- | ---------------: | ---------------: |
| 30.07 |    pierwsza wzmianka |                  |
| 13.08 |               23 |               17 |
| 14.08 |               28 |               16 |

Przyczyna była mechaniczna, nie koncepcyjna: **żaden silnik nie był "niżej"**,
więc każdy nowy widget dokładał krawędź w tę stronę, w którą akurat było
wygodniej. `lib/blocks/wordPaste.ts` importował `toJson` z buildera nie dlatego,
że potrzebował buildera, tylko dlatego, że tam stała jedyna kopia escape-hatcha
do JSON-a.

## Rozstrzygnięcie: trzy piętra zamiast dwóch splątanych

```
                content-model          <- prymitywy modelu treści
                 ^          ^             (nie zna ŻADNEGO silnika)
                 |          |
              bloki  <---  builder     <- jeden jawny, dozwolony kierunek
                 ^          ^
                 └── wp-import ────────┘  <- adapter NAD oboma silnikami
```

**Trzy reguły, wszystkie egzekwowane maszynowo:**

1. `content-model` **nie importuje** z `blocks`, `builder` ani z warstwy tras.
   Bez tego warunku byłby trzecim wierzchołkiem cyklu, a nie fundamentem.
2. `blocks` **nie importuje** z `builder`. Zero wyjątków.
3. `builder` **może** importować z `blocks` - bo realnie go hostuje: widget
   `rich-text` renderuje pełny dokument bloków wewnątrz układu buildera
   (`RichTextView`), a panel właściwości montuje edytor bloków
   (`RichTextEditor` -> `PostBlockEditor`).

Bramka: **`bun run check:content-layering`** (logika: `src/lib/ci/contentLayering.ts`,
runner: `scripts/check-content-layering.ts`, testy: `src/lib/ci/__tests__/contentLayering.test.ts`).
Decyzja architektoniczna, której nikt nie musi pamiętać, bo pamięta ją CI.

## Co tu wolno włożyć

Rzecz, której potrzebują **oba** silniki i która **nie mówi nic** o sekcjach,
kolumnach, widgetach ani blokach.

> Jeśli moduł zna `WidgetNode` albo `Block` - należy do silnika, nie tutaj.

| plik                   | co zawiera                                                                     |
| ---------------------- | ------------------------------------------------------------------------------ |
| `json.ts`              | `Json`, `toJson`, `newId`, `newBlockId` - jedna definicja zamiast dwóch kopii   |
| `contentValue.ts`      | kanoniczna koercja swobodnego JSON-a (`asBool`/`asNum`/`pickI18n`/…) - czysta   |
| `editorCanvas.tsx`     | znacznik "render dzieje się w kanwie edytora" + wymuszony tryb light/dark        |
| `postContext.tsx`      | kontekst bieżącego wpisu/archiwum dla tagów dynamicznych + próbka builder-only  |
| `formFields.ts`        | model pól formularza (kontakt / newsletter / auth) - wspólny dla obu silników   |
| `authFormSettings.ts`  | ustawienia formularzy logowania/rejestracji czytane z treści widgetu i bloku    |
| `profileCardStyle.ts`  | mapowanie ustawień karty profilu autora na styl design systemu                  |

## Konwencja importu

**Importy głębokie, bez barrela.** `lib/builder/types.ts` i `lib/blocks/types.ts`
lądują w chunku wejściowym oraz w skryptach CI, więc barrel wciągnąłby tam
Reacta z `postContext.tsx` - i rozjechałby `check:bundle` / `check:entry-purity`
przy zapasie liczonym w ułamkach procenta.

```ts
import { toJson } from "@/lib/content-model/json"; // TAK
import { toJson } from "@/lib/content-model";      // NIE (barrela nie ma)
```

`lib/builder/types.ts` i `lib/blocks/types.ts` **re-eksportują** prymitywy
(`Json`, `toJson`, `newId`, `newBlockId`), więc istniejące importy z tych
modułów działają bez zmian - ale nowy kod bierze je wprost stąd.

## Dlaczego `editorCanvas` mieszka tutaj, skoro montuje go builder

Providera montuje wyłącznie builder (`Builder.tsx`, `WidgetLivePreview.tsx`),
ale **konsumentem** jest `postContext` - warstwa wspólna. Gdyby moduł został
pod `lib/builder/`, `content-model` musiałby importować z buildera i cykl
wróciłby jedno piętro niżej, jako `content-model -> builder`.

Warstwa wspólna definiuje **pytanie** ("czy jestem w kanwie edytora i w jakim
trybie?"), a silnik na nie **odpowiada**, montując providera. To ta sama
inwersja, która trzyma `useCurrentPostCtxOrPreview()` bezpiecznym: próbka
`PLACEHOLDER_POST_CTX` nie może wyciec na powierzchnię publiczną, bo wydaje ją
wyłącznie obecność providera kanwy.

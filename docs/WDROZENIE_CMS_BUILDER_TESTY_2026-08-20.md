# Wdrożenie: testy CMS buildera (bloki Gutenberg + widgety Elementor), 2026-08-20

Zlecenie: **95% linii i 93% gałęzi** na pięciu powierzchniach CMS buildera, przy
dodatkowym warunku instrukcje ≥ 95% i funkcje ≥ 93% (żeby „95% linii" nie dało się
ugrać renderem bez interakcji). Dokument podaje ZMIERZONE liczby, komendy, którymi je
zmierzono, oraz jawną listę tego, co zostaje nieprzetestowane i dlaczego.

Dokument jest kontynuacją rozdziału o module 3 z
`docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` - tamten audyt wskazał tę
powierzchnię jako „jedyną dużą powierzchnię MODUŁU 3 BEZ ŻADNEGO progu per-ścieżka -
i dlatego jako jedyną osuniętą do 13,6%" i wprost nazwał następny krok
(„wyprowadzenie warstwy dostępu do wartości pól ze `WidgetProperties.tsx`").

---

## 1. Jak to zmierzono

| Element pomiaru | Wartość                                                                           |
| --------------- | --------------------------------------------------------------------------------- |
| Narzędzie       | `npx vitest run <ścieżki> --coverage --coverage.include='<glob>'` (provider `v8`) |
| Konfiguracja    | repo bez zmian poza progami (`vitest.config.ts`, rozdział 6)                      |
| Zakres          | `all: true` - pliki bez testów WCHODZĄ do mianownika                              |
| Wykluczenia     | te same, co przed zadaniem; **nic nowego nie wykluczono**                         |
| Data pomiaru    | 2026-08-20                                                                        |
| Pełna suita     | 1 297 plików, 29 426 testów zielonych, 24 `it.fails`, 50 pominiętych              |

Kolejność liczb w tabelach: **instrukcje / gałęzie / funkcje / linie**.

Liczby „przed" pochodzą z pomiaru TĄ SAMĄ komendą co „po", wykonanego przed pierwszym
commitem zadania. Nie są tożsame z procentami z opisu zlecenia (29,7% / 31,3% / 40,8% /
51,3% / 63,1% linii) - tamte pochodziły z pomiaru całą suitą, gdzie mianownik obejmuje
też pliki spoza powierzchni.

---

## 2. Wynik: przed → po

| Powierzchnia                                        | przed                         | po                                | cel 95/93  |
| --------------------------------------------------- | ----------------------------- | --------------------------------- | ---------- |
| `src/lib/blocks/**` (rdzeń silnika bloków)          | 81,40 / 71,18 / 74,58 / 83,61 | **98,15 / 93,34 / 99,52 / 99,41** | osiągnięty |
| `src/lib/wordpress-import.functions.ts`             | 0 / 0 / 0 / 0                 | **99,06 / 96,84 / 100 / 99,28**   | osiągnięty |
| `src/lib/sidebarBuilder/**` (reduktor draftu)       | modułu nie było               | **100 / 100 / 100 / 100**         | osiągnięty |
| `src/components/admin/sidebarBuilder/**`            | 0 / 0 / 0 / 0                 | **99,01 / 97,05 / 100 / 100**     | osiągnięty |
| `src/components/blocks/**` (publiczny render)       | 34,59 / 16,50 / 21,89 / 37,40 | **96,75 / 93,03 / 94,57 / 97,85** | osiągnięty |
| `src/components/admin/builder/**` (panele widgetów) | 28,75 / 27,70 / 17,50 / 29,23 | **96,46 / 93,22 / 95,03 / 97,34** | osiągnięty |

Całe `src/` (pełna suita): **62,09 / 56,48 / 58,42 / 62,97** (przed zadaniem, wg wpisu
z 2026-08-18: 37,19 / 32,41 / 29,13 / 37,78).

Komendy pomiaru:

```bash
npx vitest run src/lib/blocks --coverage --coverage.include='src/lib/blocks/**'
npx vitest run src/lib/__tests__ --coverage --coverage.include='src/lib/wordpress-import.functions.ts'
npx vitest run src/lib/sidebarBuilder src/components/admin/sidebarBuilder \
  --coverage --coverage.include='src/lib/sidebarBuilder/**' \
  --coverage.include='src/components/admin/sidebarBuilder/**'
npx vitest run src/components/blocks --coverage --coverage.include='src/components/blocks/**'
npx vitest run src/components/admin/builder --coverage --coverage.include='src/components/admin/builder/**'
npx vitest run --coverage        # progi globalne + per-ścieżka
```

---

## 3. Metoda: dlaczego samo dopisywanie testów by tego nie dowiozło

Zlecenie postawiło diagnozę, którą pomiar potwierdził: z niewykonanych funkcji paneli
zdecydowana większość to funkcje ANONIMOWE - `onChange={(e) => …}` wewnątrz JSX-a.
Testem renderującym dochodzi się do ~60-70% i staje.

Zadziałały cztery dźwignie, w tej kolejności skuteczności:

1. **Wyprowadzenie logiki z JSX-a do czystych modułów.** `src/lib/builder/widgetPanelValues.ts`
   (odczyt/zapis szerokości i wysokości per breakpoint, klasyfikacja trybu, klampy),
   `src/lib/sidebarBuilder/draft.ts` (reduktor draftu). Każdy z nich ma tabelę
   `it.each` z wartością obecną, `undefined`, `null`, `0`/`""` i wartością poza
   zakresem - oba stoją dziś na 100% we wszystkich czterech miarach.
2. **Oprawa testowa ZE STANEM dla edytorów treści.** Wcześniejsze przejazdy tylko
   notowały zapisy - edytor nie dostawał z powrotem tego, co sam zapisał, więc
   walidacja wpisu, operacje na liście i pola zależne od innych pól nie wykonywały
   się ani razu. Ta jedna zmiana dała `widget-properties/**` +8 pp gałęzi.
3. **Wartości FAŁSZYWE, ale poprawne.** `Number(x) || 12` i `value ?? ""` to
   najczęstszy realny błąd w tej warstwie: zero i pusty łańcuch są poprawnymi
   wartościami, a taki zapis podmienia je na domyślną (redaktor ustawia odstęp 0 px
   i dostaje 12 px). Przejazd wpisujący najpierw wartość, potem zero i pustkę
   przechodzi przez OBA ramiona każdego takiego wyrażenia.
4. **Tabele po KATALOGU, nie po ręcznej liście.** Warianty etykiety sekcji (22),
   slidera (5) i strzałek (8) idą z tych samych katalogów, z których czyta renderer.
   Dopisanie wariantu do katalogu automatycznie dokłada przypadek testowy - i to jest
   ten test, który wyłapie wariant dodany bez pracy w panelu.

Poza tym: pusta odpowiedź PostgREST (`data: null`, nie `[]`) na każdej tabeli
podpowiedzi - to straż `data ?? []`, której brak oznacza wywalony panel na świeżej
instalacji, czyli dokładnie u nowego klienta.

---

## 4. Czego NIE pokryto - z numerami linii

Poniższe fragmenty zostają nieprzetestowane ŚWIADOMIE. Żaden nie jest wykluczony
z pomiaru - wchodzą do mianownika i obniżają wynik.

### 4.1 Straże nieosiągalne przez API publiczne

| Plik                      | Linie                   | Dlaczego                                                                                                                                                     |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Builder.tsx`             | 245, 254                | `ids.length === 0` w akcjach zbiorczych - pasek renderuje się tylko dla niepustego zbioru, a skróty klawiszowe wchodzą wyłącznie przy `multiSize > 0`        |
| `Builder.tsx`             | 303                     | `if (!t) return` w obsłudze prawego kliknięcia - cel zdarzenia jest zawsze ustawiony                                                                         |
| `Builder.tsx`             | 422                     | `return {}` dla rodzaju menu z pustym identyfikatorem - handler ustawia oba razem                                                                            |
| `Builder.tsx`             | 663                     | `if (!selection.id) return` - bez zaznaczenia przycisk usuwania jest wyłączony                                                                               |
| `Builder.tsx`             | 749-751, 766-770        | straże `pendingDelete` / `pendingBulkDelete` - okno renderuje się dopiero z ustawionym żądaniem                                                              |
| `VisualCanvas.tsx`        | 213, 279, 283, 304, 339 | straże korzenia i celu zdarzenia (`!t`, `if (root)`, `!id`, `!root`)                                                                                         |
| `VisualCanvas.tsx`        | 546, 566                | `if (e.dataTransfer)` w gałęzi struktury i „brak miejsca" - ładunek jest rozpoznawany WŁAŚNIE z `dataTransfer.types`, więc gałąź bez niego jest nieosiągalna |
| `VisualCanvas.tsx`        | 558-559                 | `zones[last] ?? zones[0]` i `if (zone)` - strefa początkowa istnieje w każdym dokumencie, także pustym                                                       |
| `WidgetResizeOverlay.tsx` | 80-81                   | `Number.isFinite` przy skali - `getBoundingClientRect` nie zwraca NaN                                                                                        |
| `WidgetResizeOverlay.tsx` | 174                     | martwe `computed` (wynik tylko przypisywany)                                                                                                                 |
| `WidgetResizeOverlay.tsx` | 309                     | `active !== e.currentTarget` - uchwyt przenoszenia nie przyjmuje ogniska                                                                                     |
| `InlineSizeToolbar.tsx`   | 259                     | `Number.isFinite(n)` w zatwierdzeniu szkicu - pole filtruje wpis do cyfr, więc nieliczbowy szkic nie istnieje                                                |

### 4.2 Przeciąganie po kanwie (DnD)

Zgodnie z zakresem zadania **nie goniono tu procentów symulacją przeciągania**.
Warstwa decyzji kanwy (co się dzieje po upuszczeniu w danym miejscu, jakie
pierwszeństwo mają ładunki, kiedy pokazać strefę) jest przetestowana zdarzeniami
budowanymi ręcznie (`src/test/builder/domEvents.ts`) - `VisualCanvas.tsx` stoi na
99,02% instrukcji. Nieosiągalne pozostaje:

- `SpeakersEditor.tsx` 109-114 i analogiczne `handleDragEnd` w pozostałych edytorach
  listowych opartych o dnd-kit: wymaga prawdziwych sensorów wskaźnika dnd-kit,
  których `fireEvent` nie uruchamia. Kolejność pozycji jest natomiast przetestowana
  przez przyciski „wyżej/niżej", które robią dokładnie tę samą operację na modelu;
- `SpeakersEditor.tsx` 371 (`isDragging ? 0.5 : 1`) - styl w trakcie przeciągania.

### 4.3 Edytory treści widgetów - najsłabsze gałęzie po zadaniu

`ui/organisms/widget-properties/**` to 38 edytorów i 1 928 instrukcji; po zadaniu
90,92% instrukcji i 85,45% gałęzi (przed: 89,31 / 76,90). Najsłabsze pliki i przyczyna:
`PostListEditor` 87,9%, `SliderEditor` 77,8%, `WorldMapEditor` 76,1%,
`MegaMenuEditor` 86,3% - reszta ich gałęzi to `?? default` w polach, które pojawiają
się tylko dla kombinacji wariantu, źródła danych i kształtu pozycji; każda kolejna
wymaga własnego fixture'u treści, nie kolejnego kliknięcia.

### 4.4 Świadome ograniczenia wydajnościowe

`InteractiveCircleEditor` jest pominięty w przejazdach ZE STANEM (ma własny plik
testowy i 97% instrukcji): przerysowuje cały podgląd koła przy każdym znaku
(>150 ms na wpis), więc jeden jego przejazd trwał dłużej niż reszta pliku i wchodził
w limit czasu. Pominięcie jest zapisane w kodzie testu, nie w konfiguracji pomiaru.

Dwa przejazdy mają jawny limit 30 s zamiast domyślnych 5 s: trzy tabele „ze stanem"
w `editorMatrix` i test pilnujący listy typów z sekcją nadwyżkową (montuje panel
treści dla każdego z ponad stu typów). Pojedynczo biegną w 4-5 s, ale pod PEŁNĄ suitą

- osiem procesów na tym samym CPU - przekraczały domyślny limit. Podniesienie limitu
  jest tu właściwsze niż skrócenie przejazdu: to one niosą pokrycie walidacji, pól
  zależnych i kompletności rejestru, więc skrócenie oddałoby pokrycie za zieloną liczbę
  w logu. Kontrola wycieków w tych przejazdach biegnie raz na rundę, nie po każdym
  znaku - inaczej koszt jest kwadratowy.

---

## 5. Defekty produkcyjne znalezione testami

Zgodnie z zasadą „nie zmieniaj zachowania produkcyjnego, żeby test przeszedł" żaden
z nich nie został naprawiony w tym zadaniu. Każdy ma test oznaczony `it.fails`
z opisem, a część - kontrolę dodatnią przypinającą stan faktyczny, żeby naprawa
od razu zaświeciła na czerwono.

| Obszar                        | Defekt                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TemplateHistoryDialog.fmt()` | martwa straż `catch`: `new Date("x").toLocaleString()` nie rzuca, więc przy nieparsowalnej dacie rewizji redakcja widzi „Invalid Date" |
| `ClampedNumberInput`          | `Number("") === 0` - wyczyszczone pole startuje strzałkami od zera, nie od wartości dokumentu                                          |
| `HoverControl`                | ten sam wzorzec na czasie przejścia: wyczyszczenie pola nie zdejmuje nadpisania                                                        |
| `ChartDataSpreadsheetDialog`  | „Przywróć" jest zjadane przez efekt rehydracji, który nadpisuje punkt odniesienia przy każdej synchronizacji                           |
| `sanitizeHtml`                | prefiks `<script>…</script>` przed ładunkiem przepuszcza handler `on*=` (forma samozamykająca `<script/>` obejścia NIE wywołuje)       |
| `wordpress-import` `slugify`  | polskie `ł` nie jest transliterowane (`Łódź` → `odz`, nie `lodz`) - cicha duplikacja adresów przy imporcie                             |
| `blocks/migrate`              | `iframe` i `img` w formie parzystej wypadają bez śladu; zagnieżdżone `div` wycieka znacznikiem do treści                               |
| `blocks/wordPaste`            | podpis ginie, gdy kontener niesie tekst i grafikę                                                                                      |
| `getBlockVariants`            | klucz z prototypu `Object` (`constructor`, `toString`) nie zwraca `null`                                                               |
| `LiveBlogBlock`               | niepoprawna i pusta data wypisują „Invalid Date"                                                                                       |
| `ContactFormView`             | brak komunikatu przy niezaznaczonej wymaganej zgodzie RODO                                                                             |
| `PostTitleView`               | brak spadku na tytuł w drugim języku, gdy tłumaczenia nie ma                                                                           |

---

## 6. Zapadka progów

`vitest.config.ts`, wszystkie wartości ZMIERZONE, floor ~2 pp pod pomiarem:

| Wpis                                     | przed             | po                     |
| ---------------------------------------- | ----------------- | ---------------------- |
| globalny                                 | 33 / 28 / 25 / 33 | **58 / 52 / 54 / 58**  |
| `src/components/admin/builder/**`        | 27 / 26 / 16 / 28 | **94 / 91 / 93 / 95**  |
| `src/lib/blocks/**`                      | brak              | **96 / 91 / 97 / 97**  |
| `src/components/blocks/**`               | brak              | **95 / 91 / 92 / 96**  |
| `src/lib/wordpress-import.functions.ts`  | brak              | **97 / 94 / 98 / 97**  |
| `src/lib/sidebarBuilder/**`              | brak              | **98 / 96 / 100 / 98** |
| `src/components/admin/sidebarBuilder/**` | brak              | **97 / 95 / 98 / 98**  |
| `src/lib/builder/widgetPanelValues.ts`   | brak              | **99 / 97 / 100 / 99** |

Pięciu jednolinijkowych re-eksportów na poziomie `admin/builder/` (`WidgetLibrary`,
`Navigator`, `ColumnProperties`, `StructurePicker`, `SectionProperties`) **nie
wykluczono** z pomiaru: mają zmierzone 100/100/100/100, bo importują je testy ścieżek
kanonicznych. Zadanie na to wykluczenie pozwalało - jest niepotrzebne, a zmniejszałoby
mianownik.

---

## 7. Bramki, typy, lint

| Sprawdzenie                  | Wynik                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `npx vitest run`             | 1 297 plików, 29 426 testów zielonych, 24 `it.fails` (oczekiwane), 50 pominiętych |
| `npx vitest run --coverage`  | progi globalne i per-ścieżka przechodzą                                           |
| `check:widget-fidelity`      | 542 testy zielone                                                                 |
| `check:gate-coverage`        | 33 bramki `check:*`, każda wpięta raz                                             |
| `check:i18n-parity`          | 613 testów zielonych                                                              |
| `check:i18n-hardcoded`       | OK (ratchet trzyma kierunek)                                                      |
| `check:i18n-default-value`   | OK - 0 zapasowych tekstów przy `t()`                                              |
| `check:i18n-overlay-imports` | OK (ratchet trzyma kierunek)                                                      |
| `npx tsc --noEmit`           | 0 błędów                                                                          |
| `npm run lint`               | 0 błędów (199 ostrzeżeń `react-refresh` w pomocnikach testowych, stan zastany)    |

Nowy kod testowy: zero `any`, zero `as unknown as`, zero `@ts-expect-error`, zero
`Date.now()` i `Math.random()` w asercjach, żadnego czekania `setTimeout` poza jawną
karencją belki rozmiaru (1 200 ms, wartość produkcyjna).

---

## 8. Wspólne narzędzia testowe dodane przy okazji

| Plik                                 | Do czego                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/test/builder/domEvents.ts`      | zdarzenia przeciągania i wskaźnika budowane ręcznie - happy-dom nie dziedziczy `DragEvent` po `MouseEvent`, więc `clientY` z `fireEvent.drop` przepada, a kanwa liczy z niego połowę celu |
| `src/test/builder/canvasStubs.tsx`   | atrapa renderera emitująca tylko atrybuty, po których kanwa rozpoznaje węzły                                                                                                              |
| `src/test/builder/canvasHarness.tsx` | oprawa renderowania kanwy wspólna dla obu jej plików testowych                                                                                                                            |
| `src/test/builder/panels.tsx`        | `selectWithOption`, `optionValues`, `MutableHost`, `radixTabsStub`, `themedColorStyle`                                                                                                    |

`themedColorStyle` zasługuje na zdanie osobno: kolory per tryb (`{light, dark}`) siedzą
w polach, które w typach są zwykłym `string`iem, a produkcja czyta je przez
`pickMode(style.bgColor as Themed<string>)`. Fixture przechodzi tą samą furtką - to nie
obejście typów, a odwzorowanie realnego zapisu z bazy.

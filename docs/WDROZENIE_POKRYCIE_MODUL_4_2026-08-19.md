# Wdrożenie: pokrycie testami MODUŁU 4 — strony, wygląd, motyw, media, import (2026-08-19)

## Diagnoza

Audyt `AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (PR #254) zastał
moduł 4 na **22,76% linii i 16,18% funkcji**, przy **72 plikach produkcyjnych
na czystym zerze** — najgorszym stosunku w repozytorium poza modułami czysto
serwerowymi. Rozkład po funkcjonalnościach:

| Funkcjonalność                  | Plików | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------- | -----: | -----: | ----: | ------: | --------: | --------: |
| Szablony stron i archiwów       |      5 |   3,3% |  6,3% |    5,1% |  **3,7%** |      3/59 |
| Media: upload, crop, biblioteka |     39 |  22,4% | 21,1% |   19,9% | **22,9%** |    69/346 |
| Ikony / marka                   |      7 |  23,2% | 12,7% |   32,4% | **25,5%** |     12/37 |
| Motyw / wygląd / global colors  |     51 |  47,8% | 34,6% |   28,3% | **47,9%** |    56/198 |

Same liczby nie mówią jednak, **czym ta dziura była**. Trzy rzeczy odróżniają ten
moduł od innych słabo pokrytych powierzchni:

1. **Nieodwracalność.** `src/lib/media.functions.ts` (0 z 38 funkcji) to jedyne
   miejsce w module, które KASUJE i PRZENOSI pliki — adresując je prefiksem
   przez `.like("folder_path", …)`. Błąd escapowania w tym prefiksie kasuje
   sąsiedni folder, a nie ten wskazany.
2. **Zasięg poza panel.** Presety kadru budują adresy wariantów obrazków
   serwowane czytelnikom; tokeny motywu jadą w arkuszu na KAŻDEJ stronie;
   kolory kategorii lądują na nagłówkach wpisów. Błąd w panelu widać u
   czytelnika, nie u redaktora.
3. **Cichość.** Cała ta warstwa to spięcia: kontrolka → pole wersji roboczej →
   zapis. Podpięcie kontrolki pod sąsiednie pole nie daje błędu typów (obie
   wartości mają ten sam typ), nie wywraca renderu i nie zapala żadnego
   istniejącego testu — redaktor po prostu ustawia odstęp między literami i
   widzi zmianę marginesu.

### Zakres pomiaru

Audyt liczy moduł jako 129 plików; jego tabela funkcjonalności obejmuje 102 z
nich, a reszta to **trasy administracyjne** (`admin.pages*`, `admin.icons`,
`admin.categories`, `admin.category-colors`, `admin.crop-sizes`, `admin.media`,
`admin.import-wordpress`, `admin.appearance*`, `admin.theme-*`). Pierwotne
zlecenie wyłączało trasy z zakresu; decyzją operatora zakres został rozszerzony
o nie w całości. Wszystkie dziewiętnaście stało na zerze.

Skrypt pomiarowy tej pracy obejmuje 122 pliki (102 z tabel + 19 tras + moduł
`cropGeometry.ts` wydzielony w tej gałęzi). Różnica siedmiu plików względem
liczby z audytu to pliki współdzielone, których globy skryptu nie łapią —
liczby niżej odnoszą się do zakresu skryptu i są w nim porównywalne przed/po.

## Zmiany

32 commity, 50 nowych plików testowych, 1301 przypadków, 5 nowych modułów
produkcyjnych (cztery wydzielenia neutralne + wspólny stub testowy).

### 1. Warunek wstępny — mierzalność

`reportOnFailure: true` w bloku `coverage` (`vitest.config.ts`).
`checkThresholds` żyje wewnątrz `reportCoverage()`, z którego vitest wychodzi
natychmiast po pierwszym nieudanym teście. Bez tej flagi praca nad pokryciem na
czerwonej suicie jest **niemierzalna**: nie widać ani własnego przyrostu, ani
tego, który próg per ścieżka faktycznie stoi na drodze. Flaga nie zmienia
bramkowania — czerwony test nadal przewraca `test:coverage`.

### 2. Wydzielenia neutralne (reguła wyjęta, zachowanie bez zmian)

Cztery reguły siedziały w miejscach nieosiągalnych dla testu jednostkowego.
Każde wydzielenie jest 1:1 — te same wartości, ta sama kolejność, ten sam wynik.

| Nowy moduł                                              | Skąd wyjęte                        | Dlaczego nie dało się inaczej                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/media/cropGeometry.ts`                         | `imageCrop.ts` + `ImageCropDialog` | Reguły kadru (bbox obrotu, tolerancja proporcji, kroki zoomu) mieszkały w kodzie związanym z canvasem i modalem                                |
| `src/components/admin/media/lib/contextMenuItems.tsx`   | `MediaManager.tsx`                 | Reguła dostępności akcji stała w funkcji zagnieżdżonej **po** instrukcji `return` — poza zasięgiem czegokolwiek poza pełnym renderem organizmu |
| `src/components/admin/archiveLayout/lib/widgetOrder.ts` | `ArchiveLayoutAdmin.tsx`           | `moveWidget`/`toggleWidget` były domknięciami nad stanem komponentu                                                                            |
| `src/test/serverFn.ts`                                  | (nowy)                             | Wspólny stub `createServerFn` — bez niego funkcji serwerowych nie da się wywołać poza kontekstem żądania frameworka                            |

Dodatkowo `media.functions.ts` eksportuje dwie wewnętrzne bramki
(`normalizeFolderPath`, `likePrefix`) z adnotacją `@internal` — wyłącznie po to,
żeby escapowanie prefiksu LIKE dało się sprawdzić bez wywoływania kasowania.

### 3. Testy — co jest przypięte

Pełna lista w commitach; niżej reguły, których złamania **nie widać** w żadnym
teście renderującym:

- **Kadrowanie** — klamry zoomu i obrotu, tolerancja proporcji, prostokąt
  kadru liczony w układzie źródła (nie widoku), kroki klawiaturowe z trzema
  modyfikatorami. Bez kroku 0,1° nie da się wyprostować horyzontu.
- **Operacje nieodwracalne na plikach** — escapowanie prefiksu LIKE, granica
  tenanta w każdym zapytaniu, rekurencyjność kasowania folderu, przenoszenie po
  prefiksie ścieżki.
- **Wgrywanie** — walidacja PRZED wysłaniem bajtów (bucket jest publiczny i
  serwuje bajty bezpośrednio) oraz OBOWIĄZKOWE sprzątnięcie obiektu po
  odrzuconej rejestracji. To ostatnie jest jedynym powodem istnienia
  `uploadAndRegisterMedia` i do tej pory nie miało ani jednego wykonania.
- **Zaznaczanie prostokątem** — auto-przewijanie przy krawędzi. Pętla żyła na
  `requestAnimationFrame`, który w testach był atrapą zwracającą numer klatki i
  nigdy nie wołającą wywołania zwrotnego; bez przejęcia kontroli nad klatkami
  ta ścieżka była kodem martwym dla całej suity.
- **Model motywu** — mapowanie na tokeny `--td-*`, nadpisania trybu ciemnego,
  bramka `hardenStyleCss` przed wyjściem poza blok `<style>` (`themeDesignToCss`
  NIE waliduje kolorów: `z.string().min(1)` przyjmuje dowolny napis z bazy).
- **Pary kontrolka → token** — pełna tabela wszystkich pól dwunastu sekcji
  edytora Theme Design, dwunastu pól typografii overlay i kilkunastu pól
  metaboxu strony.
- **Izolacja podglądu na żywo** — tokeny `--td-*` PRZESKALOWANE z `:root` na
  korzeń podglądu. Bez tego podgląd nadpisałby tokeny całego panelu
  administracyjnego.
- **Trasy** — kształt zapytania (granica tenanta w każdym z trzech zapytań listy
  stron, widok kosza jako inny zbiór i inne sortowanie, escapowanie frazy,
  filtrowanie po stronie bazy zamiast po stronie wyników), blokada
  optymistyczna edytora strony (`baseUpdatedAt` z chwili wczytania,
  przesuwany na wartość zwróconą przez serwer), kanoniczny slug po kolizji,
  dwustopniowe potwierdzenie operacji zbiorczych.

### 4. Naprawa dwóch defektów (osobny commit)

Przy pisaniu testów wyszedł ten sam defekt w dwóch miejscach: `async` obsługa
kliknięcia z `try/finally`, ale **bez** `catch`. Blokada przycisku znikała
poprawnie, natomiast odrzucona obietnica wypływała poza komponent jako
nieobsłużona. Dla użytkownika skutek był gorszy niż sam błąd: nie działo się NIC.

- `ImageCropDialog` — nieudane kadrowanie (brak kontekstu 2d, obraz „skażony"
  CORS-em) pokazuje teraz komunikat w oknie, znikający przy kolejnej próbie.
- `MediaInfoPanel` — nieudany zapis opisu alternatywnego leci `toast.error`
  z nowym kluczem `admin.saveFailed` (PL/EN). Wcześniej redaktor widział ciszę i
  uznawał opis za zapisany.

Przy okazji zamknięty został dług bramki `check:i18n-overlay-imports`:
`contextMenuItems.tsx` i `MediaInfoPanel.tsx` importują teraz nakładkę wprost,
przez co plik schodzi z listy bazowej (10 → 0), a razem z nim `AdminShell` (2 → 0).

### 5. Progi per ścieżka

`vitest.config.ts` dostaje 27 nowych wpisów: czyste reguły, drzewa komponentów i
dziewiętnaście tras (per plik — glob `src/routes/admin.*` objąłby także trasy
innych modułów). Progi floorowane 2–4 pp pod zmierzonym pokryciem. Gałęzie mają
luźniejsze floory od instrukcji, bo w tej warstwie zostają ramiona obronne
nieosiągalne z interfejsu; `media.functions.ts` dostaje najniższy próg gałęzi
(78%), bo jego obrona przed brakiem sesji, tenanta i odmową RLS stoi **przed**
wywołaniem, nie w nim.

## Dowód

Pomiar zakresu modułu 4 (te same globy przed i po):

| Funkcjonalność             | Plików | Zer | Instr. przed | Instr. po | Funkcje przed |  Funkcje po |
| -------------------------- | -----: | --: | -----------: | --------: | ------------: | ----------: |
| Szablony stron i archiwów  |      5 |   0 |         3,3% | **99,2%** |          3/59 |   **60/60** |
| Media: upload, crop, bibl. |     41 |   0 |        22,4% | **97,5%** |        69/346 | **348/361** |
| Motyw / wygląd             |     52 |   0 |        47,8% | **98,2%** |        56/198 | **196/201** |
| Ikony / marka              |      5 |   0 |        23,2% | **92,0%** |         12/37 |   **22/25** |
| Trasy administracyjne M4   |     19 |   0 |         0,0% | **96,9%** |         0/282 | **280/282** |
| **MODUŁ 4 RAZEM**          |    122 |   0 |        22,8% | **97,3%** |       160/989 | **906/929** |

Pomiar bramkowany (uruchomienie z włączonymi progami per ścieżka na zakresie
modułu): **97,36% instrukcji · 88,01% gałęzi · 97,60% funkcji · 98,65% linii** —
wszystkie bramki przechodzą.

Wynik względem definicji ukończenia:

| Kryterium                               | Cel     | Osiągnięte            |
| --------------------------------------- | ------- | --------------------- |
| Moduł 4 — linie                         | ≥ 95%   | **98,65%**            |
| Moduł 4 — funkcje                       | ≥ 95%   | **97,60%**            |
| `imageCrop.ts` — linie / gałęzie        | 95 / 85 | **100% / 100%**       |
| `themeDesign.ts` — funkcje              | ≥ 90%   | **100%**              |
| `media.functions.ts` — linie            | ≥ 90%   | **100%**              |
| Cztery hooki panelu mediów zejdą z zera | tak     | tak (wszystkie ≥ 95%) |
| „Szablony stron i archiwów"             | ≥ 40%   | **99,2%**             |
| Pliki modułu na 0%                      | —       | **0** (było 72)       |

Bramki repozytorium: `check:i18n-hardcoded`, `check:i18n-default-value`,
`check:i18n-overlay-imports`, `check:i18n-parity`, `check:bundle`,
`check:chunks`, `check:entry-purity`, `tsc --noEmit`, `eslint`,
`prettier --check` — wszystkie zielone. Ścieżka bootowania pozostaje czysta
(9 chunków statycznie osiągalnych z 770), graf chunków acykliczny.

## Defekty przypięte, nienaprawione

Testy utrwalają dzisiejsze zachowanie i nazywają problem w komentarzu. Naprawa
każdego z nich ZMIENIA zachowanie, więc idzie osobnym zgłoszeniem.

| #   | Miejsce                               | Objaw                                                                                                                                                                     |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `buildImageSrcSet`                    | Na adresie już przetworzonym (`/render/image/public/`) emituje kandydatów `?w=`, których endpoint ignoruje — każdy kandydat ma oryginalną szerokość, a deskryptor kłamie  |
| 2   | `uploadIconAsset`                     | Plik bez kropki w nazwie: `"logo".split(".").pop()` daje `"logo"` jako rozszerzenie, więc fallback `"png"` nigdy nie działa                                               |
| 3   | `ImageCropDialog`                     | Przyciski ±90° nie są klamrowane do zakresu suwaka (±180°) — trzy kliknięcia w prawo dają 270°                                                                            |
| 4   | `ArchiveLayoutAdmin`                  | Strzałki kolejności widgetów nie zmieniają kolejności NA LIŚCIE (renderuje się ze sztywnego katalogu); kolejność działa na stronie publicznej, ale operator jej nie widzi |
| 5   | `sourceAspectWarning(0, 0, …)`        | Zwraca `false`, bo `NaN > tolerance` jest fałszem — najgorsze możliwe wejście przechodzi w ciszy                                                                          |
| 6   | `MediaManager` — menu kontekstowe     | „Otwórz" na folderze nie czyści zaznaczenia (klik w kafel czyści), więc kolejne Cmd+C albo Delete obejmuje pliki spoza widoku                                             |
| 7   | `MediaToolbar` — przycisk informacji  | Wyłącznie ikona, bez `title` i `aria-label` — czytnik ekranu odczyta go jako „przycisk"                                                                                   |
| 8   | `admin.category-colors` — błąd zapisu | `PostgrestError` nie jest instancją `Error`, więc `String(e)` pokazuje redaktorowi „[object Object]"                                                                      |

## Czego to NIE naprawia

- **Gałęzie**, nie instrukcje. Moduł stoi na 88% gałęzi. Reszta to ramiona
  obronne nieosiągalne z interfejsu (fallbacki `?? null` na polach z bazy,
  strażniki sesji przy operacjach bramkowanych wcześniej przez middleware).
  Dobicie ich wymagałoby testów na poziomie serwera, nie komponentu.
- **Polityki bucketu i RLS**. Zgodnie z regułą repozytorium nie są testowane w
  vitest — to zakres pgTAP.
- **Osiem defektów wyżej.** Są przypięte, nie naprawione.
- **Reguły wewnętrzne cudzych bibliotek.** `mammoth`, `xlsx` i
  `@resvg/resvg-wasm` są podmieniane na granicy modułu, nie głębiej.

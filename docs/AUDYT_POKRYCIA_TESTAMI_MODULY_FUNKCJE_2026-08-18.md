# Audyt pokrycia testami: moduł po module, funkcja po funkcji (2026-08-18)

Zlecenie: **„ile % pokrycia testami ma każdy moduł, jego funkcje oraz funkcjonalności”**.
Dokument podaje ZMIERZONE liczby (nie oceny), z jawną metodologią i jawnymi ograniczeniami
pomiaru. Taksonomia modułów jest ta sama, co w `docs/OCENA_FUNKCJI_TABELE_2026-08-14.md`,
więc liczby da się wprost podłożyć pod tamte tabele ocen.

> **AKTUALIZACJA 2026-08-19 — MODUŁ 11 (newsletter i e-mail) zamknięty.**
> Liczby modułu 11 w tym dokumencie to **stan zastany na dzień audytu** (HEAD
> `e83570c`). Moduł został od tego czasu domknięty: **26,70% → 81,74% linii**,
> **20,74% → 84,79% funkcji**, plików na zerze **70 → 22**, panel administracyjny
> z **1,4% → 99,19%**. Wiersze modułu 11 w tabelach niżej NIE zostały przeliczone
> ani przesortowane - są punktem odniesienia, do którego odsyła dokument
> wdrożenia. Pomiar po zmianie, rozbicie per panel, sześć defektów znalezionych
> testami i lista tego, co świadomie zostaje nieprzetestowane:
> `docs/WDROZENIE_NEWSLETTER_TESTY_MODUL_11_2026-08-19.md`.

---

## 0. Jak to zmierzono (i czego te liczby NIE znaczą)

| Element pomiaru                    | Wartość                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narzędzie                          | `vitest run --coverage` (provider `v8`), konfiguracja repo bez zmian                                                                                      |
| Zakres mierzony                    | całe `src/**/*.{ts,tsx}` (`all: true`) — pliki bez testów WCHODZĄ do mianownika                                                                           |
| Wykluczenia (z `vitest.config.ts`) | `__tests__`, `*.test.*`, artefakty generowane (`routeTree.gen.ts`, `supabase/types.ts`, `lucideIconNodes.generated.ts`), `src/test/**`, `lazyWidgets.tsx` |
| Plików produkcyjnych w mianowniku  | 2 538                                                                                                                                                     |
| Plików testowych zmierzonych       | 778 z 817 (95,2%)                                                                                                                                         |
| Przypadków testowych w pomiarze    | 7 810 z 8 274                                                                                                                                             |
| Testy poza pomiarem                | **0 — przyczyna ustalona i NAPRAWIONA 2026-08-18 wieczorem (rozdział 9.2)**                                                                               |
| Data pomiaru                       | 2026-08-18, HEAD `e83570c`                                                                                                                                |
| Pomiar POPRAWIONY                  | 2026-08-18 (po naprawie), całe `src/`: **36,84% instr. / 32,02% gał. / 28,90% fn / 37,46% linii** — 833 pliki, 10 269 testów                              |

**Cztery zastrzeżenia, bez których te procenty można źle odczytać:**

1. **Pokrycie ≠ poprawność.** Instrukcja „pokryta” to instrukcja, która się WYKONAŁA w trakcie
   testu — nie taka, której wynik ktoś sprawdził asercją. Dlatego obok pokrycia podaję gęstość
   asercji (kolumna „asercje”) — moduł z wysokim pokryciem i niską liczbą asercji to render bez dowodu.
2. **Pokrycie jednostkowe to nie całe pokrycie systemu.** Warstwa danych (RLS, RPC, triggery) jest
   testowana w pgTAP (97 plików, 1 812 asercji), a ścieżki użytkownika w Playwright
   (7 plików, 42 testów Playwright). Tych warstw v8 nie widzi — moduł z niskim %
   jednostkowym może mieć realną zaporę w bazie (rozdział 7).
3. **Mapowanie plik → moduł jest MOJE, nie repo.** Repo nie ma manifestu modułów; przypisanie
   2 538 plików do 21 modułów zrobiłem regułami po ścieżkach (rozdział 9.1). Pliki graniczne
   (np. `gifting` — „podaruj artykuł” jest funkcją MODUŁU 1, a kod leży w powierzchni MODUŁU 14)
   zaznaczam w tabelach.
4. ~~**Pomiar wykonany w sandboksie CI-podobnym, nie na maszynie repo.**~~ **NIEAKTUALNE —
   PRZYCZYNA USTALONA I NAPRAWIONA (2026-08-18, wieczorem).** Pierwotne brzmienie tego
   zastrzeżenia zgadywało, że 39 plików testowych zawiesza się z powodu ciężkich importów
   i zależności z publicznego npm zamiast pinów z `bun.lock`. **Obie hipotezy były fałszywe.**
   Weryfikacja: przy KOMPLETNYM `bun install` (806 paczek zgodnych z pinami, zero dryfu wersji)
   zawieszenie było identyczne, a same importy są szybkie — `WidgetView` ładuje się w 1,8 s,
   lustro `eagerWidgetChunks` w 3,9 s.
   Prawdziwa przyczyna to ZAKLESZCZENIE CYKLU pod fabryką `vi.mock`:
   `vi.mock(".../lazyWidgets", () => import("@/test/eagerWidgetChunks"))` → lustro importuje
   `PostsSliderWidget` → ten importował `SliderRender` z `./lazyWidgets`, czyli z modułu,
   którego fabryka WŁAŚNIE trwała. Fabryka czekała na import, który czekał na tę samą fabrykę.
   Limity `testTimeout`/`hookTimeout` nie dotyczą fazy ładowania modułu, więc przebieg stał
   bez końca zamiast paść — dlatego wyglądało to na „ciężki import".
   Skutek dla czytelnika tabel: **`bun run test` nie dawał się dokończyć na tym HEAD-zie w ŻADNYM
   środowisku, także w CI repo.** Naprawa (rozdział 9.2) odblokowała 18 plików / 1 026 testów.
   Liczby w tabelach niżej pochodzą z pomiaru PRZED naprawą; wiersz „Pomiar POPRAWIONY" w tabeli
   metodologii i rozdział 9.2 podają wartości po niej.

---

## 1. Wynik globalny: całe `src/`

| Metryka    | Pokryte / wszystkich |          % |
| ---------- | -------------------: | ---------: |
| Instrukcje |     34 312 / 104 902 | **32,71%** |
| Gałęzie    |      26 234 / 96 977 | **27,05%** |
| Funkcje    |       7 298 / 28 814 | **25,33%** |
| Linie      |      30 466 / 91 798 | **33,19%** |

Próg globalny w `vitest.config.ts` (ratchet, wolno tylko podnosić): **29% instrukcji / 25% gałęzi /
22% funkcji / 29% linii**. Wszystkie cztery metryki są nad progiem, ale margines jest cienki:
funkcje 25,33% wobec progu 22%, gałęzie 27,05% wobec 25%.

**Kontrola wiarygodności pomiaru.** Komentarz w configu dokumentuje pomiar z 2026-08-06:
32,97% instrukcji / 28,49% gałęzi / 25,77% funkcji / 33,62% linii. Ten audyt — na 95,2% suity
i dwa tygodnie później — daje 32,71% / 27,05% / 25,33% / 33,19%. Zbieżność co do dziesiątych części
punktu przy niezależnym przebiegu i innym zestawie wersji zależności potwierdza, że liczby w tym
dokumencie są tym samym rzędem pomiaru, co własny pomiar repo, a brakujące 39 plików testowych
odpowiadają za deficyt rzędu pojedynczych dziesiątych punktu na poziomie całego `src/`.

---

## 2. Pokrycie per moduł — tabela główna

Sortowanie: po pokryciu linii, rosnąco (najsłabsze na górze).
**⚠** = pomiar tego modułu jest ZANIŻONY, bo część jego plików testowych nie dała się uruchomić w tym
środowisku (rozdział 9.2).
`T/P` = pliki testowe / pliki produkcyjne w module. `0%` = pliki produkcyjne bez ani jednej wykonanej linii.
**↻** = wiersz zmierzony PONOWNIE 19.08.2026, po wdrożeniu opisanym w
`docs/WDROZENIE_MODUL2_TESTY_REFAKTOR_2026-08-18.md`. Pozostałe wiersze to pomiar z 18.08.

| #   | Moduł                                                 | Pliki prod. | Instrukcje | Gałęzie | Funkcje |      Linie | Plików 0% |   T/P | Testów | Asercji |
| --- | ----------------------------------------------------- | ----------: | ---------: | ------: | ------: | ---------: | --------: | ----: | -----: | ------: |
| 7   | Typy treści specjalne                                 |         109 |     16,73% |  13,26% |  14,60% | **16,47%** |        75 | 0,183 |    203 |     484 |
| 16  | Społeczność: kluby, komentarze, moderacja             |         242 |     18,26% |  14,88% |  13,32% | **17,56%** |       177 | 0,244 |    586 |   1 047 |
| 15  | Profil i konto                                        |          81 |     18,41% |  16,07% |  18,00% | **19,12%** |        45 | 0,247 |    187 |     378 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         122 |     21,70% |  16,97% |  17,43% | **22,00%** |        62 | 0,197 |    289 |     557 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |          38 |     22,85% |  23,26% |  15,28% | **22,55%** |        19 | 0,289 |     88 |     247 |
| 4   | Strony, wygląd, motyw, media, import                  |         129 |     22,31% |  19,25% |  16,18% | **22,76%** |        72 | 0,269 |    219 |     492 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         134 |     23,41% |  19,74% |  17,58% | **24,42%** |        75 | 0,142 |    103 |     225 |
| 11  | Newsletter i e-mail                                   |         135 |     26,05% |  21,30% |  20,74% | **26,70%** |        70 | 0,252 |    314 |     723 |
| 17  | Analityka i BI                                        |          85 |     27,36% |  21,74% |  22,58% | **28,00%** |        51 | 0,224 |    199 |     442 |
| 1   | Wpisy: doświadczenie czytelnika                       |          74 |     31,75% |  32,89% |  26,93% | **31,81%** |        43 | 0,405 |    321 |     697 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         162 |     31,97% |  29,71% |  26,68% | **32,71%** |        87 | 0,302 |    542 |   1 252 |
| 2   | Edytor wpisów i workflow redakcyjny ↻                 |          93 |     35,83% |  30,30% |  32,13% | **35,87%** |        43 | 0,355 |    539 |   1 053 |
| 3   | Silniki treści: bloki + page builder ⚠                |         448 |     39,10% |  33,89% |  29,04% | **39,99%** |       205 | 0,448 |  2 048 |   4 507 |
| 12  | Realtime / powiadomienia / web-push                   |          28 |     41,64% |  26,10% |  41,02% | **44,12%** |        13 | 0,464 |     93 |     223 |
| 8   | SEO, feedy, dane strukturalne                         |          73 |     50,75% |  43,58% |  48,94% | **50,31%** |        32 | 0,521 |    314 |     724 |
| 20  | Platforma / backend / infrastruktura / SSR            |         174 |     51,94% |  40,27% |  40,16% | **52,72%** |        71 | 0,651 |  1 147 |   2 390 |
| 21  | Rekrutacja / kariera                                  |          29 |     54,96% |  53,52% |  47,13% | **55,12%** |        12 | 0,379 |    171 |     374 |
| 9   | Czat / komunikator                                    |          80 |     60,57% |  51,26% |  57,56% | **61,96%** |        15 | 0,450 |    607 |   1 123 |
| —   | PRZEKROJOWE: design system (components/ui)            |          43 |     61,75% |  53,31% |  56,14% | **63,13%** |        11 | 0,047 |     17 |      37 |
| 10  | Sieć / networking                                     |          31 |     78,03% |  66,52% |  80,79% | **81,68%** |         3 | 0,710 |    327 |     609 |
| —   | PRZEKROJOWE: słowniki i18n                            |         116 |     87,65% |  64,51% |  51,32% | **91,78%** |         1 | 0,052 |     60 |     141 |
| 6‡  | Wyszukiwarka                                          |          24 |     96,66% |  90,09% |  95,22% | **97,38%** |         0 | 0,875 |    528 |     117 |
| 5§  | Strona główna, archiwa, chrome                        |          52 |     95,72% |  83,53% |  94,35% | **97,43%** |         0 | 0,462 |    631 |   1 057 |
| 2†  | Edytor wpisów i workflow redakcyjny                   |          83 |     98,81% |  94,38% |  99,00% | **99,41%** |         0 | 0,964 |  1 568 |   3 150 |

**‡** MODUŁ 6 zmierzony ponownie 19.08.2026 po wdrożeniu pokrycia
(`docs/WDROZENIE_WYSZUKIWARKA_TESTY_2026-08-18.md`) — pomiar z pełnego `bun run test:coverage`.

**§** MODUŁ 5 zmierzony ponownie 19.08.2026 po wdrożeniu pokrycia
(`docs/WDROZENIE_MODUL5_CHROME_ARCHIWA_TESTY_2026-08-18.md`). Był na czwartym miejscu od
dołu: 16,71% linii, 34 z 51 plików na zerze. Asercje policzone jako wystąpienia `expect(`
w 24 plikach testowych modułu.

**†** MODUŁ 2 zmierzony ponownie 19.08.2026 po wdrożeniu pokrycia
(`docs/WDROZENIE_POKRYCIE_MODUL_2_EDYTOR_WPISOW_2026-08-18.md`) — pozostałe wiersze pochodzą
z pomiaru 18.08. Wiersze zmierzone ponownie stoją na końcu, bo tabela jest sortowana rosnąco
po pokryciu linii.

### 2.1 Wymiar „funkcje”: ile funkcji w module zostało kiedykolwiek wywołane

To najostrzejsza z czterech metryk: liczy KAŻDĄ funkcję (również strzałkowe callbacki i handlery),
a „pokryta” znaczy „wywołana co najmniej raz”. Moduł z 20% funkcji ma cztery piąte swoich zachowań
nigdy nie uruchomione w teście.

| #   | Moduł                                                 | Funkcji razem | Wywołanych |  % funkcji |
| --- | ----------------------------------------------------- | ------------: | ---------: | ---------: |
| 5   | Strona główna, archiwa, chrome ⚠                      |           534 |         63 | **11,80%** |
| 16  | Społeczność: kluby, komentarze, moderacja             |         3 139 |        418 | **13,32%** |
| 7   | Typy treści specjalne                                 |         1 637 |        239 | **14,60%** |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |           458 |         70 | **15,28%** |
| 4   | Strony, wygląd, motyw, media, import                  |           989 |        160 | **16,18%** |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |         1 411 |        246 | **17,43%** |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |         1 439 |        253 | **17,58%** |
| 15  | Profil i konto                                        |         1 028 |        185 | **18,00%** |
| 11  | Newsletter i e-mail                                   |         1 485 |        308 | **20,74%** |
| 17  | Analityka i BI                                        |           877 |        198 | **22,58%** |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |         1 387 |        370 | **26,68%** |
| 1   | Wpisy: doświadczenie czytelnika                       |           698 |        188 | **26,93%** |
| 3   | Silniki treści: bloki + page builder ⚠                |         6 828 |      1 983 | **29,04%** |
| 2   | Edytor wpisów i workflow redakcyjny ↻                 |           834 |        268 | **32,13%** |
| 20  | Platforma / backend / infrastruktura / SSR            |         1 930 |        775 | **40,16%** |
| 12  | Realtime / powiadomienia / web-push                   |           373 |        153 | **41,02%** |
| 21  | Rekrutacja / kariera                                  |           348 |        164 | **47,13%** |
| 8   | SEO, feedy, dane strukturalne                         |           470 |        230 | **48,94%** |
| —   | PRZEKROJOWE: słowniki i18n                            |           152 |         78 | **51,32%** |
| —   | PRZEKROJOWE: design system (components/ui)            |           228 |        128 | **56,14%** |
| 9   | Czat / komunikator                                    |         1 051 |        605 | **57,56%** |
| 10  | Sieć / networking                                     |           302 |        244 | **80,79%** |
| 6‡  | Wyszukiwarka                                          |           293 |        279 | **95,22%** |
| 2†  | Edytor wpisów i workflow redakcyjny                   |           802 |        794 | **99,00%** |

---

## 3. Pokrycie per funkcjonalność (121 funkcjonalności w 21 modułach)

Każdy wiersz to FUNKCJA PRODUKTU, nie katalog: lista plików ją realizujących jest zdefiniowana
wzorcami ścieżek. Kolumna „fn” to funkcje wywołane / wszystkie funkcje w plikach tej funkcjonalności.

### MODUŁ 1 — Wpisy: doświadczenie czytelnika · linie 31,81% → **81,43%** · funkcje 26,93% → **80,94%**

> **AKTUALIZACJA 2026-08-19.** Moduł został domknięty: linie **81,43%**, instrukcje **79,89%**,
> funkcje **80,94%**, gałęzie **71,47%**. Plików 74 → **122** (48 nowych z wyprowadzenia reguł
> i paneli), plików na zerze **43 → 16** (z czego 4 to pliki tras panelowych zredukowane
> do samej rejestracji, a 2 to publiczne trasy wpisu jawnie poza zakresem).
> Wdrożenie i metodologia pomiaru: `docs/WDROZENIE_MODUL_1_TESTY_PANELE_2026-08-19.md`.
> Pomiar „po" ma mianownik zawężony do plików modułu (reguły z rozdziału 9.1 plus trzy
> katalogi dopisane niżej) i numerator z 83 plików testowych; pełny przebieg z pokryciem
> nie kończy się w tym sandboksie (rozdział 9.2), więc numerator jest DOLNYM ograniczeniem.

| Funkcjonalność                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) | Linie 2026-08-19 |
| -------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: | ---------------: |
| Audio wpisu (TTS)                      |     12 |        743 |  11,6% |  9,2% |   15,4% |  **11,4%** |    21/136 |        **78,2%** |
| Układy wpisu + render                  |     24 |        567 |  18,4% | 27,5% |   18,2% |  **19,0%** |    29/159 |        **89,0%** |
| Licznik odsłon / zapisane artykuły     |      3 |        101 |  23,3% | 14,6% |   17,9% |  **25,7%** |      5/28 |       **100,0%** |
| Powiązane wpisy / rekomendacje         |      6 |        149 |  47,1% | 51,9% |   48,6% |  **50,3%** |     18/37 |        **87,7%** |
| Paywall / bramka dostępu               |      5 |        152 |  70,9% | 73,4% |   78,8% |  **71,7%** |     26/33 |        **79,4%** |
| Spis treści (TOC) + przypisy           |      4 |        165 |  83,9% | 72,0% |   73,0% |  **87,3%** |     27/37 |      **83,1%**\* |
| Key takeaways + cytowania              |      4 |        152 |  89,0% | 84,4% |   82,8% |  **88,8%** |     24/29 |        **99,4%** |
| Metering „N darmowych/mies.”           |      3 |         85 |  98,0% | 96,1% |  100,0% | **100,0%** |     23/23 |       **100,0%** |
| PANELE ADMINA (`admin/postExperience`) |      — |          — |      — |     — |       — |          — |         — |       **100,0%** |

\* TOC „spadł" wyłącznie przez zmianę mianownika: doszedł `lib/toc/panelRules.ts` (100%),
ale też `lib/toc/manualItems.ts`, którego audyt nie liczył w tej grupie. Sam
`lib/toc/settings.ts` poszedł z 51,2% na 100% linii i funkcji.

### MODUŁ 2 ↻ — Edytor wpisów i workflow redakcyjny · linie 35,87% · funkcje 32,13%

Pomiar z **19.08.2026**, po wdrożeniu opisanym w
`docs/WDROZENIE_MODUL2_TESTY_REFAKTOR_2026-08-18.md`. Stan z 18.08 dla porównania:
linie 8,34%, instrukcje 7,75%, gałęzie 6,82%, funkcje 6,85%, 64 z 83 plików na zerze.

| Funkcjonalność                           | Plików | LOC mierz. | Instr. |   Gał. | Funkcje |      Linie | fn (szt.) |
| ---------------------------------------- | -----: | ---------: | -----: | -----: | ------: | ---------: | --------: |
| Listy, kalendarz, przekierowania, import |      6 |        483 |   0,0% |   0,0% |    0,0% |   **0,0%** |     0/153 |
| Rewizje i przywracanie                   |     12 |        247 |   8,0% |  11,4% |   13,0% |   **9,3%** |     12/92 |
| Workflow draft→review→published          |     10 |        276 |  15,4% |  10,2% |   12,2% |  **15,2%** |    15/123 |
| Edytor wpisu (panele)                    |     60 |      1 044 |  54,9% |  44,6% |   47,6% |  **54,8%** |   204/429 |
| Autozapis i niezapisane zmiany           |      4 |        157 |  96,4% |  88,5% |  100,0% |  **98,1%** |     36/36 |
| Obecność edytorska (presence)            |      1 |          1 | 100,0% | 100,0% |  100,0% | **100,0%** |       1/1 |

**Wzorce ścieżek tych wierszy** (pierwsze trafienie wygrywa; przebieg z 18.08 ich nie
zapisał, więc od teraz są utrwalone i pomiar da się odtworzyć):

| Funkcjonalność                           | Wzorce                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rewizje i przywracanie                   | `src/components/admin/versions/`, `src/lib/revisions`, `src/lib/posts-migrate`, `src/routes/admin\.versions`       |
| Workflow draft→review→published          | `src/components/admin/workflows/`, `src/routes/admin\.workflows`                                                   |
| Obecność edytorska (presence)            | `src/hooks/useEditPresence`                                                                                        |
| Edytor wpisu (panele)                    | `src/components/admin/post-editor/`, `src/components/admin/PostEditor`, `src/components/admin/PostGeneralOverview` |
| Autozapis i niezapisane zmiany           | `src/hooks/useAutosave`, `src/hooks/useHistory`, `src/hooks/useUnsavedChangesGuard`, `src/lib/unsavedChanges`      |
| Listy, kalendarz, przekierowania, import | `src/routes/admin\.(posts\|scheduler\|calendar\|redirects\|import-wordpress\|contributors)`                        |

Sześć wierszy pokrywa **wszystkie 93** pliki modułu; tabela z 18.08 miała pięć wierszy
obejmujących 75 z 83 plików, więc wiersze nie są porównywalne jeden do jednego.

### MODUŁ 3 — Silniki treści: bloki + page builder ⚠ · linie 39,99% · funkcje 29,04%

> **⚠ ZNACZNIK „POMIAR ZANIŻONY” ZDJĘTY (2026-08-18, wieczorem).** Liczby w tabeli poniżej
> pochodzą z przebiegu, w którym 38 plików testowych tego modułu nie startowało z powodu
> zakleszczenia opisanego w rozdziale 9.2 — **nie** z powodu ciężkich importów ani dryfu
> zależności, jak zgadywało pierwotne zastrzeżenie nr 4. Po naprawie ZMIERZONE:
>
> | Funkcjonalność                           | W tabeli (zaniżone) |                    Zmierzone po naprawie |
> | ---------------------------------------- | ------------------: | ---------------------------------------: |
> | CMS: widgety buildera — render publiczny |         68,8% linii | **97,65% linii** · 95,12% fn (1326/1394) |
> | CMS: panele właściwości widgetów         |         13,6% linii |  **29,14% linii** · 17,53% fn (364/2077) |
>
> Pozostałe wiersze tabeli pozostają aktualne. Powierzchnia „design tokens / kolory globalne /
> typografia” (32,3% linii) została w tej samej sesji podniesiona pracą testową — patrz
> `docs/WDROZENIE_MODUL3_ODBLOKOWANIE_SUITY_I_TOKENY_2026-08-18.md`.

| Funkcjonalność                                         | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| CMS: panele właściwości widgetów                       |    112 |      4 687 |  13,5% | 11,4% |    8,0% | **13,6%** |  166/2077 |
| CMS: builder sidebara + wzorce                         |      6 |        224 |  27,9% | 10,1% |   17,6% | **29,5%** |    21/119 |
| CMS: design tokens / kolory globalne / typografia      |      6 |        251 |  27,6% | 20,7% |   25,6% | **32,3%** |     10/39 |
| CMS: render bloków (publiczny)                         |     39 |      1 909 |  36,1% | 18,6% |   22,1% | **39,0%** |   114/516 |
| CMS: import z Gutenberga / WordPressa                  |     10 |      1 309 |  47,5% | 41,3% |   53,6% | **49,4%** |   134/250 |
| CMS: silnik bloków (typ Gutenberg) — rdzeń             |      9 |        358 |  63,5% | 62,7% |   43,5% | **63,1%** |    64/147 |
| CMS: widgety buildera — render publiczny               |     51 |      3 589 |  67,6% | 55,8% |   64,9% | **68,8%** |   511/787 |
| CMS: page builder (typ Elementor) — schemat i operacje |     11 |        649 |  67,8% | 56,0% |   56,5% | **71,8%** |   166/294 |
| CMS: zapytania danych widgetów                         |      8 |        459 |  70,3% | 61,0% |   80,0% | **75,6%** |   112/140 |
| CMS: silnik treści publicznej (contentEngine)          |     19 |        514 |  77,4% | 77,5% |   80,7% | **78,4%** |    92/114 |
| CMS: edycja bloków (selekcja, focus, schowek, undo)    |      6 |        236 |  88,1% | 82,6% |  100,0% | **89,4%** |     45/45 |
| CMS: sanityzacja HTML                                  |      3 |        157 |  87,8% | 86,6% |   87,5% | **90,4%** |     28/32 |
| CMS: warstwa content-model (rozdział bloki⇄builder)    |      7 |        150 |  93,0% | 82,3% |   96,9% | **98,0%** |     31/32 |

### MODUŁ 4 — Strony, wygląd, motyw, media, import · linie 22,76% · funkcje 16,18%

| Funkcjonalność                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Szablony stron i archiwów       |      5 |        108 |   3,3% |  6,3% |    5,1% |  **3,7%** |      3/59 |
| Media: upload, crop, biblioteka |     39 |      1 391 |  22,4% | 21,1% |   19,9% | **22,9%** |    69/346 |
| Ikony / marka                   |      7 |        149 |  23,2% | 12,7% |   32,4% | **25,5%** |     12/37 |
| Motyw / wygląd / global colors  |     51 |        629 |  47,8% | 34,6% |   28,3% | **47,9%** |    56/198 |

### MODUŁ 5 — Strona główna, archiwa, chrome ✅ · linie 97,43% · funkcje 94,35%

**Zamknięty 2026‑08‑19** — wdrożenie opisane w
`WDROZENIE_MODUL5_CHROME_ARCHIWA_TESTY_2026-08-18.md`. Liczby poniżej to stan PO; wartości
z audytu (18.08) zostawione w kolumnach „przed", żeby skala pracy była widoczna.

| Funkcjonalność                       | Plików | Linie przed |    Linie po | fn przed |       fn po |
| ------------------------------------ | -----: | ----------: | ----------: | -------: | ----------: |
| Nagłówek / stopka / menu             |     19 |        2,0% |  **97,87%** |    1/324 | **325/343** |
| Archiwa kategorii/tagów              |     19 |       17,5% | **100,00%** |     8/67 | **110/110** |
| Chrome mobilny (drawer, dolny pasek) |     11 |       44,3% |  **98,18%** |    23/56 |   **53/58** |
| Mega menu                            |      3 |       88,1% |  **88,70%** |    31/39 |   **46/55** |

Plików bez ani jednej wykonanej linii: **34 z 51 → 0 z 52**. Liczba plików rośnie, bo reguły
zostały wyprowadzone z organizmów do czystych modułów (`lib/menus/tree.ts`, `siteMenu.ts`,
`megaColumns.ts`, `lib/archive/bodyPlan.ts`), a pomiar objął cztery trasy archiwum.
Cała powierzchnia jest pod progami per‑ścieżka w `vitest.config.ts`.

### MODUŁ 6 — Wyszukiwarka · linie 97,38% · funkcje 95,22% ✅ ZAMKNIĘTY

Domknięty 2026-08-18 - `docs/WDROZENIE_WYSZUKIWARKA_TESTY_2026-08-18.md`. Zero plików na 0%
(było 16 z 24 w pomiarze pełnym audytu: 11). Moduł ma teraz własne progi per-ścieżka
w `vitest.config.ts`, których wcześniej nie miał wcale.

| Funkcjonalność                               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Wyszukiwarka: UI (overlay, filtry, zapisane) |     13 |        410 |  96,5% | 90,4% |   93,1% | **96,4%** |   161/173 |
| Wyszukiwarka: indeks i zapytania             |     10 |        500 |  96,6% | 88,5% |   98,1% | **98,2%** |   101/103 |
| Zapisane wyszukiwania i alerty (hook)        |      1 |         40 |   100% |  100% |    100% |  **100%** |     16/16 |

Przy okazji naprawiony defekt wyszukiwarki komend: fraza bez ogonków („platnosci") nie
znajdowała polskich etykiet („Płatności"), mimo że baza składa diakrytyki od dawna
(`unaccent` w `search_quick`). Rozstrzygnięta też anomalia z tego audytu -
`SearchAutosuggest.test.tsx` istniał, a komponent miał 0 z 19 funkcji: ten plik testowy nie
importował komponentu ani razu, jego asercje zasilały `facetModel.ts`.

### MODUŁ 7 — Typy treści specjalne · linie 16,47% → **100%** · funkcje 14,60% → **100%**

> **ZAKTUALIZOWANE 19.08.2026** (branch `claude/module-7-test-coverage-jbe28y`, PR #257). Liczby
> w tabeli poniżej to STAN Z AUDYTU, zachowany jako punkt odniesienia. Stan po pracy testowej i
> pełne uzasadnienie każdego przypadku: `docs/WDROZENIE_MODUL7_TESTY_2026-08-18.md`.
>
> Skrót: **moduł jest domknięty - 100% linii i 100% funkcji na wszystkich 67 plikach**
> (99,02% instrukcji, 93,13% gałęzi, 1 238 testów). Żadna funkcjonalność nie stoi na zerze i żaden
> plik nie ma zerowego pokrycia. Tura I zdjęła warstwę reguł, loaderów i serwerową (moduł na
> 70,83%); tura II domknęła sześć dużych plików interfejsu - `ExpertLayoutRenderer` (1134 linie),
> `ExpertLayoutInlineEditor` (565), `PolicyPositionsMap` (289), `SpeakerProfileDialog` (278),
> `ExpertMaterialsExplorer` (276), `QuizBackground` (180) - oraz trzy pliki-deklaracje server
> functions. Moduł ma 31 własnych progów per-ścieżka w `vitest.config.ts`.

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Biblioteka plików                |      5 |        229 |   0,0% |  0,0% |    0,0% |  **0,0%** |      0/72 |
| Web stories                      |      2 |         75 |  14,9% | 27,1% |   32,0% | **17,3%** |      8/25 |
| Huby ekspertów                   |     23 |        808 |  29,7% | 23,4% |   31,5% | **28,1%** |    79/251 |
| Tracker legislacyjny             |      9 |        235 |  32,5% | 29,0% |   30,5% | **31,1%** |     29/95 |
| Quiz / mapy                      |      5 |        251 |  50,5% | 29,0% |   43,5% | **51,0%** |     27/62 |
| Podcast                          |      4 |         78 |  60,0% | 41,6% |   31,3% | **56,4%** |     10/32 |
| Wydarzenia (RSVP, waitlist, ICS) |     15 |        208 |  60,1% | 49,4% |   62,7% | **60,6%** |     42/67 |
| Programy badawcze                |      4 |         31 |  87,9% | 86,2% |   92,9% | **87,1%** |     13/14 |

### MODUŁ 8 — SEO, feedy, dane strukturalne · linie 50,31% · funkcje 48,94%

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Feedy i sitemapy             |      8 |        130 |   0,7% |  0,0% |    0,0% |  **0,8%** |      0/24 |
| Monitor linków               |      2 |         18 |   4,8% |  0,0% |    0,0% |  **5,6%** |       0/8 |
| Udostępnianie / OG           |      4 |        209 |  23,5% | 20,2% |   16,4% | **24,4%** |     10/61 |
| SEO: meta, JSON-LD, hreflang |     44 |      1 263 |  71,7% | 66,5% |   80,1% | **72,9%** |   218/272 |

### MODUŁ 9 — Czat / komunikator · linie 61,96% · funkcje 57,56%

| Funkcjonalność                                  | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| ----------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Czat: okno rozmowy i atomy UI                   |     34 |      1 482 |  44,6% | 38,4% |   40,0% |  **45,5%** |   205/512 |
| Czat: kompozytor + wzmianki                     |     10 |        229 |  81,6% | 68,8% |   77,2% |  **84,3%** |     44/57 |
| Czat: warstwa danych (rozmowy, wiadomości)      |      3 |        374 |  92,3% | 83,3% |   95,6% |  **97,6%** |   130/136 |
| Czat: reguły wątku (kolejność, separator, skok) |      5 |        159 |  99,5% | 98,5% |   97,5% | **100,0%** |     39/40 |

### MODUŁ 10 — Sieć / networking · linie 81,68% · funkcje 80,79%

| Funkcjonalność                             | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ------------------------------------------ | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Sieć kontaktów (zaproszenia, obserwowanie) |     29 |        694 |  92,2% | 84,8% |   96,8% | **96,4%** |   244/252 |

### MODUŁ 11 — Newsletter i e-mail · linie 26,70% · funkcje 20,74%

> **STAN ZASTANY (2026-08-18).** Po domknięciu modułu 2026-08-19: **81,74% linii /
> 84,79% funkcji**. Tabela niżej jest punktem wyjścia - kolumna „po" per
> funkcjonalność stoi w `docs/WDROZENIE_NEWSLETTER_TESTY_MODUL_11_2026-08-19.md` §4.

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |      Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | ---------: | --------: |
| Newsletter: doręczalność (SPF/DKIM, bounces)       |      2 |         85 |   0,0% |  0,0% |    0,0% |   **0,0%** |      0/23 |
| POPUP: telemetria zdarzeń                          |      2 |         62 |   0,0% |  0,0% |    0,0% |   **0,0%** |      0/11 |
| Newsletter: panel admina                           |     37 |      1 484 |   1,3% |  1,2% |    0,5% |   **1,4%** |     3/644 |
| Newsletter: zapis + double opt-in + potwierdzenie  |      4 |        175 |  15,5% | 12,3% |   28,0% |  **14,3%** |      7/25 |
| Newsletter: kampanie i wysyłka                     |      3 |        380 |  16,2% |  7,7% |    7,1% |  **17,9%** |      5/70 |
| POPUP: host i wyświetlanie (reguły, częstotliwość) |      2 |        197 |  21,5% | 27,6% |   28,6% |  **19,8%** |     14/49 |
| POPUP: edytor popupu w adminie                     |     15 |        396 |  25,5% | 31,2% |   21,3% |  **26,0%** |    48/225 |
| Newsletter: wypis (unsubscribe)                    |      3 |        109 |  37,2% | 26,0% |   25,0% |  **38,5%** |      5/20 |
| Newsletter: builder maila (dokument + render HTML) |      8 |        423 |  37,6% | 26,2% |   40,2% |  **38,8%** |    41/102 |
| POPUP: panel zapisu (formularz + zgody)            |      3 |        199 |  43,5% | 42,5% |   47,6% |  **44,7%** |     20/42 |
| E-maile systemowe / transakcyjne                   |     38 |        991 |  54,9% | 39,9% |   49,4% |  **56,6%** |   124/251 |
| Newsletter: telemetria (open/click, engagement)    |      8 |        119 |  68,7% | 63,1% |   78,6% |  **68,1%** |     22/28 |
| POPUP: wygląd (design tokens popupu)               |      1 |         85 |  98,0% | 91,8% |  100,0% | **100,0%** |     27/27 |

### MODUŁ 12 — Realtime / powiadomienia / web-push · linie 44,12% · funkcje 41,02%

| Funkcjonalność              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Powiadomienia + web-push    |     16 |        878 |  37,5% | 23,7% |   27,7% | **39,7%** |    69/249 |
| Realtime (kanały, presence) |     10 |        268 |  58,2% | 40,6% |   72,4% | **61,6%** |    84/116 |

### MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · linie 32,71% · funkcje 26,68%

> **ZAMKNIĘTE 19.08.2026** — patrz `WDROZENIE_POKRYCIE_MONETYZACJI_MODUL_13_2026-08-19.md`.
> Moduł (bez plików tras) stoi teraz na **65,5% linii i 80,8% funkcji**; osiem defektów
> naprawionych, w tym odmowa operatora raportowana jako udana REZYGNACJA. Kolumny „po"
> niżej dotyczą powierzchni, które ta praca objęła.

| Funkcjonalność                              | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |      linie PO 19.08 |
| ------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: | ------------------: |
| Dołączenie do członkostwa (membership join) |      9 |         65 |   0,0% |  0,0% |    0,0% |  **0,0%** |      0/32 |           **96,9%** |
| Subskrypcje / plany / cennik                |     16 |        401 |  23,2% | 22,1% |   25,5% | **20,0%** |    39/153 |           **98,0%** |
| Billing: rekoncyliacja i panel              |    106 |      3 650 |  36,9% | 33,5% |   36,1% | **37,9%** |   276/765 | 95-98% (komponenty) |
| Checkout (Stripe) + intencja                |     15 |        200 |  62,1% | 55,3% |   58,2% | **65,0%** |     32/55 |           bez zmian |
| Webhook płatności                           |      1 |         37 |  68,4% | 63,3% |   40,0% | **67,6%** |       2/5 |           bez zmian |

### MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · linie 22,55% · funkcje 15,28%

| Funkcjonalność               | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Reklamy / sponsoring         |     15 |        432 |  30,5% | 39,0% |   29,1% | **29,6%** |    34/117 |
| Kupony                       |      7 |        111 |  36,1% | 21,2% |   44,0% | **37,8%** |     11/25 |
| Prezenty artykułów (gifting) |     10 |        221 |  50,8% | 52,6% |   45,8% | **53,4%** |     27/59 |
| Darowizny                    |      3 |        119 |  52,8% | 28,5% |   42,9% | **54,6%** |      9/21 |

### MODUŁ 15 — Profil i konto · linie 19,12% · funkcje 18,00%

| Funkcjonalność                                | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| LOGIN: reset hasła                            |      1 |         52 |   0,0% |  0,0% |    0,0% |  **0,0%** |      0/16 |
| LOGIN: portal logowania (hasło, magic link)   |      4 |        225 |   0,4% |  0,0% |    0,0% |  **0,4%** |      0/55 |
| LOGIN/LOGOUT: sesja i kontekst użytkownika    |      4 |        112 |   1,6% |  0,0% |    4,0% |  **1,8%** |      1/25 |
| LOGIN: MFA (2FA)                              |      2 |         44 |   2,0% |  5,9% |    7,1% |  **2,3%** |      1/14 |
| LOGIN: ustawienia logowania (admin)           |      3 |         80 |   2,4% |  0,0% |    0,0% |  **2,5%** |      0/51 |
| LOGIN: ochrona przed brute force              |      1 |         54 |  10,5% |  0,0% |    0,0% | **11,1%** |       0/9 |
| Retencja / onboarding                         |      8 |        180 |  11,0% |  3,6% |   15,8% | **12,2%** |      6/38 |
| Zainteresowania / personalizacja              |      7 |        647 |  23,1% | 23,6% |   10,2% | **25,3%** |    15/147 |
| Profil użytkownika                            |     33 |      1 338 |  29,6% | 29,6% |   30,0% | **30,6%** |   142/474 |
| Konto: dane, RODO, eksport                    |      3 |        118 |  34,2% | 16,1% |   20,6% | **33,9%** |      7/34 |
| REJESTRACJA: pola, walidacja, panel sukcesu   |      2 |         46 |  70,9% | 49,1% |   75,0% | **73,9%** |     12/16 |
| LOGIN: formularze auth w CMS (bloki + widget) |      3 |        363 |  85,9% | 66,7% |   83,5% | **88,7%** |     66/79 |

### MODUŁ 16 — Społeczność: kluby, komentarze, moderacja · linie 17,56% · funkcje 13,32%

| Funkcjonalność                                     | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| KLUBY: panel admina                                |     26 |      1 242 |   0,0% |  0,0% |    0,0% |  **0,0%** |     0/557 |
| KLUBY: trasy publiczne klubu                       |     20 |        707 |   0,0% |  0,0% |    0,0% |  **0,0%** |     0/261 |
| KLUBY: UI (atomy/molekuły/organizmy)               |    103 |      2 241 |   5,2% |  5,3% |    4,4% |  **5,0%** |    42/945 |
| Komentarze i moderacja                             |      6 |        239 |  18,9% | 10,5% |   14,7% | **17,2%** |     11/75 |
| KLUBY: zgłoszenia członkowskie (apply)             |      5 |        183 |  18,4% |  7,0% |   14,8% | **18,6%** |      9/61 |
| Społeczność: odznaki, zaangażowanie, Q&A, ankiety  |     20 |        548 |  21,2% | 27,7% |   15,4% | **21,4%** |    28/182 |
| KLUBY: API i zapytania (klub, posty, wątki)        |     10 |        594 |  21,3% | 17,9% |   37,9% | **24,6%** |    86/227 |
| KLUBY: dostęp i uprawnienia (gate, macierz, plany) |      7 |        145 |  46,5% | 36,8% |   41,5% | **42,8%** |     17/41 |
| KLUBY: tematy, specjalizacje, obszary polityk      |     10 |        166 |  49,8% | 31,7% |   38,3% | **51,8%** |     23/60 |
| KLUBY: wątki dyskusyjne (dynamika, puls, źródła)   |      8 |        256 |  73,1% | 66,1% |   49,5% | **72,3%** |     46/93 |

### MODUŁ 17 — Analityka i BI · linie 28,00% · funkcje 22,58%

| Funkcjonalność                          | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| --------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Analityka: zbieranie zdarzeń i liczniki |     20 |        705 |  13,6% | 13,7% |   16,2% | **14,2%** |    25/154 |
| Wykresy i panel BI                      |     41 |      1 501 |  23,2% | 18,6% |   18,2% | **24,5%** |    93/512 |
| Observability / RUM / web vitals        |     11 |        409 |  54,6% | 48,6% |   61,7% | **54,0%** |     37/60 |
| Analityka: warstwa semantyczna          |      7 |        239 |  70,4% | 60,2% |   69,4% | **71,5%** |     43/62 |

### MODUŁ 18† — CRM · ~~linie 12,04% · funkcje 9,30%~~ → linie 98,98% · funkcje 98,48%

> **Zamknięte 19.08.2026.** Rozbicie niżej to stan Z AUDYTU (18.08); kolumna
> „po” pokazuje pomiar na gałęzi domykającej. Opis pracy, znalezione defekty
> i progi bramek: `docs/WDROZENIE_CRM_POKRYCIE_TESTAMI_2026-08-19.md`.

| Funkcjonalność                        | Plików | LOC mierz. | Linie (18.08) | Linie (po) | fn 18.08 | fn (po) |
| ------------------------------------- | -----: | ---------: | ------------: | ---------: | -------: | ------: |
| CRM: UI panelu                        |     19 |        634 |      **3,6%** | **95,95%** |    9/302 | 279/289 |
| CRM: import/eksport CSV + organizacje |      6 |        352 |     **23,3%** | **99,36%** |    24/78 |   35/37 |
| CRM: kontakty, firmy, lejek, zadania  |     14 |        876 |     **26,5%** | **99,68%** |   60/195 | 414/415 |

Trzy wskazania z tego audytu zostały zamknięte imiennie: duplikat reguł filtra
i sortu leadów (jedno źródło prawdy + bramka parytetu SQL⇄JS), warstwa serwerowa
CRM (0% → 100% funkcji) oraz `autoMap`/`mapRows` importu CSV (czysty moduł, 100%,
z inwariantem „kolumny zgód nigdy nie są mapowane”).

### MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · linie 22,00% · funkcje 17,43%

| Funkcjonalność                           | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ---------------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Użytkownicy i role (admin)               |      2 |        105 |   0,0% |  0,0% |    0,0% |  **0,0%** |      0/28 |
| Ustawienia serwisu (panele)              |      5 |        111 |  30,0% | 10,4% |   21,2% | **30,6%** |     11/52 |
| Zgody / cookie banner / GPC / RODO       |     27 |        457 |  49,1% | 44,0% |   42,4% | **51,6%** |    64/151 |
| Integracje zewnętrzne                    |      3 |        181 |  56,6% | 58,7% |   50,0% | **56,4%** |     17/34 |
| Autoryzacja / macierz uprawnień (authz)  |     23 |        207 |  82,4% | 75,5% |   73,9% | **82,6%** |     65/88 |
| Multi-tenant (izolacja tenanta w kodzie) |      6 |        281 |  88,5% | 83,3% |   84,1% | **90,4%** |     58/69 |
| Feature flags                            |      3 |        163 |  92,8% | 84,0% |   97,2% | **96,9%** |     35/36 |

### MODUŁ 20 — Platforma / backend / infrastruktura / SSR · linie 52,72% · funkcje 40,16%

| Funkcjonalność                      | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| ----------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Routing / trasy publiczne (powłoka) |      6 |        385 |   1,4% |  1,9% |    3,3% |  **1,6%** |      3/92 |
| Warstwa serwerowa (server fns)      |     19 |        980 |  19,9% | 17,1% |   17,3% | **20,2%** |    38/220 |
| Klient Supabase / zapytania         |     26 |        909 |  24,7% | 15,8% |   22,3% | **27,8%** |    59/264 |
| A11y / watchdog / MCP               |      9 |        164 |  39,0% | 28,5% |   31,0% | **42,1%** |      9/29 |
| SSR / hydracja / cache brzegowy     |     31 |      1 144 |  73,8% | 72,6% |   70,1% | **74,4%** |   155/221 |
| Obsługa błędów / error boundary     |      7 |        115 |  76,4% | 67,9% |   62,1% | **75,7%** |     18/29 |
| Bramki CI (rejestry, kontrakty)     |     29 |      2 602 |  93,8% | 86,9% |   92,9% | **95,5%** |   442/476 |

### MODUŁ 21 — Rekrutacja / kariera · linie 55,12% · funkcje 47,13%

| Funkcjonalność                   | Plików | LOC mierz. | Instr. |  Gał. | Funkcje |     Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | -----: | ----: | ------: | --------: | --------: |
| Kariera: ogłoszenia i zgłoszenia |     26 |        576 |  80,1% | 80,2% |   73,2% | **81,3%** |   164/224 |

---

## 4. Zoom na powierzchnie wskazane w zleceniu

Dla pięciu obszarów wymienionych imiennie (newsletter, popup, CMS builder — Gutenberg i Elementor,
kluby dyskusyjne, login/rejestracja/wylogowanie) rozbicie schodzi do POJEDYNCZYCH FUNKCJI:
wypisuję nazwy funkcji, które nie mają ani jednego wywołania w całej suicie.

### 4.1 Newsletter (MODUŁ 11)

Razem: **962 / 3 766 linii = 25,54%**, funkcje **207/1163 = 17,80%**.

**Newsletter: doręczalność (SPF/DKIM, bounces)** — linie 0,0%, funkcje 0/23 (0,0%), plików 2 (bez pokrycia: 2), LOC 85

> Bez ani jednego wywołania: **23 funkcji** (9 nazwanych, 14 anonimowych domknięć). Nazwane:
>
> - `num @ src/lib/newsletter-deliverability.functions.ts:80`
> - `str @ src/lib/newsletter-deliverability.functions.ts:90`
> - `isRecord @ src/lib/newsletter-deliverability.functions.ts:95`
> - `records @ src/lib/newsletter-deliverability.functions.ts:99`
> - `reasonOf @ src/lib/newsletter-deliverability.functions.ts:113`
> - `scopeOf @ src/lib/newsletter-deliverability.functions.ts:119`
> - `json @ src/routes/api/public/webhooks.resend.ts:45`
> - `handle @ src/routes/api/public/webhooks.resend.ts:52`
> - `applyEvent @ src/routes/api/public/webhooks.resend.ts:92`

**Newsletter: panel admina** — linie 1,4%, funkcje 3/644 (0,5%), plików 37 (bez pokrycia: 35), LOC 1 484

> Bez ani jednego wywołania: **641 funkcji** (76 nazwanych, 565 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `CampaignBlockProperties @ src/components/admin/newsletter/CampaignBlockProperties.tsx:30`
> - `I18nField @ src/components/admin/newsletter/CampaignBlockProperties.tsx:143`
> - `TextField @ src/components/admin/newsletter/CampaignBlockProperties.tsx:180`
> - `SelectField @ src/components/admin/newsletter/CampaignBlockProperties.tsx:204`
> - `AlignField @ src/components/admin/newsletter/CampaignBlockProperties.tsx:234`
> - `ImageProps @ src/components/admin/newsletter/CampaignBlockProperties.tsx:256`
> - `PostListProps @ src/components/admin/newsletter/CampaignBlockProperties.tsx:315`
> - `ManualPostPicker @ src/components/admin/newsletter/CampaignBlockProperties.tsx:389`
> - `blockLabelKey @ src/components/admin/newsletter/CampaignContentBuilder.tsx:69`
> - `useDebouncedValue @ src/components/admin/newsletter/CampaignContentBuilder.tsx:74`
> - `CampaignContentBuilder @ src/components/admin/newsletter/CampaignContentBuilder.tsx:83`
> - `SortableBlockRow @ src/components/admin/newsletter/CampaignContentBuilder.tsx:240`
> - `CampaignPreview @ src/components/admin/newsletter/CampaignContentBuilder.tsx:305`
> - `NewsletterSubNav @ src/components/admin/newsletter/NewsletterSubNav.tsx:84`

**Newsletter: zapis + double opt-in + potwierdzenie** — linie 14,3%, funkcje 7/25 (28,0%), plików 4 (bez pokrycia: 1), LOC 175

> Bez ani jednego wywołania: **18 funkcji** (7 nazwanych, 11 anonimowych domknięć). Nazwane:
>
> - `esc @ src/lib/newsletter.functions.ts:53`
> - `hexToken @ src/lib/newsletter.functions.ts:60`
> - `originFromRequest @ src/lib/newsletter.functions.ts:71`
> - `sendEmail @ src/lib/newsletter.functions.ts:82`
> - `buildDoiEmail @ src/lib/newsletter.functions.ts:120`
> - `syncToCrm @ src/lib/newsletter.functions.ts:391`
> - `Page @ src/routes/newsletter.confirm.tsx:38`

**Newsletter: kampanie i wysyłka** — linie 17,9%, funkcje 5/70 (7,1%), plików 3 (bez pokrycia: 1), LOC 380

> Bez ani jednego wywołania: **65 funkcji** (15 nazwanych, 50 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `tickStatusOf @ src/lib/newsletter-admin.functions.ts:134`
> - `queueCount @ src/lib/newsletter-admin.functions.ts:138`
> - `minTierEmailSet @ src/lib/newsletter-campaigns.functions.ts:64`
> - `normalizeEmail @ src/lib/newsletter-campaigns.functions.ts:129`
> - `esc @ src/lib/newsletter-campaigns.functions.ts:185`
> - `originFromRequest @ src/lib/newsletter-campaigns.functions.ts:192`
> - `getTenantId @ src/lib/newsletter-campaigns.functions.ts:210`
> - `toCount @ src/lib/newsletter-campaigns.functions.ts:293`
> - `readEngagement @ src/lib/newsletter-campaigns.functions.ts:302`
> - `runCampaignSend @ src/lib/newsletter-campaigns.functions.ts:737`
> - `buildFrom @ src/lib/newsletter-campaigns.functions.ts:1026`
> - `renderCampaignHtml @ src/lib/newsletter-campaigns.functions.ts:1031`
> - `logRecipient @ src/lib/newsletter-campaigns.functions.ts:1110`
> - `splitList @ src/lib/newsletter-status.functions.ts:39`

**Newsletter: wypis (unsubscribe)** — linie 38,5%, funkcje 5/20 (25,0%), plików 3 (bez pokrycia: 2), LOC 109

> Bez ani jednego wywołania: **15 funkcji** (3 nazwanych, 12 anonimowych domknięć). Nazwane:
>
> - `Page @ src/routes/newsletter.unsubscribe.tsx:35`
> - `confirm @ src/routes/newsletter.unsubscribe.tsx:76`
> - `UnsubscribePage @ src/routes/unsubscribe.tsx:29`

**Newsletter: builder maila (dokument + render HTML)** — linie 38,8%, funkcje 41/102 (40,2%), plików 8 (bez pokrycia: 1), LOC 423

> Bez ani jednego wywołania: **61 funkcji** (14 nazwanych, 47 anonimowych domknięć). Nazwane:
>
> - `normalizePhone @ src/components/newsletter/NewsletterDocRenderer.tsx:63`
> - `normalizeLinkedin @ src/components/newsletter/NewsletterDocRenderer.tsx:70`
> - `useSubscriberCount @ src/components/newsletter/NewsletterDocRenderer.tsx:78`
> - `NewsletterDocRenderer @ src/components/newsletter/NewsletterDocRenderer.tsx:94`
> - `SectionRenderer @ src/components/newsletter/NewsletterDocRenderer.tsx:269`
> - `widgetErrorKey @ src/components/newsletter/NewsletterDocRenderer.tsx:405`
> - `RuntimeWidget @ src/components/newsletter/NewsletterDocRenderer.tsx:423`
> - `CouponWidgetView @ src/components/newsletter/NewsletterDocRenderer.tsx:710`
> - `FieldWrap @ src/components/newsletter/NewsletterDocRenderer.tsx:756`
> - `fetchForBlock @ src/lib/newsletter/emailDocResolve.ts:44`
> - `fetchEmailDocPostRows @ src/lib/newsletter/emailDocResolve.ts:99`
> - `libraryItemId @ src/lib/newsletter-builder/registry.ts:220`
> - `widgetLabel @ src/lib/newsletter-builder/registry.ts:224`
> - `widgetsForContext @ src/lib/newsletter-builder/registry.ts:231`

**E-maile systemowe / transakcyjne** — linie 56,6%, funkcje 124/251 (49,4%), plików 38 (bez pokrycia: 9), LOC 991

> Bez ani jednego wywołania: **127 funkcji** (53 nazwanych, 74 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `isRecord @ src/lib/email/auth-events.server.ts:62`
> - `str @ src/lib/email/auth-events.server.ts:66`
> - `statusOf @ src/lib/email/auth-events.server.ts:71`
> - `mapRow @ src/lib/email/auth-events.server.ts:75`
> - `emptyReport @ src/lib/email/auth-events.server.ts:100`
> - `tally @ src/lib/email/auth-events.server.ts:113`
> - `fetchAuthEmailEvents @ src/lib/email/auth-events.server.ts:124`
> - `forwardToPlatformRoute @ src/lib/email/platformCompat.server.ts:22`
> - `resendConfigured @ src/lib/email/provider.server.ts:69`
> - `platformMailerConfigured @ src/lib/email/provider.server.ts:73`
> - `emailProviderConfigured @ src/lib/email/provider.server.ts:78`
> - `retryAfterFromHeaders @ src/lib/email/provider.server.ts:82`
> - `readMessageId @ src/lib/email/provider.server.ts:96`
> - `extraHeaders @ src/lib/email/provider.server.ts:109`

**Newsletter: telemetria (open/click, engagement)** — linie 68,1%, funkcje 22/28 (78,6%), plików 8 (bez pokrycia: 3), LOC 119

> Bez ani jednego wywołania: **6 funkcji** (3 nazwanych, 3 anonimowych domknięć). Nazwane:
>
> - `newsletterPopupSessionId @ src/lib/newsletter/popupTelemetry.ts:14`
> - `trackNewsletterPopupEvent @ src/lib/newsletter/popupTelemetry.ts:40`
> - `pixel @ src/routes/api/public/nl-open.ts:22`

### 4.2 Popup zapisu (MODUŁ 11, wydzielony)

Razem: **316 / 939 linii = 33,65%**, funkcje **109/354 = 30,79%**.

**POPUP: telemetria zdarzeń** — linie 0,0%, funkcje 0/11 (0,0%), plików 2 (bez pokrycia: 2), LOC 62

> Bez ani jednego wywołania: **11 funkcji** (3 nazwanych, 8 anonimowych domknięć). Nazwane:
>
> - `emptyCounts @ src/lib/newsletter-popup-events.functions.ts:97`
> - `isEventName @ src/lib/newsletter-popup-events.functions.ts:101`
> - `noContent @ src/routes/api/public/popup-event.ts:16`

**POPUP: host i wyświetlanie (reguły, częstotliwość)** — linie 19,8%, funkcje 14/49 (28,6%), plików 2 (bez pokrycia: 1), LOC 197

> Bez ani jednego wywołania: **35 funkcji** (5 nazwanych, 30 anonimowych domknięć). Nazwane:
>
> - `viewportDevice @ src/components/popups/PopupHost.tsx:34`
> - `PopupHost @ src/components/popups/PopupHost.tsx:41`
> - `useActivePopups @ src/lib/builder/popups.ts:201`
> - `usePopupsAdmin @ src/lib/builder/popups.ts:220`
> - `usePopupEditor @ src/lib/builder/popups.ts:327`

**POPUP: edytor popupu w adminie** — linie 26,0%, funkcje 48/225 (21,3%), plików 15 (bez pokrycia: 7), LOC 396

> Bez ani jednego wywołania: **177 funkcji** (9 nazwanych, 168 anonimowych domknięć). Nazwane:
>
> - `PopupEditorPane @ src/components/admin/popups/PopupEditorPane.tsx:28`
> - `PopupSettingsPane @ src/components/admin/popups/PopupSettingsPane.tsx:36`
> - `SignupPopupContentSection @ src/components/admin/popups/SignupPopupContentSection.tsx:20`
> - `ConsentsTab @ src/components/admin/popups/signup/ConsentsTab.tsx:9`
> - `PopupEditorRoute @ src/routes/admin.popups.$id.tsx:8`
> - `PopupsLayout @ src/routes/admin.popups.tsx:44`
> - `triggerSummary @ src/routes/admin.popups.tsx:50`
> - `SignupPopupRow @ src/routes/admin.popups.tsx:69`
> - `PopupsList @ src/routes/admin.popups.tsx:131`

**POPUP: panel zapisu (formularz + zgody)** — linie 44,7%, funkcje 20/42 (47,6%), plików 3 (bez pokrycia: 0), LOC 199

> Bez ani jednego wywołania: **22 funkcji** (0 nazwanych, 22 anonimowych domknięć).

**POPUP: wygląd (design tokens popupu)** — linie 100,0%, funkcje 27/27 (100,0%), plików 1 (bez pokrycia: 0), LOC 85

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

### 4.3 CMS builder — bloki (Gutenberg) i widgety (Elementor) (MODUŁ 3)

Razem: **6 590 / 14 492 linii = 45,47%**, funkcje **1494/4592 = 32,53%**.

**CMS: panele właściwości widgetów** — linie 13,6%, funkcje 166/2077 (8,0%), plików 112 (bez pokrycia: 74), LOC 4 687

> Bez ani jednego wywołania: **1911 funkcji** (147 nazwanych, 1764 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `Builder @ src/components/admin/builder/Builder.tsx:78`
> - `WidgetProperties @ src/components/admin/builder/WidgetProperties.tsx:124`
> - `readDesktopHeight @ src/components/admin/builder/WidgetProperties.tsx:1094`
> - `writeDesktopHeight @ src/components/admin/builder/WidgetProperties.tsx:1100`
> - `WidgetHeightControl @ src/components/admin/builder/WidgetProperties.tsx:1113`
> - `ThemedColorField @ src/components/admin/builder/WidgetProperties.tsx:1242`
> - `FormElementSizeField @ src/components/admin/builder/WidgetProperties.tsx:1295`
> - `useEffectiveSizes @ src/components/admin/builder/WidgetProperties.tsx:1380`
> - `useInheritedColors @ src/components/admin/builder/WidgetProperties.tsx:1403`
> - `WidgetContentFields @ src/components/admin/builder/WidgetProperties.tsx:1449`
> - `unhandledSchemaFields @ src/components/admin/builder/WidgetProperties.tsx:1644`
> - `customContentEditor @ src/components/admin/builder/WidgetProperties.tsx:1654`
> - `AdSlotEditor @ src/components/admin/builder/WidgetProperties.tsx:1726`
> - `GlobalWidgetBanner @ src/components/admin/builder/WidgetProperties.tsx:1779`

**CMS: builder sidebara + wzorce** — linie 29,5%, funkcje 21/119 (17,6%), plików 6 (bez pokrycia: 3), LOC 224

> Bez ani jednego wywołania: **98 funkcji** (19 nazwanych, 79 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `defaultSettingsFor @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:113`
> - `newWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:118`
> - `SidebarBuilderPane @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:127`
> - `patchDraft @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:210`
> - `addWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:214`
> - `moveWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:221`
> - `deleteWidget @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:233`
> - `toggleHidden @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:238`
> - `updateSettings @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:245`
> - `IconBtn @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:512`
> - `ReadingPanelSettingsForm @ src/components/admin/sidebarBuilder/SidebarBuilderPane.tsx:541`
> - `PatternPicker @ src/components/patterns/PatternPicker.tsx:58`
> - `SelectedPanel @ src/components/patterns/PatternPicker.tsx:145`
> - `PagePanel @ src/components/patterns/PatternPicker.tsx:160`

**CMS: design tokens / kolory globalne / typografia** — linie 32,3%, funkcje 10/39 (25,6%), plików 6 (bez pokrycia: 0), LOC 251

> Bez ani jednego wywołania: **29 funkcji** (13 nazwanych, 16 anonimowych domknięć). Nazwane:
>
> - `fetchSiteDesignTokensRow @ src/lib/builder/designTokens.ts:78`
> - `useDesignTokens @ src/lib/builder/designTokens.ts:122`
> - `useSaveDesignTokens @ src/lib/builder/designTokens.ts:127`
> - `tokensToCss @ src/lib/builder/designTokens.ts:163`
> - `isSlotHoverable @ src/lib/builder/globalColors.ts:790`
> - `globalColorsToCss @ src/lib/builder/globalColors.ts:816`
> - `pickFontSize @ src/lib/builder/hoverCss.ts:7`
> - `isRecord @ src/lib/builder/liveTypography.ts:15`
> - `normalizePayload @ src/lib/builder/liveTypography.ts:19`
> - `styleElementId @ src/lib/builder/liveTypography.ts:35`
> - `applyLiveTypographyStyle @ src/lib/builder/liveTypography.ts:39`
> - `broadcastWidgetTypography @ src/lib/builder/liveTypography.ts:57`
> - `clearAllLiveWidgetTypography @ src/lib/builder/liveTypography.ts:95`

**CMS: render bloków (publiczny)** — linie 39,0%, funkcje 114/516 (22,1%), plików 39 (bez pokrycia: 16), LOC 1 909

> Bez ani jednego wywołania: **402 funkcji** (81 nazwanych, 321 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `AffiliateBlockView @ src/components/blocks/AffiliateBlockView.tsx:18`
> - `CalendarView @ src/components/blocks/CalendarView.tsx:16`
> - `CodeBlockView @ src/components/blocks/CodeBlockView.tsx:19`
> - `CompareSlider @ src/components/blocks/CompareSlider.tsx:11`
> - `onSubmit @ src/components/blocks/ContactFormView.tsx:278`
> - `formatDate @ src/components/blocks/ContextBlockViews.tsx:13`
> - `PostTitleView @ src/components/blocks/ContextBlockViews.tsx:30`
> - `PostDateView @ src/components/blocks/ContextBlockViews.tsx:39`
> - `PostAuthorView @ src/components/blocks/ContextBlockViews.tsx:60`
> - `PostExcerptView @ src/components/blocks/ContextBlockViews.tsx:103`
> - `PostFeaturedImageView @ src/components/blocks/ContextBlockViews.tsx:132`
> - `PostTermsView @ src/components/blocks/ContextBlockViews.tsx:160`
> - `SiteTitleView @ src/components/blocks/ContextBlockViews.tsx:187`
> - `SiteTaglineView @ src/components/blocks/ContextBlockViews.tsx:201`

**CMS: import z Gutenberga / WordPressa** — linie 49,4%, funkcje 134/250 (53,6%), plików 10 (bez pokrycia: 3), LOC 1 309

> Bez ani jednego wywołania: **116 funkcji** (53 nazwanych, 63 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `captureWpRedirect @ src/lib/wordpress-import.functions.ts:51`
> - `authHeaders @ src/lib/wordpress-import.functions.ts:96`
> - `wpFetch @ src/lib/wordpress-import.functions.ts:111`
> - `slugify @ src/lib/wordpress-import.functions.ts:126`
> - `resolveTenant @ src/lib/wordpress-import.functions.ts:136`
> - `resolveBlogPage @ src/lib/wordpress-import.functions.ts:146`
> - `ensureUniqueSlug @ src/lib/wordpress-import.functions.ts:176`
> - `decodeEntities @ src/lib/wordpress-import.functions.ts:232`
> - `stripTags @ src/lib/wordpress-import.functions.ts:245`
> - `mapStatus @ src/lib/wordpress-import.functions.ts:250`
> - `isLikelyWpMediaUrl @ src/lib/wordpress-import.functions.ts:260`
> - `extName @ src/lib/wordpress-import.functions.ts:272`
> - `sha256Hex @ src/lib/wordpress-import.functions.ts:284`
> - `createMediaImporter @ src/lib/wordpress-import.functions.ts:296`

**CMS: silnik bloków (typ Gutenberg) — rdzeń** — linie 63,1%, funkcje 64/147 (43,5%), plików 9 (bez pokrycia: 0), LOC 358

> Bez ani jednego wywołania: **83 funkcji** (1 nazwanych, 82 anonimowych domknięć). Nazwane:
>
> - `getBlockVariants @ src/lib/blocks/variants.ts:40`

**CMS: widgety buildera — render publiczny** — linie 68,8%, funkcje 511/787 (64,9%), plików 51 (bez pokrycia: 10), LOC 3 589

> Bez ani jednego wywołania: **276 funkcji** (53 nazwanych, 223 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `resolveSpan @ src/components/builder/organisms/BuilderRenderer.tsx:82`
> - `resolveOrder @ src/components/builder/organisms/BuilderRenderer.tsx:92`
> - `BuilderEmptyPickerProvider @ src/components/builder/organisms/BuilderRenderer.tsx:137`
> - `deviceForWidth @ src/components/builder/organisms/BuilderRenderer.tsx:154`
> - `BuilderRenderer @ src/components/builder/organisms/BuilderRenderer.tsx:174`
> - `BuilderDebugOverlay @ src/components/builder/organisms/BuilderRenderer.tsx:255`
> - `SectionsList2 @ src/components/builder/organisms/BuilderRenderer.tsx:305`
> - `ExperimentSection @ src/components/builder/organisms/BuilderRenderer.tsx:375`
> - `SectionBackgroundVideo @ src/components/builder/organisms/BuilderRenderer.tsx:410`
> - `RenderSection2 @ src/components/builder/organisms/BuilderRenderer.tsx:453`
> - `RenderInner2 @ src/components/builder/organisms/BuilderRenderer.tsx:677`
> - `RenderColumn2 @ src/components/builder/organisms/BuilderRenderer.tsx:741`
> - `shallowEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:32`
> - `widgetsEqual @ src/components/builder/organisms/BuilderWidgetNode.tsx:46`

**CMS: page builder (typ Elementor) — schemat i operacje** — linie 71,8%, funkcje 166/294 (56,5%), plików 11 (bez pokrycia: 1), LOC 649

> Bez ani jednego wywołania: **128 funkcji** (8 nazwanych, 120 anonimowych domknięć). Nazwane:
>
> - `copyToClipboard @ src/lib/builder/clipboard.ts:14`
> - `readClipboard @ src/lib/builder/clipboard.ts:22`
> - `cloneInner @ src/lib/builder/operations.ts:49`
> - `addSectionToContainer @ src/lib/builder/operations.ts:221`
> - `insertSectionNode @ src/lib/builder/operations.ts:232`
> - `insertContainerAt @ src/lib/builder/operations.ts:236`
> - `useBuilderRevisions @ src/lib/builder/revisions.ts:53`
> - `useRestoreBuilderRevision @ src/lib/builder/revisions.ts:72`

**CMS: zapytania danych widgetów** — linie 75,6%, funkcje 112/140 (80,0%), plików 8 (bez pokrycia: 1), LOC 459

> Bez ani jednego wywołania: **28 funkcji** (9 nazwanych, 19 anonimowych domknięć). Nazwane:
>
> - `clubCardQueryOptions @ src/lib/builder/clubsQuery.ts:50`
> - `clubThreadsQueryOptions @ src/lib/builder/clubsQuery.ts:85`
> - `bookMeetingSlot @ src/lib/builder/meetingsQuery.ts:128`
> - `cancelMyMeetingBooking @ src/lib/builder/meetingsQuery.ts:136`
> - `createMyMeetingSlot @ src/lib/builder/meetingsQuery.ts:148`
> - `deleteMyMeetingSlot @ src/lib/builder/meetingsQuery.ts:158`
> - `fetchPopularPostIds @ src/lib/builder/postListQuery.ts:282`
> - `clubWidgetSlug @ src/lib/builder/prefetch.ts:119`
> - `clubThreadsInput @ src/lib/builder/prefetch.ts:125`

**CMS: silnik treści publicznej (contentEngine)** — linie 78,4%, funkcje 92/114 (80,7%), plików 19 (bez pokrycia: 4), LOC 514

> Bez ani jednego wywołania: **22 funkcji** (3 nazwanych, 19 anonimowych domknięć). Nazwane:
>
> - `sha256Hex @ src/lib/content/feedback.functions.ts:9`
> - `generateToken @ src/lib/content/previewTokens.functions.ts:14`
> - `normalizeSlugInput @ src/lib/content/taxonomySlug.ts:24`

**CMS: edycja bloków (selekcja, focus, schowek, undo)** — linie 89,4%, funkcje 45/45 (100,0%), plików 6 (bez pokrycia: 0), LOC 236

> Wszystkie funkcje tej powierzchni mają co najmniej jedno wywołanie.

**CMS: sanityzacja HTML** — linie 90,4%, funkcje 28/32 (87,5%), plików 3 (bez pokrycia: 0), LOC 157

> Bez ani jednego wywołania: **4 funkcji** (0 nazwanych, 4 anonimowych domknięć).

**CMS: warstwa content-model (rozdział bloki⇄builder)** — linie 98,0%, funkcje 31/32 (96,9%), plików 7 (bez pokrycia: 0), LOC 150

> Bez ani jednego wywołania: **1 funkcji** (0 nazwanych, 1 anonimowych domknięć).

### 4.4 Kluby dyskusyjne (MODUŁ 16)

Razem: **626 / 5 534 linii = 11,31%**, funkcje **223/2245 = 9,93%**.

**KLUBY: panel admina** — linie 0,0%, funkcje 0/557 (0,0%), plików 26 (bez pokrycia: 26), LOC 1 242

> Bez ani jednego wywołania: **557 funkcji** (81 nazwanych, 476 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `ToneBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:29`
> - `ClubStatusBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:43`
> - `ClubGroupStatusBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:56`
> - `ClubVisibilityBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:70`
> - `ClubMemberStatusBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:85`
> - `ClubRoleBadge @ src/components/admin/clubs/atoms/ClubBadges.tsx:99`
> - `InheritedField @ src/components/admin/clubs/atoms/InheritedField.tsx:25`
> - `Bar @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:18`
> - `ListPreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:27`
> - `CardsPreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:40`
> - `MagazinePreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:54`
> - `EditorialPreview @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:73`
> - `ClubLayoutPicker @ src/components/admin/clubs/molecules/ClubLayoutPicker.tsx:104`
> - `ClubAccessTab @ src/components/admin/clubs/organisms/ClubAccessTab.tsx:47`

**KLUBY: trasy publiczne klubu** — linie 0,0%, funkcje 0/261 (0,0%), plików 20 (bez pokrycia: 20), LOC 707

> Bez ani jednego wywołania: **261 funkcji** (24 nazwanych, 237 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `ClubAbout @ src/routes/club.$clubSlug.about.tsx:50`
> - `ClubBoardRoute @ src/routes/club.$clubSlug.board.tsx:38`
> - `ClubCalendarRoute @ src/routes/club.$clubSlug.calendar.tsx:33`
> - `ClubDocumentsRoute @ src/routes/club.$clubSlug.documents.tsx:35`
> - `ClubMeetingRoute @ src/routes/club.$clubSlug.e.$eventSlug.tsx:40`
> - `ClubExpertsRoute @ src/routes/club.$clubSlug.experts.tsx:37`
> - `ClubHubRoute @ src/routes/club.$clubSlug.index.tsx:65`
> - `ClubInsightsRoute @ src/routes/club.$clubSlug.insights.tsx:37`
> - `asRole @ src/routes/club.$clubSlug.members.tsx:54`
> - `ClubMembersRoute @ src/routes/club.$clubSlug.members.tsx:79`
> - `ClubMinisiteRoute @ src/routes/club.$clubSlug.minisite.tsx:43`
> - `ClubNewThread @ src/routes/club.$clubSlug.new.tsx:102`
> - `ClubScheduleRoute @ src/routes/club.$clubSlug.schedule.tsx:33`
> - `ClubSpotlightRoute @ src/routes/club.$clubSlug.spotlight.tsx:33`

**KLUBY: UI (atomy/molekuły/organizmy)** — linie 5,0%, funkcje 42/945 (4,4%), plików 103 (bez pokrycia: 88), LOC 2 241

> Bez ani jednego wywołania: **903 funkcji** (224 nazwanych, 679 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `initials @ src/components/clubs/atoms/ClubAuthorAvatar.tsx:16`
> - `ClubAuthorAvatar @ src/components/clubs/atoms/ClubAuthorAvatar.tsx:28`
> - `ClubCover @ src/components/clubs/atoms/ClubCover.tsx:22`
> - `clubThreadTone @ src/components/clubs/atoms/ClubDossierRow.tsx:110`
> - `clubDossierSpineClass @ src/components/clubs/atoms/ClubDossierRow.tsx:131`
> - `clubDossierToneColor @ src/components/clubs/atoms/ClubDossierRow.tsx:136`
> - `clubDossierIconBoxClass @ src/components/clubs/atoms/ClubDossierRow.tsx:141`
> - `ClubDossierKind @ src/components/clubs/atoms/ClubDossierRow.tsx:151`
> - `ClubDocumentIcon @ src/components/clubs/atoms/ClubEntryIcon.tsx:54`
> - `ClubMilestoneIcon @ src/components/clubs/atoms/ClubEntryIcon.tsx:65`
> - `ClubSectionIcon @ src/components/clubs/atoms/ClubEntryIcon.tsx:76`
> - `clubGroupAccentVars @ src/components/clubs/atoms/ClubGroupAccent.tsx:19`
> - `ClubGroupIcon @ src/components/clubs/atoms/ClubGroupAccent.tsx:59`
> - `ClubHubAccessBadge @ src/components/clubs/atoms/ClubHubAccessBadge.tsx:19`

**KLUBY: zgłoszenia członkowskie (apply)** — linie 18,6%, funkcje 9/61 (14,8%), plików 5 (bez pokrycia: 3), LOC 183

> Bez ani jednego wywołania: **52 funkcji** (3 nazwanych, 49 anonimowych domknięć). Nazwane:
>
> - `buildClubApplyHead @ src/lib/clubs/applyHead.ts:64`
> - `GateCard @ src/routes/club.apply.tsx:82`
> - `ClubApplyPage @ src/routes/club.apply.tsx:114`

**KLUBY: API i zapytania (klub, posty, wątki)** — linie 24,6%, funkcje 86/227 (37,9%), plików 10 (bez pokrycia: 6), LOC 594

> Bez ani jednego wywołania: **141 funkcji** (134 nazwanych, 7 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `toJsonPayload @ src/lib/clubs/api.ts:86`
> - `fetchClubList @ src/lib/clubs/api.ts:105`
> - `fetchClubBySlug @ src/lib/clubs/api.ts:119`
> - `fetchClubGroups @ src/lib/clubs/api.ts:125`
> - `fetchMyClubMemberships @ src/lib/clubs/api.ts:131`
> - `fetchClubMembers @ src/lib/clubs/api.ts:142`
> - `fetchAdminClubs @ src/lib/clubs/api.ts:179`
> - `upsertClub @ src/lib/clubs/api.ts:194`
> - `checkClubSlugAvailable @ src/lib/clubs/api.ts:208`
> - `upsertClubGroup @ src/lib/clubs/api.ts:220`
> - `reorderClubGroups @ src/lib/clubs/api.ts:229`
> - `setClubMemberRole @ src/lib/clubs/api.ts:250`
> - `previewClubSegment @ src/lib/clubs/api.ts:273`
> - `inviteClubSegment @ src/lib/clubs/api.ts:292`

**KLUBY: dostęp i uprawnienia (gate, macierz, plany)** — linie 42,8%, funkcje 17/41 (41,5%), plików 7 (bez pokrycia: 1), LOC 145

> Bez ani jednego wywołania: **24 funkcji** (4 nazwanych, 20 anonimowych domknięć). Nazwane:
>
> - `ClubAccessGate @ src/components/clubs/organisms/ClubAccessGate.tsx:58`
> - `Benefit @ src/components/clubs/organisms/ClubAccessGate.tsx:150`
> - `MemberActions @ src/components/clubs/organisms/ClubAccessGate.tsx:169`
> - `GateSignupForm @ src/components/clubs/organisms/ClubAccessGate.tsx:232`

**KLUBY: tematy, specjalizacje, obszary polityk** — linie 51,8%, funkcje 23/60 (38,3%), plików 10 (bez pokrycia: 3), LOC 166

> Bez ani jednego wywołania: **37 funkcji** (25 nazwanych, 12 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `isClubTopic @ src/lib/clubs/policyAreas.ts:23`
> - `normalizeClubTopic @ src/lib/clubs/policyAreas.ts:28`
> - `clubTopicLabel @ src/lib/clubs/policyAreas.ts:33`
> - `buildSpecializationHead @ src/lib/clubs/specializationHead.ts:148`
> - `resolveSpecializationIcon @ src/lib/clubs/specializations.ts:71`
> - `pick @ src/lib/clubs/specializations.ts:104`
> - `pickSpecText @ src/lib/clubs/specializations.ts:124`
> - `buildSpecializationViews @ src/lib/clubs/specializations.ts:138`
> - `fallbackSpecializationSources @ src/lib/clubs/specializations.ts:167`
> - `fetchPublicClubSpecializations @ src/lib/clubs/specializationsApi.ts:32`
> - `fetchClubsBySpecialization @ src/lib/clubs/specializationsApi.ts:55`
> - `fetchAdminClubSpecializations @ src/lib/clubs/specializationsApi.ts:69`
> - `upsertClubSpecialization @ src/lib/clubs/specializationsApi.ts:105`
> - `setClubSpecializationActive @ src/lib/clubs/specializationsApi.ts:128`

**KLUBY: wątki dyskusyjne (dynamika, puls, źródła)** — linie 72,3%, funkcje 46/93 (49,5%), plików 8 (bez pokrycia: 1), LOC 256

> Bez ani jednego wywołania: **47 funkcji** (22 nazwanych, 25 anonimowych domknięć). Nazwane, pierwsze 14:
>
> - `normalizeClubThreadIcon @ src/lib/clubs/threadIcons.ts:91`
> - `invalidateThread @ src/lib/clubs/useThreadWorkspace.ts:55`
> - `useClubThreadWorkspace @ src/lib/clubs/useThreadWorkspace.ts:68`
> - `useClubThreadDocuments @ src/lib/clubs/useThreadWorkspace.ts:83`
> - `useUpsertClubThreadDocument @ src/lib/clubs/useThreadWorkspace.ts:98`
> - `useRemoveClubThreadDocument @ src/lib/clubs/useThreadWorkspace.ts:108`
> - `useClubThreadMilestones @ src/lib/clubs/useThreadWorkspace.ts:122`
> - `useUpsertClubThreadMilestone @ src/lib/clubs/useThreadWorkspace.ts:137`
> - `useRemoveClubThreadMilestone @ src/lib/clubs/useThreadWorkspace.ts:147`
> - `useClubThreadQuestions @ src/lib/clubs/useThreadWorkspace.ts:161`
> - `useAskClubThreadQuestion @ src/lib/clubs/useThreadWorkspace.ts:176`
> - `useAnswerClubThreadQuestion @ src/lib/clubs/useThreadWorkspace.ts:187`
> - `useVoteClubThreadQuestion @ src/lib/clubs/useThreadWorkspace.ts:197`
> - `useClubThreadPolls @ src/lib/clubs/useThreadWorkspace.ts:211`

### 4.5 Login / rejestracja / wylogowanie (MODUŁ 15)

Razem: **368 / 976 linii = 37,70%**, funkcje **80/265 = 30,19%**.

**LOGIN: reset hasła** — linie 0,0%, funkcje 0/16 (0,0%), plików 1 (bez pokrycia: 1), LOC 52

> Bez ani jednego wywołania: **16 funkcji** (1 nazwanych, 15 anonimowych domknięć). Nazwane:
>
> - `ResetPasswordPage @ src/routes/reset-password.tsx:51`

**LOGIN: portal logowania (hasło, magic link)** — linie 0,4%, funkcje 0/55 (0,0%), plików 4 (bez pokrycia: 3), LOC 225

> Bez ani jednego wywołania: **55 funkcji** (7 nazwanych, 48 anonimowych domknięć). Nazwane:
>
> - `LoginPopup @ src/components/LoginPopup.tsx:28`
> - `AuthPortal @ src/components/auth/AuthPortal.tsx:37`
> - `RailButton @ src/components/auth/AuthPortal.tsx:640`
> - `Field @ src/components/auth/AuthPortal.tsx:669`
> - `openLoginPopup @ src/lib/loginPopupBus.ts:13`
> - `onOpenLoginPopup @ src/lib/loginPopupBus.ts:19`
> - `LoginPage @ src/routes/login.tsx:32`

**LOGIN/LOGOUT: sesja i kontekst użytkownika** — linie 1,8%, funkcje 1/25 (4,0%), plików 4 (bez pokrycia: 3), LOC 112

> Bez ani jednego wywołania: **24 funkcji** (8 nazwanych, 16 anonimowych domknięć). Nazwane:
>
> - `AuthProvider @ src/hooks/useAuth.tsx:35`
> - `useRequiredTenant @ src/hooks/useAuth.tsx:200`
> - `useAuthSettings @ src/hooks/useAuthSettings.ts:7`
> - `useSaveAuthSettings @ src/hooks/useAuthSettings.ts:22`
> - `currentUserFromSession @ src/lib/auth/currentUser.ts:16`
> - `currentUserIdFromSession @ src/lib/auth/currentUser.ts:21`
> - `anonClient @ src/lib/auth/optionalUser.server.ts:19`
> - `optionalUserIdFromRequest @ src/lib/auth/optionalUser.server.ts:32`

**LOGIN: MFA (2FA)** — linie 2,3%, funkcje 1/14 (7,1%), plików 2 (bez pokrycia: 1), LOC 44

> Bez ani jednego wywołania: **13 funkcji** (4 nazwanych, 9 anonimowych domknięć). Nazwane:
>
> - `MfaChallenge @ src/components/auth/MfaChallenge.tsx:27`
> - `isMfaChallengeRequired @ src/lib/auth/mfa.ts:7`
> - `getVerifiedTotpFactorId @ src/lib/auth/mfa.ts:14`
> - `verifyTotpCode @ src/lib/auth/mfa.ts:26`

**LOGIN: ustawienia logowania (admin)** — linie 2,5%, funkcje 0/51 (0,0%), plików 3 (bez pokrycia: 2), LOC 80

> Bez ani jednego wywołania: **51 funkcji** (6 nazwanych, 45 anonimowych domknięć). Nazwane:
>
> - `useAuthSettings @ src/hooks/useAuthSettings.ts:7`
> - `useSaveAuthSettings @ src/hooks/useAuthSettings.ts:22`
> - `LoginSettingsPage @ src/routes/admin.login-settings.tsx:26`
> - `ImageField @ src/routes/admin.login-settings.tsx:374`
> - `Card @ src/routes/admin.login-settings.tsx:472`
> - `BiField @ src/routes/admin.login-settings.tsx:492`

**LOGIN: ochrona przed brute force** — linie 11,1%, funkcje 0/9 (0,0%), plików 1 (bez pokrycia: 0), LOC 54

> Bez ani jednego wywołania: **9 funkcji** (3 nazwanych, 6 anonimowych domknięć). Nazwane:
>
> - `hashSubject @ src/lib/auth/bruteforce.functions.ts:23`
> - `currentIpHash @ src/lib/auth/bruteforce.functions.ts:27`
> - `hitBucket @ src/lib/auth/bruteforce.functions.ts:47`

**REJESTRACJA: pola, walidacja, panel sukcesu** — linie 73,9%, funkcje 12/16 (75,0%), plików 2 (bez pokrycia: 1), LOC 46

> Bez ani jednego wywołania: **4 funkcji** (1 nazwanych, 3 anonimowych domknięć). Nazwane:
>
> - `SignupSuccessPanel @ src/components/auth/SignupSuccessPanel.tsx:22`

**LOGIN: formularze auth w CMS (bloki + widget)** — linie 88,7%, funkcje 66/79 (83,5%), plików 3 (bez pokrycia: 1), LOC 363

> Bez ani jednego wywołania: **13 funkcji** (1 nazwanych, 12 anonimowych domknięć). Nazwane:
>
> - `AuthFormWidget @ src/components/builder/organisms/widget-view/AuthFormWidget.tsx:12`

---

## 5. Zera: gdzie test nie dotarł wcale

### 5.1 Największe pliki produkcyjne z pokryciem 0%

| Plik                                                                 | LOC mierzone | Moduł                                              |
| -------------------------------------------------------------------- | -----------: | -------------------------------------------------- |
| `src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx` |          377 | M3                                                 |
| `src/routes/admin.pricing.tsx`                                       |          359 | M13                                                |
| `src/components/admin/builder/WidgetProperties.tsx`                  |          350 | M3                                                 |
| `src/routes/admin.podcasts.tsx`                                      |          337 | M7                                                 |
| `src/components/admin/menu/MenuManager.tsx`                          |          332 | M5                                                 |
| `src/routes/admin.crm.index.tsx`                                     |          303 | M18                                                |
| `src/routes/admin.names.tsx`                                         |          296 | M19                                                |
| `src/lib/crm.functions.ts`                                           |          282 | M18                                                |
| `src/lib/wordpress-import.functions.ts`                              |          280 | M3                                                 |
| `src/routes/admin.users.index.tsx`                                   |          274 | M19                                                |
| `src/components/admin/newsletter/builder/NewsletterBuilder.tsx`      |          254 | M11                                                |
| `src/routes/admin.research-programs.tsx`                             |          249 | M7                                                 |
| `src/lib/clubs/api.ts`                                               |          246 | M16                                                |
| `src/lib/admin/invitations.functions.ts`                             |          245 | M19                                                |
| `src/components/admin/blocks/BlockCanvas.tsx`                        |          218 | M3                                                 |
| `src/components/admin/newsletter/builder/PropertiesPanel.tsx`        |          214 | M11                                                |
| `src/routes/$.tsx`                                                   |          213 | M20                                                |
| `src/components/admin/builder/Builder.tsx`                           |          207 | M3                                                 |
| `src/routes/admin.companies.index.tsx`                               |          204 | M18                                                |
| `src/routes/admin.posts.tsx`                                         |          199 | M2                                                 |
| `src/components/profile/AuthorProfileEditor.tsx`                     |          195 | M15                                                |
| `src/components/admin/TrendingTickerPane.tsx`                        |          195 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/admin.pages.tsx`                                         |          187 | M4                                                 |
| `src/routes/admin.tracker.tsx`                                       |          187 | M7                                                 |
| `src/routes/admin.organizations.$id.tsx`                             |          186 | M19                                                |
| `src/components/admin/clubs/organisms/ClubModerationTab.tsx`         |          185 | M16                                                |
| `src/routes/search.tsx`                                              |          183 | M6                                                 |
| `src/components/Header.tsx`                                          |          179 | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły |
| `src/routes/admin.companies.$id.tsx`                                 |          175 | M18                                                |
| `src/components/experts/ExpertLayoutRenderer.tsx`                    |          172 | M7                                                 |
| `src/routes/admin.users.$id.tsx`                                     |          168 | M19                                                |
| `src/components/admin/blocks/edit/Paragraph.tsx`                     |          167 | M3                                                 |
| `src/components/admin/analytics/GscBiDashboard.tsx`                  |          163 | M17                                                |
| `src/components/admin/post-editor/hooks/usePostEditorForm.ts`        |          162 | M2                                                 |
| `src/components/chat/ChatComposer.tsx`                               |          160 | M9                                                 |
| `src/routes/admin.ads.tsx`                                           |          158 | M14                                                |
| `src/routes/admin.pages.$slug.tsx`                                   |          154 | M4                                                 |
| `src/routes/admin.paywall.tsx`                                       |          153 | M20                                                |
| `src/lib/server/publishedContent.server.ts`                          |          151 | M20                                                |
| `src/routes/club.$clubSlug.t.$threadSlug.tsx`                        |          150 | M16                                                |

Łącznie plików produkcyjnych z pokryciem **0%: 1 281** z 2 538 (50,47%).

### 5.2 Katalogi bez ANI JEDNEGO pliku testowego

Sygnał niezależny od pokrycia: katalog może mieć pokrycie z testu innego katalogu, ale nie ma
testu WŁASNEGO — czyli nikt nie testuje go wprost. Takich katalogów jest **102**,
obejmują **229 plików / 49 002 linii**.

| Katalog                                          | Plików |   LOC |
| ------------------------------------------------ | -----: | ----: |
| `src/lib/locale`                                 |      2 | 4 544 |
| `src/components/billing`                         |     16 | 2 808 |
| `src/components/admin/ThemeOptionsPane.tsx`      |      1 | 1 898 |
| `src/components/admin/menu`                      |      2 | 1 881 |
| `src/components/admin/billing`                   |      6 | 1 696 |
| `src/components/admin/GlobalColorsEditor.tsx`    |      1 | 1 479 |
| `src/components/admin/workflows`                 |      7 | 1 454 |
| `src/components/share`                           |      2 | 1 366 |
| `src/components/pricing`                         |      9 | 1 197 |
| `src/components/admin/TrendingTickerPane.tsx`    |      1 | 1 139 |
| `src/components/newsletter`                      |      2 |   956 |
| `src/components/audio`                           |      4 |   954 |
| `src/components/auth`                            |      3 |   928 |
| `src/components/menu`                            |      2 |   902 |
| `src/components/admin/molecules`                 |      7 |   891 |
| `src/components/admin/PostSettingsMetabox.tsx`   |      1 |   878 |
| `src/components/admin/versions`                  |      7 |   793 |
| `src/lib/content-model`                          |      7 |   789 |
| `src/components/community`                       |      8 |   714 |
| `src/components/admin/settings`                  |      4 |   670 |
| `src/components/author`                          |      2 |   664 |
| `src/components/admin/AdminShell.tsx`            |      1 |   656 |
| `src/components/admin/PostGeneralOverview.tsx`   |      1 |   620 |
| `src/components/admin/sidebarBuilder`            |      1 |   607 |
| `src/components/admin/ThemeFontSizesPane.tsx`    |      1 |   602 |
| `src/components/admin/archiveLayout`             |      2 |   582 |
| `src/lib/cookieBanner`                           |      2 |   574 |
| `src/components/admin/WordPressImportDialog.tsx` |      1 |   573 |
| `src/components/membership-join`                 |      9 |   571 |
| `src/components/patterns`                        |      1 |   548 |

---

## 6. Które powierzchnie mają BRAMKĘ pokrycia (a które tylko liczbę)

Liczba bez bramki gnije: pokrycie spada z każdym mergem, którego nikt nie mierzy. Repo ma
**1 próg globalny + 61 progów per-ścieżka** w `vitest.config.ts`, egzekwowanych w CI krokiem
`Test + coverage gate` (`.github/workflows/ci.yml`).

| Ścieżka objęta bramką                             | Instr. | Gał. | Funkcje | Linie | Moduł |
| ------------------------------------------------- | -----: | ---: | ------: | ----: | ----- |
| `src/components/builder/organisms/widget-view/**` |     93 |   83 |      90 |  94.5 | M3    |
| `src/lib/content/contentEngine.ts`                |    100 |  100 |     100 |   100 | M3    |
| `src/lib/http/cachePolicy.ts`                     |    100 |   95 |     100 |   100 | M20   |
| `src/lib/builder/schema.ts`                       |     98 |   95 |     100 |   100 | M3    |
| `src/lib/observability/report.ts`                 |     94 |   90 |     100 |    93 | M17   |
| `src/lib/seo/meta.ts`                             |     84 |   66 |      72 |    90 | M8    |
| `src/lib/access/gating.ts`                        |     95 |   95 |     100 |   100 | M1    |
| `src/components/Paywall.tsx`                      |     95 |   88 |     100 |    98 | M1    |
| `src/components/molecules/MeterBanner.tsx`        |     98 |   95 |     100 |    98 | M1    |
| `src/components/atoms/QuotaMeter.tsx`             |     92 |   90 |     100 |    98 | M1    |
| `src/lib/access/metering.ts`                      |     96 |   92 |     100 |    98 | M1    |
| `src/components/checkout/checkoutIntent.ts`       |    100 |   95 |     100 |   100 | M13   |
| `src/lib/routing/publicSegments.ts`               |    100 |  100 |     100 |   100 | M20   |
| `src/components/PostLayoutRenderer.tsx`           |     95 |   80 |     100 |   100 | M1    |
| `src/lib/observability/aggregate.ts`              |    100 |  100 |     100 |   100 | M17   |
| `src/lib/observability/vitalsThresholds.ts`       |    100 |  100 |     100 |   100 | M17   |
| `src/lib/analytics/semantic/streams.ts`           |    100 |  100 |     100 |   100 | M17   |
| `src/lib/analytics/semantic/format.ts`            |    100 |  100 |     100 |   100 | M17   |
| `src/lib/analytics/semantic/window.ts`            |    100 |   95 |     100 |   100 | M17   |
| `src/lib/analytics/semantic/metrics.ts`           |     94 |   83 |     100 |   100 | M17   |
| `src/lib/analytics/semantic/reconcile.ts`         |     95 |   85 |     100 |    97 | M17   |
| `src/routes/api/public/webhooks.stripe.ts`        |     90 |   75 |      85 |    90 | M20   |
| `src/lib/billing/grant.server.ts`                 |    100 |   95 |     100 |   100 | M13   |
| `src/lib/network/**`                              |     85 |   65 |      95 |    95 | M10   |
| `src/components/network/**`                       |     97 |   92 |      98 |    98 | M10   |
| `src/lib/profile/exportManifest.ts`               |    100 |   95 |     100 |   100 | M15   |
| `src/components/profile/**`                       |     25 |   25 |      25 |    25 | M15   |
| `src/lib/chat/**`                                 |     74 |   67 |      80 |    77 | M9    |
| `src/lib/chat/thread.ts`                          |    100 |  100 |     100 |   100 | M9    |
| `src/lib/chat/menuOptions.ts`                     |    100 |  100 |     100 |   100 | M9    |
| `src/lib/chat/useThreadJump.ts`                   |    100 |  100 |     100 |   100 | M9    |
| `src/lib/chat/keys.ts`                            |    100 |  100 |     100 |   100 | M9    |
| `src/lib/chat/useMessages.ts`                     |     86 |   78 |      87 |    91 | M9    |
| `src/lib/chat/useConversations.ts`                |     90 |   80 |      96 |    96 | M9    |
| `src/components/chat/**`                          |     40 |   34 |      36 |    41 | M9    |
| `src/components/chat/ChatWindow.tsx`              |     78 |   70 |      60 |    84 | M9    |
| `src/lib/ci/ftsConfigSymmetry.ts`                 |     93 |   81 |     100 |    98 | M20   |
| `src/components/admin/post-editor/lib/**`         |    100 |  100 |     100 |   100 | M2    |
| `src/components/admin/post-editor/atoms/**`       |    100 |  100 |     100 |   100 | M2    |
| `src/components/admin/post-editor/hooks/**`       |     98 |   90 |     100 |   100 | M2    |
| `src/components/admin/post-editor/molecules/**`   |     98 |   94 |     100 |   100 | M2    |
| `src/components/admin/post-editor/organisms/**`   |     98 |   85 |      96 |   100 | M2    |
| `src/components/admin/versions/**`                |     94 |   89 |      93 |    94 | M2    |
| `src/components/admin/workflows/**`               |     96 |   91 |      95 |    97 | M2    |
| `src/lib/admin/workflows.ts`                      |    100 |  100 |     100 |   100 | M19   |
| `src/lib/unsavedChanges.ts`                       |    100 |  100 |     100 |   100 | M2    |
| `src/hooks/useUnsavedChangesGuard.ts`             |    100 |  100 |     100 |   100 | M2    |
| `src/lib/revisions.functions.ts`                  |    100 |  100 |     100 |   100 | M2    |
| `src/lib/posts-migrate.functions.ts`              |    100 |  100 |     100 |   100 | M2    |
| `src/hooks/useEditPresence.ts`                    |    100 |  100 |     100 |   100 | M2    |
| `src/hooks/useAutosave.ts`                        |     96 |   87 |     100 |   100 | M2    |
| `src/hooks/useHistory.ts`                         |     91 |   83 |     100 |    94 | M2    |
| `src/components/admin/PostEditor.tsx`             |     95 |   82 |     100 |   100 | M2    |
| `src/components/admin/PostGeneralOverview.tsx`    |     96 |   78 |     100 |    96 | M2    |
| `src/routes/admin.posts.tsx`                      |    100 |   95 |     100 |   100 | M2    |
| `src/routes/admin.posts.$slug.tsx`                |    100 |  100 |     100 |   100 | M2    |
| `src/routes/admin.posts.new.tsx`                  |    100 |  100 |     100 |   100 | M2    |
| `src/routes/admin.posts.calendar.tsx`             |    100 |   95 |     100 |   100 | M2    |
| `src/routes/admin.redirects.tsx`                  |     97 |   92 |     100 |   100 | M2    |
| `src/routes/admin.import-wordpress.tsx`           |     95 |   94 |     100 |   100 | M2    |
| `src/routes/admin.versions.tsx`                   |    100 |  100 |     100 |   100 | M2    |
| `src/routes/admin.workflows.tsx`                  |     95 |   87 |      92 |    95 | M2    |

**Czego bramka NIE pilnuje** — moduły bez ani jednego progu per-ścieżka:

- **MODUŁ 4 — Strony, wygląd, motyw, media, import**: linie 22,76%, funkcje 16,18%, plików 0%: 72/129
- **MODUŁ 6 — Wyszukiwarka**: linie 33,21%, funkcje 32,65%, plików 0%: 11/24
- ~~**MODUŁ 7 — Typy treści specjalne**: linie 16,47%, funkcje 14,60%, plików 0%: 75/109~~ → **100% / 100%**, plików 0%: **0** (19.08.2026, `WDROZENIE_MODUL7_TESTY_2026-08-18.md`)
- **MODUŁ 11 — Newsletter i e-mail**: linie 26,70%, funkcje 20,74%, plików 0%: 70/135
- **MODUŁ 12 — Realtime / powiadomienia / web-push**: linie 44,12%, funkcje 41,02%, plików 0%: 13/28
- **MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy**: linie 22,55%, funkcje 15,28%, plików 0%: 19/38
- **MODUŁ 16 — Społeczność: kluby, komentarze, moderacja**: linie 17,56%, funkcje 13,32%, plików 0%: 177/242
- **MODUŁ 18 — CRM**: ~~linie 12,04%, funkcje 9,30%, plików 0%: 33/47~~ → **linie 98,98%, funkcje 98,48%, plików 0%: 0/56** (patrz `docs/WDROZENIE_CRM_POKRYCIE_TESTAMI_2026-08-19.md`)
- **MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO**: linie 22,00%, funkcje 17,43%, plików 0%: 62/122
- **MODUŁ 21 — Rekrutacja / kariera**: linie 55,12%, funkcje 47,13%, plików 0%: 12/29

↻ **MODUŁ 2 wyszedł z tej listy 19.08.2026.** Ma teraz 18 progów per-ścieżka:
dwanaście czystych modułów reguł na równych 100% (m.in. `postPatch.ts`,
`postsListQuery.ts`, `redirectsAdmin.ts`, `workflows/lib/**`, `unsavedChanges.ts`),
cztery powierzchnie z floorem pod zmierzonym poziomem (`post-editor/lib/**`,
`hooks/**`, `atoms/**`, `editorialCalendar.ts`) i trzy zapory antyregresyjne na
katalogach, które dopiero wyszły z zera (`post-editor/molecules/**`, `workflows/**`,
`versions/**`). Szczegóły i uzasadnienie każdego poziomu:
`docs/WDROZENIE_MODUL2_TESTY_REFAKTOR_2026-08-18.md`, rozdz. 8.3.

---

## 7. Trzy warstwy testów — co która realnie pokrywa

| Warstwa                             | Rozmiar                                  | Co dowodzi                                              | Czego NIE dowodzi                                                                 |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Jednostkowe / komponentowe (vitest) | 817 plików, 8 274 testów, 17 585 asercji | logikę w TS/TSX, render komponentów, kontrakty modułów  | zachowania bazy (RLS/RPC/triggery), realnych ścieżek przeglądarki, SSR end-to-end |
| Baza (pgTAP)                        | 97 plików, 1 812 asercji                 | izolację tenanta, polityki RLS, kontrakty RPC, triggery | kodu frontu — v8 tego pokrycia NIE liczy                                          |
| E2E (Playwright)                    | 7 plików, 42 testów                      | ścieżki użytkownika, SSR, SEO, checkout                 | pokrycia jednostkowego (osobny proces, nie wchodzi do %)                          |
| Bramki statyczne (`check:*`)        | 33 skryptów                              | kontrakty struktury (SQL, i18n, warstwy, bundle)        | wykonania kodu                                                                    |

To jest źródło pozornej sprzeczności: MODUŁ z ~20% pokrycia jednostkowego może być jednym
z najlepiej zabezpieczonych w systemie, jeśli jego reguły siedzą w bazie i mają pgTAP.

---

## 8. Wnioski: gdzie ryzyko jest największe

Ryzyko liczę jako BEZWZGLĘDNĄ liczbę niepokrytych linii, nie procent — 20% na module o 50 tys.
linii to większa dziura niż 20% na module o 5 tys.

| #   | Moduł                                                 | Linii niepokrytych | Linie % | Funkcje % | Testów |
| --- | ----------------------------------------------------- | -----------------: | ------: | --------: | -----: |
| 3   | Silniki treści: bloki + page builder                  |         **12 782** |  39,99% |    29,04% |  2 048 |
| 16  | Społeczność: kluby, komentarze, moderacja             |          **6 442** |  17,56% |    13,32% |    586 |
| 20  | Platforma / backend / infrastruktura / SSR            |          **3 962** |  52,72% |    40,16% |  1 147 |
| 7   | Typy treści specjalne                                 |          **3 800** |  16,47% |    14,60% |    203 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |          **3 542** |  32,71% |    26,68% |    542 |
| 11  | Newsletter i e-mail                                   |          **3 501** |  26,70% |    20,74% |    314 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |          **3 300** |  22,00% |    17,43% |    289 |
| 15  | Profil i konto                                        |          **2 791** |  19,12% |    18,00% |    187 |
| 4   | Strony, wygląd, motyw, media, import                  |          **2 590** |  22,76% |    16,18% |    219 |
| 18  | CRM                                                   |          **2 463** |  12,04% |     9,30% |    170 |

> **Moduł 13 zamknięty 19.08.2026**: 32,71% → **65,5% linii** i 26,68% → **80,8% funkcji**
> (bez plików tras), osiem defektów naprawionych. Patrz
> `WDROZENIE_POKRYCIE_MONETYZACJI_MODUL_13_2026-08-19.md`.

### 8.1 Rekomendacje — kolejność, nie lista życzeń

**R1. Włączyć `coverage.reportOnFailure: true` — jedna linia, bo dziś bramka pokrycia potrafi nie sprawdzić NICZEGO.**
Vitest pomija CAŁY raport pokrycia — a wraz z nim `checkThresholds` — jeśli w przebiegu padł choć jeden test:
`reportCoverage()` w `node_modules/vitest/dist/chunks/cli-api.*.js` robi `if (!this._coverageOptions.reportOnFailure) return;`
przed wejściem w `coverageProvider.reportCoverage()`, a próg globalny i wszystkie 37 progów per-ścieżka
sprawdzane są WEWNĄTRZ tej metody (`coverage.*.js` → `checkThresholds`). Domyślna wartość to `false`
i repo jej nie nadpisuje. Skutek: na przebiegu z czerwonym testem krok CI „Test + coverage gate” pada
z powodu testu, ale o pokryciu nie dowiaduje się NIC — próg mógł zostać przekroczony w dół i nikt tego nie zobaczy.
To bliźniak meta-inwariantu z `src/lib/ci/gateCoverage.ts` („bramka, która istnieje, musi się uruchamiać”);
brakujące zdanie brzmi: **bramka, która się uruchamia, musi coś sprawdzić**. Dowód praktyczny: ten audyt musiał
podać `--coverage.reportOnFailure=true`, bo dwa pierwsze przebiegi nie wyprodukowały ŻADNEGO raportu przy
czterech czerwonych testach.

**R2. Naprawić czerwoną suitę — na tym HEAD padają 4 testy, dwa defekty potwierdzone niezależnie od pomiaru.**

- `src/lib/authz/__tests__/authzSnapshotParity.test.ts` — snapshot bramek autoryzacji rozjechał się z migracjami.
  Potwierdzone osobnym uruchomieniem `scripts/generate-authz-snapshot.ts --check`: w migracjach doszła
  **bramka flagi `pro_briefings|policy:events/events member read`** (pozycja „ZMIANA UPRAWNIEŃ — do rozstrzygnięcia
  w code review”), `pro_briefings|fn:rsvp_event/2` przeniosła się do migracji `20260818065327_*`,
  a snapshot pochodzi ze skanu starszego o cztery migracje (784 → 788). Sama regeneracja nie wystarczy —
  pierwsza pozycja jest zmianą kręgu uprawnionych.
- `src/components/builder/organisms/widget-view/__tests__/lazyWidgets.test.ts` — `lazyWidgets.tsx` eksportuje
  `TrendingNowView`, którego nie ma na liście `SPLIT_WIDGETS` w teście. Widget doszedł do rejestru leniwego
  bez aktualizacji strukturalnej zapory (sprawdzone w kodzie: `lazyWidgets.tsx:197-200`).
- `src/lib/builder/__tests__/labelsEn.test.ts` — etykiety modułu danych buildera bez tłumaczenia EN.
- `src/lib/crm/__tests__/companyViews.test.ts` — `applyCompanyFilter` nie spada na `updated_at`, gdy lead nie ma aktywności.

**R3. Login / rejestracja / wylogowanie: najgorszy stosunek krytyczności do pokrycia w całym repo.**
Przez tę ścieżkę przechodzi KAŻDY użytkownik, a pomiar pokazuje: portal logowania **0,4% linii i 0/55 funkcji**,
sesja i kontekst użytkownika (`useAuth`) **1,8% (1/25 funkcji)**, MFA **2,3% (1/14)**, reset hasła **0% (0/16)**,
ochrona brute-force **11,1% (0/9 funkcji — pokryte są tylko literały modułu, ani jedna funkcja nie została wywołana)**,
ustawienia logowania w adminie **2,5% (0/51)**. Jasne punkty: pola rejestracji 73,9% i formularze auth w CMS 88,7%.
Zalecenie: powtórzyć zabieg, który zadziałał na czacie (`docs/WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md`) —
wyprowadzić REGUŁY z komponentów do czystych modułów (mapowanie błędu Supabase → klucz i18n, wybór metody logowania,
warunki wejścia w MFA, licznik prób i okno blokady) i objąć je progiem per-ścieżka. Bez ekstrakcji koszt napisania
testu jest tak wysoki, że pokrycie nie ruszy — to ta sama diagnoza, którą repo już raz postawiło i raz rozwiązało.

**R4. Newsletter i popup: warstwa administracyjna praktycznie nietknięta.**
`components/admin/newsletter` — **1,4% linii, 3 z 644 funkcji, 35 z 37 plików na zerze**; doręczalność
(`newsletter-deliverability` + webhook Resend) — **0% (0/23 funkcji)**; telemetria popupu — **0% (0/11)**;
zapis z double opt-in — **14,3% (7/25)**; kampanie i wysyłka — **17,9% (5/70)**. Publiczna część jest zdrowa
(wygląd popupu 100%, telemetria newslettera 68,1%, panel zapisu 44,7%), więc dziura jest dokładnie tam,
gdzie redakcja klika przed wysyłką do subskrybentów. Minimum wykonalne: testy REGUŁ, nie renderu —
warunki i częstotliwość wyświetlenia popupu, walidacja pól i zgód, budowa dokumentu maila, mapowanie zdarzeń
bounce/complaint z webhooka.

**R5. Kluby dyskusyjne: największa BEZWZGLĘDNA dziura w repo.**
Moduł ma 242 pliki i 52 tys. linii przy pokryciu **17,6% linii / 13,3% funkcji (418 z 3 139)**.
Panel admina **0% (26 plików, 557 funkcji)**, trasy publiczne klubu **0% (20 plików, 261 funkcji)**,
UI **5,0% (103 pliki, 42 z 945 funkcji)**. Warstwa reguł jest w lepszym stanie (wątki 72,3%, tematy 51,8%,
dostęp i uprawnienia 42,8%), a izolację tenanta i polityki pilnuje pgTAP — ale nic nie pilnuje tego, czy
zgłoszenie członkowskie (**18,6%, 9/61 funkcji**) i bramka dostępu do minisite'u przejdą po zmianie planów.
Kolejność prac: `applyValidation` → `hubAccess`/`minisiteAccess` → `capabilityMatrix` → organizmy wątku.

**R6. Panele właściwości widgetów: 13,6% linii i 166 z 2 077 funkcji — przy najmocniejszej bramce w repo.**
Sprzeczność jest pozorna i warto ją nazwać: `check:widget-fidelity` (537 testów) dowodzi PARYTETU
panel ⇄ renderer, ale nie wykonuje kodu paneli — dlatego mierzone pokrycie jest niskie, a wierność wysoka.
Renderer publiczny widgetów stoi przy tym na **68,8% linii (511 z 787 funkcji)** i ma próg 94,5% linii,
którego ten pomiar nie może potwierdzić (patrz 9.2). Rekomendacja nie brzmi „dopisać 2 000 testów funkcji”,
ale: wyprowadzić z paneli warstwę schematu i walidacji — tak jak zrobiono z `lib/builder/schema.ts`
(100% funkcji, próg 98/95/100/100) — i testować ją, zostawiając render bramce parytetu.

**R7. Podnieść ratchet tam, gdzie pomiar go już przerósł.**
`lib/network/**` ma próg linii 95 przy zmierzonych **96,4%**; kariera **81,3% linii bez ŻADNEJ bramki**;
`lib/ci/**` **95,5% linii bez bramki na całość** (a to warstwa, która pilnuje pozostałych bramek);
`CMS: zapytania danych widgetów` **75,6%** i `content-model` **98,0%** — obie bez progu. Zasada z configu
(„ten próg wolno wyłącznie podnosić”) działa tylko wtedy, gdy ktoś REALNIE go podnosi po każdej pracy testowej;
inaczej próg z czasem opisuje przeszłość, a nie stan.

**R8. Czego NIE robić.**
Nie gonić procentów na słownikach i18n (116 plików, **91,8% linii przy 51,3% funkcji** — to artefakt importu
obiektów, nie dowód niczego), nie gonić ich na trasach (`src/routes` to w większości cienka kompozycja loaderów;
ich sens dowodzi e2e i bramki SSR) i nie wracać do testów renderu bez asercji — repo już raz zdjęło taką warstwę
i zapisało to w komentarzu do progu globalnego w `vitest.config.ts`. Wskaźnik do obserwowania obok procentu:
**asercje na test** (dziś 17 585 asercji na 8 274 testy = 2,13).

---

## 9. Załączniki

### 9.1 Reguły mapowania plik → moduł

Mapowanie jest deterministyczne (pierwsze trafienie wygrywa) i w całości oparte na ścieżkach.
Wzorce w kolejności stosowania, per moduł:

> **AKTUALIZACJA 2026-08-19 — trzy wzorce dopisane do MODUŁU 1.** Wyprowadzenie reguł
> i paneli z plików tras przeniosło kod modułu 1 do katalogów, których reguły niżej nie
> przypisywały do tego modułu. Bez tych trzech wzorców kolejny pomiar pokazałby SPADEK
> liczby plików modułu 1 i przeniósł jego pokrycie do modułów 19 i 20, choć kod jest ten sam:
>
> | Wzorzec                                | Co tam jest                   | Bez wzorca wpada do   |
> | -------------------------------------- | ----------------------------- | --------------------- |
> | `src/components/admin/postExperience/` | cztery panele modułu          | PRZEKROJOWE: panel    |
> | `src/lib/post/`                        | reguły renderu i paneli wpisu | MODUŁ 20 (`src/lib/`) |
> | `src/lib/admin/panelDraft`             | reguły wspólne paneli modułu  | MODUŁ 19              |
>
> Wzorce wchodzą PRZED regułami modułów 19 i 20 (pierwsze trafienie wygrywa).

| #   | Moduł                                                 | Wzorce ścieżek                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Wpisy: doświadczenie czytelnika                       | `src/lib/access/`, `src/lib/toc/`, `src/lib/footnotes`, `src/lib/manualToc`, `src/lib/keyTakeaways/`, `src/lib/citations/`, `src/lib/audio/`, `src/lib/readingTime`, `src/lib/postLayouts`, `src/lib/relatedPosts`, `src/lib/relatedInsights`, `src/lib/relatedClickBeacon`, `src/components/post/`, `src/components/PostLayoutRenderer`, `src/components/Paywall`, `src/components/author/`, `src/components/audio/`, `src/components/molecules/MeterBanner`, `src/components/atoms/QuotaMeter`, `src/hooks/(useContentAccess                                                                                                                                                                                                   | useUnlockedContent                                        | usePasswordUnlock                                  | useRecordPostView                                | useSaveArticle                     | useBookmarks                 | useReadingTimeSettings                                             | usePostLayoutSettings                     | useRecommendedPosts)`, `src/routes/post\.`, `src/routes/preview\.`, `src/routes/admin\.(key-takeaways | toc           | post-layouts | related-posts)`, `src/routes/api/public/(post-tts | related-click)`, `src/routes/api/(tts | stt)` |
| 2   | Edytor wpisów i workflow redakcyjny                   | `src/components/admin/post-editor/`, `src/components/admin/versions/`, `src/components/admin/workflows/`, `src/lib/revisions`, `src/lib/posts-migrate`, `src/hooks/useAutosave`, `src/hooks/useEditPresence`, `src/hooks/useHistory`, `src/hooks/useUnsavedChangesGuard`, `src/lib/unsavedChanges`, `src/routes/admin\.(posts                                                                                                                                                                                                                                                                                                                                                                                                    | scheduler                                                 | calendar)`, `src/routes/admin\.(versions           | workflows                                        | redirects                          | import-wordpress             | contributors)`, `src/components/admin/(PostEditor                  | PostGeneralOverview)`                     |
| 3   | Silniki treści: bloki + page builder                  | `src/lib/blocks/`, `src/lib/builder/`, `src/lib/content/`, `src/lib/content-model/`, `src/lib/sidebarBuilder/`, `src/lib/patterns/`, `src/lib/wp-import`, `src/lib/wordpress-import`, `src/lib/sanitize`, `src/lib/content\.functions`, `src/components/blocks/`, `src/components/builder/`, `src/components/patterns/`, `src/components/content/`, `src/components/admin/blocks/`, `src/components/admin/builder/`, `src/components/admin/sidebarBuilder/`                                                                                                                                                                                                                                                                      |
| 4   | Strony, wygląd, motyw, media, import                  | `src/lib/theme/`, `src/lib/media`, `src/lib/layout/`, `src/lib/pageTemplates`, `src/lib/archive-layout-settings`, `src/lib/expertLayouts`, `src/lib/cropSizes`, `src/lib/cardImageSizes`, `src/lib/brand`, `src/lib/icons/`, `src/lib/icon`, `src/components/media/`, `src/components/theme/`, `src/components/icons/`, `src/components/pages/`, `src/components/admin/media/`, `src/components/admin/theme-design/`, `src/components/admin/archiveLayout/`, `src/hooks/(useGlobalColors                                                                                                                                                                                                                                         | useExpertLayoutSettings)`, `src/routes/admin\.(appearance | media                                              | pages                                            | theme                              | categor                      | tags?)`, `src/routes/admin\.(icons                                 | crop-sizes                                | content-area                                                                                          | custom-meta)` |
| 5   | Strona główna, archiwa, chrome                        | `src/components/header/`, `src/components/footer/`, `src/components/menu/`, `src/components/megaMenu/`, `src/components/mobile/`, `src/components/archive/`, `src/lib/menus/`, `src/lib/megaMenu/`, `src/lib/mobileBottomBar/`, `src/lib/mobileDrawer`, `src/lib/breadcrumbs`, `src/lib/categoryAreas`, `src/components/admin/menu/`, `src/routes/(category                                                                                                                                                                                                                                                                                                                                                                      | tag                                                       | blog                                               | series                                           | publications)\.`                   |
| 6   | Wyszukiwarka                                          | `src/lib/search/`, `src/components/search/`, `src/hooks/useSavedSearches`, `src/routes/search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Typy treści specjalne                                 | `src/lib/tracker/`, `src/components/tracker/`, `src/lib/experts/`, `src/components/experts/`, `src/components/admin/experts/`, `src/lib/programs/`, `src/components/programs/`, `src/lib/events/`, `src/components/events/`, `src/lib/podcast/`, `src/components/podcast/`, `src/components/admin/podcasts/`, `src/lib/web-stories/`, `src/components/web-stories/`, `src/components/quiz/`, `src/lib/files/`, `src/components/files/`, `src/lib/maps/`, `src/components/maps/`, `src/routes/.*(tracker                                                                                                                                                                                                                          | expert                                                    | program                                            | event                                            | podcast                            | web-stor                     | quiz                                                               | librar                                    | glossar                                                                                               | poll          | qa           | live)`                                            |
| 8   | SEO, feedy, dane strukturalne                         | `src/lib/seo/`, `src/components/seo/`, `src/lib/social/`, `src/lib/links/`, `src/lib/customMeta`, `src/components/share/`, `src/components/admin/seo/`, `src/routes/.*(sitemap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | robots                                                    | rss                                                | feed                                             | llms                               | og-                          | seo)`                                                              |
| 9   | Czat / komunikator                                    | `src/lib/chat/`, `src/components/chat/`, `src/lib/composer/`, `src/components/composer/`, `src/lib/mentions/`, `src/components/mentions/`, `src/routes/.*(chat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | messages)`                                                |
| 10  | Sieć / networking                                     | `src/lib/network/`, `src/components/network/`, `src/hooks/useFollow`, `src/routes/.*network`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | Newsletter i e-mail                                   | `src/lib/newsletter`, `src/components/newsletter/`, `src/components/admin/newsletter/`, `src/lib/email`, `src/lib/system-emails`, `src/lib/tx-email-preview`, `src/lib/auth-email`, `src/hooks/useMyNewsletterStatus`, `src/hooks/useNewsletterSettings`, `src/components/popups/`, `src/routes/.*newsletter`, `src/routes/.*email`, `src/routes/(unsubscribe                                                                                                                                                                                                                                                                                                                                                                    | api/public/nl-)`, `src/components/admin/popups/`          |
| 12  | Realtime / powiadomienia / web-push                   | `src/lib/realtime/`, `src/lib/notifications/`, `src/components/notifications/`, `src/routes/.*notification`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Monetyzacja: checkout / subskrypcje / billing         | `src/lib/billing/`, `src/lib/stripe`, `src/lib/pricing/`, `src/components/billing/`, `src/components/checkout/`, `src/components/pricing/`, `src/components/membership-join/`, `src/components/admin/billing/`, `src/components/admin/pricing/`, `src/hooks/useCheckout`, `src/routes/.*(billing                                                                                                                                                                                                                                                                                                                                                                                                                                 | checkout                                                  | pricing                                            | membership                                       | subscription)`, `src/routes/(plans | api/public/payments          | api/public/fx-rate)`                                               |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  | `src/lib/gifting`, `src/components/gifting/`, `src/components/donations/`, `src/lib/ads/`, `src/components/ads/`, `src/components/admin/coupons/`, `src/hooks/useValidateCoupon`, `src/routes/.*(gift                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | donat                                                     | coupon                                             | ads)`                                            |
| 15  | Profil i konto                                        | `src/lib/profile/`, `src/lib/account`, `src/lib/auth/`, `src/lib/authSettings`, `src/lib/interests/`, `src/lib/retention/`, `src/lib/onboarding/`, `src/components/profile/`, `src/components/auth/`, `src/components/interests/`, `src/components/admin/auth/`, `src/components/admin/onboarding/`, `src/hooks/useAuth`, `src/hooks/useAuthSettings`, `src/hooks/useInterests`, `src/routes/(login                                                                                                                                                                                                                                                                                                                              | signup                                                    | account                                            | profile                                          | auth)`, `src/routes/.*(profile     | account                      | onboarding)`, `src/routes/(reset-password                          | support                                   | contribute)`                                                                                          |
| 16  | Społeczność: kluby, komentarze, moderacja             | `src/lib/clubs/`, `src/lib/community/`, `src/lib/comments/`, `src/components/clubs/`, `src/components/community/`, `src/components/comments/`, `src/components/admin/clubs/`, `src/components/admin/community/`, `src/routes/.*(club                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | community                                                 | comment                                            | badge)`                                          |
| 17  | Analityka i BI                                        | `src/lib/analytics/`, `src/lib/observability/`, `src/lib/charts/`, `src/lib/counters/`, `src/lib/views/`, `src/lib/webVitals`, `src/lib/tracker-admin`, `src/components/charts/`, `src/components/admin/analytics/`, `src/components/admin/performance/`, `src/routes/.*(analytics                                                                                                                                                                                                                                                                                                                                                                                                                                               | semantic)`, `src/routes/api/public/(track                 | vitals                                             | client-errors)`, `src/routes/admin\.(performance | experiments                        | link-monitor)`               |
| 18  | CRM                                                   | `src/lib/crm`, `src/components/admin/crm/`, `src/lib/organizations/`, `src/lib/csv/`, `src/routes/.*crm`, `src/routes/admin\.(companies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | contact)`                                                 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO | `src/lib/authz/`, `src/lib/consent`, `src/lib/cookieBanner/`, `src/lib/legal/`, `src/lib/integrations/`, `src/lib/tenant`, `src/lib/features/`, `src/lib/personalization/`, `src/lib/greetings/`, `src/lib/admin/`, `src/lib/adminToasts`, `src/lib/useSiteSetting`, `src/lib/joinUsSync`, `src/lib/contact\.functions`, `src/components/legal/`, `src/components/consent/`, `src/components/admin/permissions/`, `src/components/admin/users/`, `src/components/admin/settings/`, `src/components/admin/cookie-banner/`, `src/components/admin/google-source/`, `src/hooks/(usePersonalizedSettings                                                                                                                             | useCheckoutSettings)`, `src/routes/admin\.(settings       | users                                              | integrations                                     | permissions                        | consent                      | organizations                                                      | audience)`, `src/routes/admin\.(greetings | names                                                                                                 | personalized  | popups)`     |
| 20  | Platforma / backend / infrastruktura / SSR            | `src/lib/ssr`, `src/lib/server/`, `src/lib/http/`, `src/lib/supabase`, `src/integrations/`, `src/lib/ci/`, `src/lib/queries/`, `src/lib/async`, `src/lib/errors/`, `src/lib/error`, `src/lib/watchdog/`, `src/lib/routing/`, `src/lib/a11y/`, `src/lib/code/`, `src/lib/mcp/`, `src/lib/prerender`, `src/lib/edgeCache`, `src/lib/platform-error-reporting`, `src/lib/cacheBusting`, `src/lib/ai-gateway`, `src/lib/redirects`, `src/lib/text/`, `src/lib/utils`, `src/lib/deepMerge`, `src/lib/storageKeys`, `src/lib/rafThrottle`, `src/lib/smoothAnchorScroll`, `src/lib/overlayCoordinator`, `src/lib/appDialogs`, `src/lib/loginPopupBus`, `src/lib/toastError`, `src/lib/countries`, `src/components/error/`, `src/(router | server                                                    | start)\.`, `src/utils/`, `src/routes/`, `src/lib/` |
| 21  | Rekrutacja / kariera                                  | `src/lib/careers/`, `src/lib/jobs/`, `src/components/careers/`, `src/routes/.*(career                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | job)`, `src/routes/admin\.hiring`                         |
| —   | PRZEKROJOWE: słowniki i18n                            | `src/lib/i18n-`, `src/lib/i18n\.ts$`, `src/lib/i18n/`, `src/lib/locale/`, `src/components/admin/i18n/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    | `src/components/(atoms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | molecules                                                 | forms                                              | features)/`, `src/components/admin/(atoms        | molecules                          | hooks)/`, `src/lib/(features | hooks)/`, `src/components/admin/`, `src/components/`, `src/hooks/` |
| —   | PRZEKROJOWE: design system (components/ui)            | `src/components/ui/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Rozbicie liczby plików produkcyjnych:

| #   | Moduł                                                 | Pliki | LOC (surowe) | Pliki testowe | LOC testów |
| --- | ----------------------------------------------------- | ----: | -----------: | ------------: | ---------: |
| 1   | Wpisy: doświadczenie czytelnika                       |    74 |       13 632 |            30 |      4 155 |
| 2   | Edytor wpisów i workflow redakcyjny ↻                 |    93 |       13 774 |            33 |      7 022 |
| 3   | Silniki treści: bloki + page builder                  |   449 |      110 202 |           201 |     32 901 |
| 4   | Strony, wygląd, motyw, media, import                  |   130 |       16 555 |            35 |      2 481 |
| 5   | Strona główna, archiwa, chrome                        |    51 |        9 150 |             9 |      1 073 |
| 6‡  | Wyszukiwarka                                          |    24 |        4 582 |            21 |      6 098 |
| 7   | Typy treści specjalne                                 |   109 |       25 083 |            20 |      2 742 |
| 8   | SEO, feedy, dane strukturalne                         |    73 |       10 265 |            38 |      3 850 |
| 9   | Czat / komunikator                                    |    80 |       15 462 |            36 |      9 164 |
| 10  | Sieć / networking                                     |    31 |        5 001 |            22 |      4 974 |
| 11  | Newsletter i e-mail                                   |   135 |       27 552 |            34 |      4 303 |
| 12  | Realtime / powiadomienia / web-push                   |    28 |        5 374 |            13 |      1 672 |
| 13  | Monetyzacja: checkout / subskrypcje / billing         |   162 |       26 463 |            49 |      9 480 |
| 14  | Monetyzacja: kupony / darowizny / prezenty / reklamy  |    38 |        7 771 |            11 |      1 402 |
| 15  | Profil i konto                                        |    81 |       17 948 |            20 |      2 734 |
| 16  | Społeczność: kluby, komentarze, moderacja             |   242 |       52 134 |            59 |      8 108 |
| 17  | Analityka i BI                                        |    85 |       16 514 |            19 |      2 229 |
| 18  | CRM                                                   |    47 |       15 130 |            15 |      1 992 |
| 19  | Ustawienia / integracje / users / multi-tenant / RODO |   122 |       23 158 |            24 |      3 383 |
| 20  | Platforma / backend / infrastruktura / SSR            |   175 |       57 047 |           114 |     15 743 |
| 21  | Rekrutacja / kariera                                  |    29 |        5 231 |            11 |      2 202 |
| —   | PRZEKROJOWE: słowniki i18n                            |   116 |       40 552 |             6 |        528 |
| —   | NIEPRZYPISANE                                         |     0 |            0 |            11 |      1 942 |
| —   | PRZEKROJOWE: powłoka panelu admin + atomy/molekuły    |   134 |       25 083 |            19 |      1 962 |
| —   | PRZEKROJOWE: design system (components/ui)            |    43 |        4 229 |             2 |        195 |

**↻** Wiersz przeliczony 19.08.2026 (`wc -l` po plikach `.ts`/`.tsx` pasujących do wzorców
modułu 2). Ta sama metoda uruchomiona na stanie z 18.08 daje 12 234 LOC produkcyjnych zamiast
12 317 — różnica 0,7% bierze się z innego liczenia ostatniej linii pliku. Wiersze pozostałych
modułów zostają w wartościach z 18.08, więc porównuj kolumnę „Pliki”, nie samo LOC.

### 9.2 Pliki testowe wyłączone z pomiaru (zawieszają się w tym środowisku)

| Hipoteza pierwotna             | Weryfikacja                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| dryf wersji zależności         | komplet `bun install`: 806 paczek zgodnych z pinami, **zero** dryfu → zawieszenie identyczne |
| ciężar importów (99 widgetów)  | `WidgetView` importuje się w **1,8 s**, lustro `eagerWidgetChunks` w **3,9 s** → to nie to   |
| równoległość / liczba workerów | pojedynczy plik, `--pool=threads` i `--pool=forks` — zawieszenie w każdej konfiguracji       |

**Prawdziwa przyczyna: zakleszczenie cyklu pod fabryką `vi.mock`.**

```
vi.mock(".../widget-view/lazyWidgets", () => import("@/test/eagerWidgetChunks"))
    → eagerWidgetChunks importuje PostsSliderWidget
    → PostsSliderWidget importował { SliderRender } z "./lazyWidgets"
    → czyli z modułu, którego fabryka WŁAŚNIE trwa          ⇒ DEADLOCK
```

Fabryka czekała na import, który czekał na tę samą fabrykę. Ani `testTimeout`, ani `hookTimeout`
nie dotyczą fazy ładowania modułu, więc przebieg stał **bez końca**, zamiast paść — i to właśnie
upodabniało objaw do „bardzo ciężkiego importu". W produkcji ten sam cykl rozwiązywał się po
ESM-owemu, dlatego nikt go nie widział.

**Wniosek poważniejszy niż zaniżony pomiar:** `bun run test` **nie dawał się dokończyć na tym
HEAD-zie w żadnym środowisku**, także w CI repo (wersja vitest jest przypięta, więc zachowanie
jest deterministyczne). Powierzchnie MODUŁU 3 nie były „słabo przetestowane" — ich testy po prostu
nigdy nie dobiegały.

**Naprawa** (osobne commity): krawędź `PostsSliderWidget → lazyWidgets` rozerwana przez wydzielenie
`widget-view/lazySuspense.tsx` (wspólne `withSuspense` + shimmer) i `widget-view/lazySliderRender.tsx`
(sam `SliderRender`, z DOKŁADNIE tą samą granicą `lazy(() => import(...))`, więc bundle bez zmian).
Do tego trzy klasy dryfu, które wyszły dopiero wtedy, gdy bramki zaczęły dobiegać: brak dwóch
eksportów w lustrze `eagerWidgetChunks` (`AccordionWidget`, `SectionLabelWidgetView` — przeniesione
do rejestru leniwego tego samego dnia), niepełne zaślepki `supabase.channel` oraz strażnicy
pilnujący nieaktualnego stanu (`SPLIT_WIDGETS`, ścieżka pliku w teście granicy chunka).

**Efekt — ZMIERZONE po naprawie:**

| Powierzchnia                                  | Audyt (zaniżony) |                             Po naprawie |
| --------------------------------------------- | ---------------: | --------------------------------------: |
| `components/builder/organisms/widget-view/**` |      68,8% linii |            **97,65% linii** · 95,12% fn |
| `components/admin/builder/**`                 |      13,6% linii | **29,14% linii** · 17,53% fn (364/2077) |
| całe `src/` — linie                           |           33,19% |                              **37,46%** |
| całe `src/` — funkcje                         |           25,33% |                              **28,90%** |
| suita                                         |   778/817 plików |   **833 pliki, 10 269 testów, zielono** |

Panele właściwości nadal są najsłabszą dużą powierzchnią MODUŁU 3 — ale ich liczba wzrosła
z 166 na 364 wykonane funkcje **bez ani jednego nowego testu**, wyłącznie dlatego, że istniejące
testy wreszcie się uruchamiają. Od tej naprawy powierzchnia ma też własny próg per-ścieżka
w `vitest.config.ts` (wcześniej była jedyną dużą powierzchnią modułu bez progu — i jedyną, która
osunęła się do 13,6%).

Lista plików, które NIE startowały (18 z nich to zakleszczenie opisane wyżej — dziś wszystkie
przechodzą; pozostałe pozycje tej listy padały na dryfie lustra i zaślepek, opisanym wyżej):

- `src/components/admin/builder/__tests__/buttonFullWidth.test.tsx`
- `src/components/admin/builder/__tests__/fidelityGateFindings.test.tsx`
- `src/components/admin/builder/__tests__/headingGlobalFontFallback.test.tsx`
- `src/components/admin/builder/__tests__/newsletterCanvasParity.test.tsx`
- `src/components/admin/builder/__tests__/sampleDataLeak.gate.test.tsx`
- `src/components/admin/builder/__tests__/settingsFidelity.gate.test.tsx`
- `src/components/admin/builder/__tests__/widgetPanelSchemaGaps.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/allWidgets.smoke.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/authorDisplayAcrossWidgets.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/branchClose.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/branchClose2.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/branchClose4.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/branchSweep.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/branchSweep2.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/chromeWidgetsInteraction.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/counterWidget.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/dataViews.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/dataVizWidgets.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/galleryLightbox.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/interactiveCircleWidget.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/interactiveHandlers.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/langSwitcherVisual.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/mediaWidgetsBranches.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/meetingBookingActions.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/richHtmlFootnotes.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/searchButtonWidgetRouterSync.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/simpleWidgetsBranchSweep2.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/simpleWidgetsExhaustive.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/socialIconsHover.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/socialIconsSettings.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/teamMemberWidget.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/tocManualItemsKeys.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/tocWidgetInteractions.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/typographyMapping.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/variantRenderers.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/widgetBehavior.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/widgetViewEditable.test.tsx`
- `src/components/builder/organisms/widget-view/__tests__/worldMapWidget.test.tsx`
- `src/components/mobile/bottomBar/__tests__/MobileBottomBarView.test.tsx`
  — **AKTUALIZACJA 19.08.2026**: ten JEDEN plik spoza modułu 3 przechodzi w komplecie
  (15 przypadków, 1,7 s) w przebiegu, w którym mierzono zamknięcie modułu 5. Jego obecność na
  liście była artefaktem konkretnego przebiegu, nie właściwością pliku — a to znaczy, że
  adnotacja „pomiar zaniżony" nie dotyczyła chrome mobilnego. Reszta listy (38 plików
  buildera i widgetów) wisi nadal.

**Status: wszystkie powyższe pliki przechodzą.** Cały MODUŁ 3 uruchomiony w jednym przebiegu:
90 plików / 1 832 testy / 64 s (wcześniej: przebieg nie kończył się nigdy).

### 9.3 Odtworzenie pomiaru

```bash
bun install                                    # rejestr prywatny Lovable (piny z bun.lock)
bun run test:coverage                          # próg globalny + 37 progów per-ścieżka
# UWAGA: przy choćby jednym czerwonym teście powyższe NIE wypisze raportu ani nie sprawdzi progów.
# Żeby zmierzyć stan faktyczny na czerwonej suicie (jak w tym audycie):
bunx vitest run --coverage --coverage.reportOnFailure=true \
  --coverage.reporter=json --coverage.reporter=json-summary --coverage.reporter=text-summary
```

Agregacja per moduł / funkcja / funkcjonalność powstała z `coverage/coverage-final.json`
(mapy `statementMap`/`fnMap`/`branchMap` + liczniki `s`/`f`/`b`) oraz `coverage-summary.json`:
moduł = suma po plikach pasujących do reguł z 9.1, funkcjonalność = suma po wzorcach ścieżek,
„funkcja bez wywołania” = wpis `fnMap`, którego licznik `f` wynosi zero.

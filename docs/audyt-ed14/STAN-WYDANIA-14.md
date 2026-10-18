# Wydanie 14 audytu pokrycia - stan prac (zapis pośredni)

To jest **zapis pośredni** wydania 14, wypchnięty na prośbę zespołu, żeby nic nie przepadło przy limicie sesji.
Rozdział 18 dokumentu `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`, weryfikator
`scripts/audit/verify-edition-14.mjs`, README i artefakt dojdą w kolejnych commitach tej gałęzi.
Liczby poniżej pochodzą z narzędzi w `narzedzia/` i są policzone na drzewach, a nie przepisane z raportów.

## Zakres pomiaru

- **Drzewo pomiaru:** `346012635` - commit scalający PR #518 (stan wskazany przez zespół).
- **Drzewo odniesienia:** `5b8c77c01` - HEAD wydania 13.
- **Okno:** 1 604 commity (394 scalenia, w tym 49 PR-ów #467-#518). 13 commitów Lovable po #518 nie wchodzi
  w zakres pomiaru.
- **Bez porównania z konkurencją** (polecenie zespołu). Wydajność strony głównej pochodzi z PageSpeed Insights
  (zrzuty z 18.10.2026, 11:30) i z lokalnego Lighthouse 13.5.0.

## Co jest już policzone

| Metryka                                    | Wydanie 13 | Wydanie 14 |
| ------------------------------------------ | ---------: | ---------: |
| Pliki produkcyjne `src/`                   |      4 094 |      4 347 |
| Wiersze kodu produkcyjnego                 |    874 452 |    971 581 |
| Pliki testowe                              |      3 260 |      3 429 |
| Przypadki testowe (`it`/`test`)            |     66 038 |     69 800 |
| `it.fails` (defekty udokumentowane testem) |        310 |        286 |
| Progi pokrycia per ścieżka                 |        947 |          0 |
| Skrypty `check:*` w `package.json`         |         50 |         29 |
| Migracje supabase / drizzle                |  1 082/176 |  1 237/332 |
| Pliki pgTAP / asercje                      |  137/2 678 |  198/4 574 |
| Polityki RLS / tabele z politykami         |    668/291 |    673/295 |
| Tabele z RLS bez żadnej polityki           |         42 |         52 |

Najważniejsza zmiana zasad w oknie: commit `c3f0c0e72` (2026-10-05) usunął wszystkie 947 progów per ścieżka,
21 bramek CI i job pokrycia. Pokrycie **nie jest już bramką CI** - zostaje jeden próg globalny
(instrukcje 79, funkcje 77, linie 80, gałęzie 73), liczony lokalnie przez `bun run test:coverage`.
W tym samym oknie doszły nowe bramki: `check:sql-definer-views`, `check:migration-lanes`,
`check:ts-sql-contract` i `check:on-conflict-arbiters`.

Trzy pliki pgTAP mają `plan(N)` niezgodny z liczbą asercji (`reg_foundations_test.sql`,
`metering_concurrency_test.sql`, `subscriptions_payment_grace_columns_test.sql`): plan 4 588, asercji 4 574.

## Mapa powiązań modułów (graf importów)

Narzędzie: `narzedzia/graf14.mjs.txt`, wynik: `graf14.json`.

- **Wszystkie 26 obszarów taksonomii tworzy jedną silnie spójną składową** - z każdego modułu da się dojść
  importami do każdego innego. Tak było już w wydaniu 13, okno tego nie rozplątało.
- 384 krawędzie moduł-moduł (wydanie 13: 381), 11 246 importów między modułami (10 433), 131 par modułów
  importujących się nawzajem (130).
- Najgrubsze krawędzie: moduł 22 (wydarzenia) do design systemu (610 importów), do i18n (516) i do modułu 20 (374).
- Tabele współdzielone przez najwięcej modułów: `profiles` (21 modułów), `posts` (15), `pages` (12),
  `site_settings`, `media`, `categories` (po 10).

Opis desynchronizacji, kroków ręcznych zamiast automatyzacji i konkretnych błędów synchronizacji powstaje
w przepływie agentów (7 obszarów) i trafi do rozdziału 18.

## Wydajność: PageSpeed Insights i Speed Index

| Profil  | Wydajność | Ułatwienia | Sprawdzone metody | SEO | FCP   | LCP   | TBT   | CLS   | Speed Index |
| ------- | --------: | ---------: | ----------------: | --: | ----- | ----- | ----- | ----- | ----------- |
| Desktop |        94 |         92 |               100 | 100 | 0,4 s | 0,5 s | 10 ms | 0,033 | **2,7 s**   |
| Mobile  |        98 |         95 |               100 | 100 | 1,7 s | 2,1 s | 0 ms  | 0     | **3,0 s**   |

Speed Index jest jedyną czerwoną metryką na desktopie: LCP 0,5 s, a wizualnie strona dochodzi do pełnego
obrazu dopiero po 2,7 s. Wstępne przyczyny z analizy dokumentu HTML i śladu Lighthouse (do potwierdzenia
w rozdziale 18, liczby lokalne są zebrane pod obciążeniem pomiarem pokrycia, więc są gorsze od PSI):

1. Sekcje nad zgięciem przychodzą strumieniowo za granicami `Suspense` w opakowaniach
   `content-visibility: auto`, po odpowiedzi bazy.
2. Obrazy karuzeli i okładki mają `loading="lazy"`, `fetchpriority="low"` i startowe `opacity: 0`,
   więc pojawiają się dopiero po hydratacji.
3. Dokument nie jest buforowany na brzegu (`x-nes-cache: MISS`, `cache-control: no-cache`).
4. Jeden arkusz CSS blokuje renderowanie (440 ms na mobile według PSI), nieużywany JS 198 KiB.
5. Dokument strony głównej waży ok. 482 KB, z czego większość to stan dehydratacji.

Klatki z krzywej kompletności wizualnej: `lighthouse/klatki/`, podsumowanie przebiegów:
`lighthouse/podsumowanie14.json`.

## W toku

- Pełny pomiar pokrycia w 12 shardach na `346012635` (moduły, funkcje, funkcjonalności, linie, gałęzie,
  instrukcje, pliki na zerze, martwe funkcje).
- Tory agentów T1-T9: mapa każdego modułu względem wydania 13, powiązania i synchronizacja, nowe defekty,
  rozliczenie rejestru 341 otwartych defektów (`rejestr-defektow14.json`). Bez etapu obalania.
- Śledztwo Speed Index (4 ścieżki + synteza z rekomendacjami) i mapa synchronizacji z rozliczeniem planu 17.15.
- Mediany Lighthouse (5 przebiegów na profil) po zakończeniu pomiaru pokrycia, z nagłówkiem `Accept-Language: pl`.

## Pliki

| Plik                                           | Zawartość                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `metryki14.json`, `inwentarz14.json`           | skala obu drzew, inwentarz modułów                                |
| `progi14.json`                                 | progi pokrycia, `it.fails`, `skip`, `only`                        |
| `rls14.json`, `pgrls14.json`, `sieroty14.json` | RLS z odtworzenia migracji, pgTAP, sieroty migracji               |
| `dyscypliny14.json`, `typy14.json`             | dyscypliny kodu i rzutowania typów                                |
| `graf14.json`                                  | graf importów moduł-moduł, cykle, tabele i RPC współdzielone      |
| `rejestr-defektow14.json`                      | 341 defektów do rozliczenia (otwarte z wydań 11-13)               |
| `lista-torow14.json`                           | skala i delta każdego toru agentów                                |
| `ed13-pokrycie-moduly.json`                    | pokrycie per moduł z wydania 13 (punkt odniesienia)               |
| `e2e14.txt`                                    | liczby testów Playwright z `--list` per konfiguracja              |
| `lighthouse/`                                  | podsumowanie przebiegów Lighthouse i kluczowe klatki              |
| `narzedzia/`                                   | skrypty, którymi policzono powyższe (jako `.txt`, do odtworzenia) |

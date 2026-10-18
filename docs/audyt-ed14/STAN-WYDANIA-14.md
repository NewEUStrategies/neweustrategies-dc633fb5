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

## Pomiar pokrycia: wynik

Dwanaście shardów (`--shard=N/12`, raport blob) scalonych jak w CI, provider `istanbul`, ta sama reguła mianownika co
w wydaniu 13 (cały `src/`). Pliki: `pokrycie14.json` (per plik i per moduł), `pokrycie14-delta.json` (zera, spadki,
nowe pliki, progi), `przebieg14.json` (wynik suity).

| Metryka                  | Wydanie 13 | Wydanie 14 |
| ------------------------ | ---------: | ---------: |
| Pliki w mianowniku       |      3 972 |      4 216 |
| Linie                    |     98,84% |     95,69% |
| Instrukcje               |     98,00% |     94,64% |
| Funkcje                  |     98,32% |     94,05% |
| Gałęzie                  |     94,02% |     90,15% |
| Pliki na zerze           |         14 |         61 |
| Niepokryte linie         |      1 570 |      6 628 |
| Martwe funkcje (nazwane) |         68 |        309 |

**Suita jest zielona:** 3 421 plików testowych, 86 026 przypadków, 0 czerwonych, 51 pominiętych. Próg globalny
(instrukcje 79, funkcje 77, linie 80, gałęzie 73) ma 15,6-17,2 pp zapasu, więc nic go nie narusza.

**Spadek to w większości skutek decyzji, nie regresji kodu.** Commit `c3f0c0e72` usunął 215 plików testów,
które według jego opisu pisano pod liczbę, a nie pod zachowanie. 56 z 61 plików na zerze miało w wydaniu 13
pokrycie: 40 edytorów bloków (`src/components/admin/blocks/edit/`) przejeżdżała macierz `blockEditMatrix`
(6 części, po rejestrze edytorów), 9 widoków bloków macierz `blockMatrix` (po `BLOCK_RENDERERS`), a 5 pulpitów
analitycznych osobne testy renderu. Wszystkie te pliki testów usunięto w tym commicie. Teraz liczba mówi
uczciwie, że tych ekranów nie sprawdza żaden test zachowania. Na zerze jest też 5 nowych plików z okna:
`RangeScale.tsx`, `settlementStatus.functions.ts`, `eventInvoiceFx.functions.ts`, `eventInvoiceVies.functions.ts`
i trasa `admin.billing-settlements.tsx`.

Moduły z największą zmianą linii: 3 (silniki treści: bloki i page builder) 88,29% (-10,44 pp, 49 plików na zerze), 17 (analityka
i BI) 90,46% (-7,58 pp; funkcje -12,04 pp), 20 (platforma, backend, SSR) 91,44% (-7,33 pp), 8 (SEO, feedy, dane strukturalne) 96,13%
(-3,46 pp). W górę: moduł 4 98,26% (+5,38 pp, cztery ekrany zeszły z zera) i moduł 12 100% (+1,84 pp).
269 nowych plików z okna ma razem 95,57% linii i 86,97% gałęzi.

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

## Wyniki agentów: komplet 31 torów

Plik `agenci/migawka14.json` zawiera wyniki wszystkich 31 torów agentów (29 map modułów i dwa przekroje: baza i CI):
mapy modułów, powiązania i mechanizmy synchronizacji, nowe defekty i rozliczenie rejestru. Agenty przerwane limitem
sesji wznowiono. Agenci sami sprawdzają swoje ustalenia (pole `samosprawdzenie`, pewność `pewny` albo `prawdopodobny`);
etapu obalania nie ma. `agenci/si-synteza14.json` to synteza śledztwa Speed Index, a `funkcjonalnosci14.json` -
pokrycie 428 funkcjonalności (78 nowych; wszystkie 350 nazw z wydania 13 przeniesione, wzorce obejmują 100% plików).

- **89 nowych defektów:** 1 krytyczny, 6 wysokich, 30 średnich, 52 niskie (68 pewnych, 21 prawdopodobnych).
- **Rozliczenie rejestru:** agenci rozliczyli 197 z 341 pozycji (40 naprawionych, 24 zmienione, 133 otwarte).
  Pozostałe 144 leżą w plikach bez zmian w oknie i zostaną rozliczone mechanicznie w rozdziale 18.

Najpoważniejsze:

1. **Krytyczny, prawdopodobny.** Migracja `20261007140300_subscriptions_tenant_from_owner` (trigger, który
   przypina subskrypcji najemcę z profilu właściciela) istnieje tylko w pasie supabase. W pasie drizzle nie ma
   jej bliźniaka, a webhook `webhookDispatch.server.ts` zapisuje subskrypcję bez `tenant_id` i liczy na ten
   trigger. Rozjazd pasów sprawdziłem sam: w `drizzle/migrations` nie ma `subscriptions_pin_tenant`.
   Skutek na produkcji zależy od tego, czy migrację zastosowano tam inną drogą.
2. **Wysoki, prawdopodobny.** Z tego samego powodu w pasie drizzle brakuje `20261007140200_release_coupon_server_only`.
3. **Wysoki, pewny.** Wyszukiwanie głosowe (Web Speech w trybie `continuous`) wysyła frazę przy każdym
   kolejnym zdarzeniu po pierwszym wyniku końcowym: seria nawigacji do `/search`, wpisów w „ostatnich” i logów
   `log_search_query`.
4. **Wysoki, pewny.** Zbiorcze wycofanie zgody marketingowej przez super admina w zakresie „Wszystkie tenanty”
   po cichu nie wycofuje zgody kontaktom innych najemców, a panel i dziennik audytu raportują sukces.

Dwie obserwacje z przekrojów, istotne dla mapy synchronizacji i dla Speed Index:

- **Bramka pasów działa w jedną stronę.** `check:migration-lanes` wymaga decyzji dla każdego wpisu dziennika
  drizzle, ale migracji obecnej tylko w pasie supabase nie widzi. Według skanu agenta 29 z 252 migracji
  supabase od 2026-09-20 nie ma w drizzle odpowiednika o tym samym SQL-u, w tym 22 z 7-9 października.
- **Okładka strony głównej przychodzi prawie na końcu strumienia.** W zimnym dokumencie (`x-nes-cache: MISS`)
  sekcja hero jest za granicą `Suspense` i przychodzi jako przedostatni segment, na ok. 81% długości dokumentu.
  Rozgrzewka danych nad zgięciem liczy budżet od wspólnego terminu 600 ms. Gdy pobranie strony i trybu trwa
  dłużej, budżet spada do zera, a preload obrazu hero nie trafia do `<head>`.

## W toku

- Rozliczenie 12 pozycji planu 17.15 i dwa ostatnie śledztwa synchronizacji (dokumentacja, graf) - agenci kończą pracę.
- Weryfikator `scripts/audit/verify-edition-14.mjs`, README PL/EN i artefakt.

Rozdział 18 jest już w `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (sekcja 18.11 czeka na agentów planu).

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

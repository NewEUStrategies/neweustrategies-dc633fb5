# Platforma — kontynuacja po scaleniu PR #337

Baza: `054cda52479e9546b02d1d5ed4bd137295522529`, 6 września 2026.
Naprawy zastąpiły 34 deklaracje `it.fails` rzeczywistymi testami regresji.
Ten dokument aktualizuje punkt wznowienia w
[raporcie pierwszego PR](PLATFORM_SSR_REMEDIATION_2026-09-06.md).

## Co wykazała weryfikacja poprzedniego PR

[CI 34036599265](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34036599265)
potwierdziło verify, build z boot-testem, pg-harness i pgTAP. E2E oraz Lighthouse
również zakończyły się sukcesem. Pełna suita zebrała i zaraportowała 65 862
przypadki: 65 444 przeszły, 368 stanowiło oczekiwane porażki, 50 pominięto.
Rachunek wykonania był kompletny.

**Pokrycie nie przeszło bramki.** Surowe LCOV zawierało ujemne liczniki gałęzi
w PostEditor, PostBlockEditor oraz usePendingCounters. Wyświetlane wyniki
modułu — linie 98,29%, gałęzie 95,23%, funkcje 96,91%, instrukcje 97,58% —
nie są poprawnym dowodem spełnienia celu. Ujemny licznik odtworzono lokalnie
także na pojedynczym pliku testowym i Node 24.19.0.

W tej kontynuacji używamy oficjalnego dostawcy `@vitest/coverage-istanbul`
4.1.7, który instrumentuje kod bezpośrednio. Nie zerujemy błędnych liczników,
nie zmniejszamy mianownika ani progów. Pozostają globalne i szczegółowe
bramki repozytorium, próg 95% każdej miary modułu oraz kontrola surowego LCOV
i kompletności testów. Rachunek zapisuje także nazwę silnika pokrycia.
Wyniki różnych silników nie dowodzą przyrostu pokrycia;
nowy wynik wymaga pełnego przebiegu na tej gałęzi.

Archiwum [Lighthouse 34036599269](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34036599269)
zostało pobrane i sprawdzone: zawiera sześć nowych raportów HTML, sześć LHR
JSON, asercje, odnośniki i log serwera. Naprawa archiwizacji jest potwierdzona.
Sukces tego joba nadal nie dowodzi osiągnięcia LCP 2500 ms ani wyniku wdrożenia.

## Zmiany tej kontynuacji

| Obszar                    | Poprawione zachowanie                                                                                                                                                                                                | Dowód regresji                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zapytania publiczne       | Błędy Supabase są propagowane zamiast fałszywej pustki, niepełnej taksonomii i wymyślonych adresów. Obejmuje public, archives, relatedPosts, programs, authorCv, staticPageSeo, blocks, megaMenu, nextPost i series. | QueryClient z rzeczywistymi queryFn i odmowami na granicy bazy; osobne przypadki rzeczywiście pustych danych.                                                |
| Archiwum i nawigacja      | Archiwum wskazuje `/search` z filtrem miesiąca UTC, uwzględnia rok przestępny i odrzuca niepoprawne daty. Następny wpis jest nowszy, poprzedni starszy.                                                              | Przejście emitowanego URL przez parser i filtry wyszukiwarki oraz odczyt sąsiadów zależny od kierunku zapytania.                                             |
| Sitemapy i ścieżki feedów | Wspólny odczyt opublikowanych stron, paginacja po stabilnym ID, wsadowe RPC po maksymalnie 500 ID, odrzucenie pustej ścieżki i obcych ID. Wszystkie kolektory paginują odczyty i zgłaszają odmowy bazy.              | Prawdziwy klient Supabase z atrapą HTTP, 1203 adresy, niższy limit serwera, błąd późniejszej strony, parytet adresów feed/sitemapa i bramka zakresu tenanta. |
| Embeddingi                | Deadline 10 s obejmuje odpowiedź i body, anuluje fetch i nie blokuje kolejnej próby. Indeksy są unikalne i w zakresie wejścia; wektory zawierają 768 skończonych liczb.                                              | Zawieszone nagłówki/body, ponowienie, usuwanie timera, duplikaty i niepoprawne indeksy/współrzędne.                                                          |
| Jobs tick                 | Wszystkie interwały używają chwili rozpoczęcia tego samego ticka; awaria logu nie zmienia wyniku wykonanej pracy.                                                                                                    | Przekroczenie granicy minuty podczas pracy i odmowa zapisu logu.                                                                                             |
| Link checker              | URL odrzucony przez ochronę SSRF nie uruchamia sprawdzania archiwum ani sugestii podmiany.                                                                                                                           | Odmowa guardu, brak wywołania archiwum i jego znacznika w zapisie.                                                                                           |
| Import WordPress          | Odmowa deduplikacji zatrzymuje zapis; upload nie nadpisuje istniejącego obiektu, więc rollback dotyczy własnego uploadu. URL w treści widgetów jest przepisywany także w sekcjach zagnieżdżonych.                    | Odmowa odczytu, upload/insert/rollback, zagnieżdżone kolumny i treść widgetów.                                                                               |
| Odczyty maszynowe         | Błędy zapytań zostawiają ślad z etykietą; klucz metadanych mediów używa SHA-256 całego zbioru URL, eliminując kolizje wspólnego prefiksu.                                                                            | Odmowa bazy, parytet adresów, dwa zbiory URL o takim samym długim początku.                                                                                  |
| Poczta i preview          | Wysyłka transakcyjna stosuje istniejącą wspólną politykę suppression. Zamknięcie watchdogu anuluje sondę, timeout i odtwarzanie scrolla.                                                                             | Polityka blokad, cleanup i brak późnych skutków po zamknięciu.                                                                                               |
| Pusta strona główna       | Tekst pochodzi ze słownika aktywnego języka także przed hydratacją.                                                                                                                                                  | `renderToString` z prawdziwym i18next, PL/EN i przeciwnym językiem instancji.                                                                                |

## Weryfikacja bieżącej partii

Wybrane testy są dowodem regresji, nie procentem pokrycia całego modułu.
Zestaw zmian przeszedł 956 przypadków w 21 plikach (pierwotnie 955 sukcesów
i jedna asercja wskazująca stare położenie RPC; po aktualizacji bramki
ponowiono wszystkie jej 19 przypadków oraz oba sąsiednie pliki, 181/181).
Pełny typecheck kodu backendu i wspólnego czytnika stron zakończył się
sukcesem; końcowy typecheck całej partii jest również wymagany w CI.
Nowe wykonywalne pliki są automatycznie dodawane do zakresu pomiaru przy
zachowaniu wszystkich 208 plików zamrożonych w audycie. Pierwsza partia
obejmowała 217 plików; po synchronizacji z main `371fa5783` zakres wynosi
218, ponieważ uwzględnia również nową bramkę zegara.

Pełne wyniki bieżącego PR zostaną zapisane po wykonaniu CI. Źródłem liczb
będzie artefakt `coverage-<SHA>` wraz z `test-accounting.json` i
`reports/platform-coverage.json`. Ten ostatni wskazuje niepokryte linie,
gałęzie i funkcje każdego pliku. Progi JS/CSS pozostają bez zmian.

## Granice dowodu

Cel LCP 2500 ms i pomiar pod adresem wdrożenia wymagają potwierdzenia.
Ustawienia ochrony main, prawdziwi właściciele dziewięciu domen i cykl
płatności w środowisku operatora pozostają punktami z poprzedniego raportu.
Testy z atrapą backendu nie zastępują tych danych ani decyzji organizacyjnych.

## Pomiar pierwszego commita tej kontynuacji

Commit `5ba28edf9264c29a7db401cc736b84f1b6f44db0`:
[CI](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34043789903),
[E2E](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34043789930),
[Lighthouse](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34043790031).
Verify, build, siedem testów bootu, E2E, pg-harness oraz pgTAP przeszły.
Pełna suita wykonała 65 879 przypadków: 65 495 sukcesów, 334 oczekiwane
porażki i 50 pominięć. Żaden przypadek nie zaginął, ale jedno nieobsłużone
odrzucenie importu po zamknięciu środowiska unieważniło rachunek jakości.
Nie przeszły także niektóre szczegółowe progi instrumentacji Istanbul.
Tego przebiegu nie przedstawiamy jako spełnienia celu pokrycia modułu.

| Miara artefaktu                              |              Wynik |             Istniejący limit |
| -------------------------------------------- | -----------------: | ---------------------------: |
| Startowy JS, gzip                            |          578,2 KiB |                      579 KiB |
| Wszystkie chunki JS, gzip                    |         4342,6 KiB |                     4351 KiB |
| Publiczny CSS, gzip                          |           73,2 KiB |                       74 KiB |
| Suma CSS, gzip                               |           85,8 KiB |                       87 KiB |
| Gotowość hydratacji `/cookies` od sondy HTML |             271 ms |             patrz test bootu |
| TTFB `/cookies`, osobna para MISS / HIT      |    5018,8 / 2,2 ms |          patrz test MISS/HIT |
| Lighthouse `/en`: mediana LCP / FCP          | 2713,6 / 2713,6 ms | cel LCP 2500 ms niespełniony |
| Lighthouse `/blog`: mediana LCP / FCP        | 3865,4 / 2667,2 ms | cel LCP 2500 ms niespełniony |

Lighthouse: po trzy przebiegi, LHR 12.6.1, sieciowy UA Chrome/136. TBT wyniosło
36 i 39 ms, CLS 0. To pomiar lokalnego artefaktu z niedostępnym backendem,
nie wdrożenia. W sprawdzonym LHR `/blog` elementem LCP jest tekst bannera
cookies, a nie artykuł. Zmierzony widok nie zastępuje testu reprezentatywnej
strony wypełnionej danymi. Standardowe symulowane metryki Lighthouse nie są
bezpośrednio porównywalne z rzeczywistym TTFB nawigacji Playwright.

Dalsze testy niezależnych odmów: 375/375 w sześciu plikach testowych.
W ich lokalnym pomiarze Istanbul `authorCv`, `relatedPosts`, `pagedRows`,
`publishedPagePaths`, `publishedContent` i `sitemapEntries` mają po 100%
każdej miary i nie zawierają ujemnych liczników LCOV. Ten wybrany zestaw
nie zastępuje pełnego CI ani końcowego pomiaru 217 plików.

## Domknięcie problemów wskazanych przez pełne CI

Opcjonalne rozgrzewanie chunków obsługuje wszystkie odrzucenia przez
`Promise.allSettled`; awaria jednego importu nie blokuje pozostałych.
Test z celowo odrzuconym importem działa przy aktywnej bramce błędów
nieobsłużonych. Test dialogu importu WordPress izoluje harmonogram tej
optymalizacji, zachowując prawdziwy renderer podglądu.

Dodano dowody zachowania przy niezależnych odmowach zapytań, niepełnych
ustawieniach tickera, braku tłumaczenia zajawki, zwijaniu szczegółów zapytania
eksperckiego i odrzuceniu całego batcha analityki. Kontrola dodatnia llms.txt
sprawdza przypisanie treści obu języków do adresów i kategorii tenanta.
Usunięto niewykorzystywane wartości domyślne prywatnych parametrów i
nieosiągalne zapasowe tablice w dokumentach konstruowanych wewnętrznie.

Pomiar celowany: 17 plików testowych, 535 sukcesów i 3 istniejące oczekiwane
porażki, bez błędów nieobsłużonych. Wszystkie 11 sprawdzanych progów
per plik przechodzi. To kontrola napraw wskazanych przez CI; globalna
bramka 95% nadal wymaga osobnego pełnego przebiegu, bez scalania raportów
z różnych rewizji i bez obniżania progów.

Synchronizacja z main `371fa5783` zachowuje zmiany scalone w trakcie pracy,
w tym PR #338. Nowa bramka zegara wskazała `blocksData.test.ts`: plik używa
teraz wspólnego `freezeClock()`, a 81 jego testów przechodzi. Usunięto jego
wpis z rejestru długu, więc powrót niezabezpieczonych dat będzie blokowany.
Formatowanie dwóch plików przyjętych z main usuwa wszystkie osiem błędów
lintowania tego przebiegu. Typecheck, SQL, E2E, Lighthouse oraz build
z boot-testami przeszły na połączonym drzewie.

Kontrola pokrycia zmian z main ujawniła również brak testów nowej sekcji
przełączników w `ThemeOptionsPane`. Dodano zapis wszystkich presetów,
własnych wymiarów, trzech kolorów i typografii, odzyskiwanie wartości pustych
oraz zgodność podglądu ze szkicem. Test sprawdza także zachowanie sąsiedniej
gałęzi nagłówka po zapisie. Celowany pomiar przywraca istniejące progi panelu.

Kolejna integracja: main `5a34a0013` zawiera scalony w trakcie weryfikacji
PR #340. Zachowano jego testy, uzupełniając przypisanie `content.functions.ts`
do funkcjonalności zapisu CMS. Cztery pliki testowe korzystają ze wspólnego
zamrożenia zegara; rejestr długu maleje do 219 wpisów. Fixture karty mega menu
używa `Json` zamiast `unknown`, zgodnie z kontraktem serializowanego widgetu.
Taksonomia i bramka zegara przechodzą. Celowany przebieg pięciu plików:
180 sukcesów i 6 istniejących oczekiwanych porażek.

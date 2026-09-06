# Platforma — kontynuacja po scaleniu PR #337

Baza: `054cda52479e9546b02d1d5ed4bd137295522529`, 6 września 2026.
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
i kompletności testów. Wyniki różnych silników nie dowodzą przyrostu pokrycia;
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
zachowaniu wszystkich 208 plików zamrożonych w audycie. Bieżący zakres to
217 plików.

Pełne wyniki bieżącego PR zostaną zapisane po wykonaniu CI. Źródłem liczb
będzie artefakt `coverage-<SHA>` wraz z `test-accounting.json` i
`reports/platform-coverage.json`. Ten ostatni wskazuje niepokryte linie,
gałęzie i funkcje każdego pliku. Progi JS/CSS pozostają bez zmian.

## Granice dowodu

Cel LCP 2500 ms i pomiar pod adresem wdrożenia wymagają potwierdzenia.
Ustawienia ochrony main, prawdziwi właściciele dziewięciu domen i cykl
płatności w środowisku operatora pozostają punktami z poprzedniego raportu.
Testy z atrapą backendu nie zastępują tych danych ani decyzji organizacyjnych.

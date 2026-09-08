# Platforma, backend, infrastruktura i SSR — naprawy po audycie

Aktualizacja po scaleniu: [kontynuacja i weryfikacja punktu wznowienia](PLATFORM_AUDIT_COMPLETION_2026-09-06.md).

Baza zmian: `c239ab891c22b72fb329af9596394f28b9bfa85e` (`main`, 6 września 2026).
Zakres pomiaru zachowuje wszystkie **208 plików** przypisanych do modułu 20
w audycie. Korekta klasyfikatora nie usuwa z niego plików: dołączane są również
wykonywalne pliki aktualnie przypisane do platformy. Po wydzieleniu `RouteLoadingSkeleton` zakres obejmuje **215 plików**. Wyłączenia kodu generowanego
i testów pozostają takie jak w istniejącej konfiguracji V8.

## Zmiany i dowody

| Obszar                          | Stan bazy i zmiana w tym PR                                                                                                                                                                                                                                                                  | Dowód                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Druga fala korzenia             | Baza miała ograniczenie 500 ms, ale nadal czekała na całą falę. Teraz loader rozpoczyna pracę bez `await`; nagłówek i stopka korzystają ze wspólnej bramki danych we własnych granicach `Suspense`. Treść trasy może opuścić serwer wcześniej.                                               | `platformChromeWarmup.test.tsx`: rzeczywisty `renderToPipeableStream`, treść przed rozstrzygnięciem chrome, ponowienie po czyszczeniu zapytań przez SSR, niezależność żądań. |
| Prefetch strony głównej         | `stream` w `HomeBuilderContent`, prefetch pierwszych sekcji i wspólny budżet były już wdrożone. Zachowane; druga fala nie dodaje osobnego oczekiwania do loadera.                                                                                                                            | Istniejące testy `homeRoute`, budżetu strony głównej i renderera; boot PL/EN na artefakcie.                                                                                  |
| Cache renderów zdegradowanych   | Zapis sprawdza finalny `Response`, a nie wyłącznie wcześniejsze nagłówki h3. Rejestruje żądanie i ponownie sprawdza jego sygnał degradacji po zakończeniu strumienia. Zimna granica chrome oznacza dokument jako `private, no-store` przed wysłaniem powłoki.                                | `platformDeferredCache.test.ts`: L1/L2, późna degradacja strumienia, 500, no-store, zachowanie Link przy HIT.                                                                |
| Loadery publicznych powierzchni | W aktualnej bazie wskazane loadery i `useSuspenseQuery` już istnieją; powłoka wydarzenia ma head z danych i SSR JSON-LD. PR zachowuje te kontrakty.                                                                                                                                          | Istniejące testy tras; dodatkowe testy renderu publicznego obejmujące blokady dostępu, układy, typy treści i szablony stron.                                                 |
| CSS                             | Panel otrzymuje osobny arkusz. Skaner Tailwind emituje w nim klasy nieobecne w części wspólnej. Publiczny renderer buildera pozostaje we wspólnym arkuszu.                                                                                                                                   | Test prawdziwego skanera, kontrola właściciela importu CSS oraz asercje braku arkusza panelu w publicznym HTML i po hydratacji.                                              |
| Słownik aktywnego języka        | Mechanizm preloadu PL/EN istniał w bazie. Rozdzielono ponadto słowniki formularza logowania, wyszukiwarki i ustawień panelu, aby nie obciążały korzenia bez potrzeby.                                                                                                                        | Testy parytetu i18n i asercje rzeczywistego nagłówka `Link` w boot-teście PL/EN.                                                                                             |
| Czas i język                    | Dwie pozostałe decyzje o czasie w przeglądzie wydarzenia używają `useNowMs`; początkowy SSR i hydratacja korzystają z tego samego stanu. Zapisany HTML nie zmienia decyzji wskutek upływu czasu między renderami.                                                                            | `renderToString` w dwóch językach, po przekroczeniu daty wydarzenia i ze zmianą strefy hosta. Pozostałe wzorce deterministycznego czasu z bazy zachowane.                    |
| Startowy JS i raport bundla     | Próg domknięcia startowego 579 KiB istniał. Usunięto importy słowników panelu z korzenia. Raport rozróżnia publiczny CSS od sumy CSS, a aktualizacja baseline nie może ominąć czerwonej bramki.                                                                                              | Kontrole negatywne: wzrost wyłącznie startowego JS, nieznany arkusz publiczny, próba rozluźnienia limitu przez zmienną CI, osobne wiadra vendorów.                           |
| Opcje `handler.fetch`           | Drugi argument otrzymuje opcje frameworka. `onEarlyHints` zbiera modulepreloady, które są scalane z Link po nałożeniu nagłówków h3 i przed odroczonym zapisem dokumentu. Tożsamość strumienia body jest zachowana.                                                                           | `platformPreloads.test.ts`, test wejścia serwera i odpowiedzi z uruchomionego builda Node.                                                                                   |
| Boot na buildzie                | Oddzielny build smoke i workflow boot-testów istniały. Poprawiono negocjację języka w teście home. Każdy build czyści własne katalogi wyjściowe, żeby stare chunki nie fałszowały pomiaru.                                                                                                   | Boot testy produkcyjnego artefaktu; bramki grafu, rozmiaru i czystości wejścia wykonują się przed nadpisaniem `.output` buildem smoke.                                       |
| Pomiar czasu                    | Zachowane testy czasu artefaktu, w tym osobne kryteria dla MISS/HIT. Klasyfikacja Lighthouse zależy od faktycznego User-Agent: konfiguracja Lighthouse 12 w repo używa desktopowego UA Chrome, rozpoznawanego jako zwykła przeglądarka. Wyników nie przypisujemy automatycznie ścieżce bota. | Raport Playwright z joba build. Lokalne odczyty HTTP są diagnostyką, a nie pomiarem wydajności wdrożenia produkcyjnego.                                                      |

## Pokrycie i jakość pomiaru

`bun run test:platform` uruchamia pełną suitę z instrumentacją ograniczoną do
zachowanego zakresu modułu. Każda z czterech miar ma próg **95%**: linie,
instrukcje, funkcje i gałęzie. `bun run check:platform-coverage` liczy sumę
liczników, a nie średnią procentów plików. Nie zaokrągla wyniku przed porównaniem
z progiem. Brak pliku, błędny licznik lub niepełny rachunek wykonania testów
powoduje odrzucenie pomiaru.

CI publikuje HTML, JSON, JSON summary, LCOV oraz rachunek wykonania testów.
`reports/platform-coverage.json` zawiera dla każdego pliku także numery
niepokrytych linii, identyfikatory gałęzi i nazwy niewykonanych funkcji.
`expectedFailed`, `failed`, `skipped` i przypadki bez wyniku są raportowane
oddzielnie. Istniejące globalne i szczegółowe progi repozytorium pozostają
obowiązujące. Błąd importu pliku przed zebraniem przypadków jest niepełnym
przebiegiem. Ujemne lub niepoprawne surowe liczniki LCOV odrzucają pomiar;
nie zastępujemy ich zerami. Node 24.19.0 jest przypięty w CI, E2E i Lighthouse.

## Weryfikacja i odtwarzanie pomiaru

Źródłem ostatecznego pokrycia jest job `test` dla aktualnego commitu
[PR #337](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/pull/337/checks).
Artefakt `coverage-<SHA>` zawiera pełny raport i dokładne liczniki. SHA dotyczy
commitu scalającego PR testowanego przez GitHub, a nie wyłącznie gałęzi autora.
Opis PR podaje wynik wszystkich czterech miar i rachunek wykonania testów.
Lokalne łączenie raportów z wybranych testów służy diagnozie luk; nie zastępuje
tego pełnego przebiegu.

Przy odtwarzaniu użyj Node **24.19.0**, Bun **1.2.23**, `TZ=UTC` oraz zależności
z `bun install --frozen-lockfile`. `bun run test:coverage` wykonuje pełną suitę
z istniejącymi progami repozytorium; potem `bun run check:platform-coverage`
weryfikuje aktualny zakres plików. Alternatywne `bun run test:platform` ogranicza
instrumentację do platformy, lecz nadal uruchamia całą suitę.

Pierwszy przebieg (`34030646824`, Node 22.23.2) wykrył ujemne liczniki V8 oraz
błąd importu w atrapie `createIsomorphicFn`. Nie jest dowodem osiągnięcia progu.
Poprawiono atrapę, rachunek modułów testowych i luki formularzy klubów;
ujemne liczniki są teraz błędem pomiaru, nie wartościami zamienianymi na zero.

## Pomiary artefaktu z CI

Poniższy punkt odniesienia dotyczy kodu `3b3252135e969154f97b865045f1f893d013ac39`.
GitHub testował commit scalający `e35bd67acce97e4da03a8fdf6cd864261a80f18d`;
oba mają identyczne drzewo `364951a249e654f1fb5fcc1229aa420cb4b2fa64`.

[CI 34034344598](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34034344598)
potwierdza zielone: `verify`, build Cloudflare, bramki rozmiaru/grafu/czystości
wejścia, **7 testów przeglądarkowych** na buildzie Node, pgTAP
(102 pliki, **1883 asercje**) i pięć harnessów Postgresa.
[E2E 34034344592](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34034344592)
ma **82 testy zakończone powodzeniem i 13 pominiętych**, a osobny przebieg
z migracjami i seedem Supabase — **12 zakończonych powodzeniem**.
Pomijanych testów nie zaliczamy do pozytywnego wyniku.

| Rozmiar z buildu Cloudflare | KiB gzip | Limit KiB gzip |
| --------------------------- | -------: | -------------: |
| Cały JS                     |   4341,5 |           4351 |
| Publiczny JS                |   2699,1 |           2715 |
| Domknięcie startowe         |    578,0 |            579 |
| Największy chunk            |    275,3 |            280 |
| Publiczny CSS               |     73,2 |             74 |
| Suma CSS                    |     85,8 |             87 |

Zapasy startowego JS i publicznego CSS są małe. Każdy kolejny wzrost wymaga
optymalizacji, a nie automatycznego podnoszenia limitu. Publiczny arkusz
zmniejszył się z 81,3 do 73,2 KiB gzip. Suma arkuszy rośnie przez koszt
podziału, dlatego limit całego CSS zmieniono z 82 na 87 KiB i dodano osobny
limit publicznego CSS 74 KiB. Limity JS nie zostały podniesione.
Próba `experimentalMinChunkSize: 2048` zmniejszała sumę JS, ale przekraczała
limit startu; przyjęty wariant **512 B** przechodzi oba ograniczenia.

`server.build.inlineCss` pozostaje wyłączone. Po podziale wspólny arkusz może
być ponownie użyty z cache przeglądarki; osadzenie go w każdym HTML zwiększa
rozmiar dokumentów. Nie wykonano porównania A/B uzasadniającego ten koszt.
Opcje `handler.fetch` są poprawnie przekazywane, więc decyzja nie wynika już
z niedziałającego drugiego argumentu.

Playwright, `/cookies`, localhost, build Node, zastępczy backend:

| Pomiar                              |                 Wynik |
| ----------------------------------- | --------------------: |
| TTFB pierwszej nawigacji            |             5019,0 ms |
| Gotowość hydratacji od sondy w HTML |                341 ms |
| FCP                                 |             5196,0 ms |
| FCP minus TTFB                      |              177,0 ms |
| Transfer JS do odczytu metryk       | 2625,4 KiB / 72 pliki |
| Część statyczna / pozostałe importy |    1980,3 / 645,1 KiB |
| Osobna para cache MISS / HIT        |       5025,6 / 8,7 ms |

To **pomiar artefaktu na localhost**, bez modelowania sieci czytelników.
MISS zawiera budżet niedostępnego backendu; HIT omija ponowne wykonanie SSR.
Nie jest to obietnica odzyskania określonej liczby sekund na każdej trasie.
Transfer nie jest porównywalny z limitem gzip: serwer Node oddaje te zasoby
bez kompresji; `decodedBodySize` wyniósł 2604,3 KiB.

[Lighthouse 34034344591](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/actions/runs/34034344591)
wykonał po trzy pomiary `/en` i `/blog`. Mediany z asercji: LCP **2761,1 ms**
i **3931,0 ms**, FCP **2721,1 ms** i **2679,1 ms**. Budżety TBT i CLS przeszły,
ale cel LCP 2500 ms nie został spełniony. LCP/FCP mają w trybie lokalnym poziom
`warn`; zielony job nie oznacza dobrych Core Web Vitals wdrożenia.
Raport LHR 12.6.1 potwierdza `environment.networkUserAgent` z Chrome/136,
różny od hostowego HeadlessChrome/149. Framework klasyfikuje żądanie sieciowe
jako przeglądarkę. Ścieżka bota wymaga oddzielnego pomiaru z jawnym UA bota.

W tym przebiegu archiwum Lighthouse zawierało wyłącznie log serwera:
`upload-artifact@v4` domyślnie pomija ukryty katalog `.lighthouseci`.
Workflow teraz jawnie go uwzględnia, zachowuje raporty obu trybów przez 30 dni
i usuwa historyczny raport deweloperski przed zbieraniem nowych danych.
Wyniki kolejnych uruchomień są dostępne w ich artefaktach, wraz z SHA przebiegu.

## Dodatkowe naprawy wynikające z testów

- Pipeline błędów uwzględnia zarówno `status`, jak i `statusCode`. Rozpoznawanie
  anulowania obsługuje także cykliczny łańcuch `cause`, bez przepełnienia stosu.
- Strażnik dokumentu przekazuje anulowanie do źródła, a błąd źródła rejestruje
  osobno od poprawnego zakończenia. Ucięty HTML otrzymuje sygnaturę diagnostyczną.
- Dashboard administratora pobiera dokładne liczniki przez zapytania HEAD,
  filtruje tenant oraz pokazuje błąd z ponowieniem zamiast fałszywych zer.
- Odtwarzanie kontraktu bazy respektuje kolejność DROP/CREATE wewnątrz migracji;
  zmiana nazwy obiektu schematu zarządzanego nie tworzy fikcyjnej tabeli publicznej.
- Błąd chunka zapisany jako zwykły obiekt z `message` uruchamia właściwe odzyskanie.
- Gateway AI zachowuje nagłówki `Request`, przestrzega ograniczenia odczytu
  strumienia przez konsumenta i zwalnia reader przy anulowaniu oraz błędzie.
- Watchdog preview obsługuje przeglądarkę blokującą sam odczyt `sessionStorage`.
- Autorzy reagują na zmiany profilu i ról bez zmiany liczby użytkowników;
  błędy pobrania liczników nie są prezentowane jako zero publikacji.
- Dashboard monetyzacji odróżnia błędy i ładowanie od rzeczywistych danych;
  pusty lub odwrócony zakres dat nie uruchamia błędnego RPC.
- Utrata połączenia podczas zapisu czasu czytania odblokowuje formularz
  i pokazuje błąd zamiast pozostawiać go w stanie zapisywania.
- Testy księgi darowizn mają jawny zegar; CI używa UTC.
- Kontrakt pgTAP weryfikacji profilu uwzględnia aktualne uprawnienia kolumnowe
  i oficjalne RPC weryfikacji; nie oczekuje dostępu usuniętego migracją.
- Snapshot autoryzacji jest wygenerowany z aktualnego zestawu migracji.

## Pozostałe decyzje administracyjne

Odczyt GitHub API z 6 września 2026 potwierdza `main.protected = false` i pustą
listę rulesetów. Sam PR nie aktywuje ochrony gałęzi. W ustawieniach repozytorium
trzeba wymagać PR, udanego `verify`, `test`, `build` i `pgtap`, aktualnej gałęzi,
rozwiązanych dyskusji i co najmniej jednego zatwierdzenia; zablokować force push
oraz usunięcie gałęzi głównej.

W rejestrze nadal brakuje właścicieli technicznych i zastępców dziewięciu domen.
Wynik zielonej bramki pokrycia nie jest dowodem obsadzenia tych ról. Przypisanie
konkretnych osób, dostępów i dyżurów wymaga rzeczywistej decyzji organizacyjnej;
nie zastępujemy jej fikcyjnymi kontami ani zmianą flagi `obsadzone`.

Pełny cykl płatności u rzeczywistego operatora wymaga środowiska testowego
operatora i jego poświadczeń. Testy jednostkowe oraz pgTAP nie stanowią dowodu
takiego przebiegu. Nie wykonujemy rzeczywistych obciążeń ani zmian produkcyjnej
bazy w ramach weryfikacji tego PR.

## Punkt wznowienia — zapis na prośbę użytkownika

6 września 2026: użytkownik poprosił o commit bieżącej pracy z uwagi na kończące
się kredyty. PR pozostaje roboczy. Poniższe poprawki są zapisane, ale ostatni
zestaw zmian wymaga pełnego przebiegu CI; nie ogłaszamy zakończenia całego modułu
ani potwierdzonego końcowego pokrycia 95%.

Ostatnia partia zmian:

- Wspólny `RouteLoadingSkeleton` jest domyślnym stanem pending routera oraz
  fallbackiem powłoki. Test montuje prawdziwy router z zawieszoną trasą.
- Test hydratacji używa rzeczywistej integracji Query i otwartego strumienia,
  sprawdzając zarówno zakończenie haka, jak i odbiór późniejszych danych.
- Server-Timing odrzuca ujemne i nieskończone czasy oraz NaN, zachowując
  pozostałe poprawne metryki.
- Filtry katalogu osób akceptują również numeryczne `1` zwracane przez parser
  search params routera; adres pozostaje kanoniczny.
- Lista czytelnicza pokazuje błędy i pozwala ponawiać odpowiednie zapytania;
  błąd zapisu localStorage nie usuwa pozycji z widoku. Sekcje mają poprawną
  hierarchię nagłówków i teksty PL/EN.

Przed zapisaniem tej partii zestaw czterech plików testowych przeszedł:
**91/91 testów** (router, montaż korzenia, lista czytelnicza, parametry osób).
Poprzednie uruchomienie objęło również testy trasy osób i Server-Timing.
Końcowy typecheck wykrył zbyt szeroki typ komponentu w harnessie; został
zawężony do `RouteComponent`. Powtórny pełny typecheck i build tej partii
pozostają do potwierdzenia w CI.

Dla wcześniejszego commita `7e41c0a014efb3b05b1616179e01972d14dbbae8`
potwierdzono w GitHub Actions sukces verify, build (wraz z boot-testem),
pg-harness i pgTAP. Pełny job test/coverage nadal trwał w chwili zapisu.
Te wyniki nie są dowodem poprawności późniejszych zmian.

Kolejne kroki po wznowieniu:

1. Sprawdzić pełne CI najnowszego SHA, wszystkie cztery liczniki pokrycia,
   kompletność rachunku testów i surowe LCOV. Pobrać raport z niepokrytymi
   liniami, gałęziami i funkcjami. Diagnostyczne połączenie kilku uruchomień
   nie zastępuje tego dowodu.
2. Zweryfikować archiwum Lighthouse: nowe raporty HTML/JSON, asercje i log
   serwera powinny być zachowane mimo ukrytego katalogu raportów.
3. Dokończyć analizę istniejących `it.fails` należących do modułu. Nadal
   otwarte są obsługa błędów w queries (`public`, `archives`, `relatedPosts`,
   `programs`, `authorCv`, `staticPageSeo`, `blocks`), adres archiwum i kierunek
   sąsiednich wpisów. Najpierw potwierdzić kontrakty z rzeczywistymi trasami;
   nie usuwać oczekiwanych porażek bez naprawy i miarodajnego testu.
4. W backendzie pozostają do oceny ustalenia dotyczące walidacji indeksów
   embeddingów i timeoutu gatewaya, sugestii dla URL odrzuconego przez kontrolę
   SSRF, jednolitego zegara jobs tick i odporności zapisu jego logu, paginacji
   oraz błędów sitemap, rollbacku i zagnieżdżonych URL w wpMediaMirror,
   błędów i kluczy cache publishedContent, polityki suppression poczty
   transakcyjnej oraz anulowania zadań odzyskiwania sesji preview.
5. Domknąć lokalizację pustego stanu strony głównej, ponownie sprawdzić
   budżety produkcyjnego bundla i dopiero po pełnym potwierdzeniu zaktualizować
   opis PR oraz gotowość do review. Cel LCP 2500 ms i pomiar wdrożenia
   produkcyjnego nadal nie są potwierdzone.

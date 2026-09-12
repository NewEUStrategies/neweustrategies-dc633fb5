# Renderowanie widgetów CMS i pierwsza wizyta

Data: 12-09-2026. Właściciel: Fundacja New European Strategies.
Baza audytu: `9934c019572c3563f9447c8ff92803641c7c4e35`.

## Decyzja

Optymalizować wybiórczo ciężkie zależności oraz pracę podczas aktualizacji dokumentu.
Nie dodawać osobnego korzenia React i wywołania `hydrateRoot` do każdego widgetu.
Oba autorskie buildery działają w TanStack Start / React; nazwy Elementor i Gutenberg
opisują edycję i formaty importu, a nie dwie instalacje WordPress wymagające wtyczek cache.

SSR (server-side rendering) dostarcza HTML z serwera. Hydratacja dołącza zachowanie
React do tego HTML. Chunk jest plikiem JavaScript wynikającym z grafu importów.
`React.lazy` zmienia sposób pobierania kodu; samo w sobie nie oznacza odłożenia
hydratacji do przewinięcia. Widget zamontowany na stronie nadal może pobrać kod
podczas pierwszej hydratacji. Zysk dotyczy przede wszystkim widgetów NIEOBECNYCH
w dokumencie. Więcej chunków nie jest samodzielnym celem.

## Ustalenia z kodu

- `BuilderRenderer` już strumieniuje wybrane sekcje przez `StreamingSection`.
  Pierwsze trzy sekcje są domyślnie uprzywilejowane. Rejestr `lazyWidgets`
  rozdziela ciężkie widgety, a krytyczne widoki czytelnicze pozostają dostępne
  synchronicznie po stronie serwera.
- Gutenberg ma `lazyBlockViews` dla liveblogu, ankiety, kalendarza i wizualizacji.
  Jednak `renderer/molecules.tsx` statycznie importuje cztery formularze auth,
  newsletter i moduł marketingowy z formularzem kontaktowym.
- `routes/$.tsx` statycznie importuje newsletter, choć jego obecność zależy od
  ustawienia `show_bottom_newsletter`. Usunięcie tylko importu w Gutenberg
  pozostawiłoby tę drugą ścieżkę pobierania kodu.
- `safeParseBuilderDoc` tworzy nowe obiekty przy każdym wywołaniu. Wywołanie
  bez memoizacji w rendererze unieważnia referencje przekazywane do istniejących
  komponentów `memo` także wtedy, gdy dokument pozostaje bez zmian.
- `BlocksRenderer` ponawia walidację dokumentu i pre-pass przypisów także po
  aktualizacji niezwiązanej z jego treścią.
- Pomiar pierwszego wariantu zmiany ujawnił, że `experimentalMinChunkSize`
  scalał 312-bajtowy stub funkcji ochrony logowania z JSZip. Czytelnik artykułu
  pobierał przez tę krawędź także silnik ZIP. Jawny `vendor-jszip` w obu
  konfiguracjach klienta oddziela tę bibliotekę; konfiguracja workera pozostaje
  bez ręcznego podziału vendorów.
- `DeferredFrame` już odracza ciężkie iframe z rezerwacją rozmiaru. Nie należy
  dodawać drugiej bramki ukrywającej tę samą treść.

## Plan i kryteria odbioru

| Etap                    | Działanie                                                                                                                                | Efekt i miernik                                                                                                                                                                                | Ryzyko i kontrola                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1 - bieżący PR          | Wydzielić kod formularzy Gutenberg i warunkowego newslettera trasy. Zachować SSR przez lokalne granice Suspense.                         | Formularze nie należą do statycznego grafu renderera artykułu. Porównać sumę gzip wszystkich statycznych zależności, nie tylko pojedynczy plik.                                                | Opóźniony formularz nie może ukrywać sąsiedniej treści. Test SSR, rozwiązania importu i hydratacji.            |
| 1 - bieżący PR          | Memoizować normalizację dokumentów; w Gutenberg także pre-pass przypisów.                                                                | Ta sama referencja dokumentu nie powoduje ponownego przetworzenia; nowy dokument i zmiana języka pokazują aktualną treść.                                                                      | Nie wprowadzać globalnego cache treści ani zmieniać zakresu tenanta. Testy aktualizacji dokumentu i przypisów. |
| 2 - po pomiarze etapu 1 | Zmierzyć pierwszą wizytę PL/EN na reprezentatywnych stronach obu CMS, desktop i mobile, osobno z zimnym i ciepłym cache.                 | Minimum 3 próbki na wariant; LCP, CLS, czas hydratacji, liczba żądań i transfer JS. Istniejący harness `test:e2e:performance` jest punktem wyjścia; dodać dokumenty z formularzami i bez nich. | Oddzielić build produkcyjny od serwera deweloperskiego oraz cache przeglądarki od cache serwera.               |
| 3 - warunkowy           | Rozdzielać kolejne ciężkie moduły albo inicjalizować kosztowne ulepszenia widgetu bliżej viewportu, tylko gdy profil wskazuje ich koszt. | Mniejszy transfer lub mniej pracy głównego wątku w pomiarze A/B; bez pogorszenia interakcji i zachowania treści SSR.                                                                           | Zachować treść, linki, wyszukiwanie na stronie, fokus i rozmiary. Nie zastępować tekstu pustym placeholderem.  |

Realizacja: zespół platformy Fundacji New European Strategies. Etap 1 wymaga pracy
w repozytorium i CI, bez nowej usługi, abonamentu ani migracji bazy. Czas i koszt
następnych etapów należy oszacować po profilowaniu; repozytorium nie zawiera
podstaw do wiarygodnej wyceny roboczogodzin.

Weryfikacja obejmuje zachowanie treści i formularzy, testy obu rendererów,
formatowanie, lint, typecheck, istniejące bramki chunków i budżetu. Progi oraz
baseline nie są obniżane. PR #351 pozostaje niezależną naprawą bramek bazowych.
Wynik builda ani mniejszy gzip nie zastępują pomiaru szybkości strony u użytkownika.

## Źródła techniczne

- [React: Suspense](https://react.dev/reference/react/Suspense) - granice ładowania,
  streaming SSR i selektywna hydratacja; dostęp 12-09-2026.
- [React: hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot) -
  zgodność HTML serwera i klienta; dostęp 12-09-2026.
- [Vite: build optimizations](https://vite.dev/guide/features.html#build-optimizations) -
  podział kodu i wstępne pobieranie zależności; dostęp 12-09-2026.

## Wyniki walidacji

Porównanie tej samej konfiguracji produkcyjnej i tych samych zależności lokalnych,
przed zmianą (`9934c01`) i po zmianie. Suma gzip jest liczona osobno dla każdego
pliku, po domknięciu statycznych importów i usunięciu duplikatów. Obejmuje kod
wspólny aplikacji. Nie jest transferem z pomiaru Resource Timing ani pomiarem LCP.
1 KiB = 1024 bajty.

| Zakres                                                                | Gzip przed [B] | Gzip po [B] |                                   Zmiana | Liczba statycznie wymaganych chunków |
| --------------------------------------------------------------------- | -------------: | ----------: | ---------------------------------------: | -----------------------------------: |
| Gutenberg / BlocksRenderer, także wewnątrz widgetu rich-text buildera |        693 046 |     660 870 |                       -32 176 B (-4,64%) |                             45 -> 30 |
| Publiczna trasa treści `$.tsx`, ze wspólnym kodem                     |        798 237 |     769 512 |                       -28 725 B (-3,60%) |                             94 -> 85 |
| Sam start aplikacji ze wspólnymi zależnościami                        |        575 703 |     575 566 | -137 B (-0,024%; praktycznie bez zmiany) |                             10 -> 10 |

W statycznym grafie Gutenberga i trasy treści nie występują już `AuthFormBlocks`,
`NewsletterForm`, `MarketingContactFormView` ani JSZip. Obecność formularza na
stronie nadal powoduje pobranie jego kodu. Powyższy zysk dotyczy bazowego grafu
statycznego; nie należy odejmować go automatycznie od transferu każdej strony.
Sama liczba chunków w inwentarzu klienta wzrosła: 847 -> 848. Liczy się ich konieczność
na danej stronie, wielkość i koszt wykonania, nie minimalna liczba plików.

Reprodukcja pomiaru:

```sh
BUNDLE_INVENTORY=1 npm run build
python3 scripts/measure-cms-chunks.py > reports/cms-chunks.json
```

Skrypt odczytuje rzeczywisty inwentarz Rollupa. Brak wejścia, zależności albo
pliku kończy pomiar błędem. Raport zawiera także listę plików oraz wykryte
opcjonalne moduły w statycznym grafie, aby można było sprawdzić źródło zmiany.

Weryfikacja funkcjonalna:

- 28 plików testowych: 2557 testów zaliczonych i 3 istniejące przypadki
  oznaczone jako oczekiwana porażka. Zakres: bloki, ContentRenderer oraz
  dokument, urządzenia, streaming i zakładki buildera.
- 5 testów parytetu konfiguracji chunków zaliczonych.
- Test SSR używa rzeczywistego leniwego formularza kontaktowego i
  `renderToPipeableStream`; test hydratacji zachowuje ten sam element `form`
  i sprawdza dane przekazane po interakcji. Zastąpiona jest wyłącznie granica
  wywołania serwerowego. To test React/DOM, nie profil wydajności telefonu.
- Test importów dowodzi, że artykuł tekstowy nie ewaluuje modułów formularzy,
  oczekujący newsletter nie ukrywa sąsiednich akapitów, a cztery formularze
  auth współdzielą jedną ewaluację modułu.
- Testy cache przetwarzania dokumentów potwierdzają brak ponownego parsowania
  tego samego dokumentu oraz odświeżenie nowych dokumentów i przypisów.
- Pełny `npm run typecheck` zaliczony. Lint zmienionych plików: zero błędów,
  jedno istniejące ostrzeżenie Fast Refresh w `renderer/molecules.tsx`.
- Pełny Format zaliczony. 27 z 28 kontroli `verify:static` zaliczonych
  (ostatni `check:workflow-env-contract` uruchomiony oddzielnie).
  Jedyny błąd: dwa istniejące `as unknown as` w `src/lib/crm/memberSync.server.ts`.
  Plik jest bajtowo identyczny z bazowym main; jego naprawa jest w PR #351.
- Końcowy build produkcyjny zaliczony. `check:bundle`, `check:chunks` i
  `check:entry-purity` zaliczone. Kontrola pełnego katalogu artefaktu obejmuje
  849 plików JS i 5498 statycznych krawędzi: zero cykli. Inwentarz Rollupa
  z tabeli obejmuje 848 chunków klienta; dodatkowy plik artefaktu nie zmienia
  mierzonego domknięcia. Progi budżetów pozostają bez zmian.
- Jeden pośredni build zakończył się kodem 137 (`Killed`) podczas równoległego
  typechecku. Pełny build końcowy wykonany po tych kontrolach zakończył się
  poprawnie; nie zwiększano limitów ani nie pomijano etapu serwerowego.

Kolejny krok to zamknięcie niezależnej bramki CRM, a następnie pomiar pierwszej
wizyty na docelowych dokumentach obu CMS. Ten PR nie uzasadnia deklaracji,
że LCP skrócił się o określoną liczbę milisekund ani że każdy widget wymaga
osobnego mechanizmu hydratacji.

## Kontynuacja etapu 2 - pomiar dokumentów obu CMS

Gałąź zaktualizowano o `main` z merge PR #351 (`42667a8`). Opisana wyżej
porażka kontroli CRM dotyczy historycznej bazy etapu 1, nie aktualnego main.
W Actions dla etapu 1 przeszły: build i boot artefaktu, wszystkie cztery shardy
oraz agregacja testów/coverage, E2E, Lighthouse i istniejący first-visit.

Dodany zestaw `test:e2e:cms-performance` obejmuje 96 prób na każdy artefakt:
2 silniki x 2 dokumenty (tekst / formularz kontaktowy) x 2 języki x 2 profile
urządzenia x 2 stany cache serwera x 3 próbki. Każda próba uruchamia własny
proces serwera produkcyjnego i nowy kontekst Chromium. Scenariusze używają
publicznej trasy treści, prawdziwego ContentRenderer i prawdziwych formularzy.
Backend jest syntetyczny, wspólny dla SSR i klienta, z opóźnieniem 40 ms.
Żadne testowe trasy ani przełączniki nie trafiają do kodu aplikacji.

Zakres pomiaru i jego ograniczenia:

- LCP, FCP, TTFB, CLS z oknami sesji, żądania, transfer JS, rozmiar treści
  odpowiedzi JS oraz długie zadania głównego wątku. Transfer i rozmiar treści
  są odrębnymi polami; nie są sumą gzip z wcześniejszego audytu chunków.
- `hydrationReadyMs` to czas od nawigacji do efektu korzenia sygnalizującego
  gotowość. Nie jest czasem CPU samego `hydrateRoot` ani dowodem ukończenia
  wszystkich granic Suspense. Osobno testowane są zachowanie węzłów SSR oraz
  rzeczywisty handler przełącznika motywu i walidacja formularza.
- Okno obserwacji trwa co najmniej 5 sekund po gotowości, potem czeka na
  ukończenie żądań JS. Obejmuje istniejące automatyczne dogrzewanie widgetów
  (timeout requestIdleCallback do 4 s / fallback 1,5 s). Interakcja następuje
  po odczycie LCP/CLS, żeby wcześniej nie zamknąć obserwacji LCP.
- `cold` / `warm` oznacza cache SERWERA, z wymaganym nagłówkiem MISS / HIT.
  Cache przeglądarki pozostaje zimny; Playwright routing wyłącza HTTP cache.
  Powracający użytkownik z ciepłym cache przeglądarki wymaga osobnego pomiaru.
- Mobile emuluje viewport i dotyk Pixel 7 w Chromium. Nie emuluje procesora
  telefonu ani sieci komórkowej. Wynik nie zastępuje rzeczywistego p75 RUM.
- Kontrole treści SSR, braku błędów hydratacji i działania formularza obowiązują
  baseline oraz candidate. Porównanie odrzuca brakujące, zdublowane, nieliczbowe
  i pomieszane próbki. Stosuje te same tolerancje czasu i rozmiaru co istniejący
  first-visit; liczba żądań i long tasks służą również do diagnozy.

Reprodukcja:

```sh
npm run build:smoke
npm run test:cms-performance-harness
npm run test:e2e:cms-performance
# Pojedyncza ćwiartka macierzy: 24 próbki
npm run test:e2e:cms-performance -- blocks form
```

Workflow `CMS widget performance` porównuje bazę PR i kandydata na tym samym
runnerze dla każdej pary silnik/dokument. Raporty JSON, porównania, zrzuty i ślady
nieudanych prób są zachowywane jako artefakty Actions przez 14 dni.

Weryfikacja lokalna nowego stanowiska: produkcyjny build Node, typecheck skryptów,
lint oraz pięć testów integralności zestawu i porównywarki zaliczone. Playwright
odkrywa dokładnie 96 testów. Osiem odpowiedzi SSR (obie wersje językowe czterech
dokumentów) ma HTTP 200/MISS, pełną treść do znacznika końcowego i formularz
w odpowiednich wariantach, bez przerwania strumienia `$RX`.
Lokalna instalacja Chromium nie powiodła się z powodu dostępu do CDN; wyniki
przeglądarkowe wymagają ukończonego workflow. Nie deklarujemy jeszcze poprawy LCP.

Etap 3 pozostaje zależny od wyników A/B. Kandydatem do profilowania jest obecne
bezwarunkowe dogrzewanie sześciu modułów w `warmCommonWidgetChunks`; jego zmiana
musi również zachować płynność nawigacji SPA, której ten mechanizm służy.

Pełne `verify:static` po aktualizacji o main: **28/28 kontroli zaliczonych**.
Pierwszy przebieg nowego workflow wykrył cztery brakujące odpowiedzi w zestawie
testowym po hydratacji publicznej trasy treści (warstwa członkostwa, konfiguracja
rekomendacji, metering i definicje metadanych). Uzupełniono ich jawne odpowiedzi
dla syntetycznego tenanta oraz test kontraktu. To poprawka stanowiska pomiarowego;
nie jest poprawą czasu ładowania produktu. Typy nowego speca i konfiguracji
Playwright są odtąd sprawdzane także przez komendę harnessu w CI.

## Wyniki diagnostyki i poprawki po pierwszym pomiarze

Przebieg Actions `34714349499` nie zaliczył bramki. Zmniejszenie rozmiaru
odpowiedzi JavaScript w PL/desktop/cold (tekst: 3 575 860 -> 3 498 533 B,
134 -> 126 żądań JS) nie wystarcza do odbioru: były to niepełne serie,
a CLS i zachowanie formularzy ujawniły rzeczywiste defekty.

- Nagłówek zmieniał pozycję początku `main` z 61 do 240,75 px. Rozgrzewka
  chrome była anulowana przed renderem i startowała ponownie pod Suspense.
  Trasy poza stroną główną oczekują teraz na jej istniejący budżet 500 ms,
  dzięki czemu ukończone dane przechodzą do pierwszego HTML. Awaria nadal
  degraduje stronę i zabrania zapisu do publicznego cache.
- Zimne importy tekstu buildera zostawiały sekcje o wysokości 24 px,
  rozwijane następnie do 88,31 px. RichHtmlView i formularz kontaktowy są
  dostępne synchronicznie na serwerze, przy zachowaniu leniwego importu
  przeglądarkowego i parytetu drzew Suspense.
- Korekta urządzenia w rendererze mogła usunąć oczekujący widget SSR.
  Test hydratacji odtwarzał utratę formularza przy 390 px; aktualizacja
  przez startTransition zachowuje węzeł do rozwiązania importu.
- Breadcrumbs dodawane dopiero efektem przesuwały treść Gutenberg o 43,25 px.
  Są teraz obliczane z danych loadera w SSR. Parsowanie dokumentu i pre-pass
  trasy mają memoizację, aby aktualizacje danych pomocniczych nie kasowały
  stabilnych referencji rendererów.

Stanowisko zapisuje źródła CLS, zdarzenia usunięcia formularza oraz przebieg
rozgrzewania cache. Pierwsza odpowiedź historycznej bazy może być `no-store`:
rozgrzewanie jest ograniczone do pięciu pełnych żądań HTML i musi zakończyć
się `HIT`. Właściwy pomiar ciepłej wizyty zawsze wymaga `HIT`; próby `MISS`
nie są zaliczane do tej grupy. Cold nadal uruchamia nowy proces serwera.

Historyczna baza `42667a8` ma potwierdzony defekt odtwarzania formularza SSR.
Pomiar zapisuje go jako `CMS_BASELINE_DEFECT` i liczy wystąpienia w porównaniu.
Nie zmienia kodu bazy ani jej wyników. Kandydat nadal musi zachować pierwotny
formularz w każdej próbie; tytuł SSR, pełna treść, brak błędów i działający
handler obowiązują obie wersje. To jawne rozróżnienie diagnozy historycznej
wersji od kryteriów odbioru poprawki. Budżety czasu, bajtów i CLS < 0,1 nie
uległy zmianie. Wynik końcowy wymaga ponownej pełnej macierzy.

Dodatkowy test odtworzył usuwanie oczekującego formularza przez zwykłą
aktualizację rodzica, nawet gdy właściwości widgetu nie zmieniały się.
Obie fabryki granic Suspense stosują teraz React.memo. Niezmienione pola
formularza nie unieważniają trwającej hydratacji; rzeczywista zmiana props
nadal aktualizuje widget. Kontrola eksportów rejestru rozpoznaje zarówno
komponenty funkcyjne, jak i poprawne komponenty memo.

Przebieg `34717651184` zebrał wszystkie 96 próbek historycznej bazy. Trzy
grupy kandydata (tekst obu builderów i formularz Gutenberg) zaliczyły po 24
próby oraz porównania wszystkich ośmiu wariantów. Formularz Elementora nadal
był odtwarzany; niskie CLS nie wystarczyło do zaliczenia jego grupy.

Rozszerzony test odtworzył brakujący przypadek: aktualizacja rodzica odtwarzała
wartość kontekstu `ThemeProvider`, mimo niezmienionego motywu. Taka propagacja
kontekstu przerywała hydratację formularza także pod `React.memo`. Dostawca
ma teraz stabilne callbacki i wartość memoizowaną względem rzeczywistego
motywu. Test zachowania formularza przechodzi z dostawcą motywu i bez niego;
testy przełączania motywu nadal wymagają natychmiastowej reakcji CSS oraz
zachowania widocznej treści przy oczekującym imporcie.

## Odbiór implementacji

Etap 1 jest zaimplementowany. Etap 2 obejmuje stanowisko A/B oraz naprawy
wykrytych defektów SSR, hydratacji i stabilności układu. Odbiór wymaga zielonej
pełnej macierzy `CMS widget performance` oraz istniejących bramek CI dla
aktualnej wersji kodu. Bieżący wynik, identyfikator mierzonego commita i
artefakty są podane w [PR #352](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/pull/352).

Etap 3 pozostaje warunkowy. Nie wprowadzono kolejnej warstwy hydratacji ani
odraczania statycznej treści. Profil syntetycznych stron nie uzasadnia zmiany
mechanizmu dogrzewania dla nawigacji SPA bez osobnego pomiaru tej nawigacji.
Pełny katalog ikon (~450 kB odpowiedzi JS) w tym zestawie jest dodatkowo
wywoływany przez zastępcze, niekanoniczne nazwy ikon w odziedziczonej fixture
chrome. Ten koszt nie dowodzi, że rzeczywisty widget potrzebuje całego katalogu;
nie należy na jego podstawie wdrażać optymalizacji dobranej tylko do fixture.

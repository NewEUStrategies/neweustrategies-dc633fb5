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

# Pierwsza interakcja: ładowanie modułów i małe obrazy

Baza porównania: `8de2c23df` z `main`, 14 września 2026.

## Co pokazał profil Firefox

Przeanalizowano wyłącznie kartę `neweuropeanstrategies.com`. Po ostatniej
nawigacji nagranie obejmuje 3,67 s: w tym oknie zakończyły się 103 pobrania
JavaScript i 123 żądania sieciowe ogółem. Jedenaście długich zadań głównego
wątku zajęło łącznie 895 ms; najdłuższe trwało 123 ms. Suma części tych zadań
powyżej 50 ms wyniosła 345 ms. Nie jest to pełny pomiar TBT ani INP.

Zamknięte wyszukiwarki i formularze pobierały kod podczas startu. Moduły
widocznych widgetów odkrywały kolejne dynamiczne importy dopiero po wykonaniu
poprzednich. Jednocześnie pobrano oryginalny awatar PNG o rozmiarze 1 771 136 B
oraz jego mały wariant 1 942 B. Ticker wyświetlał awatar w rozmiarze 20 px.

Nawigacja w profilu pochodzi z 10:53 UTC, a bazowy commit z 12:43 UTC. Profil
wskazuje mechanizmy obecne także w kodzie bazy, ale nie jest pomiarem tej samej
wersji wdrożenia. Jego końcowy fragment nie pozwala potwierdzić czasu 8 s ani
wyliczyć pełnej poprawy czasu interakcji. Surowy profil nie jest publikowany.

## Zmiany

- Logowanie, paleta poleceń i formularz kontaktu z ekspertem mają małe hosty
  nasłuchujące zdarzeń. Formularze są importowane po pierwszym żądaniu,
  którego parametry przeżywają pobranie modułu. Aktualizacja ustawień nie
  otwiera ponownie zamkniętego logowania.
- Wyszukiwarka nagłówka ładuje się po otwarciu i zachowuje stan po zamknięciu.
  Zawartość mobilnego menu ładuje się po otwarciu szuflady.
- SSR wysyła nagłówki `Link: rel="modulepreload"` dla widgetów obecnych
  w początkowych sekcjach nagłówka i strony głównej, w tym zagnieżdżonego
  renderera slidera. Build ustala aktualne nazwy plików; hinty nie zmieniają
  drzewa DOM hydratowanego dokumentu. Slidery z ręcznie wybranymi obrazami
  nie preładują zapytań o posty.
- Ticker i menu konta używają istniejącego skalowania awatarów oraz `srcSet`.
- Pierwszy render logowania od razu czyta ustawienia uwierzytelnienia
  z wiarygodnego cache SSR, także własny adres logowania.

## Metoda weryfikacji

Oba buildy powstają z tego samego lockfile i konfiguracji produkcyjnej
`build:smoke` z serwerem Node. Pomiar używa istniejącego fixture strony głównej,
kontrolowanych odpowiedzi bazy z opóźnieniem 40 ms i obrazu testowego.
Chromium 153 działa lokalnie, bez ograniczania CPU ani sieci. Każda próba ma
nowy proces serwera i nowy kontekst przeglądarki. W wariancie `warm` dodatkowe
żądanie ogrzewa cache dokumentu SSR; nie jest to cache przeglądarki powracającego
czytelnika. Żądania obrazów są zastąpione fixture, więc oszczędność awatara nie
wchodzi do wyniku czasowego.

Test wymaga zachowania treści SSR podczas hydratacji oraz wykonania kliknięcia
zmiany motywu. Bajty JavaScript są liczone po zakończeniu początkowych pobrań
i 500 ms ciszy skryptów. Lokalny serwer zwraca nieskompresowane pliki JS;
nie należy utożsamiać tego z transferem Brotli na produkcji. Wyniki nie są
produkcyjnym p75 ani gwarancją 2–3 s na każdym urządzeniu.

Osobny test przeglądarkowy sprawdza obecność preloadów, brak pobrania zamkniętych
okien na starcie i pierwsze otwarcie palety, logowania z kontekstem oraz
mobilnej wyszukiwarki. Jest częścią `test:e2e:performance` dla nowego artefaktu.
Limity istniejącej bramki wydajności nie zostały zmienione.

## Wyniki przed i po

Po trzy próby dla każdego wariantu, 24 próby łącznie. Tabela podaje mediany
od początku nawigacji do zakończonego kliknięcia. Wszystkie próbki i wyniki
32 porównań bramki są w [JSON](./2026-09-14-first-interaction-results.json).

| Wariant           |    Baza | Po zmianach |
| ----------------- | ------: | ----------: |
| PL, zimny SSR     | 2334 ms |     1996 ms |
| PL, rozgrzany SSR | 1392 ms |     1429 ms |
| EN, zimny SSR     | 2085 ms |     2158 ms |
| EN, rozgrzany SSR | 1456 ms |     1296 ms |

Zmiana czasu nie jest jednakowa we wszystkich wariantach: polski zimny start
poprawił się o 14,5%, ale PL/warm i EN/cold były odpowiednio o 37 i 73 ms wolniejsze.
Całość przeszła istniejącą bramkę względną, uwzględniającą szum pomiaru.
W nowym buildzie wszystkie 12 kliknięć zakończyło się w przedziale 1269–2558 ms,
a największy CLS wyniósł 0,00305 po zaokrągleniu w górę. Oryginalny tytuł SSR
zachowano w 12/12 prób, bez błędów hydratacji.

Redukcja pobrań jest stała w każdej próbie:

| Początkowe zasoby |        Baza | Po zmianach |
| ----------------- | ----------: | ----------: |
| Pliki JS, PL      |         102 |          88 |
| Pliki JS, EN      |         103 |          89 |
| JS ogółem, PL     | 3 184 736 B | 3 042 707 B |
| JS ogółem, EN     | 3 246 434 B | 3 104 405 B |

To 142 029 B mniej nieskompresowanego JS oraz 14 mniej żądań na starcie.
Nie oznacza usunięcia tych funkcji: ich kod jest pobierany przy użyciu.
Optymalizacja awatara dodatkowo usuwa wykryte pobranie dużego oryginału
w tickerze, ale rzeczywisty rozmiar odpowiedzi CDN zależy od obrazu.

Weryfikacja: 234 testy w 11 plikach dotyczących zmienionych komponentów,
ustawień, korzenia i parytetu chunków; ponownie 17 testów po korekcie typów
i przechodzenia przez zagnieżdżone sekcje; pełny `npm run typecheck`;
`npm run build:smoke`; 24/24 pomiary pierwszej wizyty; 6/6 testów paneli doku
i odroczonych okien; 32/32 porównania wydajności; kontrola formatowania,
braku cykli chunków, czystości ścieżki startowej i budżetów bundla.

Po publikacji potrzebny jest profil tej samej wersji na rzeczywistym urządzeniu
i łączu. Nadal istotny pozostaje koszt około 3 MB nieskompresowanego JS w tej
konfiguracji testowej oraz odpowiedzi SSR na produkcji. Te pomiary nie
potwierdzają jeszcze przejścia produkcyjnego czasu 8 s do 2–3 s.

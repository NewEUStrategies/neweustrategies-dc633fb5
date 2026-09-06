# Pierwsze wejście: redukcja pracy przed interakcją

Punkt odniesienia: `8607c8dd228aeb5aff5e44beed32b11eed5e54eb` (main po PR #339).
Poprzednie naprawy cache, SSR i hydratacji pozostają potrzebne. Nie usunęły jednak
dużego kosztu parsowania dokumentu i uruchamiania kodu klienta przy pierwszym wejściu.

## Zmiany

- Typografia buildera grupuje identyczne deklaracje i selektory tagów o tej samej
  specyficzności. Zachowuje reguły `!important`, zakres widgetu, rozmiary urządzeń
  i wyłączenia liczników oraz drobnych etykiet.
- Stały arkusz slidera jest zasobem React 19 z `href` i `precedence`. Pięć sliderów
  wysyła go raz. Dynamiczne style instancji nadal aktualizują się osobno.
- Cięższe elementy Radix (menu, slider, scroll-area) mają osobne chunki. Select
  nadal jest potrzebny na starcie; raport uwzględnia go, więc nie ukrywa kosztu.
- Publiczny katalog tenantów i reguły przekierowań mogą przetrwać rotację Workera
  w Cache API. Świeży wpis pozwala uniknąć dwóch sekwencyjnych odczytów DB przed
  odczytem cache dokumentu. Klucz obejmuje projekt bazy i tenant przekierowania.
  TTL pozostaje 60/30 s, a odtworzenie nie odmładza migawki. Błąd cache wraca do DB.
- `Server-Timing` rozdziela inicjalizację entry od obsługi żądania. `app` obejmuje
  middleware i odczyt cache, ale nie transmisję ani późniejszy streaming body.
  `__nesAppReadyAt` zapisuje pierwszą gotowość względem początku nawigacji.
- Domknięcie początkowego odczytu sesji i aktualizacje motywu używają tranzycji
  React. Test hydratacji odtworzył usuwanie gotowego artykułu SSR, kiedy sesja
  gościa rozstrzygała się przed pobraniem kodu leniwego widgetu. Po poprawce
  zachowany jest ten sam element DOM. Późniejsze zmiany tożsamości i wylogowanie
  nadal działają natychmiast. Kolor motywu reaguje natychmiast także wtedy,
  gdy aktualizacja kontekstu czeka na gotowość potomka.
- Subskrypcja zgód dla obserwowalności ma osobny komponent. Jej aktualizacja
  nie odtwarza już wartości wszystkich kontekstów w korzeniu; test na
  prawdziwym routerze wykazał i zabezpiecza zbędny render artykułu.

## Zmierzone lokalnie na jednakowych buildach produkcyjnych

Node 24.19.0, Bun 1.2.23, preset `node-server`, lokalna analiza publicznych ustawień
i układu strony z 6 września, 40 ms na odczyt testowej bazy. Dokument zawiera
treść wpisów i 37 nagłówków; pusta strona nie jest dopuszczalnym wynikiem.

| Miara                          |     Przed |        Po |
| ------------------------------ | --------: | --------: |
| CSS wewnątrz HTML              | 330 202 B | 130 985 B |
| Liczba bloków style            |        54 |        50 |
| HTML, bez kompresji            | 697 090 B | 497 988 B |
| Ten HTML po lokalnym gzip      |  91 294 B |  68 019 B |
| Domknięcie startowego JS, gzip | 578,7 KiB | 566,6 KiB |

Redukcja CSS wynosi 60,3%, HTML 28,6%, a gzip dokumentu 25,5%. Bajty HTML mogą
zmieniać się wraz z serializacją i treścią; nie są stałym rozmiarem produkcji.
Limitów rozmiaru nie podniesiono. Graf chunków po podziale jest acykliczny.

Powtarzalny syntetyczny fixture dołączony do repozytorium daje osobny wynik:
CSS 329 794 → 130 532 B, HTML 584 871 → 385 724 B, gzip HTML 65 894 → 47 191 B.
Nie zawiera źródłowych treści, identyfikatorów ani adresów produkcji. Prosty SVG
i syntetyczna kopia tekstów ograniczają porównywalność czasu LCP z produkcją.

## Pomiar czasu i wyglądu

`bun run test:e2e:performance` uruchamia Chromium na `.output/server/index.mjs`,
ładuje stronę główną PL/EN i klika rzeczywisty przełącznik motywu. Mierzy TTFB,
FCP, LCP, gotowość i zakończenie kliknięcia od początku nawigacji. Nie odejmuje
czasu czekania na pierwszy HTML. Zapisuje JSON, screenshoty oraz trace awarii.
Osobne testy sprawdzają obliczone style typografii dla desktop/tablet/mobile.

Workflow `first-visit.yml` buduje i mierzy wersję bazową oraz kandydata kolejno
na jednym runnerze, z tym samym syntetycznym układem, przeglądarką i testami.
Wcześniejsze próby na osobnych runnerach nie służą do wyliczania przyspieszenia.
Obie wersje muszą pokazać treść i
obsłużyć kliknięcie. Nowe budżety blokują kandydata: TTFB <2 s, FCP/LCP <2,5 s,
gotowość <3 s, wykonana interakcja <3,5 s, CLS <0,1 oraz limity HTML/CSS.
Kandydat musi też zachować oryginalny tytuł SSR podczas hydratacji. Raport
CLS używa największego okna sesji (maks. 5 s, przerwa poniżej 1 s) i wskazuje
elementy odpowiedzialne za przesunięcia przed interakcją.
Transport testowy przechwytuje tylko backend i zasoby zewnętrzne. Lokalne
CSS/JS/fonty płyną bezpośrednio z artefaktu, bez dodatkowej kolejki sterownika
Playwright przy każdym żądaniu. Bazę i kandydata mierzy ten sam harness.

To kontrolowane laboratorium bez throttlingu, nie produkcyjny p75 ani INP.
Nowy kontekst oznacza zimny cache przeglądarki; kolejne próby rozgrzewają cache
serwera. Obrazy zastępuje jeden prosty SVG, aby odciąć zmienność CDN; nie mierzy
to kosztu dekodowania zdjęć produkcyjnych. API używa wyłącznie syntetycznych
identyfikatorów, treści i adresów. Zachowuje reprezentatywną strukturę oraz
typografię buildera. Repozytorium nie zawiera zrzutu danych produkcji. Fixture
nie zawiera kluczy i odrzuca zapisy. `--import`
działa tylko w procesie testowym; nie zmienia kodu wdrożonej aplikacji.

Lokalne środowisko blokuje gniazdo wymagane przez Chromium. Dlatego lokalny
pomiar HTTP i rozmiaru nie jest przedstawiany jako udany pomiar interakcji.
Wyniki przeglądarki należy odczytać z workflow, a wynik dla czytelników zweryfikować
po wdrożeniu, na pierwszych wizytach mobilnych i desktopowych.

## Odniesienie do zero.pl

Sama wielkość HTML nie wyjaśnia różnicy odczuwanej szybkości. W odczycie z 6
września zero.pl miało około 864 KB HTML przed kompresją, więcej niż NES.
Istotne są moment dostarczenia treści, zasoby blokujące render i praca klienta.
Nie dysponujemy porównywalnym pomiarem obu stron w tej samej przeglądarce i sieci,
więc nie deklarujemy osiągnięcia identycznego czasu ani konkretnego mnożnika.

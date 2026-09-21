# Zimne wejście na platformę — uzupełnienie PR #382

Data: 2026-09-21. Baza zmian: `9facddd9b4494e19a44fca3122c59b446343713f`.

## Weryfikacja poprzednich zmian

[PR #382](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/pull/382)
i [PR #383](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/pull/383)
są scalone. Poprawki nagłówków, sitemap, części mechanizmów odzyskiwania danych,
budżetów SSR oraz pierwszych interakcji są już w aktualnym kodzie. Otwarte historyczne
wątki przeglądu nie oznaczają automatycznie, że wskazane błędy nadal występują.

Ponowna weryfikacja skompilowanego artefaktu ujawniła kolejne problemy wspólne dla
wielu tras. Ten zestaw zmian naprawia opisane poniżej przyczyny; nie stanowi deklaracji,
że wszystkie moduły platformy osiągnęły produkcyjne cele Core Web Vitals.

## Naprawione przyczyny

1. **Hydratacja tłumaczeń w produkcyjnym SSR.** Puste eksporty `ensureI18n()` nie
   zachowywały rejestracji słowników po optymalizacji serwera. Zimne `/events`
   zwracało `community.events.title`, a klient renderował „Wydarzenia”, co powodowało
   React #418. W 82 modułach publicznych i administracyjnych rejestracja jest teraz
   rzeczywistą, idempotentną funkcją. Dotychczasowe importy dla efektów ubocznych
   zachowują działanie. Testy zgodności PL/EN nadal przechodzą.
2. **Hydratacja formularza `join-us`.** Ten widget czyta ustawienia newslettera,
   ale brakowało go w rejestrze prefetch i cache targets. W skompilowanej stronie
   głównej odtworzono różnicę między domyślnym tytułem SSR „Dołącz do nas” a
   klientowym „Zapisz się do newslettera”. Wspólny prefetch dostarcza teraz ten sam
   stan do obu renderów, także w widgetach hydratowanych później.
3. **Trwały ekran awarii po krótkim błędzie SSR.** Katalogi i strony szczegółowe
   obserwują bieżący stan Query zamiast polegać wyłącznie na początkowej fladze
   loadera. Dotyczy to kategorii, tagów, programów, wydarzeń, ekspertów, autorów,
   live, web stories, podcastów, audycji i planów. Zapytania pozostają zamontowane,
   a komunikaty mają działające ponowienie. Tożsamość audycji i lista odcinków
   odzyskują się osobno; brak audycji nie uruchamia zapytania o odcinki z pustym ID.
4. **Dodatkowe oczekiwanie SSR na retry.** Domyślna konfiguracja serwerowego Query
   nie ponawia nieudanego żądania z opóźnieniem. Przeglądarka zachowuje jedno
   ponowienie. Istniejące limity czasu loaderów pozostają bez zmian.
5. **Zimny start po okresie bez ruchu.** Cztery publiczne migawki — ustawienia,
   tokeny wyglądu, menu główne i stopka — mogą przetrwać do 24 godzin w istniejącym
   cache L1/L2. Świeżość nadal wynosi 60 sekund; starsza migawka uruchamia pojedyncze
   odświeżenie w tle. Istniejące wersjonowanie i unieważnianie cache pozostają
   aktywne. Treści, tożsamość, dostęp, live i brakujące rekordy nie otrzymują
   wydłużonego okresu przechowywania.
6. **Izolacja wyglądu między hostami.** Globalne współdzielenie obietnicy pobrania
   tokenów działa wyłącznie w przeglądarce. SSR używa deduplikacji ograniczonej do
   hosta. Błąd odświeżenia nie zastępuje poprawnej migawki pustym motywem.

## Zakres pomiarów

Pomiary dotyczą minifikowanego artefaktu `build:smoke` z serwerem Node, Chromium 153
na desktopie, bez spowalniania CPU i sieci. Kontrolowany backend odpowiada z
opóźnieniem 40 ms. Każdy scenariusz ma osobny proces serwera i kontekst przeglądarki.
Wariant warm rozgrzewa cache serwera, zachowując nowy kontekst przeglądarki.

Katalogi mają poprawne puste zbiory danych. Ich testy wykrywają problemy na granicy
SSR, ładowania chunków i hydratacji; nie zastępują pomiarów ciężkich katalogów z
produkcyjną zawartością. Dane i awarie sprawdzają oddzielne testy tras.

| Zimne wejście   | TTFB, ms |  FCP, ms |   LCP, ms |      CLS | Czas zdarzenia interakcji, ms |
| --------------- | -------: | -------: | --------: | -------: | ----------------------------: |
| `/`, 3 próbki   |  656–785 | 808–1036 | 1004–1228 |   0,0168 |                             — |
| `/en`, 3 próbki |  657–711 | 908–1008 |  948–1312 | 0–0,0168 |                             — |
| `/events`       |     1906 |     2316 |      2316 |   0,0012 |                           104 |
| `/experts`      |      726 |     1064 |      1064 |        0 |                            96 |
| `/programs`     |      693 |     1040 |      1040 |   0,0012 |                            96 |
| `/podcasts`     |      747 |     1036 |      1036 |   0,0012 |                            72 |
| `/live`         |      748 |     1092 |      1092 |   0,0012 |                            88 |
| `/web-stories`  |      807 |     1140 |      1140 |   0,0012 |                            80 |

Na stronie głównej PL/EN zakończenie testowanej pierwszej interakcji nastąpiło
1,85–2,14 s od początku zimnej nawigacji. Ten czas nie jest INP. Kolumna zdarzeń
dla katalogów to maksymalny czas zmierzonego zdarzenia podczas testowanych kliknięć,
również **nie produkcyjny INP ani p75**. Każdy katalog ma jedną próbkę.

Test katalogów obejmuje kliknięcie motywu oraz zgodę „Tylko niezbędne”, sprawdza
obecność H1 w SSR, brak uciętego dokumentu, brak błędów hydratacji i rzeczywistą
odpowiedź cache MISS. Dodano go do istniejącego workflow `first-visit`.

Wcześniejszy pomiar homepage wykonywany równocześnie z kontrolą typów przekroczył
progi czasowe. Po zakończeniu obciążenia uruchomiono cały istniejący zestaw ponownie:
12/12 prób PL/EN cold/warm, 5/5 paneli i 1/1 test nakładek przeszły bez zmiany progów.
Pomiary katalogów pochodzą z wcześniejszego przebiegu; `/events` współdzieliło wtedy
CPU z kontrolą typów. Nie przedstawiamy tych danych jako porównania przyspieszenia
produkcji przed i po zmianie.

Surowe wartości i charakterystyka środowiska:
[`2026-09-21-platform-cold-start-metrics.json`](./2026-09-21-platform-cold-start-metrics.json).

## Walidacja

- Zestaw 14 plików testów tras, Query i cache: 396 testów zaliczonych i 2 istniejące
  przypadki oznaczone jako expected fail.
- Sześć zestawów dla i18n, L2 i izolacji motywu: 97 testów zaliczonych.
- Trasa autora: 96 testów zaliczonych, w tym odzyskanie po awarii.
- Nowe przypadki regresji dla kategorii, tagów, programów i wydarzeń najpierw
  odtworzyły problem, następnie przeszły po poprawce.
- `npm run typecheck:tsc`: zaliczone. Lint zmienionego kodu: 0 błędów, 2 istniejące
  ostrzeżenia react-refresh w routerze. `git diff --check`: zaliczone.
- `npm run build:smoke`, kontrola polityki loaderów i budżetów SSR, grafu chunków
  oraz czystości wejścia: zaliczone.
- Przeglądarka: 6/6 nowych katalogów oraz 18/18 istniejących scenariuszy strony
  głównej, paneli i nakładek zaliczone.

## Pozostałe ograniczenia

**Limit całkowitego JS pozostaje przekroczony również na bazie.** Przy tych samych
zależnościach artefakt bazowy ma około 4559 KiB gzip, a kandydat 4562,9 KiB przy
limicie 4509 KiB. Baza pomiarowa poprzedza dwie niezależne migracje SQL, które
następnie włączono z najnowszego `main`. Niewielka diagnostyka React w bazowym
artefakcie nie wyjaśnia przekroczenia około 50 KiB. Próg nie został podniesiony.

Pozostałe limity kandydata przechodzą: publiczny JS 2705,3/2826 KiB, największy
chunk 279,5/286 KiB, CSS 93,9/96 KiB, publiczny CSS 80,6/83 KiB i początkowo
osiągalny JS 565,2/579 KiB gzip. Pełny i workerowy silnik arkuszy oraz większe
moduły administracyjne wymagają odrębnej optymalizacji i weryfikacji zachowania
importu/eksportu; nie usuwano funkcji produktu, aby zmieścić się w limicie.

Nie wykonano wdrożenia, testu docelowego runtime Cloudflare ani pełnego pomiaru
zalogowanych ścieżek administracji. Zachowanie L2 potwierdzają testy adaptera;
Node smoke nie odtwarza rzeczywistej rotacji izolatów i rozmieszczenia cache w
Cloudflare. Całkowicie pusta lokalizacja nadal musi wykonać pierwsze zapytania.
Ocenę produkcyjnego TTFB i p75 LCP/INP/CLS należy oprzeć na RUM po wdrożeniu oraz
pomiarach urządzeń mobilnych z właściwej lokalizacji użytkowników.

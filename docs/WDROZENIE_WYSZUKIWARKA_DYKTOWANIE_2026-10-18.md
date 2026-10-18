# Wyszukiwarka: dyktowanie - jeden submit na dyktowanie zamiast serii (2026-10-18)

Zlecenie: „Wyszukiwanie głosowe po przejściu na `rec.continuous = true`
(`useVoiceSearch.ts:210`) woła `onFinal` przy każdym zdarzeniu po pierwszym
wyniku końcowym: seria nawigacji do /search, wpisów w »ostatnich« i zapytań
`log_search_query`. Napraw, optymalizuj i wdrażaj testy." PR:
`NewEUStrategies/neweustrategies-dc633fb5#523`.

Zasada jak w poprzednich wdrożeniach modułu: każda naprawa ma test, który
OBLEWA na kodzie sprzed poprawki. Sprawdzone dla każdej grupy uruchomieniem
nowych testów na hooku sprzed zmiany: 24 + 2 + 2 + 1 przypadków czerwonych przed
poprawką, zielone po niej. Testy wzmacniające (W1-W3) przechodzą na obu
wersjach, ale każdy zabija własnego mutanta kodu poprawki.

---

## 1. Przyczyna

W trybie ciągłym `e.results` to CAŁA sesja rozpoznawania. Finały zostają
w liście do jej końca (spec Web Speech API, Blink `ResultRetrieved`, WebKit
`didReceiveResult`), a za nimi rośnie interim kolejnych słów. Hook sklejał
listę od zera i wołał `onFinal`, gdy w niej był JAKIKOLWIEK finał - czyli przy
każdym zdarzeniu po pierwszym finale. Każde takie wywołanie to na `/search`
`submitPhrase`: nawigacja, `addRecentSearch` i - przez zmianę `q` -
`log_search_query`. W widgecie bez wyników na żywo to osobne
`search_autosuggest` (test kotwiczący: cztery zapytania, zanim użytkownik
skończył mówić).

## 2. Defekty naprawione

| #   | waga    | miejsce                                     | defekt                                                                                                                                                                                                    | naprawa                                                                                                                                                                                                                                                       |
| --- | ------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | wysoka  | `lib/search/useVoiceSearch.ts` (Web Speech) | **Zgłoszony defekt.** `onFinal` przy każdym zdarzeniu po pierwszym finale, także z niestabilnym interimem następnych słów.                                                                                | Kontrakt ścieżki serwerowej: `onresult` tylko strumieniuje do `onText`, `onFinal` woła wyłącznie idempotentne `finishDictation` - RAZ na dyktowanie (stop, bezpiecznik, błąd krytyczny, koniec sesji bez wznowienia).                                         |
| V2  | średnia | jw.                                         | Auto-wznowienie w `onend` zaczyna sesję od pustej listy: pole traciło wcześniej podyktowane słowa, a do wyszukiwania szedł tylko ostatni odcinek.                                                         | Bufor `carried` - tekst sesji zamkniętych przed wznowieniem.                                                                                                                                                                                                  |
| V3  | średnia | jw.                                         | Stop zerował referencję od razu: wynik dosłany po `stop()` trafiał w próżnię, szybki ponowny klik startował drugie rozpoznawanie, a spóźniony `end` starej instancji gasił `listening` nowej.             | Dyktowanie trzymane w `dictationRef` aż do `end`; `busy` na czas dosyłania (jak wysyłka na `/api/stt`).                                                                                                                                                       |
| V4  | średnia | jw.                                         | `onerror` ignorował kod błędu, a `onend` zawsze wznawiał: `not-allowed`, `audio-capture`, `aborted` kręciły pętlę start -> błąd -> koniec. WebKit po odmowie zgody nie przysyła `end` - nasłuch na stałe. | Błędy poza `no-speech` i `network` kończą dyktowanie już w `onerror`. Trzy puste obroty z rzędu (sesja < 1 s bez wyniku; Brave zawsze zwraca `network`) też.                                                                                                  |
| V5  | niska   | jw.                                         | Ścieżka Web Speech nie miała bezpiecznika 5 min; silnik, który po `stop()` nie przyśle `end`, zostawiał hook w „zajęte".                                                                                  | Wspólny `MAX_RECORDING_MS`; strażnik 3 s zatwierdza ostatni tekst i przerywa rozpoznawanie.                                                                                                                                                                   |
| V6  | średnia | jw.                                         | Odmontowanie po stopie nie miało czego przerwać (referencja już wyzerowana), a uchwyty zostawały podpięte: spóźniony `end` zatwierdzał frazę spod innej strony.                                           | `finishDictation(d, false)` odpina uchwyty PRZED `abort()`, także w fazie stopu.                                                                                                                                                                              |
| V7  | średnia | jw. (`sessionTranscript`)                   | Wyniki sklejane bez separatora. Chrome desktop dokleja spację wiodącą sam, WebKit (`formattedString`) i segmenty Androida - nie: „Fundusze unijne" + „dla samorządów" = „Fundusze unijnedla samorządów".  | Przycięte transkrypcje łączone pojedynczą spacją (dla Chrome wynik bez zmian). Znalezione w przeglądzie adwersarialnym poprawki.                                                                                                                              |
| V8  | niska   | jw.                                         | Android Chrome <158 oddaje każdą hipotezę rosnącego zdania jako finał z confidence 0 - słowa się dublowały.                                                                                               | Finał z confidence 0, który następny FINAŁ tylko przedłuża o całe słowa, jest pomijany (bez wpływu na desktop i Chrome 158+). Granica słowa, nie znaku - po uwadze Codexa w PR: niezależne segmenty WebKit z pewnością 0 („w" + „Warszawie") nie gubią słowa. |
| V9  | niska   | jw. (ścieżka serwerowa, `recorder.onstop`)  | `try/finally` bez `catch` w asynchronicznym `onstop`: offline albo zablokowany magazyn sesji = nieobsłużone odrzucenie obietnicy (telemetria błędów JS).                                                  | `catch` - bez frazy, jak przy błędzie bramki.                                                                                                                                                                                                                 |

## 3. Optymalizacja

- **Jeden submit zamiast O(zdarzeń).** Na `/search` jedno dyktowanie to
  jedna nawigacja, jeden wpis w „ostatnich", jedno `log_search_query`
  (i jeden zestaw `search_posts`/`search_facets`); w widgecie bez wyników na
  żywo jedno `search_autosuggest`.
- **`onText` bez powtórzeń.** Identyczny interim nie re-renderuje `/search`
  (`setDraft`) i nie przestawia 200 ms debounce wyników na żywo w widgecie.
- **Martwy VAD usunięty** (ścieżka serwerowa). Od kiedy cisza celowo nie
  kończy nagrania, graf Web Audio (źródło, highpass, analizator) i pętla
  `requestAnimationFrame` liczyły RMS z 1024 próbek co klatkę przez całe
  nagranie - do 5 minut - a wynik szedł do `void wait`. Usunięte: 6 stałych,
  3 refy, graf i pętla.
- Uchwyty odpinane przy końcu dyktowania: spóźnione zdarzenia przeglądarki
  nie wykonują już żadnej pracy, a pętle start -> błąd -> koniec nie palą
  wątku głównego ani nie ponawiają pytania o zgodę.

## 4. Testy

| plik                                                                             | co domyka                                                                                                                                                                                                                                                                 |                                 przypadków |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------------: |
| `lib/search/__tests__/useVoiceSearch.test.tsx`                                   | V1-V9: regresja serii (≥ 20 zdarzeń, zero `onFinal` przed stopem), wynik po `stop()`, klik w trakcie dosyłania, wznowienia, kody błędów, WebKit bez `end`, pętle, bezpiecznik, strażnik, odmontowanie, Android, WebKit                                                    |           +27 (5 przepisanych, 3 usunięte) |
| jw. - wzmocnienia z przeglądu (W1-W3)                                            | W1: dwa finały z realną pewnością nie są zwijane; (+1, czerwony przed poprawką) niezależne finały z pewnością 0 nie gubią słowa będącego początkiem następnego; W2: utrata sieci PO wypowiedzi kończy dyktowanie; W3: puste obroty przeplatane zwykłą sesją go nie kończą | +3 (W1 wzmacnia przypadek z wiersza wyżej) |
| `components/builder/organisms/widget-view/__tests__/SearchButtonWidget.test.tsx` | kotwica u konsumenta: dyktowanie bez wyników na żywo - zero zapytań w trakcie, jedno po stopie, z pełną frazą                                                                                                                                                             |                               1 przepisany |

Przepisane testy, które przypinały defekt: „wynik OSTATECZNY zatwierdza
frazę" (teraz: trafia do pola od razu, zatwierdza dopiero stop), „błąd jest
cichy - onend zawsze przychodzi" (fałszywa przesłanka dla WebKit; cichy jest
tylko `no-speech`), „ANONIM … fraza WRACA do wyszukiwania" (po stopie).
Usunięte testy martwego VAD (KALIBRACJA, MOWA potem CISZA, CISZA BEZ MOWY,
„brak Web Audio") zastępuje test, że nagranie nie stawia grafu Web Audio ani
pętli klatek; bezpiecznik 5 min zostaje pod testem.

Atrapa `SpeechRecognition` modeluje realny silnik: `abort()` daje
asynchroniczne `error: aborted` i `end`, tryb `endOnStop: false` oddziela
`end` od `stop()`, błędy niosą kod, starty są liczone.

Mutanty (W1-W3): usunięcie warunku `confidence === 0`, usunięcie resetu
`hadResult` w `onend`, licznik pustych obrotów bez resetu - każdy pada
dokładnie na swoim teście, reszta suity zostaje zielona.

## 5. Zmiana UX (zamierzona)

Anonim (Web Speech) dostaje submit po stopie, a nie przy pierwszej pauzie -
tak jak zalogowany w ścieżce serwerowej. Między kliknięciem stopu a `end`
(zwykle ułamek sekundy, najwyżej 3 s) mikrofon jest już zgaszony, a `busy`
ignoruje kliknięcia - jak podczas wysyłki na `/api/stt`. Wyniki na żywo
w widgecie (domyślne) działają jak dotąd, bo napędza je `onText`.

## 6. Czego dowód nadal nie obejmuje

- Prawdziwych urządzeń: iOS Safari 17+ i Chrome Android 156/157 są
  modelowane w happy-dom na podstawie źródeł Chromium/WebKit; warto
  sprawdzić ręcznie.
- Wpisanie frazy z Enterem albo wybór podpowiedzi W TRAKCIE dyktowania go
  nie zatrzymuje - późniejszy stop wyśle frazę jeszcze raz (na `/search` ten
  sam adres, „ostatnie" deduplikują). Naprawa wymaga zmian w konsumentach
  i `cancel()` w API hooka - osobny krok.
- Błąd krytyczny w trakcie dyktowania (np. `aborted`, gdy Android chowa
  kartę) zatwierdza zebraną już frazę - świadomie: pole ją pokazuje.

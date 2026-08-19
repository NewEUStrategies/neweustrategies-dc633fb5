# Moduł 7 „Typy treści specjalne": z 16,5% na 100% linii, wszystkie 67 plików pokryte, trzy naprawione defekty (2026-08-18)

Ten sam ruch, który PR #250 zrobił dla czatu (`docs/WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md`),
a PR #252 dla profilu (`docs/WDROZENIE_PROFIL_TESTY_2026-08-18.md`), zastosowany do **modułu 7**,
który audyt `AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (rozdział 3) wskazał jako
najbardziej nierówny w całym repozytorium: osiem funkcjonalności rozrzuconych od 0,0% do 87,1%.

Liczby bazowe pochodzą z audytu i zostały **zweryfikowane własnym przebiegiem** na HEAD `39a9efd`.
Liczby końcowe są mierzone tym samym narzędziem (vitest v8, `all: true`), zawężonym do ścieżek
modułu 7 - dzięki temu pliki, których nikt nie tknął, **zostają w mianowniku**, a nie znikają
z pomiaru.

Praca poszła w dwóch turach. Pierwsza (§1-§4) zdjęła z zera warstwę reguł, loaderów i serwerową
oraz mniejsze widoki - moduł wyszedł na 70,8% linii. Druga (§9) domknęła to, co pierwsza świadomie
odłożyła: sześć dużych plików interfejsu i trzy pliki-deklaracje server functions. **Moduł stoi
teraz na 100% linii i 100% funkcji przy 67 plikach w mianowniku.**

---

## 1. Stan wyjściowy: osiem funkcjonalności w ośmiu różnych stanach

| Funkcjonalność                   | Plików | LOC mierz. |     Linie | fn (szt.) |
| -------------------------------- | -----: | ---------: | --------: | --------: |
| Biblioteka plików                |      5 |        229 |  **0,0%** |      0/72 |
| Web stories                      |      2 |         75 | **17,3%** |      8/25 |
| Huby ekspertów                   |     23 |        808 | **28,1%** |    79/251 |
| Tracker legislacyjny             |      9 |        235 | **31,1%** |     29/95 |
| Quiz / mapy                      |      5 |        251 | **51,0%** |     27/62 |
| Podcast                          |      4 |         78 | **56,4%** |     10/32 |
| Wydarzenia (RSVP, waitlist, ICS) |     15 |        208 | **60,6%** |     42/67 |
| Programy badawcze                |      4 |         31 | **87,1%** |     13/14 |

Moduł jako całość: **16,47% linii, 14,60% funkcji** (239 z 1 637), 75 ze 109 plików bez ani
jednej wykonanej linii.

### 1.1 Dlaczego pokrycie stało w miejscu

To nie był moduł „równo słaby" i nie były to reguły trudne do przetestowania. Warstwa reguł
w `lib/*` miała testy od dawna (tracker: feed, jsonld, stages, euCountries; experts: filter,
normalize, publicVisibility, materials\*; events: schedule, sponsors, countdown; programs: shape,
visual), a warstwa danych ma pgTAP (`community_events_*`, `expert_*`, `tracker_feed_tenant_isolation`).

Dziura była w **warstwie loaderów, serwerowej i widoków** - i miała jedną wspólną przyczynę:

1. **Reguły mieszkały WEWNĄTRZ renderu.** `DocumentViewerBody.tsx` podejmował tę samą sekwencję
   decyzji („stary format? -> błąd? -> jeszcze mielimy? -> pusto?") w trzech kopiach, wewnątrz
   JSX-a. Sprawdzenie którejkolwiek wymagało pełnego renderu z fetchem i parserem naraz.
   Identycznie `StoryViewer.tsx`: maszyna przewijania w jednym pliku z pętlą
   `requestAnimationFrame` i focus trapem.
2. **Warstwa serwerowa nie miała atrapy dla DWÓCH dróg do bazy naraz.** `ticket.server.ts`
   rozmawia z Supabase łańcuchem `from(...)` **oraz** przez `rpc(...)`; wspólna atrapa repo
   (`src/test/supabaseChain.ts`) zna tylko pierwszą.
3. **`getRequest()` nie było w repo mockowane ANI RAZU.** Konwencja („logika bierze `Request`,
   trasa go podaje") nie obejmowała `feed.server.ts`, który sięga po żądanie ambientowo.

---

## 2. Co powstało zamiast obchodzenia problemu

**Trzy czyste moduły wyprowadzone z komponentów** - nie po to, żeby podbić liczbę, tylko dlatego,
że reguła w złym miejscu jest regułą bez testu:

| Nowy moduł                         | Co wyszło z komponentu                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/files/viewerState.ts`     | jedna reguła stanu czytnika zamiast trzech kopii w JSX-ie                          |
| `src/lib/web-stories/viewerNav.ts` | maszyna przewijania historii (koniec serii, podłoga 2 s, pasek postępu)            |
| `src/lib/experts/layoutRules.ts`   | tokeny CSS układu, budowa reguły `.dark`, sygnatura nadpisań (dirty-check edytora) |

**Jeden atom** w duchu atomic design: `src/components/files/atoms/ViewerNotice.tsx` - trzy
warianty komunikatu (zajętość / błąd / pusty dokument) sterowane **deskryptorem**, zamiast trzech
prywatnych komponentów powielonych w czterech czytnikach. Czytniki stały się molekułami: efekt
pobrania + `switch` po `panel.kind`.

**Fixture'y** `src/test/events/fixtures.ts` re-eksportują wspólną atrapę łańcucha PostgREST
(bez kopiowania jej po raz czwarty) i dokładają `supabaseClientStub()`, który skleja `from()`
z `rpc()` i **zapisuje wywołania RPC** - dzięki temu test potrafi udowodnić, że danego zapytania
w ogóle NIE BYŁO.

**i18n**: zero nowych kluczy. Wszystkie komunikaty, których dotykają nowe testy, miały już komplet
PL/EN. Funkcje w nowych modułach zwracają **klucz i18n albo deskryptor**, nie gotowy tekst - test
reguły nie zmienia się, gdy redakcja przepisze copy, a zniknięcie klucza ze słownika oblewa test
renderu (te używają PRAWDZIWEGO `t`, nie atrapy echującej klucz).

---

## 3. Defekty znalezione PRZY PISANIU testów

### 3.1 Podgląd pobierał pliki, których i tak nie umiał otworzyć (NAPRAWIONE)

Napisałem test „stary format `.doc` nie pobiera pliku" i zgasł. `useArrayBuffer` jest **hookiem**,
więc startował bezwarunkowo - zanim render doszedł do wczesnego powrotu z komunikatem „pobierz
plik, aby otworzyć go lokalnie". Użytkownik płacił transferem za kilkanaście megabajtów, których
nigdy nie zobaczył.

Parametr `enabled` tego hooka był przy tym **martwy**: wszystkie trzy czytniki podawały `true`.
To sama w sobie wskazówka, że intencja była właśnie taka. Naprawione przez `enabled: !isLegacy`.

### 3.2 `eventKindLabel` zwracało `undefined` zamiast surowej wartości (NAPRAWIONE)

`KIND_LABELS[kind]` dla `kind = "constructor"` trafiało w `Object.prototype`. Warunek widział
wartość **prawdziwą** (funkcję), a `entry[lang]` dawało `undefined` - czyli funkcja łamała własną
obietnicę z docstringa („nieznany kind wraca bez zmian") i renderowała pustkę. Kolumna
`events.kind` ma dziś CHECK-a, więc nie było to osiągalne z UI, ale kontrakt publicznej funkcji
nie ma zależeć od cudzego CHECK-a. Naprawione przez `Object.hasOwn`.

### 3.3 `textOf` używał selektora niespójnego z resztą pliku (NAPRAWIONE)

`querySelectorAll("t")` z gołą nazwą lokalną, podczas gdy `parsePptx` i `slideNotes` dwie funkcje
niżej sięgają po `getElementsByTagName("a:p")` / `("a:t")`. Selektor typu bez prefiksu dopasowuje
po nazwie lokalnej **tylko** w implementacji zgodnej ze specyfikacją Selectors; przeglądarki to
robią, happy-dom nie - więc funkcja po cichu spadała na `textContent` całego akapitu. Dla prostych
slajdów wynik ten sam, przy akapicie z tekstem spoza przebiegów `a:t` - już nie. Ujednolicone.

### 3.4 Przypięte asercją, ŚWIADOMIE nienaprawione

- **`ticketCodeFrom` czyta wyłącznie pierwsze 24 znaki szesnastkowe ziarna.** UUID ma 32, więc dwa
  zamówienia różniące się tylko końcówką dostaną ten sam numer biletu. Dla `gen_random_uuid()` to
  zdarzenie rzędu 16⁻⁸ - nie jest to defekt na dziś, ale JEST cicha właściwość, którą refaktor
  mógłby zmienić bez ani jednego czerwonego testu, unieważniając wydrukowane bilety.
- **`showDescription` ma inny łańcuch fallbacków niż `showTitle`** - kończy się na
  `|| description_pl`, bez członu `|| description_en`. Polska strona programu opisanego wyłącznie
  po angielsku zostaje BEZ opisu, choć tytuł w tej samej sytuacji spadłby na angielski. Opis kanału
  idzie też do feedu, więc to decyzja **redakcyjna**, nie porządkowa.
- **Ramię `Number.isNaN(value)` w `ticketCode.ts` jest nieosiągalne** (`hex` jest przefiltrowany do
  `[0-9a-f]`, a fallback to cyfra). Stąd próg gałęzi 70, a nie naciągany test.

---

## 4. Pułapka harnessu, którą warto zapamiętać

`vi.mock("react-i18next", ...)` z fabryką sięgającą po `@/test/i18nReal` **zawiesza cały przebieg
bez żadnego komunikatu**. Helper importuje `@/lib/i18n`, a ten importuje `initReactI18next`
z modułu, który właśnie zastępujemy - rozwiązywanie się zapętla. Docstring `i18nReal.ts` ostrzega
przed tym wprost i **dlatego `reactI18nextMock` nie ma w repo ani jednego wywołania**.

Testy komponentów w tym PR używają PRAWDZIWEGO `useTranslation()`, a `realT` służy wyłącznie do
zbudowania `t` po stronie asercji. Opisane w nagłówkach obu plików testowych, żeby następna osoba
nie straciła na tym godziny.

Drugie odkrycie tej klasy: **`edgeTtlCache` wychodzi natychmiast, gdy istnieje `window`**. Cache
SSR jest per-izolat serwera; współdzielenie go w przeglądarce oznaczałoby pokazanie jednemu
użytkownikowi danych rozgrzanych dla innego. Pierwsza wersja testu zakładała buforowanie także
w happy-dom i słusznie zgasła - została przepisana tak, by przypinać właśnie to rozgraniczenie.

---

## 5. Wynik: przed → po (własny pomiar)

### 5.1 Moduł jako całość

| Metryka     |  Przed | Po turze I | Po turze II | Delta łącznie |
| ----------- | -----: | ---------: | ----------: | ------------- |
| **Linie**   | 16,47% |     70,83% |    **100%** | +83,5 pp      |
| **Funkcje** | 14,60% |     71,19% |    **100%** | +85,4 pp      |
| Instrukcje  | 16,70% |     71,26% |  **99,02%** | +82,3 pp      |
| Gałęzie     | 13,30% |     61,89% |  **93,13%** | +79,8 pp      |

Cel z zadania (linie ≥ 35%, funkcje ≥ 30%) jest przekroczony blisko trzykrotnie; późniejszy cel
95% też. **67 plików produkcyjnych, 1 238 przypadków testowych, 19,5 s przebiegu.**

Rozkład po katalogach - **żaden plik modułu nie ma już zerowego pokrycia**:

| Katalog                  | Linie przed | Linie po | Funkcje po |
| ------------------------ | ----------: | -------: | ---------: |
| `lib/events`             |      82,75% | **100%** |   **100%** |
| `lib/experts`            |        ~34% | **100%** |   **100%** |
| `lib/files`              |        0,0% | **100%** |   **100%** |
| `lib/podcast`            |       56,4% | **100%** |   **100%** |
| `lib/programs`           |       93,1% | **100%** |   **100%** |
| `lib/tracker`            |       31,1% | **100%** |   **100%** |
| `lib/web-stories`        |       17,3% | **100%** |   **100%** |
| `components/events`      |        0,0% | **100%** |   **100%** |
| `components/experts`     |       5,08% | **100%** |   **100%** |
| `components/files`       |        0,0% | **100%** |   **100%** |
| `components/podcast`     |        0,0% | **100%** |   **100%** |
| `components/programs`    |        0,0% | **100%** |   **100%** |
| `components/quiz`        |      43,47% | **100%** |   **100%** |
| `components/tracker`     |      11,86% | **100%** |   **100%** |
| `components/web-stories` |        0,0% | **100%** |   **100%** |

### 5.2 Per plik / powierzchnia

Tura I:

| Ścieżka                                      | Przed | Po (linie / funkcje) |
| -------------------------------------------- | ----: | -------------------: |
| `src/lib/events/ticket.server.ts`            |  0,0% |      **100% / 100%** |
| `src/lib/events/ticketCode.ts`               |  0,0% |      **100% / 100%** |
| `src/lib/events/kinds.ts`                    |  0,0% |      **100% / 100%** |
| `src/components/community/ticketDocument.ts` |  0,0% |      **100% / 100%** |
| `src/lib/files/fileKinds.ts`                 |  0,0% |      **100% / 100%** |
| `src/lib/files/officeParse.ts`               |  0,0% |      **100% / 100%** |
| `src/lib/files/viewerState.ts` _(nowy)_      |     — |      **100% / 100%** |
| `src/lib/tracker/queries.ts`                 |  0,0% |      **100% / 100%** |
| `src/lib/tracker/feed.server.ts`             |  0,0% |      **100% / 100%** |
| `src/lib/experts/layoutRules.ts` _(nowy)_    |     — |      **100% / 100%** |
| `src/lib/podcast/types.ts`                   | 56,4% |      **100% / 100%** |
| `src/lib/web-stories/viewerNav.ts` _(nowy)_  |     — |      **100% / 100%** |
| `src/components/web-stories/StoryViewer.tsx` |  0,0% |      **100% / 100%** |

Tura II - sześć dużych plików interfejsu i trzy pliki-deklaracje:

| Ścieżka                                               |  LOC | Przed | Po (linie / funkcje) |
| ----------------------------------------------------- | ---: | ----: | -------------------: |
| `src/components/experts/ExpertLayoutRenderer.tsx`     | 1134 |  0,0% |      **100% / 100%** |
| `src/components/experts/ExpertLayoutInlineEditor.tsx` |  565 |  0,0% |      **100% / 100%** |
| `src/components/tracker/PolicyPositionsMap.tsx`       |  289 |  0,0% |      **100% / 100%** |
| `src/components/events/SpeakerProfileDialog.tsx`      |  278 |  0,0% |      **100% / 100%** |
| `src/components/experts/ExpertMaterialsExplorer.tsx`  |  276 |  0,0% |      **100% / 100%** |
| `src/components/quiz/QuizBackground.tsx`              |  180 |  0,0% |      **100% / 100%** |
| `src/lib/experts/refreshOg.functions.ts`              |   64 |  0,0% |      **100% / 100%** |
| `src/lib/events/rsvp-email.functions.ts`              |   45 |  0,0% |      **100% / 100%** |
| `src/lib/programs/icons.ts`                           |   42 |  0,0% |      **100% / 100%** |
| `src/lib/events/ticket.functions.ts`                  |   32 |  0,0% |      **100% / 100%** |
| `src/components/experts/atoms/**` _(nowe)_            |   72 |     — |      **100% / 100%** |

## 6. Co pominięte i dlaczego

- **Reguły egzekwowane przez bazę.** Bramka rangi biblioteki plików, tier gate wydarzeń, FIFO listy
  rezerwowej, promocja po zwolnieniu miejsca i izolacja tenanta feedu mają dowody w pgTAP
  (`supabase/tests/community_events_test.sql`, `community_events_waitlist_test.sql`,
  `tracker_feed_tenant_isolation_test.sql`). Powtórzenie ich w vitest dowodziłoby wyłącznie tego,
  że atrapa zachowuje się tak, jak ją napisano.
- **Trasy adminowe** (`admin.podcasts.tsx` 337, `admin.research-programs.tsx` 249,
  `admin.tracker.tsx` 187 i pozostałe) oraz `events.$slug.tsx` / `podcast.$slug.tsx` - cienka
  kompozycja loaderów i paneli, której sens dowodzą e2e i bramki SSR.
- ~~**`SpeakerProfileDialog.tsx`**~~ i ~~**`refreshOg.functions.ts`**~~ - odłożone w turze I,
  **domknięte w turze II** (§9). Wzorzec na server functions okazał się prosty i wielokrotny:
  atrapa `createServerFn` oddaje z `.handler(fn)` samą funkcję, więc test wywołuje PRAWDZIWY
  handler i PRAWDZIWY walidator wejścia z podstawionym kontekstem.
- **Autoodtwarzanie Web Story ponad jedną klatkę** - pętla jest sprawdzana przez PRZEJĘCIE
  `requestAnimationFrame` i podanie własnego znacznika czasu; czekanie sekundami na prawdziwe
  klatki dałoby test migoczący przy obciążonym CI, a test migoczący uczy zespół ignorować czerwień.

---

## 7. Bramki pokrycia (`vitest.config.ts`)

Moduł 7 nie miał **ani jednego** progu per-ścieżka. Doszło **31 wpisów**,
floorowanych tuż pod zmierzonym poziomem (zasada bez zmian: wolno je wyłącznie podnosić):

Tura I: `lib/events/ticket.server.ts`, `lib/events/ticketCode.ts`, `lib/tracker/queries.ts`,
`lib/tracker/feed.server.ts`, `lib/files/fileKinds.ts`, `lib/files/viewerState.ts`,
`lib/files/officeParse.ts`, `components/files/**`, `lib/web-stories/viewerNav.ts`,
`components/web-stories/StoryViewer.tsx`, `lib/podcast/types.ts`.

Tura II: `components/experts/ExpertLayoutRenderer.tsx`,
`components/experts/ExpertLayoutInlineEditor.tsx`, `components/experts/ExpertMaterialsExplorer.tsx`,
`components/experts/atoms/**`, `components/experts/**` (zbiorczy),
`components/events/SpeakerProfileDialog.tsx`, `components/tracker/PolicyPositionsMap.tsx`,
`components/quiz/QuizBackground.tsx`, `lib/events/{ticket,rsvp-email}.functions.ts`,
`lib/programs/icons.ts`, `components/programs/**`; `lib/experts/**` podniesiony ratchetem
(91% linii → 100%).

Dodatkowo `reportOnFailure: true` w bloku `coverage`: `checkThresholds` żyje wewnątrz
`reportCoverage()`, z którego vitest wychodzi natychmiast po pierwszym padniętym teście - przy
czerwonej suicie nie powstawał więc ŻADEN raport, czyli pomiaru nie było dokładnie wtedy, gdy jest
najbardziej potrzebny.

---

## 8. Jak zweryfikować

```bash
bun install
bun run test                # cała suita
bun run typecheck           # 0 błędów
bun run format:check        # bez zmian
bun run test:coverage       # progi per-ścieżka włączone
```

Pomiar samego modułu 7 (ścieżki jak w audycie, `all: true`, więc pliki nietknięte zostają
w mianowniku) - polecenie rozpisane celowo, żeby dało się je powtórzyć co do liczby. Zakres
przebiegu jest ZAWĘŻONY do katalogów modułu: mianownik pokrycia zostaje pełny (`--coverage.include`

- `all: true`), a czas schodzi z dziesiątek minut do ~20 s, więc pomiar nadaje się do pętli pracy,
  nie tylko do raportu:

```bash
bunx vitest run \
  src/lib/{events,tracker,experts,files,podcast,web-stories,programs} \
  src/components/{events,tracker,experts,files,podcast,web-stories,programs,quiz,community} \
  --coverage --coverage.all=true \
  --coverage.include='src/lib/{events,tracker,experts,files,podcast,web-stories,programs}/**' \
  --coverage.include='src/components/{events,tracker,experts,files,podcast,web-stories,programs,quiz}/**' \
  --coverage.reporter=text-summary
```

Wynik na HEAD tej gałęzi: **100% linii, 100% funkcji, 99,02% instrukcji, 93,13% gałęzi**
(1 238 testów, 19,5 s). Zawężenie przebiegu zaniża wynik o tyle, o ile jakiś plik modułu jest
wykonywany WYŁĄCZNIE przez test spoza tych katalogów (np. z `src/routes`) - dla `lib/experts`
to różnica ~0,2 pp instrukcji, więc progi są floorowane pod wartość z węższego przebiegu, żeby
bramka trzymała w obu zakresach.

---

## 9. Tura II: sześć dużych plików interfejsu i trzy deklaracje server functions

Tura I zostawiła listę z §6 - i to ona była właściwą pracą, nie „dokładką". Sześć plików po
180-1134 linii, wszystkie na zerze, wszystkie z regułami, których nie widać w typach. Poniżej to,
co każdy z nich naprawdę pilnuje; kolejność od najgroźniejszej regresji.

### 9.1 Treść przykładowa nie może wyciec na publiczną stronę eksperta

`ExpertLayoutRenderer.tsx` (1134 linie) obsługuje DWIE powierzchnie jednym kodem: podgląd w
`/admin/expert-layouts` i realną stronę `/author/$slug`. Różni je jedna flaga - `showPlaceholders`.
Tryb podglądu dosypuje przykładowe nazwisko („Przykładowy Ekspert"), biogram, rolę, cztery zmyślone
wzmianki prasowe i cudze adresy LinkedIn/X.

Najgroźniejsza regresja tego pliku nie jest błędem typów, lintu ani testu jednostkowego reguły:
to **wyciek tych danych na stronę realnego eksperta**, gdzie wyglądają jak jego prawdziwe kontakty
i jego prawdziwy dorobek. Każda gałąź placeholdera ma więc parę asercji: „w podglądzie jest" /
„publicznie nie ma" - łącznie 9 par (nazwisko, rola, biogram, kanały social, kontakt inline,
kontakt prasowy, obszary, wzmianki, podcasty).

Drugi filar to **umowa wspólna ośmiu presetów**: każdy wariant układu musi wystawić dokładnie
jeden `<h1>` z nazwiskiem, linię roli i odznakę weryfikacji. To nie jest kosmetyka - komentarz
w kodzie mówi wprost, że odznaka „znikała przy layoutach bez paska nad hero". Asercje idą przez
`it.each(EXPERT_LAYOUT_PRESETS)`, więc **nowy preset bez tych elementów oblewa test w dniu, w
którym powstanie**, a nie po zgłoszeniu z SEO.

Trzeci: `switch` po dziewięciu kluczach sekcji ma jedną regułę - publicznie sekcja bez danych
ZNIKA (pusty nagłówek wygląda jak awaria wczytywania), w podglądzie pokazuje treść przykładową
z jawną plakietką. Osobno przypięte: sekcja CV istnieje WYŁĄCZNIE jako zapowiedź w podglądzie
(nie mamy modelu danych CV), a materiały nie są renderowane przez tę listę, bo rysuje je
eksplorator z własnym filtrem - dublet dałby dwie różne listy tych samych publikacji.

### 9.2 „Dziedzicz" znaczy „klucza nie ma"

`ExpertLayoutInlineEditor.tsx` (565 linii) nie zapisuje ustawień - zapisuje RÓŻNICĘ wobec ustawień
tenanta. Cała poprawność sprowadza się do jednego zdania:

> „dziedzicz" = KLUCZA NIE MA w nadpisaniach.

Zapisanie w tym miejscu `false`, `null` albo pustego obiektu `visibility: {}` wygląda w interfejsie
identycznie, a znaczy coś zupełnie innego: strona eksperta **zamraża dzisiejszą wartość tenanta
i przestaje za nim nadążać**. Redakcja zmienia preset dla całej organizacji, ten jeden profil
zostaje na starym - i nikt nie wie dlaczego, bo w edytorze wszystko stoi na „dziedzicz". Każdy
setter (preset, widoczność sekcji, kolejność, wycentrowanie, akcent jasny i ciemny) ma więc
asercję na KSZTAŁT różnicy, nie na wygląd kontrolki.

Pod bramką jest też dirty-check: „Zapisz" martwy dopóki nic się nie zmieniło, po udanym zapisie
gaśnie ponownie (baseline się przesuwa), a zamknięcie z niezapisanymi zmianami pyta - inaczej
godzina układania sekcji znika po jednym Escape. Plus dwie rzeczy łatwe do zgubienia: odmontowanie
sprząta draft (wyjście z profilu w trakcie edycji nie zostawia strony w stanie podglądu), a pole
koloru trzyma lokalny bufor tekstu, bez którego `oklch(0.6 0.1 240)` byłoby nie do wpisania,
bo sanityzacja ucinałaby spacje przy każdym znaku.

### 9.3 Adres strony jako stan aplikacji

`ExpertMaterialsExplorer.tsx` (276 linii) nie ma własnego stanu: filtry i numer strony żyją w
search params trasy, a stronę wycina RPC. Cała jego logika to budowa URL-a - i trzy reguły tej
budowy, których złamania nie zauważy ani kompilator, ani lint:

1. **zmiana filtra WRACA na stronę 1** - bez tego czytelnik z 7. strony pełnego dorobku ląduje
   na 7. stronie zbioru, który ma jedną,
2. **wartości domyślne NIE trafiają do adresu** - `?page=1` i `?kind=` tworzą drugi URL dla tej
   samej treści, czyli duplikat dla wyszukiwarki,
3. **nawigacja idzie z `resetScroll: false`** - kotwicą jest sekcja materiałów; globalny
   scroll-to-top wyrzuca czytelnika do hero profilu.

Osobno: przycinanie numeru strony poza zakresem (stara zakładka) z `replace: true`, brak
przycinania przy pustym wyniku filtra (to poprawny stan, nie zły URL) i to, że każdy wymiar
zapisuje się pod WŁASNYM kluczem - przestawienie tematu z regionem jest niewidoczne w typach,
bo oba są napisami.

### 9.4 Tabela jako równorzędna droga do danych

`PolicyPositionsMap.tsx` (289 linii) to jedyny wykres modułu kodujący dane KOLOREM. Reguła stoi
wypisana w nagłówku samego pliku, a teraz także pod bramką: **tooltip nigdy nie jest jedyną drogą
do danych**. Osoba czytająca ekran, drukująca dossier albo nierozróżniająca zieleni od czerwieni
dostaje komplet z przełączanej tabeli; państwa ze stanowiskiem są osiągalne z klawiatury, a te bez
stanowiska - przeciwnie, bo w porządku tabulacji byłyby pustym przystankiem. Regresja jest tu
wyjątkowo cicha: mapa dalej wygląda dobrze.

Druga reguła: porządek tabeli „za → przeciw → podzielone → brak" niesie sens polityczny (kto
popiera, kto blokuje), a alfabet w obrębie grupy idzie po nazwach W JĘZYKU STRONY - `localeCompare`
bez locale stawia „Łotwę" za „Węgrami".

### 9.5 Okno, które nigdy nie jest puste - i zapytania, które śpią

`SpeakerProfileDialog.tsx` (278 linii) spina trzy niezależne źródła i wisi na agendzie, gdzie
prelegentów bywa kilkudziesięciu. Dwie reguły:

- **okno nigdy nie jest puste** - gdy profilu w bazie nie ma (albo jeszcze nie doszedł),
  użytkownik widzi dane awaryjne z kafelka widgetu, a nie białe okno;
- **zapytania śpią przy zamkniętym oknie** - komponent montuje się raz na prelegenta, więc bez
  `enabled` wydarzenie z 30 nazwiskami odpalałoby 60 równoległych zapytań przy samym wejściu.

Plus fallback dwujęzyczny SYMETRYCZNY - także dla tematów, gdzie łatwo go pominąć, bo to tablica,
a nie napis - i zachowanie przy uszkodzonej dacie: wiersz wypada z listy, zamiast wypisać
„Invalid Date" (porównania z NaN są fałszywe w obie strony).

### 9.6 Wariant przeciwnego motywu nigdy nie trafia do DOM

`QuizBackground.tsx` (180 linii) istnieje wyłącznie po to, żeby NIE pobierać tego, czego
użytkownik nie zobaczy: tło quizu to cztery pliki po kilkaset kB w trzech formatach i dwóch
wariantach motywu. Test pilnuje tego wprost, adresami plików: w trybie jasnym w DOM nie ma ani
jednego adresu wariantu ciemnego i odwrotnie. Zamiana warunku na dwa `<picture>` z
`dark:opacity-0` wygląda w recenzji identycznie, a **podwaja transfer na wejściu w quiz** - czyli
na ruchu kampanijnym, w większości mobilnym.

Drugi filar: parallax MUSI ustąpić przy `prefers-reduced-motion`, bo ruchome tło przy przewijaniu
wywołuje mdłości u części osób. Pod testem jest też inline-script preloadu, który do tej pory nie
wykonał się w ŻADNYM teście - uruchamiany przez `new Function` z podstawionym magazynem i
zapytaniami media: motyw ciemny dokłada preload, jasny nie dokłada nic, telefon dostaje wariant
mobilny, a awaria `localStorage` (tryb prywatny, zablokowane ciasteczka) nie wywala strony.

### 9.7 Deklaracje server functions: walidator i granica uprawnień

`ticket.functions.ts`, `rsvp-email.functions.ts` i `refreshOg.functions.ts` to pliki, w których
repo trzyma WYŁĄCZNIE deklarację server function (wymóg `tss-serverfn-split`) - stąd wcześniejsza
decyzja o pominięciu. Niosą jednak dwie rzeczy, których nie dotknie żaden test warstwy logiki:

- **walidator wejścia** - jedyna bariera między publicznym `POST` a kolumną `uuid`. Pod testem:
  przycinanie, odrzucanie nie-UUID, odrzucanie wartości nietekstowych (JSON przynosi liczby,
  tablice i `null`) i przyjmowanie UUID wielkimi literami, bo Postgres jest tu niewrażliwy na
  wielkość znaków;
- **granica uprawnień** - `getMyEventTicket` czyta klientem WOŁAJĄCEGO (RLS widzi jego
  `auth.uid()`), a `getEventSeatState` jest świadomie publiczny, bo licznik miejsc musi działać
  dla gościa przed zalogowaniem. Przepięcie jednego w drugie albo wystawia cudzy bilet, albo psuje
  stronę wydarzenia dla gości.

Dla `refreshOg` przypięte jest to, że wersja og:image pochodzi z `updated_at` W BAZIE, a nie z
zegara procesu (inaczej adres w podglądzie i adres na stronie rozjeżdżają się i scraper dostaje
wciąż stary obrazek), oraz że adresy budują się z ORIGINU ŻĄDANIA - inaczej autor na środowisku
testowym wysyła Facebooka pod produkcję. Dla maila po bezpłatnym RSVP: klucz idempotencji po
WIERSZU zapisu (`rsvp:<id>`), więc „idę" → „nie idę" → „idę" nie zasypuje skrzynki kopiami.

### 9.8 Atomic design

Dwa elementy wyprowadzone z eksploratora materiałów do `components/experts/atoms/`:

| Atom                   | Reguła, która była nietestowalna wewnątrz organizmu                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `FacetSelect`          | wymiar bez opcji ZNIKA (chyba że szkieletowy); „wszystkie" wraca jako `null`, bo to `null` kasuje klucz z URL-a |
| `MaterialCardSkeleton` | migotanie jest `aria-hidden` - inaczej czytnik ogłasza trzy puste karty przy każdej zmianie strony              |

### 9.9 Pułapki harnessu z tej tury

Cztery rzeczy, które kosztowałyby następną osobę godziny:

1. **Radix Select nie otwiera się w happy-dom.** Konwencja repo (`FormSelect.test.tsx`) mówi
   „nie próbuj". Tam, gdzie przedmiotem testu jest to, CO robi zmiana filtra (a nie to, jak Radix
   rysuje listę), prymitywy `ui/select` podmieniamy na natywny `<select>` - w atrapie czytamy
   `aria-label` z triggera i opcje z treści, bo natywny element potrzebuje obu w jednym miejscu.
2. **`BrandIcon` ciągnie katalog ikon przez `useQuery`.** Goły `render()` wywala „No QueryClient
   set" na każdym komponencie z ikoną kanału. Stąd `renderWithQueryClient` + `listIcons → []`,
   czyli ścieżka fallbacku na ikony Lucide.
3. **happy-dom nie implementuje geometrii SVG** (`getBBox`, `viewBox.baseVal`). Obsługa fokusu na
   mapie ma więc dwa testy: jeden na wersję bez geometrii (komponent nie może się wywalić), drugi
   z podstawioną ręcznie.
4. **`createServerFn` da się rozpakować.** Atrapa oddaje z `.handler(fn)` samą funkcję z doklejonym
   `validate`, więc test wywołuje PRAWDZIWY handler i PRAWDZIWY walidator z podstawionym kontekstem,
   a nie imitację własnego wymyślenia. To wzorzec do ponownego użycia w innych modułach.

Do tego jeden zapis metodyczny: treść podpowiedzi na mapie sprawdzamy przez selektor
`.neh-tooltip`, a nie przez `container.textContent` - ukryta tabela niesie te same napisy, więc
tekst całego kontenera nie odróżniłby jednej drogi do danych od drugiej. Test, który tego nie
rozdziela, przechodzi po usunięciu tooltipa I po usunięciu tabeli.

### 9.10 Defekt naprawiony po drodze (nie z tej gałęzi)

`bun run lint` był czerwony na `main`: `AccountIdentityPanel.test.tsx` sięgał po `require("react")`
w atrapie `<Link>`, co łamie `@typescript-eslint/no-require-imports`. To jedyny BŁĄD w całym
`eslint .` (pozostałe 177 zgłoszeń to ostrzeżenia), obecny od commita `7fecd12`, więc bramka
`verify` przewracała się przed dojściem do testów - niezależnie od tej pracy. Atrapa ustąpiła
wspólnemu `@/test/routerLinkStub`; dwie linie, zachowanie identyczne, `eslint .` schodzi do zera
błędów.

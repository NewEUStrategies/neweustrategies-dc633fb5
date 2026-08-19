# Moduł 7 „Typy treści specjalne": z 16,5% na 70,8%, cztery funkcjonalności zdjęte z zera i trzy naprawione defekty (2026-08-18)

Ten sam ruch, który PR #250 zrobił dla czatu (`docs/WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md`),
a PR #252 dla profilu (`docs/WDROZENIE_PROFIL_TESTY_2026-08-18.md`), zastosowany do **modułu 7**,
który audyt `AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (rozdział 3) wskazał jako
najbardziej nierówny w całym repozytorium: osiem funkcjonalności rozrzuconych od 0,0% do 87,1%.

Liczby bazowe pochodzą z audytu i zostały **zweryfikowane własnym przebiegiem** na HEAD `39a9efd`.
Liczby końcowe są mierzone tym samym narzędziem (vitest v8, `all: true`), zawężonym do ścieżek
modułu 7 - dzięki temu pliki, których nikt nie tknął, **zostają w mianowniku**, a nie znikają
z pomiaru.

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

| Metryka     |  Przed |         Po | Delta    |
| ----------- | -----: | ---------: | -------- |
| **Linie**   | 16,47% | **70,83%** | +54,4 pp |
| **Funkcje** | 14,60% | **71,19%** | +56,6 pp |
| Instrukcje  | 16,70% |     71,26% | +54,6 pp |
| Gałęzie     | 13,30% |     61,89% | +48,6 pp |

Cel z zadania (linie ≥ 35%, funkcje ≥ 30%) jest przekroczony dwukrotnie.

Rozkład po katalogach - **warstwa `lib/*` jest domknięta**, reszta to trzy duże
pliki interfejsu wymienione w §6:

| Katalog                  |  Linie | Co zostaje na zerze                                 |
| ------------------------ | -----: | --------------------------------------------------- |
| `lib/files`              |   100% | —                                                   |
| `lib/podcast`            |   100% | —                                                   |
| `lib/tracker`            | 99,43% | —                                                   |
| `lib/web-stories`        | 96,96% | —                                                   |
| `lib/experts`            | 95,18% | `refreshOg.functions.ts` (server fn)                |
| `lib/programs`           |  93,1% | `icons.ts`                                          |
| `lib/events`             | 82,75% | `ticket.functions.ts`, `rsvp-email.functions.ts`    |
| `components/web-stories` |   100% | —                                                   |
| `components/podcast`     |   100% | —                                                   |
| `components/files`       | 99,15% | —                                                   |
| `components/events`      | 52,38% | `SpeakerProfileDialog.tsx` (254)                    |
| `components/quiz`        | 43,47% | `QuizBackground.tsx` (171)                          |
| `components/experts`     | 14,39% | Renderer (1133), InlineEditor (555), Explorer (314) |
| `components/tracker`     | 11,86% | `PolicyPositionsMap.tsx` (217)                      |

### 5.2 Per plik / powierzchnia

| Ścieżka                                      | Przed | Po (linie / funkcje) |
| -------------------------------------------- | ----: | -------------------: |
| `src/lib/events/ticket.server.ts`            |  0,0% |      **100% / 100%** |
| `src/lib/events/ticketCode.ts`               |  0,0% |      **100% / 100%** |
| `src/lib/events/kinds.ts`                    |  0,0% |      **100% / 100%** |
| `src/components/community/ticketDocument.ts` |  0,0% |      **100% / 100%** |
| `src/lib/files/fileKinds.ts`                 |  0,0% |      **100% / 100%** |
| `src/lib/files/officeParse.ts`               |  0,0% |      **100% / 100%** |
| `src/lib/files/viewerState.ts` _(nowy)_      |     — |      **100% / 100%** |
| `src/components/files/**`                    |  0,0% |  **99,15% / 97,72%** |
| `src/lib/tracker/queries.ts`                 |  0,0% |      **100% / 100%** |
| `src/lib/tracker/feed.server.ts`             |  0,0% |      **100% / 100%** |
| `src/lib/experts/queries.ts`                 |  9,3% |  **97,67% / 72,72%** |
| `src/lib/experts/**` (cały katalog)          |  ~34% |  **95,18% / 95,08%** |
| `src/lib/experts/layoutRules.ts` _(nowy)_    |     — |      **100% / 100%** |
| `src/lib/podcast/types.ts`                   | 56,4% |      **100% / 100%** |
| `src/components/podcast/**`                  |  0,0% |      **100% / 100%** |
| `src/lib/web-stories/viewerNav.ts` _(nowy)_  |     — |      **100% / 100%** |
| `src/components/web-stories/StoryViewer.tsx` |  0,0% |      **100% / 100%** |
| `src/components/events/**` (bez dialogu)     |  0,0% |      **100% / 100%** |

Dodane: **842 przypadki testowe w 43 plikach (24 pliki nowe) przypadków testowych w 20 plikach**.

---

## 6. Co pominięte i dlaczego

- **Reguły egzekwowane przez bazę.** Bramka rangi biblioteki plików, tier gate wydarzeń, FIFO listy
  rezerwowej, promocja po zwolnieniu miejsca i izolacja tenanta feedu mają dowody w pgTAP
  (`supabase/tests/community_events_test.sql`, `community_events_waitlist_test.sql`,
  `tracker_feed_tenant_isolation_test.sql`). Powtórzenie ich w vitest dowodziłoby wyłącznie tego,
  że atrapa zachowuje się tak, jak ją napisano.
- **Trasy adminowe** (`admin.podcasts.tsx` 337, `admin.research-programs.tsx` 249,
  `admin.tracker.tsx` 187 i pozostałe) oraz `events.$slug.tsx` / `podcast.$slug.tsx` - cienka
  kompozycja loaderów i paneli, której sens dowodzą e2e i bramki SSR.
- **`SpeakerProfileDialog.tsx`** (254 linie) - jedyny plik `components/events` wciąż na zerze.
  Świadomy wybór kolejności: to dialog czytający własny zestaw danych, więc jest osobną porcją
  pracy, a nie dokładką do tej.
- **`refreshOg.functions.ts`** - server function generująca obraz OG; runtime server fn pominięty
  tą samą decyzją, co przy eksporcie RODO w module profilu.
- **Autoodtwarzanie Web Story ponad jedną klatkę** - pętla jest sprawdzana przez PRZEJĘCIE
  `requestAnimationFrame` i podanie własnego znacznika czasu; czekanie sekundami na prawdziwe
  klatki dałoby test migoczący przy obciążonym CI, a test migoczący uczy zespół ignorować czerwień.

---

## 7. Bramki pokrycia (`vitest.config.ts`)

Moduł 7 nie miał **ani jednego** progu per-ścieżka. Doszło 22 wpisów,
floorowanych tuż pod zmierzonym poziomem (zasada bez zmian: wolno je wyłącznie podnosić):

`lib/events/ticket.server.ts`, `lib/events/ticketCode.ts`, `lib/tracker/queries.ts`,
`lib/tracker/feed.server.ts`, `lib/files/fileKinds.ts`, `lib/files/viewerState.ts`,
`lib/files/officeParse.ts`, `components/files/**`, `lib/web-stories/viewerNav.ts`,
`components/web-stories/StoryViewer.tsx`, `lib/podcast/types.ts`.

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
w mianowniku) - polecenie w `docs/` celowo rozpisane, żeby dało się je powtórzyć co do liczby:

```bash
bunx vitest run --coverage --coverage.all=true \
  --coverage.include='src/lib/{events,tracker,experts,files,podcast,web-stories,programs}/**' \
  --coverage.include='src/components/{events,tracker,experts,files,podcast,web-stories,programs,quiz}/**' \
  --coverage.reporter=text
```

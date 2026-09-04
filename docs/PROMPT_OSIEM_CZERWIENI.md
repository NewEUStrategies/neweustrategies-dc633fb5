# ZADANIE: zgasić osiem czerwonych plików, zamknąć trzy bomby zegarowe i postawić zapadkę na przyczynę

Wejście: audyt pokrycia testami, wydanie 9, rozdz. 12.2 („Znalezisko tego wydania: osiem czerwonych
plików, jedna przyczyna systemowa i jedna bomba zegarowa") oraz 12.9 („Inwentarz bomb i18n").

**To jest zadanie P0: `main` jest dzisiaj czerwony.** Przebieg na HEAD `d737e1329`:
**272 padnięte testy w 8 plikach** przy 60 584 zielonych, 337 „expected fail" i 51 pominiętych.
Do tego bramka `check:ci-gates` jest czerwona z przyczyny, którą zamyka jeden wpis z tej listy.

Trzy rzeczy, które trzeba wiedzieć, zanim cokolwiek dotkniesz:

1. **Siedem z ośmiu czerwieni ma JEDNĄ przyczynę klasową: kod produkcyjny zmienił się pod testem,
   a testu nikt nie ruszył.** To nie jest osiem defektów - to jeden proces i osiem jego skutków.
2. **Jeden plik odpowiada za 188 z 272 padnięć i 43% czasu przebiegu** (952,40 s z 2 216,67 s).
   Zerwanie jednego pomocnika w jednym pliku kosztuje ponad piętnaście minut na każdym przebiegu CI.
3. **Dwanaście testów w tym samym pliku przechodzi PRÓŻNIO** - są w kolumnie „passed" i nie znaczą
   nic. Tego nie widzi ani procent pokrycia, ani licznik czerwieni. Wykrywa to wyłącznie
   przeczytanie testu, i dlatego jest w tym zleceniu osobnym punktem.

**Nie zmieniasz kodu produkcyjnego, żeby test przeszedł. W siedmiu z ośmiu przypadków produkcja ma
rację, a test jest przestarzały.** Wyjątki są wskazane imiennie w punktach A5 i A6.

---

# 0. Osiem plików, zmierzone

| #   | plik testowy                                                                 | przypadków \| padło |         czas | dominujący komunikat                                                      |
| --- | ---------------------------------------------------------------------------- | ------------------: | -----------: | ------------------------------------------------------------------------- |
| 1   | `src/routes/__tests__/adminSettingsRoutes.test.tsx`                          |      225 \| **188** | **952,40 s** | `AssertionError: expected undefined to be truthy` (111×)                  |
| 2   | `src/routes/__tests__/adminAnalyticsRoute.test.tsx`                          |        55 \| **55** |     270,34 s | `expected undefined to be 'idle'` (54/55), DOM pusty                      |
| 3   | `src/routes/__tests__/adminCommunityIndexRoute.test.tsx`                     |        51 \| **21** |            - | `TypeError: Cannot read properties of null (reading 'clearRect')` (40/42) |
| 4   | `src/routes/__tests__/pollsRoute.test.tsx`                                   |         35 \| **4** |            - | `Unable to find an accessible element with the role "button"`             |
| 5   | `src/lib/ci/__tests__/monolingualUserText.test.ts`                           |             44 \| 1 |            - | ratchet: nowy plik z długiem poza baseline'em                             |
| 6   | `src/lib/views/__tests__/headerTickerQuery.test.ts`                          |             24 \| 1 |            - | zmieniony kształt zapytania (`source: "pinned"`)                          |
| 7   | `src/lib/builder/__tests__/labelsEn.test.ts`                                 |              8 \| 1 |            - | `WIDGET_SCHEMAS.cover-overlay-card.maxWidth.label` bez EN                 |
| 8   | `src/components/builder/organisms/widget-view/__tests__/lazyWidgets.test.ts` |              3 \| 1 |            - | `CoverOverlayCardView` bez wpisu w rejestrze lazy                         |

**Uwaga do liczby 21 w wierszu 3:** w sekcji „Failed Tests" logu jest **42 wiersze**, ale
**21 unikalnych tożsamości** - vitest ponowił te testy. Reporter podaje 272, a jego własna lista ma
271 unikalnych; rozjazd o jeden jest w reporterze, nie w twoim kodzie. Nie ścigaj go.

**Sygnatura, której NIE MA w logu, a której będziesz szukał:** frazy `Timed out in waitFor`
**nie ma ani razu** (`grep -c` = 0). `waitFor` po wyczerpaniu budżetu rzuca **ostatni błąd asercji**,
nie komunikat o limicie. Mechanizm JEST limitem czasu - 188 z 188 padnięć trwało ≥ 5 011 ms
(mediana 5 039 ms, maks. 5 333 ms, suma 951,6 s z 952,4 s czasu pliku) - ale w logu stoi
`expected undefined to be truthy`. Limit to `vitest.setup.ts:22`
→ `configure({ asyncUtilTimeout: 5000 })`, **nie** `testTimeout` (ten ma 20 000 w `vitest.config.ts:40`).

---

# CZĘŚĆ A - GASZENIE, w kolejności zysku do kosztu

## A1. `saveButton()` - dwa miejsca, 188 testów, 43% czasu przebiegu

**Przyczyna, ustalona co do wiersza.** Pomocnik w `src/routes/__tests__/adminSettingsRoutes.test.tsx:389-394`
szuka paska zapisu **po dokładnej treści**:

```ts
/** Pasek zapisu - jedyny przycisk, którego napis zmienia się w trakcie zapisu. */
function saveButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Zapisz zmiany" || button.textContent === "Zapisywanie…",
  );
}
```

Commit `d1861e84b` przestawił `SaveBar` w `src/components/admin/settings/fields.tsx`
z literałów na słownik: `{saving ? t("admin.saving") : t("admin.saveSettings")}`. **Zmiana
produkcyjna jest POPRAWNA** - dopisany w tym samym commicie komentarz mówi wprost, dlaczego:
„«Zapisz zmiany» i «Zapisywanie…» wpisane w kod, więc na angielskim panelu…".

**Dlaczego skala jest tak duża:** wszystkie **dziewięć** helperów montujących w tym pliku kończy się
tą samą barierą `await waitFor(() => expect(saveButton()).toBeTruthy())`, a **sześć** bloków
`it.each(PANELS)` mnoży ją przez **dwanaście** paneli. Jedna linia jest wąskim gardłem całego pliku.

### Naprawa - dwa miejsca, zero zmian w produkcji, zero obniżeń progu

**(1) Pomocnik, linie 389-394:**

```ts
import { translateKey } from "@/test/i18nStub";

// NAPIS PASKA ZAPISU IDZIE PRZEZ `t()` (`fields.tsx` -> `SaveBar`), a ten plik montuje
// atrapę i18n z `@/test/i18nStub`, więc w DOM stoi KLUCZ, nie tłumaczenie. Etykiety
// liczymy TĄ SAMĄ funkcją, którą dostaje komponent - dzięki temu żadna zmiana słownika
// (`pl.ts` / `en.ts` / nakładki `i18n-*`) nie rusza tego testu.
const SAVE_BAR_KEYS = ["admin.saveSettings", "admin.saving"] as const;
const SAVE_BAR_LABELS = new Set(SAVE_BAR_KEYS.map((key) => translateKey(key)));

/** Pasek zapisu - jedyny przycisk, którego napis zmienia się w trakcie zapisu. */
function saveButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((button) =>
    SAVE_BAR_LABELS.has((button.textContent ?? "").trim()),
  );
}
```

**(2) Asercja stanu zapisu, linia 514:** `expect(saveButton()?.textContent).toBe("Zapisywanie…")`
→ `expect(saveButton()?.textContent).toBe(translateKey("admin.saving"))`.

### PUŁAPKA, która kosztowałaby drugi przebieg - przeczytaj, zanim napiszesz kod

Ten plik podmienia `react-i18next` na `@/test/i18nStub` (linia 98), a ta atrapa **zwraca klucz
zamiast tłumaczenia** - w DOM stoi dosłownie `admin.saveSettings` (widać to w zrzucie z logu:
`<h2>admin.general.title</h2>`). Z tego wynikają dwie rzeczy:

- **Nie „naprawiaj" słownika.** `pl.ts:1018` niesie `saveSettings: "Zapisz ustawienia"`, a nie
  „Zapisz zmiany" - ale to **bez znaczenia**, bo w tym pliku słownik nie ma wpływu na nic.
  Test nie trafiłby w literał **niezależnie od treści słownika**.
- **Nie używaj tu `realT`.** Porównanie z prawdziwym tłumaczeniem padnie tak samo jak dziś.
  `realT` jest właściwym narzędziem w plikach z PRAWDZIWYM i18n (wzorzec:
  `adminSettingsAnalyticsRoute.test.tsx:299-313`, pomocnik `saveBarLabels()` budujący zbiór
  z `realT("pl")` i `realT("en")`) - ten plik do nich nie należy.

Idiom kluczowy jest już w repozytorium w trzech miejscach: `adminUsersRoutes.test.tsx:936`
(`button.textContent === "adminUsers.clear"`), `widgetPropertiesPanel.test.tsx:768,788,1005`,
`accountLinkEditor.test.tsx:233`. **Naprawa nie wprowadza nowej konwencji, tylko dosuwa jeden plik
do obowiązującej.**

**Kryterium odbioru:** `npx vitest run src/routes/__tests__/adminSettingsRoutes.test.tsx` daje
**225 zielonych, 0 padniętych**, a czas pliku spada z 952 s do rzędu sekund (podaj oba pomiary
w PR). Glob `src/routes/admin.settings*.tsx` wraca nad próg **96/94/96/93** (instrukcje / funkcje /
linie / gałęzie, kolejność jak w `vitest.config.ts:4577`) - dziś mierzy **58,73 / 32,54 / 59,26 / 74,19**.

## A2. Dwanaście testów, które przechodzą PRÓŻNIO - w tym samym pliku

Z 37 zielonych przypadków `adminSettingsRoutes.test.tsx` grupa `it.each(PANELS)` „odczyt W TOKU
pokazuje stan wczytywania, a nie puste pola" (**linie 458-467**, dwanaście przypadków) kończy się
asercją `expect(saveButton()).toBeUndefined()`.

**Skoro `saveButton()` zwraca `undefined` ZAWSZE, ta asercja przechodzi niezależnie od tego, co
panel wyrenderował.** Dwanaście przypadków, których zadaniem jest pilnować, że pasek zapisu NIE
pojawia się w trakcie odczytu, **straciło moc dowodową nie oblewając się.**

A1 przywraca im ją automatycznie - ale to nie zwalnia z osobnego kroku:

1. Po A1 **uruchom te dwanaście przypadków i sprawdź, czy nadal przechodzą.** Jeśli któryś padnie,
   znalazłeś realny defekt produkcyjny ukryty przez próżnię: pasek zapisu POJAWIA się w trakcie
   odczytu. Wtedy → `it.fails` z opisem, nie „poprawka" panelu.
2. Dopisz do tej grupy **kontrolę dodatnią**: jeden przypadek dowodzący, że w stanie GOTOWYM pasek
   zapisu **istnieje** i jest dokładnie jeden. Bez niej cała grupa wróci do próżni przy następnej
   zmianie pomocnika. Repozytorium samo nazywa ten wzorzec `KONTROLA DODATNIA` (m.in.
   `pollsRoute.test.tsx`).

**Kryterium odbioru:** grupa z linii 458-467 ma po A1 dołożoną kontrolę dodatnią; w PR podaj, czy
któryś z dwunastu padł po odzyskaniu mocy dowodowej, i co z tego wynikło.

## A3. Dwa testy w repozytorium stoją w LOGICZNEJ SPRZECZNOŚCI - i oba dodał ten sam commit

`d1861e84b` dopisał w `src/routes/__tests__/adminSettingsAnalyticsRoute.test.tsx:806-808` bramkę
wymagającą, żeby napis paska zapisu **NIE** był literałem „Zapisz zmiany":

```ts
expect(saveBar()?.textContent).toBe(realT("en")("admin.saveSettings"));
expect(saveBar()?.textContent).not.toBe("Zapisz zmiany");
```

a `adminSettingsRoutes.test.tsx:392` wymaga, żeby **BYŁ**. Jeden commit zostawił w suicie dwa
wzajemnie wykluczające się kontrakty na ten sam element interfejsu.

**Przyczyna jest proceduralna, nie kodowa, i commit sam ją dokumentuje:** jego sekcja WERYFIKACJA
podaje „`npx vitest run` na jedenastu plikach: 481 testów zielonych" - a
`adminSettingsRoutes.test.tsx` **nie było wśród tych jedenastu**. Zmiana w pliku współdzielonym
przez **26 plików produkcyjnych** została zweryfikowana na próbce, która nie zawierała jego
największego konsumenta.

**Zadanie:** po A1 sprzeczność znika sama (obie strony przestają porównywać się z literałem).
Zapisz w PR jedno zdanie, że tak się stało, i **dopisz do listy weryfikacyjnej reguły**, którą ten
przypadek ustanawia: _przy zmianie pliku współdzielonego próbką nie jest „jedenaście plików, które
mi przyszły do głowy", a lista importerów._ Wyznacz ją poleceniem, nie pamięcią:

```bash
grep -rln "components/admin/settings/fields" src --include=*.ts --include=*.tsx
```

## A4. Bomba zegarowa KALENDARZOWA - zapaliła się bez udziału commitu, dwie kolejne czekają

`src/lib/views/__tests__/headerTickerQuery.test.ts` zapalił się **2026-09-02 o 12:00 UTC**.
Żaden commit nie brał w tym udziału: plik testowy ustawia w linii 46
`TOMORROW = "2026-09-02T12:00:00.000Z"` i porównuje z czasem **rzeczywistym**, a produkcja
(`src/lib/views/headerTickerQuery.ts:74`, `const source = resolveTickerSource(cfg);`)
**nie przyjmuje `now` jako argumentu**, więc test nie ma jak wstrzyknąć zegara.

**To najgorsza klasa czerwieni w całym tym zleceniu**, bo nie da się jej powiązać z żadną zmianą:
suita była zielona wieczorem i czerwona rano, a `git log` nie pokazuje przyczyny. **Dwie kolejne
zapalą się w ciągu 7-12 dni:** `meetingWindowDraft.test.ts` i `cartStore.test.ts`.

**Zadanie - trzy pliki, jeden wzorzec:**

1. Ustal, czy **kontrakt** `resolveTickerSource` zmienił się celowo (test oczekuje innego kształtu
   zapytania: `source: "pinned"`). Jeśli tak - test jest przestarzały i poprawiasz test. Jeśli nie -
   `it.fails` z opisem defektu, **nie** zmiana produkcji.
2. **Usuń zależność od czasu rzeczywistego z wszystkich trzech plików.** Wzorzec repozytorium to
   `src/lib/time/useNowMs.ts` dla komponentów i wstrzykiwanie `now` dla funkcji czystych; przy
   funkcjach, które go nie przyjmują, użyj `vi.setSystemTime` z jawną datą i `vi.useRealTimers()`
   w `afterEach`. **Data w teście musi być stała i nie może być w przyszłości.**
3. **Napisz bramkę, która nie pozwoli dołożyć czwartej.** Skaner po plikach testowych szukający
   literałów daty w przyszłości względem daty budowy albo porównań z `Date.now()`/`new Date()`
   bez wstrzykniętego zegara. Zamrożona podłoga w kodzie, **kontrola negatywna** (test dowodzący,
   że bramka oblewa na wstrzykniętym przypadku), wpis w `package.json`, krok w `ci.yml` bez
   `continue-on-error`.

**Kryterium odbioru:** trzy pliki zielone przy `vi.setSystemTime` ustawionym na trzy różne daty
(dziś, +30 dni, +400 dni) - pokaż wszystkie trzy przebiegi w PR. Nowa bramka czerwona po dopisaniu
atrapowego testu z datą w przyszłości.

## A5. `adminAnalyticsRoute.test.tsx` - 55 z 55, trasa rozdzielona pod testem

Najdroższa pozycja tej listy i **jedyna, w której zmiana produkcyjna była dla testu
nieodwracalna.** Commit `3d4b684ca` - autorstwa bota, o komunikacie **„Work in progress"** -
przeniósł **725 linii** z `src/routes/admin.analytics.tsx` do nowego
`src/routes/admin.analytics.index.tsx`, nie przenosząc testów. Stary plik ma dziś **12 linii
i tylko `<Outlet />`**. DOM w padniętych testach jest pusty (`<body><div /></body>`) - trasa nie
wyrenderowała niczego. Dominujący komunikat: `expected undefined to be 'idle'` (54 z 55).

Ironia, którą warto zapisać w PR: **jeden test w tym pliku pada, bo szuka KLUCZA**
`admin.analyticsPanel.loadingStatus` i go nie znajduje - czyli ten sam plik zawiera obie strony
problemu i18n z A1.

**Zadanie:** przenieś testy za trasą. `admin.analytics.index.tsx` jest dziś na **0% pokrycia**
i jest **szóstym największym zerem w repozytorium** (725 LOC, 64 linie wykonywalne, 28 funkcji).
To jedyny punkt tego zlecenia, w którym wolno dotknąć produkcji - i tylko po to, żeby test mógł
zamontować trasę, jeśli okaże się to konieczne; każdą taką zmianę uzasadnij osobno w PR.

**Kryterium odbioru:** 55 przypadków zielonych; `src/routes/admin.analytics.index.tsx` z 0% na
**≥ 85% linii**, z dopisanym progiem per-ścieżka na poziomie „zmierzone minus 2 pp" i komentarzem
podającym pomiar i datę.

## A6. `pollsRoute.test.tsx` - produkcja ma rację, test jest przestarzały

Cztery padnięcia: `Unable to find an accessible element with the role "button"`. Commit
`ee9ad3526` zmienił `src/components/community/PollCard.tsx` - linie 63, 79-80 - z przycisków na
`role="radiogroup"` / `role="radio"` z `aria-checked`, a komentarz nagłówkowy uzasadnia to
**dostępnością**: pojedynczy wybór w ankiecie to grupa radiowa, nie zbiór przycisków.

**Produkcja jest poprawna i nie wolno jej cofać.** Zadanie: zmień cztery zapytania testu z roli
`button` na `radio`, i **dołóż asercję na `aria-checked`** - bo to jest realny kontrakt, którego
poprzednia wersja testu nie mierzyła wcale. Jeśli w pliku jest test dostępności (`axe`), sprawdź,
czy przechodzi na nowej roli, i zapisz wynik.

**Kryterium odbioru:** 35 przypadków zielonych, w tym co najmniej jedna nowa asercja na
`aria-checked`; brak naruszeń `axe` na `PollCard`.

## A7. `adminCommunityIndexRoute.test.tsx` - ECharts bez kontekstu 2D, atrapa JEDNA dla całego repo

21 unikalnych padnięć (42 wiersze przez ponowienie), 40 z 42 na
`TypeError: Cannot read properties of null (reading 'clearRect')` - zrender/echarts próbuje rysować
na canvasie, którego `happy-dom` nie daje. Commity `093c9b0c5` i `6d5e6dac3` wprowadziły wykresy na
tę powierzchnię. W przebiegu towarzyszy temu **1 146 nieobsłużonych wyjątków `dpr`**.

**Zadanie: jedna atrapa kontekstu 2D dla całego repozytorium, nie dla tego pliku.** Wykresy będą
dokładane na kolejnych powierzchniach - atrapa per plik gwarantuje powtórzenie tej czerwieni.
Umieść ją w `src/test/` (obok istniejących pomocników), z komentarzem, co dokładnie stubuje i czego
NIE dowodzi (że wykres cokolwiek narysował - to jest atrapa, nie renderer).

**Kryterium odbioru:** 51 przypadków zielonych; liczba nieobsłużonych wyjątków `dpr` w logu
przebiegu tego pliku spada do **zera** (pokaż `grep -c` przed i po); atrapa leży w `src/test/`
i jest użyta przez co najmniej ten jeden plik, z komentarzem o zasięgu.

## A8. Trzy jednolinijkowe rejestry - i jeden z nich gasi ZARAZEM czerwoną bramkę

Trzy ostatnie czerwienie to po jednym brakującym wpisie każda:

1. **`monolingualUserText.test.ts`** - ratchet „ani nowego pliku z długiem, ani wzrostu" pada na
   `src/routes/admin.analytics.index.tsx:387`, gdzie stoi `title="GA4 Looker Studio embed"`, a
   pliku nie ma w `MONOLINGUAL_USER_TEXT_BASELINE` (baseline zna tylko starszy
   `admin.analytics.tsx` z jednym wystąpieniem). **Ten sam wpis gasi bramkę `check:ci-gates`**,
   która jest dziś czerwona z dokładnie tej przyczyny - 45 plików, 863 testy, jedno padnięcie.
   **Jeden wpis zdejmuje dwa zapalenia.** Kolejność przyczynowa jest ustalona: bramka powstała
   w `6c4c1e621`, a plik z długiem doszedł **później**, w `3d4b684ca` - tym samym commicie „Work
   in progress", który rozdzielił trasę z A5. **Jeden commit zapalił czerwień w trzech
   niezależnych miejscach: w pokryciu, w suicie i w bramce statycznej.**
   Uwaga: baseline to **ratchet**. Dopisanie pliku jest dopuszczalne tylko z jednoczesną
   i18n-izacją tego jednego napisu albo z jawnym uzasadnieniem w komentarzu, dlaczego zostaje.
   **Domyślnie: i18n-izuj, nie poszerzaj baseline'u.**
2. **`labelsEn.test.ts`** - `WIDGET_SCHEMAS.cover-overlay-card.maxWidth.label` niesie
   „Maksymalna szerokość (px)" bez odpowiednika EN. Dopisz wpis EN.
3. **`lazyWidgets.test.ts`** - `CoverOverlayCardView` nie ma wpisu w rejestrze leniwych widgetów.
   Dopisz wpis.

Dwa ostatnie to ta sama klasa: **nowy widget dodany bez dwóch rejestrów, których wymaga**. Zapisz
w PR, czy istnieje bramka wymagająca kompletu rejestrów przy nowym widgecie - jeśli nie, to jest
kandydat na jedną bramkę zamiast dwóch testów gaszonych po fakcie.

**Kryterium odbioru:** trzy pliki zielone; `bun run check:ci-gates` **zielony**;
`bun run check:i18n-parity`, `check:i18n-key-drift` i `check:i18n-default-value` zielone.

---

# CZĘŚĆ B - ZAPADKA NA PRZYCZYNĘ

Gaszenie ośmiu plików bez tej części znaczy, że dziewiąty przyjdzie w następnym oknie. Przyczyna
jest **policzona dwiema niezależnymi metodami** i obie dają ten sam obraz.

**Po commitach:** **25 z 194 commitów nie-merge (12,9%)** w oknie między wydaniami ruszyło kod
produkcyjny i **zero plików testowych**, razem **2 856 wierszy** - a jeden commit, `3d4b684ca`
„Work in progress", odpowiada sam za **62,8%** tej masy.

**Po grafie importów:** z 221 zmienionych plików produkcyjnych **68 (5 514 wierszy, 26% całego
ruchu produkcyjnego okna)** leży poza kategorią bezpieczną: 21 ma test **starszy** od zmiany,
30 ma test **nietknięty**, a **19 nie ma ŻADNEGO testu, który by je importował**.

**Higiena komunikatów:** **42 z 222 commitów (18,92%)** mają komunikat bez treści informacyjnej
(„Changes", „Work in progress") - i **wszystkie 42 to commity bota**, czyli **77,8% jego dorobku
w oknie**.

## B1. Bramka „zmiana produkcyjna bez ruchu w teście"

Jedna bramka, która dla zakresu commitów albo dla diffu PR-a sprawdza: czy każdy zmieniony plik
produkcyjny ma **importujący go plik testowy**, i czy ten plik testowy **też się ruszył** albo
został uruchomiony. Zamrożona podłoga w kodzie (dziś: 68 plików poza kategorią bezpieczną,
19 bez żadnego importującego testu - progi wolno **wyłącznie obniżać**), kontrola negatywna, wpis
w `package.json`, krok w `ci.yml` bez `continue-on-error`.

Wzorzec bierz z bramek, które to robią dobrze: `scripts/check-bundle-size.ts` (zamrożone podłogi

- ignorowanie nadpisań środowiskowych w CI) i którakolwiek z katalogu `src/lib/ci/__tests__`.
  `check:gate-coverage` musi zostać zielony - czyli nowa bramka musi być realnie wpięta.

**Kryterium odbioru:** bramka zielona na tym HEAD po zgaszeniu A1-A8 i czerwona na sztucznym
diffie, w którym plik produkcyjny zmieniono bez tknięcia jego testu (pokaż oba przebiegi).

## B2. Inwentarz bomb i18n - 1 068 miejsc, 19 najkruchszych

Awaria z A1 jest **drugą iteracją tej samej klasy**, a repozytorium ma zapisaną pierwszą.
Komentarz `src/test/i18nReal.ts:11-12` mówi wprost: _„Po zdjęciu zapasowych tekstów (bramka
`check:i18n-default-value`) **47 takich asercji w 9 plikach zgasło naraz** - i to jest miara tego,
ile z nich mierzyło słownik: zero."_

Zmierzony ładunek, jaki został (definicja: literał w selektorze albo asercji, który **jest
wartością** któregoś ze 140 plików słownikowych - 26 525 unikalnych wartości polskich):

| warstwa                                                                        |    miejsc |  plików |
| ------------------------------------------------------------------------------ | --------: | ------: |
| literał = wartość słownika (szeroko)                                           |     2 742 |     520 |
| **wąsko**: + diakrytyka albo czasownik akcji, długość ≥ 4                      | **1 068** | **221** |
| **najkruchsze**: porównanie DOKŁADNE na `textContent` (`===`/`toBe`/`toEqual`) |    **19** |   **8** |

Rozkład po selektorach nie jest szumem, a priorytetem: `getByRole({ name })` **520** i
`getByLabelText` **92** są **odporne w połowie** - zmiana słownika je zgasi, ale test nie przestaje
mierzyć dostępności. `textContent === "…"` nie ma tej właściwości wcale.

**Trzy z tych dziewiętnastu stoją w pliku, który właśnie wybuchł** - i jedna jest uzbrojona przez
tę samą kampanię:

- `adminSettingsRoutes.test.tsx:1665` → `button.textContent === "Podgląd"`. Literał **jest już**
  wartością słownika (`pl.ts:226, 695, 714`), a w produkcji stoi w co najmniej pięciu miejscach
  jako tekst wpisany na sztywno (`PatternPicker.tsx:192,321`, `ThemeFontSizesPane.tsx:355`,
  `ArchiveLivePreview.tsx:95`, `PropertiesPanel.tsx:144`) - czyli jest na liście do i18n-izacji.
- `adminSettingsRoutes.test.tsx:2674` → `button.textContent === "Logo: jasne"`. Ten literał żyje
  **wyłącznie w produkcji**, w `admin.settings.google-source.tsx:134`
  i `admin.settings.cookie-banner.tsx:380` - **w dwóch z jedenastu tras, które właśnie spadły** -
  i nie ma go jeszcze w żadnym słowniku. **Następny commit i18n-izujący te dwie trasy zgasi ten
  test dokładnie tym samym mechanizmem.**

Presja jest mierzalna: `reports/i18n-parity.json` pokazuje **169 nieprzetłumaczonych kluczy
w prefiksach objętych bramkami i 519 w całym repozytorium**. **To nie jest ryzyko hipotetyczne,
to harmonogram.**

**Zadanie:** przepisz **wszystkie 19** najkruchszych miejsc w 8 plikach na wzorzec kluczowy albo
słownikowy (wybór zależy od tego, czy plik montuje atrapę i18n czy prawdziwe słowniki - patrz
pułapka z A1). Warstwy `getByRole`/`getByLabelText` **nie ruszaj** - to praca za zero.

**Kryterium odbioru:** `grep -rnE 'textContent\s*===\s*"' src --include=*.test.ts --include=*.test.tsx | grep -a`
nie zwraca ani jednego trafienia z polskim literałem będącym wartością słownika; osiem dotkniętych
plików zielone.

## B3. Kontrola dodatnia zamiast 951 sekund milczenia

Zerwanie jednego pomocnika kosztowało **951,6 s (43% czasu ściany całego przebiegu)** i powtórzyło
188 razy ten sam komunikat, **nie wskazując przyczyny**. Jeden przypadek postawiony na początku
pliku - „w panelu `general` po montażu istnieje DOKŁADNIE jeden przycisk o etykiecie
z `SAVE_BAR_LABELS`" - oblewa się w milisekundach i mówi, co się stało.

**Zadanie:** dołóż kontrolę dodatnią **w każdym pliku testowym, w którym pojedynczy pomocnik jest
wąskim gardłem kilkudziesięciu lub więcej przypadków.** Wyznacz te pliki pomiarem, nie intuicją:
policz, ile przypadków w pliku przechodzi przez ten sam pomocnik wyszukujący.

**Kryterium odbioru:** lista plików z wąskim gardłem w PR, z liczbą przypadków na pomocnik;
kontrola dodatnia dodana w każdym z nich.

---

# JAK MIERZYĆ

**Nie uruchamiaj całej suity, dopóki nie zgasisz A1.** Pełny przebieg trwa dziś **2 216,67 s**,
z czego 952,40 s to jeden plik z A1. Po A1 przebieg skróci się o ~43%.

```bash
# pojedynczy plik - tak pracuj przez całe A1-A8
npx vitest run src/routes/__tests__/adminSettingsRoutes.test.tsx

# pomiar pokrycia dotkniętych ścieżek (reporter `json` NIE jest w konfiguracji,
# a bez niego nie ma nazw niewywołanych funkcji)
npx vitest run --coverage --coverage.reporter=json --coverage.reporter=json-summary <pliki>

# bramki - tanie, bez builda
bun run check:ci-gates
bun run check:i18n-parity && bun run check:i18n-key-drift && bun run check:i18n-default-value
bun run check:gate-coverage
```

**Pomiar wyjściowy jest w repozytorium i nie trzeba go powtarzać:**
`coverage-ed9/coverage-summary.json` (per plik), `coverage-ed9-final/coverage-final.json`
(mapy `fnMap` i liczniki `f` - nazwy funkcji bez wywołania), `cov-ed9.log` (log przebiegu
z sekcją „Failed Tests" i czasami per plik).

**Czego NIE tłumaczyć obciążeniem maszyny.** Sprawdziłem to i hipoteza jest fałszywa, dwukrotnie:
`adminAnalyticsRoute.test.tsx` trwa w izolacji **271,58 s** wobec 270,34 s w pełnym przebiegu
(różnica 0,5%), `adminSettingsRoutes.test.tsx` **952,01 s** wobec 952,40 s (różnica **0,041%**).
Cały ten czas to **bierne czekanie na timerze**, nie praca procesora - równoległe forki go nie
zmieniają.

---

# ZASADY - obowiązują w całości i nie podlegają negocjacji

**Testy**

- **Nie zmieniasz zachowania produkcyjnego, żeby test przeszedł.** W siedmiu z ośmiu przypadków
  produkcja ma rację. Defekt → `it.fails` z opisem, co jest złe i dlaczego. W repozytorium jest
  dziś **327 takich wpisów w 186 plikach** i to jest rejestr, nie wstyd. Wyjątki: A5 (i tylko
  w zakresie umożliwienia montażu, każda zmiana uzasadniona osobno) i A8 (dopisanie wpisów
  do rejestrów).
- **Zamknięcie defektu zdejmuje jego `it.fails` w tym samym commicie.** Wpis, który przestał
  opisywać rzeczywistość, **pada** - a fałszywa czerwień jest jedyną rzeczą, która potrafi zabić
  prawdziwą.
- Progi w `vitest.config.ts` wolno **wyłącznie podnosić**: „zmierzone minus ~2 pp" dla progu na
  jeden plik, „minus ~4 pp" dla globa, z komentarzem podającym pomiar i datę.
- **Nie wykluczaj plików z pomiaru.** Nie dodawaj `exclude`, nie zmieniaj `all: true`.
- **Nie skracaj `asyncUtilTimeout` ani nie podnoś `testTimeout`, żeby coś przeszło.** Limit
  5 000 ms w `vitest.setup.ts:22` nie jest przyczyną żadnej z tych czerwieni - jest tylko czasem,
  po którym prawda wychodzi. Skrócenie go zamieni 188 padnięć na 188 szybszych padnięć.
- Nie regenerujesz snapshotu autoryzacji, żeby zgasić czerwień.
- Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.
- **RODO w testach:** żadnych prawdziwych danych osobowych w fixture'ach; adresy e-mail wyłącznie
  w domenach `example.com` / `example.org`; jeśli kod hashuje IP, test sprawdza, że wynik **nie**
  zawiera oryginału.
- **Każdy skrypt liczący cokolwiek grepem: `grep -a`.** W repozytorium jest plik testowy z bajtem
  NUL (celowa atrapa poison-null-byte), przez który `grep` bez `-a` uznaje plik za binarny
  i **po cichu zgłasza zero trafień**. To klasa błędu, która nie daje żadnego sygnału.
- **Skrypty liczące wzorce w kodzie muszą wygaszać komentarze i literały napisowe.** Naiwny grep
  po `as any` w plikach ręcznych daje 10 trafień, z których 9 to zdania o tym, że repo `as any`
  nie używa.

**Kod**

- Ekstrakcja zgodnie z atomic design: atoms / molecules / organisms.
- i18n jest częścią definicji ukończenia: każdy nowy napis widoczny dla użytkownika ma klucz
  w PL i EN.
- **Nie stosuj `any` ani `as any`.** Dziś w 3 305 plikach produkcyjnych jest **zero** `as any`
  i **jedna** adnotacja `: any` - nie dokładaj drugiej. `as unknown as` jest policzone
  (179 w 115 plikach); jeśli musisz go użyć, uzasadnij komentarzem, że rzutowanie siedzi na
  realnej granicy.
- **`tenant_id`**: każde zapytanie i każda polityka na dotkniętej powierzchni musi wiązać najemcę.
  Obszar roboczy jednej firmy nie może zaczytać danych z obszaru innej.
- Zamiast „—" stosuj „-".
- **Nie commituj `package-lock.json`.** `package.json` wolno zmienić wyłącznie o wpisy nowych
  bramek z A4 i B1. Nie dodawaj zależności.

**Pomocniki, których należy użyć zamiast pisać własne**
`src/test/i18nStub.ts` (atrapa zwracająca klucz), `src/test/i18nReal.ts` (prawdziwe słowniki),
`src/test/routeHarness.tsx`, `src/test/renderWithQueryClient.tsx`, `src/test/serverFn*.ts`,
`src/test/axe.ts`, `src/test/supabaseChain.ts`.

---

# CZEGO NIE ROBIĆ - cztery pułapki, każda kosztowałaby przebieg albo dowód

1. **Nie „naprawiaj" słownika, żeby trafić w literał testu.** W pliku z A1 i18n jest zamockowany
   na echo klucza, więc treść `pl.ts` nie ma wpływu na nic. Ta pułapka jest nieoczywista i kosztuje
   pełny przebieg, żeby się o niej dowiedzieć.
2. **Nie cofaj zmiany roli ARIA z A6.** Produkcja ma rację - pojedynczy wybór w ankiecie to grupa
   radiowa. Cofnięcie tego to regres dostępności zrobiony po to, żeby przestarzały test przeszedł.
3. **Nie poszerzaj baseline'u ratchetu z A8, jeśli da się i18n-izować jeden napis.** Ratchet, który
   rośnie przy każdym nowym długu, przestaje być ratchetem.
4. **Nie zgaś czerwieni, nie stawiając zapadki z części B.** Osiem plików zgaszonych bez B1 znaczy,
   że dziewiąty przyjdzie w następnym oknie - a przyczyna jest policzona i nazwana: 25 commitów
   ruszyło produkcję i zero testów.

---

# DEFINICJA UKOŃCZENIA

1. **Zero padniętych testów** w pełnym przebiegu (dziś 272 w 8 plikach).
2. Czas przebiegu spadł o **≥ 40%** wobec 2 216,67 s - podaj oba pomiary.
3. Glob `src/routes/admin.settings*.tsx` nad progiem **96/94/96/93** na wszystkich czterech
   wymiarach; `src/routes/admin.analytics.index.tsx` z 0% na **≥ 85% linii** z dopisanym progiem.
4. **Zero naruszeń progów** w przebiegu (dziś 29 na 16 ścieżkach - z czego 23 to progi postawione
   ponad pomiarem przez poprzednią kampanię, więc **nie wszystkie należą do ciebie**: rozstrzygnij
   w PR, które z 16 ścieżek zgasiła twoja praca, a które wymagają osobnej decyzji o progu).
5. **Dwanaście testów z A2 ma moc dowodową** i kontrolę dodatnią.
6. **Trzy bomby kalendarzowe zamknięte**, a nowa bramka nie pozwala dołożyć czwartej.
7. **Dziewiętnaście najkruchszych miejsc i18n przepisane**; `grep` na `textContent === "<polski
literał ze słownika>"` nie zwraca nic.
8. **Bramka B1 wpięta**, z kontrolą negatywną; `check:gate-coverage` zielony.
9. `bun run check:*` w komplecie **zielone** - w tym `check:ci-gates`, która była czerwona przed
   twoją pracą i którą zamyka jeden wpis z A8.
10. Dopisany próg per-ścieżka na **`src/components/admin/settings/**`** - katalog o najwyższej
    dźwigni w tym module (cztery pliki, 703 wiersze, **zero** testów własnych, **zero** progów;
    `fields.tsx` importowany przez **26 plików produkcyjnych**, a drugi plik katalogu,
    `ConsentAuditSummary.tsx`, stoi na **0/21 linii i 0/13 funkcji** i nic tego nie łapie).

**Na koniec zdaj raport:** co zmierzyłeś przed i po (liczba za liczbą, tą samą metodą), które
defekty zarejestrowałeś jako `it.fails` i dlaczego, czego świadomie nie zrobiłeś, oraz - osobno -
**które liczby z tego zlecenia okazały się nieaktualne**. Ta ostatnia lista jest dla audytu
najcenniejsza: wydanie 9 znalazło osiem własnych pomyłek i wszystkie przez sprawdzenie liczby,
nie przez jej przepisanie.

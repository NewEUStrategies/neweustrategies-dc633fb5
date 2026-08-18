# Wdrożenie: inwariant wierności ustawień page buildera (M3) — 2026-08-03

**Gałąź:** `claude/page-builder-registry-fidelity-ok32zf` · **Baza:** `be5e79d` (main po PR #143)

Dokument zamyka rekomendację z `OCENA_FUNKCJI_TABELE_2026-08-03.md`, sekcja **MODUŁ 3**:

> **Parytet pilnują testy punktowe, nie inwariant**: nie ma bramki „każde pole schematu jest
> czytane przez renderer i odwrotnie" — klasa może wrócić przy następnym widgecie.
> 🔧 **Dodać gate parytetu schemat⇄renderer** (jak `builderI18nKeys` dla i18n)

oraz dwie rekomendacje towarzyszące z tego samego modułu: e2e „żadna strona publiczna nie zawiera
stringów próbki" (dyscyplina danych przykładowych) i „test, że każdy widget z lokalizowanym
`queryFn` ma język w kluczu" (świeżość danych widgetów).

---

## 1. Dlaczego metryka „100/100 typów bloków" była odporna na tę klasę błędu

Pokrycie rejestru mierzy, czy **widget istnieje i renderuje się**. Defekty naprawione w PR #141
były o poziom niżej: widget istniał, renderował się, miał panel — a **pojedyncze ustawienia
kłamały**. Trzy warianty tej samej klasy:

| Wariant            | Objaw dla redakcji                                   | Przykład z PR #141                                              |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| **martwe**         | przestawiam kontrolkę, zapisuję, nic się nie zmienia | `autoplay` karuzeli, warianty akordeonu, kolumny tablet/telefon |
| **ukryte**         | funkcja istnieje, ale nie ma jak jej włączyć         | `brand`/`showYear` w `copyright` („Brak edytowalnych pól")      |
| **rozjazd klucza** | oba końce „działają", ustawienie nie robi nic        | kontrolka TOC pisała `items`, widget czytał `items_${lang}`     |

Żadnego z nich nie widzi test „czy renderer zna typ widgetu". PR #141 naprawił ~40 przypadków
i przypiął je **testami punktowymi** — klasa została otwarta.

---

## 2. Inwariant: oba końce MIERZONE, nie deklarowane

Zamiast manifestu „kto co czyta" (który sam by się rozjechał — dokładnie jak lista
`WIDGET_LIVE_QUERY_PREFIXES` przed `queryKeys.ts`), oba końce są **obserwowane w wykonaniu**.

Treść widgetu wjeżdża w `Proxy` notujące każdy odczyt klucza
(`src/lib/builder/ci/settingsFidelity.ts`), a bramka renderuje ten sam widget dwa razy:

```
PANEL     →  WidgetContentFields (zakładka „Treść")   =  klucze OFEROWANE redakcji
RENDERER  →  WidgetView w trybie publicznym            =  klucze CZYTANE przy renderze
```

Różnica symetryczna zbiorów to lista defektów. Porównujemy **dokładne klucze magazynowe**
(`items` ≠ `items_pl`), więc rozjazd nazwy łapie się sam.

### Co zapewnia wierność pomiaru

| Zagrożenie                                                                | Rozwiązanie                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 33 widgety idą przez `React.lazy` → pierwszy render pokazuje fallback     | `@/test/eagerWidgetChunks` — lustro tych samych komponentów bez `Suspense`; test pilnuje identycznego zestawu eksportów                                                                                                                                                                                                                                                                    |
| widget listowy bez danych wychodzi wczesnym `return` na stanie pustym     | `@/test/widgetDataStub` — niepuste, uniwersalne wiersze                                                                                                                                                                                                                                                                                                                                    |
| część widgetów renderuje `null` dla gościa albo dla ubogiego kontekstu    | 3 scenariusze widza: gość + pełny wpis, zalogowany + pełny wpis, gość + minimalna strona                                                                                                                                                                                                                                                                                                   |
| pole widoczne tylko przy `variant === "gradient"`                         | próbka na każdą opcję pola rozgałęziającego + oba końce zakresów liczbowych                                                                                                                                                                                                                                                                                                                |
| edytor niestandardowy odsłania kontrolki tylko dla wybranego źródła/trybu | `WIDGET_PROBE_STATES` — deklaruje STAN („slider ze źródłem manual"), nigdy listę kluczy; **stan, który nie odsłania ani jednego nowego klucza po żadnej stronie, wywala bramkę** (tak wypadły cztery stany-atrapy, m.in. „slider: `source=manual`" — `sliderUsesPostsSource` traktuje listę bez powiązanego zdjęcia jak stan nieskonfigurowany, więc gałąź ręczna wcale się nie otwierała) |
| renderer robi `{...content}` i „czyta" wszystko naraz                     | `RENDERER_ENUMERATES_CONTENT` — luka w pokryciu jest **wymieniona**, nie milcząca                                                                                                                                                                                                                                                                                                          |
| pętla `requestAnimationFrame` w karuzeli postępu                          | pomiar bez `await act(async …)` (to drenuje kolejkę Reacta w nieskończoność); bounded settle z twardym limitem przebiegów                                                                                                                                                                                                                                                                  |

### Zwolnienia, które nie gniją

`FIDELITY_WAIVERS` (`src/lib/builder/ci/settingsFidelityGate.ts`) wymaga **powodu** przy każdym
kluczu, a bramka sprawdza obie strony:

- zwolnienia nie pokrywającego istniejącego rozjazdu → **test czerwony** (`stale`),
- rozjazdu bez zwolnienia → **test czerwony** (`unexpected`).

Odstępstwo, którego nikt już nie potrzebuje, nie może zostać w kodzie jako cichy wyłącznik.

---

## 3. Znaleziska bramki (naprawione w tym wdrożeniu)

Bramka na pierwszym wiarygodnym uruchomieniu pokazała **rozjazdy w 27 widgetach**. Po odsianiu
artefaktów pomiaru (lazy chunki, stan pusty, stan widza, gałęzie warunkowe) zostało **13 realnych
defektów**. Wszystkie naprawione:

| #   | Widget                    | Defekt                                                                                                                                                                                     | Naprawa                                                                                                                                                             |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `gallery`                 | `GalleryLightboxZone` (PR #141) **nie był użyty przez ŻADEN renderer** — przełącznik „Lightbox" w panelu nie robił nic                                                                     | Podłączony w gałęzi `gallery` przez render-prop `trigger`; działa w siatce, masonry, karuzeli i polaroidzie, klasy layoutu wędrują na wrapper (geometria bez zmian) |
| 2   | `lang-switcher`           | `showLabel` z podpowiedzią „Wyświetla etykietę obok przełącznika PL/EN" — renderer używał etykiety wyłącznie jako `aria-label`                                                             | `LangSwitcherDropdown` renderuje widoczną etykietę; przy widocznej etykiecie tekst dostaje `aria-hidden` (bez dublowania dla czytnika ekranu)                       |
| 3   | `carousel`                | Panel dostawał `PostListEditor` **bez propsu `widgetType`**, więc sekcja karuzeli (autoplay, czas slajdu) nie miała jak się pokazać — renderer autoplay honorował                          | `widgetType={widget.type}`; odczyt `autoplay`/`autoplayIntervalMs` przeniesiony do `CarouselSection`, czyli tam, gdzie istnieje kontrolka                           |
| 4   | `contact-form`, `contact` | Formularz czyta `successMsg_${lang}`, schemat **nie miał tego pola** — komunikat po wysłaniu był zaszyty                                                                                   | Pole `successMsg` (i18nText) w schemacie                                                                                                                            |
| 5   | `search-button`           | Renderer obsługuje 3 tryby (`dropdown`/`standalone`/`fullscreen`) i własny nagłówek panelu wyników — **żadnej kontrolki**                                                                  | `mode` (select) + `heading` (i18nText)                                                                                                                              |
| 6   | `image`                   | Renderer umie podstawić logo witryny (`useSiteLogo`, warianty main/mobile/transparent + dark) — jedyną drogą był przypadek: alt zawierający „logo"                                         | Select `useSiteLogo`                                                                                                                                                |
| 7   | `lost-password-form`      | `resetPasswordForEmail({ redirectTo })` czytał `redirectTo`, panel go nie wystawiał                                                                                                        | Pole `redirectTo` z podpowiedzią, gdzie musi prowadzić link                                                                                                         |
| 8   | `join-us`                 | `pushLabelsFor` dokładał **18 kluczy `${field}Label`**, których formularz nigdy nie czyta (stoi na `FloatingInput`: pływająca etykieta JEST placeholderem) + martwy `interestsPlaceholder` | Usunięte; `contact-form` zachowuje pary etykieta+placeholder, bo tam oba napisy żyją                                                                                |
| 9   | `join-us`                 | `iconSize` (ikona ✓ przy korzyściach) czytany, bez kontrolki                                                                                                                               | Pole `iconSize`                                                                                                                                                     |
| 10  | `social-icons`            | Kluczem kanonicznym platformy jest `x`, ale **nikt go nie zapisywał** — panel pisał `twitter`, renderer czytał `x` z aliasem                                                               | Pole schematu `x` + `legacyKeys: ["twitter"]`; renderer czyta `x` z `altKeys: ["twitter"]`                                                                          |
| 11  | `rated-list`              | 6 kolorów miało wariant dark, `bookmarkColorDark` i `postFormatColorDark` — nie, choć renderer emitował dla nich reguły `.dark`                                                            | Dwie brakujące kontrolki                                                                                                                                            |
| 12  | `post-list`, `carousel`   | `titleWeight` / `excerptWeight` czytane (mają pierwszeństwo nad typografią współdzieloną), bez kontrolki                                                                                   | Dwa selecty grubości                                                                                                                                                |
| 13  | `slider`                  | `categoryId` — filtr **bez autora**: żadna kontrolka, import ani szablon go nie zapisywały; zapytanie płaciło za nieosiągalną gałąź                                                        | Usunięty razem z gałęzią zapytania (test pilnuje, że nie wróci)                                                                                                     |

### Nowy mechanizm: `SchemaField.legacyKeys`

Zmiana nazwy klucza kosztowała dotąd cudzą treść: renderer rozumiał stary klucz (alias), ale panel
pokazywał **puste pole nad działającym ustawieniem**, a pierwsza edycja czegokolwiek innego
utrwalała tę pustkę. `SchemaFieldControl` czyta teraz `legacyKeys` jako fallback i zapisuje
**wyłącznie klucz kanoniczny** — treść migruje sama przy pierwszej zmianie pola, addytywnie.

---

## 4. Dwie bramki towarzyszące

### 4.1 Dyscyplina danych przykładowych

`sampleDataLeak.gate.test.tsx` — trzy kierunki naraz, bo każdy z osobna daje fałszywe poczucie
bezpieczeństwa:

1. **publicznie bez kontekstu** → ani jednego napisu próbki (89 widgetów × 2 języki),
2. **publicznie z REALNYM kontekstem** → nadal ani jednego (próbka nie dolepia się jako fallback),
3. **w kanwie buildera** → próbka JEST (inaczej „naprawę" dałoby się zaliczyć, wycinając podgląd).

Plus skan źródeł: napisy próbki nie mogą wystąpić w kodzie renderującym publicznie. Lista fraz
jest **wyliczana z `PLACEHOLDER_POST_CTX`**, nie przepisywana — dopisanie pola do próbki
automatycznie rozszerza zakres bramki.

Zakres skanu jest ostry (`widget-view`, `blocks`, `content`, `archive`, `megaMenu`, `menu`,
`WidgetView`), a nie „całe `src/`": „Jan Kowalski" to najzwyklejszy polski placeholder pola
„imię i nazwisko", więc ściganie go globalnie dałoby szum, w którym prawdziwy wyciek by się schował.

### 4.2 Język w kluczu zapytania

`localizedQueryKeys.gate.test.ts` — konwencja `lang` / `_lang` przestaje być komentarzem:

- fabryka z parametrem **`lang`** ⇒ klucze PL i EN **muszą się różnić**,
- fabryka z **`_lang`** (jawnie nieużywany) ⇒ klucze **muszą być identyczne**.

Do tego dwie asercje domykające: **rejestr nie ma dziur** (każda eksportowana fabryka
`*QueryOptions` z `lib/builder` jest wymieniona jako zależna od języka, niezależna albo agregator)
oraz statyczny audyt zapytań pisanych **wprost w komponencie**. Analizator ma własne testy na
syntetycznych wejściach — statyczna analiza bez testów to zgadywanie z pewną miną.

Świadomie **nie** ścigamy nazw kolumn (`name_pl`, `title_en`): zapytanie, które selectuje oba
języki i pozwala wybrać w renderze, jest wzorcem **poprawnym** — i takie właśnie są `CategoriesView`
i `TagsView`. Gdyby ich klucz niósł język, obie wersje płaciłyby po jednym zapytaniu za te same
wiersze.

---

## 5. Pliki

**Rdzeń inwariantu (czysty, bez Reacta i I/O):**

- `src/lib/builder/ci/settingsFidelity.ts` — Proxy notujące odczyty, generator próbek, różnica
  wierności, logika zwolnień
- `src/lib/builder/ci/settingsFidelityGate.ts` — stany próbek + zwolnienia z powodami
- `src/lib/builder/ci/sampleTokens.ts` — napisy próbki wyliczane z `PLACEHOLDER_POST_CTX`
- `src/lib/builder/ci/localizedQueryKeys.ts` — konwencja parametru języka + audyt zapytań inline

**Bramki:**

- `src/components/admin/builder/__tests__/settingsFidelity.gate.test.tsx` (217 asercji, ~41 s)
- `src/components/admin/builder/__tests__/sampleDataLeak.gate.test.tsx` (277 asercji, ~6 s)
- `src/lib/builder/__tests__/localizedQueryKeys.gate.test.ts` (17 asercji, <2 s)

Bramki wchodzą do CI jako własny, nazwany krok (`bun run check:widget-fidelity`) i zapisują
`reports/widget-fidelity.json`, który konsumuje raport zgodności wdrożenia - stan „rozjazdy bez
uzasadnienia: 0 · zwolnione z powodem: 14" jest od teraz częścią dokumentacji wydania, a nie
wiedzą plemienną.

**Testy mechanizmu i znalezisk:**

- `src/lib/builder/ci/__tests__/settingsFidelity.test.ts` — rdzeń bez Reacta
- `src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts` — lustro lazy/eager bez dryfu
- `src/components/admin/builder/__tests__/fidelityGateFindings.test.tsx` — każde znalezisko osobno

**Pomoce testowe:** `src/test/eagerWidgetChunks.tsx`, `src/test/widgetDataStub.ts`

---

## 6. Jak podłączyć nowy widget

1. Dopisz typ do `WIDGET_TYPES` + `WIDGETS` (jak dotąd).
2. Uruchom `bun run check:widget-fidelity` — raport `reports/widget-fidelity.txt` wypisze rozjazdy.
3. Dla każdego wpisu wybierz **jedno**:
   - **MARTWE** (panel oferuje, renderer nie czyta) → dowieź funkcję albo usuń pole ze schematu,
   - **UKRYTE** (renderer czyta, panel nie oferuje) → dodaj pole do `WIDGET_SCHEMAS`,
   - ustawienie widoczne tylko w pewnym stanie → dopisz stan do `WIDGET_PROBE_STATES`,
   - rozjazd zamierzony → `FIDELITY_WAIVERS` **z powodem**.
4. Nowe etykiety PL wymagają tłumaczenia w `BUILDER_LABELS_EN` (pilnuje `labelsEn.test.ts`).

---

## 7. Efekt na ocenę M3

Rekomendacja audytu 03.08 brzmiała: „dodać gate parytetu schemat⇄renderer". Jest — i przy pierwszym
uruchomieniu **znalazł 13 defektów, których nie widział żaden z 4625 istniejących testów**, w tym
funkcję dowiezioną razem z testami, ale nigdy niepodłączoną (`gallery.lightbox`) i kontrolkę
niemożliwą do wyświetlenia przez brakujący props (`carousel` → autoplay).

To jest różnica między „mamy testy na naprawione przypadki" a „klasa defektu jest zamknięta".
Ocena 9 dla wierności ustawień widgetów przestaje opierać się na testach punktowych.

**Stan końcowy:** `vitest run` 5222 pass / 0 fail (520 plików), `tsc --noEmit` czysto,
`eslint` na zmienionych plikach 0 błędów, bramka wierności 0 rozjazdów bez uzasadnienia
(14 zwolnionych z powodem, 1 renderer wyliczający treść hurtem - jawnie wymieniony).

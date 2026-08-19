# Wyszukiwarka: domknięcie modułu (33% → 97%), test, który niczego nie dowodził, i defekt diakrytyków (2026-08-18)

Ten sam ruch, co PR #250 zrobił dla czatu i PR #252 dla profilu, zastosowany do **modułu 6
(Wyszukiwarka)** z audytu `AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (PR #254).
Moduł był na tej liście najmniejszy - 24 pliki produkcyjne - i to była przesłanka do
potraktowania go inaczej niż poprzednich: celem nie było „podnieść o kilka punktów", tylko
**zamknąć**.

Najciekawszą treścią tego wdrożenia nie jest jednak liczba pokrycia, tylko dwa znaleziska
zrobione po drodze: **test, który wyglądał jak dowód, a nie wykonywał ani jednej linii
kodu, który miał sprawdzać** (§2), oraz **defekt wyszukiwarki komend, który wyszedł dopiero
przy pisaniu testu widoczności** (§4).

---

## 1. Stan wyjściowy

Pomiar własny na HEAD `39a9efd` (ten sam commit, który audyt podał jako punkt odniesienia),
zakres modułu wg audytu: `src/lib/search/**`, `src/components/search/**`,
`src/hooks/useSavedSearches.ts` oraz `src/routes/search.tsx`.

| Metryka         | Audyt (PR #254) | Pomiar własny |
| --------------- | --------------: | ------------: |
| Linie           |          33,21% |        33,21% |
| Funkcje         |          32,65% |   32,65% (95) |
| Gałęzie         |          28,89% |        28,89% |
| Plików na 0%    |              11 |            16 |
| Plików łącznie  |              24 |            24 |
| Funkcji łącznie |             291 |           291 |

Liczby procentowe zgadzają się co do drugiego miejsca po przecinku. Rozjazd „plików na 0%"
(11 vs 16) bierze się z zakresu przebiegu: audyt liczył na PEŁNEJ suicie, gdzie cztery pliki
modułu (`recentSearches.ts`, `overlayTabs.ts`, `SuggestListView.tsx`, `SearchSnippet.tsx`)
dostawały pokrycie UBOCZNIE - z testów `SearchOverlay` i `SearchButtonWidget`, czyli
z powierzchni spoza modułu. Żaden z nich nie miał testu własnego.

### 1.1 Sprzeczność w definicji celu, którą trzeba było rozstrzygnąć

Zadanie stawiało cel „linie ≥ 95%" i jednocześnie „nie goń pokrycia na `src/routes/search.tsx`".
Te dwa punkty są wzajemnie sprzeczne: trasa to **57 z 292 funkcji modułu**, więc przy zerze na
tym pliku SUFIT pokrycia modułu wynosi ~80%. Cel był arytmetycznie nieosiągalny.

Rozstrzygnięte na rzecz pokrycia trasy, z dwóch powodów. Formalnie: repo ma precedens -
`src/routes/reset-password.tsx` stoi na 100% linii z własnym progiem i gotowym harnessem
`src/test/routeHarness.tsx`. Merytorycznie, i to jest ważniejsze: **to w trasie mieszka
wszystko, czego zadanie szukało w komponentach** (patrz §3).

---

## 2. Sprawa `SearchAutosuggest`: test, który zamykał temat, nie sprawdzając niczego

Audyt odnotował anomalię: plik `src/components/search/__tests__/SearchAutosuggest.test.tsx`
ISTNIAŁ, a `SearchAutosuggest.tsx` miał **0,0% linii i 0 z 19 funkcji**. Zadanie wskazało trzy
możliwe wyjaśnienia: test pominięty, test wyłącznie helpera, albo import innej ścieżki.

**Rozstrzygnięcie: trzecia możliwość w najostrzejszym wariancie.** Ten plik nie importował
komponentu ani razu. Wszystkie jego asercje zasilały `lib/search/facetModel.ts`
(`orderSuggestions`, `suggestBucketOf`, `suggestionHref`, `SUGGEST_BUCKET_LABELS`) - plik,
który ma WŁASNY test (`facetModel.test.ts`) i stał na 93,7%.

Dlaczego to jest gorsze niż dwa pozostałe warianty:

- **test pominięty** widać w wyniku suity (`skipped`), więc sam się zgłasza;
- **test helpera z tego samego pliku** podnosi choć trochę pokrycie swojego przedmiotu;
- **ten przypadek** nie zgłaszał się nigdzie. Nazwa pliku była JEDYNYM nośnikiem informacji
  „autosuggest jest przetestowany". W przeglądzie temat wyglądał na zamknięty, w pomiarze
  było zero, a duplikat asercji facetModelu maskował jedno i drugie.

Poboczny dowód, że ta dziura już raz kogoś ugryzła - `src/lib/ci/i18nDefaultValue.ts:322-331`
cytuje TEN SAM plik jako lukę w bramce i18n:

> Pierwsza wersja pomijała CAŁY PLIK i to była dziura: `SearchAutosuggest.tsx` deklaruje
> lokalne `t` w linii 98, a w linii 167 woła `i18n.t("search.title", …)` - prawdziwy zapas
> przy prawdziwym i18next, którego bramka z progiem zero nie widziała i raportowała zero.
> Zgłoszone w review PR-a #235.

**Co zrobiono.** Plik przeniesiony do `src/lib/search/__tests__/facetModelSuggestions.test.ts`,
czyli tam, gdzie leży jego faktyczny przedmiot; nagłówek opisuje, czym był. Osobno powstał
prawdziwy test komponentu (36 przypadków), po którym `SearchAutosuggest.tsx` stoi na **100%
linii i 19/19 funkcji**.

**Sprawdzone przy okazji:** pozostałe 7 plików testowych modułu importuje swoje komponenty
poprawnie, a w całym module nie ma ani jednego `describe.skip` / `it.skip`. To był przypadek
jednostkowy, nie wzorzec.

---

## 3. Cztery miejsca, w których zadanie opisywało zachowanie, którego w kodzie nie ma

Pisanie testów pod nieistniejący kod dałoby dokładnie tę klasę defektu, którą naprawia §2.
Dlatego zamiast wymyślać - skorygowane, z uzasadnieniem przy każdym przypadku.

| Zadanie                                                                                  | Kod                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „nawigacja klawiaturą, zamknięcie po kliknięciu poza obszarem" w `SearchAutosuggest`     | Komponent nie ma ŻADNEJ logiki klawiatury - dostaje `activeIndex` propsem. Klawiatura, blur i `aria-activedescendant` żyją w `routes/search.tsx`                                                                          |
| „limit zapisanych wyszukiwań, duplikat zapytania, wycofanie optymistycznej aktualizacji" | Migracja `20260713173411:470` nie ma ANI limitu, ANI `UNIQUE`; jedyne ograniczenie to `CHECK (length(btrim(name)) BETWEEN 1 AND 120)`. Mutacje nie mają optymistycznej aktualizacji (samo `onSuccess: invalidateQueries`) |
| „szukanie »lodz« ma znaleźć »Łódź« w `buildHaystack`"                                    | `buildHaystack` to konkatenacja napisów; składanie diakrytyków należało do `fuzzy.ts`, a tam go NIE BYŁO. To nie test - to defekt (§4)                                                                                    |
| „zwijanie facetu, wyczyść wszystko"                                                      | `SearchFacetPanel` nie ma stanu zwijania; „wyczyść wszystko" jest w `routes/search.tsx:434`                                                                                                                               |

Dodatkowo: `visibleCommands` przyjmuje wyłącznie `{isAdmin, isAuthenticated}` - nie ma roli
„redaktor" ani kontekstu publiczny/panel. Zamiast sześciu wymyślonych ról przetestowane są
wszystkie CZTERY realne kombinacje dwóch flag, plus inwariant monotoniczności
(gość ⊂ zalogowany ⊂ admin).

W miejsce trzech nieistniejących przypadków zapisanych wyszukiwań weszło LUSTRO CHECK-a po
stronie TS (`name.trim().slice(0, 120)`) - to ono decyduje, czy zapis w ogóle wejdzie do bazy,
i nie miało testu.

---

## 4. Defekt znaleziony przy pisaniu testów, naprawiony osobnym commitem

### 4.1 „platnosci" nie znajdowało „Płatności"

Wyszło przy pisaniu testu widoczności komend (commit `c44a9e2`), naprawione osobno w `ab65943`.

Paleta komend nie składała znaków diakrytycznych, więc fraza pisana bez ogonków - czyli tak,
jak pisze większość użytkowników - nie trafiała w polskie etykiety:

```
„platnosci"      ->  „Płatności"             NIE ZNAJDOWAŁO
„bezpieczenstwo" ->  „Bezpieczeństwo konta"  NIE ZNAJDOWAŁO
„glowna"         ->  „Strona główna"         NIE ZNAJDOWAŁO
```

Asymetria była podwójnie myląca: **baza składa ogonki od dawna** (`unaccent` w `search_quick`,
dowiedzione pgTAP-em), więc dokładnie ta sama fraza wpisana w tę samą paletę znajdowała
TREŚĆ, ale nie znajdowała KOMENDY prowadzącej do tego samego miejsca. Użytkownik nie miał jak
tego zdiagnozować.

**Naprawa musiała objąć dwa miejsca**, bo filtrowanie jest podwójne:

1. `fuzzy.ts` - `fuzzyMatch` składa diakrytyki po obu stronach (fraza i cel), więc dopasowanie
   jest symetryczne.
2. `CommandPalette.tsx` - cmdk filtruje wiersze WŁASNYM matcherem po `value`, a on ogonków nie
   składa. Sam punkt 1. nie wystarczał: `rankItems` wpuszczał „Płatności" na listę, a cmdk
   zaraz potem ją ukrywał. To wyszło dopiero w teście przez całą paletę - test samej
   `fuzzy.ts` był zielony i nieprawdziwy.

**Dlaczego własna mapa, a nie samo `normalize`.** „ł" jest osobnym punktem kodowym, nie „l"
z kreską, więc NFD go nie rozkłada - ta sama pułapka, która zjadła literę „ł" w propozycji
adresu profilu (naprawa z tego samego dnia, opisana przy progu `src/components/profile/**`).
Mapa trzyma WYŁĄCZNIE odwzorowania jeden-do-jednego; ligatury (ß→ss, æ→ae) są świadomie
pominięte, bo składanie MUSI zachować długość napisu: `indexes` wskazuje pozycje w ORYGINALNYM
tekście i służy do podświetlania trafień. Z tego samego powodu iteracja idzie po jednostkach
UTF-16, nie po punktach kodowych - emoji przeszłoby jako jeden krok i skróciło wynik,
rozjeżdżając podświetlenie o dwie pozycje.

Zachowanie zmienione świadomie i tylko w tę stronę: zbiór dopasowań się POWIĘKSZA, żadne
wcześniejsze trafienie nie znika. Cztery testy sprzed tej pracy przechodzą bez zmian.

### 4.2 Ustalenia, które NIE są defektami, ale zostały przypięte testem

- **`buildHaystack({cmd, lang})` ignoruje `lang`** - funkcja destrukturyzuje samo `cmd`.
  Zachowanie jest POPRAWNE (indeks celowo dwujęzyczny, żeby Polak szukający „pages" trafił
  w „Strony"), ale parametr jest martwy w publicznym API i wołający ma prawo sądzić inaczej.
  Test przypina to wprost.
- **`savedSearchHref` gubi wartości niebędące napisami.** `{q: "energia", year: 2026}` daje
  `/search?q=energia`. Typ parametrów to `Record<string, unknown>`, więc nic tego nie łapie na
  etapie kompilacji. Dziś wszyscy wołający podają napisy - ale to inwariant, który złamie
  pierwszy, kto zapisze rok jako liczbę, a skutkiem byłby ALERT prowadzący pod węższe
  zapytanie niż zapisane.
- **cmdk ukrywa trafienie o odległym tytule.** Ranking pełnotekstowy bazy patrzy też w treść
  wpisu, a lista przepuszcza wynik przez własny filtr po tytule i slugu. To świadomy koszt
  spójności listy, nie defekt - ale bez tego opisu diagnoza „szukam i nie widzę" prowadzi
  w złą stronę.

---

## 5. Wynik: przed → po

| Metryka           |  Przed |     Po | Cel     |
| ----------------- | -----: | -----: | ------- |
| Linie             | 33,21% | 97,38% | ≥ 95% ✔ |
| Instrukcje        | 32,65% | 96,66% | —       |
| Funkcje           | 32,65% | 95,21% | ≥ 95% ✔ |
| Gałęzie           | 28,89% | 90,00% | ≥ 90% ✔ |
| Plików na 0%      |     16 |      0 | 0 ✔     |
| Funkcji pokrytych |     95 |    278 | z 292   |
| Plików testowych  |      8 |     18 | —       |
| Przypadków        |     63 |    589 | —       |

Per plik, od najniższego:

| Plik                                       | Przed |    Po | Funkcje |
| ------------------------------------------ | ----: | ----: | ------: |
| `routes/search.tsx`                        |  0,0% | 92,9% |   47/57 |
| `lib/search/peopleSemantic.functions.ts`   |  0,0% | 90,0% |     2/2 |
| `lib/search/semantic.functions.ts`         | 14,8% | 92,6% |     3/3 |
| `components/search/CommandPalette.tsx`     |  0,0% | 95,3% |   29/31 |
| `components/search/TermExplorer.tsx`       | 82,6% | 95,7% |     8/8 |
| `components/search/PeopleOrgResults.tsx`   | 96,2% | 96,2% |   13/13 |
| `components/search/SearchFacetPanel.tsx`   |  0,0% | 96,9% |   10/10 |
| `lib/search/facetModel.ts`                 | 93,7% | 97,6% |   25/26 |
| `lib/search/useVoiceSearch.ts`             | 27,6% | 99,0% |   26/27 |
| `hooks/useSavedSearches.ts`                |  0,0% |  100% |   16/16 |
| `components/search/SavedSearchesPanel.tsx` |  0,0% |  100% |   12/12 |
| `components/search/SearchAutosuggest.tsx`  |  0,0% |  100% |   19/19 |
| `components/search/ActiveFilterChips.tsx`  |  0,0% |  100% |     6/6 |
| `components/search/SearchSnippet.tsx`      | 10,0% |  100% |     1/1 |
| `lib/search/registry.tsx`                  |  0,0% |  100% |     4/4 |
| `lib/search/search.functions.ts`           |  0,0% |  100% |     3/3 |
| `lib/search/useAuthorAvatars.ts`           |  0,0% |  100% |     7/7 |
| `lib/search/overlayTabs.ts`                | 71,4% |  100% |   21/21 |
| `lib/search/recentSearches.ts`             | 95,0% |  100% |     5/5 |
| `lib/search/fuzzy.ts`                      |  100% |  100% |     5/5 |

Wzrost `fuzzy.ts` o jedną funkcję to wyeksportowany `foldDiacritics` (§4.1).

---

## 6. Co zostało zbudowane raz, dla całego repo

**`src/test/serverFnChain.ts`** - atrapa łańcucha `createServerFn`. Server function zbudowanej
przez `createServerFn().validator().handler()` nie da się wywołać w teście jednostkowym:
prawdziwa implementacja oczekuje kontekstu żądania frameworka. Atrapa oddaje walidator
i handler, więc test wywołuje je wprost, **bez dotykania kodu produkcyjnego**.

Wzorzec istniał już jako kopia lokalna w `src/lib/__tests__/categoryColorSave.test.ts` (bramka
defektu K10). Przy czwartym pliku wybór był ten sam, co przy `supabaseChain.ts` w PR #252:
czwarta kopia rozjeżdżająca się przy następnej zmianie kontraktu albo jedno miejsce. Helper
deklaruje też, czego NIE udaje (middleware, kontekst żądania, serializacja), żeby nikt nie
wziął go za test transportu.

---

## 7. Trzy pułapki harnessu warte zapisania

1. **Udokumentowany skrót `reactI18nextMock()` z `src/test/i18nReal.ts` ZAKLESZCZA test.**
   Fabryka `vi.mock("react-i18next", …)` importuje `@/lib/i18n`, a ten importuje
   `react-i18next` - czyli moduł właśnie mockowany. To dokładnie pętla, przed którą ostrzega
   nagłówek tego helpera, tyle że opisana tam dla innego wariantu. W całym repo nie ma ani
   jednego użycia tego skrótu, więc nikt go wcześniej nie uruchomił. **Obejście jest prostsze
   niż mock:** `@/lib/i18n` robi `i18n.use(initReactI18next).init(...)`, więc `useTranslation()`
   bez providera czyta PRAWDZIWĄ instancję aplikacji. Wystarczy zaimportować `@/test/i18nReal`
   (domyka oba rdzenie) i nakładkę `@/lib/i18n-search`.
2. **Atrapa `ondataavailable` w `MediaRecorder` musi oddawać PRAWDZIWY `Blob`.** Kod
   produkcyjny sam składa `new Blob(chunks)` i mierzy wynik, więc goły obiekt `{size: 4000}`
   serializował się do „[object Object]" - 15 bajtów, poniżej progu 1500 - i cała ścieżka
   uploadu była cicho pomijana. Test przechodziłby, nie dotykając tego, co miał mierzyć.
3. **`<select>` ma implicite rolę `combobox`.** Test skrótu „/" w liście rozwijanej
   znajdował własny element pomocniczy przez `queryByRole("combobox")` i „dowodził", że paleta
   się otworzyła. Paleta jest teraz identyfikowana po placeholderze.

Poza tym: `queryCache` w obu plikach semantycznych to mapa MODUŁOWA, więc żyje między testami
tak samo, jak żyje między żądaniami w procesie serwera - testy cache'u używają fraz unikalnych
w pliku.

---

## 8. Co pominięte i dlaczego

**Ranking, operatory i fasety w bazie** - nietknięte. Dowodzi ich dziewięć plików pgTAP
(`faceted_search`, `search_tsquery`, `search_operators`, `search_posts_smoke`, `premium_search`,
`people_search_trgm`, `chat_contacts_search_and_privacy`, `extensions_search_path_contract`,
`people_verification`) plus bramka symetrii konfiguracji FTS. Duplikowanie tego w TS byłoby
drugim źródłem prawdy dla tej samej reguły. Testy warstwy TS sprawdzają rzecz komplementarną:
że TypeScript woła to poprawnie i **nie okalecza** frazy z operatorami po drodze.

**Niedobite 10 z 57 funkcji trasy** - gałęzie renderu zależne od stanów pośrednich zapytań
(szkielet ładowania katalogu osób, liczniki zakładek dla wariantów `tab`) oraz wybór dnia
w kalendarzu Radix, który wymaga realnego wskaźnika. Próg trasy jest floorowany na 78% funkcji
właśnie po to, żeby nie udawać, że jest to komplet.

**`src/components/SearchOverlay.tsx`** - poza zakresem modułu 6 wg audytu (leży w
`src/components/`, nie w `src/components/search/`). Ma własny test dostępności; jego
domknięcie to osobne zadanie.

---

## 9. Bramki pokrycia (`vitest.config.ts`)

Moduł **nie miał ani jednego progu per-ścieżka** - mimo że komentarz z 2026-07-21 w tym samym
pliku wskazuje go WPROST jako jedną z przyczyn obniżenia globalnego floora („main dolozyl duze
nieotestowane powierzchnie (wyszukiwarka v5, trasy, panele)"). I nic by tego nie zgłosiło:
`check:gate-coverage` - wbrew nazwie - pilnuje wpięcia bramek `check:*` w workflow, a nie
istnienia progów pokrycia. Żaden skrypt w repo tego nie sprawdza.

```
src/lib/search/**            statements 92 / functions 94 / lines 94 / branches 84
src/components/search/**     statements 94 / functions 94 / lines 94 / branches 89
src/routes/search.tsx        statements 88 / functions 78 / lines 88 / branches 80
```

Pięć wpisów per plik dla powierzchni niosących reguły niewidoczne dla typów: `fuzzy.ts`,
`facetModel.ts`, `recentSearches.ts`, `registry.tsx` (100% na czterech metrykach) oraz
`hooks/useSavedSearches.ts` (100% na czterech metrykach - to on włącza wysyłkę powiadomień).

Każdy komentarz przy progu mówi, CZEGO nie dobito i DLACZEGO nie da się tego dobić - zamiast
udawać, że brak 100% jest przypadkiem. Żaden istniejący próg nie został obniżony ani ruszony;
blok jest wyłącznie dopisany.

---

## 10. Jak zweryfikować

```bash
sed -E -i 's#https://europe-west[0-9]+-npm\.pkg\.dev/lovable-core-prod/sandbox-npm-cache/#https://registry.npmjs.org/#g' bun.lock
bun install
git checkout -- bun.lock   # CI-only, nie commitować

bun run test:coverage
# 846 plików testowych, 10 723 testy, zero błędów, zero błędów progu

bun run typecheck
bun run format:check
bun run lint
bun run check:i18n-default-value
bun run check:i18n-parity
bun run check:gate-coverage
```

Przebieg zawężony do modułu (szybsza pętla przy pracy nad tymi plikami) daje te same liczby:

```bash
bunx vitest run src/lib/search src/components/search src/hooks \
  src/routes/__tests__/searchRoute.test.tsx \
  src/components/__tests__/SearchOverlay.a11y.test.tsx \
  src/components/builder/organisms/widget-view/__tests__/SearchButtonWidget.test.tsx \
  src/components/builder/organisms/widget-view/__tests__/searchButtonWidgetRouterSync.test.tsx \
  --coverage
# 30 plików testowych, 589 testów
```

### 10.1 Pomiar potwierdzony na pełnej suicie

Liczby w §5 i §9 pochodzą z **pełnego** `bun run test:coverage` i zgadzają się co do
przypadku z przebiegiem zawężonym do modułu - dla tych plików nie ma różnicy, bo żaden
test spoza wyszukiwarki ich nie dotyka. Progi z §9 są w CI spełnione, `EXIT=0`.

### 10.2 Zawieszenie suity i zastane czerwone testy - naprawione po drodze

Pełna suita **nie kończyła się w ogóle** - ani przed tą pracą, ani po niej - i nie miało to
związku z wyszukiwarką. Vitest stawał na etapie zamykania workerów po testach panelu buildera
(`Timeout terminating forks worker`), bez ani jednej czerwonej asercji, więc bez wskazówki,
gdzie szukać. Przyczyną był cykl w grafie importów:

```
lazyWidgets (mock) → eagerWidgetChunks → PostsSliderWidget → lazyWidgets (mock)
```

`PostsSliderWidget.tsx` jest ładowany PRZEZ rejestr `lazyWidgets`, a jednocześnie brał z niego
`SliderRender`. W produkcji cykl jest nieszkodliwy (bundler go rozplątuje, oba wiązania są
leniwe), ale w testach podmieniających rejestr na lustro eager fabryka `vi.mock` czeka na
moduł, którego rozwiązanie czeka na nią. Rozwiązanie: wydzielenie `lazyBoundary.tsx`
(wspólna granica Suspense) i `sliderRenderLazy.tsx` (samo wiązanie `React.lazy`) - dwóch
modułów bez zależności od rejestru. Granica podziału kodu, chunk i fallback bez zmian.

Zawieszenie **zasłaniało 39 czerwonych asercji w module buildera**, wszystkie zastane.
Sprawdzone na commicie bazowym `39a9efd`: padają tak samo. Naprawione (szczegóły w opisach
commitów): brak lustra eager w czterech plikach, synchroniczny `renderToStaticMarkup` wobec
leniwego `RichHtmlView`, bramka strukturalna wskazująca plik bez slidera, brak `channel`
w trzech zaślepkach klienta Supabase oraz asercja typografii czytająca `style` z wewnętrznego
`span` zamiast z nagłówka. Osobno naprawiony został jedyny błąd blokującej bramki
`bun run lint` (`require()` w mocku routera w `AccountIdentityPanel.test.tsx`).

**Kod produkcyjny wyszukiwarki nie był przy tym ruszany.** Jedyna zmiana produkcyjna poza
modułem to wydzielenie dwóch plików granicy leniwego ładowania opisane wyżej.

---

## 11. Wzorce wzięte z repo, nie wymyślone

- `src/test/supabaseChain.ts` (PR #252) - atrapa łańcucha PostgREST; użyta bez zmian
  w `useSavedSearches`, `useAuthorAvatars` i `overlayTabs`.
- `src/lib/__tests__/categoryColorSave.test.ts` - wzorzec atrapy `createServerFn`;
  wyprowadzony do `src/test/serverFnChain.ts` (§6).
- `src/test/routeHarness.tsx` + `src/routes/__tests__/resetPasswordRoute.test.tsx` - wzór testu
  trasy z prawdziwym `validateSearch`, loaderem i `head()`.
- `src/test/i18nReal.ts` - prawdziwy tłumacz zamiast atrapy `defaultValue ?? key`. Przy okazji
  na ten wzorzec przestawiony został istniejący `TermExplorer.test.tsx`, w którym asercja
  `getByText("video")` mierzyła slug wpisany w fixture testu, a nie tłumaczenie ze słownika.
- `src/components/search/__tests__/AdvancedSearchPanel.test.tsx` - punkt odniesienia stylu
  asercji dla komponentów tej powierzchni; nietknięty.

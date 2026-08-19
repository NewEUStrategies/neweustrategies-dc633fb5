# MODUŁ 3: odblokowanie suity, 1 026 odzyskanych testów i tokeny marki (2026-08-18)

Zadanie brzmiało „podnieś pokrycie testami MODUŁU 3 według audytu z 2026-08-18”. Krok zerowy
audytu — „ODZYSKAJ WIARYGODNY POMIAR” — okazał się nie formalnością, a odkryciem: **`bun run test`
nie dawał się dokończyć na tym HEAD-zie w żadnym środowisku, także w CI repo.** Ten dokument
opisuje, czym to było, jak zostało naprawione i co dopisano po naprawie.

---

## 1. Stan wyjściowy i dlaczego był nieprawdziwy

Audyt raportował dla MODUŁU 3: 40,0% linii / 29,0% funkcji, przy czym sam oznaczał dwie
powierzchnie znacznikiem „pomiar zaniżony”, bo 38 z 39 nieuruchamialnych plików testowych repo
należało właśnie do nich:

| Powierzchnia                                  | Audyt       | Uwaga audytu                         |
| --------------------------------------------- | ----------- | ------------------------------------ |
| `components/builder/organisms/widget-view/**` | 68,8% linii | „czytaj jako ~95%, nie 68,8%”        |
| `components/admin/builder/**`                 | 13,6% linii | „nie ma progu, więc nie ma i sufitu” |

Audyt zgadywał przyczynę: „najcięższe importy w repo (komplet 99 typów widgetów, echarts, tiptap)
na czterordzeniowym sandboksie z zależnościami z publicznego npm zamiast pinów z `bun.lock`”.

### 1.1 Obie hipotezy były fałszywe

| Hipoteza                       | Weryfikacja                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| dryf wersji zależności         | komplet `bun install`: **806 paczek zgodnych z pinami, zero dryfu** → to samo wisi |
| ciężar importów (99 widgetów)  | `WidgetView` **1,8 s**, lustro `eagerWidgetChunks` **3,9 s** → importy są szybkie  |
| równoległość / liczba workerów | pojedynczy plik, `--pool=threads`, `--pool=forks` → wisi w każdej konfiguracji     |

Rozstrzygający pomiar: procesy stały w `ep_poll` z **zerowym przyrostem czasu CPU** (11 s / 2 s / 2 s
przez sto sekund). To nie było „wolno”. To było zakleszczenie.

### 1.2 Prawdziwa przyczyna: cykl pod fabryką `vi.mock`

21 plików testowych MODUŁU 3 podmienia rejestr leniwych widgetów na lustro eager — wzorzec
udokumentowany w nagłówku `src/test/eagerWidgetChunks.tsx`:

```
vi.mock(".../widget-view/lazyWidgets", () => import("@/test/eagerWidgetChunks"))
    → eagerWidgetChunks.tsx:69  re-eksportuje PostsSliderWidget
    → PostsSliderWidget.tsx:22  importował { SliderRender } z "./lazyWidgets"
    → czyli z modułu, którego fabryka WŁAŚNIE trwa            ⇒ DEADLOCK
```

Fabryka czekała na import, który czekał na tę samą fabrykę. Ani `testTimeout`, ani `hookTimeout`
nie obejmują fazy ładowania modułu, więc przebieg stał **bez końca**, zamiast paść — i właśnie to
upodabniało objaw do „bardzo ciężkiego importu”. W produkcji ten sam cykl rozwiązywał się po
ESM-owemu, dlatego nie objawiał się nigdy poza testami.

Dowód izolowany (dwa przebiegi, ta sama maszyna):

- import `@/test/eagerWidgetChunks` **bez** `vi.mock` → **zielono w 3,9 s**;
- import `WidgetView` **z** tym `vi.mock` → **timeout (130 s, zabity)**.

---

## 2. Naprawa: rozerwanie krawędzi, zero zmian w bundlu

Cykl da się rozerwać tylko w jednym punkcie — `PostsSliderWidget` nie może importować całego
rejestru, żeby dostać z niego JEDEN komponent. Komentarz w tym pliku jawnie zabrania też importu
`sliderVariants` wprost („renderer slidera ma zostać w leniwym chunku”), więc nie można było po
prostu spłaszczyć zależności.

Dwa nowe moduły glue:

- **`widget-view/lazySuspense.tsx`** — `LazyFallback` (shimmer kanwy) + `withSuspense`, do tej pory
  prywatne w rejestrze. Dzięki temu pojedynczy leniwy komponent da się skonsumować bez rejestru.
- **`widget-view/lazySliderRender.tsx`** — sam `SliderRender`, z **dokładnie tą samą** granicą
  `lazy(() => import("@/lib/builder/sliderVariants"))`.

`lazyWidgets.tsx` re-eksportuje `SliderRender` z nowego modułu, więc jego zestaw eksportów (58)
i lustro `eagerWidgetChunks` pozostają bez zmian. `PostsSliderWidget` bierze komponent z nowego
modułu. **Granica podziału kodu, chunki i podział eager/lazy są identyczne** — to refaktor grafu
importów, nie zmiana zachowania.

### 2.1 Trzy klasy dryfu, które wyszły dopiero, gdy bramki zaczęły dobiegać

1. **Lustro `eagerWidgetChunks` było niepełne** (58 kontra 56 eksportów). Wpis w nagłówku
   `lazyWidgets.tsx` z tego samego dnia przeniósł `accordion` i `section-label` do rejestru
   leniwego, ale lustro tych dwóch eksportów nie dostało — każdy test podmieniający rejestr padał
   na `No "AccordionWidget" export is defined on the ... mock`. **Bramka parytetu, która istnieje
   dokładnie po to** (`src/lib/builder/ci/__tests__/eagerWidgetChunks.test.ts`), sama nie dawała
   się skolekcjonować — czyli strażnik był ślepy przez cały czas trwania dryfu.
2. **Niepełne zaślepki `supabase`** w trzech plikach: brak `channel`/`removeChannel`, więc
   `useInterests` wywalał się w efekcie na `supabase.channel is not a function`.
3. **Strażnicy pilnujący nieaktualnego stanu**: lista `SPLIT_WIDGETS` nie znała trzech eksportów
   rejestru, a test granicy leniwego chunka czytał `mediaWidgets.tsx`, z którego PostsSlider dawno
   wyjechał — czyli sprawdzał plik **bez** tego kodu.

Do tego dwie asercje, które mierzyły nie ten węzeł/rejestr, który chciały zmierzyć (opisane
w commicie `fix(test): dwie asercje...`). Obie wyglądały na defekty produkcji i **żadna nim nie
jest** — renderer robi swoje, mylił się test. Zapisane jawnie, żeby nikt nie „naprawiał”
działającego kodu.

### 2.2 Efekt naprawy — bez ani jednego nowego testu

| Miara                        |          Przed |                               Po |
| ---------------------------- | -------------: | -------------------------------: |
| `bun run test`               | nie kończy się |     **833 pliki, 10 269 testów** |
| `check:widget-fidelity`      | wisi bez końca |   **542 testy, 34,7 s, zielono** |
| MODUŁ 3 w jednym przebiegu   | nie kończy się | **90 plików, 1 832 testy, 64 s** |
| `widget-view/**` — linie     |          68,8% |                       **97,65%** |
| `admin/builder/**` — funkcje |  166/2077 (8%) |            **364/2077 (17,53%)** |
| całe `src/` — linie          |         33,19% |                       **37,46%** |
| całe `src/` — funkcje        |         25,33% |                       **28,90%** |

Odblokowanie 18 plików odzyskało **1 026 testów**, które wcześniej nie wnosiły do pomiaru nic.
Podniosło to całe repo o ~4 pp na każdej metryce — a panelom właściwości podwoiło liczbę wykonanych
funkcji, **bez pisania testów**.

---

## 3. Praca testowa: design tokens, kolory globalne, typografia, skróty markdown

Audyt wskazał tę powierzchnię jako „najtańsze pokrycie o największym zasięgu”: czyste funkcje bez
Reacta, których wynik idzie do `<style>` na `:root` montowanego w `__root.tsx` — czyli na **każdej**
trasie publicznej.

| Plik                            | Przed | Po (linie) |          Funkcje |
| ------------------------------- | ----: | ---------: | ---------------: |
| `lib/builder/globalColors.ts`   |  6,8% |   **100%** |    0/3 → **3/3** |
| `lib/builder/hoverCss.ts`       | 15,6% |   **100%** |    1/3 → **3/3** |
| `lib/builder/sectionStyles.tsx` |  6,0% |   **100%** | 0/13 → **13/13** |
| `lib/builder/designTokens.ts`   | 15,0% |  **97,8%** | 0/12 → **12/13** |
| `lib/builder/dynamicText.ts`    |  5,9% |  **94,1%** |    0/9 → **8/9** |
| `lib/builder/chromeDefaults.ts` |  0,0% |  **84,2%** | 0/13 → **11/13** |
| `lib/blocks/markdown.ts`        |  0,0% |   **100%** | 0/12 → **12/12** |

Razem **269 nowych przypadków testowych** (211 na powierzchni tokenów + 58 na warstwie wartości pól z §3.3). Żaden nie jest renderem bez asercji — repo raz już
zdjęło taką warstwę i zapisało to w komentarzu przy progu globalnym.

### 3.1 Co te testy faktycznie pilnują

- **Katalog kolorów globalnych** (65 slotów w 20 grupach): brak duplikatów kluczy — duplikat to
  cicha kolizja `--gc-<key>` i jeden picker w panelu przestaje działać. 13 slotów bez `defaultLight`
  **musi milczeć**, bo emisja pustej wartości nadpisałaby działający token shadcn niczym.
- **Mostek widgetowy w `:where()`** — gwarancja, że kolor ustawiony PER WIDGET zawsze wygrywa nad
  globalnym.
- **Determinizm identyfikatorów**: `defaultDocFor` przechodzi przez `withStableIds`, bo leci
  z `__root.tsx` i `Footer.tsx` na KAŻDYM renderze (SSR + klient) — losowe id rozjechałyby
  hydratację. `buildHomepageDocument` celowo tego **nie** robi (jednorazowa akcja w edytorze).
  Test utrwala tę RÓŻNICĘ, żeby nikt nie „ujednolicił” obu ścieżek.
- **Odporność warstwy danych**: błąd odczytu tokenów **musi** degradować do `EMPTY_TOKENS`, nie
  rzucać — ten odczyt grzeje root loader na każdej trasie, więc wyjątek zdjąłby stronę z powodu
  kosmetyki.
- **Degradacja złych danych w stylach sekcji**: `contentWidth: boxed` z szerokością 0, ujemną lub
  nieliczbową spada na 1140 px (bez tego kontener zwężał się do zera i sekcja znikała).
- **Skróty markdown**: `#` daje h2 (h1 należy do tytułu wpisu), `2.` nie zaczyna listy, NBSP jest
  normalizowany, a `trimEnd()` bez `trimStart()` sprawia, że wcięty tekst zostaje akapitem.

### 3.2 Dwie powierzchnie MARTWE, które testy nazwały

Kotwice, nie asercje o wyglądzie — gdy ktoś je „naprawi”, test przypomni o dopisaniu przypadku:

- **żaden** slot katalogu nie ustawia `defaultHoverLight`/`defaultHoverDark`, choć typ je deklaruje
  a emiter czyta — środkowe ogniwo łańcucha hoveru jest dziś nieosiągalne;
- gałąź `inner-section` w `withStableIds` jest nieosiągalna z `defaultDocFor` (żaden domyślny
  dokument chrome'u nie ma sekcji wewnętrznej) — stąd 84%, a nie 100%: uczciwy sufit przez API
  publiczne, nie obniżony próg.

---

## 3.3 Warstwa wartości pól panelu wyprowadzona z `WidgetProperties.tsx`

Audyt wskazał ten zabieg wprost: „powtórz to, co dało `lib/builder/schema.ts` 100% funkcji —
wyprowadź z paneli warstwę schematu i walidacji”. Diagnoza była trafna co do PRZYCZYNY: reguły
odczytu i zapisu wartości siedziały jako domknięcia **wewnątrz** komponentu (1 800 linii), więc
jedynym sposobem przetestowania klampa było wyrenderowanie 99 typów widgetów, i18n, Radiksa
i rejestru leniwych chunków.

**Korekta założenia zadania:** warstwa DESKRYPTORÓW pól już istnieje i jest duża —
`lib/builder/schemas.ts` (3 659 linii) z `SchemaField` (typ pola, `min`/`max`/`step`, `default`,
`options`, `legacyKeys`, `visibleWhen`, `inheritedValue`, `group`). Nie było czego projektować.
Brakowało warstwy DOSTĘPU — funkcji, które czytają i zapisują wartość zgodnie z tym opisem.

`src/lib/builder/widgetPanelValues.ts` (nowy, czysty — zero Reacta, zero DOM-u): wysokość
(`readDesktopHeight`, `writeDesktopHeight`, `clampWidgetHeight`), szerokość
(`readActiveWidgetWidth`, `widgetWidthMode`, `widgetWidthValue`, `seedWidthForMode`,
`writeWidgetWidth`) i rozmiary pól (`clampFormElementSize`, `commitSizeInput`, `bumpSize`).
**58 testów, 100% pokrycia modułu.** Bez zmiany zachowania — `check:widget-fidelity` (542 testy)
i cała powierzchnia `admin/builder` (23 pliki / 769 testów) zielone przed i po.

Pilnowane reguły, których złamanie widzi WYŁĄCZNIE redaktor:

- edycja desktopu nie depcze nadpisań tabletu/mobile, a usunięcie OSTATNIEJ warstwy zwija zapis
  do `undefined` (inaczej w JSONB zostaje martwy `height: {}`);
- `"100%"` to PEŁNA szerokość, nie procent — gdyby wpadło w tryb procentowy, przełącznik
  pokazywałby suwak na 100 zamiast zaznaczonego trybu i redaktor nie miałby jak wrócić;
- każda wartość startowa trybu wraca do TEGO SAMEGO trybu (pętla domknięta) — seed `100%` dla
  trybu procentowego uczyniłby ten tryb nieklikalnym;
- pusty wpis znaczy „wróć do auto” (klucz USUNIĘTY), a nie „ustaw zero”;
- wpis nieliczbowy jest IGNOROWANY, nie zapisywany jako `NaN` (doszłoby do CSS jako `NaNpx`);
- krok +/− z „auto” startuje od ZMIERZONEGO rozmiaru, nie od `min`.

**Bundle:** moduł jest importowany wyłącznie z panelu administracyjnego, nie ze ścieżki
bootowania — `check:bundle` w budżecie, `check:entry-purity` czysta (9 chunków statycznie
osiągalnych), `check:chunks` acykliczny.

---

## 4. Defekty wykryte przez nowe testy (osobne commity)

### 4.1 `hasDynamicTokens` zwracał na przemian `true`/`false`

Funkcja sprawdzała obecność tokenu przez `TOKEN_RE.test(input)`, gdzie `TOKEN_RE` to
**współdzielona** stała z flagą `g`. Regexp z `g` pamięta `lastIndex` między wywołaniami, więc
`.test()` na tym samym łańcuchu dawał kolejno `true`, `false`, `true`, `false`…

`resolveDynamicText` było odporne **przypadkiem**: `String.replace` z regexpem `g` sam zeruje
`lastIndex`. Zasięg dziś zerowy (funkcja jest eksportowana, ale nie ma konsumenta) — naprawione
jako pułapka na pierwszego wołającego. Poprawka: bliźniak `TOKEN_TEST_RE` bez flagi `g`.
Test regresji sprawdzony w obie strony: czerwony na starym kodzie, zielony na nowym.

### 4.2 Slug tokenu marki zjadał polskie litery

`slugifyToken` budował nazwę zmiennej CSS (`--brand-<slug>`) rdzeniem **bez** transliteracji liter
atomowych. `normalize("NFKD")` nie rozkłada `ł`, `ø`, `ß`, `đ`, więc każda z nich degradowała do
myślnika albo wypadała z krawędzi:

| Nazwa tokenu | Slug przed | Slug po       |
| ------------ | ---------- | ------------- |
| „Główny”     | `g-owny`   | **`glowny`**  |
| „Żółty”      | `zo-ty`    | **`zolty`**   |
| „Łączny”     | `aczny`    | **`laczny`**  |
| „Kolor Ł”    | `kolor`    | **`kolor-l`** |

Nazwy różniące się **wyłącznie** taką literą mogły dać JEDEN slug — dwie próbki koloru walczyły
wtedy o tę samą zmienną i w kaskadzie wygrywała ostatnia, czyli jeden picker cicho przestawał
cokolwiek robić.

To **trzecie** wystąpienie tej samej klasy błędu w repo: naprawiono ją już dla kotwic nagłówków
(gdzie zunifikowano PIĘĆ rozjechanych implementacji) i dla publicznego adresu profilu. Slug tokenu
marki był szóstym, przeoczonym rdzeniem. Zamiast zakładać trzecią mapę liter, wyeksportowałem
wspólny prymityw `transliterateAtomicLetters` z modułu kanonicznego (`lib/content/anchorSlug.ts`).

**Wsteczna zgodność:** autorski CSS tenanta mógł już odwoływać się do `var(--brand-g-owny)`.
`tokensToCss` emituje więc OBA aliasy, gdy się różnią. Dla nazw bez liter atomowych — czyli dla
większości — `legacyTokenSlug` zwraca `null` i do CSS nie trafia nic dodatkowego. Dokładnie ten sam
zabieg co `legacyAnchorVariants` dla opublikowanych linków `#`.

---

## 5. Zapory: progi per ścieżka (`vitest.config.ts`)

- **`components/admin/builder/**` dostaje PIERWSZY próg w historii** — audyt nazwał tę powierzchnię
  „jedyną dużą powierzchnią MODUŁU 3 bez żadnego progu, i dlatego jedyną, która osunęła się do
  13,6%”. Poziom jest ZMIERZONY (27/26/16/28), nie życzeniowy, i jawnie **nie jest** poziomem
  docelowym.
- **`widget-view/**` PODNIESIONY**: 93/83/90/94,5 → **95/87/94/97**. Stary komentarz twierdził, że
  próg stoi „tuż poniżej poziomu, który pełna suita realnie osiąga” — i to była prawda, tylko nikt
  nie mógł jej zmierzyć.
- **Siedem nowych progów per plik** na powierzchni tokenów i skrótów markdown, każdy z komentarzem
  wyjaśniającym, dlaczego nie 100% (nieosiągalne gałęzie SSR, `catch` na cache'u edge, gałąź
  `inner-section`).
- **`reportOnFailure: true`** w bloku coverage. `checkThresholds` żyje wewnątrz `reportCoverage()`,
  z którego vitest wychodzi natychmiast po pierwszym czerwonym teście — bez tej flagi jeden czerwony
  test zabiera cały pomiar. Dokładnie to unieważniło pomiar w audycie.

---

## 6. Co NIE zostało zrobione

Uczciwie, bo definicja ukończenia zadania stawiała poprzeczkę wyżej niż to, co dowiozłem:

- **`components/admin/builder/**` nie osiągnęło ≥ 90% funkcji.** Jest 17,53% (364 z 2 077).
  Powierzchnia to 112 plików / 25 348 linii; podniesienie jej do 90% wymaga wyprowadzenia warstwy
  dostępu do wartości pól ze `WidgetProperties.tsx` (`readDesktopHeight`, `writeDesktopHeight`,
  klasyfikacja trybu szerokości, klampy rozmiarów, `unhandledSchemaFields`, algorytm grupowania)
  i to jest samodzielna praca, nie domknięcie tej. Powierzchnia ma już próg, więc nie osunie się
  niżej.
- **Gałęzie publicznego renderu bloków** (18,6%) nie były ruszane.
- **Import z WordPressa** (`wordpress-import.functions.ts` — 949 linii, `wp-import.functions.ts` — 688) nie był ruszany. Uwaga do planu: wszystkie ich interesujące helpery są **prywatne w module**,
  więc nie da się ich testować jednostkowo bez wyprowadzenia — a same eksporty to
  `createServerFn` z middleware `requireStaff` i walidatorami Zod.
- **Korekta zakresu z audytu:** `lib/blocks/markdown.ts` **nie jest** parserem importu markdown, jak
  zakładało zadanie. To 71-linijkowy detektor skrótów przy pisaniu w bloku akapitu (9 wzorców
  jednoliniowych). Nie ma tam obrazków, tabel ani zagnieżdżonych list, więc nie było czego testować
  pod tym kątem. Doprowadzenie go do 100% było tanie, ale **nie** daje pokrycia „importu treści”.

---

## 7. Weryfikacja

```
bun run typecheck            # zielono
bun run test:coverage        # 833 pliki / 10 269 testów, wszystkie progi spełnione
bun run check:widget-fidelity # 542 testy, 34,7 s
bun run check:content-layering # 2 562 pliki, 17 krawędzi builder -> bloki, 0 naruszeń
bunx prettier --check         # zielono na wszystkich zmienionych plikach
```

`bun run lint` ma jeden błąd **zastany** (`@typescript-eslint/no-require-imports`
w `src/components/profile/__tests__/AccountIdentityPanel.test.tsx`) — plik nietykany w tej pracy,
inny moduł.

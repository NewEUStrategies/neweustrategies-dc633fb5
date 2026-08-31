# RAPORT: MODUŁ 3 - silniki treści (bloki + page builder), 2026-08-31

Gałąź: `claude/module-3-test-coverage-asymmetry-dh0a0e`, odbita od `main` @ `85f494a`.
Stan wyjściowy: `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` (wydanie 7),
rozdziały 2, 5.3, 6.1 i 8.4.

Wszystkie liczby w kolumnach „PO" są **zmierzone na tym HEAD i zweryfikowane
niezależnie** - uruchamiałem pomiar sam, nie przyjmowałem deklaracji agentów.

---

## 0. Cztery rzeczy, w których zadanie opierało się na nieaktualnych liczbach

Zapisuję to na początku, bo trzy z nich zmieniają zakres pracy, a jedna
odwraca jej kolejność.

| założenie zadania                                                                                     | stan zmierzony                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| „28 z 50 komponentów widget-view ładuje się leniwie, 22 nie"                                          | **96 renderowalnych typów widgetów: 71 leniwych / 25 statycznych.** Żadne kadrowanie kodu nie daje 28/22                                    |
| „repozytorium ma dwie implementacje importu, przetestowana jest jedna - usuń martwą albo pokryj obie" | **Żadna nie jest martwa.** Importują różne rzeczy (wpisy vs strony), obie żywe, obie osiągalne z panelu. Odpowiedź: pokryć obie             |
| „w repozytorium jest 35 wystąpień wzorca `user_id = auth.uid()`"                                      | **10 trafień w stanie końcowym polityk**, z czego 5 bezpiecznych i 5 realnych. 35 to liczba trafień W PLIKACH migracji, nie polityk w bazie |
| „zanim pokryjesz `content.functions.ts` testami, rozstrzygnij, czy dzielić"                           | Kolejność musi być **odwrotna**: najpierw testy, potem podział - uzasadnienie w §4                                                          |

---

## 1. Pomiar pokrycia - PRZED i PO

„PRZED" z audytu (wyd. 7), „PO" zmierzone na tym HEAD.

| plik / obszar                                          |  instr. PRZED |  instr. PO | gał. PRZED |    gał. PO |
| ------------------------------------------------------ | ------------: | ---------: | ---------: | ---------: |
| `src/lib/content.functions.ts`                         |         10,9% | **99,83%** |         1% | **99,58%** |
| `src/components/builder/organisms/BuilderRenderer.tsx` |          6,9% | **99,52%** |         0% | **97,02%** |
| `src/lib/wp-import.functions.ts`                       |            0% |   **100%** |         0% | **99,44%** |
| `src/lib/wp-import/elementor.ts`                       |         3,28% |   **100%** |      2,43% | **99,22%** |
| `src/lib/wp-import/wxr.ts`                             |            0% | **96,87%** |         0% | **94,69%** |
| `src/lib/wp-import/convert.ts`                         |         75,0% |   **100%** |          - | **94,44%** |
| `src/lib/wp-import/buildPage.ts`                       |         62,5% |   **100%** |          - | **95,23%** |
| `src/lib/wp-import/**` (katalog)                       |          ~40% | **98,79%** |          - | **95,74%** |
| `src/components/admin/blocks/hooks/**`                 |            0% | **89,94%** |          - | **79,91%** |
| `src/components/admin/blocks/edit/**` (62 edytory)     |          6,7% | **96,23%** |       0-2% | **85,42%** |
| `src/components/patterns/PatternPicker.tsx`            | 0%, 0 z 40 fn |   **100%** |          - | **94,73%** |
| `src/components/admin/blocks/BlockCanvas.tsx`          | 0%, 0 z 65 fn | **91,43%** |          - | **78,41%** |
| `src/components/admin/blocks/BlockEditRenderer.tsx`    |          1,0% |   **100%** |          - |   **100%** |
| `src/components/admin/blocks/BlockInserter.tsx`        |          1,8% | **97,74%** |          - | **94,59%** |
| `molecules/NestedBlocksEditor.tsx`                     | 0%, 0 z 41 fn | **89,91%** |          - | **73,52%** |
| `molecules/SortableBlockItem.tsx`                      | 0%, 0 z 34 fn | **91,08%** |          - | **76,66%** |
| `hooks/useBlockClipboard.ts`                           | 0%, 0 z 16 fn | **97,89%** |          - | **84,00%** |
| `WordStyleToolbar.tsx`                                 |          2,6% | **85,55%** |          - | **80,00%** |
| `MediaWidgetToolbar.tsx`                               | 0%, 0 z 34 fn | **96,36%** |          - |   **100%** |
| `AutoFootnotesPreview.tsx`                             |            0% | **86,95%** |          - | **78,43%** |
| `PostBlockEditor.tsx`                                  |            0% | **85,48%** |          - | **89,13%** |
| `WordPressImportDialog.tsx`                            |            0% | **97,54%** |          - | **92,59%** |
| `WordPressPreviewDialog.tsx`                           |            0% | **94,73%** |          - | **96,29%** |
| `WxrUploadPanel.tsx`                                   |            0% | **97,59%** |          - | **95,21%** |
| `src/components/admin/blocks/**` (całość)              |           ~2% | **86,43%** |          - | **73,74%** |

Stan `src/components/admin/blocks/**` jako całości: **86,43% instrukcji /
73,74% gałęzi / 86,17% funkcji / 87,84% linii** (z ~2%).

Cel zadania dla tej ścieżki brzmiał „powyżej 90% linii" i **na tej chwili nie
jest osiągnięty - brakuje 2,2 pp**. Cała reszta luki siedzi w DWÓCH plikach,
które nie są rdzeniem edytora, tylko jego sąsiadami w katalogu, i których audyt
nie wymienia:

- `AdminColorPicker.tsx` - **407 linii, 0%**, wspólny selektor koloru panelu,
- `LayoutScaffold.tsx` - **484 linie, 0%**, wireframe układu wpisu owijający kanwę.

To są jednocześnie **jedyne dwa pliki modułu, które zostały na 0%**, więc ten
sam brak liczy się dwa razy: raz jako 2,2 pp do progu 90%, raz jako
niedomknięte „zero plików na 0%". Praca nad nimi jest w toku.

Cel zadania dla obu wynosił „powyżej 85% gałęzi". Osiągnięte **99,58%** i **97,02%**.

Szczegóły:

- **`content.functions.ts`** - 592/593 instrukcji, 481/483 gałęzi, 111/111 funkcji,
  514/514 linii. 268 przypadków w pięciu plikach, 262 zielone + 6 `it.fails`.
  Przed tą zmianą **jeden** z 21 eksportów był wykonywany przez jakikolwiek test.
  Dwie niepokryte gałęzie (l. 1599, 1716) są nieosiągalne - walidator
  `NonEmptyTrimmed` eliminuje prawą stronę `name_pl || name_en`.
- **`BuilderRenderer.tsx`** - 211/212 instrukcji, 261/269 gałęzi, 59/59 funkcji,
  189/189 linii. 173 przypadki w dziewięciu plikach, 170 zielonych + 3 `it.fails`.
  Przed tą zmianą **żaden test nigdy tego pliku nie renderował**: osiem plików
  podmieniało go `vi.mock`, dwa czytały jako tekst przez `readFileSync`.

### Zakaz atrapowania własnej warstwy danych - dotrzymany

To był najważniejszy warunek jakościowy zadania (audyt, rozdz. 8.4: 68 z 82
plików modułu wydarzeń atrapowało `@/lib` albo `@/components`).

Atrapowane **wyłącznie granice**: `@tanstack/react-start`, `require-staff`,
`rate-limit.server`, `audit.server`, `client.server`, i18n, toast.
Nic pod `@/lib/content/**`, `@/lib/seo/**` ani `@/lib/audio/**`.
`evaluateTransition`, `isFirstPublish`, `disclosureGaps`, `shouldSnapshot`,
`normalizeSourcePath`, `isAllowedTtsVoiceId` i `splitAuthors` chodzą naprawdę -
testy dowodzą więc, że bramki strzelają, a nie że strzela atrapa.

### Podział plików testowych - świadomy

Pięć plików dla `content.functions.ts` i dziewięć dla `BuilderRenderer.tsx`,
nie po jednym. Repozytorium ma na to drogą lekcję: `editorMatrix.test.tsx`
z 1486 przypadkami tracił forka na SIGKILL, pokrycie V8 utraconego pliku nie
dojeżdżało do raportu i powierzchnia spadała o 19 pp **przy zielonym logu**.

---

## 2. Pomiar `check:bundle` - PRZED i PO

Ten sam host, pełny build każdego wariantu.

| wariant                           | największy chunk |     PUBLIC |    OVERALL |
| --------------------------------- | ---------------: | ---------: | ---------: |
| baza (`main` 85f494a)             |            270,9 |     2684,0 |     4309,4 |
| `counter` + `text-rotate` leniwe  |            269,7 |     2685,8 |     4311,6 |
| **HEAD (tylko `counter` leniwy)** |        **270,4** | **2684,4** | **4309,7** |
| budżet                            |              280 |       2715 |   **4306** |

Delta HEAD wobec bazy: chunk **−0,5 KB**, PUBLIC +0,4 KB, OVERALL +0,3 KB.

### Bramka jest czerwona i była czerwona PRZED tą gałęzią

`overall 4309,4 > 4306` na **czystym mainie** - przekroczenie **+3,4 KB**
bez żadnego udziału tej gałęzi. Mój udział to +0,3 KB, czyli narzut jednego
chunku - strukturalne minimum za wydzielenie modułu.

**Floora nie podniosłem.** Zadanie tego zabrania, a kronika
`scripts/check-bundle-size.ts` zapisuje, że era „re-floor zamiast naprawy" się
skończyła. Przekroczenie maina wymaga własnej zmiany z wpisem do kroniki
i zmierzoną przyczyną - to nie jest decyzja do przemycenia w gałęzi o pokryciu
testami. Jest to ta sama mechanika, którą kronika opisuje pod datami 08-01,
08-03, 08-12 i 08-14: krok bramki stoi za bramką pokrycia, więc nie wykonuje się.

### Dlaczego PUBLIC/OVERALL nie mogły spaść

Kronika mówi to wprost pod datą 2026-08-06: PUBLIC liczy **każdy** chunk
osiągalny z publicznego URL-a, nie pierwsze wczytanie. Przeniesienie kodu
z eager do lazy nie rusza tej liczby ani o bajt - PUBLIC spada wyłącznie wtedy,
gdy kod **znika** albo staje się osiągalny **wyłącznie spod `/admin`**.
Lazyfikacja widgetu nie robi ani jednego, ani drugiego; rusza tylko chunk
startowy, który płaci każde pierwsze wejście.

Z tego samego powodu **nie da się** naprawić przekroczenia OVERALL podziałem
kodu: OVERALL liczy każdy chunk, więc bajty przesuwają się między plikami,
nie znikają. OVERALL spada tylko przez usunięcie kodu.

---

## 3. Rozstrzygnięcie 25 statycznych importów widgetów

Liczba z zadania (22) jest nieaktualna. Zmierzone dwoma niezależnymi
przejściami: **96 renderowalnych typów, 71 leniwych / 25 statycznych.**
96 = 51 `case` w `WidgetView.tsx` + 45 w `SimpleWidgets.tsx` (zero pokrycia
między switchami), co zgadza się co do sztuki z 96 kluczami `type:`
w `lib/builder/registry.tsx`.

### Świadome (15) - objęte kontraktem z nagłówka `lazyWidgets.tsx`

`heading`, `button`, `nav-link`, `cta`, `dark-featured-card`, `divider`,
`spacer`, `icon`, `copyright`, `social-icons` - inline JSX po kilka linii;
`mega-menu`, `menu`, `lang-switcher`, `theme-toggle` - chrome nagłówka/stopki,
musi hydratować pierwsze; `image` - zadeklarowany kandydat LCP.

### Przeoczenie naprawione (1): `counter`

Własny moduł 105 linii (`requestAnimationFrame` + `IntersectionObserver`),
jedyny konsument to `SimpleWidgets`, który jest na eager-owej ścieżce chrome
(Header/Footer → BuilderRenderer → WidgetView). Statyczny import ładował go do
chunku wejściowego **każdej** strony, także bez ani jednego licznika.
Pomiar: chunk startowy **−0,5 KB**.

### Przeoczenie rozważone i ODRZUCONE POMIAREM (1): `text-rotate`

Wyglądało na bliźniaczy przypadek: 240 linii, a bliźniaczy `animated-heading`
jedzie leniwie od 2026-08-15. **Zlazyfikowałem, zmierzyłem i wycofałem.**

Przyczyna jest dokładnie tą, przed którą ostrzega komentarz
w `BuilderRenderer.tsx` l. 133-142: `lazy()` odracza pobranie, ale **nie usuwa
krawędzi w grafie**, dopóki istnieje inny statyczny importer na publicznej
trasie. `@/components/ui/text-rotate` ma takiego importera -
`components/careers/organisms/CareersHero.tsx` (trasa `/zatrudniamy`), gdzie
jest hero **nad zgięciem**, czyli import w pełni zasadny. Modul nie opuścił
więc budżetu PUBLIC, a doszedł narzut osobnego chunku (+1,8 KB PUBLIC,
+2,2 KB OVERALL wobec +0,4/+0,3 dla samego `counter`).

To jest ta część zadania, która brzmi „lazy() nie jest dowodem, dowodem jest
pomiar" - i pomiar unieważnił tu połowę mojej własnej zmiany.

### Świadome po tym przeglądzie (8) - zostają eager, z powodem

- `categories`, `tags` - moduły 25 i 22 linii; własny chunk to narzut nagłówka
  HTTP droższy niż zawartość (kronika 08-06 (2): 45 plików po 300-400 B
  kosztowało ~22 KB samych nagłówków),
- `map`, `video` - eager jest tylko `DeferredFrame` (85 l.), sam iframe montuje
  się dopiero w kadrze,
- `hot-topic-bar` - inline JSX,
- `timeline`, `logo-cloud`, `testimonial` - ~236 linii inline **wewnątrz**
  `SimpleWidgets`. Zlazyfikowanie wymaga najpierw wyciągnięcia ich do własnych
  modułów, czyli refaktoru produkcyjnego o innym profilu ryzyka niż ta gałąź.
  **Zapisane jako następny krok, nie zrobione.**

### Hybrydy - „zrób leniwym" ich nie zdejmuje

`pricing` trzyma ~46 linii tabeli eager i lazyfikuje tylko wariant planów;
`gallery` lazyfikuje sam lightbox, a ~118 linii siatki zostaje; `text` trzyma
shell w `WidgetView`, leniwy jest tylko `RichHtmlView`. Warto to wiedzieć,
zanim ktoś zapisze je w backlogu jako „trzy łatwe".

---

## 4. Rejestr typów: switch czy mapa leniwych wpisów

Zadanie pytało o jedno. Odpowiedź zależy od powierzchni i **jedna odpowiedź na
oba rejestry byłaby fałszywa**.

### Widgety: switch, ale NIE wciągający wszystkiego

Dyspozytor jest dwustopniowym switchem (`renderSimpleWidget` z 45 `case`
i sentinelem `undefined`, potem własny switch `WidgetView` z 51 `case`), ale
**leniwość jest wobec niego ortogonalna** - żyje w `lazyWidgets.tsx`
(`lazy(() => import(...))` + `withSuspense`), a typy idą przez `import type`,
więc granica podziału się nie zapada. 71 z 96 `case` renderuje komponent
z rejestru leniwego.

Przepisanie tego switcha na mapę leniwych wpisów **nie zdjęłoby ani jednego
bajtu** - bajty już są zdjęte. Kosztowałoby narzut nagłówka na chunk i
czytelność dyspozytora. **Nie przepisuję.**

Realna wada tej konstrukcji jest inna i warto ją zapisać: leniwość jest
**niewidoczna w miejscu użycia**. Oba switche renderują gołe identyfikatory,
a o podziale decyduje wyłącznie to, z którego bloku importu przyszła nazwa.
Dopisanie `import { Foo } from "./Foo"` cicho przenosi `Foo` do chunku
wejściowego i żaden lokalny sygnał tego nie pokazuje.

### Edytory bloków: switch I wciągający wszystko

Zmierzone samodzielnie po `src/components/admin/blocks/` (bez testów):

- `React.lazy`, `Suspense`, dynamiczny `import()` - **zero wystąpień**,
- `BlockEditRenderer`: **61 statycznych instrukcji importu** (l. 11-114),
  100 `case`, `default` renderujący szarą atrapę `[typ]`,
- `@tiptap`: **19 importów** w `Paragraph.tsx` + `Heading.tsx`, wszystkie eager.

Jeden chunk niesie 62 edytory razem z TipTapem, silnikiem wykresów, react-query,
`MediaPickerDialog` i `ExpertPicker`. W baseline chunk `PostBlockEditor` ma
**184,8 KB** - piąta pozycja w całym wyjściu.

**Czego to nie zmienia i dlaczego tego nie robię w tej gałęzi:** to kod
wyłącznie adminowy, więc liczy się do OVERALL, a nie do PUBLIC - czytelnik nie
płaci za to ani bajta. Podział **nie zmniejszy OVERALL** (bajty przesuwają się
między plikami), a wymaga wprowadzenia granic Suspense tam, gdzie dziś nie ma
żadnej, przy edytorach TipTap zwracających `null` w trakcie inicjalizacji
(`Paragraph.tsx:410`, `Heading.tsx:257`) - czyli w interakcji z przywracaniem
focusu i karetki. Zapisane jako **rekomendacja następnego kroku z konkretnym
adresatem** (chunk `PostBlockEditor`, pierwsze wczytanie panelu redaktora).

---

## 5. Granice Suspense i CLS - pomiar, nie deklaracja

Osiągalne z `BuilderRenderer.tsx` są **dwie** granice Suspense, plus jedna pod
każdym leniwym widgetem:

| granica                                              | fallback                           | rezerwuje miejsce?          |
| ---------------------------------------------------- | ---------------------------------- | --------------------------- |
| `StreamingSection` (`sectionStreaming.tsx:259`)      | `SectionStreamSkeleton`            | **tak**, `minHeight` 280 px |
| picker pustego kontenera (`BuilderRenderer.tsx:655`) | `null`                             | nie                         |
| każdy leniwy widget (`lazySuspense.tsx:40`)          | `LazyFallback` → `null` publicznie | nie                         |

**Werdykt:** dwa fallbacki nie rezerwujące niczego są **zasadne** - SSR wypełnia
te granice przed wysłaniem HTML, więc czytelnik nigdy fallbacku nie widzi
(a picker jest w ogóle wyłącznie adminowy). Ryzyko CLS zostaje przy jednym
miejscu: **stałe 280 px kontra faktyczna wysokość sekcji**. To stały domysł bez
związku z rzeczywistą wysokością i może przesuwać treść w **obie** strony -
wysoka sekcja listy wpisów (typowo 600-900 px) zepchnie treść w dół po
rozwiązaniu, niska podciągnie ją w górę.

Ograniczenie pomiaru, zapisane uczciwie: `import.meta.env.SSR` jest pod
vitestem fałszem, więc `ServerSectionGate` jest nieosiągalny przez
`<StreamingSection>` - pokrywa go osobny, istniejący test montujący gate
bezpośrednio. Liczby pokrycia mierzone są w trybie **dev** (`import.meta.env.DEV`
= true), więc `BuilderDebugOverlay` renderuje się, a jego produkcyjne ramię
`if (!import.meta.env.DEV) return null` jest jedyną niepokrytą instrukcją.

---

## 6. `content.functions.ts` - decyzja: NIE dzielić (na tym etapie)

Zadanie kazało **rozstrzygnąć**. Rozstrzygnięcie: nie dzielić teraz, z trzech
konkretnych powodów.

1. **Oś podziału z zadania w tym pliku nie istnieje.** Zadanie proponuje granicę
   „odczyt publiczny / mutacje redakcyjne / rozstrzyganie ścieżek / cache".
   Zmierzone: **21 z 22 eksportów to mutacje redakcyjne** (każdy
   `createServerFn({method:"POST"}).middleware([requireStaff])`), 22. to
   interfejs `BulkResult`. Odczytu publicznego: **zero**. Cache: **zero**.
   Rozstrzyganie ścieżek istnieje, ale jest **prywatne** (`slugify`,
   `uniqueSlug`, `pageFullPath`, `captureAutoRedirect`) - nie da się go
   wydzielić bez zmiany powierzchni. Realna granica jest **encjowa**
   (posty / strony / taksonomie), nie odpowiedzialnościowa.
2. **Podział nie usuwa modułu, tylko dokłada warstwę.** Ścieżkę
   `@/lib/content.functions` mają zapisane na sztywno 12 miejsc produkcyjnych
   i 10 plików testowych - w tym jako **stringi** w `vi.mock` i w asercjach
   opartych o `readFileSync`. Podział wymaga zostawienia barrela pod starą
   ścieżką.
3. **Podział byłby nieweryfikowalny dokładnie wtedy, gdy weryfikacja jest
   najpotrzebniejsza.** Przed tą gałęzią jeden z 21 handlerów był wykonywany
   przez jakikolwiek test. „Pokrycie nie spadło" nie byłoby żadnym dowodem
   bezpieczeństwa przeniesienia 1778 linii. Do tego cztery handlery robią
   dynamiczne `await import(...client.server)`, a plugin buildu dzieli
   server-fn **po module** - to nie jest przenoszenie czystych funkcji.

**Kolejność jest więc odwrotna niż założyło zadanie: najpierw testy, potem
podział.** Testy są siatką, która czyni ruch 1778 linii weryfikowalnym.
Dzielenie pliku o jednym wykonywanym teście to ruch po ciemku. Po tej gałęzi
plik stoi na 99,83%/99,58% - i **teraz** podział jest tanią, bezpieczną operacją
dla kogoś, kto go zechce zrobić.

---

## 7. CZĘŚĆ C - izolacja najemcy

### 7.1 `page_full_path` - znalezisko otwarte siedem wydań, zamknięte

Migracja `20260831160000_page_full_path_tenant_scope.sql`.

**Drugie znalezisko tej zmiany:** wariant **wsadowy** `public.page_full_paths`
(migracja 20260724150000, przedefiniowany w 20260724184141) ma **dokładnie tę
samą dziurę**, a to on obsługuje dziś sitemapę, archiwa i wyszukiwarkę. Audyt
nazywał tylko funkcję pojedynczą. Naprawa jednej bez drugiej zostawiłaby dziurę
w ścieżce o **większym** ruchu. Naprawione obie.

**Dwie warstwy obrony**, bo jedna nie wystarcza:

- **predykat najemcy w rekurencji** obu funkcji, **samo-zakotwiczony** w wierszu
  startowym (`p.tenant_id = c.tenant_id`), nie w `current_tenant_id()`.
  To decyzja, nie przeoczenie: sitemapę generuje service-role, gdzie kontekst
  najemcy jest NULL, więc filtr po sesji zamieniłby ciche naruszenie izolacji
  na cichą **awarię produkcyjną** - każda ścieżka wywróciłaby się do NULL-a;
- **złożony klucz obcy** `(parent_id, tenant_id) → (id, tenant_id)`, który nie
  pozwala takich danych **wytworzyć**.

**Wybór mechanizmu** (zadanie kazało uzasadnić „CHECK z funkcją albo trigger"):
wybrałem trzecią opcję, bo jest ściśle mocniejsza od obu.

- **CHECK z funkcją jest niepoprawny**, nie tylko słabszy: Postgres wymaga
  immutable-ości, sprawdza wyrażenie wyłącznie przy zapisie **tego** wiersza
  i nie przelicza go przy zmianie `tenant_id` **rodzica** - dziura wraca cicho.
  `pg_restore` dokłada drugi problem: CHECK jest odtwarzany przed danymi.
- **Trigger** jest poprawny, ale trzeba go pisać na **obu** kierunkach, wymaga
  jawnej blokady wiersza rodzica, i **da się go wyłączyć** - co ta baza realnie
  robi w pgTAP (`ALTER TABLE ... DISABLE TRIGGER USER`).
- **Złożony FK** załatwia oba kierunki jedną deklaracją, pod właściwą blokadą,
  bez możliwości pominięcia spod service-role, i przeżywa dump/restore.

Istniejące naruszenia są **naprawiane, nie omijane**: świadomie bez `NOT VALID`,
które zostawiłoby w bazie dokładnie te wiersze, które już dziś wnoszą obcy slug
do sitemapy. Strony z rodzicem u obcego najemcy są odczepiane, z liczbą
w `RAISE NOTICE`.

**Sprostowanie zasięgu, które sam sobie wystawiłem.** Pierwsza wersja migracji
twierdziła, że polityka `"Public reads published pages"` nie ma warunku najemcy.
Tak brzmi migracja **założycielska** 20260531182153, ale późniejsza ją
zaostrzyła. Stan końcowy, odczytany z `pg_policies`:
`status = 'published' AND deleted_at IS NULL AND tenant_id = public_tenant_id()`.
Wyciek jest więc realny **na ścieżce service-role** (sitemap, RSS), a nie
„wszędzie". Werdykt o naprawie bez zmian, zawężony zasięg - zabezpieczenie
trzymające się wyłącznie tego, że RLS przypadkiem ukryje wiersz rodzica, jest
zabezpieczeniem przez skutek uboczny.

### 7.2 Test pgTAP - funkcja nie miała żadnego

`supabase/tests/page_full_path_tenant_scope_test.sql`, 14 asercji na obu
warstwach, w tym **oba kierunki** zmiany `tenant_id` (dziecka i rodzica) -
połowa, której trigger na dziecku by nie złapał.

**Dowód, że test wykrywa defekt, a nie tylko przechodzi:** na lokalnej replice
(`scripts/pgtap-local`, **931 migracji**, PostgreSQL 16) przy przywróconym
stanie sprzed migracji plik daje `ran=14 failed=8` - cztery asercje ograniczenia
i cztery predykatu rekurencji. Po migracji 14/14 zielonych.

Pierwsze podejście miało błąd **własnego testu**: `DROP CONSTRAINT` bez
`IF EXISTS` przerywał transakcję i cztery asercje warstwy B nie wykonywały się
wcale (`ran=10` z planu 14) - dokładnie w scenariuszu, dla którego istnieją.

Migracja jest **replay-safe** (osłonięte `DO/EXCEPTION` zamiast nieistniejącego
w Postgresie `ADD CONSTRAINT IF NOT EXISTS`) - bez tego powtórne wykonanie
przerywało się **przed** założeniem klucza obcego, zostawiając połowę naprawy.

### 7.3 Uprząż `tenant-isolation-harness`: 45 → 62 asercje

Dziewięć asercji dla ścieżki strony (odczyt, zapis, schemat) i osiem dla
płaszczyzny właściciela.

**Inna klasa luki niż reszta tej uprzęży**, dlatego inne asercje: reszta mierzy
polityki gubiące najemcę, a tutaj polityki nie ma o co pytać - nad
`page_full_path` wołanym spod service-role nie stoi żadna. Asercja odczytu woła
funkcję jako właściciel bazy, w tym samym układzie uprawnień co generator
sitemapy; gdyby szła przez RLS, przechodziłaby z zupełnie innego powodu
(niewidoczny wiersz), czyli mierzyłaby nie to zjawisko.

**Kolejność asercji jest częścią dowodu** i jest wymuszona: najpierw schemat
(dowód, że migracja się wykonała, wraz z `convalidated`), potem zapis przy
ograniczeniu **założonym**, na końcu odczyt - dopiero tam zdejmujemy
ograniczenie i wstawiamy wiersz dryfujący. Pierwsza wersja miała to odwrotnie
i była **błędna**: wiersz dryfujący wymagał zdjęcia ograniczenia w seedzie,
a jego przywrócenie czyniło asercję schematu **samospełniającą**.

Obok każdej asercji negatywnej stoi **kontrola dodatnia** (legalne przepięcie
w obrębie najemcy musi przechodzić, ścieżka w obrębie najemcy musi się składać).
Bez nich asercje „nie da się" przechodziłyby także wtedy, gdyby zapis nie
działał wcale.

Selektor migracji w `run.sh` dostał dwa nowe ramiona - pierwsze dobiera pliki po
nazwach **polityk**, a moje migracje albo żadnej nie tworzą, albo tworzą inne.
Bez tego uprząż zaaplikowałaby atrapę i testowała **samą siebie**.

**Dowód wykrywania:** przebieg z migracją odstawioną poza katalog kończy się
kodem 1 na asercji „ODCZYT: slug strony obcego najemcy nie wchodzi do ścieżki
kanonicznej" (45 asercji zdanych przed błędem). Analogicznie dla drugiej
migracji - kod 1 na „historia czytania z obcego tenanta jest niewidoczna"
(54 zdane).

### 7.4 Przegląd polityk RLS - pełna lista

**Metoda:** nie grep po migracjach, a **stan końcowy**: 931 migracji
zaaplikowanych na lokalną replikę, potem zapytanie po `pg_policies`
skrzyżowane z listą tabel mających `tenant_id NOT NULL`.

**Dlaczego nie grep** (i skąd rozjazd z liczbą 35): te same polityki są
wielokrotnie `DROP`/`CREATE`-owane, więc jedno wystąpienie w stanie końcowym ma
po kilka trafień w plikach, a dziury naprawione w 20260829091010
i 20260831060000 nadal tam świecą.

**Wynik: 579 polityk w `public`, 10 trafień wzorca.**

Bezpieczne (5) - wiążą najemcę idiomem, którego szukanie po `current_tenant_id`
nie widzi:

| tabela / polityka                               | jak wiąże najemcę                          |
| ----------------------------------------------- | ------------------------------------------ |
| `club_applications` / `..._select_own`          | podzapytanie po `profiles`                 |
| `event_audience_grants` / `..._own_read`        | `_caller_tenant()`                         |
| `event_package_orders` / `..._buyer_read`       | `_caller_tenant()`                         |
| `event_package_seats` / `..._buyer_read`        | `_caller_tenant()` + domknięcie w `EXISTS` |
| `notification_preferences` / `own prefs insert` | najemca w `WITH CHECK`                     |

Realne dziury (5 polityk, 2 tabele) - **naprawione** migracją `20260831170000`:

| tabela / polityka                                 | cmd    | skutek                                                 |
| ------------------------------------------------- | ------ | ------------------------------------------------------ |
| `user_read_history` / `read_history owner select` | SELECT | historia czytania widoczna z obcego obszaru            |
| `user_read_history` / `read_history owner insert` | INSERT | zapis do **dowolnego** obszaru przy jawnym `tenant_id` |
| `user_read_history` / `read_history owner update` | UPDATE | zmiana cudzej-obszarowo historii                       |
| `user_read_history` / `read_history owner delete` | DELETE | skasowanie cudzej-obszarowo historii                   |
| `personality_result_history` / `..._owner_read`   | SELECT | wyniki testu osobowości widoczne z obcego obszaru      |

Uwaga do wiersza INSERT: `tenant_id` ma `DEFAULT current_tenant_id()`, ale
default działa **tylko** wtedy, gdy kolumny nie ma w `INSERT`-cie. Klient
podający `tenant_id` jawnie zapisywał wiersz gdziekolwiek. Jest na to osobna
asercja w uprzęży.

Obie tabele niosą **dane osobowe**: historia czytania mówi, **co** konkretny
człowiek czytał; wyniki testu to profil psychometryczny.

**Tabele MODUŁU 3 są czyste - i to jest właściwa odpowiedź na pytanie
z zadania.** Sprawdzone wszystkie tabele modułu i wszystkie **47** ich polityk:
`pages` (5), `builder_experiments` (8), `builder_experiment_events` (4),
`builder_global_widgets` (7), `builder_popups` (9), `builder_revisions` (3),
`builder_template_revisions` (3), `builder_templates` (4), `user_blocks` (3).
Każda wiąże najemcę w `USING` albo w `WITH CHECK`. **Zero dziur do naprawy
w module 3**; pięć znalezionych leży poza nim (moduły 1/15/17) i zostały
naprawione, bo zadanie mówi „napraw realne dziury", a to są jedyne realne,
jakie przegląd znalazł w całym repozytorium.

Obserwacja poboczna, nie naprawiana: `builder_experiment_events` nie ma kolumny
`tenant_id` **w ogóle**, przy czterech politykach RLS i przy
`builder_experiments`, które `tenant_id` ma. Bramkowanie idzie przez join do
eksperymentu, więc to nie dziura - ale jest to jedyna tabela modułu bez
własnego najemcy i warto o tym wiedzieć przy następnej zmianie tej powierzchni.

Świadomie **nie** dodałem polityk zapisu do `personality_result_history`: dziś
ich nie ma (zapis idzie definerem), a dołożenie powierzchni zapisu dla
`authenticated` byłoby zmianą produktową przemyconą pod naprawą izolacji.

### 7.5 Snapshot autoryzacji

Regenerowany, **jedna linia diffu**: `stats.migrations 930 → 932`. `functions`
(1086) i `policies` (607) bez zmian.

To nie jest „regeneracja, żeby zgasić czerwień", której zadanie zabrania, i nie
jest to moja własna ocena - **bramka klasyfikuje ten rozjazd sama**:
„PROVENANCE - ten sam krąg uprawnionych, inne miejsce w historii (1)
[...] wystarczy regeneracja snapshotu". Gdyby zmieniła się którakolwiek
z 43 bramek rolowych albo 23 bramek flag warstw, diff nie miałby jednej linii
i regeneracja byłaby właśnie tym zakazanym ruchem. Precedens w repozytorium:
commit `eba9b1f`.

---

## 8. Decyzja w sprawie dwóch implementacji importu WordPressa

**Rozstrzygnięcie: pokryć obie. Żadna nie jest martwa - i nie ma tu czego
usuwać.** Zadanie zakładało, że jedna jest martwa; dowód mówi inaczej.

|                     | Impl A `wordpress-import.functions.ts`                           | Impl B `wp-import.functions.ts` + `wp-import/*`                                                           |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| co importuje        | blog **POSTY** (`posts`, `wp_import_jobs`, `redirects`)          | **STRONY** (`pages` + `builder_data`, `content_revisions`)                                                |
| wejście z panelu    | przycisk na `/admin/posts` → `/admin/import-wordpress`           | `WordPressImportDialog` na `/admin/pages` (**jest w `adminNav`**)                                         |
| unikalne zdolności  | ślad zadania, anulowanie, rate limit, audyt, przechwytywanie 301 | **jedyna ścieżka wgrania pliku WXR**, podgląd konwersji bez zapisu, parowanie PL/EN, nadpisanie z migawką |
| stan pokrycia PRZED | 99,28%, próg 97/98/97/94                                         | **0%** (i 3,28% w `elementor.ts`)                                                                         |

Usunięcie którejkolwiek usuwa **żywą zdolność panelu**. Impl A jest jedyną
ścieżką piszącą `posts`/`redirects`; Impl B jedyną piszącą `pages`/`builder_data`
i jedyną przyjmującą plik WXR (serwisy self-hosted / bez Jetpacka).

`knip` potwierdza: żaden z tych plików nie jest na liście nieużywanych.
`git log` nie pomaga w rankingu - wszystkie 12 plików ma identyczny znacznik
czasu z jednego zgniecionego commita `65ac309`.

**Metodologiczny wniosek audytu (rozdz. 5.3) jest tu potwierdzony, nie
podważony:** zakres zadania testowego nie może być listą nazw plików, musi być
listą ścieżek użytkownika. Traktowanie 5.3 jako zadania deduplikacyjnego
odwraca to znalezisko - „import z WordPressa" obejmuje **obie** implementacje.

Pułapka do zapisania, bo myli: katalog `wp-import/` **nie** należy w całości do
Impl B. `localizedMerge.ts` w środku należy do Impl **A**. Przeniesienie albo
usunięcie katalogu w całości psuje Impl A.

---

## 9. Nowe bramki parytetu

### 9.1 Rejestr bloków ⇄ dyspozytor edytorów - jeden realny defekt

Wzorzec z `lib/events/__tests__/dbEnumParity.test.ts` przeniesiony na parytet
rejestr ⇄ dyspozytor, bo mechanizm jest ten sam: dwa niepowiązane miejsca,
których rozjazdu kompilator nie widzi (`switch` bez wyczerpania wpada
w `default`).

**Znalezione:** `link-preview` jest w `IMPLEMENTED_BLOCKS` (101 typów),
a `BlockEditRenderer` ma 100 `case` - bez tego jednego. Typ jest **żywy**: ma
działający i przetestowany renderer publiczny (`LinkPreviewBlockView`) oraz
gotowy komponent edytora (`admin/blocks/edit/LinkPreviewBlock.tsx`, 146 linii),
ale ten edytor nie jest importowany przez nikogo. Redaktor, który wstawi ten
blok, dostaje szarą atrapę `[link-preview]` z gałęzi `default`.

`knip` raportuje ten plik jako nieużywany, ale to **nie martwy kod, to brakujące
podłączenie** - usunięcie edytora utrwaliłoby defekt zamiast go pokazać.

### 9.2 Stałe modułu 3 ⇄ CHECK-i bazy - domknięta znana luka wzorca

Zadanie nazwało lukę wprost: wzorzec „nie widzi kolumn nullowalnych zapisanych
jako `CHECK (kol IS NULL OR ...)`". Regex tamtej bramki wymaga trzech rzeczy
naraz: nazwanego ograniczenia, nazwy zaczynającej się od `event_`, oraz formy
`kol IN (...)` bez przedrostka.

Najciekawsze ograniczenie tego modułu łamie **dwa** z tych trzech założeń:

```sql
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS takeaways_variant TEXT NULL
  CHECK (takeaways_variant IS NULL OR takeaways_variant IN ('card','heading','ghost'));
```

jest **nienazwane** i ma przedrostek `IS NULL OR`.

Parser tutaj obsługuje ograniczenia nazwane i nienazwane, przedrostek
`IS NULL OR`, obie formy zbioru (`IN (...)` i `= ANY (ARRAY[...])`) i dowolną
wielkość liter - bo repozytorium używa wszystkich tych wariantów naraz.
Kluczem mapy jest `tabela.kolumna`, nie nazwa ograniczenia.

**Zasięg:** parser widzi **259** ograniczeń wyliczeniowych w całym
repozytorium wobec ~30 nazwanych `event_*`, które widzi wzorzec źródłowy.
Jest więc ścisłym uogólnieniem, nie kopią.

Wszystkie trzy pary są dziś **zgodne**, więc bramka nie zgłasza defektu - ona go
nie dopuszcza. To jej cała wartość: trzy pary trzymały się na komentarzach,
a komentarz nie jest bramką.

Parytet rejestru **widgetów** z dyspozytorem: dziura analogiczna do
`link-preview` **nie istnieje** - wszystkie 96 typów palety jest obsłużonych.

---

## 10. Rejestr defektów zarejestrowanych jako `it.fails`

**25 defektów** zarejestrowanych w tej gałęzi. (W całym module jest 29 wpisów
`it.fails` - pozostałe 4 są wcześniejsze i należą do innych modułów.)

Każdy wpis został uruchomiony **najpierw jako zwykły `it`** i potwierdzony, że
pada **na asercji docelowej**, a nie po drodze na błędzie przygotowania. Przy
każdym zapisane, dlaczego nie jest naprawiony: naprawa jest zmianą zachowania
produkcyjnego, czego ta gałąź nie robi.

### Warstwa mutacji treści (6)

1. **`slugify` zamienia polskie `ł`/`Ł` na myślnik, nie na `l`.** NFD + zdjęcie
   znaków łącznych nie działa na U+0142/U+0141 (brak dekompozycji kanonicznej),
   więc wpadają w klasę `[^a-z0-9]+`. Zmierzone: „Wpływ polityki" →
   `wp-yw-polityki`, „Zażółć Gęślą JAŹŃ" → `zazo-c-gesla-jazn`. **Jedna funkcja
   karmi slugi wpisów, stron, kategorii I tagów**, więc dotyczy to każdego
   permalinka w CMS-ie prowadzonym po polsku. Ta sama rodzina defektu, którą
   audyt odnotował w rozdz. 7.2.
2. **`deleteCategory` raportuje cichą odmowę RLS jako sukces.** Brak
   `.select("id")` i kontroli liczby wierszy, mimo że każda inna mutacja w pliku
   to robi, a komentarz przy `deletePost` tłumaczy dlaczego. Kategoria zostaje po
   odświeżeniu, a redaktor widział potwierdzenie. Gałąź UPDATE w `upsertCategory`
   ma tę samą lukę.
3. **`deleteTag`** - ta sama luka.
4. **Cztery mutacje bez bramki rate limit** (`deletePost`, `deletePage`,
   `deleteCategory`, `deleteTag`), mimo że nagłówek modułu deklaruje limit dla
   każdego wywołania, a 17 z 21 eksportów go ma. Kasowanie jest jedyną operacją
   nieodwracalną, a ścieżki hurtowe limit **mają** - wywołanie wersji
   jednowierszowej w pętli jest więc obejściem limitu.
5. **`bulkUpdatePages` pozwala na hurtową publikację bez prawa publikacji.**
   `bulkUpdatePosts` sprawdza `can_publish_content`; `bulkUpdatePages` nie
   sprawdza nic. Autor, który nie może opublikować strony pojedynczo, publikuje
   ją zaznaczając na liście. Trigger `pages_workflow_guard` jest ostatnią linią
   obrony.
6. **`bulkUpdatePages` przyjmuje `scheduled` bez daty publikacji** i bez
   `evaluateTransition`, mimo że `BulkPostStatus` świadomie ten status wyklucza.
   Taka strona **nigdy się nie opublikuje** (scheduler szuka
   `publish_at <= now()`) i **jednocześnie przestaje być widoczna publicznie** -
   znika bez śladu w UI.

### Publiczny renderer buildera (3)

7-8. **`hideOn` jest honorowany wyłącznie dla widgetów.** Panel wystawia ten sam
przełącznik na trzech poziomach (widget, sekcja, kolumna), a renderer filtruje
tylko pierwszy. Sekcja albo kolumna „ukryta na telefonie" jedzie do czytelnika
z całą treścią i nie ma nawet reguły CSS, która by ją schowała. Tak właśnie
buduje się „ukryj wersję desktopową na telefonie", czyli **podwójna treść
i podwójny obraz LCP** na łączu komórkowym. 9. **Sanityzacja adresu wideo tła jest martwym kodem.** Renderer liczy adres jako
`safeImageUrl(background.videoUrl) || background.videoUrl` (L570-573) - druga
część alternatywy przywraca dokładnie tę wartość, którą pierwsza odrzuciła,
więc do `<video src>` idzie wartość surowa. Granica szkody nazwana uczciwie:
`<video src>` nie wykonuje skryptu, więc **to nie XSS** - ale sanityzator,
który nic nie sanityzuje, jest gorszy niż jego brak, bo czyta się jak
zabezpieczenie.

### Rodzina 62 edytorów bloków - koercja wartości (7)

Wszystkie z jednej przyczyny: `min`/`max` w tych edytorach jest **wyłącznie
atrybutem HTML**, a `onChange` pisze `Number(e.target.value)` do danych bez
klamrowania. Wartość wpisana z klawiatury lub wklejona przechodzi.

10. **Poziom nagłówka podany jako `"h2"` daje klasę `cms-hNaN`** i atrybut
    `data-heading-level = NaN`. To nie hipoteza - **taki właśnie kształt
    przychodzi z importu WordPressa**.
11. Wysokość odstępu podana jako `"wysoko"` pokazuje redaktorowi `NaNpx`.
12. Pasek postępu z wartością `"nic"` pokazuje `NaN%`.
13. Wykres z wysokością `"wysoko"` pokazuje `NaNpx`.
14. **Wykres pokazuje wysokość 99 999 px, choć strona narysuje najwyżej 640** -
    edytor kłamie o tym, co zobaczy czytelnik.
15. **Obraz z podpisem jako OBIEKT wpisuje w pole `[object Object]`** - i to jest
    ta wersja, która trafia do danych.
16. **Lista z pozycjami jako OBIEKTY renderuje `[object Object]`.**

### Rdzeń edytora bloków (4)

17. **`link-preview` to żywy typ bloku bez osiągalnego edytora.** Jest
    w `IMPLEMENTED_BLOCKS` (101 typów), ma działający i przetestowany renderer
    publiczny oraz gotowy komponent edytora (146 linii) - ale switch
    `BlockEditRenderer` ma 100 `case`, bez tego jednego. Redaktor dostaje szarą
    atrapę `[link-preview]`. `knip` raportuje plik jako nieużywany, ale to **nie
    martwy kod, to brakujące podłączenie** - usunięcie edytora utrwaliłoby defekt.
18. **Nie istnieje żaden limit głębokości zagnieżdżenia.** Pętla
    `BlockEditRenderer case group/row/stack/grid/columns → GroupBlock/ColumnsBlock
→ NestedBlocksEditor → BlockInserter → BlockEditRenderer` jest domknięta
    i cała dostępna przez normalne UI. Żaden jej element nie zna swojej
    głębokości. `BlocksDocSchema` ogranicza **wyłącznie** tablicę najwyższego
    poziomu (max 500) - 600 bloków na top-level jest odrzucone, a **600 dzieci
    jednego kontenera przyjęte bez słowa**. Dokument o 200 poziomach przechodzi
    walidację i zapisuje się do bazy.
19. **Cofnięcie po zapisie w tle gubi historię undo - warunkowo.**
    `useLocalizedBlocksHistory` zeruje stosy przy zmianie **tożsamości obiektu**
    dokumentu; autosave utrwalający wklejony obraz `data:` taką tożsamość tworzy.
    **Zawężenie wobec pierwszej diagnozy:** rekonesans twierdził „każdy
    autosave" - nieprawda. `replaceFormImageUrls` ma zwarcie na braku trafień
    (`savePayload.ts:123` zwraca **ten sam** obiekt), a `setSlug` jest pod
    `if (result.changed)`. Defekt zapala się dokładnie wtedy, gdy autosave
    utrwalił wklejony obraz - codzienna ścieżka redaktora, ale nie każda.
20. **Wklejenie z Worda gubi pogrubienie** przez `mso-bidi-font-weight`. Szkoda
    jest wybiórcza, nie całkowita: treść zostaje, formatowanie ginie.

### Import WordPressa (4)

21. **Dwie różne heurystyki języka PL/EN.** `WordPressImportDialog` używa
    `/-en$|^en-|\/en\/|\ben\b/`, a `WxrUploadPanel` najpierw honoruje meta
    języka z WXR, a potem `/(^|[-/_])en([-/_]|$)/`. **Ten sam serwis
    zaimportowany przez konektor i przez plik WXR może sparować języki
    inaczej** - cicho, per strona. Przed tą gałęzią żadna z heurystyk nie miała
    ani jednego testu.
22. **Para wskazana w wierszu EN duplikuje stronę polską** zamiast scalić.
23. **`normalizeSlug` w impl B ma ten sam defekt transliteracji** co `slugify`
    (wpis 1) - liter z kreską nie przenosi.
24. **`wpImportFromWxr` nie ma ani rate limitu, ani wpisu w audycie**, choć impl A
    ma oba. Jeden synchroniczny handler przyjmuje do 200 stron po 5 MB HTML.

### Wzorce treści (1)

25. **Podsumowanie oznacza podmianę treści o tej samej długości** jako brak
    zmiany - redaktor nie widzi, że wzorzec nadpisze mu treść.

## 11. Progi per-ścieżka

| ścieżka                                                | zmierzone (instr./gał./fn/linie) | próg (instr./gał./fn/linie) |
| ------------------------------------------------------ | -------------------------------- | --------------------------- |
| `src/lib/content.functions.ts`                         | 99,83 / 99,58 / 100 / 100        | 97 / 95 / 98 / 98           |
| `src/components/builder/organisms/BuilderRenderer.tsx` | 99,52 / 97,02 / 100 / 100        | 97 / 93 / 98 / 98           |
| `src/lib/wp-import.functions.ts`                       | 100 / 99,44 / 100 / 100          | 97 / 95 / 98 / 98           |
| `src/lib/wp-import/**`                                 | 98,79 / 95,74 / 100 / 100        | 96 / 92 / 98 / 97           |
| `src/components/admin/blocks/edit/**`                  | 96,23 / 85,42 / 96,78 / 97,15    | 94 / 82 / 94 / 95           |
| `src/components/patterns/**`                           | 100 / 94,73 / 100 / 100          | 97 / 90 / 98 / 97           |

Reguła repozytorium: próg = zmierzone minus ~2-4 pp, z pomiarem w komentarzu.
Żaden istniejący próg nie został obniżony. Żaden plik nie został wykluczony
z pomiaru; `all: true` nietknięte.

Dwa progi mają w komentarzu zapisane **dlaczego są niższe, niż wyglądałoby na
pomiar**, żeby nikt ich nie „poprawił" w górę bez zrozumienia:

- `blocks/edit/**` gałęzie **82** przy zmierzonych 85,42% - wartości domyślne
  w tych edytorach są kodowane **dwoma idiomami naraz** (`x !== false` znaczy
  domyślnie WŁĄCZONE, `x === true` domyślnie WYŁĄCZONE), więc część ramion jest
  nieosiągalna dla danych, które panel realnie produkuje. To ograniczenie
  kształtu plików, nie brak pracy testowej.
- `patterns/**` gałęzie **90** przy 94,73% - ten sam mechanizm w mniejszej skali.

Progu dla `src/components/admin/blocks/**` jako całości **nie dopisałem**:
ścieżka stoi na 87,84% linii, a dwa pliki na 0% są w trakcie pokrywania, więc
próg wpisany teraz byłby przyrządem pokazującym liczbę, która za chwilę nie
będzie pomiarem - dokładnie to, przed czym ostrzega rozdz. 6.1 audytu.

## 12. Stan bramek

Zielone: `check:sql-tenant-scope`, `check:sql-owner-tenant-scope`,
`check:sql-policy-tenant-regression`, `check:sql-migration-replay`,
`check:sql-app-role`, `check:sql-anon-insert`, `check:sql-emit-actor`,
`check:i18n-parity`, `check:i18n-hardcoded`, `check:i18n-default-value`,
`check:i18n-overlay-imports`, `check:widget-fidelity`, `check:authz-snapshot`,
`check:permissions-parity`, `check:chunk-parity`, `check:content-layering`,
`check:unknown-casts`, `check:stale-never-casts`, `check:db-row-casts`,
`check:editor-autosave`, `check:public-assets`, `check:legacy-payment-refs`,
`check:entry-purity`, `check:ownership`, `check:codeowners`,
`check:tenant-isolation` (62 asercje), `check:pg-harness`,
`check:events-harness`, `check:careers-harness`, `check:programs-harness`.

pgTAP lokalnie: 94 plików OK, 6 z błędem - **wszystkie sześć to artefakty
sandboxa**, przewidziane przez komentarze samego runnera: locale `C` w `unaccent`
(2), brak rozszerzenia `pg_net` (2), modyfikator typu `extensions.vector`
z sed-owej atrapy pgvector (1), RLS na atrapie `storage.objects` (1). Żaden nie
dotyka `pages` ani mojego klucza obcego.

**Czerwone: `check:bundle`** - `overall` 4309,7 vs budżet 4306. Było czerwone
na czystym mainie (+3,4 KB); mój udział +0,3 KB. Floora nie podniosłem -
uzasadnienie w §2.

---

## 13. Czego świadomie NIE zrobiłem

1. **Nie podniosłem floora `check:bundle`**, mimo że bramka jest czerwona.
   Przekroczenie przyszło z dryfu maina i wymaga własnej zmiany z wpisem do
   kroniki - nie decyzji przemyconej w gałęzi o pokryciu testami.
2. **Nie podzieliłem `content.functions.ts`** - uzasadnienie w §6. Po tej gałęzi
   plik ma 99,58% gałęzi, więc podział jest teraz tani i bezpieczny dla
   następnego, kto go zechce zrobić.
3. **Nie zlazyfikowałem `timeline`, `logo-cloud`, `testimonial`** - wymaga
   najpierw wyciągnięcia ~236 linii inline z `SimpleWidgets` do własnych modułów,
   czyli refaktoru produkcyjnego o innym profilu ryzyka.
4. **Nie podzieliłem chunku edytora bloków** (184,8 KB, 62 edytory + TipTap
   eager) - uzasadnienie w §4: nie zmniejszy OVERALL, a wymaga granic Suspense
   tam, gdzie ich nie ma, w interakcji z przywracaniem focusu i karetki.
5. **Nie naprawiłem żadnego z 12 defektów** - wszystkie są zmianami zachowania
   produkcyjnego. Każdy ma `it.fails`, dowód wykrywania i notatkę, na czym
   naprawa polega.
6. **Nie dokończyłem podziału atomowego** `admin/blocks` (brak `organisms/`,
   16 plików luzem na górnym poziomie). Przenoszenie plików przy pokryciu tej
   powierzchni bliskim zera byłoby ruchem po ciemku - to jest ta sama zasada,
   z której wynika decyzja z §6, zastosowana konsekwentnie.
7. **Nie dodałem polityk zapisu** do `personality_result_history` - byłoby to
   rozszerzenie powierzchni produktu przemycone pod naprawą izolacji.
8. **Nie regenerowałem `routeTree.gen.ts`** - plik pokazuje się jako
   zmodyfikowany po każdym buildzie (4049 wstawień / 4049 usunięć, czysta
   zmiana kolejności generatora). Cofałem go za każdym razem, żeby nie zaśmiecać
   diffu 8 tysiącami linii bez znaczenia.

---

## 14. Nota o środowisku

`bun install --frozen-lockfile` kończy się 403 z prywatnego rejestru
(`europe-west*-npm.pkg.dev` zablokowany polityką sieci sandboxa). Użyte
obejście jest **sankcjonowane przez repozytorium** - `.gitignore` l. 59-64
opisuje je wprost: `npm install` z `registry.npmjs.org`. `package-lock.json`
jest gitignorowany, **`bun.lock` nietknięty**, `package.json` bez zmian,
zero nowych zależności. Dwa pakiety (`@testing-library/dom`, `jsdom`) doinstalowane
przez `--no-save` - są potrzebne testom, a `--legacy-peer-deps` je pomija.

`scripts/check-bundle-size.ts` wymaga runtime **bun** (`Bun.gzipSync`), więc
pomiar bramki uruchamiany jest przez `bun run`, przy buildzie z `npm run build`.

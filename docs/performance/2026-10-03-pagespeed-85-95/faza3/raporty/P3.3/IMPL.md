# P3.3 (fala 3) - `content-visibility` sekcji buildera - IMPL

- worktree: `scratchpad/wt3/P3.3`, gałąź `perf/w3-P3.3`, baza `d22cf7d6`
- commit: `cf0cf8a5`
- status: done - implementacja, bramki szybkie i e2e zielone; pomiar Lighthouse / księga --compare zostaje etapowi Prove

## Zmiany per plik

### `src/components/builder/organisms/BuilderRenderer.tsx` (+~360 / -~20)

- Blok komentarza `// ── CONTENT-VISIBILITY SEKCJI (P3.3)` (po co, dlaczego opakowanie i tylko „ogon",
  kto liczy, gdzie, przywrócenie przewinięcia i kotwica przy wejściu, wyłączenia sekcji, druk,
  blok cv w HTML-u).
- Pomocnicze (część serwerowa znika z bundla klienta za `isServerRender()`):
  - `CV_FIRST_SECTION_INDEX = 2`, `CV_MIN_RUN_PX = 2600`, `CV_SAFE_WIDGET_TYPES` (lista
    dozwolonych typów widgetów), `cvBlockedBy`, `fixedAttachment`, `cvSafeColumn`,
    `serverSectionCv` (szacunek z `estimateSectionHeight` albo `undefined`), `planServerCv`
    (ciągły ogon od końca listy, łącznie >= 2600 px, inaczej `null`);
  - `readServerCvPlan(rootId)` - hydratacja czyta plan z opakowań serwera
    (`[data-lcp-root="<id>"] > [data-cv]`, `dataset.cv` = px, `dataset.cvI` = indeks
    w dokumencie);
  - `CV_CSS` (`@media print` + wyłącznik `[data-cv-off]`), `CV_GUARD_SCRIPT` (strażnik wejścia
    w połowie strony), `CV_BLOCK_HTML`, `CvBlock` (`memo`, ukryty `<div>` z
    `dangerouslySetInnerHTML` - treść tylko z serwera, klient pusty `__html` +
    `suppressHydrationWarning`).
- `BuilderRenderer`: inicjalizator stanu właściciela LCP (`ownedLcp`) dostaje pole `cv` -
  na serwerze `null` (plan liczy `SectionsList`), przy hydratacji `readServerCvPlan`; plan
  przechodzi do `SectionsList` tylko dla tego samego dokumentu (`ownsDoc`). Warunek ma postać
  `isServerRender() || !isLcpOwner` - `isServerRender()` NA POCZĄTKU, bo tylko tak Rollup go
  zwija w buildzie klienta (niżej: odzysk bajtów).
- `SectionsList`: nowe propsy `lcpIds` (czyta tylko serwer) i `serverCvPlan`; `cvPlan` =
  serwer: `islands && lcpIds ? planServerCv(visible, lcpIds) : null` (wyspy = te same warunki
  renderera co P2.2, `lcpIds` = renderer treści z HTML-em serwera); klient: plan z HTML-u
  serwera bez ponownego sprawdzania warunków (opakowania są tylko tam, gdzie serwer je dał).
  `CvBlock` przed sekcjami, a wpis sekcji z planu jest owinięty
  w `<div data-cv data-cv-i style="content-visibility:auto;contain-intrinsic-size:auto Npx">`
  NA ZEWNĄTRZ `StreamingSection` (szkielet strumienia też jest w środku elementu z cv).
  `RenderSection`/`IslandSectionContent` bez zmian.

### `src/components/builder/organisms/__tests__/builderRenderer.contentVisibility.test.tsx` (nowy, 39 testów)

SSR (plan s2..s4 948 px, `data-cv`/`data-cv-i`, blok przed sekcjami), strażnik (pierwsze wejście
nie, wpis przywrócenia `scrollY>0` tak, `scrollY 0`/inny klucz nie, fragment tak, zepsuty JSON nie;
klucz = `storageKey` z `@tanstack/router-core`), szacunek z klampem 1200, krótki ogon (<2600) bez
cv i bez bloku, ciągłość ogona (sekcja z `htmlId` w środku), próg po indeksie W DOKUMENCIE (sekcja
ukryta dostępem), parzystość hydratacji (także wyspy z sesją, rerender nie czyści bloku),
hydratacja czyta plan z HTML-u serwera (podmieniony 999 px), sekcja odsłonięta po hydratacji bez
opakowania, render czysto kliencki bez cv, ta sama instancja z nowym dokumentem bez cv, wyłączenia
renderera (bez `lcpOwner`, bez `stream`, chrome, `editorPreview`, `BuilderModeProvider`, kontekst
wpisu, dokument ze spisem treści; strona CMS ma cv), wyłączenia sekcji (wideo, wyszukiwarka,
`htmlId` sekcji/kolumny/widgetu/sekcji wewnętrznej, klasa `sticky`, dowolna klasa autora `-mt-12`,
CSS `fixed`, tło `fixed`, cień, `marginTop`, `stretch`, `globalId`, kandydat LCP; obraz spoza
kandydatów zostaje). Mutacje sprawdzone: klient przeliczający plan, `break`->`continue`, próg 0 -
testy łapią.

### `e2e/content-visibility.boot-home.spec.ts` (nowy, 11 testów; jedzie w `test:e2e:artifact`)

Na telefonie 412x823 i desktopie 1350x940 (`locale: pl-PL`):

1. HTML serwera: sekcje 0-1 bez cv, >= 3 opakowania z `auto`, sekcje w widoku wyrenderowane
   (`checkVisibility({contentVisibilityAuto:true})`), na telefonie część naprawdę pominięta.
2. Przewinięcie kółkiem do końca: zero `layout-shift` po fazie kurczenia nagłówka, zero wpisów
   ze źródłem w obszarze cv (opakowania i wszystko za pierwszym z nich) przez cały przebieg, także
   przy wczytaniu; wpisy przy wczytaniu przed obszarem cv idą do adnotacji `load-shifts`.
3. Kotwica `#id` w dalszej sekcji (nagłówek formularza „Dołącz", za >= 2 sekcjami z cv): po
   wczytaniu (`location.hash`, cv włączone) cel tuż pod nagłówkiem; przewinięcie kółkiem w górę
   o 300 px przesuwa cel o 300 px +- 2 (zakotwiczenie przewijania koryguje `scrollY`); wejście
   z `/#id` - strażnik (`html[data-cv-off]`), sekcja `visible`, cel trafiony.
4. Przeładowanie w połowie strony: strażnik włączony, sekcja odniesienia wraca na pozycję +- 40 px
   (baza: desktop 0 px, telefon 26 px).
5. Powrót „wstecz" po nawigacji SPA (`__TSR_ROUTER__.navigate('/regulamin')`): render kliencki,
   zero opakowań i zero `auto`.
   Plus druk (`emulateMedia print`): wszystkie opakowania `visible`.

## Mechanizm (skrót)

Serwer liczy plan: ciągły ogon sekcji od indeksu 2 w dokumencie, każda sekcja z bezpiecznych
widgetów i bez wyłączeń, łączny szacunek >= 2600 px. Każda sekcja z planu dostaje opakowanie
z `content-visibility: auto` + `contain-intrinsic-size: auto <estimateSectionHeight>px` (ta sama
liczba co `minHeight` szkieletu strumienia). Przed sekcjami: ukryty blok z regułą druku,
wyłącznikiem `[data-cv-off]` i strażnikiem, który przy wpisie przywrócenia przewinięcia TanStacka
(`scrollY > 0`) albo fragmencie w adresie ustawia `html[data-cv-off]` zanim parser dojdzie do
sekcji. Klient przy hydratacji czyta plan z opakowań serwera (te same bajty), render czysto
kliencki nie dostaje cv. Zysk: przeglądarka pomija styl/układ/malowanie sekcji poza ~1,5 ekranu od
widoku w zadaniu pierwszej klatki i w kolejnych przeliczeniach podczas hydratacji.

## Pomiary (artefakt `build:smoke` + fixture, Chromium 141; `exp/ffmetrics.cjs`, n=10 na wariant)

Pomiary trace i diagnozy pochodzą z build7. Runda odzysku bajtów zmienia wyłącznie kod klienta
(odczyt planu, kolejność warunku); HTML serwera ma tę samą długość (`htmlRawBytes` 338758 B
w build7 i build8; różnią się tylko nazwy chunków), więc geometria i pierwsza klatka są te same.
e2e po rundzie odzysku - w tabeli bramek.

Trace `devtools.timeline` 2,5 s od nawigacji, mediany (telefon z CPU x4):

| metryka                           | telefon baza | telefon P3.3 | desktop baza | desktop P3.3 |
| --------------------------------- | -----------: | -----------: | -----------: | -----------: |
| najdłuższy `Layout` (ms)          |         68,9 |  36,1 (-48%) |         26,0 |  12,4 (-52%) |
| suma `Layout` (ms)                |        174,6 | 107,8 (-38%) |         35,3 |         34,7 |
| suma `UpdateLayoutTree` (ms)      |        589,5 | 393,3 (-33%) |         85,5 |   77,9 (-9%) |
| obiekty pierwszego pełnego układu |            - |            - |          653 |          347 |
| FCP (ms, lokalnie)                |          398 |          392 |          230 |          207 |

CLS w tym samym przebiegu: desktop 0 we wszystkich 20 próbach; telefon - wpis 0,18-0,36
z sekcji 0 w 3/10 próbach bazy i 3/10 P3.3 (problem bazy, niżej), poza tym 0 (baza ma dodatkowo
2x 0,0009 z nagłówka).

E2E przewinięcia x10 na wariant (B i baza, ten sam spec): 20/20 zielone w obu; wpisy przy
wczytaniu wyłącznie przed obszarem cv: B 2/10 telefon (sekcja 0, 0,18-0,21), baza 1/10 telefon
(sekcja 0, 0,42) + 1/10 desktop (`#text`, 0,00009).

Kotwica po wczytaniu (diagnoza x6 na wariant, cv włączone): na telefonie przeglądarka najpierw
przewija na pozycję liczoną z pasami (y=3911), po ~100 ms - gdy sekcje wokół celu się dorysują -
na 5181, a kurczenie nagłówka i korekty zakotwiczenia kończą się po ~0,7-1,1 s (y=5152). Wpisy
`layout-shift` po skoku pochodzą wyłącznie z kurczenia nagłówka (`main`/`footer`, 0,003-0,018
każdy; problem bazy 2). Po ustaniu przewinięcie kółkiem w górę o 300 px przesuwa cel o 300,0 px
w 12/12 próbach. Pierwsza wersja testu mierzyła w trakcie animacji nagłówka (porażki 3/10
desktop, 1/10 telefon) - test czeka teraz na stabilne `scrollY` i nagłówek (`settle`).

Eksperymenty Chromium (strony syntetyczne, `exp/`): druk pominiętych sekcji (PDF), nawigacja do
fragmentu i `scrollIntoView` aktywują pominiętą sekcję, zakotwiczenie przewijania trzyma cel; element
z cv w widoku przy PIERWSZYM układzie jest układany najpierw jako pas z szacunku - przesunięcie
liczone jest elementom BEZ cv za nim (0,0094 na desktopie fixture: szkielet sekcji pod sekcją z cv
468 px / 24 px), stąd opakowanie wokół granicy strumienia i ciągły ogon.

## Odzysk bajtów bootu (runda wznowienia, prośba orkiestratora)

Pierwsza wersja (build7) dokładała do domknięcia bootu +624 B raw / +314 B gzip. Sprawdzone na
bundlu klienta (`.output/public/assets/index-*.js`, nie z założeń):

- Część serwerowa NAPRAWDĘ wypada z bundla klienta: brak `CV_SAFE_WIDGET_TYPES`,
  `planServerCv`, `serverSectionCv`, `CV_CSS`, `CV_GUARD_SCRIPT` (`data-cv-off`,
  `tsr-scroll-restoration-v1_3` - 0 trafień we wszystkich chunkach klienta; jest tylko
  w `server/_ssr/router-*.mjs`), `CvBlock` ma `__html:""`. Rollup zwija `isServerRender()`,
  gdy wywołanie jest testem warunku albo LEWĄ stroną `||`/`&&` (`isServer` z warunku
  `browser` = `false`), więc `import.meta.env.SSR` nie był potrzebny.
- Uwaga orkiestratora („`isServer` nie jest stałą w buildzie klienta") trafiła jednak w jedno
  miejsce: `cv: !isLcpOwner || isServerRender() ? ...` - przy nieznanej lewej stronie
  Rollup nie zwija wyrażenia, więc w bundlu zostało `cv:!b||Vj()?null:f4(y)` razem z całą
  funkcją `function Vj(){return Ca}` (na bazie fali `isServerRender` znika z bundla klienta
  całkowicie). Poprawka: `isServerRender() || !isLcpOwner` -> klient `cv:b?m4(y):null`,
  funkcji brak (komentarz KTO LICZY opisuje tę zasadę).
- Krótsza ścieżka klienta w `SectionsList`: `x=!b||c===null?null:u` -> `x=u` (warunki wysp
  i nośnika sprawdza tylko serwer; klient bierze plan z opakowań serwera tego samego
  dokumentu).
- `readServerCvPlan`: `el.dataset.cvI`/`el.dataset.cv` zamiast `getAttribute("data-cv-…")`.

Wynik (build8, `check:document-weight`, mediany 5 próbek, vs baza fali `63a05a32`):

| metryka                                 |       baza |     build7 | build8 (commit) |           delta build8 |   zapas do progu |
| --------------------------------------- | ---------: | ---------: | --------------: | ---------------------: | ---------------: |
| `bootClosureRawBytes`                   |    1636946 |    1637570 |         1637496 | **+550 B** (było +624) | 262 B (było 188) |
| `bootClosureGzipBytes`                  |     496041 |     496355 |          496288 | **+247 B** (było +314) |            391 B |
| `bootBurstGzipBytes`                    |     574062 |     574386 |          574299 | **+237 B** (było +324) |            374 B |
| `htmlRawBytes`                          |     337696 |     338758 |          338758 |                +1062 B |                - |
| `htmlGzipBytes`                         |      52542 |      52901 |           52894 |                 +352 B |           4,8 KB |
| `preLcpTransferBytes`                   |     177700 |     178059 |          178052 |                 +352 B |           3,5 KB |
| `inlineStyleCount` / `inlineStyleBytes` | 25 / 84717 | 26 / 84846 |      26 / 84846 |            +1 / +129 B |                - |
| `inlineScriptBytes` (wykonywalne)       |      79373 |      79614 |           79614 |                 +241 B |                - |

Co zostało w kliencie (+550 B raw): odczyt planu z DOM-u (`readServerCvPlan`), węzeł bloku cv
(`CvBlock`, `memo` z pustym `__html` - parzystość i ochrona treści serwera), opakowanie sekcji
ze stylem inline i przekazanie planu propsami. Dalsze cięcie (np. `CvBlock` bez `memo`
ze stałym obiektem `__html`) dawało w symulacji na chunku -37 B raw / -6 B gzip kosztem
kruchości (nowy obiekt w renderze czyści blok serwera) - odrzucone.

## Bramki

| bramka                                                                                                          | wynik                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `vitest` nowego pliku                                                                                           | 39/39 (po rundzie odzysku)                                                                           |
| `vitest src/components/builder/organisms/__tests__/ src/lib/builder/aboveFold src/lib/builder/sectionStreaming` | 20 plików, 367 passed + 3 expected fail, zielone (po rundzie odzysku)                                |
| `vitest src/components/builder src/lib/builder src/lib/performance` (pierwsza runda)                            | 193 pliki, 3632 passed (+48 expected fail), zielone                                                  |
| typecheck (`typecheck-noinc.sh`: tsgo + scripts + e2e)                                                          | zielony (runda odzysku, kod commitu)                                                                 |
| `build:smoke` (`BUNDLE_INVENTORY=1`, build8)                                                                    | zielony                                                                                              |
| `check:document-weight`                                                                                         | zielony; delty i zapasy w tabeli wyżej                                                               |
| `check:bundle`                                                                                                  | zielony (overall 4753,7/4772 KB, public CSS 81,2/83 KB)                                              |
| `check:chunks`, `check:entry-purity`, `check:server-entry-purity`                                               | zielone (build8)                                                                                     |
| `verify:static`                                                                                                 | zielony: 15 bramek (w tym `format:check`, `check:dangerous-html`, bramki SQL) w 263,6 s              |
| prettier / eslint plików pozycji                                                                                | zielone                                                                                              |
| `test:e2e:artifact` (CI-like env, `NES_ARTIFACT_FIXTURE=1`, pełny)                                              | 23/23 zielone (12 dotychczasowych + 11 nowych), build8, `r8/e2e.log`                                 |
| spec cv `--repeat-each 3`                                                                                       | 33/33 (build8)                                                                                       |
| kotwica `--repeat-each 10`                                                                                      | 20/20 (build8; wersja testu sprzed `settle` miała 4/20 porażek - pomiar w trakcie animacji nagłówka) |
| przewinięcie `--repeat-each 10` (B i baza, build7)                                                              | 20/20 i 20/20                                                                                        |

## Odstępstwa od karty pozycji

1. **Opakowanie zamiast stylu na sekcji.** cv siedzi na `<div data-cv>` wokół `StreamingSection`,
   nie na `<section>`: zmierzone przesunięcie szkieletu strumienia (0,0094) za sekcją z cv w widoku
   przy pierwszym układzie. W rendererze za elementem z cv stoi wyłącznie element z cv.
2. **Tylko ciągły ogon i próg 2600 px** (`CV_MIN_RUN_PX`) zamiast „każda sekcja od indeksu 2":
   sekcja bez cv w środku przerywa ogon (wszystko przed nią bez cv), krótki ogon nie dostaje cv -
   treść za rendererem leży wtedy pod zgięciem w obu przebiegach układu.
3. **Kotwica `location.hash`**: zamiast wykluczać sekcję-cel (cel nie jest znany na serwerze),
   strażnik zdejmuje cv z całej strony przy wejściu z fragmentem albo z wpisem przywrócenia
   przewinięcia; sekcje z autorską kotwicą (`advanced.htmlId` gdziekolwiek w sekcji) są wykluczone.
   Kotwica po wczytaniu działa przy włączonym cv (e2e 3).
4. **Wykluczenia szersze niż w karcie**: lista DOZWOLONYCH typów widgetów (nowy typ = bez cv), klasa
   autora sekcji, cień, `stretch`, pionowe marginesy, tło/nakładka `fixed`, `fixed`/`sticky`
   w klasie/CSS węzłów, `globalId`, kandydat LCP. Dokumenty ze spisem treści, treść wpisu, kanwa,
   podgląd, chrome - bez cv (warunki wysp P2.2 + `lcpIds !== null`).
5. **Render czysto kliencki bez cv** (nawigacja SPA, powrót „wstecz", sekcja odsłonięta po
   hydratacji): plan pochodzi tylko z HTML-u serwera; parzystość SSR/hydratacji zachowana bajt
   w bajt.
6. **Druk**: reguła `@media print` w bloku (Chromium i tak drukuje pominięte sekcje).
7. `src/lib/builder/sectionStreaming.tsx` nietknięty - szacunek importowany z
   `@/lib/builder/sectionHeightEstimate` (już eksportowany).
8. **E2E przewinięcia**: „zero przy wczytaniu" ograniczone do obszaru cv - baza bez P3.3 też ma
   pojedyncze wpisy przy wczytaniu w nagłówku i sekcji 0 (niżej).

## Problemy bazy znalezione po drodze (poza zakresem P3.3)

1. **CLS telefonu z sekcji 0 (0,18-0,42) w ~1/3 wczytań przy CPU x4, także na bazie.** Źródło:
   `div.min-w-0.max-w-full.overflow-hidden` (lista wpisów w kolumnie `order.mobile = 2`) maluje się
   na y=107, potem skacze na y=539, gdy pojawia się kolumna slidera (`order.mobile = 1`, w DOM-ie
   ZA nią). Hipoteza: malowanie częściowo sparsowanego strumienia HTML (kolumny w kolejności DOM
   odwrotnej do `order`). Groźne dla kryterium CLS etapu Prove niezależnie od P3.3.
2. Nagłówek `sticky-shrink` daje 4 (telefon) / 7 (desktop) wpisów `layout-shift` ~0,004 przy
   pierwszym przewinięciu (także po skoku do kotwicy: 3-5 wpisów 0,003-0,018 ze źródłem
   `main`/`footer`).
3. Powrót „wstecz" w SPA na fixture nie trafia w zapisaną pozycję (router przywraca przed
   wyrenderowaniem treści; zmierzone y ~505); link do wpisu nie kończy nawigacji na fixture.
4. Wejście z `/#id` na bazie daje przesunięcie przy wczytaniu ~0,09.
5. `aria-label` szkieletu strumienia (`builder.sectionLoading`) na stronie publicznej jest surowym
   kluczem (słownik builder nie jest ładowany publicznie).

## Ryzyka

- **Zapas domknięcia bootu**: po odzysku `bootClosureRawBytes` ma 262 B do progu (gzip 391 B,
  seria bootu 374 B) - scalenie z innymi pozycjami dokładającymi JS do bootu (P3.6b, P3.8,
  linki prawne) może zapalić bramkę; P3.3 dokłada +550 B raw / +247 B gzip.
- Szacunek wysokości (klamra 280-1200 px + 48) wpływa na długość paska przewijania i skoki przy
  przeskoku przez pominięte sekcje. Chromium kompensuje zakotwiczeniem; **Safari nie ma
  zakotwiczenia przewijania** - przeskok (kotwica po wczytaniu, przeciągnięcie paska) i powrót
  w górę może tam przesunąć treść o różnicę szacunku. Firefox >= 125 i Safari >= 18 wspierają cv.
- Strażnik czyta prywatny format TanStacka (`tsr-scroll-restoration-v1_3`, `__TSR_key`) - test
  jednostkowy przypina klucz do `storageKey` z `@tanstack/router-core`; aktualizacja routera ze
  zmianą formatu wyłączy strażnika (cv zostanie przy przeładowaniu).
- Próg 2600 px i indeks 2 to heurystyka; desktop zyskuje głównie na najdłuższym układzie, nie na
  sumie.
- Nowe typy widgetów nie dostają cv, dopóki ktoś nie dopisze ich do `CV_SAFE_WIDGET_TYPES`.

## Na co patrzeć w review

- Parzystość: `planServerCv` tylko na serwerze, `readServerCvPlan` tylko przy hydratacji; selektor
  `> [data-cv]` bezpośrednio pod `data-lcp-root`; `ownsDoc` przy zmianie dokumentu.
- `CvBlock`: `memo` bez propsów + `suppressHydrationWarning` + literalne stałe (bramka
  `check:dangerous-html`); treść serwera nie może zostać przepisana pustym `__html`.
- Kompletność wyłączeń (`serverSectionCv`, `CV_SAFE_WIDGET_TYPES`) - zwłaszcza widgety, które
  mogą renderować `position: fixed` bez portalu albo wylewać się poza sekcję.
- Strażnik: warunki (`hash.length > 1`, `scrollY > 0`) i kolejność (blok przed sekcjami).

## Dla etapu Prove

- LH (pierwsze wejście, bez fragmentu i wpisu przywrócenia) dostaje cv. Spodziewany efekt głównie
  na telefonie: krótsze Style/Layout pierwszej klatki i hydratacji (lokalnie -33/-38% sum,
  -48% najdłuższego układu); na desktopie najdłuższy układ -52%.
- CLS: P3.3 nie dodaje wpisów w obszarze cv (e2e x10); wpis z sekcji 0 na telefonie (problem 1)
  istnieje na bazie i może zaszumić kryterium „10/10".

## Prośba właściciela przekazana w zadaniu

„jeden font - ma to byc red hat display" - to pozycja P3.2b (commit bazy `d22cf7d6`), poza listą
plików P3.3; nic w tej pozycji nie dotyka fontów.

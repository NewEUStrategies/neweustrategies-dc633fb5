# P3.2b (fala 3): runda poprawek 9, raport wdrożenia

Gałąź `perf/w3-P3.2b`, worktree `$SCRATCH/wt3/P3.2b`, baza `d5bd11fb`, poprzedni commit `46e09026`, nowy commit
`162c01b2` (bez przepisywania historii). `$SCRATCH` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad`,
`$F` = `$SCRATCH/phase3/wave3/P3.2b/fix9` (skrypty, logi, zminifikowany blok).

## 0. Ustalenie z Prove i odpowiedź

Ustalenie blokujące (PROVE.md §4.4, §6, §7): desktop4x FCP +0,08 s, bo pierwszy Layout `/` rośnie mniej więcej
dwukrotnie (11 → 24 ms). Przyczyna: twarz `latin-ext` w segmentowanej rodzinie „Red Hat Display”, której strona
PL/EN nigdy nie pobiera. Prove zaproponował dwa lekarstwa: (1) usunąć latin-ext (B12; wymaga decyzji właściciela, bo
czeskie, rumuńskie, węgierskie itp. diakrytyki byłyby rysowane Arialem), (2) przenieść latin-ext poza rodzinę RHD
(wariant nietestowany).

**Wdrożyłem wariant (2) w postaci, która nie wymaga zmiany żadnego stosu rodzin.** latin-ext jest teraz twarzą
istniejącej rodziny `"Red Hat Display Fallback"`. Ta rodzina stoi już w każdym stosie z krojem zastępczym, zaraz po
RHD. Nowa nazwa rodziny wymagałaby zmian w około 20 stosach w plikach spoza mojej listy. Rodzina „Red Hat Display”
ma teraz jedną twarz, jak w B12. Znaki latin-ext nadal rysuje Red Hat Display. Nie trzeba więc decyzji
produktowej, a zasada „jeden font” obowiązuje bez zmian: jeden preload, jedno żądanie na PL i EN.

Dlaczego to działa (zgodnie z pomiarem §2): Chrome składa twarze rodziny o identycznych deskryptorach w jeden font
segmentowany. Rodzinę zastępczą otwiera dopiero dla znaku, którego nie ma plik główny, albo zanim plik główny się
pobierze. Przy załadowanym pliku głównym (preload) pierwszy Layout nie widzi więc niepobranej twarzy.

## 1. Co zmieniono (plik po pliku)

| Plik                                                            | Zmiana                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles.css` (tylko blok `@font-face` RHD + krój zastępczy) | (a) Usunięta twarz `latin-ext` z rodziny „Red Hat Display”, więc rodzina ma jedną twarz (plik główny). (b) Sześć nowych twarzy `"Red Hat Display Fallback"` z `src: url(latin-ext.woff2)`, `font-display: swap`, po jednej na każdy zakres wag twarzy lokalnej (`1 449`, `450 549`, `550 649`, `650 749`, `750 849`, `850 1000`). Każda ma identyczne `font-style`/`font-weight` jak twarz lokalna, więc przeglądarka składa je w jeden font segmentowany. Zadeklarowane PO twarzach lokalnych, bo przy nakładających się zakresach wygrywa reguła ostatnia (B14 w §2 pokazuje, że odwrotna kolejność oddaje znaki Arialowi). (c) `unicode-range` latin-ext = **cmap latin-ext minus cmap pliku głównego**: `U+0100-0103, U+0108-0117, U+011A-0130, U+0132-013E, U+0145-0148, U+014A-0151, U+0154-0159, U+015C-0178, U+017D-017E, U+0218-021B, U+0237, U+02C7, U+02DD, U+1E80-1E85, U+1E9E, U+1EF2-1EF3`. Dawny zakres Google obejmował U+0304/U+0308 (są w pliku głównym; zanim plik główny się pobierze, uruchomiłyby pobranie latin-ext) i bloki bez glifów w pliku (U+1D00-1DBF, U+20A0-20C0, U+A720-A7FF…, puste pobrania). Krótszy zakres to też mniej bajtów arkusza ×6. (d) Komentarze: nagłówek bloku (jedna twarz w rodzinie RHD, odsyłacz) i nowy akapit nad twarzami latin-ext (mechanizm, liczby, kolejność, deskryptory, wagi < 400); w akapicie „ROZJAZD STOSÓW Z CMS” zdanie o latin-ext. Twarze lokalne i ich wartości bez zmian. |
| `src/lib/ci/__tests__/fontGlyphCoverage.test.ts`                | Podział rodziny zastępczej na `localFaces` (metryka per waga) i `extFaces` (latin-ext). Zamiast „dokładnie dwie twarze RHD, główna po latin-ext” są teraz testy: „rodzina RHD ma JEDNĄ twarz: plik główny” oraz „twarz główna: swap, 400 900”. Nowa grupa „latin-ext jako twarz rodziny zastępczej”: jedna twarz latin-ext na każdą twarz lokalną z identycznymi deskryptorami, każda zadeklarowana PO swojej twarzy lokalnej, swap + sam plik latin-ext + ten sam `unicode-range`. Nowy test zakresu: „zakres latin-ext = dokładnie znaki pliku latin-ext, których nie ma plik główny”. Testy metryki kroju zastępczego liczone na `localFaces`. L8 (U+0102 → latin-ext) bez zmian. Razem 21 testów (było 17).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `e2e/single-font.boot-home.spec.ts`                             | Krok 3 sprawdza teraz, że rodzina „Red Hat Display” ma w przeglądarce dokładnie jedną twarz i jest ona załadowana (`["loaded"]`). Dawny test liczył tylko załadowane twarze, więc niepobranej twarzy, która spowodowała regresję, nie widział. Nowy krok 4 (po sprawdzeniu, że strona sama pobrała tylko plik główny): sonda `Babiš` w stosie strony dociąga dokładnie plik `red-hat-display-latin-ext-*.woff2`. Pilnuje, że nikt nie „naprawi” Layoutu usunięciem latin-ext (B12). Nagłówek pliku zaktualizowany.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Bez zmian: `__root.tsx`, `fontPreload.ts`, `rootHead.ts`, `themeDesign.ts`, `documentWeight.ts`, progi, pliki fontów
(`red-hat-display-latin-ext.woff2` bajt w bajt ten sam). Komentarze w `fontPreload.ts:10-11` i `__root.tsx:36-37`
(„latin-ext zostaje w styles.css jako twarz bez preloadu”) pozostają prawdziwe, więc ich nie ruszałem (mniej
konfliktów przy scalaniu z P3.8).

## 2. Dowód mechanizmu przed commitem (bez buildu: build Prove `46e09026` + podmiana bloku)

Skrypt: `$F/layout-exp/layout.exp.ts` (na bazie `prove-tools/layout-exp/layout.exp.ts` Prove; własna konfiguracja,
serwer artefaktu z `.output` worktree, fixture backendu, podmiana arkusza przez `page.route`). Wariant **BF** to
DOKŁADNY blok z worktree po poprawce, zminifikowany lightningcss z repo jak w buildzie (`$F/minblock.mjs` →
`$F/final-block.css`, 13 reguł, 4308 B). Wszystkie przebiegi przez mutex (`heavy-bg.sh`).

### 2.1 Pierwszy Layout (> 300 brudnych obiektów), mediany

| Wariant                                                     | desktop 1350×940 (9 przebiegów) | Layout łącznie | mobile 412×823 @1,75 (7) | Layout łącznie |
| ----------------------------------------------------------- | ------------------------------- | -------------- | ------------------------ | -------------- |
| B0 kandydat `46e09026` (latin-ext w rodzinie RHD)           | 25,5 ms                         | 51,1 ms        | 20,0 ms                  | 39,3 ms        |
| B12 bez twarzy latin-ext (lekarstwo 1 Prove)                | 11,0 ms                         | 24,7 ms        | 7,0 ms                   | 21,1 ms        |
| **BF poprawka (latin-ext w rodzinie zastępczej)**           | **11,4 ms**                     | **26,3 ms**    | **7,6 ms**               | **21,6 ms**    |
| B13 (wcześniejsza próba: zakres Google, twarze przeplatane) | 11,0 ms                         | 25,8 ms        | —                        | —              |

Baza Prove (A0): 10,6–12,1 ms / 25–31 ms (desktop). Logi: `$F/layout-B.log`, `$F/layout-BF.log`,
`$F/layout-BF-mobile.log`. Pobrania woff2 na `/` we wszystkich wariantach: tylko `red-hat-display-latin-pl-*.woff2`.
Zostaje ok. 0,4–0,6 ms różnicy BF wobec B12. Prawdopodobnie to fixture: symbol `→` spoza rodziny otwiera rodzinę
zastępczą dla kilku opisów fontu. Na produkcji takich znaków nie ma (IMPL §2: `cover.py`). Wynik mieści się w
rozrzucie bazy.

### 2.2 Poprawność glifów (`MODE=glyphs`, sonda „Babiš Vučić Šimonytė Ăă Őő Ůů Ţţ”, 40 px, stos strony)

| Wariant                       | latin-ext pobrany na żądanie | szerokość [px] w wagach 300 / 400 / 500 / 600 / 700 / 800 / 900  | twarze rodziny RHD |
| ----------------------------- | ---------------------------- | ---------------------------------------------------------------- | ------------------ |
| B0                            | tak                          | 605,92 / 605,92 / 612,92 / 621,69 / 631,36 / 643,58 / 657,97     | 2                  |
| B12                           | **nie** (Arial)              | 600,66 / 600,66 / 608,63 / 609,92 / 620,84 / 640,52 / 651,20     | 1                  |
| B14 (latin-ext PRZED lokalną) | **nie** (Arial)              | jak B12                                                          | 1                  |
| **BF**                        | **tak**                      | **598,77** / 605,92 / 612,92 / 621,69 / 631,36 / 643,58 / 657,97 | **1**              |

W wagach 400–900 BF ma glify identyczne z kandydatem (RHD). Waga 300: odstępstwo 2 w §4. Logi: `$F/glyphs.log`,
`$F/glyphs-BF.log`.

### 2.3 Kroki 2–4 nowego `single-font` na buildzie z podmienionym blokiem (`MODE=e2echeck`)

| Wariant | ścieżka    | krok 2 (woff2 po hydratacji) | krok 3 (twarze rodziny RHD) | krok 4 (po sondzie `Babiš`) |
| ------- | ---------- | ---------------------------- | --------------------------- | --------------------------- |
| B0      | `/`, `/en` | tylko latin-pl               | `[unloaded, loaded]` ✘      | latin-ext ✓                 |
| **BF**  | `/`, `/en` | tylko latin-pl ✓             | `[loaded]` ✓                | latin-ext ✓                 |

Spec po zmianie odrzuca kandydata `46e09026` (kontrola negatywna) i przyjmuje poprawkę (`$F/e2echeck.log`). Samego
pliku spec na buildzie nie uruchamiałem (zakaz buildu w tym etapie), więc zostaje dla Prove.

### 2.4 Bajty arkusza (KRYTYKA L2)

Podmiana bloku w `styles-Cmi5-oJ7.css` builda B (`$F/cssbytes3.mjs`). Bramka `check:bundle` liczy gzip w Bun.

|                         | raw      | gzip (Bun, jak `check:bundle`) | gzip (node) |
| ----------------------- | -------- | ------------------------------ | ----------- |
| BF wobec B (`46e09026`) | +1 628 B | **+69 B**                      | +62 B       |
| B13 z zakresem Google   | +2 108 B | +138 B                         | +130 B      |
| B12 (dla porównania)    | −411 B   | −161 B                         | −157 B      |

Suma CSS B wg Bun: 97 981 B (95,68 KB; Prove: 95,7/96). Po poprawce ok. **98 050 B = 95,75 KB z progu 96 KB**
(zostaje ok. 254 B). `renderBlockingCssGzipBytes` (próg 81 399): B 80 703 → ok. 80 765–80 772. Domknięcie bootu bez
zmian (sam CSS).

## 3. Bramki uruchomione

| Bramka                                                                                                                       | Wynik                                                               | Log                    |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| `bunx prettier --write` / `--check` (3 pliki)                                                                                | zielone                                                             | —                      |
| `light.sh bunx eslint` (2 pliki TS)                                                                                          | 0 problemów                                                         | —                      |
| typecheck (`heavy-bg.sh … typecheck-noinc.sh`: `tsgo --noEmit`, `tsc -p tsconfig.scripts.json`, `tsgo -p tsconfig.e2e.json`) | zielony (exit 0, bez komunikatów)                                   | `$F/typecheck.log`     |
| `light.sh bunx vitest run` `fontGlyphCoverage`, `fontPreload`, `rootHead`, `themeDesignFontStack`                            | **50 zielonych + 1 expected fail** (istniejący `it.fails`)          | `$F/vitest.log`        |
| kontrola negatywna `fontGlyphCoverage` na dawnym `styles.css` (`46e09026`)                                                   | **5/21 czerwonych** (jedna twarz RHD, twarze latin-ext, zakres, L8) | `$F/neg-oldcss.log`    |
| `light.sh bun run verify:static`                                                                                             | **15 bramek zielonych** (format:check, SQL, kontrakt TS↔SQL, …)     | `$F/verify-static.log` |
| eksperymenty Playwright (§2) przez mutex                                                                                     | zielone                                                             | `$F/*.log`             |
| build, `check:bundle`, `check:document-weight`, `test:e2e:artifact`, `font-swap-cls`, Lighthouse                             | **nie uruchamiane** (zakaz buildu w tym etapie)                     | dla Prove, §6          |

## 4. Odstępstwa (z uzasadnieniem)

1. **Wariant lekarstwa:** Prove wolał (1) „usuń latin-ext”. Wybrałem (2) w postaci „latin-ext w istniejącej rodzinie
   zastępczej”, bo daje ten sam Layout (§2.1: 11,4 wobec 11,0 ms) bez kosztu produktowego, którego (1) nie mógł
   uniknąć (§2.2: B12 rysuje š, č, ő, ă, ė Arialem) i który wymagał decyzji właściciela. Zachowany jest też zamiar
   planu §3 pkt 3 („latin-ext zostaje bez preloadu dla innych diakrytyków”) i KRYTYKI L8. Gdyby orkiestrator wolał
   (1), wystarczy usunąć sześć twarzy latin-ext i grupę testów; arkusz zyska wtedy dodatkowo −230 B gzip wobec
   poprawki.
2. **Wagi < 400 dla znaków latin-ext:** zakres twarzy `1 449` nie klampuje żądanej wagi 300 do 400 tak jak deskryptor
   `400 900` twarzy głównej. Plik latin-ext ma oś 300–900, więc w tekście o wadze 300 litery latin-ext są o stopień
   cieńsze od reszty (szerokość sondy 598,77 wobec 605,92 px). Waga 300 na stronach publicznych praktycznie nie
   występuje (`font-light` nieużywane poza adminem, jedno `fontWeight: 300` w `sectionLabelVariants.tsx:831`).
   Naprawa bez zmiany pliku nie istnieje: Chrome nie obsługuje deskryptora `font-variation-settings` w
   `@font-face`. Możliwa kontynuacja to przycięcie osi latin-ext do 400–900 tą samą recepturą co plik główny. Tego
   nie robię, bo plan §3 pkt 3 każe zostawić ten plik bez zmian.
3. **Zakres `unicode-range` latin-ext zawężony** do „cmap latin-ext − cmap główny” zamiast dawnego zakresu Google
   minus litery PL. W nowym układzie zakres ma znaczenie przed pobraniem pliku głównego: U+0304/U+0308 z dawnego
   zakresu uruchomiłyby wtedy pobranie latin-ext. Znaki bez glifu w pliku wywoływały puste pobrania. Równość pilnuje
   test, a arkusz jest o 69 B gzip lżejszy niż przy zakresie Google.
4. **Zmiana `e2e/single-font.boot-home.spec.ts`** (plik tej pozycji z rundy wdrożenia) zamiast osobnego testu
   wydajności Layoutu. Czas Layoutu jest zbyt zaszumiony na bramkę CI. Bramką jest strukturalna przyczyna (twarze
   rodziny RHD) w przeglądarce i w teście jednostkowym; czas mierzy Prove.

## 5. Ryzyka

- **Stosy bez `"Red Hat Display Fallback"`** (`SearchOverlay.tsx:384/398`, `SearchAutosuggest.tsx:243/268`,
  `MessageBubble.tsx:182/200`, `SearchButtonWidget.tsx:248-260`, `AdminColorPicker.tsx:185`, `ticketDocument.ts:74`)
  rysują teraz znaki latin-ext krojem systemowym zamiast RHD. Dotyczy np. wpisanego zapytania z „š” albo wiadomości
  czatu. Te stosy już dziś nie mają metrycznego kroju zastępczego (KRYTYKA L9, „Poza zakresem” planu §3). Naprawa to
  dopisanie nazwy rodziny zastępczej, w plikach spoza mojej listy (§7).
- **Suma CSS:** zostaje ok. 254 B do progu 96 KB. P3.3/P3.8 według zapowiedzi nie dokładają CSS. Każda kolejna
  pozycja z CSS musi to zmierzyć.
- **Pierwsze otwarcie rodziny zastępczej:** gdy plik główny nie zdąży przed pierwszym Layoutem (wolna sieć, mobile
  bez preloadu w cache), rodzina zastępcza zawiera niepobraną twarz latin-ext. Koszt jak przy niezaładowanym pliku
  głównym (A3/A12 u Prove) i nieunikniony w każdym wariancie, także w bazie. Pobrania latin-ext to nie uruchamia,
  bo zakres nie obejmuje znaków strony.
- **Inne przeglądarki:** składanie twarzy o tych samych deskryptorach w font złożony z `unicode-range` wynika ze
  specyfikacji CSS Fonts 4, więc kolejność i zakresy działają tak samo. Pomiar Layoutu dotyczy tylko Chrome
  (PSI/Lighthouse); w innych przeglądarkach go nie sprawdzałem.

## 6. Co zostaje dla Prove (na nowym buildzie worktree)

1. `BUNDLE_INVENTORY=1 bun run build:smoke` → `check:bundle`: suma CSS ok. 95,75/96 KB (+69 B gzip wobec `46e09026`),
   public CSS ok. 81,6/83; domknięcie bootu jak w `46e09026`.
2. `check-document-weight` A/B: `fontPreloadCount` 1, `linkHeaderEntries` 4, `preloadDuplicates` 2,
   `renderBlockingCssGzipBytes` ok. +60–70 B wobec `46e09026`, reszta bez zmian.
3. `test:e2e:artifact` z env CI: `single-font` PL i EN z nowymi krokami 3–4.
4. `font-swap-cls.spec.ts` (konfiguracja performance) 4/4. Strażnik `document.fonts.load('… "Red Hat Display Fallback"')`
   ładuje tylko twarze obejmujące spację, więc latin-ext się nie pobiera. Twarze lokalne bez zmian, więc oczekiwane
   wartości jak w PROVE §5.
5. Lighthouse A/B desktop4x (FCP ±0, pierwsze zadanie Style/Layout ≈ baza) i mobile (LCP w dół jak dotąd).

## 7. Potrzeby poza moją listą plików (out_of_ownership)

- Dopisanie `"Red Hat Display Fallback"` do stosów wymienionych w §5 (wyszukiwarka, czat, widżet wyszukiwania, bilet,
  picker kolorów admina). Daje im metryczny krój zastępczy i glify latin-ext RHD. To kontynuacja razem z
  normalizacją `--brand-font-*` (fala 4, KRYTYKA L9).
- (opcjonalnie) przycięcie osi `red-hat-display-latin-ext.woff2` do 400–900 recepturą pliku głównego (odstępstwo 2).

## 8. Na co patrzeć w recenzji

1. `src/styles.css`: sześć twarzy latin-ext w rodzinie zastępczej. Sprawdzić deskryptory identyczne z twarzami
   lokalnymi, deklarację po nich i `unicode-range` = cmap ext − cmap główny (pilnują testy).
2. `fontGlyphCoverage.test.ts`: czy testy struktury nie są „testami tekstu źródła” wbrew zasadzie z PR #475. Testy
   parsują `@font-face` tak samo jak testy zatwierdzone w planie §9.2. Pilnują zachowania przeglądarki (jedna twarz
   w rodzinie = brak kosztu Layoutu, kolejność = kto rysuje znak), a nie listy klas.
3. `single-font.boot-home.spec.ts` krok 4: sonda dociąga latin-ext. Krok stoi PO asercji „jedno żądanie”, więc nie
   zaciera bramki jednego fontu.

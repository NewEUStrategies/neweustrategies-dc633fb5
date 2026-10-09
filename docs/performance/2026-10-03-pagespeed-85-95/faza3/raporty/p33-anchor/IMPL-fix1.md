# P3.3 kotwica: runda poprawek 1 (IMPL-fix1)

- Gałąź: `fix/w3-p33-anchor`, worktree `scratchpad/wt3/p33-anchor`.
- Nowy commit: **`bd3f8188`**, na `470e2a52`, bez przepisywania historii i bez pushu.
- Wejście do rundy: `REVIEW-anchor-ux.md`, ustalenie 1 (major). To jedyne ustalenie blocking/major
  przekazane do tej rundy.
- Pliki:
  - `src/components/builder/organisms/BuilderRenderer.tsx`: strażnik `CV_GUARD_SCRIPT` i komentarze
    bloku;
  - `src/components/builder/organisms/__tests__/builderRenderer.contentVisibility.test.tsx`;
  - `e2e/content-visibility.boot-home.spec.ts`.

## TL;DR

1. **Ustalenie major jest naprawione.** Strażnik cv dostał przy parsowaniu osobne sprawdzenie
   `try{/#.*:~:/.test(performance.getEntriesByType("navigation")[0].name)&&o(h)}catch(x){}`.
   Wejście z fragmentem tekstowym (`/#:~:text=…`) wyłącza teraz cv przed parsowaniem sekcji, tak samo
   jak wejście z `#id`. Koszt: +86 B inline skryptu i +54 B gzip HTML. Domknięcie bootu się nie
   zmienia, CSS też nie.
2. **Nowy e2e pada na `470e2a52` 8/8** (telefon na lądowaniu, desktop na wyłączniku) **i przechodzi na
   poprawce 8/8 oraz 10/10** w `--repeat-each 5`. Cały spec przy `--repeat-each 5` daje **115/115**
   (13,2 min).
3. **Wynik poboczny, ważny dla UX, poza P3.3.** TanStack przy pierwszym renderze po hydratacji, gdy
   adres nie ma `#`, przewija na górę (`scrollTo(0, 0)`). Gasi to przewinięcie przeglądarki do
   fragmentu tekstowego:
   - telefon x6: 5/5 przebiegów, na obu buildach;
   - desktop: 3/5.

   Poprawka P3.3 sprawia, że do chwili tego resetu cel stoi w widoku. Sam reset to osobna pozycja,
   opisana w §5.

## 1. Co było źle

Chromium wycina dyrektywę fragmentu (`:~:text=…`) z adresu dokumentu, więc `location.hash === ""`.
Przez to gałąź wejścia strażnika (`location.hash.length>1||…`) nie wyłączała cv. Przewinięcie do
tekstu liczyło się na pasach z szacunku. Potem odsłonięcie sekcji nad celem spychało go o ekran w dół
(mechanizm jak w REPRO) albo pozycja przepadała.

Pomiar własny na buildzie `470e2a52` (`.output` worktree przed przebudową, przebieg
`e2e-textfrag-before2.log`, telefon 412x823 przy CPU x6):

- 4/4 przebiegi: `scrollY 3737`, `top` celu **1489,6** (`bottom 1564,6`);
- cel był w widoku tylko w 1 klatce z 49-56, potem cały czas o ekran za nisko;
- na koniec TanStack przewinął na górę (`scrollY 0`);
- desktop: lądowanie w widoku, ale cv zostało włączone (`cvOff:false`) w 4/4.

To potwierdza liczby recenzenta (1482 przy x1).

## 2. Poprawka

`CV_GUARD_SCRIPT`, gałąź wejścia (ES5, wykonywana przy parsowaniu, przed sekcjami):

```js
try{var k=…,w=…;if(location.hash.length>1||w&&w.scrollY>0)o(h)}catch(x){}
try{/#.*:~:/.test(performance.getEntriesByType("navigation")[0].name)&&o(h)}catch(x){}
```

Szczegóły zapisu:

- **Nazwa wpisu nawigacji** (`PerformanceNavigationTiming.name`) to adres dokumentu z dyrektywą.
  Recenzent zmierzył (`rv-navname.spec.ts`), że jest dostępna już w skrypcie startowym. Nowy e2e
  pokazuje to samo: żadna klatka nie ma opakowania z cv bez wyłącznika.
- **Osobny `try` zamiast dopisania `||…` do istniejącego warunku.** Wyjątek z `sessionStorage`
  (zablokowany albo uszkodzony wpis przy `__TSR_key`) nie wyłącza sprawdzenia dyrektywy. Brak wpisu
  nawigacji (`[0]` undefined rzuca, `catch` daje fałsz) nie blokuje wpisu przywrócenia. `o(h)` jest
  idempotentne. Wariant z recenzji, z jawnymi strażnikami `getEntriesByType||0`, robiłby to samo,
  ale byłby dłuższy.
- **`/#.*:~:/` zamiast `/:~:/`.** Liczy się tylko dyrektywa we fragmencie, a `:~:` w ścieżce albo
  zapytaniu nie wyłącza cv. Kosztuje to +3 B.
- **Inne silniki.** Safari i Firefox: nazwa wpisu nie jest sprawdzona. W najgorszym razie wyrażenie da
  fałsz, czyli zachowanie sprzed poprawki.
- **Przeładowanie strony otwartej z dyrektywą.** Też wyłącza cv. Tak samo działa już przywrócenie
  przewinięcia, więc nic nie traci.
- **Rozmiar.** Strażnik ma 1112 B zamiast 1026 B. Skrypt dalej jest tylko w bundlu serwera
  (`.output/server/_ssr/router-*.mjs`), a żaden plik `.output/public/assets` nie zawiera
  `data-cv-off`.

## 3. Testy

### e2e `content-visibility.boot-home.spec.ts`

Nowy test na każdy viewport: `kotwica przy wejściu z fragmentem tekstowym #:~:text= (CPU x6 telefon
/ x1 desktop)`. Przebieg:

1. Cel to ten sam element co w teście „wejście z fragmentem w adresie” (`far`, nagłówek „Zapisz się
   do newslettera”). Tekst dyrektywy pochodzi z jego `textContent`; `-` jest kodowany jako `%2D`.
2. Pomocnik `trackFromStart` (skrypt startowy, przed parsowaniem HTML-u) próbkuje po każdej klatce
   `scrollY`, `top`/`bottom` celu, dół nagłówka, obecność opakowania z cv i wyłącznik.
   - Cel czyta dopiero wtedy, gdy strona jest przewinięta. Wcześniejszy odczyt geometrii w pominiętej
     sekcji wymusiłby ułożenie jej poddrzewa (warunek W2 z REPRO).
   - Cel szuka po `id`, a gdy go nie ma, po tym samym znaczniku z tym samym tekstem (na wypadek
     przerenderowania wyspy).
3. Test czeka, aż przeglądarka przewinie do tekstu, potem na spoczynek i 4 s (x6) albo 2 s (x1), potem
   znowu na spoczynek.
4. Asercje, w tej kolejności, żeby pierwsza porażka mówiła o zachowaniu:
   - jest klatka przewinięta o więcej niż pół widoku;
   - **w każdej przewiniętej klatce cel jest w widoku pod nagłówkiem**
     (`top >= hb - 1 && bottom <= innerHeight`);
   - w żadnej klatce nie ma opakowania z cv bez wyłącznika;
   - na koniec `cvOff === true` i sekcja celu ma `content-visibility: visible`.
5. Klatki na samej górze strony (`scrollY 0`) są pominięte, bo reset TanStacka nie należy do P3.3
   (§5). Bez tego test byłby migotliwy także na zdrowym buildzie.

Dodatkowo `ANCHOR_TIMEOUT` dla telefonu wzrósł ze 120 do 240 s (uwaga minor 2 z recenzji: wstecz/dalej
trwa lokalnie 43,6-50,3 s, a CI jest wolniejsze i ma snapshotter trace'u). Nie zmienia to asercji.

| przebieg                                                                 | build           | wynik                                                                                                                            |
| ------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `-g "fragmentem tekstowym" --repeat-each 4` (`e2e-textfrag-before2.log`) | `470e2a52` (r2) | **8 failed / 8**: telefon 4/4 na lądowaniu („cel poza widokiem w 48-55 z 49-56 klatek”, `top 1489,6`), desktop 4/4 na wyłączniku |
| to samo (`e2e-textfrag-fix1.log`)                                        | `bd3f8188`      | **8/8**                                                                                                                          |
| cały spec `--repeat-each 5` (`e2e-cv-repeat5-fix1.log`, `.json`)         | `bd3f8188`      | **115/115**, 13,2 min, w tym nowy test 10/10                                                                                     |

Stan końcowy nowego testu na poprawce (adnotacje z `e2e-cv-repeat5-fix1.json`):

- telefon 5/5: `cvOff:true`, na koniec `scrollY 0` (reset TanStacka po lądowaniu);
- desktop: 2/5 `scrollY 1828`, cel `top 588` (w widoku); 3/5 reset do 0.

Pierwsza próba (`e2e-textfrag-before.log`) miała asercję wyłącznika przed lądowaniem i pokazywała tylko
`cvOff:false`. Po zmianie kolejności spec pada na zachowaniu.

### vitest `builderRenderer.contentVisibility.test.tsx`

W bloku „strażnik wejścia w połowie strony” są 4 nowe przypadki. Atrapą jest
`performance.getEntriesByType`, a strażnik jest wykonany jak przy parsowaniu:

- `/#:~:text=…` z pustym `location.hash` wyłącza cv;
- fragment tekstowy przy uszkodzonym wpisie `sessionStorage` wyłącza cv (osobne sprawdzenie);
- `:~:` w zapytaniu zostawia cv;
- brak wpisu nawigacji nie rzuca i nie blokuje przywrócenia przewinięcia.

Na starym strażniku (`git show HEAD:…BuilderRenderer.tsx` podstawiony na czas przebiegu, potem
przywrócony) **padają 2 pozytywne**, a negatywne przechodzą. Plik daje 58/58.

## 4. Waga dokumentu `/` (`node scripts/performance/check-document-weight.ts`, fixture, 5 próbek)

| metryka                       | `470e2a52` (r2) | `bd3f8188` |   Δ | próg `max` |  zapas |
| ----------------------------- | --------------: | ---------: | --: | ---------: | -----: |
| `htmlRawBytes`                |         329 237 |    329 323 | +86 |    406 180 | 76 857 |
| `htmlGzipBytes`               |          50 259 |     50 313 | +54 |     57 710 |  7 397 |
| `inlineScriptBytes`           |          88 336 |     88 422 | +86 |     98 103 |  9 681 |
| `inlineExecutableScriptBytes` |          81 089 |     81 175 | +86 |     91 725 | 10 550 |
| `inlineCssCommentBytes`       |             517 |        517 |   0 |        517 |      0 |
| `bootClosureGzipBytes`        |         495 154 |    495 154 |   0 |    496 679 |  1 525 |
| `bootBurstGzipBytes`          |         572 380 |    572 380 |   0 |    574 673 |  2 293 |
| `preLcpTransferBytes`         |         175 434 |    175 488 | +54 |    181 594 |  6 106 |

Progi bez zmian, wszystko w progach (`docweight-fix1.log`, `document-weight-fix1.json`).

Uwaga do pomiaru: pierwszy przebieg puściłem przez `bun run` (`docweight-fix1-bunzlib.log`). Pokazał
`bootClosureGzipBytes 498 652 > 496 679`, choć bajty surowe były identyczne. `gzipSync` Buna kompresuje
inaczej niż zlib Node'a. Skrypt pakietu (`check:document-weight`) i baza używają `node`, więc ten
przebieg odrzuciłem; nie jest to regresja.

Parzystość SSR/hydratacji bez zmian: zmienia się tylko literał skryptu w bloku serwera, klient dalej
renderuje pusty `__html`, a testy hydratacji w pliku vitest przechodzą.

## 5. Poza zakresem i otwarte

- **Reset TanStacka po przewinięciu do fragmentu tekstowego** (recenzja, ustalenie 5, teraz
  zmierzony). Przy pierwszym `onRendered` po hydratacji `@tanstack/router-core`
  (`scroll-restoration.js`, gałąź `if (!hash) scrollTo({ top: 0 })`) przewija na górę. Przeglądarka
  przewinęła już do tekstu, bo hash jest pusty. Pomiar:
  - telefon x6: 5/5 przebiegów na poprawce, 4/4 na `470e2a52`;
  - desktop: 3/5;
  - recenzent przy cv wyłączonym: 1/3.

  Linki z wyszukiwarki z wyróżnieniem tekstu na tej stronie kończą więc zwykle na górze strony,
  niezależnie od cv. Propozycja osobnej pozycji: przy pierwszym renderze po hydratacji pominąć reset,
  gdy `scrollY > 0` albo nazwa wpisu nawigacji ma `:~:` (opcja `scrollRestoration` jako funkcja w
  `src/router.tsx` albo własny `getScrollRestorationKey`). Do zweryfikowania z przywracaniem
  przewinięcia.

- **Nity z recenzji, których nie ruszałem** (zachowanie jak przed poprawką kotwicy, rzadkie w treści
  CMS):
  - nit 4: link w stronie `#:~:text=…`, `<a name>`, `<a>` w SVG, `target=_top/_parent`;
  - nit 6: podwójny ruch przy wstecz/dalej do wpisów z fragmentem utworzonych bez wyłączenia cv;
  - nit 3: spóźnione `scrollIntoView` routera, poza P3.3.
- **Nazwy logów.** `build-r1.log` i `typecheck-r1.log` nadpisałem tą rundą, zgodnie z poleceniem.
  Wcześniej zawierały build i typecheck wersji r1 sprzed recenzji (opisane w `IMPL.md`).

## 6. Bramki (worktree `wt3/p33-anchor`, stan = commit `bd3f8188`)

| bramka                                                           | wynik                                       | log                                               |
| ---------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `prettier --write/--check` (3 pliki)                             | OK                                          | -                                                 |
| `light.sh bunx eslint` (3 pliki)                                 | OK, 0 uwag                                  | -                                                 |
| typecheck (`typecheck-noinc.sh`: tsgo + tsc skryptów + tsgo e2e) | OK (exit 0)                                 | `typecheck-r1.log`                                |
| `vitest run src/components/builder/organisms`                    | OK: 82 pliki, 1162 passed + 4 expected fail | `vitest-fix1.log`                                 |
| `verify:static`                                                  | OK, 15/15 (263,4 s)                         | `verify-static-fix1.log`                          |
| `BUNDLE_INVENTORY=1 build:smoke`                                 | OK (2 min 42 s)                             | `build-r1.log`                                    |
| `check:document-weight` (node)                                   | OK, wszystko w progach                      | `docweight-fix1.log`, `document-weight-fix1.json` |
| content-visibility `--repeat-each 5` (env jak w CI)              | **115/115**                                 | `e2e-cv-repeat5-fix1.log`, `.json`                |
| nowy test na `470e2a52`                                          | **pada 8/8**                                | `e2e-textfrag-before2.log`                        |

Serwery Playwrighta zgasły razem z runnerem (porty 4181 i 4307 wolne). `base-w3f` jest nietknięty.
Mutex zostawiłem wolny od moich kroków.

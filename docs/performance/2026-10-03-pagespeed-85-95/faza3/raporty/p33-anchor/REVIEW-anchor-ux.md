# P3.3 kotwica - recenzja: poprawność kotwic i przewijania / UX

- Zmiana: `470e2a52` (`4d1e2791..HEAD` w `scratchpad/wt3/p33-anchor`), raport `IMPL.md`.
- Soczewka: każda ścieżka nawigacji w obrębie strony z cv, wyłączenie cv przed przewinięciem,
  brak widocznego skoku, brak pętli.
- Pomiary własne (tylko odczyt; serwer na porcie 4307 z buildu r2 implementera, przez mutex, zgaszony):
  `phase3/p33-anchor/review-ux/` (`rv-anchor.spec.ts`, `rv-textfrag.spec.ts`, `rv-navname.spec.ts`,
  logi `logs/r1.log`, `t1..t3.log`, `n1.log`). Telefon 412x823, Chromium 141, fixture `/`.

## Werdykt

**request_changes (bez blokerów w samym diffie).** Strażnik robi to, co obiecuje, we wszystkich
sprawdzonych ścieżkach nawigacji w obrębie strony. Jest jedna istotna luka w tej samej klasie błędu.
Jej źródłem jest P3.3, nie ten diff: **wejście z fragmentem tekstowym `#:~:text=`** (linki z Google,
„Kopiuj link do wyróżnienia” w Chrome) ląduje na zmierzonej stronie z cv poza celem 3 razy na 3.
Poprawka to jedno wyrażenie w gałęzi wejścia tego samego skryptu. Warto ją dołączyć przed scaleniem
P3.3 albo świadomie zapisać jako odłożoną.

## Ustalenia

### 1. [major, istniejące wcześniej w P3.3, nie regresja] Fragment tekstowy przy wejściu omija strażnika i ląduje poza celem

Chromium wycina z `location` dyrektywę fragmentu, więc dla `/#:~:text=…` `location.hash === ""`.
Gałąź wejścia (`location.hash.length>1||…`) nie wyłącza wtedy cv. Przewinięcie do tekstu liczy się na
pasach z szacunku, a odsłonięcie sekcji nad celem spycha cel w dół: to ten sam mechanizm co w CI.

`rv-textfrag.spec.ts`, cel to „Zapisz się do newslettera”:

| przypadek                                                             | trace  | wynik (`scrollY`, `top` celu po 6 s)                                      |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| cv (strażnik nie zadziałał, `cvOff:false`)                            | off    | 3716/**1482**, 3716/**1482**, 3736→0 (pozycja utracona)                   |
| cv                                                                    | on     | 3716/**1482**, 3733→0, 0/5227 (pozycja utracona)                          |
| kontrola: `/#rv-none:~:text=…` (strażnik zdejmuje cv przy parsowaniu) | off/on | 4711/487, 4703/495, 4703/495 (×2) - cel na środku widoku, jak powinno być |

Wysokość widoku to 823 px, więc `top` 1482 oznacza, że cel jest ekran niżej. Różnica 4711−3716 ≈ 995 px
to dokładnie niedoszacowanie w5 z REPRO.

Wykrycie przy parsowaniu działa. `performance.getEntriesByType("navigation")[0].name` zawiera
dyrektywę już w skrypcie startowym (`rv-navname.spec.ts`:
`atInit: "…/#:~:text=Zapisz…"`). Z emulowanym wyłącznikiem lądowanie wynosi 487/487 w 2 z 3 prób.
Trzecia to reset do 0, który opisuje ustalenie 5.

**Poprawka** (~80 B inline, zero JS bootu, bez CSS) w gałęzi wejścia:
`||/:~:/.test(((performance.getEntriesByType||0)&&performance.getEntriesByType("navigation")[0]||{}).name)`.
Do tego przypadek w e2e: wejście `/#:~:text=…` ma dać `cvOff === true`, a cel ma być w widoku.
Safari: nazwa wpisu nawigacji nie została sprawdzona. Gorszy wynik niż dziś jest tam niemożliwy, bo
wyrażenie da fałsz.

### 2. [minor] Limit czasu testów kotwicy na telefonie może być za ciasny dla CI

Lokalnie `kotwica: wstecz/dalej…` na telefonie trwa 40,4-46,5 s (`e2e-cv-repeat5-r2.log`), a limit to
`ANCHOR_TIMEOUT = 120 s`. Runner CI jest wolniejszy, a x6 to mnożnik względem jego CPU. Do tego
`trace: retain-on-failure` uruchamia snapshotter przy każdej akcji. Pięć nawigacji, w każdej czekanie
na render routera (2-6 s lokalnie przy x6) i do 15 s `settle`, plus otwarcie przy x6, to realne
ryzyko przekroczenia czasu, czyli flaka. Propozycja: 240 s dla telefonu albo krótsze `settlePolls`.
Progów wagi to nie dotyczy.

### 3. [nit, poza zakresem, już w IMPL §6] Spóźnione `scrollIntoView` TanStacka przestawia cel o ~80 px

Ścieżka Enter na linku (`rv-anchor`, x4): cel stoi na 244 od pierwszej klatki. Po ~3,9 s render
routera przewija go na 162 (nagłówek skurczył się ze 107 do 66). To widoczny drugi ruch kilka sekund
po skoku i dotyczy także stron bez cv. Spec akceptuje obie pozycje, bo pasmo `onTarget` jest szerokie.
Do osobnej pozycji (obsługa zmiany samego `#` przez router).

### 4. [nit] Linki, których strażnik kliku nie rozpoznaje

Te przypadki wracają do zachowania sprzed poprawki, czyli do ryzyka złego lądowania:

- `<a name="x">` (algorytm „indicated part” je obejmuje, `f` szuka tylko `getElementById`);
- `<a>` w SVG (`a.href` to `SVGAnimatedString`, więc `split` rzuca wyjątek, który jest łapany);
- `target="_top"` / `"_parent"` w oknie najwyższego poziomu;
- link w stronie `#:~:text=…`.

W treści CMS to rzadkie przypadki. Wystarczy wzmianka w komentarzu albo obsługa `_top`/`_parent`.

### 5. [nit, poza P3.3] TanStack zeruje przewinięcie przy wejściu z fragmentem tekstowym

Zdarza się w 1 z 3 prób także przy cv wyłączonym (`n1.log`, `t1.log`). Router widzi pusty
`location.hash` i przewija na górę po tym, jak przeglądarka przewinęła do tekstu. Do osobnej pozycji.

### 6. [nit] Przewinięcie strażnika w `rAF` przy wstecz/dalej

Gdy cv jest jeszcze włączone, a cel wpisu akurat leży w widoku, `g` przewija cel w następnej klatce,
a później TanStack przywraca zapisaną pozycję. Wychodzi podwójny ruch. Osiągalne tylko dla wpisów
z fragmentem utworzonych bez wyłączenia cv: `router.navigate({ hash })`, `pushState`, wpisy sprzed
przeładowania. To bardzo rzadkie, wystarczy wzmianka.

## Sprawdzone i poprawne

| ścieżka                                                     | wynik                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| klik `<a href="#id">` do ogona cv (capture na oknie)        | cv wyłączone przed domyślną akcją; cel na miejscu od pierwszej klatki (e2e implementera 105/105; własny klik + Enter: 244→162 z przyczyny opisanej w pkt 3)                                                                                      |
| Ctrl / Shift / środkowy przycisk / `target=_blank`          | `cvOff:false`, `scrollY` 0, nowa karta otwarta (Ctrl i `_blank`); nic się nie przełącza                                                                                                                                                          |
| Enter na linku (klawiatura)                                 | jak klik                                                                                                                                                                                                                                         |
| `location.hash` do celu w sekcji bez cv (przed ogonem)      | `cvOff:false`, cel 244 pod nagłówkiem 66                                                                                                                                                                                                         |
| `location.hash` do nieistniejącego `id`                     | bez zmian (`cvOff:false`, pozycja bez zmian)                                                                                                                                                                                                     |
| klik `#`                                                    | przewinięcie na górę, `cvOff:false`                                                                                                                                                                                                              |
| ten sam hash ponownie po przewinięciu w górę                | cel 162                                                                                                                                                                                                                                          |
| `location.hash` do celu już widocznego (ścieżka `rAF`)      | dokładnie jeden skok (`scrollY` 1287 → 1626), brak drugiego ruchu z `scrollIntoView`                                                                                                                                                             |
| wstecz/dalej między fragmentami, powrót do miejsca czytania | pokryte e2e implementera (±2 px)                                                                                                                                                                                                                 |
| `<Link hash>` / `/#id` routera                              | klik wyłącza cv w capture; przewinięcia brak z powodu `defaultHashScrollIntoView:false` (stan sprzed zmiany, IMPL §6)                                                                                                                            |
| wejście z `#id` i przywrócenie przewinięcia                 | gałąź wejścia semantycznie bez zmian (teraz w IIFE, bez wycieku `k`/`w`)                                                                                                                                                                         |
| strony ze spisem treści i wpisy                             | bez cv (`islands` wymaga `!toc` i `post?.kind !== "post"`); `FloatingShareBar`/`smoothScrollToAnchor` działają tylko we wpisach                                                                                                                  |
| druk                                                        | reguła `@media print` w `CV_CSS` bez zmian                                                                                                                                                                                                       |
| pętle / obserwatory                                         | brak: najwyżej jeden `requestAnimationFrame` przy nawigacji, która wyłączyła cv; 3 stałe nasłuchy                                                                                                                                                |
| moment wyłączenia                                           | klik: w capture przed domyślną akcją; `popstate` w Chromium przed przewinięciem (REPRO i `diag/fix-d3.log`); WebKit/Firefox (przewinięcie przed `popstate`): poprawka w `rAF` przed malowaniem następnej klatki, bez pośredniej klatki na pasach |
| stopka i cele za pierwszym opakowaniem                      | wyłączają cv, co jest poprawne, bo położenie stopki zależy od pasów; `.cv-auto` stopki nie leży nad żadnym celem w ogonie                                                                                                                        |

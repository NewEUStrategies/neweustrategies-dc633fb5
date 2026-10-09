# P3.3 kotwica - recenzja r1: poprawność kotwic i przewijania / UX

- Zmiana: `4d1e2791..bd3f8188` w `scratchpad/wt3/p33-anchor`. Commity: `470e2a52` (strażnik nawigacji
  do fragmentu) i `bd3f8188` (fragment tekstowy przy wejściu). Raporty: `IMPL.md`, `IMPL-fix1.md`.
  Poprzednia runda: `REVIEW-anchor-ux.md`.
- Soczewka: każda ścieżka nawigacji w obrębie strony z cv, wyłączenie cv przed przewinięciem, brak
  widocznego skoku, brak pętli.
- Pomiar własny (tylko odczyt, przez mutex, build implementera `.output` = `bd3f8188`, serwer zgaszony
  razem z runnerem): `review-ux-r1/logs/e2e-kotwica-r1.log`. Polecenie: `-g kotwica --repeat-each 2`,
  2 workery, `trace: retain-on-failure` jak w CI, env fixture z CI. Wynik: **28/28 passed (3,3 min)**.
  Zawiera telefon x6 i desktop x1: `location.hash` i klik dla obu celów, wstecz/dalej, wejście
  z `#id` i z `#:~:text=`.

## Werdykt

**approve.** W rundzie fix1 zmienia się w kodzie jedno wyrażenie w gałęzi wejścia strażnika:

```js
try {
  /#.*:~:/.test(performance.getEntriesByType("navigation")[0].name) && o(h);
} catch (x) {}
```

Zamyka ono ustalenie major z r0, czyli wejście z fragmentem tekstowym na pasach. Ścieżki nawigacji po
wczytaniu są bajt w bajt takie jak w `470e2a52` i sprawdziłem je ponownie (tabela niżej). Nie ma
blokerów ani ustaleń major. Zostają dwie uwagi minor poza diffem (pkt 1 i 2) i nity.

## Ustalenia

### 1. [minor, poza P3.3, teraz decyduje o efekcie] TanStack zeruje przewinięcie po wejściu z `#:~:text=`

Poprawka działa: wyłącznik stoi, zanim parser doda pierwsze opakowanie. Cel jest w widoku w każdej
przewiniętej klatce. Mimo to **we wszystkich 4 moich przebiegach** strona kończy na samej górze:

- `entered.scrollY = 0`, `cvOff: true`;
- telefon x6 2/2, desktop x1 2/2;
- implementer: telefon 5/5, desktop 3/5.

Przyczyna leży w `@tanstack/router-core@1.171.15`, `dist/esm/scroll-restoration.js:174-180`. Pierwszy
`onRendered` po hydratacji z `shouldResetScroll` i pustym `location.hash` wykonuje `scrollTo({top: 0})`.
Chromium wycina dyrektywę z adresu, więc router nie wie, że przeglądarka przewinęła do tekstu.

Skutek dla czytelnika z linku z Google („przewiń do wyróżnienia”):

- dziś zwykle „skok do tekstu, potem skok na górę”;
- strona przy tym traci oszczędność P3.3 przy wczytaniu, bo cv jest wyłączone.

Diff niczego tu nie psuje: przed nim wynik był ten sam albo gorszy (cel ekran niżej). Spec świadomie
pomija klatki z `scrollY 0` (komentarz w teście), więc tego nie złapie.

**Zalecenie:** osobna pozycja z konkretnym hakiem. `scrollRestoration` jako funkcja w `src/router.tsx`
(router-core sprawdza ją w linii 123) ma zwracać `false` przy pierwszym renderze, gdy
`performance.getEntriesByType("navigation")[0].name` zawiera `#…:~:` albo `scrollY > 0` przed
hydratacją. Po naprawie trzeba zaostrzyć spec P3.3: na koniec cel ma być w widoku, a nie tylko
w klatkach przewiniętych.

### 2. [minor, poza diffem, z REPRO opcja (e)] Skoki bez nawigacji nadal podlegają mechanizmowi W1+W2

Strażnik obejmuje tylko nawigacje do fragmentu. Poniższe przypadki na stronie z cv dalej liczą
skok na pasach:

- znajdź na stronie (Ctrl+F);
- `element.focus()` i `scrollIntoView()` ze skryptu widgetu;
- przewinięcie przez czytnik ekranu.

Gdy ktoś ułożył wcześniej poddrzewo pominiętej sekcji nad celem (W2), zakotwiczenie Chromium nie
skompensuje wzrostu tej sekcji. Na stronach z cv nie ma dziś widgetu, który przewijałby do celu
w ogonie:

- `TocWidget` - strony ze spisem nie mają wysp ani cv (`islands` wymaga `!toc`);
- `smoothScrollToAnchor` / `useAnchorScroll` działają tylko we wpisach, w profilu i u autora (poza
  `BuilderRenderer` z `lcpOwner`).

Ekspozycja jest więc mała. Opcja (e) z REPRO (`overflow-anchor:none` na pominiętych opakowaniach,
~200 B) zamknęłaby ten przypadek w Chromium i Firefoksie. Do backlogu, nie do tego PR.

### 3. [nit] Przypadki kliku nadal nierozpoznane (r0 nit 4, nie ruszone)

- `<a name>`;
- `<a>` w SVG;
- `target="_top"` / `"_parent"`;
- link w stronie `#:~:text=`.

Wracają do zachowania sprzed poprawki. Komentarz bloku wymienia tylko warunek `_self`. Jedno zdanie
o tych wyjątkach w komentarzu oszczędziłoby przyszłego śledztwa.

### 4. [nit] Klik w link `#id` z `preventDefault` w handlerze strony wyłącza cv bez przewinięcia

Dotyczy np. `<Link hash>` routera, który nie przewija (`defaultHashScrollIntoView: false`), i zakładek
na `href="#…"`. Koszt to jednorazowe odsłonięcie wszystkich sekcji w tym kliku: +78/182 ms przy x4/x6
według REPRO, bez korzyści. W treści CMS na stronach z cv nie znalazłem takiego wzorca. `href="#"`
(puste) nie przełącza, bo `f("")` zwraca `null`. Tylko do wiadomości.

### 5. [nit] Fragment tekstowy celujący w sekcję nad ogonem też wyłącza cv

Na przykład tekst z hero. To świadome uproszczenie, symetryczne z `#id` przy wejściu, które też nie
sprawdza położenia celu. Koszt to utrata oszczędności P3.3 przy takim wejściu, bez wpływu na
poprawność.

## Sprawdzone i poprawne

| ścieżka                                                                                                  | wynik                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `location.hash` do celu w ogonie, telefon x6 z wymuszonym W2 (`measureSkippedSections`) i trace jak w CI | 4/4 (nagłówek i góra sekcji, po 2): cel pod nagłówkiem od pierwszej klatki do spoczynku                                                                                                                                                                                                                                    |
| klik `<a href="#id">` (capture na oknie, przed domyślną akcją)                                           | 4/4 telefon, 4/4 desktop                                                                                                                                                                                                                                                                                                   |
| wstecz/dalej między fragmentami + `history.go(-2)` do miejsca czytania                                   | 2/2 telefon, 2/2 desktop; router zapisuje pozycję wpisu w swoim `popstate` przed jakimkolwiek przewinięciem strażnika (`rAF`)                                                                                                                                                                                              |
| wejście `/#id`                                                                                           | `cvOff:true` przed parsowaniem sekcji, lądowanie pod nagłówkiem (2/2 + 2/2)                                                                                                                                                                                                                                                |
| wejście `/#:~:text=`                                                                                     | `location.hash === ""`, żadna klatka z opakowaniem cv bez wyłącznika, cel w widoku w każdej przewiniętej klatce (2/2 + 2/2); stan końcowy - pkt 1                                                                                                                                                                          |
| Ctrl/Meta/Shift/Alt, `target=_blank`                                                                     | nic nie przełącza (vitest `builderRenderer.contentVisibility`; r0: nowa karta otwarta, `cvOff:false`)                                                                                                                                                                                                                      |
| ten sam hash ponownie                                                                                    | po pierwszej nawigacji cv jest wyłączone na stałe (wyłącznik idempotentny), przeglądarka przewija na prawdziwym układzie                                                                                                                                                                                                   |
| hash do `id` w sekcji bez cv (przed ogonem) i do celu-przodka opakowań (`#main`, „przejdź do treści”)    | `compareDocumentPosition & 4` daje fałsz dla poprzedników i przodków (CONTAINS 8 \| PRECEDING 2) → cv zostaje                                                                                                                                                                                                              |
| hash do brakującego `id`, `href="#"`                                                                     | `f` zwraca `null`, nic się nie dzieje                                                                                                                                                                                                                                                                                      |
| `<Link hash>` / `router.navigate({ hash })`                                                              | klik wyłącza cv w capture; router nie przewija (stan sprzed zmiany, pkt 4)                                                                                                                                                                                                                                                 |
| przywrócenie przewinięcia po przeładowaniu                                                               | gałąź wejścia semantycznie bez zmian; nowe sprawdzenie w osobnym `try`, więc zepsuty `sessionStorage` nie blokuje dyrektywy, a brak wpisu nawigacji nie blokuje przywrócenia (vitest 4 nowe przypadki)                                                                                                                     |
| nawigacja SPA na inną stronę i z powrotem                                                                | strona renderowana po stronie klienta nie ma `[data-cv]`, więc `f` zwraca `null`; nasłuchy strażnika są tanie i nieszkodliwe                                                                                                                                                                                               |
| spis treści (TOC)                                                                                        | strony z TOC nie mają cv (`islands` wymaga `!toc`), a `TocWidget` przewija własnym `scrollTo`                                                                                                                                                                                                                              |
| druk                                                                                                     | `@media print` w `CV_CSS` bez zmian                                                                                                                                                                                                                                                                                        |
| pętle i obserwatory                                                                                      | brak: 3 stałe nasłuchy (`click` capture, `popstate`, `hashchange`) i najwyżej jeden `requestAnimationFrame` przy nawigacji, która sama wyłączyła cv, gdy cel był już w widoku; żadnego obserwatora ani pętli `rAF`                                                                                                         |
| moment wyłączenia                                                                                        | klik: przed domyślną akcją; `popstate`: w Chromium przed przewinięciem (REPRO: 12,5 ms vs 17,9 ms). W WebKit/Firefox przewinięcie przychodzi przed `popstate`, więc korekta idzie w `rAF` przed malowaniem następnej klatki, bez pośredniej klatki na pasach (niezweryfikowane w silniku: na maszynie jest tylko Chromium) |
| odczyt geometrii w `g` przy włączonym cv                                                                 | wymusza ułożenie tylko poddrzewa celu, a zaraz potem cv wyłącza się globalnie, więc W2 nie ma znaczenia                                                                                                                                                                                                                    |
| build                                                                                                    | `.output/server/_ssr/router-*.mjs` zawiera nowe wyrażenie; skrypt tylko w bundlu serwera (IMPL-fix1 §2)                                                                                                                                                                                                                    |
| limity czasu e2e                                                                                         | telefon x6 15-20 s na przypadek, wstecz/dalej ~45 s przy limicie 240 s; CI też jedzie na 2 workerach (`failed.log`: „29 tests using 2 workers”) - zapas wystarczy                                                                                                                                                          |

Serwer z mojego przebiegu został zgaszony (port 4181 wolny). Worktree `wt3/p33-anchor` jest
nietknięty (`git status` czysty), wyniki są w `review-ux-r1/test-results`.

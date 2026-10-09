# P3.3 (fala 3) - `content-visibility` ogona sekcji buildera - REVIEW

- worktree: `scratchpad/wt3/P3.3`, commit `cf0cf8a5` (jedyny nad `claude/zen-ritchie-hzur21`), drzewo czyste
- werdykt: **approve** (bez blokerów; 0 major, 7 minor - do wzięcia przy najbliższej rundzie poprawek albo jako
  uwagi dla etapu Prove)

## Zakres i zgodność z kartą

- Pliki: `src/components/builder/organisms/BuilderRenderer.tsx`,
  `src/components/builder/organisms/__tests__/builderRenderer.contentVisibility.test.tsx` (nowy),
  `e2e/content-visibility.boot-home.spec.ts` (nowy). Wszystkie z listy (ścieżka e2e wg notatek orkiestratora, test
  jednostkowy wg `faza1/PLAN.md`). `sectionStreaming.tsx` nietknięty (szacunek z istniejącego
  `@/lib/builder/sectionHeightEstimate`), `SectionBackgroundVideo` (P3.5) nietknięty, `styles.css` nietknięty.
- Mechanizm zgodny z kartą (inline `content-visibility:auto` + `contain-intrinsic-size:auto <szacunek>px`,
  indeks w dokumencie >= 2, ta sama liczba na serwerze i kliencie). Odstępstwa są opisane z powodem w IMPL.md
  i w bloku komentarza: opakowanie zamiast stylu na `<section>` (szkielet strumienia w środku elementu z cv,
  zmierzone 0,0094 przesunięcia bez tego), tylko ciągły ogon >= 2600 px, kotwica `location.hash` przez strażnika
  `html[data-cv-off]` + wykluczenie sekcji z `htmlId`, druk przez regułę w ukrytym bloku (bez edycji `styles.css`,
  którego właścicielem jest P3.2). Uzasadnienia trzymają się kupy - opisany wybór dla kotwicy jest jednym
  z dwóch wariantów dopuszczonych notatką.
- Wyłączenia z notatek: TOC (cały renderer bez cv - warunki wysp P2.2), `location.hash` (strażnik +
  `htmlId`), builder/`editorPreview`/kanwa (warunki wysp), druk (`@media print`), sticky/fixed (klasa/CSS
  węzłów, lista dozwolonych typów widgetów, tło/nakładka `fixed`), kandydat LCP, stopka/RelatedPosts nie
  dublowane (cv tylko w rendererze treści). Nic nie pominięte po cichu.
- Commit: polski opis, przyczepka dokładnie `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` +
  `Claude-Session: https://claude.ai/code/session_018pV9XfFuDnwMxKGJSFfcDg`. IMPL.md bez placeholderów.

## Co sprawdziłem (próby obalenia)

- **Parzystość SSR/hydratacji.** Plan liczy tylko serwer; klient czyta go z opakowań serwera
  (`[data-lcp-root="<useId>"] > [data-cv]`) w inicjalizatorze stanu - opakowania leżą poza granicą Suspense
  (w powłoce), więc są w DOM-ie w chwili hydratacji renderera. Przy awaryjnym renderze klienckim granicy
  `useId` ma inny kształt, selektor nic nie znajduje i drzewo jest spójnie bez cv. Zmiana dokumentu
  (`ownsDoc`) zdejmuje plan (remount sekcji - jak przy każdym nowym dokumencie). `CvBlock` (`memo` bez propsów,
  pusty `__html` + `suppressHydrationWarning`) - ten sam wzór co gniazdo zgód w `__root.tsx`; test rerenderu
  potwierdza, że treść serwera zostaje. `<html suppressHydrationWarning>` jest (`__root.tsx:1187`), więc
  `data-cv-off` nie generuje ostrzeżeń.
- **Strażnik** zgodny z `@tanstack/router-core@1.171.15`: klucz `tsr-scroll-restoration-v1_3`, wpis
  `[history.state.__TSR_key].window.scrollY` - ta sama ścieżka co `scroll-restoration-inline.js`. CSP ma
  `'unsafe-inline'` w `script-src` i `style-src` (`src/start.ts:281-283`), więc skrypt i styl bloku działają.
- **Chunk graph / bajty.** Brak nowych importów wartości (tylko typy + `estimateSectionHeight` z modułu już
  importowanego). Część serwerowa wypada z klienta (zweryfikowane przez wykonawcę na bundlu; zgodne z kodem -
  `isServerRender()` zawsze z lewej). Delta domknięcia bootu +550 B raw / +247 B gzip (zapas 262 B raw).
- **Pomiar własny na artefakcie build8 (fixture, Chromium 141, `review-probe/home2.cjs`)**: brak strażnika
  (`data-cv-off` = false) przy pierwszym wejściu; telefon 412x823 - sekcje 4-7 faktycznie pominięte przez cały
  czas do 4 s (sekcja 3 renderuje się w tej samej klatce; margines bliskości ~150% widoku); desktop 1350x940 -
  pominięte tylko sekcje 6-7. `scrollWidth` = szerokość widoku na obu (brak poziomego przepełnienia na `/`).
- **CLS/SI.** Pierwsza sekcja z cv na desktopie stoi na zgięciu (y=889, widok 940) i rysuje się w pierwszej
  klatce; za nią wyłącznie elementy z cv - brak nowej późnej zmiany wizualnej w widoku. Dla Lighthouse'a (bez
  fragmentu, bez wpisu przywrócenia) cv jest włączone.
- **SEO/a11y/i18n.** Treść i linki są w HTML-u (cv nie usuwa ich z DOM ani drzewa dostępności), blok
  `hidden` zawiera tylko `<style>`/`<script>`; brak nowych kluczy i18n; /en - ten sam renderer.
- **Zalogowani/redaktorzy.** Wyspy z sesją - test parzystości przechodzi; sekcja odsłonięta po sesji bez
  opakowania (test). Kanwa i podgląd bez cv (testy).
- **Testy.** Jednostkowe sprawdzają mechanizm (styl inline, `data-cv`, kolejność bloku, plan z HTML-u
  serwera z podmienioną liczbą 999 px, kontrole negatywne dla każdego wyłączenia) - cofnięcie zmiany wyłożyłoby
  je. E2E mierzy geometrię (pominięcie, przesunięcia, kotwica, przeładowanie, powrót, druk).

## Bramki uruchomione w review

| bramka                                                                | wynik                                               |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `light.sh bunx eslint` 3 plików pozycji                               | zielone (exit 0, bez ostrzeżeń)                     |
| `light.sh bunx vitest run builderRenderer.contentVisibility.test.tsx` | 39/39                                               |
| `light.sh bun run verify:static`                                      | zielone: 15 bramek w 246,1 s (w tym `format:check`) |
| sonda Chromium na artefakcie build8 (`review-probe/home2.log`)        | jak wyżej                                           |
| sonda syntetyczna `contain-intrinsic-size` (`review-probe/probe.log`) | patrz m1                                            |

Nie uruchamiałem typechecku, buildu ani Lighthouse'a (zgodnie z zadaniem). Logi wykonawcy: `r8/e2e.log`
(pełne `test:e2e:artifact` CI-like 23/23, kotwica x10 20/20, spec cv x3 33/33).

## Uwagi

### m1 [minor] `contain-intrinsic-size` z jedną wartością ustawia też SZEROKOŚĆ wewnętrzną 948 px

- Miejsce: `BuilderRenderer.tsx:962` (`containIntrinsicSize: \`auto ${cvPx}px\``).
- Dowód: skrót z jedną parą (`auto 948px`) dotyczy obu osi. Sonda syntetyczna w Chromium 141 przy 412 px:
  pominięte opakowanie w siatce `grid-template-columns: 1fr` albo w elemencie flex-row rozpycha kolumnę do
  948 px (`scrollWidth` 948); w zwykłym bloku i w `minmax(0,1fr)` 412 px; wariant `auto none auto 948px` daje
  412 px. Dziś bez skutku: na `/` brak przodków grid/flex-row (zmierzone), strony CMS idą przez powłoki
  `flex flex-col` (`$.tsx:1862-1880`, `BuilderPageShell`), wpisy są wyłączone. To ukryta pułapka na każdą przyszłą
  powłokę z siatką `1fr` (np. strona z panelem bocznym) - poziome przepełnienie telefonu. Repo ma już konwencję
  z jawną szerokością (`.cv-auto { contain-intrinsic-size: 1px 600px }`, `styles.css:2384`).
- Poprawka: `containIntrinsicSize: \`auto none auto ${cvPx}px\``(albo`contain-intrinsic-height`/
`contain-intrinsic-block-size: auto Npx`); zaktualizować oczekiwania testu (`cvStyle`) i e2e nie trzeba.
  Koszt kilku bajtów - do zrobienia przy najbliższej rundzie, nie blokuje (brak dzisiejszej ścieżki z błędem).

### m2 [minor] Sekcje z testem A/B nie zamykają ogona

- Miejsce: `serverSectionCv` (`BuilderRenderer.tsx:701-731`).
- Dowód: SSR i pierwszy render klienta pokazują wariant A; po przydziale (po hydratacji) A znika, a B (nie było
  go w HTML-u serwera, więc nie ma go w planie) renderuje się bez opakowania w środku ogona - łamie to zasadę
  „za elementem z cv stoi tylko element z cv”, na której opiera się brak przesunięć. Dzieje się to daleko pod
  zgięciem, więc praktyczny wpływ jest mały.
- Poprawka (tylko serwer, zero bajtów klienta): `if (section.advanced?.abTest) return undefined;` w
  `serverSectionCv` + przypadek w `it.each` wyłączeń.

### m3 [minor] „scroll restoration po powrocie” - powrót SPA tylko w adnotacji

- Miejsce: `e2e/content-visibility.boot-home.spec.ts:333-438`.
- Dowód: notatki wymagają dowodu przywrócenia przewinięcia po powrocie; spec asertuje przeładowanie (±40 px),
  a dla „wstecz” sprawdza tylko brak cv i zapisuje pozycje w adnotacji (baza na fixture też nie trafia - problem
  bazy 3 w IMPL.md). Odstępstwo opisane, ale kryterium zostaje niepokryte asercją.
- Poprawka: asercja względna wobec bazy (np. `|after.y - y_bazy| <= tolerancja` zmierzona na base-w3b) albo
  jawny wpis w raporcie Prove, że kryterium „po powrocie” jest pokryte tylko przeładowaniem.

### m4 [minor, dla Prove] Desktop: pominięte tylko 2 małe sekcje

- Dowód: sonda na artefakcie - przy 1350x940 pominięte są wyłącznie sekcje 6-7 (szacunek po 280 px). Kryterium
  Prove „zadanie pierwszej klatki krótsze we wszystkich przebiegach B” na desktop4x może być na granicy szumu
  (lokalnie wykonawca zmierzył najdłuższy Layout 26,0 -> 12,4 ms, ale suma Layout desktop 35,3 -> 34,7 ms).
- Poprawka: brak w kodzie; etap Prove powinien raportować desktop osobno i nie traktować braku zysku na
  desktopie jako regresji, jeśli mobile spełnia kryterium.

### m5 [minor, dla Prove] Koszt może się przenieść do zadań wysp

- Dowód: widgety mierzące układ w efektach (ticker, slidery) w sekcji pominiętej wymuszą przy hydratacji wyspy
  (kolejka po interakcji/ciszy) wymuszony styl+układ poddrzewa w tym zadaniu. Sumy z trace 2,5 s spadają
  (IMPL), więc netto jest zysk, ale księga Prove powinna sprawdzić, czy zadania wysp w [FCP, TTI] nie urosły.
- Poprawka: tylko kontrola w księdze (`lanternTasks --diff`, zadania z Layout po FCP).

### m6 [minor] Zapas domknięcia bootu po partii

- Dowód: +550 B raw / +247 B gzip; po P3.3 zostaje 262 B raw zapasu dla P3.8 i linków prawnych (wspólne ~812 B).
  Tańsza droga bez opakowań (reguły per sekcja w bloku serwera) wymagałaby atrybutu na szkielecie strumienia,
  czyli zmiany `sectionStreaming.tsx` poza zakresem - obecny koszt jest uzasadniony.
- Poprawka: brak w P3.3; orkiestrator scala z pomiarem `bootClosureRawBytes` po każdej pozycji partii.

### m7 [minor] Ryzyka przeglądarek i formatu routera (opisane w IMPL.md)

- Safari bez zakotwiczenia przewijania (przeskok paskiem/End, potem przewinięcie w górę = skok o różnicę
  szacunku); strażnik zależny od prywatnego formatu TanStacka (przypięty testem do `storageKey`); fragment
  `#access_token=...` albo dowolny inny hash wyłącza cv dla tego wczytania (tylko utrata zysku). Akceptowalne.

## Podsumowanie

Zmiana mieści się w zakresie, mechanizm jest poprawny i dobrze odgrodzony (serwer liczy, klient czyta z HTML-u,
render czysto kliencki bez cv), testy łapią regresję, bramki review zielone. Brak blokerów; m1 i m2 to tanie
poprawki serwerowe/inline, które warto dołożyć przy najbliższej rundzie, m3-m5 są dla etapu Prove.

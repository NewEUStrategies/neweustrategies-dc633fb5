# Listwa linków prawnych w stopce (CopyrightBar) - IMPL

Gałąź `feat/w3-legal-links` (commit `db56047e`), worktree `scratchpad/wt3/legal-links`, baza `56da8d23`
(kod `src/` identyczny z `63a05a32`, czyli z artefaktem `scratchpad/base-w3b`).

## 1. Ustalenia (stan przed zmianą)

- **Komponent istnieje, ale nie jest zamontowany.** `src/components/footer/CopyrightBar.tsx:13-14`
  mówi, że linki prawne na każdej stronie to wymóg operatora płatności; jedynymi odbiorcami
  komponentu były testy (`footer/__tests__/footerChrome.test.tsx`). `src/components/Footer.tsx:153-154`
  (baza) renderował w wyspie `site-footer` wyłącznie dokument buildera.
- **Produkcja nie ma tych linków.** W zapisanym HTML-u strony głównej
  (`scratchpad/w3/prod/d2.html`) stopka linkuje tylko do `/polityka-prywatnosci` (widget
  `ftr-work-4` dokumentu buildera). Brak `/regulamin`, `/zwroty-i-reklamacje`, `/cookies`, `/rodo`.
  Dokument stopki kończy się własnym wierszem praw autorskich (widget `copyright`, `ftr-copy-w`,
  `text-xs text-muted-foreground text-center`, max 1400 px, przezroczyste tło).
- **Trasy prawne istnieją jako trasy kodu:** `src/routes/regulamin.tsx`, `polityka-prywatnosci.tsx`,
  `zwroty-i-reklamacje.tsx`, `cookies.tsx`, `rodo.tsx` (+ `regulamin-subskrypcji-i-zakupow.tsx`,
  `regulamin-wydarzen-i-biletow.tsx` i in.). Kanoniczny rejestr linków stopki to
  `src/lib/seo/footerNavigation.ts:57-93` (grupa `legal`: regulamin, polityka prywatności, zwroty
  i reklamacje, cookies, wytyczne reklam, subskrypcje i zakupy, RODO, moderacja treści; etykiety
  PL/EN). Wersje EN: prefiks `/en` dokłada przepisanie wyjścia routera (`src/router.tsx:132-143`,
  `addLangPrefix` z `src/lib/i18n/localePath.ts`), więc `Link to="/regulamin"` daje `/en/regulamin`.
- **Historia.** Klon jest płytki (`git rev-parse --is-shallow-repository` = true; historia od
  `3830690e`). Przez API GitHuba: `5b6b114e` (2026-09-08) zdjął import, a `50aaf602` (2026-09-08)
  zdjął `<CopyrightBar>` ze stopki (także z wariantu `compact`). Oba to commity panelu Lovable
  z opisem „Changes”, bez uzasadnienia; zmieniają wyłącznie `Footer.tsx`. Najbardziej prawdopodobny
  powód: pasek dublował wiersz praw autorskich, który dokument stopki ma własny, i dokładał pas tła
  `bg-card`. Ślad w testach: `Footer.test.tsx:322` (baza) nadal mówi o „DWÓCH linkach `/regulamin`
  (fixture dokumentu i listwa prawna)”, a nagłówek tego testu (`:46`) wymieniał `CopyrightBar` jako
  prawdziwy składnik stopki - nieaktualne od 8.09.
- **Inne powierzchnie.** `Footer` renderują `SiteChrome.tsx:132` (wszystkie strony publiczne),
  `routes/quiz.tsx:362` (trasa z własnym chrome) i podgląd chrome w edytorze
  (`admin/builder/Builder.tsx:732`, `ChromeFrame` - podgląd publicznej stopki). `/admin/*` i `/login`
  stopki nie mają (`SiteChrome`). Strony z szablonem `landing` chowają całą stopkę CSS-em
  (`styles.css:2467`).

Wniosek: linków nie ma na żadnej stronie publicznej poza polityką prywatności z dokumentu
buildera - zmiana jest potrzebna.

## 2. Decyzja

Montuję **samą listwę linków prawnych** (wspólną z `CopyrightBar`), a nie cały `CopyrightBar`:

- cały `CopyrightBar` powtórzyłby „© 2026” pod wierszem praw autorskich dokumentu stopki i dołożył
  pas `bg-card` - prawdopodobnie dokładnie to, co właściciel usunął 8.09;
- listwa stoi w `<footer data-site-footer>`, w wyspie `site-footer`, pod dokumentem buildera,
  w szerokości i wcięciu wiersza praw autorskich (`max-w-[1400px] px-5`), wyśrodkowana,
  `text-xs text-muted-foreground`, hover `text-foreground`, fokus `ring-ring`. Geometria jest wspólna
  dla obu motywów, różnią się wyłącznie kolory z tokenów (AGENTS.md);
- treść z rejestru `FOOTER_LINKS` (grupa `legal`), niezależnie od dokumentu buildera - redakcja nie
  może jej przypadkiem usunąć, przebudowując stopkę.

### Bez JS-a w domknięciu bootu

- Serwer renderuje listwę statycznie (`import.meta.env.SSR ? <LegalLinks/> : <LegalLinksChunk/>`,
  `Footer.tsx:181-187`) - linki są w HTML-u SSR (SEO, zgodność, czytelnik bez JS-a).
- Klient: `React.lazy` (`Footer.tsx:60`), podany wyspie w `chunks` (`Footer.tsx:107`, kontrakt
  `hydrationIsland`: każdy `lazy` w wyspie jako komponent), więc wyspa gruntuje chunk przed
  hydratacją i HTML serwera hydratuje bez zawieszenia. Chunk ładuje się dopiero z wyspą stopki
  (widoczność / interakcja / cisza), nie w commicie hydratacji strony.
- **Pułapka zmierzona na artefakcie:** bez nazwy `experimentalMinChunkSize` wkleił ~1 KB listwy
  do `index-*.js` (wejście jest zawsze załadowane, gdy pada `import()`). Stąd nazwany chunk
  `legal-links` w `vite.config.ts` i `vite.smoke.config.ts` (obie konfiguracje identycznie, jak
  `vendor-sonner` i `club-thread-kind-icon`). Nazwany chunk wciąga statyczne zależności spoza innych
  nazwanych chunków, dlatego `LegalLinks.tsx` importuje wyłącznie z `vendor-react`,
  `vendor-tanstack`, `vendor-i18n` i typy, a rejestr linków dostaje w propsach. Na artefakcie:
  `legal-links-*.js` (848 B) importuje tylko te trzy chunki vendorowe, a wejście odwołuje się do niego
  wyłącznie przez `lazy(() => import(...))`.
- Własna granica `Suspense` wokół listwy: przy świeżym montażu po nawigacji SPA (np. z `/admin`,
  z `/quiz`) wyspa otwiera się od razu bez czekania na chunki - bez tej granicy fallback wyspy
  zastąpiłby na chwilę CAŁY dokument stopki. Listwa dochodzi wtedy na samym dole, niczego nie
  przesuwa.
- Zero nowych zapytań: listwa nie czyta ustawień (rejestr jest w kodzie, język z `useLang`).

### Dostępność i i18n

- `<nav aria-label>` z nazwą ze słownika (`footer.legal_nav`: PL „Informacje prawne”, EN „Legal
  information”, `src/lib/locale/pl.ts`, `en.ts` - rdzenie są leniwymi chunkami języka, poza
  domknięciem bootu), lista `<ul>/<li>`, prawdziwe `<a href>` (router `Link`), cel dotyku 24 px
  (`min-h-6`), widoczny fokus. Etykiety linków z rejestru (to samo źródło co JSON-LD i raport
  kliknięć).
- `CopyrightBar` renderuje tę samą listwę (`LegalLinks`), więc ma tę samą nazwę ze słownika zamiast
  napisu w kodzie.

## 3. Co zmieniono

| Plik                                                         | Zmiana                                                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/footer/LegalLinks.tsx` (nowy)                | listwa: nav + lista linków grupy `legal`, `Link` routera, nazwa ze słownika, eksport nazwany i domyślny                                                                                             |
| `src/components/Footer.tsx`                                  | listwa w wyspie `site-footer` pod dokumentem buildera: statycznie na serwerze, `lazy` + `chunks` + `Suspense` na kliencie                                                                           |
| `src/components/footer/CopyrightBar.tsx`                     | używa `LegalLinks` (jedno źródło listwy)                                                                                                                                                            |
| `src/lib/locale/pl.ts`, `en.ts`                              | klucz `footer.legal_nav`                                                                                                                                                                            |
| `vite.config.ts`, `vite.smoke.config.ts`                     | nazwany chunk `legal-links` (uzasadnienie w komentarzu)                                                                                                                                             |
| `src/components/footer/__tests__/LegalLinks.test.tsx` (nowy) | prawdziwy router z przepisaniem języka: adresy PL i `/en/...`, nazwa nawigacji, kolejność z rejestru, lista, fokus, axe                                                                             |
| `src/components/__tests__/Footer.test.tsx`                   | montaż listwy w stopce (PL, EN, stopka domyślna), poza dokumentem buildera, telemetria `legal`; nagłówek poprawiony                                                                                 |
| `src/components/__tests__/footerIsland.test.tsx`             | atrapa `Link`; listwa w HTML-u serwera w wyspie i TEN SAM węzeł po hydratacji, bez błędów odzyskiwalnych                                                                                            |
| `src/components/footer/__tests__/footerChrome.test.tsx`      | nazwa nawigacji ze słownika                                                                                                                                                                         |
| `e2e/legal-links.boot-home.spec.ts` (nowy)                   | artefakt: linki w HTML-u SSR `/` i `/en` (w `<footer>`, w nazwanym `<nav>`, prefiks `/en`), brak chunku listwy w `#nes-boot-set`, po hydratacji wyspy te same adresy, fokus, zero błędów hydratacji |

## 4. Pomiar (artefakt `BUNDLE_INVENTORY=1 build:smoke`, fixture, 5 próbek HIT)

Baza = `base-w3b` (63a05a32, ten sam `src/`), zmierzona tym samym skryptem (`--root`).

| Metryka                    | baza      | zmiana    | delta    | próg      |
| -------------------------- | --------- | --------- | -------- | --------- |
| bootClosureRawBytes        | 1 636 946 | 1 637 165 | **+219** | 1 637 758 |
| bootClosureGzipBytes       | 496 041   | 496 155   | **+114** | 496 679   |
| bootBurstGzipBytes         | 574 062   | 574 164   | +102     | 574 673   |
| htmlRawBytes               | 337 696   | 339 967   | +2 271   | 406 180   |
| htmlGzipBytes              | 52 557    | 52 847    | +290     | 57 710    |
| preLcpTransferBytes        | 177 715   | 178 014   | +299     | 181 594   |
| renderBlockingCssGzipBytes | 80 426    | 80 435    | +9       | 81 399    |

- W domknięciu bootu zmienia się wyłącznie `index-*.js`: +219 B surowo to samo okablowanie
  (`lazy(() => import(...))` z `__vite__mapDeps`, nazwa pliku chunku w tablicy `mapDeps`,
  `.concat(...)` w `chunks`, `<Suspense>` + element w JSX). Kod listwy jest poza bootem.
  Gzip waha się o dziesiątki bajtów zależnie od kolejności treści (wariant z aliasem dawał +67 B
  gzip przy +227 B surowo).
- HTML +2,3 KB surowo / +0,3 KB gzip to same linki (8 pozycji) - cel zadania. Seria bootu
  (+102 B gzip) to ta sama zmiana `index-*.js` plus nowy klucz w rdzeniu słownika języka strony.
- `check-document-weight`: wszystkie metryki w progach. `check:bundle`, `check:chunks`,
  `check:entry-purity`: zielone.

## 5. Bramki

- `bunx prettier --write` na dotkniętych plikach (bez zmian po formatowaniu), `eslint` - 0 błędów.
- typecheck (`typecheck-noinc.sh`): zielony (przed ostatnimi poprawkami testów i po nich).
- vitest (19 plików powiązanych, 337 testów): zielone - `LegalLinks`, `Footer`, `footerIsland`,
  `footerChrome`, `SiteChrome`, `siteChromePersistence`, `builderShell`, `viteChunkParity`,
  `bootVendorSplit`, `i18nParity.gate`, `i18nKeyDrift.gate`, `i18nServerRuntime`,
  `i18nClientRuntime`, `i18nOverlayIntegrity.gate`, `i18nOverlayCollisionRegressions`,
  `footerNavigation` i in.
- `verify:static`: 15 bramek OK.
- build `build:smoke` + `check-document-weight` + bramki bundla: zielone.
- e2e artefaktu (`NES_ARTIFACT_FIXTURE=1`, `legal-links.boot-home` + `boot-home`): 5/5.

## 6. Ryzyka i decyzje do potwierdzenia

1. **Zapas `bootClosureRawBytes` przy łączeniu z P3.3.** Na tej bazie zostaje 593 B zapasu (1 637 758 - 1 637 165). Pomiar
   P3.3 (`phase3/wave3/P3.3/document-weight.json`) to 1 637 603 B, czyli +657 B wobec bazy. Obie
   zmiany razem dałyby ~1 637 822 B, ok. **64 B ponad próg**. Okablowania nie da się zejść niżej bez
   utraty poprawności. Jedyna dalsza oszczędność to zdjęcie granicy `Suspense` (~45 B), za cenę
   chwilowego zniknięcia całej stopki przy świeżym montażu po nawigacji SPA. Gzip mieści się
   razem z P3.3 (~496 446 przy progu 496 679). Do decyzji orkiestratora: kolejność scalania albo
   świadome podniesienie progu o pomiar.
2. **Szablon `landing`** chowa całą stopkę (`styles.css:2467`), więc i listwę - jak dotąd politykę
   prywatności z dokumentu. Jeśli operator wymaga linków także tam, trzeba osobnej decyzji
   (np. listwa poza `<footer>` przy ukrytej stopce).
3. **Podgląd chrome w edytorze** (`Builder.tsx:732`) pokazuje publiczną stopkę, więc pokaże też
   listwę - to wierny podgląd, a nie powierzchnia administracyjna. Panel `/admin/*` stopki nie ma.
4. **Telemetria EN:** klik w `/en/regulamin` trafia do grupy `unknown`, bo rejestr zna ścieżki bez
   prefiksu - tak samo jak dziś każdy link EN w stopce (stan istniejący, poza zakresem).
5. `CopyrightBar` nadal nie jest montowany (pełny pasek dublowałby wiersz praw autorskich dokumentu
   stopki); dzieli z publiczną stopką listwę `LegalLinks`.

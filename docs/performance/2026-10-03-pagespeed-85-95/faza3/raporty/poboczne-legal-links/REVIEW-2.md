# Recenzja 2: listwa linków prawnych w stopce (CopyrightBar), commit `db56047e`

Gałąź `feat/w3-legal-links`, baza `56da8d23`, artefakt `wt3/legal-links/.output` (zbudowany z `db56047e`, nie przebudowywałem go).
Recenzja adwersaryjna z dwóch stron: (A) zgodność i UX, (B) wydajność i bezpieczeństwo SSR. W worktree niczego nie edytowałem ani nie commitowałem.

## Werdykt: **request_changes**

Kierunek jest dobry i dobrze zmierzony. Linki są w surowym HTML-u SSR na `/` i `/en`, a ich adresy EN są poprawne. Hydratacja zachowuje węzeł serwera bajt w bajt, a geometria w obu motywach jest identyczna. Kod listwy leży poza domknięciem bootu, a delty wagi się zgadzają. Na żywej produkcji nie wolno jednak scalić dwóch rzeczy:

1. Gdy chunk `legal-links-*.js` nie przyjdzie, **cała strona** (nagłówek, treść, stopka) zmienia się w ekran błędu korzenia. Wyjątek nie ma lokalnej granicy błędu. Odtworzyłem to na artefakcie.
2. Na telefonie 412 px **pływający przycisk „Wróć na górę” zakrywa link RODO/GDPR**. To jeden z pięciu wymaganych dokumentów, więc nie da się go stuknąć, a fokus klawiatury ląduje pod przyciskiem. Przycisk jest włączony na produkcji.

Obie poprawki kosztują kilka linii, a pierwsza około 40 B w wejściu (rachunek niżej).

---

## Dowody (co zrobiłem)

| Co                                                                                                                                                                                                                                                                                                                          | Gdzie                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Diff `56da8d23..db56047e` (12 plików), pełny `Footer.tsx`, `LegalLinks.tsx`, `hydrationIsland.tsx` (bramka, `chunks`, straż kliku), `i18n.ts` (rdzeń języka przed hydratacją), `RenderErrorBoundary`, `__root.tsx` (globalny `ErrorBoundary`), `cacheBusting.ts`                                                            | kod w worktree                                                                               |
| Zbudowany chunk `legal-links-Cqw847lN.js` (848 B, importuje tylko `vendor-react`, `vendor-tanstack` i `vendor-i18n`) oraz okablowanie w `index-Cicti5oJ.js`, rozpisane bajt po bajcie                                                                                                                                       | `.output/public/assets`                                                                      |
| Delty `document-weight-base.json` → `document-weight-2.json`, `check:bundle.log`, `check:chunks.log`, `check:entry-purity.log`                                                                                                                                                                                              | `phase3/side/legal-links/`                                                                   |
| Zrzuty z poprzedniej próby (obejrzane: `pl/en-1350-light/dark-bar`, `pl-412-light/dark-bar`, `pl-412-light`, `*-focus`, `*-hover`) i `shots/metrics.json`                                                                                                                                                                   | `phase3/side/legal-links/shots/`                                                             |
| **Własna sonda** na artefakcie przez mutex: surowy HTML SSR (`/`, `/en`, `/regulamin`, `/en/polityka-prywatnosci`); zrzuty 412 px z decyzją o cookies (bez banera); tożsamość węzła `<nav>` i `MutationObserver` przez hydratację; obserwator `layout-shift`; liczba żądań chunku; próba awarii chunku (`abort` oraz `404`) | `review2/probe.mjs`, `review2/out/probe.json`, `review2/out/*.png`, `review2/out/ssr_*.html` |
| vitest (5 dotkniętych plików, 68 testów): zielone                                                                                                                                                                                                                                                                           | `review2/vitest.log`                                                                         |
| e2e `legal-links.boot-home.spec.ts` na istniejącym artefakcie, w środowisku jak w CI: 2/2 zielone                                                                                                                                                                                                                           | `review2/e2e-playwright.log`                                                                 |
| Produkcja (GET, tylko odczyt): `/wytyczne-dotyczace-reklam`, `/moderacja-komentarzy`, `/regulamin-subskrypcji-i-zakupow` i `/en/wytyczne-dotyczace-reklam` dają 200; zapisany HTML strony głównej `w3/prod/d2.html` (link CMS do polityki prywatności, `BackToTop` włączony)                                                | `review2/prod_*.html`                                                                        |

Serwery, które startowałem, są zabite. Jeden osierocony proces sondy (port 4331) dobiłem ręcznie.

---

## Ustalenia

### BLOKUJĄCE

**B1. Awaria leniwego chunku listwy zmienia CAŁĄ stronę w ekran błędu.** `src/components/Footer.tsx:179-188`

Wyspa `site-footer` gruntuje `LegalLinksChunk` (`Footer.tsx:107`). Jeśli import się nie powiedzie (`Promise.allSettled` w `hydrationIsland.tsx:717`), wyspa zgłasza błąd przez `reportError`, otwiera bramkę mimo to, a `React.lazy` rzuca odrzuceniem przy hydratacji. Między listwą a korzeniem nie ma żadnej granicy błędu. Nie ma jej `HydrationIsland`. `BuilderRenderer` owija w `RenderErrorBoundary` tylko swoje sekcje (`BuilderRenderer.tsx:521`, `:603`), a listwa stoi obok renderera. Wyjątek dochodzi więc do globalnego `<ErrorBoundary>` w `__root.tsx:1487`, który według opisu w `RenderErrorBoundary.tsx` „podmienia CAŁĄ stronę na fallback”.

Wynik na artefakcie (`review2/out/probe.json` → `failure`, zrzut `review2/out/fail-abort.png`), przy `route.abort` i przy `404` dla `legal-links-*.js`:

- pierwsze wejście: `pageerror: Failed to fetch dynamically imported module …legal-links…` i twarde przeładowanie przez `cacheBusting` (`/?_v=…`);
- po przeładowaniu, gdy straż 15 s blokuje kolejne, strona nie ma ani `main#main-content`, ani `header`, ani `footer`. Zostaje tylko ekran „NIE UDAŁO SIĘ ZAŁADOWAĆ STRONY / Problem z połączeniem”.

Na bazie stopka nie miała żadnej zależności leniwej, bo `registerIslandChunks` nie jest nigdzie wołane w kodzie produkcyjnym. Ta klasa awarii jest więc nowa i dotyczy każdej strony publicznej. Przy awarii przejściowej (sieć komórkowa, wyścig z deployem w pierwszych ~0,8 s, bo chunk ładuje się w punkcie ciszy nawet bez przewijania) użytkownik dostaje wymuszone przeładowanie. Przy trwałej (filtr, proxy, CDN) dostaje ekran błędu zamiast strony. A wszystko to przez komponent, który nie jest krytyczny.

**Poprawka (~40 B surowo w `index-*`, bez nowego modułu, bo `RenderErrorBoundary` już jest w wejściu, `builder_render_boundary` w `index-Cicti5oJ.js`):**

```tsx
import { RenderErrorBoundary } from "@/components/error/RenderErrorBoundary";
// …
<RenderErrorBoundary label="footer:legal-links">
  <Suspense fallback={null}>
    {import.meta.env.SSR ? (
      <LegalLinks links={FOOTER_LINKS} lang={lang} />
    ) : (
      <LegalLinksChunk links={FOOTER_LINKS} lang={lang} />
    )}
  </Suspense>
</RenderErrorBoundary>;
```

Granica nie daje elementu DOM, więc parzystość SSR i klienta zostaje. Na produkcji fallback to „nic”. Przy awarii znika sama listwa, a reszta strony zostaje, z telemetrią `reportPlatformError`. Siatka przeładowania przy rozjeździe wersji nadal działa, bo raport wyspy zostaje.

Test regresji, który teraz by padł: vitest w `footerIsland.test.tsx`, w którym atrapa importu listwy odrzuca obietnicę. Po hydratacji sekcja buildera (`data-probe="footer-section"`) ma zostać tym samym węzłem, a do korzenia nie ma dojść żaden rzut. Opcjonalnie jeszcze przypadek e2e z `page.route(/legal-links-.*\.js$/, r => r.abort())`, w którym `main#main-content` musi przetrwać.

**B2. Na telefonie przycisk „Wróć na górę” zakrywa link RODO/GDPR. Nie da się go stuknąć, a fokus jest zasłonięty.** `src/components/footer/LegalLinks.tsx:45` (`pb-4`) wobec `src/components/footer/BackToTop.tsx:44` (`fixed bottom-6 right-6 h-11 w-11`)

Dowód: `review2/out/m-pl-412-light-bar.png`, `m-pl-412-dark-bar.png` i `m-en-412-light-bar.png` (zrzuty z decyzją o cookies, czyli bez banera). Przy 412 px listwa zawija się na 3 wiersze, a „RODO” stoi na końcu wiersza 2 (x 354-390, `probe.json`). Przycisk zajmuje x 344-388 i pas 24-68 px od dołu ekranu. Listwa jest ostatnią treścią dokumentu (`navBottomToDocEnd` ≈ 0), więc przy maksymalnym przewinięciu wiersz z RODO leży dokładnie pod przyciskiem. Wyżej podjechać nie może, a przycisk jest widoczny przy `scrollY > 400`, czyli zawsze, gdy widać stopkę. W EN tak samo kończy „GDPR”. Produkcja ma `BackToTop` w HTML-u (`w3/prod/d2.html`, `bottom-6 right-6 h-11 w-11`), więc to się stanie na żywo.

Skutki są trzy: tap trafia w „Wróć na górę” zamiast w RODO; fokus klawiatury na RODO jest prawie w całości zasłonięty treścią autora (WCAG 2.2 **2.4.11 Focus Not Obscured (Minimum), AA**); a jeden z dokumentów wymaganych przez operatora płatności (`REQUIRED` w e2e) jest na telefonie praktycznie nieosiągalny. Na tabletach, gdy listwa zawija się na 2 wiersze, prawy koniec pierwszego wiersza też może wejść w pas przycisku.

**Poprawka** (geometria identyczna w obu motywach, 0 B w wejściu):

- w `NAV_CLASS` zmienić `pb-4` na `pb-20`. To 80 px: przycisk 44 px + odstęp 24 px + 12 px luzu, więc ostatnie wiersze zawsze kończą się nad przyciskiem. Klasa `pb-20` jest nowa w CSS (+1 reguła ≈ +20 B gzip w CSS blokującym render; zapas „css total” to 1,0 KB). Wariant bez kosztu CSS to istniejące `pb-16` (64 px). Ono odsłania przedostatni wiersz, ale ostatni tylko wtedy, gdy nie sięga prawego pasa 68 px. Polecam `pb-20`.
- test regresji (e2e na artefakcie, 412 px): przewinąć do końca, potem dla każdego linku listwy `document.elementFromPoint(środek)` musi zwrócić ten link (`closest("a") === link`). Dziś taki test pada na RODO.

### MAJOR

**M1 (budżet scalenia). +219 B surowo w `index-*` przy wspólnym zapasie ~812 B. Skąd się bierze i co da się ściąć.**

Delty sprawdziłem w `document-weight-base.json` → `document-weight-2.json`. Wszystkie się zgadzają: `bootClosureRawBytes` 1 636 946 → 1 637 165 (**+219**), gzip 496 041 → 496 155 (**+114**), `bootBurstGzipBytes` +102, `htmlRawBytes` +2 271, `htmlGzipBytes` +290, `preLcpTransferBytes` +299, CSS +9 B gzip, `elementCount` +18 (nav, ul, 8 × li, 8 × a). W domknięciu zmienia się tylko `index-*.js` (863 586 → 863 805). `check:bundle`, `check:chunks` i `check:entry-purity` są zielone.

Rozkład +219 B na podstawie `index-Cicti5oJ.js`:

| Fragment                                                                                        | B   |
| ----------------------------------------------------------------------------------------------- | --- |
| `const Pm=p.lazy(()=>d(()=>import("./legal-links-Cqw847lN.js"),__vite__mapDeps([158,1,2,7])));` | 93  |
| wpis `"assets/legal-links-Cqw847lN.js",` w tablicy `__vite__mapDeps`                            | 33  |
| `,i.jsx(p.Suspense,{fallback:null,children:i.jsx(Pm,{links:Ll,lang:t})})`                       | 71  |
| `.concat(Pm)`                                                                                   | 11  |
| `jsx` → `jsxs` + `[...]` dzieci wyspy, nazwy po minifikacji                                     | ~11 |

Konkretne cięcia:

1. **Bez preloadu zależności dla `legal-links`: około −59 B.** Zależności `[1,2,7]` to `vendor-react`, `vendor-tanstack` i `vendor-i18n`. Leżą w domknięciu bootu, więc ich preload niczego nie daje. W obu konfiguracjach (parzystość) wystarczy `build.modulePreload.resolveDependencies: (file, deps) => (file.includes("legal-links-") ? [] : deps)`. Vite 7.3.6 wyemituje wtedy `d(()=>import("./legal-links-….js"),[])`, tak jak już dziś dla `themeOptionsCss`, czyli −26 B. Plik zniknie też z tablicy `mapDeps`, co daje kolejne −33 B. Do potwierdzenia na artefakcie, że `file` to plik importowany dynamicznie. Zachowanie się nie zmienia: to samo jedno żądanie chunku.
2. **Zdjęcie wewnętrznego `<Suspense fallback={null}>`: około −41 B.** Kosztem jest chwilowe zniknięcie całej stopki (fallback wyspy) przy świeżym montażu po nawigacji SPA z tras bez stopki (`/admin`, `/login`), i to tylko do pierwszego pobrania chunku. Stopka jest wtedy poniżej zgięcia. Do decyzji orkiestratora. Po dodaniu granicy z B1 ta granica `Suspense` jest mniej potrzebna niż granica błędu.
3. Bilans: B1 to +~40 B. B1 z cięciem 1 daje ≈ −19 B względem dziś (+~200 B). B1 z cięciami 1 i 2 daje ≈ −60 B (+~159 B). Rachunek implementera z P3.3 (64 B ponad próg) zamyka się dopiero przy obu cięciach i to na styk, więc bez nich potrzebna jest kolejność scalania albo świadome podniesienie progu.

Czego **nie** ciąć: gałęzi `import.meta.env.SSR`. `React.lazy` na serwerze zawiesiłby się i zamiast linków w HTML-u dałby fallback. Nie ciąć też `.concat(LegalLinksChunk)`, bo to kontrakt wyspy „każdy `lazy` w `chunks`” (straż kliku i synchroniczna hydratacja).

### MINOR

**m1. Wyspa stopki czeka teraz na sieć, a w kodzie jest nowe żądanie.** `Footer.tsx:107`. Na bazie wyspa `site-footer` miała zero chunków (`islandChunksFor` zawsze zwracało `[]`), więc bramka otwierała się synchronicznie po wyzwalaczu. Teraz każda hydratacja stopki (newsletter, widgety) czeka na `legal-links-*.js`. Tor pilny straży kliku (pierwszy tap w link albo pole stopki przed otwarciem wyspy) czeka na RTT, w skrajnym razie do `CLICK_REPLAY_DEADLINE_MS` = 3 s. Zawieszone połączenie trzyma wyspę nieuwodnioną. Sonda pokazuje 1 żądanie chunku na odsłonę, około 757 ms od startu nawigacji, bez przewijania (punkt ciszy). Nie wpływa to na `preLcpTransferBytes`. Zdanie z IMPL „Zero nowych zapytań” dotyczy wyłącznie danych i trzeba je doprecyzować. Poprawka: dopisać w IMPL i w komentarzu przy `Footer.tsx:38-59` koszt (1 żądanie po boocie, ~0,5 KB gzip, cache `immutable`) i świadomą decyzję.

**m2. Pierścień fokusu ma niski kontrast w jasnym motywie i przykleja się do liter.** `LegalLinks.tsx:48-49`. Zrzut `pl-1350-light-focus.png` i `metrics.json` pokazują pierścień 2 px `rgb(253,176,120)` na tle `rgb(248,246,244)`, czyli około **1,7:1** (WCAG 1.4.11 wymaga 3:1 dla wskaźnika stanu). W ciemnym motywie jest to około 9:1. Kolor pochodzi z tokenu `--ring` motywu, więc problem jest systemowy, ale tu wskaźnik jest jedynym sygnałem fokusu. Poprawka: dodać `focus-visible:underline`. Klasa już istnieje w CSS, więc nic nie kosztuje, a podkreślenie w kolorze tekstu ma kontrast ~16:1 w obu motywach. Opcjonalnie `px-0.5` lub `-mx-0.5`, żeby pierścień nie dotykał liter.

**m3. Cele dotykowe mają 24 px wysokości i wiersze bez odstępu (412 px).** `LegalLinks.tsx:46`. Wiersze stoją na y 6687,9 / 6711,9 / 6735,9, czyli stykają się. Minimum WCAG 2.5.8 AA jest spełnione dokładnie, ale to daleko od 44 px zalecanych dla dotyku. Na desktopie `min-h-6` przy płynnym korzeniu (15,33 px) daje **23 px**, a nie 24, jak twierdzi komentarz i IMPL. Przechodzi tylko dzięki wyjątkowi odstępów 2.5.8 (jeden wiersz, `gap-x-4`). Poprawka: `gap-y-2` w `LIST_CLASS` (klasa istnieje w CSS), co daje wysokość listwy 88 → 104 px na 412, oraz poprawka komentarza o 24 px.

**m4. Baner cookies przy pierwszej wizycie zasłania listwę.** Na 412 px zasłania ją całą (`pl-412-light-bar.png`), na 1350 px jej prawą część. Baner sam linkuje do polityki prywatności, ale regulaminu i RODO nie widać, dopóki odwiedzający nie zdecyduje albo nie zamknie banera. To nakładka sprzed zmiany, a listwa po prostu stała się ostatnią treścią strony. Do osobnego zadania: `scroll-padding-bottom` lub dolne wcięcie ciała strony równe wysokości banera, gdy jest widoczny (WCAG 2.4.11).

**m5. e2e nie pilnuje prawdziwej regresji wagi.** `e2e/legal-links.boot-home.spec.ts:97` sprawdza tylko, czy w serii bootu nie ma pliku z „legal-links” w nazwie. Pułapka opisana w IMPL (`experimentalMinChunkSize` wkleja kod listwy do `index-*`) przeszłaby ten test, bo nazwa pliku byłaby wtedy inna. Złapałby to tylko zbieg z progiem `bootClosureRawBytes`. Poprawka: w tym samym teście pobrać `sets[0].e` (wejście) i sprawdzić, że nie zawiera literału `footer.legal_nav` ani fragmentu `min-h-6 items-center rounded-sm underline-offset-2`. Oba są dziś wyłącznie w `legal-links-Cqw847lN.js` i nie ma ich w `index-Cicti5oJ.js` (sprawdziłem grepem na artefakcie).

**m6. Szablon `landing` chowa całą stopkę razem z listwą** (`styles.css:2467`, `SiteChrome.tsx:63`). Stan sprzed zmiany, opisany w IMPL jako ryzyko 2. Jeśli strony landing sprzedają (wydarzenia, subskrypcje), wymóg operatora „na każdej stronie” nie jest tam spełniony. Decyzję musi podjąć właściciel. Ta zmiana tego nie blokuje.

### NIT

- **n1.** Na desktopie listwa ma 11,5 px / 15,3 px (`text-xs` w rem przy płynnym korzeniu), a wiersz praw autorskich z dokumentu 12 px / 18 px (`metrics.json`, 1350). To półpikselowa różnica pod sąsiednim wierszem. Do akceptacji albo do wyrównania w osobnym przejściu typografii.
- **n2.** Na produkcji link `/polityka-prywatnosci` („Polityka prywatności”) w kolumnie dokumentu CMS (`w3/prod/d2.html`) i ten sam link w listwie dadzą duplikat. Ta sama nazwa i ten sam cel w osobnym landmarku są zgodne z WCAG 3.2.4, więc to świadomy i dostępny duplikat. Redakcja może kiedyś usunąć link z kolumny CMS. Telemetria liczy oba linki jako `legal`.
- **n3.** Na produkcji `/en/wytyczne-dotyczace-reklam` ma polski `<title>` („Wytyczne dotyczące reklam”, `review2/prod_en_wytyczne-dotyczace-reklam.html`), czyli strona CMS nie ma tłumaczenia. Etykieta EN „Advertising guidelines” prowadzi do polskiej treści. To zadanie treściowe, nie kodowe.
- **n4.** `<ul class="list-none">` w Safari/VoiceOver traci semantykę listy. `role="list"` na `<ul>` kosztuje kilkanaście bajtów w chunku i HTML-u, a w wejściu 0 B.
- **n5.** Z +2 271 B surowego HTML-u około 1,5 KB to 8 × `LINK_CLASS`. W gzipie to tylko +290 B, a próg HTML ma duży zapas, więc niczego nie zmieniać.
- **n6.** Hover nie zmienia koloru, bo w stopce `text-muted-foreground` daje kolor pierwszoplanowy, ten sam co `hover:text-foreground`. Zostaje samo podkreślenie. To spójne z wierszem praw autorskich i do akceptacji.

---

## Co jest dobrze (zweryfikowane, nie z raportu)

- **Zgodność, surowy HTML SSR** (`review2/out/ssr_*.html`, bez JS):
  - `/`: `<nav aria-label="Informacje prawne">` wewnątrz `<footer data-site-footer>`, pod wierszem praw autorskich, ze wszystkimi 8 linkami grupy `legal` w kolejności rejestru (`/regulamin`, `/polityka-prywatnosci`, `/zwroty-i-reklamacje`, `/cookies`, `/wytyczne-dotyczace-reklam`, `/regulamin-subskrypcji-i-zakupow`, `/rodo`, `/moderacja-komentarzy`).
  - `/en`: `aria-label="Legal information"`, wszystkie adresy z prefiksem `/en/…`, etykiety EN.
  - Tak samo na `/regulamin` i `/en/polityka-prywatnosci`.
  - Wszystkie 16 tras (PL i EN) odpowiada 200 z właściwym `lang` (`shots/metrics.json` → `http`).
  - Linków brak w `modulepreload` i w `#nes-boot-set`.
- **Parzystość SSR i klienta, brak mignięcia:** na 412 px (PL i EN, jasny i ciemny) oraz na 1350 px `<nav>` po hydratacji wyspy to **ten sam węzeł** co z HTML-u serwera, z identycznym `outerHTML`. `MutationObserver` nie zarejestrował usunięcia, wstawienia ani zmiany `aria-label`, `href` czy `class`. Fallback `Suspense` nie podmienia HTML-u, bo wyspa gruntuje `lazy` przed bramką. Rdzeń języka strony ładuje się przed `hydrateRoot` (`i18n.ts`, top-level await), więc `aria-label` z `t()` zgadza się z SSR.
- **Brak CLS z listwy:** listwa jest w SSR i nie zmienia rozmiaru po hydratacji. Pojedyncze wpisy `layout-shift` w stopce (0,003 i 0,029 w dwóch z czterech przebiegów 412) wywołuje treść nad listwą, a `<nav>` przesuwa się biernie. W `metrics.json` pozycje listwy w jasnym i ciemnym motywie są identyczne.
- **Geometria wspólna dla motywów (AGENTS.md):** prostokąty `nav`, `ul` i każdego linku oraz rozmiar i interlinia pisma są identyczne w jasnym i ciemnym motywie, przy 412 i 1350 px (`metrics.json`). Różnią się tylko kolory z tokenów.
- **Kontrast tekstu:** 16,49:1 w jasnym i 15,12:1 w ciemnym motywie.
- **Zawijanie:** przy 1350 px jeden wyśrodkowany wiersz, przy 412 px trzy. Brak poziomego przewijania (`scrollWidth == innerWidth`).
- **Kolejność Tab:** po linkach stopki przechodzi przez 8 linków listwy, a potem do przycisków.
- **Landmark i i18n:** nazwa nawigacji ze słownika (`footer.legal_nav` w `pl.ts` i `en.ts`), lista `ul`/`li`, prawdziwe `<a href>` przez router.
- **Chunk:** reguła `legal-links` jest identyczna w `vite.config.ts:368` i `vite.smoke.config.ts:174` (`viteChunkParity` zielony). Chunk importuje wyłącznie trzy chunki vendorowe, a wejście odwołuje się do niego tylko przez `lazy(() => import())`.
- **Testy są behawioralne i padłyby po cofnięciu zmiany.** Bez montażu listwy padają `Footer.test.tsx` (4 nowe przypadki `findByRole("navigation", …)`), `footerIsland.test.tsx` (`serverLegalNav` nie może być `null`, ten sam węzeł po hydratacji) i e2e (nav w surowym HTML-u). `LegalLinks.test.tsx` używa prawdziwego routera z przepisaniem `/en`. Moje uruchomienia: vitest 68/68 i e2e 2/2.

## Podsumowanie poprawek (kolejność)

1. B1: `RenderErrorBoundary` wokół `Suspense` listwy w `Footer.tsx` oraz test z odrzuconym importem.
2. B2: `pb-4` → `pb-20` w `NAV_CLASS` oraz e2e `elementFromPoint` przy 412 px.
3. M1: `modulePreload.resolveDependencies` dla `legal-links` w obu konfiguracjach (−~59 B). Ewentualnie zdjęcie wewnętrznego `Suspense` (−~41 B) decyzją orkiestratora. Potem ponowny pomiar `check-document-weight`.
4. m2, m3 i n4 są tanie (klasy `focus-visible:underline` i `gap-y-2` już są w CSS, `role="list"`). Do tego m5 (asercja na wejście w e2e) i m1 (doprecyzowanie IMPL).

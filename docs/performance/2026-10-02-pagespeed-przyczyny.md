# Dlaczego PageSpeed daje 49 (mobile) i 74 (desktop): przyczyny krok po kroku (2026-10-02)

Cel zlecenia: **mobile 85+, desktop 95+** na `https://neweuropeanstrategies.com/`.
Ten dokument odpowiada na pytanie „dlaczego jest nisko", krok po kroku, każdą
tezę opierając na pomiarze powtórzonym w tym repozytorium. Na końcu jest to,
co wdrożono od razu (razem ze zmierzonym efektem), i plan reszty drogi do celu.

## 0. Punkt wyjścia: raporty PSI z 2 października 2026, 11:33–11:35 CEST (Lighthouse 13.5.0)

| Metryka                  | Mobile | Desktop | Próg „zielony" |
| ------------------------ | -----: | ------: | -------------: |
| Performance              | **49** |  **74** |         90–100 |
| First Contentful Paint   |  3,3 s |   0,5 s |        ≤ 1,8 s |
| Largest Contentful Paint |  5,3 s |   1,0 s |        ≤ 2,5 s |
| Total Blocking Time      | 760 ms |  450 ms |       ≤ 200 ms |
| Speed Index              |  7,5 s |   2,2 s |        ≤ 3,4 s |
| Cumulative Layout Shift  |      0 |   0,002 |          ≤ 0,1 |

Diagnostyka z tych samych raportów: skrócić czas wykonywania JavaScriptu
3,1 s / 1,8 s; zminimalizować aktywność głównego wątku 5,6 s / 3,4 s;
nieużywany JavaScript 372 / 374 KiB; 19 / 10 długich zadań; prośby
blokujące renderowanie 450 ms / 50 ms; wymuszone przeformatowanie;
zestawienie LCP czerwone. Dostępność 95/92, Sprawdzone metody 100, SEO 100.

Wniosek z samych liczb, zanim cokolwiek zmierzono: **CLS jest rozwiązany, a cała
strata siedzi w głównym wątku (TBT, czas JS) i w czasie do pierwszego
malowania na wolnej sieci (FCP/SI mobile).** Desktop traci 26 pkt wyłącznie na
TBT (450 ms = 0 pkt za TBT przy wadze 30 %).

## 1. Metoda: pomiar odtworzony lokalnie

Sandbox nie ma dostępu do produkcji (egress) ani do API PSI (limit dzienny
wyczerpany), więc pomiar odtworzono na artefakcie produkcyjnym:

- `bun run build:smoke` (preset node-server, ta sama konfiguracja Vite co
  produkcja; pakiet `xlsx` z CDN SheetJS zastąpiony stubem w `node_modules`,
  bo CDN jest zablokowany - nie dotyka ścieżki bootu strony publicznej);
- backend-fixture jak w jobie CI `first-visit` (`scripts/performance/replayFetch.mjs`,
  48 widgetów, slider + listy wpisów + join-us), dokument rozgrzany do HIT;
- proxy brotli przed serwerem Nitro (Nitro nie kompresuje), żeby symulator
  sieci Lighthouse'a widział realne rozmiary transferu;
- Lighthouse 12.8.2 na Chromium 1194 (Playwright), profile identyczne z PSI
  (mobile: slow 4G 1,6 Mb/s, RTT 150 ms, CPU 4x, Moto G Power; desktop: CPU 1x);
- do rozbicia głównego wątku: ślady CDP (`Tracing.start`, kategorie
  `devtools.timeline` + `invalidationTracking`) i sondy w Playwright.

Wynik odtworzenia (3 przebiegi, mediana):

| Profil  | Performance |    FCP |       LCP |        TBT |    SI |
| ------- | ----------: | -----: | --------: | ---------: | ----: |
| mobile  |       47–52 |  5,4 s | 5,6–5,9 s | 540–700 ms | 5,4 s |
| desktop |       95–96 | 1,09 s |    1,17 s |   12–22 ms | 1,1 s |

Mobile odtwarza produkcję (49). **Desktop lokalnie ma 95, produkcja 74** - różnica
to wyłącznie to, czego fixture nie zawiera: skrypty Google, baner zgód, realne
zapytania po hydratacji i realne obrazy (§7). Ta różnica jest sama w sobie
ustaleniem.

## 2. Krok 1: co blokuje pierwsze malowanie (FCP 3,3 s mobile)

Dokument strony głównej z artefaktu:

| Składnik                         | Rozmiar                               |
| -------------------------------- | ------------------------------------- |
| HTML (`/`)                       | 388 462 B raw / 44 301 B brotli       |
| w tym 51 bloków `<style>` inline | 133 572 B                             |
| w tym 34 skrypty inline          | 94 213 B                              |
| `<link rel="modulepreload">`     | 17 (9 plików bootu + 8 chunków trasy) |
| `styles-*.css` (render-blocking) | **541 508 B raw / 70–80 KB brotli**   |
| fonty (2 × preload)              | 30 987 + 14 060 B                     |

Arkusz: 6 234 selektory w 5 157 grupach, 102 bloki `@media`, 698 `@supports`,
56 `@keyframes`; warstwa Tailwind `utilities` 333 KB, CSS ręczny spoza warstw
~180 KB (źródło `src/styles.css` ma 320 KB i 8 900 linii). Na slow 4G sam
transfer dokumentu i arkusza po TTFB to ~1,0–1,2 s, a parsowanie 541 KB CSS i
pierwsze przeliczenie stylu 1 130 elementów przy 4x CPU dokłada kolejne
setki milisekund. Produkcyjne 3,3 s = TTFB + HTML + CSS + ten koszt CPU.

(Lokalne 5,4 s jest artefaktem symulacji: na szybkiej sieci lokalnej wszystkie
skrypty bootu zdążyły się pobrać PRZED obserwowanym FCP 415 ms, więc symulator
traktuje ich pobranie jako poprzedników pierwszego malowania. W produkcji te
skrypty idą równolegle, stąd 3,3 s.)

## 3. Krok 2: główny wątek - gdzie idzie 5,6 s na mobile

Lighthouse mobile (lokalnie, symulowany czas): główny wątek 11,8 s, z czego
**Style & Layout 5 193 ms**, Script Evaluation 3 588 ms, Other 2 210 ms, Parse
HTML & CSS 384 ms. Przeliczanie stylu jest większe niż cały JavaScript - to
nietypowe i to jest pierwszy trop.

Ślad CDP strony głównej (CPU 4x, dokument z HIT):

| Zdarzenie                                                 | Liczba |             Suma |
| --------------------------------------------------------- | -----: | ---------------: |
| `UpdateLayoutTree` (przeliczenie stylu)                   |     57 |         3 788 ms |
| w tym pełne przeliczenia dokumentu (873 el.)              |     10 | 230–380 ms KAŻDE |
| `Layout`                                                  |     25 |           241 ms |
| `FunctionCall` (głównie React `performWorkUntilDeadline`) |    633 |         1 662 ms |
| `ParseHTML`                                               |     40 |           442 ms |

Pełne przeliczenia padają w 2,3–7,5 s, czyli od hydratacji (gotowość aplikacji
~4,4 s przy 4x) przez kolejne 3 s. Na desktopie (1x) to 90 przeliczeń, 1 104 ms,
pełne po 36–59 ms, co 150–200 ms między 0,7 a 2,9 s. Powody unieważnień
z `invalidationTracking`: „Invalidation set invalidates subtree" 869,
**„Affected by :has()" 572**, „Animation" 300, „PseudoClass" 284.

Co mutuje DOM po gotowości aplikacji (sonda `MutationObserver`, 4 s):
44 × `<link rel="modulepreload">` wstawiane do `<head>` przez helper preloadu
Vite przy każdym `import()`; 4 × podmiana tekstu `<style>` (komponenty
`*Style` po natychmiastowym refetchu ustawień - zasiew `updatedAt: 0`);
1 × hoist `<style precedence>`; `data-settled` na nagłówku; `src` obrazów
przepisywane 5× na kartę w 4 widgetach; `name`/`type` inputów przepisywane
6–12× w widżecie join-us; `lang` na `<html>` ustawiane tą samą wartością.
Każda z tych mutacji unieważniała style całego dokumentu.

## 4. Krok 3: dlaczego JEDNO przeliczenie kosztuje 300 ms - `:has()`

Eksperyment: wymuszone pełne przeliczenie stylu (wstawienie pustego `<style>`
i odczyt `getComputedStyle`), 7 powtórzeń, mediana, desktop 1x, 1 260
elementów, każdy wariant na świeżo załadowanej stronie:

| Wariant                                                         | Koszt jednego przeliczenia |
| --------------------------------------------------------------- | -------------------------: |
| kontrola (nic nie usunięte)                                     |                   35–37 ms |
| usunięte **wszystkie 38 reguł `:has()`** (nic poza nimi)        |                 **0,5 ms** |
| usunięta cała warstwa `@layer utilities` (333 KB)               |                    32,4 ms |
| usunięte 1 574 reguły CSS ręcznego (zostaje 10 `:has()` inline) |                    23,3 ms |
| usunięta dowolna POJEDYNCZA grupa `:has()` (9 wariantów)        |      bez zmiany (31–53 ms) |

To nie jest koszt konkretnej reguły ani wielkości arkusza. **Sama obecność
`:has()` w dokumencie przełącza Blink w tryb unieważniania świadomy `:has()`
i mnoży koszt każdego pełnego przeliczenia ~70×.** Przy 4x CPU telefonu daje to
~300 ms na przeliczenie, a strona główna robi ich po hydratacji kilkanaście -
to ~3 s z 5,2 s „Style & Layout", a więc największy pojedynczy składnik TBT,
TTI i Speed Index na mobile oraz istotna część 450 ms TBT na desktopie.

38 reguł i ich źródła:

| Reguła (skrót)                                                     | Źródło                                    | Zamiennik                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `.cms-post-title:has(.cms-title-underline)` (+`:hover`)            | `styles.css`                              | klasa `.cms-post-title--delegated` na nagłówku z spanem (PostListView ×10, slider ×8, TailoredMustReads, PodcastLatest)                |
| `a:has(.cms-post-title)` … `a:has(.cms-title-underline):focus` (6) | `styles.css`                              | usunięte: żaden globalny selektor nie podkreśla `<a>`                                                                                  |
| `body:has([data-page-header-override="hidden"]) header…` (3)       | `styles.css`                              | `SiteChrome` czyta `item.header_override` / `template_type` z loaderData i wypisuje `data-chrome-header/footer` na `[data-site-shell]` |
| `:where(label):has(> input[type=checkbox], > input[type=radio])`   | `styles.css` (powłoki formularzy)         | opt-in `label.cms-check-label` (reguła nie pasowała do żadnego markupu w repo)                                                         |
| `.dlb-label:has(.dlb-input:checked)` (4)                           | `styles.css`                              | `.dlb-label[data-state="active"]` (atrybut już renderowany)                                                                            |
| `html:has([data-reading-header])` (3)                              | `styles.css`                              | `html[data-reading-header-active]` ustawiane przez `ReadingHeader` przy montażu                                                        |
| `.nlp label:has(.lov-check)`                                       | `styles.css`                              | `.nlp label.nl-check-label` (klasa w `NewsletterForm`)                                                                                 |
| `li:not(:has(> input[type=checkbox]))` (8)                         | `styles.css` (listy rich-content)         | usunięte: elementy zadań mają już `.task-list-item`                                                                                    |
| `li:is(:has(> .cms-list-number), :has(> .cms-list-bullet))`        | `styles.css`                              | `li.cms-list-item` (renderer emituje tę klasę)                                                                                         |
| `.prose:has(> .nes-benefits)`                                      | `styles.css`                              | `.prose > .nes-benefits` (markup tylko w treściach redakcyjnych)                                                                       |
| `label:has(+ button[role="switch"])`                               | `ThemeOptionsStyle.tsx`                   | usunięte (zostają `button + label` i `[data-toggle-label]`)                                                                            |
| `:where(*):has(.builder-search-widget)` (2)                        | `SearchButtonWidget.tsx` (arkusz widgetu) | efekt oznacza przodków `data-search-overflow` (poza `[data-reading-row]`)                                                              |
| `[data-reading-header] :has(.builder-search-widget)` (2)           | `ReadingHeader.tsx`                       | `[data-reading-header] [data-search-overflow]:not([data-reading-row])`                                                                 |
| `a:has(> .cms-post-title) + .cms-post-excerpt` (per widget)        | `typographyCss.ts` (inline `<style>`)     | `a + .cms-post-excerpt` w ramce widgetu                                                                                                |
| `[&:has([role=checkbox])]:pr-0` (2)                                | `ui/table.tsx` (Tailwind)                 | usunięte                                                                                                                               |
| `has-focus:*` (3), `has-[:focus-visible]:*` (4)                    | `ui/calendar.tsx`, `GlobalAudioBar.tsx`   | `focus-within:*`                                                                                                                       |

## 5. Krok 4: JavaScript - 1,9 MB surowego kodu przed hydratacją

Domknięcie bootu (entry + importy statyczne z `modulepreload`): 9 plików,
**1 900 858 B raw / 566 696 B gzip**. Do tego słownik `pl` 68 693 B (26,5 KB gz),
dociągany `top-level await` w tym samym chunku, w którym stoi `hydrateRoot`.

| Plik              | raw (B) | gzip (B) |
| ----------------- | ------: | -------: |
| `index-*.js`      | 958 337 |  287 659 |
| `vendor-supabase` | 224 170 |   58 660 |
| `vendor-react`    | 195 480 |   61 444 |
| `vendor-tanstack` | 168 853 |   52 347 |
| `vendor-radix`    | 114 905 |   37 754 |
| `vendor-lucide`   | 108 412 |   31 664 |
| `vendor-zod`      |  54 091 |   12 359 |
| `vendor-i18n`     |  49 099 |   16 252 |
| `vendor-tw-merge` |  27 511 |    8 557 |

Skład chunku wejściowego (`reports/chunk-inventory.json`, 875 modułów,
1 614 272 B źródeł po transformacji): `src/routes` **339 528 B** (definicje
~300 tras, w tym całego panelu admina, klubów, profilu - każda po 300–600 B
plus ich importy pomocnicze: `lib/clubs` 38 KB, `lib/experts` 27 KB,
`lib/billing` 15 KB, `lib/events` 12 KB), `lib/builder` 208 258 B,
`components/builder` 192 568 B, `routeTree.gen.ts` 62 026 B, `lib/queries`
60 170 B, `components/header` 45 610 B (sam `TrendingTicker.tsx` 40 KB),
`lib/seo` 41 637 B, `lib/theme` 36 992 B, `lib/ads` 21 555 B, `megaMenu`
19 883 B, `lib/newsletter` 17 960 B, `lib/audio` 17 358 B. Pakiety npm to
tylko 29 661 B - entry jest **kodem aplikacji, nie vendorów**.

Nieużywany JavaScript wg Lighthouse (lokalnie 220 KiB, produkcja 374 KiB):
`index` 127 z 254 KB, `vendor-supabase` 44 z 54 KB (anonim nie używa klienta
Realtime/Auth), `vendor-radix` 27 z 35 KB, `vendor-tanstack` 27 z 50 KB.
Hydratacja (React `performWorkUntilDeadline`) kosztuje 1 488 ms przy 4x
(803 ms przy 1x) dla 48 widgetów i ~880 elementów. To drugi co do wielkości
składnik TBT po przeliczeniach stylu.

## 6. Krok 5: LCP 5,3 s na mobile

Lokalnie elementem LCP jest nagłówek slidera (tekst) z opóźnieniem renderu
równym FCP - obrazy fixture (`fixture.invalid`) nie są osiągalne z przeglądarki.
W produkcji LCP to obraz slidera; raport z 2026-09-30 pokazał w nim
„opóźnienie wykrycia zasobu ~4 396 ms" i nieaktywny obraz karuzeli
(`opacity: 0`, niski priorytet), a notatka z 2026-10-01 opisała mechanizm:
widget hero był granicą `React.lazy`/Suspense strumieniowaną PO ~250 KB
dokumentu (placeholder w shellu, podmiana przez `$RC`). PR #431 naprawił to dla
widgetów treści; w aktualnym artefakcie na stronie głównej nadal strumieniuje
się 16 granic (3 widgety nagłówka, 4 sekcje pod zgięciem - celowo, 8 ikon
menu/stopki), a `<link rel="preload" as="image" fetchpriority="high">` dla hero
jest w `<head>` dwukrotnie (hero buildera + pierwsza karta). Produkcyjny czas
LCP po tym PR-ze wymaga pomiaru po wdrożeniu; to, co widać w kodzie, to że LCP
na mobile jest przede wszystkim pochodną FCP (§2) i głównego wątku (§3–4),
a nie brakującego priorytetu obrazu.

## 7. Krok 6: desktop 74 - czego lokalny pomiar nie widzi

Lokalnie desktop ma 95 i TBT 12–22 ms. Produkcja ma TBT 450 ms, czas JS 1,8 s,
10 długich zadań. Różnica to zawartość, której fixture nie ma:

1. **Dwa skrypty Google** (`gtag/js?id=G-…` i cel Ads) - wg raportu PSI
   z 2026-09-30: 367 KB transferu, ~582 ms głównego wątku. Tag jest odroczony
   (`afterPageLoad(…, 2000)` + `whenIdle`), ale na stronie, której TTI w
   symulacji to 9 s, i tak ląduje w oknie liczonym do TBT.
2. Baner zgód (chunk + render po 1 s bezczynności) i jego pierwszy akapit
   bywał elementem LCP (audyt F30).
3. 11–15 zapytań PostgREST tuż po hydratacji: zasiew ustawień/tokenów/menu
   z `updatedAt: 0` wymusza natychmiastowy refetch, a każda odpowiedź to
   rerender i mutacja `<style>` komponentów `*Style` (patrz §3).
4. Realne obrazy z `/media/*` (zamiast nieosiągalnych fixture).

## 8. Wdrożone w tym PR i zmierzony efekt

**Usunięte wszystkie 38 reguł `:has()` z publicznego CSS** (tabela w §4), z bramką
CI `src/lib/ci/__tests__/noHasSelectors.test.ts`, która skanuje `styles.css`,
komponenty i biblioteki publiczne (także klasy Tailwind `has-*`) i nie
przepuści powrotu. Do tego `lang` na `<html>` jest zapisywane tylko przy realnej
zmianie (`src/lib/i18n.ts`), a `horizontalPanGuard` pilnuje, że następca reguły
wyszukiwarki nadal omija wiersz paska czytania.

Pomiar na tym samym artefakcie i fixture, przed → po:

| Pomiar (ten sam artefakt, fixture, HIT)                          |             Przed |                                                              Po |
| ---------------------------------------------------------------- | ----------------: | --------------------------------------------------------------: |
| Jedno wymuszone pełne przeliczenie stylu (desktop 1x, mediana 7) |          35–39 ms |                                                      **0,6 ms** |
| Ślad CDP mobile 4x: suma `UpdateLayoutTree`                      |          3 788 ms |                                                    **1 157 ms** |
| Ślad CDP mobile 4x: gotowość aplikacji (`__nesAppReady`)         |          4 414 ms |                                                    **2 678 ms** |
| Ślad CDP desktop 1x: suma `UpdateLayoutTree` / gotowość          | 1 104 ms / 912 ms |                                             **199 ms / 516 ms** |
| Lighthouse mobile: Performance (3 przebiegi)                     |      47 / 52 / 51 |                                                **57 / 60 / 55** |
| Lighthouse mobile: TBT (mediana)                                 |            557 ms |                                                      **343 ms** |
| Lighthouse mobile: Style & Layout / główny wątek (symulacja)     | 4 741 / 11 064 ms |                                            **1 304 / 7 954 ms** |
| Lighthouse mobile: TTI                                           |             7,9 s |                                                           7,5 s |
| Lighthouse mobile: FCP / LCP / SI                                | 5,4 / 5,9 / 5,4 s | 5,4 / 5,9 / 5,4 s (bez zmian - sieć i CPU przed malowaniem, §2) |
| Lighthouse desktop: Performance / TBT                            |     95–96 / 14 ms |                                                **95–96 / 0 ms** |
| Lighthouse desktop: Style & Layout / TTI                         | 1 270 ms / 1,73 s |                                             **339 ms / 1,18 s** |

Czas JavaScriptu (bootup 3,2–3,4 s mobile) i FCP nie ruszyły się - to są
osobne przyczyny (§2, §5), do których ta zmiana nie była wycelowana. Na
produkcji efekt powinien być większy niż na fixture: tam po hydratacji
dochodzą mutacje z banera zgód, dwóch skryptów Google i 11–15 refetchów
(§7), a każda z nich kosztowała dotąd pełne przeliczenie po ~300 ms.

Zmiany zachowania, które trzeba znać:

- Nagłówki z delegowanym podkreśleniem muszą nieść `cms-post-title--delegated`;
  brak modyfikatora = na hoverze pełna kreska pod nagłówkiem PLUS podkreślenie
  per linia (defekt kosmetyczny, nie funkcjonalny).
- `label.cms-check-label` jest opt-in: dawna reguła `label:has(> input)` i tak
  nie pasowała do żadnego markupu w repozytorium.
- Znacznik `data-search-overflow` i flaga `data-reading-header-active` powstają
  po hydratacji (nie w HTML-u SSR). Popover wyszukiwarki i tak nie otwiera się
  przed hydratacją; kotwice `#hash` na wpisie liczą odstęp od paska serwisu do
  czasu hydratacji.
- `a + .cms-post-excerpt` zamiast `a:has(> .cms-post-title) + .cms-post-excerpt`
  w typografii widgetu; `.prose > .nes-benefits` zamiast poszerzania otoczki;
  komórki tabeli z checkboxem straciły `pr-0`; `focus-within` zamiast
  `has-focus`/`has-[:focus-visible]` w kalendarzu i pasku audio.
- Ukrywanie nagłówka/stopki stron CMS liczy `SiteChrome` z loaderData
  (`header_override: "hidden"`, szablon `landing`) - w SSR i na kliencie tak samo.

## 9. Droga do 85 / 95: kolejne kroki (w kolejności efekt / ryzyko)

| #   | Działanie                                                                                                                                                                                                        | Metryka                | Szacowany efekt                                                                 | Uwagi                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **(ten PR)** `:has()` poza publicznym CSS                                                                                                                                                                        | TBT, TTI, SI, INP      | mobile: −2,5–3 s „Style & Layout" (sym.), TBT −300–400 ms; desktop: −200 ms TBT | bez decyzji biznesowych                                                 |
| 2   | Tag Google po pierwszej interakcji LUB po decyzji o zgodzie, z twardym fallbackiem po TTI (brak długich zadań po `load`), zamiast `load + 2 s`                                                                   | TBT, czas JS           | mobile −500 ms CPU i −367 KB; desktop −200–300 ms TBT                           | decyzja właściciela analityki (kolejka `dataLayer` zachowuje zdarzenia) |
| 3   | Refetch po hydratacji: zasiewy z `updatedAt: 0` → `staleTime` z czasu renderu SSR (dokument z HIT ma świeże dane)                                                                                                | TBT, mutacje `<style>` | −11–15 zapytań i rerenderów w oknie TBT                                         | `__root.tsx`, `$.tsx`, `index.tsx`                                      |
| 4   | Boot JS: definicje tras admin/profil/klub/wydarzenia poza entry (grupy tras ładowane leniwie po prefiksie), `vendor-supabase` leniwie dla anonima, `lucide`/`radix`/`zod` poza domknięciem                       | czas JS, TBT, TTI      | entry 958 → ~550 KB raw; boot 1,9 → ~1,1 MB raw                                 | największa praca; bramka `check:bundle` jako zapadka                    |
| 5   | CSS: rdzeń publiczny ≤ 150 KB raw - style modułów zalogowanych (kluby, profil, dock, czat, checkout, formularze) do arkuszy ładowanych z ich chunkami; 51 inline `<style>` (134 KB) → stałe arkusze `precedence` | FCP, SI, parse CSS     | mobile FCP −0,5–0,8 s                                                           | po #1 przeliczenia są tanie, ale parse 541 KB nadal kosztuje            |
| 6   | HTML 388 KB → < 200 KB (inline CSS jak wyżej, 94 KB skryptów inline, payload dehydratacji)                                                                                                                       | FCP mobile             | −0,2–0,3 s                                                                      | razem z #5                                                              |
| 7   | Hero slidera w pierwszym fragmencie HTML (bez granicy Suspense), preload z `imagesrcset`, `/media` z negocjacją `Accept`                                                                                         | LCP mobile             | LCP → FCP + czas obrazu                                                         | weryfikacja na produkcji po #1                                          |
| 8   | Pomiar: `vars.LHCI_URL` (tryb A, profil mobile)                                                                                                                                                                  | wszystkie              | warunek, by kolejne rundy były oparte na danych                                 | bez tego każda runda to zgadywanie                                      |

Oczekiwany przebieg wyniku (szacunek na podstawie udziałów z §3–7, do
potwierdzenia pomiarem produkcyjnym): mobile 49 → ~60–65 po #1, ~70 po #2–3,
~80 po #4, 85+ po #5–7; desktop 74 → ~85–90 po #1–2, 95+ po #4.

## 10. Pliki pomiarowe i powtarzalność

Skrypty użyte do pomiaru (katalog roboczy sesji, nieprzenoszone do repo):
proxy brotli, runner Lighthouse z profilami PSI, ślad CDP z agregacją
`UpdateLayoutTree`, sonda `MutationObserver`, eksperyment kosztu przeliczenia
po wariantach CSS. Każdy wynik powyżej da się odtworzyć poleceniami z §1 na
artefakcie `build:smoke` z fixture `first-visit`.

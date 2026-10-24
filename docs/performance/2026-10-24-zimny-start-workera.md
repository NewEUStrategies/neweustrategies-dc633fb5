# Speed Index i zimny start Workera (2026-10-24)

Zlecenie: poprawić Speed Index, Core Web Vitals i architekturę wczytywania
strony głównej `https://neweuropeanstrategies.com/` (PSI 18.10: SI desktop 2,7 s
/ mobile 3,0 s; PSI 24.10: SI desktop 2,3 s / mobile 6,0 s).

## 1. Skąd bierze się Speed Index - pomiar produkcji

Lighthouse 13.5.0 na produkcji (ten kontener, kolonia IAD - ta sama co PSI):

| Forma   |    SI |   FCP |   LCP | TTFB dokumentu | observedSI | observedFCP |
| ------- | ----: | ----: | ----: | -------------: | ---------: | ----------: |
| mobile  | 8,6 s | 1,9 s | 2,7 s |         4,43 s |     5,49 s |      5,34 s |
| desktop | 3,7 s | 0,5 s | 0,9 s |         4,75 s |     5,89 s |      5,67 s |

Lantern liczy `SI = 1,4 × observedSI + 0,4 × layoutSI` (mobile) i
`0,575 × observedSI + 0,492 × layoutSI` (desktop); `observedSI` to Speed Index
prawdziwego wczytania, liczony od startu nawigacji, więc **zawiera realny TTFB**
(szczegóły: `2026-10-22-speed-index.md` §1). Po pierwszym malowaniu strona
prawie się nie zmienia (`observedSI − observedFCP` = 0,15 s mobile, 0,22 s
desktop), a pierwsze malowanie czeka na dokument: **SI to w ~90 % czas
odpowiedzi serwera**. Rozrzut wyników PSI między dniami (mobile 3,0 → 11,0 →
6,0 s) to rozrzut TTFB zimnego izolatu, nie zmiana kodu klienta.

Server-Timing produkcji (6 kolejnych GET `/`, UA przeglądarki):

| Przypadek    | TTFB        | `app;dur` (I/O) | `edge-routing` | db (suma, n)   | izolat         |
| ------------ | ----------- | --------------- | -------------- | -------------- | -------------- |
| MISS (4 z 6) | 3,75–5,14 s | 1,28–1,46 s     | 0,48–0,68 s    | 2,2–3,8 s (13) | `req=1 cold=1` |
| L1 HIT (2/6) | 0,32–0,38 s | 0               | 0              | -              | `req=2 cold=0` |

Zegar Workers stoi w czasie pracy CPU, więc `TTFB − app;dur` = **2,4–3,7 s
czystego CPU zimnego izolatu**: start skryptu (kompilacja modułów), ewaluacja
i render. L2 (Cache API) nadal nie działa na runtime hostingu
(`nes-l2-fail;desc="put"`).

## 2. Przyczyna nr 1 w kodzie: druga, martwa kopia aplikacji w Workerze

Artefakt `bun run build` (preset `cloudflare-module`) miał **3 563 moduły,
39,6 MB**, w tym dwie kopie aplikacji:

- `_ssr/` (Vite, środowisko SSR, z podziałem tras) - wykonywana,
- `_chunks/` (Nitro): `_chunks/router.mjs` 9 MB + 860 chunków, **17 MB** -
  nigdy niewykonywana.

Łańcuch: `src/lib/newsletter-campaigns.functions.ts` importował
`@tanstack/react-start/server` przez zmienną z `/* @vite-ignore */`. Build SSR
zostawiał taki specyfikator jako pakiet zewnętrzny, Nitro dociągał z
`node_modules` drugą kopię Startu (`_libs/@tanstack/react-start+[...].mjs`),
a jej `createStartHandler` importuje `#tanstack-router-entry` - Nitro
rozwiązał go po swojemu i zbudował całą aplikację jeszcze raz, bez podziału tras.

workerd kompiluje każdy moduł skryptu przy starcie izolatu, więc tę kopię
płacił **każdy zimny start**. Pomiar na lokalnym workerd (wersja 2026-10-19, ten sam
artefakt, backend-fixture 40 ms/zapytanie, `GET /` jako pierwsze żądanie
świeżego procesu):

| Artefakt                         | Moduły |    MB | start → koniec 1. dokumentu | TTFB 1. żądania |
| -------------------------------- | -----: | ----: | --------------------------: | --------------: |
| przed                            |  3 563 | 39,63 |              1 437–1 465 ms |     1,08–1,10 s |
| przed, bez `_chunks/` (kontrola) |  2 702 | 22,62 |                  977–988 ms |     0,74–0,76 s |
| **po poprawce**                  |  2 541 | 22,54 |                996–1 012 ms |     0,74–0,78 s |

Dokument `/` bajt w bajt tej samej długości. Lokalnie −0,44 s (−31 %) na
zimnym starcie; na maszynach hostingu, gdzie zimny izolat płaci 2,4–3,7 s CPU,
zysk proporcjonalnie większy. Szacunek SI: mobile −0,6…−1,5 s, desktop
−0,25…−0,6 s (×1,4 / ×0,575 od TTFB).

**Naprawa:** import literałem (`await import("@tanstack/react-start/server")`),
jak w `optionalUser.server.ts` - import-protection w buildzie weryfikuje
naruszenia po tree-shakingu, a klient nie używa `tickNewsletterCampaigns`.

**Strażnik:** bramka CI `check:server-entry-purity` ma regułę „jedna kopia
aplikacji": artefakt ma mieć dokładnie jeden loader wejść TanStack Start
(`Promise.all([import(router), import(start), …])`); na starym artefakcie
oblewa i wskazuje oba pliki.

## 3. Przyczyna nr 2: kod UI panelu, którego serwer nigdy nie renderuje

Podstrony `/admin/*` serwer renderuje wyłącznie jako szkielet: `AdminLayout`
(`src/routes/admin.tsx`) zwraca przed hydratacją `AdminShellSkeleton`, a
`<Outlet/>` panelu montuje `AdminSession` dopiero po `useHydrated()`.
Komponenty 218 tras-dzieci `/admin` (edytor wpisów, studio wydarzeń, CRM,
billing, newsletter…) nie renderują się więc na serwerze nigdy - granice błędu
i 404 dziecka też siedzą w `<Outlet/>` rodzica. Ich kod stanowił **7,2 MB
z 22,5 MB** artefaktu (440 modułów osiągalnych wyłącznie przez komponenty tras).

**Zmiana:** wtyczka `scripts/lib/clientOnlyRouteStubPlugin.ts` (tylko build,
tylko środowisko `ssr`, w obu presetach) podmienia moduł podziału trasy
(`<plik>?tsr-split=<grupa>`) na zaślepkę, gdy plik trasy jest potomkiem layoutu
`/admin` według `src/routeTree.gen.ts`, a grupa zawiera wyłącznie komponenty.
Grupa z `loader` (kokpit `/admin/`) zostaje. Klient, manifest, modulepreloady
i 388 funkcji serwerowych (resolver Startu importuje moduły `*.functions`
własną krawędzią) - bez zmian.

**Dowód równoważności:** 11 adresów (`/`, `/blog`, `/events`, `/login` i 7
adresów panelu, w tym nieistniejący) z artefaktu bazowego i nowego (preset
node-server, ten sam backend-fixture) - HTML bajt w bajt identyczny po
normalizacji nonce, portu i znaczników czasu.

| Lokalny workerd, 1. `GET /` świeżego procesu | Moduły |    MB | start → koniec dokumentu | TTFB 1. żądania |
| -------------------------------------------- | -----: | ----: | -----------------------: | --------------: |
| baza (`ebb315e9`)                            |  3 563 | 39,63 |           1 437–1 465 ms |     1,08–1,10 s |
| po §2 (jedna kopia aplikacji)                |  2 541 | 22,54 |             996–1 012 ms |     0,74–0,78 s |
| **po §2 + §3 (zaślepki panelu)**             |  1 891 | 14,09 |               798–861 ms |     0,64–0,68 s |

Razem: **−64 % kodu Workera, −43 % zimnego startu** (lokalnie). Produkcja płaci
za zimny start 2,4–3,7 s CPU, czyli wielokrotność lokalnego kosztu - zysk
w TTFB rośnie proporcjonalnie.

**Strażnik:** `check:server-entry-purity` sprawdza w artefakcie, że każdy
`import()` komponentu trasy `/admin/…` wskazuje plik ≤ 256 B (zaślepka ma 48 B);
zero sprawdzonych tras to defekt skanu. Na artefakcie bazowym oblewa: 191 z 204
komponentów pełnych.

## 4. Pierwsze malowanie pokazywało szkielety, choć treść była już w przeglądarce

Taśma klatek produkcji (Lighthouse desktop, zimny MISS): FCP 5,67 s, a do
~6,12 s na ekranie stał **szkielet nagłówka i pierwszej sekcji** z hero (mobile:
blady szkielet w klatce 5,46 s, treść dopiero w 6,25 s). Dokument skończył się
w przeglądarce już w 4,9 s.

Przyczyna: na zimnym izolacie nagłówek (`B:0`) i pierwsza sekcja (`B:1`)
nie mieszczą się w terminie loadera i idą strumieniem jako granice Suspense.
React 19.2 odsłania je partiami: po pierwszej klatce (`$RT`) każda partia czeka
`setTimeout`-em do `$RT + 300 ms` - w śladzie `TimerInstall 5558 ms, 253 ms, $RC`,
a obraz LCP (pobrany ~5,5 s) czekał na odsłonięcie sekcji
(`elementRenderDelay` 646 ms).

**Zmiana:** `src/lib/ssr/streamRevealScript.ts` - klasyczny skrypt inline
w `<head>` definiuje `window.$RT` jako akcesor zwracający zawsze `undefined`;
runtime `$RC` idzie wtedy zawsze ścieżką `requestAnimationFrame`, czyli
odsłania każdą partię w najbliższej klatce (zachowanie sprzed 19.2). Klient
React `$RT` nie czyta; siatki przewijania (`restoreAfterReveal`,
`fragmentLandingScript`) działają przy odsłonięciu w dowolnej chwili. Test na
PRAWDZIWYM runtime wyciętym z `react-dom-server` (bez skryptu: `setTimeout`,
szkielet zostaje; ze skryptem: odsłonięcie w klatce) - zmiana runtime'u w
kolejnej wersji Reacta go obleje.

**Pomiar A/B** (Lighthouse 13.5 lokalnie, artefakt node-server, pierwsza
sekcja strumieniem 900 ms za powłoką - `NES_PERFORMANCE_CASE=slow-first-fold`,
cache dokumentów wyłączony; mediany, A = bez skryptu, B = ze skryptem):

| Forma   | observedSI A → B | ostatnia zmiana wizualna A → B | przebiegi A / B |
| ------- | ---------------: | -----------------------------: | --------------: |
| desktop |     342 → 263 ms |                  1044 → 683 ms |           2 / 3 |
| mobile  |     306 → 292 ms |                   782 → 769 ms |           2 / 3 |

(dwa przebiegi A odrzucone przez Lighthouse: `NO_NAVSTART`). Na mobile parser
zwykle kończy dokument przed pierwszą klatką, więc dławienie rzadziej się
włącza; na produkcji, gdzie dokument przychodzi porcjami przez ~0,5 s,
dotyczy obu form.

## 5. Pozostałe audyty PSI

| Audyt PSI                                                                    | Stan po tej zmianie                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache TTL (9 KiB)                                                            | `/~flock.js` wstrzykuje hosting (poza kodem). Awatar w bylinie (`users/<id>/avatar-<ms>.png`, 1 h) - pliki profilu zapisywane pod `<rodzaj>-${Date.now()}` dostają teraz `immutable` na rok (`routes/media.$.ts`).  |
| Obrazy bez `width`/`height`                                                  | Widget obrazu z proporcją „auto" (naturalna) nie zna wymiarów pliku. Kod nie ma ich skąd wziąć - **ustawić „Proporcje" w builderze** dla tego widgetu (daje `aspect-ratio`). CLS = 0, obraz jest pod zgięciem.      |
| Blokujący CSS (80 KiB gz, ~50-80 ms)                                         | Jeden arkusz `styles-*.css`; krytyczny CSS inline to osobny projekt. Po wyjściu z hostingu Lovable: Early Hints (103) z istniejącego nagłówka `Link` (`2026-10-22-speed-index.md` §5).                              |
| Nieużywany JS (204 KiB: `app-initial`, `vendor-supabase`, `vendor-tanstack`) | Boot startuje po LCP (`bootAfterLcpPlugin`), więc JS nie blokuje pierwszego malowania; TBT 0-20 ms. Wydzielenie `vendor-supabase` z bootu gościa to dalszy krok planu P3.1 - wpływ na SI pomijalny przy TTFB > 1 s. |
| Opóźnienie dokumentu / zależności sieci                                      | §1-§4: kod Workera −64 %, zimny start −46 %, odsłonięcie bez dławienia. Reszta to I/O do Supabase w eu-west-1 (fale: katalog tenantów → ustawienia → wiersz strony → treść kanwy) - patrz §6.                       |

## 6. Wynik i dalsze kroki

**Zimny start, ten sam kontener i backend-fixture (5 przebiegów, lokalny
workerd):** baza `ebb315e9` 1 409-1 532 ms od startu procesu do końca
dokumentu, TTFB 1,06-1,16 s → **HEAD 773-818 ms, TTFB 0,61-0,64 s**
(−46 %, −0,5 s TTFB). Produkcja płaci za zimny start 2,4-3,7 s CPU, czyli
wielokrotność lokalnego kosztu - zysk w TTFB powinien być proporcjonalnie
większy; potwierdzić PSI po wdrożeniu (kilka przebiegów, mediana, bo rozrzut
zimnych izolatów to sekundy).

Dalej, w kolejności wpływu na SI:

1. **Infrastruktura (właściciel):** własny Worker na koncie Cloudflare
   ze **Smart Placement** (render blisko eu-west-1), działający Cache API (L2
   dokumentów - dziś `nes-l2-fail;desc="put"`), Brotli i Early Hints -
   `2026-10-22-speed-index.md` §5. To nadal największa dźwignia: ciepły izolat
   z cache'em podaje dokument w 0,32-0,38 s.
2. **Jedno RPC strony głównej** (`get_public_homepage(slug)`: wiersz strony
   - treść kanwy) - produkcja ma `homepage_page_slug: "main"`, więc dziś to
     dwie szeregowe podróże do bazy po odczycie ustawień. Wymaga migracji
     z grantami i bramki `generate:ts-sql-contract`.
3. Ustawić „Proporcje" w widgetach obrazu bez kadru (dane CMS).

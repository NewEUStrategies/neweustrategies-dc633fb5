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

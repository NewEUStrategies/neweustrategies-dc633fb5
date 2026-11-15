# Zimny start Workera, pozycja C2 roadmapy (2026-11-15)

Zlecenie: zmniejszyć to, co zimny izolat musi skompilować i wykonać, zanim odda
pierwszy dokument, przy identycznym HTML-u (`2026-11-14-roadmap-ladowanie.md`,
partia C). Punkt wyjścia z produkcji (pomiar z 14.11, nie powtarzany):
`/login` bez żadnego zapytania do bazy ma TTFB 2,2-2,4 s przy `app;dur`
600-790 ms, czyli ~1,5 s to start izolatu. Baza: `73cabcb7`.

Wszystkie liczby niżej pochodzą z LOKALNEGO workerd i służą do porównań
względnych. Maszyna pomiarowa była przez większość sesji obciążona przez inne
zadania (load 3-5 na 4 rdzeniach), dlatego każde porównanie to przebiegi na
przemian (baza, zmiana, baza, zmiana...) i dwie liczby: zakres oraz mediana.

## 1. Metoda

- Artefakt: `bun run build` (preset `cloudflare-module`), `.output/server`.
- Runtime: pakiet npm `workerd` 1.20261114.1 (binarka `workerd serve`), konfiguracja
  capnp z KAŻDYM plikiem `.mjs` artefaktu jako `esModule` (tak ładuje go
  `wrangler.json` z `no_bundle: true`), `nodejs_compat`, `SUPABASE_URL` na
  backend fixture.
- Backend: `handleClientBackendRequest` z `scripts/performance/clientBackend.ts`
  (te same dane co `replayFetch.mjs`) na `127.0.0.1:4199`, 40 ms na zapytanie.
- Próbka = świeży proces workerd, mierzone żądanie jest PIERWSZYM żądaniem procesu.
  Liczone: czas od startu procesu do końca dokumentu, TTFB żądania i czas CPU
  procesu (`/proc/<pid>/task/*/schedstat`) - zegar Workers stoi w czasie pracy
  CPU, więc to CPU jest tym, co produkcja płaci poza `app;dur`.
- Graf artefaktu: krawędzie statyczne (`import`/`export … from`) i `import()`
  czytane z plików `.mjs`; „domknięcie pierwszego dokumentu" = pliki statycznie
  osiągalne z loadera wejść TanStack Start, chunku routera i chunku startu.

Uprząż (generator konfiguracji, pomiar na przemian, porównanie HTML) nie jest
częścią repozytorium - workerd nie jest zależnością projektu.

## 2. Inwentarz artefaktu bazowego (`73cabcb7`)

1 893 moduły, 14,11 MB (`_ssr` 1 787 plików / 9,68 MB, `_libs` 98 / 3,45 MB,
korzeń 7 / 0,98 MB). Zgodne z wynikiem prac z 24.10 (1 891 / 14,09 MB).

| Klasa osiągalności                                                | Moduły |   MB |
| ----------------------------------------------------------------- | -----: | ---: |
| Pierwszy dokument: statyczne domknięcie loadera, routera, startu  |  377\* | 3,84 |
| Tylko przez komponenty tras (bez zaślepek panelu)                 |    412 | 4,09 |
| Tylko przez resolver funkcji serwerowych (388 funkcji)            |    249 | 2,00 |
| Tylko przez inne `import()` z domknięcia (widgety, ikony, Stripe) |    172 | 1,18 |
| Komponenty tras + inne `import()`                                 |    144 | 1,08 |
| Funkcje serwerowe + inne `import()` (m.in. render e-maili)        |    148 | 0,90 |
| Loadery tras, w tym kokpit panelu                                 |    116 | 0,87 |
| Pozostałe kombinacje                                              |     65 | 0,15 |
| Zaślepki panelu (24.10)                                           |    210 | 0,01 |

\* w tym trzy pliki ładowane przy starcie izolatu (`index.mjs` i dwa chunki
`_libs`, 0,37 MB) - jedyne statyczne domknięcie wejścia Workera.

Największe pliki: `_libs/@lovable.dev/mcp-js+[...]` 554 kB, `@react-email/render`
372 kB, `router` 360 kB, `index.mjs` 352 kB (w tym manifest 1 601 zasobów
statycznych Nitro), manifest Start 345 kB, `@tanstack/react-router+[...]` 330 kB,
`xlsx` 328 kB, `Chart` 230 kB, `stripe` 215 kB, `admin` (layout) 187 kB.

### Z czego składa się zimny start (maszyna bez obciążenia, 5 przebiegów)

| Wariant                                                    |    start → koniec odpowiedzi |
| ---------------------------------------------------------- | ---------------------------: |
| pusty Worker (jeden moduł)                                 |                     23-28 ms |
| wszystkie 1 893 moduły, moduł główny NICZEGO nie importuje |     424-510 ms (mediana 473) |
| pierwszy `GET /login`                                      |     735-839 ms (mediana 808) |
| pierwszy `GET /`                                           | 949-1 057 ms (mediana 1 031) |

Wniosek: **ponad połowa zimnego startu `/login` (ok. 450 z 808 ms) to sama
obecność 14 MB modułów w skrypcie** - workerd kompiluje każdy moduł przed
pierwszym żądaniem, także nigdy niewykonany (~32 ms na MB). Reszta to ewaluacja
domknięcia dokumentu i render. Stąd dwie dźwignie: bajty artefaktu i kod
ewaluowany z pierwszym dokumentem.

## 3. Co zmieniono

### 3.1. SDK MCP poza domknięciem pierwszego dokumentu (`290efb64`)

Największym plikiem domknięcia dokumentu był chunk SDK Model Context Protocol
(554 kB: `@lovable.dev/mcp-js`, `@modelcontextprotocol/sdk`, ajv, jose, zod v4),
choć `routes/mcp.ts` ładuje SDK przez `import()`. Rolldown dokłada do grupy
vendora zależności jej modułów (`includeDependenciesRecursively`), więc grupa SDK
zabrała `zod` (183 importy w `src/`) i polyfill `performance` z `unenv`; chunk
miał 20 statycznych importerów w domknięciu routera. Profil Node pierwszego
`/login`: ewaluacja najwyższego poziomu tego chunku 43 ms - najwięcej ze
wszystkich modułów. Workerd, sam import chunku na świeżym procesie, 12 przebiegów
na przemian: +39-40 ms CPU; `zod` osobno 0-1 ms.

Zmiana: `scripts/lib/serverVendorChunks.ts` - grupy `_libs/zod` (wejście paczki
i `v3`) i `_libs/unenv` z priorytetem wyższym niż grupa Nitro, podane opcją
`rolldownConfig` w obu presetach. Zestaw modułów i ich kod bez zmian.
Domknięcie dokumentu: 3,84 → 3,40 MB.

Strażnik: reguła „wyłącznie przez `import()`" w `check:server-entry-purity`
liczyła dotąd tylko pliki statycznie osiągalne z korzeni bez importerów (trzy
pliki), więc domknięcia dokumentu nie widziała. Teraz liczy oba zbiory
(`documentBaselineChunks`) i obejmuje chunk SDK; na artefakcie bazowym oblewa.

### 3.2. Komponenty tras `ssr: false` (`21eef54a`)

Dopasowanie trasy z `ssr: false` router owija w `<ClientOnly>`, który na serwerze
zwraca wyłącznie `fallback`; `MatchInner`, jedyne miejsce renderujące `component`
(a na serwerze także `errorComponent`/`notFoundComponent`), siedzi w środku.
Wtyczka `clientOnlyRouteStubPlugin` podmienia więc w środowisku `ssr` grupy
`component` i `errorComponent`/`notFoundComponent` na zaślepkę: 15 tras poza
panelem (skaner, bilet, rejestracja, wiadomości…); dwie trasy panelu z tą opcją
zaślepkę miały już wcześniej.
`pendingComponent` zostaje (to on jest serwerowym `fallback`), tak jak `loader`,
`beforeLoad` i `head`. Artefakt: −0,42 MB, −51 modułów.

Strażnik: bramka bierze listę tras z `ssr: false` ZE ŹRÓDEŁ i dla każdej wymaga
sprawdzonego importera komponentu pod zaślepką; do tego kontrola zwrotna -
zaślepka pod trasą, którą serwer renderuje, oblewa. Wzorzec wykrywania opcji
jest porównywany testem z drzewem składni każdego pliku trasy.

### 3.3. Komponenty podstron `/profile/*` (`2d3e86a3`)

`ProfileLayout` owija `<Outlet/>` w `AuthGate`; sesja żyje w `localStorage`,
`AuthProvider` zaczyna od `session: null` i ustawia ją tylko w efektach, więc
serwer oddaje sam spinner bramki. `profile` dopisany do `CLIENT_ONLY_LAYOUTS`
(reguła jak dla `/admin`). Dowód własności: `profileRouteSsr.test.tsx` - render
serwerowy pod prawdziwym `AuthProvider`, `useAuth` i `AuthGate`, bez `window`.
Artefakt: −0,45 MB, −47 modułów.

## 4. Wynik

| Artefakt                   | Moduły |    MB | Domknięcie dokumentu |
| -------------------------- | -----: | ----: | -------------------: |
| baza `73cabcb7`            |  1 893 | 14,11 | 377 plików / 3,84 MB |
| po 3.1                     |  1 894 | 14,10 | 377 plików / 3,40 MB |
| po 3.1 + 3.2               |  1 843 | 13,68 |        (nie liczone) |
| **HEAD (3.1 + 3.2 + 3.3)** |  1 796 | 13,23 | 358 plików / 3,39 MB |

Lokalny workerd, baza i HEAD na przemian, 12 przebiegów każdy, maszyna
OBCIĄŻONA (load ~4), więc wartości bezwzględne są wyższe niż w tabeli z §2:

| Pierwsze żądanie | Artefakt | start → koniec dokumentu | TTFB żądania         | CPU workerd          |
| ---------------- | -------- | ------------------------ | -------------------- | -------------------- |
| `GET /login`     | baza     | 872-1 128 (med. 1 025)   | 723-973 (med. 830)   | 781-1 040 (med. 910) |
| `GET /login`     | HEAD     | 834-1 196 (med. 995)     | 672-918 (med. 813)   | 731-947 (med. 886)   |
| `GET /`          | baza     | 1 094-1 418 (med. 1 192) | 877-1 163 (med. 967) | 915-1 255 (med. 999) |
| `GET /`          | HEAD     | 1 010-1 298 (med. 1 111) | 777-1 054 (med. 889) | 848-1 125 (med. 911) |

Czyli na medianie: `/login` −30 ms (−3 %) czasu i −24 ms CPU, `/` −81 ms (−7 %)
czasu i −88 ms CPU; na minimach CPU −50 ms i −67 ms. To zysk rzędu kilku procent,
nie przełom: zestaw zmian zdjął 6 % bajtów artefaktu i 12 % kodu ewaluowanego
z pierwszym dokumentem. Rozrzut pojedynczych przebiegów (±150 ms) jest większy niż
różnica median dla `/login`, więc tej liczby nie należy czytać dokładniej niż
„kilkadziesiąt milisekund".

Bez zmian (porównanie plik po pliku, sha256): cały bundel przeglądarki
(`.output/public`, 1 620 plików), manifest TanStack Start; resolver funkcji
serwerowych ma 388 funkcji i 131 chunków docelowych w obu artefaktach, każdy cel
`import()` istnieje, brak cykli statycznych importów, jeden moduł z top-level
await (`i18n`) bez krawędzi zwrotnej - jak na bazie.

## 5. Równoważność HTML

Artefakt `cloudflare-module` na workerd, backend fixture, każdy adres na ŚWIEŻYM
procesie (zimny), po 3 pobrania; porównywane: status, nagłówki odpowiedzi (bez
`date`, `server-timing`, nonce CSP) i ciało po normalizacji nonce i znaczników
czasu. 21 adresów: `/`, `/blog`, `/events`, `/login`, `/en`, `/kontakt`,
`/profile`, `/profile/edit`, `/profile/membership`, `/scanner`, `/messages`,
`/events/abc/register`, `/events/abc/ticket`, `/checkout/abc`, `/admin`,
`/admin/posts`, `/admin/events/abc/registration/tickets`, `/admin/analytics/bi`,
`/admin/nie-ma-takiej`, `/mcp` (401), `/nie-ma-takiej-strony`.

- 19 adresów: identyczne co do bajta w każdym pobraniu.
- `/blog`: dwa warianty różniące się wyłącznie KOLEJNOŚCIĄ dwóch zapytań
  w zdehydratowanym stanie (wyścig równoległych odpowiedzi fixture); oba warianty
  występują na bazie i na HEAD.
- `/en`: w tej serii 1 z 3 pobrań HEAD dało wariant zdegradowany (`private,
no-store`, bez preloadu okładki). To istniejące zachowanie zależne od czasu
  (termin loadera): pod sztucznym obciążeniem CPU baza oddała taki sam wariant
  (log: `degraded render, seeded fallback for home.settings`), a przy 25
  pobraniach na przemian bez dodatkowego obciążenia baza i HEAD dały po 25
  dokumentów pełnej długości (335 081 B), bez degradacji.

Jedno zdarzenie bez wyjaśnienia: w osobnej serii 10 pobrań `/en` jeden dokument
HEAD został ucięty przez strażnika strumienia po 37,6 s
(`ssr-doc-guard:truncated reason="timeout"`), czyli jedna granica Suspense się nie
rozstrzygnęła. Nie powtórzyło się w 75 kolejnych zimnych pobraniach HEAD (25 bez
obciążenia, 50 pod sztucznym obciążeniem) ani w 88 pobraniach bazy. Analiza grafu
nie pokazuje różnicy, która mogłaby zawiesić ładowanie modułów (brak cykli, ten
sam jedyny moduł z top-level await), a maszyna w tym czasie ubijała procesy
z braku pamięci - najbardziej prawdopodobna jest zgubiona odpowiedź backendu
fixture, ale tego nie dowiodłem.

## 6. Zastrzeżenie: preset hostingu

`@lovable.dev/vite-tanstack-config` zna preset `lovable-fetch-bundle`
(`inlineDynamicImports: true`, jeden plik), wybierany zmienną środowiska hostingu.
Nie sprawdzałem, którym presetem budowana jest produkcja. Jeśli jednym plikiem:
zaślepki (3.2, 3.3) nadal zdejmują bajty, a 3.1 nie ma znaczenia (bez chunków
vendorów nie ma błędnego przydziału `zod`; grupy są wtedy pomijane przez Nitro).

## 7. Ocena „front door" (C1) - tylko projekt

Pomysł: oddać dokument z cache w `src/server.ts` przed `import()` wejścia SSR.

**Ile da się zyskać.** Front door omija ewaluację domknięcia dokumentu, łańcuch
middleware, odczyty routingu i render, ale NIE omija kompilacji skryptu: workerd
kompiluje wszystkie moduły, zanim wykona pierwszy. Lokalnie dolną granicą jest
więc wiersz „moduł główny niczego nie importuje" z §2: ~470 ms z 1 030 ms dla `/`
(−55 %) i z 808 ms dla `/login` (−40 %), plus koszt odczytu cache. Każdy megabajt
zdjęty z artefaktu obniża tę granicę o ~32 ms.

**Czego wymaga na obecnym hostingu**, gdzie współdzielone Cache API nie działa
(`nes-l2-fail;desc="put"`), a pamięć izolatu (L1) nie przeżywa żądania:

1. **Współdzielony magazyn osiągalny jednym żądaniem.** Bez Cache API i bez
   bindingów KV/R2 zostaje Supabase: tabela migawek dokumentów czytana jednym RPC
   albo obiekt w Storage. To round-trip do eu-west-1 (z IAD 110-360 ms na
   zapytanie wg pomiaru z 22.10) i wymaga migracji - czyli zgody właściciela.
2. **Klucz liczony bez routera.** Dzisiejszy klucz bierze host zwalidowany
   z katalogiem tenantów (`trustedPublicHost`, odczyt service-role na zimnym
   izolacie). Front door musi kluczować surowym hostem i ścieżką i ufać temu, że
   wpisy zapisuje wyłącznie render wykonany pod zwalidowanym hostem (obcy host
   daje MISS i idzie zwykłą drogą).
3. **Warianty znane przed routerem:** język (ciasteczko i `Accept-Language` -
   logika `homepageLangMiddleware`), klasa UA, GPC, żądania z sesją i podglądem
   (BYPASS). Każdy wymiar, którego front door nie odtworzy, musi dawać MISS.
4. **To, co dziś stoi PRZED cache'em w łańcuchu:** przekierowania (reguła dodana
   po zapisie migawki nie może zostać przesłonięta - purge albo wersja reguł
   w kluczu), kanoniczny host, nagłówki bezpieczeństwa i CSP z nonce zapisanym
   razem z dokumentem.
5. **Unieważnianie:** `purgeDocumentPaths*` musi czyścić także magazyn zewnętrzny;
   STALE wymaga rewalidacji w tle (`waitUntil`), która i tak zaimportuje router.
6. **Strażnik:** reguła w `check:server-entry-purity`, że statyczne domknięcie
   chunku `src/server.ts` nie zawiera routera ani startu i mieści się w limicie.

**Rekomendacja.** Na własnym koncie Cloudflare (W1) front door to `caches.match`
przed importem - kilkadziesiąt linii i zysk bliski granicy z góry. Na obecnym
hostingu wymaga magazynu w bazie, migracji i pełnego odwzorowania wariantów,
a zysk pomniejsza round-trip do eu-west-1; nie zaczynałbym go przed decyzją W1.

## 8. Co zostaje (szacunki rozmiaru, nie pomiary zysku)

| Pozycja                                                                                             | Rozmiar w artefakcie HEAD | Uwagi                                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------: | ------------------------------------------------------------------------------------------------------- |
| Parser `.docx` na serwerze (mammoth, jszip, bluebird, dingbat, xmldom, lop)                         |                   0,51 MB | wołany tylko z `useEffect` podglądu dokumentów; wtyczka `officeParserTrim` działa dziś tylko w kliencie |
| Kokpit `/admin/` (grupa `loader` + `component`: `AdminDashboard`, `biChart`, `RealizedRevenueTile`) |                   0,25 MB | loader na serwerze nic nie robi, ale grupa z loaderem jest poza zasadą zaślepek                         |
| Layout `/admin` (`AdminShell` + `AdminSession`; serwer renderuje tylko szkielet)                    |                   0,19 MB | wymaga rozcięcia komponentu, nie zaślepki                                                               |
| Inne powierzchnie z bramką sesji (`/network`, `/reading-list`, `/checkout/*`, `/people`)            |                  ~0,10 MB | każda wymaga własnego dowodu jak `/profile`                                                             |
| `prettier` w `@react-email/render` (372 kB chunku)                                                  |                  ~0,30 MB | do sprawdzenia, czy `pretty` jest używane                                                               |
| Manifest zasobów statycznych Nitro w `index.mjs` (1 601 wpisów)                                     |                   0,34 MB | kod Nitro; ewaluowany przy starcie izolatu                                                              |
| Manifest TanStack Start                                                                             |                   0,34 MB | ewaluowany z pierwszym dokumentem                                                                       |
| Moduły funkcji serwerowych i ich biblioteki (xlsx, Stripe, render e-maili)                          |                   ~3,0 MB | potrzebne, już za `import()`; płacą tylko kompilację                                                    |

Największą dźwignią pozostaje hosting: ciepły izolat i działający cache
współdzielony (W1), jak w `2026-10-24-zimny-start-workera.md` §6.

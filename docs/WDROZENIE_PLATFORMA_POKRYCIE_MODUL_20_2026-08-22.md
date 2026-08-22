# Platforma / backend / infrastruktura / SSR (MODUŁ 20): powierzchnie etapów 1–8, bramka zakresu najemcy i zapadka progów (2026-08-22)

Zlecenie: **95% linii i 93% gałęzi na powierzchniach etapów 1–8**, dodatkowo instrukcje ≥ 95%
i funkcje ≥ 93% — ten drugi warunek jest po to, żeby „95% linii” nie dało się ugrać renderem
bez asercji. Cel dla całego modułu: z 55,12% linii / 42,82% funkcji na **≥ 88% / ≥ 85%**.

**Wynik: jedenaście powierzchni na celu, trzy pod celem tylko na gałęziach nieosiągalnych,
dwie trasy nie, cel modułowy nie.**
Zmierzone: moduł **65,01% → 83,34% linii** i **60,19% → 82,21% funkcji** — czyli poniżej celu
88/85. Rozdział 6 wypisuje z numerami linii wszystko, czego nie dowieziono, i dlaczego.
Rozdział 7 to osobne zgłoszenie dla człowieka: **bramka zakresu najemcy jest zielona,
ale znalazła jeden defekt schematu, którego test nie może naprawić.**

| Powierzchnia (etap)                              | Linie: przed → po  | Gałęzie: po | Cel     |
| ------------------------------------------------ | ------------------ | ----------- | ------- |
| Analizator bramki zakresu najemcy (1)            | **nowy → 100%**    | 100,00%     | ✅      |
| Gramatyka adresów publicznych, `lib/routing` (2) | 42,9% → **100%**   | 100,00%     | ✅      |
| Powłoka: `cacheBusting` (3)                      | **0,0% → 100%**    | 93,88%      | ✅      |
| Powłoka: `smoothAnchorScroll` (3)                | 15,2% → **100%**   | 89,47%      | ⚠️ §6.3 |
| Powłoka: `seo/rootHead` (3)                      | **nowy → 100%**    | 100,00%     | ✅      |
| Powłoka: `theme/themeInitScript` (3)             | **nowy → 100%**    | 100,00%     | ✅      |
| Pięć czytników service-role, `lib/server` (4)    | **0,0% → 100%**    | 100,00%     | ✅      |
| Trzynaście plików `lib/queries` (5)              | 25,1% → **100%**   | 99,28%      | ✅      |
| Watchdog strumienia SSR, `lib/ssr` (6)           | 23,8% → **97,20%** | 85,71%      | ⚠️ §6.2 |
| Menedżer przekierowań, `redirects.functions` (7) | **0,0% → 100%**    | 89,47%      | ⚠️ §6.4 |
| Sesja podglądu, `lib/preview` (7)                | 36,6% → **100%**   | 95,92%      | ✅      |
| `lib/readingList` + `lib/collections` (8)        | **nowe → 100%**    | 100,00%     | ✅      |
| Komponenty wyprowadzone z tras, 28 plików (8)    | **nowe → 100%**    | 99,43%      | ✅      |
| Trzy trasy publiczne (8)                         | 0,0% → **100%**    | 99,08%      | ✅      |
| `src/routes/$.tsx` (2)                           | 0,0% → **32,87%**  | 11,63%      | ❌ §6.1 |
| `src/routes/__root.tsx` (3)                      | 0,0% → **0,0%**    | 0,00%       | ❌ §6.1 |

---

## 1. Jak odtworzyć te liczby

Środowisko, dokładnie w tej kolejności — drugi krok jest **obowiązkowy**, bez niego
około 250 plików testowych pada na `Cannot find module`:

```bash
npm install --no-audit --no-fund --legacy-peer-deps
npm install --no-save --legacy-peer-deps @testing-library/dom jsdom
```

`package-lock.json` nie jest commitowany, `package.json` nie jest zmieniany.

Pomiar:

```bash
npx vitest run --coverage
```

Oba końce (PRZED: `6426bd039`, PO: HEAD tej gałęzi) mierzone **tym samym poleceniem
i tym samym zbiorem plików**. Zbiór „MODUŁ 20” jest zdefiniowany jawnie, żeby liczba
dała się sprawdzić, a nie tylko przeczytać:

```
src/lib/server/**   src/lib/queries/**   src/lib/ssr/**    src/lib/http/**
src/lib/ci/**       src/lib/a11y/**      src/lib/mcp/**    src/lib/errors/**
src/lib/routing/**  src/lib/preview/**   src/lib/seo/**
src/routes/__root.tsx   src/routes/$.tsx
src/lib/cacheBusting.ts   src/lib/smoothAnchorScroll.ts   src/lib/redirects.functions.ts
```

**Ten zbiór to MOJA definicja, nie zbiór z audytu.** Zlecenie podawało punkt wyjścia
„186 plików, 66 na zerze, 3 916 linii bez pokrycia, 55,12% linii / 42,82% funkcji”,
ale bez listy plików — nie dało się jej odtworzyć, więc nie udaję, że mierzę to samo.
Definicja powyżej daje 152 pliki PRZED i 156 PO. Liczby w tabeli poniżej są policzone
na niej po obu stronach, więc **różnica jest prawdziwa**; wartość bezwzględna nie jest
porównywalna z 55,12% ze zlecenia i nie należy jej tak czytać.

| Miara (MODUŁ 20, definicja wyżej) | PRZED `6426bd039` | PO HEAD    | Δ         |
| --------------------------------- | ----------------- | ---------- | --------- |
| Instrukcje                        | 63,80%            | **82,03%** | +18,23 pp |
| Gałęzie                           | 54,10%            | **71,84%** | +17,74 pp |
| Funkcje                           | 60,19%            | **82,21%** | +22,02 pp |
| Linie                             | 65,01%            | **83,34%** | +18,33 pp |
| Plików na zerze                   | 37                | **18**     | −19       |
| Linii bez pokrycia                | 2 647             | **1 276**  | −1 371    |

Całe `src/` (nie tylko ten moduł): **67,42% → 69,28% linii**, 66,37% → 68,27% instrukcji,
64,62% → 66,25% funkcji, 61,16% → 62,80% gałęzi.

Suita: **1 421 → 1 459 plików testowych**, 34 045 → 35 240 testów zielonych,
36 → 74 przypadków `it.fails`. Dołożone: 36 nowych plików testowych (plus jeden wzmocniony), 18 678 linii testów,
38 nowych rekordów `it.fails`.

---

## 2. Etap 1: bramka zakresu najemcy — najwyższy priorytet zlecenia

Czytniki `service-role` **omijają RLS**. Dla nich baza nie jest linią obrony, więc
jedynym dowodem, że powierzchnia crawlera nie miesza najemców, jest kod czytnika.
Ten dowód nie mieszkał nigdzie: pgTAP pilnuje polityk (których tu nie ma),
a testy jednostkowe pilnowały kształtu odpowiedzi, nie zasięgu zapytania.

Stąd **bramka statyczna**, nie test zachowania: `src/lib/ci/serviceRoleTenantScope.ts`
(czysty analizator, 100/100/100/100) plus
`src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts` (13 zielonych + 1 `it.fails`).
Bramka przypina cztery rzeczy naraz:

1. **rejestr ośmiu czytników** `SERVICE_ROLE_READERS` — nowy plik z `supabaseAdmin`
   albo trafia na listę, albo bramka czerwienieje;
2. **sześć wyjątków** `EXEMPTIONS`, każdy kluczem `plik::tabela` i każdy z uzasadnieniem
   w kodzie — tabela globalna albo zapytanie już zawężone wcześniej;
3. **`tenantId` jako PIERWSZY parametr** każdego czytnika oraz `${tenantId}` w każdym
   kluczu `edgeTtlCache` — bo cache bez najemcy w kluczu to wyciek między najemcami
   przez pamięć, nie przez bazę;
4. **dwanaście powierzchni crawlera rozwiązuje najemcę płaszczyzną FAIL-CLOSED**
   (`resolveCrawlerTenantForHost`), a nie tą treściową (`resolveTenantForHost`,
   która nieznanemu hostowi oddaje najemcę DOMYŚLNEGO).

Test „kanarka zasięgu” jest częścią bramki: wstawia do analizatora zapytanie bez
filtra najemcy i **wymaga**, żeby bramka je zgłosiła. Bez tego bramka mogłaby być
zielona, bo nic nie wykrywa.

Trzy założenia ze zlecenia okazały się nieprawdziwe i zostały zastąpione
prawdziwym niezmiennikiem — opis w rozdziale 8.

---

## 3. Etap 2: gramatyka adresów jako czysty moduł

`src/routes/$.tsx` rozwiązuje **każdy** publiczny adres, który nie trafił w trasę statyczną.
Decyzje (404 / przekierowanie taksonomii / 301 kanoniczny / treść) siedziały wplecione
w loader pliku trasy o 1 374 liniach, razem z nagłówkami cache i budżetami SSR — nie dało się ich
sprawdzić bez postawienia routera, klienta zapytań i bazy, więc nie były sprawdzone wcale.

Nowy `src/lib/routing/resolvePublicPath.ts` rozcina to w tym samym miejscu, w którym
rozcięty jest loader — bo między fazami siedzi I/O:

- `planPublicPath(splat)` — co da się rozstrzygnąć BEZ bazy (pusty adres, zwinięcie
  starych hierarchicznych adresów taksonomii do formy płaskiej);
- `resolveTaxonomyFallback(...)` / `resolveMissingContent(...)` — co robić, gdy zapytanie
  nie znalazło treści.

Funkcje zwracają **deskryptor decyzji**, nie gotowy `redirect()`/`notFound()`; rzucanie
zostaje w routerze. Dzięki temu decyzje są wartościami w tabeli przypadków.

Najważniejszy przypadek, który wcześniej nie miał dowodu: **pętla przekierowań.**
Gdy ścieżka kanoniczna wpisu równa się ścieżce żądanej, wpis JUŻ jest pod właściwym
adresem, a treści nie ma z innego powodu (wersja robocza, usunięcie, brak dostępu).
301 na siebie samego to nieskończona pętla w przeglądarce i u crawlera —
`resolveMissingContent` zwraca tu `{ kind: "not-found", reason: "self-redirect" }`.

---

## 4. Etapy 3–8: co dokładnie dostało dowód

**Powłoka (3).** `__root.tsx` schudł o 32 linie: `THEME_INIT_SCRIPT` (skrypt anty-FOUC
wykonywany w teście przez `new Function`, nie porównywany jako string),
`showsSiteChrome` + `CHROMELESS_PREFIXES`, oraz `rootDocumentLinks`/`rootLinkHeaderValues`
z testem parytetu `<link>` kontra nagłówek `Link`. `cacheBusting` i `smoothAnchorScroll`
dostały testy zamiast wyprowadzki — z osobnym plikiem w środowisku `node`
na strażniki SSR.

**Czytniki serwerowe (4).** Pięć plików z zera na 100/100/100/100 (cztery wymiary). Testy jadą na
**prawdziwym `edgeTtlCache`** i prawdziwym `createClient` ze wstrzykniętym `fetch` —
zero rzutowań typu klienta, zero sieci. Osobny test parytetu składania adresu
kanonicznego między czterema implementacjami, bo rozjazd tutaj to zły `<link rel=canonical>`
w sitemapie.

**Warstwa zapytań (5).** Trzynaście plików z 25,06% na 100% linii (dwanaście z nazwanego
zakresu plus `archives.ts`); dziewięć z nich stało na zerze. Kluczowa asercja w każdym:
**łańcuch PostgREST nigdy nie rzuca** — błąd przychodzi w `error`. Powierzchnia, która
tego nie odróżnia, pokazuje awarię jako „brak danych”; ta klasa defektu wystąpiła
w tym repozytorium trzy razy.

**Watchdog strumienia SSR (6).** `queryStreamGuard` obchodzi błąd router-core 1.171:
`onRenderFinished` po cichu gubi nasłuch, gdy `cleanupStarted || streamFastPathReserved`,
więc strumień SSR nigdy się nie zamyka i klient dostaje **HTTP 200 z uciętym HTML-em**.
Test stawia kontrolowany strumień (`pushable<T>()`) i przechodzi trzy stany upstreamu:
domknięcie, błąd, zawieszenie do timeoutu.

**Przekierowania i sesja podglądu (7).** `redirects.functions` dostało cztery warstwy
kontraktu osobno (`requireStaff`, walidacja Zod, wpis do `audit_log`, limit) plus parytet
normalizacji ze współdzielonymi funkcjami z `lib/seo/redirects` — porównywany przez
**zapisany wiersz**, nie przez powtórzenie tej samej normalizacji w teście.

**Trasy i atomic design (8).** `reading-list.tsx` z 636 linii na 86. Logika wyszła
do `atoms/` (bez I/O i bez stanu serwera), `molecules/` (kompozycja + jedna
odpowiedzialność) i `organisms/` (sklejenie z danymi), a domenowe reguły do
`src/lib/readingList/guestSaved.ts` i `src/lib/collections/dedupeById.ts`.
Każda funkcja zwraca **klucz i18n albo deskryptor**, nigdy gotowy tekst — dlatego
testy asertują na KLUCZACH i ten sam test dowodzi zachowania w PL i EN.

**Usunięte, nie ukryte:** `src/components/admin/paywall/**` (17 plików) i
`src/components/people/molecules/**` (2 pliki) powstały w trakcie pracy, ale nigdy nie
zostały wpięte w trasy. Zostawienie ich znaczyłoby dwie równoległe implementacje reguł
paywalla — skasowane.

---

## 5. Etap 9: e2e i etap 10: zapadka

**E2E (+13 testów, wszystkie backend-agnostyczne — CI ma atrapy danych Supabase).**
`e2e/seo.spec.ts`: nazwa hosta w sitemapie, status 200 bez przekierowania, brak ścieżek
prywatnych, adres kanoniczny kontra adres KOŃCOWY po negocjacji języka, osiągalność
i wzajemność `hreflang`. `e2e/ssr-degradation.spec.ts`: siedem testów oznaczonych
`test.fail()` — e2e-owy odpowiednik `it.fails`, czyli udokumentowana degradacja zamiast
zielonego testu, który nic nie sprawdza.

**Zapadka (etap 10).** Progi per-ścieżka w `vitest.config.ts` — każdy wpis ma w komentarzu
zmierzoną liczbę i datę, a próg stoi 1–2 pp pod pomiarem (margines na dryf remapowania v8).
Próg globalny podniesiony z 58/54/58/52 na **64/62/65/58** (zmierzone minus ~4 pp na dryf CI —
ta sama reguła co wpisy z 2026-08-06, 2026-08-18 i 2026-08-20).

Dwie rzeczy, których te progi **nie** mówią, a które łatwo w nie wczytać:

1. Próg na warstwie prezentacji i na trasach chroni **stan i sklejenie, nie autoryzację**.
   Dowód, że trasa panelu sprawdza rolę, a nie tylko chowa przyciski, mieszka osobno
   w `adminRouteAuthority.gate.test.ts` (wzmocniony w tej pracy: widzi teraz trasy
   super-admina wielosegmentowe, sprawdza istnienie pliku trasy, kanarek podniesiony).
2. Próg na czytnikach service-role chroni **zachowanie**, nie izolację najemcy.
   Tego pilnuje bramka z rozdziału 2.

Jedna pomyłka pomiarowa w tej pracy warto zapisać, bo pokazuje, że zapadka działa:
wpisałem próg katalogowy `src/lib/theme/**` z gałęziami 98 na podstawie przebiegu
na **jednym** pliku (`themeInitScript.ts`, 100 na czterech wymiarach). Katalog niesie
siedem plików zastanych i stoi na 92,14% gałęzi. Pełna suita to złapała. Poprawione:
próg per-plik 98 dla `themeInitScript.ts`, osobny próg katalogowy 90 jako zapadka na to,
co katalog już osiągnął.

---

## 6. Czego NIE dowieziono — z numerami linii

Ten rozdział jest częścią raportu, nie przypisem. Procent ugrany wykluczeniem pliku
z pomiaru jest bezwartościowy, więc nic nie zostało wykluczone.

### 6.1 Dwie trasy: render, nie decyzja

**`src/routes/__root.tsx` — 0,00% na czterech wymiarach, 124 niepokryte linie:**
70, 77–78, 80–81, 83–84, 86–87, 89–90, 98–99, 111–112, 116–117, 127, 134–136, 145,
149–151, 154, 162, 190, 196, 204–205, 242–243, 250–251, 277–278, 282, 286, 288, 292,
296, 305–306, 308–309, 311–312, 314–316, 318, 325–327, 334, 346–350, 352, 355, 365–366,
371, 383–385, 389–390, 398, 402–405, 414, 423, 432–433, 451–452, 459–460, 462, 465–467,
470–473, 477, 484–486, 488, 491–494, 500–506, 511, 520–522, 533–535, 539–545, 552, 554.

**Przyczyna:** cały plik to komponent powłoki dokumentu (dostawcy kontekstu, `<head>`,
hydracja). Uruchomienie go wymaga pełnego drzewa routera z prawdziwym `RouterProvider`,
a nie pojedynczej trasy. Zlecenie mówiło wprost „tu NIE gonisz 95% renderem”, więc
zamiast tego **logika wyszła z pliku** do trzech czystych modułów po 100%
(`themeInitScript`, `siteChrome`, `seo/rootHead`) — plik został z samym JSX-em i sklejeniem.
Sensowne domknięcie tego to test integracyjny na `RouterProvider`, czyli osobna praca.

**`src/routes/$.tsx` — 31,86% instrukcji / 11,63% gałęzi / 9,68% funkcji / 32,87% linii
(z 0% przed), 145 niepokrytych linii.** Rozkład jest tu istotny:

- **pokryte:** `loader` (216–375) i `head()` (376–519) — czyli decyzja „co znaczy ten
  adres”, o którą szedł etap 2;
- **niepokryte, główna masa:** 532–1005 i 1330–1390, czyli `PublicErrorComponent` (531),
  `PublicPage` (555) i `ResolvedPage` (566) — **840 linii komponentu renderującego**;
  ~120 z 145 niepokrytych linii to on;
- **niepokryte, resztki w loaderze:** 184–190 (`buildCoverPreload`), 237, 287–288, 329,
  332, 342–343, 346, 348, 352, 354, 362, 373–374, 396, 443, 496.

**Przyczyna:** ta sama co przy `__root.tsx` — render treści potrzebuje routera,
klienta zapytań i prawdziwego dokumentu treści. Dowód decyzji adresowej przeniósł się
do `src/lib/routing/resolvePublicPath.ts` (100/100/100/100, 73 przypadki) i tam jest
sprawdzany bez routera.

### 6.2 `src/lib/ssr/**` — instrukcje 94,97% (cel 95), gałęzie 85,71% (cel 93)

`queryStreamGuard.ts` 95,94 / 85,36 / 100 / 98,50 · `queryTimeout.ts` 93,18 / 84,21 / 100 / 97,43.
**Dziewięć gałęzi w obu plikach jest nieosiągalnych przez publiczne API klienta zapytań:**
`catch` na `JSON.stringify` klucza, który react-query haszuje wcześniej;
`error instanceof Error` na wpisach, którym react-query czyści błąd przy starcie ponowienia;
strażniki liczników zerowanych w `close()`. Każda jest **przypięta testem, który to USTALA**,
a nie testem, który ją farmi — szczegóły w nagłówkach obu plików testowych.

### 6.3 `src/lib/smoothAnchorScroll.ts` — gałęzie 89,47% (cel 93)

Linie i funkcje na 100%. Sześć gałęzi nieosiągalnych: dwa martwe strażniki SSR
(każdy wywołujący strażnikuje wcześniej) i dwa strażniki podwójnego sprzątania,
do których nie ma drogi wywołania.

### 6.4 `src/lib/redirects.functions.ts` — gałęzie 89,47% (cel 93)

Instrukcje 95,51%, linie i funkcje 100%. Reszta gałęzi to warianty błędu PostgREST,
które ten plik przekazuje wyżej bez rozgałęziania decyzji.

### 6.5 Cel modułowy 88/85 — nie osiągnięty (83,34% linii / 82,21% funkcji)

1 276 linii bez pokrycia zostało w zbiorze. **Poza etapami 1–8** siedzi z tego 1 003 linie
i to tam jest cała brakująca masa — pliki, których zlecenie nie nazwało:

| plik                                       |  linie | gałęzie | niepokrytych linii |
| ------------------------------------------ | -----: | ------: | -----------------: |
| `src/lib/seo/ogCardCanvas.ts`              |  3,44% |   0,00% |                 56 |
| `src/lib/queries/relatedPosts.ts`          |  3,70% |   0,00% |                 52 |
| `src/lib/queries/blocks.ts`                | 74,19% |  43,04% |                 48 |
| `src/lib/seo/headingValidation.ts`         | 41,46% |  36,95% |                 48 |
| `src/lib/server/jobsTick.server.ts`        |  6,12% |   2,63% |                 46 |
| `src/lib/http/documentCache.server.ts`     | 81,74% |  66,94% |                 44 |
| `src/lib/seo/linkSuggestions.functions.ts` |  4,34% |   0,00% |                 44 |
| `src/lib/queries/podcasts.ts`              | 28,33% |   3,94% |                 43 |
| `src/lib/server/aiTranslate.server.ts`     |  0,00% |   0,00% |                 42 |
| `src/lib/server/jobScheduler.server.ts`    |  0,00% |   0,00% |                 41 |
| `src/lib/seo/redirects.server.ts`          | 41,26% |  17,30% |                 37 |
| pozostałe 59 plików poza etapami 1–8       |      — |       — |                502 |

Te pliki nie były w nazwanym zakresie i nie zostały „po cichu” pominięte — są tu wypisane,
bo domknięcie celu 88/85 to praca nad nimi, nie nad powierzchniami z etapów 1–8, które
stoją na 100%. Progi per-ścieżka **nie** zostały na nie założone, żeby zapadka nie
zamroziła stanu, którego nikt nie zmierzył jako docelowego.

### 6.6 Test, który był flaky przed tą pracą i nadal jest

`src/routes/__tests__/adminImportWordpressRoute.test.tsx` przewraca się mniej więcej
raz na trzy przebiegi (przeciek języka i18n między testami w tym samym pliku:
opis „wersja angielska” znajduje polski tekst). **To nie jest regresja tej pracy** —
na commicie bazowym `6426bd039`, bez ani jednej mojej zmiany, ten sam plik przewrócił się
2 razy na 5 uruchomień w izolacji. Zgłoszone tu, nie naprawione: naprawa to reset i18n
w `afterEach` tamtego pliku, czyli praca w cudzym module.

Poza tym: `npm run check:bundle` jest czerwone (3 898,3 KB > 3 894 KB), ale
`reports/bundle-baseline.json` był ostatnio commitowany na `b446754` (2026-08-16),
**546 commitów** przed punktem startowym tej pracy. Też nie moja regresja.

---

## 7. Do zgłoszenia człowiekowi: bramka zakresu najemcy jest zielona, ale znalazła defekt schematu

**Bramka: ZIELONA.** Osiem czytników service-role, dwanaście powierzchni crawlera,
sześć uzasadnionych wyjątków — wszystko przypięte. Żaden czytnik nie odpytuje tabeli
bez filtra najemcy, każdy bierze `tenantId` jako pierwszy parametr, każdy klucz
`edgeTtlCache` zawiera `${tenantId}`, i każda powierzchnia crawlera rozwiązuje najemcę
płaszczyzną fail-closed. Kanarek zasięgu dowodzi, że bramka faktycznie wykrywa naruszenie.

**Jeden defekt, którego bramka nie może naprawić — zgłoszony jako `it.fails`
w `serviceRoleTenantScope.gate.test.ts`:**

`fetchPagePaths` (`publishedContent.server.ts:59`) filtruje `pages` po najemcy poprawnie,
ale **pełną ścieżkę składa RPC `public.page_full_path(_page_id uuid)`**
(migracja `20260531223436`, linie 52–66): rekurencyjne CTE idące w GÓRĘ po `pages.parent_id`,
**bez predykatu najemcy**, `LANGUAGE sql STABLE` — czyli SECURITY INVOKER, a wołane spod
service-role nie ma nad sobą RLS.

Schemat tego nie domyka: `pages.parent_id` ma wyłącznie
`REFERENCES public.pages(id) ON DELETE RESTRICT` — żadnego `CHECK`-a ani triggera
„ten sam najemca”, a `uniq_pages_tenant_parent_slug` pilnuje unikalności slugu,
nie zgodności najemcy. **Żaden plik pgTAP nie wspomina `page_full_path`.**

**Konsekwencja:** strona z `parent_id` wskazującym stronę innego najemcy wnosi JEGO slug
do ścieżki kanonicznej publikowanej w **sitemapie i RSS-ie** — na tej samej powierzchni,
którą chroni cała reszta bramki. Skala mniejsza niż wyciek treści (przecieka segment adresu,
nie wiersz), ale to ta sama klasa i ta sama powierzchnia.

**Naprawa to migracja schematu** — albo predykat najemcy w `page_full_path`, albo trigger
„ten sam najemca” na `pages.parent_id`. To decyzja dla człowieka, nie dla testu, dlatego
`it.fails` z pełnym opisem zamiast zmiany zachowania produkcyjnego.

---

## 8. Trzy założenia zlecenia, które okazały się nieprawdziwe

Zapisane, bo następna praca nad tym modułem wyjdzie z tych samych założeń, jeśli nikt
ich nie skoryguje.

1. **„`publishedContent.server.ts` woła `resolveTenantForHost`”** — nie woła. Bierze
   `tenantId` jako pierwszy parametr, a trasy crawlera rozwiązują najemcę **wariantem
   fail-closed** (`resolveCrawlerTenantIdForHost`), nie treściowym. Różnica jest istotna:
   plan treściowy nieznanemu hostowi oddaje najemcę DOMYŚLNEGO, co na powierzchni
   crawlera byłoby dokładnie tym wyciekiem, którego szukamy. Bramka przypina wariant
   fail-closed jako wymóg.
2. **„`cacheBusting.ts` porównuje manifest / odcisk builda”** — nie ma tam ani manifestu,
   ani odcisku. Jest jedna zależność: obiekt z `invalidate()`. Parametr został zawężony
   typem (`SoftRefreshable`), więc test nie musi stawiać routera.
3. **„404 i granica błędu używają kluczy i18next”** — nie używają, i to jest celowe.
   Ta warstwa renderuje się **poza dostawcą i18n**, więc korzysta z `errorCopy.ts`
   (`Record<"pl" | "en", ErrorCopy>`). Test asertuje na tym słowniku; wymuszenie tam
   i18next byłoby zmianą produkcji pod test.

---

## 9. Ograniczenia, których praca się trzymała

- **Nie ruszono `src/routes/admin.login-settings.tsx`** (etap 1 równoległego MODUŁU 15).
- **`src/lib/ci/**` bez ani jednego nowego pliku** — tylko dołożenie gałęzi, bez
  przepisywania (wyjątek: `serviceRoleTenantScope.ts` jako nowy analizator bramki etapu 1).
- **Zero testów RLS/RPC w vitest** — to własność pgTAP (20+ plików). Zakres tej pracy to
  kod, którego RLS **nie** chroni (service role) i sklejenie.
- **Zero zmian zachowania produkcyjnego pod test.** Defekt → `it.fails` z opisem;
  38 nowych rekordów.
- **Zero sieci, zero prawdziwej bramki AI, zero sekretów** w testach.
- **Zero `any`, zero `as unknown as`, zero `@ts-expect-error`** w nowym kodzie
  (dwa podwójne rzutowania, które powstały po drodze, zostały usunięte — zejście przez
  `unknown` w deklaracji plus jawny strażnik `typeof`).
- **Determinizm:** brak `Date.now()`, `Math.random()` i `setTimeout` w testach; stała data
  bazowa i `waitFor`; stan atrap przez `vi.hoisted()`.
- **Zero testów bez asercji i zero pętli renderujących trasy dla procenta.** Repozytorium
  raz raportowało 98% z takiej warstwy i samo ją usunęło.

Bramki zielone: `check:i18n-hardcoded`, `check:i18n-default-value`,
`check:i18n-overlay-imports`, `check:i18n-parity`, `check:unknown-casts`,
`check:stale-never-casts`, `check:content-layering`, `check:gate-coverage`,
`check:public-assets`, `check:legacy-payment-refs`, `check:sql-tenant-scope`,
`check:sql-owner-tenant-scope`, `check:authz-snapshot`, `check:entry-purity`,
`tsc --noEmit`, `eslint`.

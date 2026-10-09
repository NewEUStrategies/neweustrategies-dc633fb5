# P3.6a, runda poprawek 9: czerwone `check:bundle` / `check:entry-purity` (układ artefaktu serwera)

Worktree: `scratchpad/wt3/P3.6a`, gałąź `perf/w3-P3.6a`, nowy commit `af98a5a8` (nad `01670c0a`, bez przepisywania
historii). Ustalenie wejściowe: `PROVE.md` §2.1 (blokujące).

## 0. Werdykt w skrócie

- **Ustalenia blokującego nie da się zamknąć w plikach pozycji.** Sprawdziłem trzy warianty w plikach pozycji
  (model Rollupa i eksperyment w vitest, §2). Każdy albo zostawia bramki czerwone, albo psuje transformację testów
  vitest. Oba warianty, które działają, wymagają jednego pliku spoza listy.
- **Gotowa, sprawdzona łatka bramek (wariant A, zalecany):**
  `scratchpad/phase3/wave3/P3.6a/fix9-gates-scan-ssr.patch`. Zmienia trzy funkcje: `findBootChunks()` w
  `scripts/check-bundle-size.ts` i `scripts/check-entry-purity.ts` oraz `manifestBootRoots()` w
  `scripts/performance/documentWeight.ts`. Najpierw szukają jak dotąd na najwyższym poziomie `.output/server`, a potem
  w `.output/server/_ssr` (tam tylko wąski wzorzec mapy bootu). `git apply --check` w worktree przechodzi. Prettier i
  tsc na trzech plikach są zielone. Zastosowana w kopii lustrzanej (worktree nietknięty) daje zielone
  `check:bundle` i `check:entry-purity` na artefakcie P3.6a, z tymi samymi liczbami co Prove z `ENTRY_CHUNKS`. Na
  artefakcie bazy wynik jest identyczny jak bez łatki (§3).
- **W plikach pozycji (commit `af98a5a8`):**
  - MINOR-1 z recenzji: nieudany odczyt mapy bootu nie jest zapamiętywany.
  - Komentarz `documentBuildId()` opisuje skutek dla układu artefaktu i warunek dla bramek.
  - Nagłówek modułu jest poprawiony zgodnie z MAJOR-2 recenzji, w części dotyczącej komentarza.
  - Nowy test z kontrolą mutacyjną.
  - Szybkie bramki są zielone.

## 1. Przyczyna (potwierdzona)

`documentBuildId()` importuje `@/lib/boot/bootManifest` dynamicznie. W buildzie zaślepka jest czystym reeksportem
`nesBootManifest` z wirtualnego modułu `tanstack-start-manifest:v`. Import robi z niej NOWY dynamiczny punkt wejścia.
Jej pusty chunk Rollup scala z chunkiem modułu manifestu, bo ten jest ładowany zawsze, gdy ładowany jest ona. Chunk po
scaleniu dostaje nazwę od ostatniego modułu, czyli `bootManifest`. Nitro (`getChunkName`: nazwy z `_` na najwyższym
poziomie, reszta w `_ssr/`) kładzie go więc w `.output/server/_ssr/bootManifest-*.mjs`, a nie w
`.output/server/_tanstack-start-manifest_v-*.mjs`. Bramki czytają tylko najwyższy poziom.

Odtworzyłem to na modelu grafu serwera z prawdziwym Rollupem 4.60.2 z `node_modules` (`fix9/model.mjs`, wynik w
`fix9/rollup-model.txt`):

| wariant importu w L2                            | chunk z manifestem                                         | bramki                                      |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| baza (brak importu)                             | `_tanstack-start-manifest_v-*` (sam manifest)              | zielone                                     |
| dynamiczny import zaślepki (stan `01670c0a`)    | `bootManifest-*` = manifest + zaślepka → `_ssr/`           | **czerwone**                                |
| statyczny import zaślepki                       | manifest wchodzi do chunku wejścia (`main`)                | **czerwone** + ~216 KB przy starcie izolatu |
| dynamiczny import `"tanstack-start-manifest:v"` | `_tanstack-start-manifest_v-*` (sam manifest, jak w bazie) | zielone                                     |

## 2. Warianty w plikach pozycji i dlaczego nie wystarczają

1. **Statyczny import `BOOT_MANIFEST`** (Prove, opcja 1a). Model pokazuje, że manifest trafia do chunku wejścia
   Workera. Bramki nadal nie znajdą mapy na najwyższym poziomie. Do tego każdy izolat wykonywałby ~216 KB przy
   starcie, także dla żądań, które L2 nie dotykają. Odrzucone bez buildu: wynik modelu jest jednoznaczny.
2. **Dynamiczny import wirtualnego modułu `tanstack-start-manifest:v` wprost** (ten sam specyfikator, którego używa
   `getStartManifest()` w start-server-core). To istniejący dynamiczny punkt wejścia, więc układ artefaktu zostaje jak
   w bazie (model, wiersz 4). Typy obsługuje `@ts-expect-error`, sprawdzone tsgo na pliku próbnym.
   **Ale vitest:** analiza importów Vite w środowisku `client` (happy-dom) nie rozwiązuje tego specyfikatora i rzuca
   „Failed to resolve import" przy transformacji `documentCacheL2.server.ts`. W środowisku `ssr` błąd jest pomijany.
   Szablon bez podstawień z `/* @vite-ignore */` nie pomaga: transformacja TS zamienia go na zwykły napis, a analiza
   importów i tak traktuje szablon jako specyfikator. `vi.mock` nie działa na etapie transformacji. Eksperyment
   (`fix9/variantB-vitest.log`, łatka próbna `fix9/attempt-virtual-import.diff`): na zestawie 35 plików testów pozycji
   **5 plików nie ładuje się wcale**. Cztery są w `src/lib/http/__tests__` (`documentCacheL2`,
   `documentCacheL2BuildId`, `documentCacheL2NamedCache`, `degradedRenderCachePipeline`). Piąty to
   `src/__tests__/serverEntryRequestOptions.test.ts`, poza listą. Wpływu na pełną suitę nie mierzyłem. Wariant
   wymaga więc pliku spoza listy: aliasu `"tanstack-start-manifest:v"` w `vitest.config.ts`, na przykład do zaślepki
   `src/lib/boot/bootManifest.ts`, bo ta nie ma `nesBootManifest`, więc wynik to „brak mapy". Alternatywą jest
   nagłówek środowiska `node` w teście spoza listy. Zostaje też kruchość: każdy przyszły test w środowisku `client`,
   który zaimportuje L2 albo `src/server.ts`, padnie z mylącym błędem.
3. **Inne stałe per build źródło.** Przejrzałem chunk wejścia Workera, `import.meta.env`, wtyczki NES i Nitro. W grafie
   wejścia nie ma żadnego napisu z hashem zasobów. Mapy `LOCALE_CHUNK_URLS`/`WIDGET_CHUNK_URLS` nie zmieniają się przy
   każdej zmianie klienta. `LOVABLE_BUILD_ID` jest w produkcji pusty (`/api/public/version` → `rt-0`). Każdy inny moduł
   z mapą (np. `bootSet.server.ts`) jako cel `import()` tworzy nowy punkt wejścia i zmienia podział chunków. Nie ma
   też API, które oddaje wejście bez efektów ubocznych.

**Decyzja w kodzie:** zostaje dynamiczny import zaślepki, czyli zaprojektowany szew `bootManifest.ts`, bez wyciszania
typów i bez zależności od wirtualnego modułu frameworka w kodzie aplikacji. Runtime jest dowiedziony na artefakcie
(PROVE §5). Skutek dla układu i warunek dla bramek opisuje komentarz `documentBuildId()`.

## 3. Łatka bramek (wariant A, poza listą, do decyzji orkiestratora)

Plik: `scratchpad/phase3/wave3/P3.6a/fix9-gates-scan-ssr.patch` (`git apply -p1` z korzenia repo).

- `findBootChunks()` (oba skrypty): dla każdego katalogu z `SERVER_DIRS` najpierw najwyższy poziom (oba wzorce, jak
  dotąd), a gdy nic nie znaleziono, `<dir>/_ssr` (tylko wzorzec mapy bootu
  `entry:"/assets/*.js",rootPreloads:`). Na artefakcie bazy wynik jest więc ten sam co dotąd, a `_ssr/` (1516
  plików) jest czytane tylko wtedy, gdy najwyższy poziom nic nie dał. Komunikat błędu wspomina `_ssr/`.
- `manifestBootRoots()` (fallback wagi dokumentu): ta sama kolejność.
- Bez zmian progów, budżetów i kroniki: to uodpornienie istniejącej bramki na położenie chunku, a nie nowa bramka.

Sprawdzenie (kopia lustrzana `scratchpad/p36a-fix9/gate-mirror`: `scripts/` skopiowane i spatchowane, `src`,
`node_modules`, `.output` jako dowiązania, worktree nietknięty):

| artefakt                        | `check:bundle`                                                                                          | `check:entry-purity`                                                      | `manifestBootRoots`                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| P3.6a (`01670c0a`, build Prove) | zielone; boot closure 486.9 KB gz / 1596.5 KB raw (= Prove z `ENTRY_CHUNKS`) (`fix9/mirror-bundle.log`) | zielone; `index-BLxTOEN-.js`, 10 chunków (`fix9/mirror-entry-purity.log`) | `[index-BLxTOEN-.js]` (bez łatki `[]`) |
| baza W3 (`7c924ae5`)            | zielone; 486.8 KB gz / 1596.5 KB raw (`fix9/mirror-base-bundle.log`)                                    | zielone; `index-BsLjjLsH.js` (`fix9/mirror-base-entry-purity.log`)        | `[index-BsLjjLsH.js]` (jak bez łatki)  |

`bunx prettier --check` na trzech spatchowanych plikach: OK. `tsc` (konfiguracja jak `typecheck:scripts`, tylko
te trzy pliki): exit 0.

Po zastosowaniu łatki trzeba ponowić build, `check:bundle`, `check:entry-purity`, `check:server-entry-purity` i
`test:e2e:artifact` (Prove). Zmiana tej rundy jest wyłącznie serwerowa: inna gałąź `catch` i komentarze. Dokument i
chunki klienta się nie zmieniają, więc Lighthouse'a nie trzeba powtarzać.

**Wariant B (zamiast A):** import wirtualnego modułu wprost (`fix9/attempt-virtual-import.diff`, w pliku pozycji)
plus alias w `vitest.config.ts` (poza listą). Daje układ artefaktu identyczny z bazą i bramki bez zmian, ale wiąże
kod aplikacji z wewnętrznym id frameworka (`@ts-expect-error`) i z konfiguracją testów. Nie zweryfikowałem go
buildem ani pełną suitą. Zalecam A.

## 4. Zmiany plik po pliku (commit `af98a5a8`)

### `src/lib/http/documentCacheL2.server.ts`

- `documentBuildId()`: w `catch` funkcja zwraca `PROD ? null : "dev"` BEZ zapamiętania w `buildId`. Przejściowy błąd
  ładowania chunku na zimnym izolacie nie wyłącza już L2 dokumentów na całe życie izolatu (MINOR-1 recenzji).
  Zapamiętywany jest tylko wynik rozstrzygnięty, także `null` buildu PROD bez mapy. Gdy błąd jest trwały, kolejne
  `import()` dostaje odrzucenie z rejestru modułów, więc koszt jest pomijalny.
- Komentarz `documentBuildId()` opisuje:
  - dlaczego import jest dynamiczny (statyczny wykonuje manifest przy starcie każdego izolatu);
  - UKŁAD ARTEFAKTU: chunk `_ssr/bootManifest-*.mjs` i to, że bramki muszą szukać w `_ssr/`;
  - dlaczego nie import wirtualnego modułu (vitest `client`);
  - zasadę braku zapamiętania błędu.
    Stare zdanie „gdy dokument dociera do L2, handler jest już wczytany" było nieprawdziwe dla HIT-u z L2 na zimnym
    izolacie, więc zostało usunięte.
- Nagłówek modułu, „Zakres spójności": zdanie „ściśle nie-gorsza" zawężone do AKTUALIZACJI treści. Dopisane, że
  zdjęcie i przekierowanie (rewalidacja 404/3xx bez zapisu) w kolonii bez purge daje STALE do końca okna swr wpisu L2.
  Zasada usuwania wpisu należy do P3.6b. To część komentarzowa MAJOR-2. Samej zasady nie zmieniam (zasady zapisu to
  P3.6b), a komentarz `src/lib/http/documentCache.ts:50-55` jest poza listą.

### `src/lib/http/__tests__/documentCacheL2BuildId.test.ts`

- Atrapa mapy dostała flagę `failNext`. Pierwszy odczyt `BOOT_MANIFEST` rzuca, co symuluje nieudane ładowanie.
- Nowy test „nieudany odczyt mapy NIE jest zapamiętywany" (PROD) sprawdza dwa żądania tego samego izolatu:
  - pierwsze: brak wpisu dokumentu i `build: null`;
  - drugie: klucz `/__nes/doc/index-CCCCCCCC/0/0/…`, `build` ustalone, HIT.
    Kontrola mutacyjna: z dawnym `catch { entry = undefined }` test pada (1 failed / 5 passed), z poprawką przechodzi.

## 5. Bramki tej rundy

| bramka                                                                                                                                                                                                                                                                                                                                                                                                                           | wynik                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `bunx prettier --write` (2 pliki)                                                                                                                                                                                                                                                                                                                                                                                                | bez zmian                                                                                                                   |
| `light.sh bunx eslint` (2 pliki)                                                                                                                                                                                                                                                                                                                                                                                                 | 0                                                                                                                           |
| `light.sh bunx vitest run src/lib/http/__tests__ src/lib/__tests__/ssrCacheL2.server.test.ts src/lib/__tests__/ssrCacheL2.test.ts src/lib/__tests__/edgeCacheFunctions.test.ts src/components/admin/performance/__tests__/edgeCacheCard.test.tsx src/__tests__/serverEntryRequestOptions.test.ts src/__tests__/platformServerFailures.test.ts src/__tests__/startPipeline.test.ts src/lib/boot/__tests__/bootSet.server.test.ts` | 37 plików / 787 testów zielone (`fix9-vitest.log`)                                                                          |
| `light.sh bun run verify:static`                                                                                                                                                                                                                                                                                                                                                                                                 | 15 bramek OK (`fix9-verify-static.log`)                                                                                     |
| typecheck (mutex, `heavy-bg.sh` + `tools/typecheck-noinc.sh`: tsgo bez inkrementacji, `typecheck:scripts`, `typecheck:e2e`)                                                                                                                                                                                                                                                                                                      | zielony (`fix9-typecheck.log`)                                                                                              |
| build, `check:bundle`, `check:entry-purity`, `check:server-entry-purity`, `test:e2e:artifact`                                                                                                                                                                                                                                                                                                                                    | nie uruchamiane w tej rundzie (etap Prove, po decyzji w sprawie łatki z §3); łatka sprawdzona na istniejącym buildzie Prove |

## 6. Odstępstwa i korekty

- **Brak poprawki ustalenia blokującego w plikach pozycji.** Wymaga decyzji orkiestratora: wariant A (łatka bramek,
  zalecany) albo B (alias vitest). Uzasadnienie w §2.
- **Korekta komunikatu commita `af98a5a8`:** zdanie „(…) i nie transformuje żadnego modułu importującego L2 (35
  plików testów)" jest nieprecyzyjne. Zmierzone: z 35 plików zestawu pozycji nie ładuje się 5 (§2 pkt 2). Komentarz
  w kodzie („w środowisku `client` (…) nie transformuje wtedy żadnego modułu importującego L2") jest poprawny. Historii
  nie przepisuję.

## 7. Ustalenia niewiążące z recenzji (spoza listy tej rundy) - status

- MINOR-1: zrobione (§4).
- MAJOR-2: zrobiona część komentarzowa w pliku pozycji. Sama zasada (`l2Delete` po ostatecznym 404/3xx) to zasady
  zapisu, czyli P3.6b. Komentarz `documentCache.ts:50-55` jest poza listą.
- MAJOR-1 (segment buildu w `snapshotKey` w `src/lib/ssrCacheL2.server.ts`): poza listą, nadal warunek przed
  wdrożeniem (`out_of_ownership_needs`).
- MINOR-2 (build obejmuje tylko klienta): odrzucone w tej pozycji. Stałej serwerowej nie ma bez `define` w
  `vite.config.ts` (poza listą), a §2 pkt 3 pokazuje, że w grafie wejścia nie ma innego źródła.
- MINOR-3 (R7 b/c w linii `doc`): wymaga `ssrTiming.ts` (poza listą), bez zmian.
- MINOR-4 (UA odświeżenia przypięty do `WARM_USER_AGENT` harnessu): odłożone. Import
  `scripts/performance/artifactServer.ts` (spawn, http2, `lighthouseReport.ts`) do testu `src` wciąga harness do
  programu TS `src` (inne `types`, ryzyko czerwonego typechecku w rundzie z jednym typecheckiem). Zgodność napisów
  pilnuje komentarz w `src/server.ts`. Recenzent sam dopuścił odłożenie.

## 8. Ryzyka

- Do czasu zastosowania łatki bramek (albo wariantu B) gałąź zapali CI na `check:bundle` i `check:entry-purity`. Nie
  scalać bez decyzji z §3.
- Łatka A: `_ssr/` jest czytane wyłącznie przy braku trafienia na najwyższym poziomie i wyłącznie wąskim wzorcem
  mapy bootu (`entry:…,rootPreloads:`). Fałszywe trafienie w kod trasy jest praktycznie wykluczone, a koszt na bazie
  zerowy.
- Brak zapamiętania błędu: przy trwałym błędzie importu każde odwołanie do L2 dokumentu ponawia `import()`. Rejestr
  modułów zwraca od razu odrzucenie, więc nie ma I/O ani zauważalnego CPU.

## 9. Na co ma spojrzeć recenzent

- §2: czy wybór A zamiast B (albo zamiast zmiany konfiguracji vitest) jest właściwy dla doktryny grafu chunków.
- Łatka `fix9-gates-scan-ssr.patch`: kolejność skanowania i wąski wzorzec w `_ssr/`.
- `documentBuildId()`: brak zapamiętania przy `catch` i zachowanie dla PROD bez mapy (zapamiętane `null`).
- Komentarz „Zakres spójności" w nagłówku `documentCacheL2.server.ts` (zgodność z MAJOR-2).

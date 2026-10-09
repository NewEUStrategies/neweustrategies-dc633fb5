# Prove P3.6b (fala 3, partia 2): werdykt zapisu dokumentu na końcu strumienia + budżet treści `/`

- A = baza partii 2 `base-w3b` (`63a05a32`, gotowy `.output`, bez przebudowy).
- B = `wt3/P3.6b` (`perf/w3-P3.6b`, `80ce4d2b`), build `env BUNDLE_INVENTORY=1 bun run build:smoke` pod mutexem.
  Wynik: exit 0 (`build.log`).

Wątek użytkownika z harnessu („jeden font - ma to być Red Hat Display”) dotyczy P3.2b (partia 3). Ta pozycja
nie zmienia fontów. W obu stronach pomiaru jedynymi fontami w ścieżce krytycznej są
`red-hat-display-latin*.woff2` (audyt sieci `A/B-mobile-1.audits.txt`), więc tej zasady nic tu nie narusza.

## 1. Werdykt

| obszar                                     | wynik                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bramki artefaktu                           | wszystkie zielone                                                                                                                                                                                  |
| bramki: zastrzeżenie                       | `check:bundle`/`check:document-weight` pokazują wzrost domknięcia bootu o **+298 B raw / +51 B gz** (§3)                                                                                           |
| test:e2e:artifact                          | 12/12 w CI-like i 12/12 zwykły                                                                                                                                                                     |
| smoke na artefakcie z opóźnionym backendem | **dowód spełniony** (§2): B2 i B1 zapisane z dokumentu czytelnika (HIT przy 2. żądaniu, bez odświeżenia w tle); typ A i sekcja po budżecie bramki NIE zapisane; `degradedBy` w linii `doc`         |
| Lighthouse A/B                             | bez regresji ponad szum; wszystkie delty w MDE; HTML tej samej długości (330 641 B, różnią się tylko hashe)                                                                                        |
| efekt wobec planu                          | **yes** dla struktury. Rozmiaru plan lokalnie nie przewiduje, bo L1 zawsze HIT; weryfikacja produkcyjna po wdrożeniu                                                                               |
| needs_fix                                  | **tak, drobna poprawka** (§3): zamknięcie `warmLate` (kod tylko serwerowy) trafia do chunku wejściowego klienta, bo `isServer` z `@tanstack/router-core/isServer` nie zwija się w buildzie klienta |

## 2. Smoke na zbudowanym artefakcie (atrapa fetch w procesie)

`replayFetch.mjs` w repo ma tylko przypadek `slow-first-fold` (posty +900 ms), więc użyłem własnego haka.
Nie zmienia repo i siedzi w `smoke/tools/`:

- `replaySlow.mjs` to ten sam `homeFixture.ts` artefaktu z opóźnieniem wybranych ścieżek PostgREST
  (`NES_SLOW="<ścieżka>=<ms>"`, reszta 40 ms jak w repo);
- `probe2.sh` robi dwa GET `/` (UA przeglądarki, `nes_lang=pl`, odstęp 4 s) i zbiera nagłówki, `degraded:!0/!1` z HTML
  oraz linie `kind:"doc"` serwera.

Ten sam skrypt i te same porty uruchomiłem na A i na B (logi `smoke/<A|B>-<przypadek>/`).

Przypadki (opóźnienie, klasa z diagnozy):

- **clean**: brak opóźnienia.
- **B1**: `rpc/get_entity_content` +700 ms. Treść `home.page` przychodzi po 600 ms, a przed 1 200 ms.
- **B2**: `/rest/v1/posts` +900 ms. Sekcja nad zgięciem dostrumieniowuje się po terminie loadera.
- **typ A**: `rpc/get_entity_content` +1 700 ms. Treść po terminie treści.
- **bramka wyczerpana**: `/rest/v1/posts` +3 500 ms. Sekcja po budżecie `ServerSectionGate` (2 s).

### Wyniki

| przypadek         | strona | żądanie 1: `cache-control`                                         | żądanie 1: linia `doc` czytelnika                                                                                                                                        | TTFB / total 1 | żądanie 2                           | skąd wpis                                                   |
| ----------------- | ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------- | ----------------------------------------------------------- |
| clean             | A      | `public, max-age=60, s-maxage=900, swr=86400`                      | `degraded:false, store:"stored"`                                                                                                                                         | 0,43 / 0,52 s  | HIT                                 | czytelnik                                                   |
| clean             | B      | to samo                                                            | `degraded:false, store:"stored"`                                                                                                                                         | 0,51 / 0,62 s  | HIT                                 | czytelnik                                                   |
| B1                | A      | `private, no-store` (typ A, 180 780 B)                             | `degraded:true, degradedAt:"loader"`, bez `store`                                                                                                                        | 0,76 / 0,76 s  | HIT                                 | **odświeżenie w tle** (`revalidation:true, store:"stored"`) |
| B1                | B      | `public, max-age=0, s-maxage=30, swr=300` (pełna treść, 340 577 B) | `degraded:false, store:"stored"`, **brak linii `revalidation`**                                                                                                          | 1,06 / 1,19 s  | **HIT**                             | **czytelnik**                                               |
| B2                | A      | `private, no-store`                                                | `degraded:true, degradedAt:"loader"`                                                                                                                                     | 0,77 / 1,69 s  | HIT                                 | odświeżenie w tle                                           |
| B2                | B      | `public, max-age=0, s-maxage=30, swr=300`                          | `degraded:false, store:"stored"`, brak `revalidation`                                                                                                                    | 0,78 / 1,71 s  | **HIT**                             | **czytelnik**                                               |
| typ A             | A      | `private, no-store` (180 780 B)                                    | `degraded:true, degradedAt:"loader"`                                                                                                                                     | 0,79 / 0,80 s  | MISS (odświeżenie też zdegradowane) | —                                                           |
| typ A             | B      | `private, no-store` (180 780 B)                                    | `degraded:true, degradedAt:"loader", degradedBy:["home.page"]`, **bez zapisu**                                                                                           | 1,39 / 1,39 s  | HIT                                 | odświeżenie w tle (czysty render), nie czytelnik            |
| bramka wyczerpana | A      | `private, no-store`                                                | `degraded:true, degradedAt:"loader"`                                                                                                                                     | 0,82 / 2,75 s  | MISS                                | —                                                           |
| bramka wyczerpana | B      | `public, max-age=0, s-maxage=30, swr=300`                          | `degraded:true, degradedAt:"stream", degradedBy:["dropped:builder-post-list","dropped:builder-slider-posts","dropped:builder-slider-fallback-images"], store:"degraded"` | 0,76 / 2,74 s  | HIT                                 | odświeżenie w tle (`store:"stored"`), nie czytelnik         |

Dla przypadku clean na bazie wcześniejsza sonda implementera (`base-probe/`, `artifact-boot` / `slow-first-fold`)
daje to samo co powyżej.

### Wnioski

1. **Kryterium dowodu jest spełnione.** Dokument z sekcjami dostrumieniowanymi po terminie (B2) zostaje
   zapisany z przebiegu czytelnika: drugie żądanie to HIT, a w logu nie ma odświeżenia w tle. Dokument typu A
   nie jest zapisywany (`no-store`, brak `store`). Na A ten sam B2 dawał `no-store`, a HIT pochodził dopiero
   z rewalidacji.
2. **R3a działa.** B1 (treść w 600-1 200 ms) przestał być typem A. Czytelnik dostaje pełną treść zamiast
   powłoki 180 KB, a dokument zostaje zapisany z krótką polityką 30 s / 300 s (odstępstwo 4 z IMPL).
3. **Predykat negatywny działa na artefakcie.** Wyczerpana bramka sekcji kończy się `degradedAt:"stream"`,
   `store:"degraded"` i etykietami `dropped:*`. Jest też obecne odświeżenie w tle.
4. **R7c / m4 z recenzji potwierdzone end-to-end.** `degradedBy:["home.page"]` pojawia się w linii `doc`
   ścieżki loadera, więc `getRequest()` loadera to ten sam `Request` co w `logDocument`.
5. **Koszt, który plan akceptuje.** TTFB zimnego MISS-a rośnie, gdy treść jest wolna:
   - typ A: 0,79 -> 1,39 s, bo czeka do terminu treści 1,2 s;
   - B1: 0,76 -> 1,06 s, ale z pełną treścią zamiast powłoki.

   Przy szybkim backendzie (clean) różnica 0,43 vs 0,51 s mieści się w rozrzucie pojedynczej sondy.

6. **Uwaga, nie blokuje.** W przypadku „bramka wyczerpana” czytelnik B dostaje nagłówek wychodzący
   `public, s-maxage=30` dla dokumentu, którego magazyn nie przyjął (A wysyłał `no-store`). Nagłówek idzie
   przed końcem strumienia, więc predykat nie może go już zmienić. NES Edge Cache decyduje po dyrektywie
   wewnętrznej. Na produkcji hosting i tak nadpisuje `cache-control` HTML na
   `no-cache, must-revalidate, max-age=0` (IMPL §3, punkt (e)), a `max-age=0` blokuje przeglądarkę. Ryzyko
   praktyczne jest więc zerowe, ale warto to odnotować w raporcie partii.

## 3. Bramki artefaktu

| bramka                                                  | A (baza)                    | B (P3.6b)                                                   | wynik                                                                                                                     |
| ------------------------------------------------------- | --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `check:bundle` overall                                  | 4754,4 / 4772 KB            | 4754,5 / 4772 KB                                            | zielona (+0,1 KB)                                                                                                         |
| public JS                                               | 2804,0 / 2877 KB            | 2804,1 / 2877 KB                                            | zielona (+0,1 KB)                                                                                                         |
| public CSS                                              | 81,2 / 83 KB                | 81,2 / 83 KB                                                | bez zmian                                                                                                                 |
| największy chunk                                        | 262,2 KB                    | 262,2 KB                                                    | bez zmian                                                                                                                 |
| Boot closure (check:bundle)                             | 487,8 KB gz / 1598,6 KB raw | **487,9 KB gz / 1598,9 KB raw**                             | zielona (budżet 579), ale wzrost                                                                                          |
| `check:chunks`                                          | —                           | 893 chunki, graf acykliczny                                 | zielona                                                                                                                   |
| `check:entry-purity`                                    | —                           | czysto                                                      | zielona                                                                                                                   |
| `check:server-entry-purity`                             | —                           | 1813 plików, czysto                                         | zielona                                                                                                                   |
| `test:e2e:artifact` (CI-like, `NES_ARTIFACT_FIXTURE=1`) | 12/12 (stan bazy)           | 12/12                                                       | zielona (linia `[hydration-mismatch]` w logu to celowa kontrola negatywna `boot-artifact.spec.ts:295`, jest też na bazie) |
| `test:e2e:artifact` (zwykły)                            | —                           | 12/12                                                       | zielona                                                                                                                   |
| własne e2e pozycji                                      | —                           | brak (pozycja nie dodała ani nie zmieniła specyfikacji e2e) | n/d                                                                                                                       |
| `check:ssr-budgets`, `check:loader-policy`              | —                           | nie istnieją od PR #475                                     | pominięte                                                                                                                 |

Linia `Boot closure` z `check:bundle` (B):
`Boot closure: 487.9 KB gzip / 1598.9 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.
Lista ruchów względem baseline'u `b006c2e` jest identyczna jak na bazie (spreadsheet.worker, index -45,8 KB,
lucide-shim.fa, club._clubSlug.index, …). Pozycja nie dodaje żadnego ruchu > 2 KB.

### `check:document-weight` (ratchet): zielona po obu stronach

| metryka                                       | A           | B               | Δ        | próg                           |
| --------------------------------------------- | ----------- | --------------- | -------- | ------------------------------ |
| htmlRawBytes                                  | 337 696 B   | 337 696 B       | 0        | 396,7 KB                       |
| htmlGzipBytes                                 | 52 541 B    | 52 548 B        | +7       | 56,4 KB                        |
| headRawBytes                                  | 28 758 B    | 28 758 B        | 0        | 28,7 KB                        |
| inlineStyleBytes                              | 84 717 B    | 84 717 B        | 0        | 132,4 KB                       |
| inlineScriptBytes                             | 86 617 B    | 86 617 B        | 0        | 95,8 KB                        |
| dehydratedStateBytes                          | 60 357 B    | 60 357 B        | 0        | 64,9 KB                        |
| modulepreloadCount                            | 0           | 0               | 0        | 0                              |
| preloadDuplicates / documentPreloadDuplicates | 3 / 0       | 3 / 0           | 0        | 3 / 0                          |
| imgFetchpriorityHigh                          | 1           | 1               | 0        | 2                              |
| preloadedJsCount (pula High JS)               | 0           | 0               | 0        | 0                              |
| renderBlockingCssGzipBytes                    | 78,5 KB     | 78,5 KB         | 0        | 79,5 KB                        |
| **bootClosureRawBytes**                       | 1 636 946 B | **1 637 244 B** | **+298** | 1599,4 KB (zapas B: ok. 540 B) |
| **bootClosureGzipBytes**                      | 496 041 B   | **496 092 B**   | **+51**  | 485,0 KB (zapas B: ok. 548 B)  |
| **bootBurstGzipBytes**                        | 574 062 B   | **574 117 B**   | **+55**  | 561,2 KB                       |
| preLcpTransferBytes                           | 177 699 B   | 177 706 B       | +7       | 177,3 KB                       |

### Skąd +298 B w bootcie (needs_fix)

Wzrost pochodzi wyłącznie z chunku wejściowego `index-*.js`: 863 586 -> 863 884 B raw, 267 028 -> 267 080 B gz.
Pozostałe 9 chunków domknięcia jest bajtowo bez zmian. Diff zminifikowanego wejścia wskazuje jeden blok
(ok. +258 B), właściwość `warmLate` w `registerChromeWarmup` (`src/routes/__root.tsx:1083-1101`):

```js
warmLate:Wi&&o!==void 0?A=>yn(Promise.allSettled([a(),w&&g.enabled!==!1?e.queryClient.ensureQueryData(Ho(g)):void 0, ...]),A):void 0,
```

`Wi` to `isServer` importowany z `@tanstack/router-core/isServer`. W buildzie klienta nie jest stałą, więc
Rollup nie wycina gałęzi serwerowej i całe domknięcie (menu, ticker, reklama, `prefetchCachedRouteQueries`)
jedzie w bootcie klienta jako martwy kod.

Poprawka jest jednolinijkowa i w zakresie pliku P3.6b (gałąź chrome po terminie):

- `src/routes/__root.tsx:1084`: zamienić `isServer && homeDeadline !== undefined` na
  `import.meta.env.SSR && homeDeadline !== undefined`. Vite podstawia `false` w kliencie, więc gałąź znika.
- Analogicznie, dla porządku, `:915`: `if (isServer) markDeliberateSeed(...)` na `if (import.meta.env.SSR) ...`.

Oczekiwany efekt: domknięcie bootu wraca do bazy (±kilka B). Dlaczego to warto zrobić, choć bramka jest
zielona:

- to kod dodany do bootu bez odzysku bajtów, wbrew zasadzie fali;
- PLAN-FALI-3 §3a (L1) przewiduje po partii 2 tylko ok. 155 B zapasu `bootClosureRawBytes`, więc +298 B
  tej pozycji może zapalić bramkę po scaleniu z P3.3/P3.8.

## 4. Lighthouse A/B (`lh/`, n = 3 na formę, fixture, ramię bot)

Obie strony: 3/3 ważne przebiegi, 0 wykluczonych, wariant wzorcowy `s-maxage=900, 330641 B`, wszystkie
przebiegi L1 HIT, tryb FCP `bez-js` 3/3, 0 par mieszanych. HTML ma 330 641 B raw / 49 877 B gz po obu
stronach (różnią się tylko hashe nazw chunków).

### Mediany

| forma     | strona | perf | FCP    | LCP    | TBT    | SI     | CLS | TTFB  | mainThread | bootup  | req | transfer |
| --------- | ------ | ---- | ------ | ------ | ------ | ------ | --- | ----- | ---------- | ------- | --- | -------- |
| mobile    | A      | 95   | 1,54 s | 2,30 s | 198 ms | 1,67 s | 0   | 13 ms | 3499 ms    | 1571 ms | 72  | 915,2 KB |
| mobile    | B      | 93   | 1,54 s | 2,30 s | 245 ms | 1,77 s | 0   | 9 ms  | 3539 ms    | 1533 ms | 70  | 914,8 KB |
| desktop4x | A      | 91   | 0,46 s | 0,56 s | 242 ms | 0,66 s | 0   | 7 ms  | 3292 ms    | 1672 ms | 73  | 919,6 KB |
| desktop4x | B      | 87   | 0,47 s | 0,56 s | 310 ms | 0,66 s | 0   | 8 ms  | 3202 ms    | 1506 ms | 73  | 919,8 KB |

### DELTA B-A i pary (σΔ, MDE)

| forma     | DELTA (mediany)                                                                                              | pary: Δ (σΔ, MDE(t))                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mobile    | score -2, FCP -0,00, LCP -0,00, TBT +48 ms, SI +0,09 s, CLS 0, transfer -0,4 KB, script +0,1 KB, req -2      | score -1,7 (5,0; 15,6); FCP +0,035 s (0,062; 0,193); LCP +0,048 s (0,083; 0,256); TBT +42 ms (153; 473); SI +0,075 s (0,065; 0,201); TTI +0,100 s (0,086; 0,265)  |
| desktop4x | score -4, FCP +0,01, LCP 0,00, TBT +69 ms, SI 0,00, CLS 0, mainThread -90 ms, bootup -167 ms, script +0,1 KB | score -6,0 (6,2; 19,3); FCP +0,049 s (0,032; 0,099); LCP -0,001 s (0,013; 0,039); TBT +100 ms (113; 351); SI +0,026 s (0,039; 0,120); TTI -0,024 s (0,163; 0,504) |

### Rozrzut przebiegów

| forma     | strona | perf         | TBT (ms)        | SI (s)             |
| --------- | ------ | ------------ | --------------- | ------------------ |
| mobile    | A      | 90 / 95 / 95 | 352 / 188 / 198 | 1,67 / 1,67 / 1,70 |
| mobile    | B      | 93 / 88 / 94 | 245 / 386 / 233 | 1,82 / 1,69 / 1,77 |
| desktop4x | A      | 88 / 91 / 97 | 299 / 242 / 142 | 0,67 / 0,66 / 0,62 |
| desktop4x | B      | 87 / 87 / 84 | 310 / 305 / 370 | 0,66 / 0,72 / 0,66 |

### Księga zadań Lantern (blokowanie per klasa, ms sym.)

| przebieg      | ScriptCatchup | Style | Script:vendor-react | Timer:index | inne                         | TBT |
| ------------- | ------------- | ----- | ------------------- | ----------- | ---------------------------- | --- |
| A-mobile-1    | 204           | 87    | 47                  | 7           | 7                            | 352 |
| A-mobile-2    | 103           | 56    | 30                  | —           | —                            | 188 |
| A-mobile-3    | 90            | 49    | 44                  | 11          | 4                            | 198 |
| B-mobile-1    | 109           | 62    | 53                  | 13          | 8                            | 245 |
| B-mobile-2    | 163           | 68    | 57                  | 19          | 80 (ParseHTML 63, Script 17) | 386 |
| B-mobile-3    | 76            | 64    | 45                  | 48          | 1                            | 233 |
| A-desktop4x-1 | 101           | 117   | 46                  | 29          | 7                            | 299 |
| A-desktop4x-2 | 100           | 81    | 37                  | 4           | 21                           | 242 |
| A-desktop4x-3 | 84            | 39    | 19                  | —           | —                            | 142 |
| B-desktop4x-1 | 149           | 113   | 48                  | —           | —                            | 310 |
| B-desktop4x-2 | 114           | 97    | 44                  | 37          | 13                           | 304 |
| B-desktop4x-3 | 194           | 99    | 36                  | 30          | 12                           | 370 |

Ten sam zestaw klas zadań po obu stronach, bez nowej klasy. Pozycja nie celuje w żadną klasę zadań, bo jej
efekt jest po stronie serwera i magazynu.

`ScriptCatchup` waha się w obu stronach w przedziale 76-204 ms. To znany szum: σΔ TBT na bazie fali to
ok. 120 ms. B desktop4x (TBT 305-370 ms, perf 84-87) mieści się w zakresie bazy fali (TBT 240-475 ms,
perf 81-91, stan wejściowy orkiestratora). +51 B gz w wejściu nie ma mechanizmu, który dałby +50-100 ms
kompilacji. Bootup B jest wręcz niższy (desktop4x -167 ms).

### Speedline (obsSI, mobile, prawdziwy filmstrip)

| przebieg           | SI (speedline)     | kształt                                                           |
| ------------------ | ------------------ | ----------------------------------------------------------------- |
| A-mobile-1 / 2 / 3 | 350 / 356 / 350 ms | 61-71% przy 330-353 ms, 99% przy 366-383 ms, 100% przy 893-944 ms |
| B-mobile-1 / 2 / 3 | 364 / 367 / 369 ms | 61-71% przy 345-369 ms, 99% przy 386-402 ms, 100% przy 912-962 ms |

Kształt filmstripu jest identyczny po obu stronach. Różnica obsSI wynosi +14 ms. SI Lantern (+0,09 s mediany)
pochodzi z części symulowanej (layoutSI), a w parach mieści się w szumie (Δ 0,075 s < MDE(t) 0,201 s).

### Audyty (A/B-mobile-1)

| pole                                                              | A                                     | B                                     |
| ----------------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| element LCP                                                       | `img.eh-img`                          | `img.eh-img`                          |
| LCP: TTFB / opóźnienie ładowania / ładowanie / opóźnienie renderu | 26 / 32 / 15 / 162 ms                 | 23 / 46 / 11 / 193 ms                 |
| CLS                                                               | 0                                     | 0                                     |
| żądania / transfer                                                | 70 / 914,6 KB                         | 70 / 914,8 KB                         |
| High przed obrazem LCP                                            | 112,4 KB                              | 112,4 KB                              |
| fonty w ścieżce krytycznej                                        | `red-hat-display-latin` + `latin-ext` | `red-hat-display-latin` + `latin-ext` |

## 5. Ocena wobec kryteriów dowodu (PLAN-FALI-3 §2 P3.6b)

| kryterium                                                                    | wynik                                                                                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| testy negatywne predykatu (każde odstępstwo = brak zapisu) i pozytywne B1/B2 | obecne (IMPL §1, REVIEW §3: 500 testów w 13 plikach, kontrola mutacyjna). W Prove potwierdzone na artefakcie: typ A i bramka wyczerpana = brak zapisu, B1/B2 = zapis |
| harness bez regresji                                                         | tak, wszystkie delty w MDE, HTML i sieć bez zmian, CLS 0                                                                                                             |
| fixture z opóźnieniem pokazuje zapis po pełnym strumieniu                    | tak (§2, B2 i B1: `store:"stored"` z przebiegu czytelnika, drugie żądanie HIT, bez rewalidacji)                                                                      |
| bramki artefaktu                                                             | zielone. Do poprawki: +298 B raw / +51 B gz bootu z niewyciętego `isServer` (§3)                                                                                     |

`effect_matches_plan`: **yes**. Mechanizm działa strukturalnie na zbudowanym artefakcie dokładnie tak, jak
opisuje plan. Lokalny Lighthouse z definicji nie widzi efektu (L1 zawsze HIT, §1 planu), więc wielkość
efektu jest tu nierozstrzygalna. Należy ją zweryfikować na produkcji po wdrożeniu: odsetek `degraded:!0` na
zimnych MISS-ach i `store:"stored"` w Workers Logs (IMPL §6.3).

## 6. Pliki

- Logi bramek: `build.log`, `check:bundle.log`, `check-bundle-base.log`, `check:chunks.log`,
  `check:entry-purity.log`, `check:server-entry-purity.log`, `document-weight(.json|.log)`,
  `document-weight-base(.json|.log)`, `e2e-ci.log`, `e2e.log`.
- Lighthouse: `ab.log`, `lh/` (ledgery, audyty, ślady w `*.artifacts/trace.json`, `summary.json`).
- Smoke: `smoke/tools/{replaySlow.mjs,probe2.sh}`, `smoke/{A,B}-{clean,B1,B2,typeA,gateExhausted}/`
  (nagłówki, HTML, `server.log`, `curl-*.txt`).

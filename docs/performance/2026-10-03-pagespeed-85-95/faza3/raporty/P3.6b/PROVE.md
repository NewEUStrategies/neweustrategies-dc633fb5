# Re-Prove P3.6b (fala 3, partia 2), runda poprawek 2: werdykt zapisu dokumentu na końcu strumienia, budżet treści `/`, granica chrome po terminie

- A = baza partii 2 `base-w3b` (`63a05a32`, gotowy `.output`, bez przebudowy).
- B = `wt3/P3.6b` (`perf/w3-P3.6b`, **`8fdfdf05`**, runda poprawek 2 po `REVIEW-1.md`).
  Build: `env BUNDLE_INVENTORY=1 bun run build:smoke` pod mutexem, exit 0 (`build.log`).
- Poprzedni Prove (commit `80ce4d2b`, needs_fix: `warmLate` w bootcie klienta) jest w `prove-r0/`. Ten raport
  go zastępuje.

## 1. Werdykt

| obszar                                                                      | wynik                                                                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bramki artefaktu                                                            | wszystkie zielone                                                                                                                                                                           |
| needs_fix z `prove-r0` (+298 B raw / +51 B gz bootu, niewycięty `isServer`) | **naprawione**: teraz +44 B raw / +43 B gz wobec bazy (§3), bez martwego zamknięcia serwerowego w kliencie                                                                                  |
| `test:e2e:artifact`                                                         | 12/12 w CI-like (`NES_ARTIFACT_FIXTURE=1`), 12/12 zwykły                                                                                                                                    |
| smoke na artefakcie z opóźnionym backendem                                  | **dowód spełniony** (§2): B1 i B2 zapisane z przebiegu czytelnika (HIT przy 2. żądaniu, bez odświeżenia w tle). Typ A i bramka wyczerpana NIE są zapisane. `degradedBy` jest w linii `doc`  |
| nowe w tej rundzie (M1)                                                     | na artefakcie widać, że nagłówek po terminie czeka na baner w budżecie: baner 800 ms trafia do stanu zdehydrowanego B, a w A nie. Baner wiszący nie przedłuża dokumentu ponad budżet (§2.2) |
| Lighthouse A/B                                                              | bez regresji ponad szum. Wszystkie delty par w MDE(t). HTML identyczny (330 641 B, różnią się tylko hashe i port). Przebieg potwierdzający mobile: delty ≈ 0 (§4)                           |
| efekt wobec planu                                                           | **yes** dla struktury, **inconclusive** dla rozmiaru. Lokalnie L1 zawsze HIT (§1 planu), rozmiar efektu weryfikuje produkcja po wdrożeniu                                                   |
| needs_fix                                                                   | **nie**                                                                                                                                                                                     |

## 2. Smoke na zbudowanym artefakcie (atrapa fetch w procesie)

`replayFetch.mjs` w repo ma tylko przypadek `slow-first-fold`, więc smoke używa tego samego haka co w `prove-r0`
(poza repo, `smoke/tools/`):

- `replaySlow.mjs` to `homeFixture.ts` artefaktu z opóźnieniem wybranych ścieżek PostgREST
  (`NES_SLOW="<ścieżka>=<ms>"`, reszta 40 ms);
- `probe2.sh` robi dwa GET `/` (UA przeglądarki, `nes_lang=pl`, odstęp 4 s) i zbiera nagłówki, `degraded:!0/!1` z HTML
  oraz linie `kind:"doc"`;
- `run-all.sh` uruchamia ten sam zestaw przypadków na A (port 4321) i B (port 4322). Log: `smoke/run-all.log`,
  pliki w `smoke/<A|B>-<przypadek>/`.

### 2.1 Predykat zapisu i R3a (przypadki z diagnozy)

| przypadek         | opóźnienie                         | strona | żądanie 1: `cache-control` / rozmiar                                | linia `doc` czytelnika                                                                                                                                                   | TTFB / total 1 | żądanie 2                           | skąd wpis                                               |
| ----------------- | ---------------------------------- | ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------- | ------------------------------------------------------- |
| clean             | brak                               | A      | `public, max-age=60, s-maxage=900, swr=86400` / 337 654 B           | `degraded:false, store:"stored"`                                                                                                                                         | 0,38 / 0,46 s  | HIT                                 | czytelnik                                               |
| clean             | brak                               | B      | to samo / 337 654 B                                                 | `degraded:false, store:"stored"`                                                                                                                                         | 0,39 / 0,51 s  | HIT                                 | czytelnik                                               |
| B1                | `rpc/get_entity_content` +700 ms   | A      | `private, no-store` / 180 780 B (powłoka typu A)                    | `degraded:true, degradedAt:"loader"`, bez `store`                                                                                                                        | 0,77 / 0,77 s  | HIT                                 | odświeżenie w tle (`revalidation:true, store:"stored"`) |
| B1                | `rpc/get_entity_content` +700 ms   | B      | `public, max-age=0, s-maxage=30, swr=300` / 340 577 B (pełna treść) | `degraded:false, store:"stored"`, **brak linii `revalidation`**                                                                                                          | 0,99 / 1,08 s  | **HIT**                             | **czytelnik**                                           |
| B2                | `/rest/v1/posts` +900 ms           | A      | `private, no-store` / 340 577 B                                     | `degraded:true, degradedAt:"loader"`                                                                                                                                     | 0,82 / 1,73 s  | HIT                                 | odświeżenie w tle                                       |
| B2                | `/rest/v1/posts` +900 ms           | B      | `public, max-age=0, s-maxage=30, swr=300` / 340 577 B               | `degraded:false, store:"stored"`, brak `revalidation`                                                                                                                    | 0,80 / 1,72 s  | **HIT**                             | **czytelnik**                                           |
| typ A             | `rpc/get_entity_content` +1 700 ms | A      | `private, no-store` / 180 780 B                                     | `degraded:true, degradedAt:"loader"`                                                                                                                                     | 0,77 / 0,77 s  | MISS (odświeżenie też zdegradowane) | brak                                                    |
| typ A             | `rpc/get_entity_content` +1 700 ms | B      | `private, no-store` / 180 780 B                                     | `degraded:true, degradedAt:"loader", degradedBy:["home.page"]`, **bez zapisu**                                                                                           | 1,34 / 1,35 s  | HIT                                 | odświeżenie w tle (czysty render), nie czytelnik        |
| bramka wyczerpana | `/rest/v1/posts` +3 500 ms         | A      | `private, no-store` / 263 818 B                                     | `degraded:true, degradedAt:"loader"`                                                                                                                                     | 0,78 / 2,75 s  | MISS                                | brak                                                    |
| bramka wyczerpana | `/rest/v1/posts` +3 500 ms         | B      | `public, max-age=0, s-maxage=30, swr=300` / 263 818 B               | `degraded:true, degradedAt:"stream", degradedBy:["dropped:builder-post-list","dropped:builder-slider-posts","dropped:builder-slider-fallback-images"], store:"degraded"` | 0,78 / 2,72 s  | HIT                                 | odświeżenie w tle (`store:"stored"`), nie czytelnik     |

Wyniki są takie same jak w `prove-r0` (różnice TTFB ≤ 0,07 s, w rozrzucie pojedynczej sondy). Runda poprawek 1
i 2 nie zmieniła więc zachowania predykatu ani R3a.

### 2.2 Granica nagłówka przy wygasłym terminie (M1 tej rundy)

Dwa dodatkowe przypadki: treść jak w typie A (+1 700 ms) i dodatkowo opóźniony `/rest/v1/ad_placements`
(baner nagłówka).

| przypadek                 | strona | żądanie 1  | rozmiar   | wpis `["ad_placements","header_banner","home",null]` w stanie zdehydrowanym | TTFB / total 1 | linia `doc`                |
| ------------------------- | ------ | ---------- | --------- | --------------------------------------------------------------------------- | -------------- | -------------------------- |
| typ A, baner 40 ms        | A      | `no-store` | 180 780 B | jest                                                                        | 0,77 / 0,77 s  | `degradedAt:"loader"`      |
| typ A, baner 40 ms        | B      | `no-store` | 180 780 B | jest                                                                        | 1,34 / 1,35 s  | `degradedBy:["home.page"]` |
| baner +800 ms             | A      | `no-store` | 180 379 B | **brak** (nagłówek bez banera, dociągnięcie po boocie)                      | 0,92 / 0,93 s  | `degradedAt:"loader"`      |
| baner +800 ms             | B      | `no-store` | 180 780 B | **jest** (granica poczekała na baner w budżecie)                            | 1,34 / 1,35 s  | `degradedBy:["home.page"]` |
| baner +3 000 ms (wiszący) | A      | `no-store` | 180 379 B | brak                                                                        | 0,78 / 0,78 s  | `degradedAt:"loader"`      |
| baner +3 000 ms (wiszący) | B      | `no-store` | 180 379 B | brak (budżet bramki minął)                                                  | 1,35 / 1,35 s  | `degradedBy:["home.page"]` |

Wnioski:

- Baner, który zdąży w budżecie, jest w HTML-u B razem z nagłówkiem. A go gubi, więc klient dociąga go po
  boocie (ryzyko skoku F26).
- Wiszący baner nie wydłuża dokumentu B: 1,35 s, tyle samo co typ A bez opóźnienia banera. Czekanie granicy
  nakłada się na czekanie loadera do terminu treści i kończy się w budżecie `withBudget`.
- Drugie żądanie we wszystkich trzech przypadkach B to HIT z czystego odświeżenia w tle (`store:"stored"`).
- Wszystkie trzy dokumenty czytelnika są typu A (`no-store`) i nie trafiają do magazynu.

## 3. Bramki artefaktu

| bramka                                     | A (baza)                      | B (P3.6b, `8fdfdf05`)                                       | wynik                                                                                                                      |
| ------------------------------------------ | ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `check:bundle` overall                     | 4754,4 / 4772 KB (zapas 17,6) | 4754,2 / 4772 KB (zapas 17,8)                               | zielona, -0,2 KB                                                                                                           |
| public JS                                  | 2804,0 / 2877 KB              | 2803,7 / 2877 KB                                            | zielona, -0,3 KB                                                                                                           |
| public CSS                                 | 81,2 / 83 KB                  | 81,2 / 83 KB                                                | bez zmian                                                                                                                  |
| CSS razem                                  | 95,0 / 96 KB                  | 95,0 / 96 KB                                                | bez zmian                                                                                                                  |
| największy chunk                           | 262,2 KB                      | 262,2 KB                                                    | bez zmian                                                                                                                  |
| Boot closure (`check:bundle`)              | 487,8 KB gz / 1598,6 KB raw   | 487,9 KB gz / 1598,6 KB raw                                 | zielona (budżet 579 KB)                                                                                                    |
| `check:chunks`                             | —                             | 893 chunki, 6845 krawędzi, graf acykliczny                  | zielona                                                                                                                    |
| `check:entry-purity`                       | —                             | ścieżka bootu czysta (10 chunków)                           | zielona                                                                                                                    |
| `check:server-entry-purity`                | —                             | 1813 plików, czysto                                         | zielona                                                                                                                    |
| `test:e2e:artifact` (CI-like)              | 12/12 (stan bazy)             | 12/12 (54,1 s)                                              | zielona. Jedna linia `[hydration-mismatch]` w logu to celowa kontrola negatywna `boot-artifact.spec.ts`, jest też na bazie |
| `test:e2e:artifact` (zwykły)               | —                             | 12/12 (53,8 s)                                              | zielona                                                                                                                    |
| własne e2e pozycji                         | —                             | brak (pozycja nie dodała ani nie zmieniła specyfikacji e2e) | n/d                                                                                                                        |
| `check:ssr-budgets`, `check:loader-policy` | —                             | nie istnieją od PR #475                                     | pominięte                                                                                                                  |

Linia `Boot closure` z `check:bundle` (B):
`Boot closure: 487.9 KB gzip / 1598.6 KB raw  (10 chunków statycznie osiągalnych ze SSR-owego <script>; budget ≤ 579 KB)`.

Lista ruchów względem baseline'u `b006c2e` jest identyczna jak na bazie: spreadsheet.worker +131,5 (nowy),
index -45,8, lucide-shim.fa -24,1, club._clubSlug.index +16,5, admin.seo +7,5 (nowy), i18n-club +3,0,
category._slug -2,5, icons-0/1/3 -2,5/-2,5/-2,4, profile.notifications -2,4, SeoPanel +2,4, znikł
i18n-admin-seo-hub. Pozycja nie dodaje żadnego ruchu > 2 KB.

### `check:document-weight` (ratchet): zielona po obu stronach

| metryka                                       | A           | B           | Δ       | próg (max)  | zapas B           |
| --------------------------------------------- | ----------- | ----------- | ------- | ----------- | ----------------- |
| htmlRawBytes                                  | 337 696 B   | 337 696 B   | 0       | 396,7 KB    | —                 |
| htmlGzipBytes                                 | 52 542 B    | 52 552 B    | +10     | 56,4 KB     | —                 |
| headRawBytes                                  | 28 758 B    | 28 758 B    | 0       | 29 345 B    | 587 B             |
| inlineStyleBytes                              | 84 717 B    | 84 717 B    | 0       | 132,4 KB    | —                 |
| inlineScriptBytes                             | 86 617 B    | 86 617 B    | 0       | 95,8 KB     | —                 |
| dehydratedStateBytes                          | 60 357 B    | 60 357 B    | 0       | 64,9 KB     | —                 |
| modulepreloadCount                            | 0           | 0           | 0       | 0           | —                 |
| preloadDuplicates / documentPreloadDuplicates | 3 / 0       | 3 / 0       | 0       | 3 / 0       | —                 |
| imgFetchpriorityHigh                          | 1           | 1           | 0       | 2           | —                 |
| preloadedJsCount / Gzip (pula High JS)        | 0 / 0 B     | 0 / 0 B     | 0       | 0           | —                 |
| renderBlockingCssGzipBytes                    | 78,5 KB     | 78,5 KB     | 0       | 79,5 KB     | —                 |
| **bootClosureRawBytes**                       | 1 636 946 B | 1 636 990 B | **+44** | 1 637 758 B | 768 B (baza: 812) |
| **bootClosureGzipBytes**                      | 496 041 B   | 496 084 B   | **+43** | 496 679 B   | 595 B (baza: 638) |
| **bootBurstGzipBytes**                        | 574 062 B   | 574 105 B   | **+43** | 574 673 B   | 568 B (baza: 611) |
| preLcpTransferBytes                           | 177 700 B   | 177 710 B   | +10     | 181 594 B   | —                 |

Względem `prove-r0` (+298 B raw / +51 B gz) poprawka z rundy 9 (`import.meta.env.SSR` zamiast `isServer`)
działa. Zamknięcie `warmLate` nie jedzie już w kliencie: w wejściu zostało `warmLate:void 0`.

**Skąd +44 B raw w wejściu** (`index-*.js` 863 586 -> 863 630 B; pozostałe 9 chunków domknięcia bez zmian).
Wejścia porównałem po normalizacji hashy i nazw zminifikowanych (`entrydiff/`). Literały tekstowe są
identyczne, wzrost dają wyłącznie zmiany strukturalne kodu współdzielonego w `__root.tsx`:

- lista pracy chrome jako fabryki z budżetem: `push(I=>I(I.queryClient,…))` i `Promise.allSettled(list.map(w=>w(budget)))`;
- pomocnik `markDegraded("failed")`;
- właściwość `warmLate:void 0`.

Pomocnik `cache-control` z `responseHeaders.ts` był w wejściu już na bazie, a w B zmienił tylko pozycję.
Liczba wystąpień `ad_placements` w wejściu: A 5, B 5 (równa bazie, kryterium m-c spełnione).

Zapas `bootClosureGzipBytes` maleje z 638 do 595 B. Bramka jest zielona, ale ciasna. Dla partii 2:
PLAN-FALI-3 §3a przewidywał ok. 155 B zapasu raw po partii. Te +44 B raw pozycji to ułamek tego, o co bał się
`prove-r0`. Orkiestrator powinien sprawdzić sumę z P3.3/P3.8 po scaleniu.

## 4. Lighthouse A/B (`lh/`, n = 3 na formę, fixture, ramię bot)

Obie strony: 3/3 ważne przebiegi, 0 wykluczonych, wariant wzorcowy `s-maxage=900, 330641 B` x3, wszystkie
przebiegi L1 HIT, tryb FCP `bez-js` 3/3, 0 par mieszanych. HTML: 330 641 B raw po obu stronach, gzip 49 871 /
49 883 B. Różnią się tylko hashe chunków i port w `og:url`/`canonical` (`home-A.html` / `home-B.html`).

### 4.1 Mediany (przebieg główny `lh/`)

| forma     | strona | perf | FCP    | LCP    | TBT    | SI     | CLS | TTFB  | TTI    | mainThread | bootup  | req | transfer |
| --------- | ------ | ---- | ------ | ------ | ------ | ------ | --- | ----- | ------ | ---------- | ------- | --- | -------- |
| mobile    | A      | 91   | 1,53 s | 2,28 s | 303 ms | 1,63 s | 0   | 14 ms | 5,41 s | 3322 ms    | 1362 ms | 70  | 914,6 KB |
| mobile    | B      | 87   | 1,61 s | 2,43 s | 418 ms | 1,70 s | 0   | 8 ms  | 5,32 s | 3748 ms    | 1273 ms | 70  | 914,7 KB |
| desktop4x | A      | 91   | 0,50 s | 0,56 s | 243 ms | 0,60 s | 0   | 7 ms  | 1,20 s | 2824 ms    | 1399 ms | 75  | 920,2 KB |
| desktop4x | B      | 93   | 0,47 s | 0,54 s | 213 ms | 0,61 s | 0   | 6 ms  | 1,19 s | 2826 ms    | 1395 ms | 75  | 920,3 KB |

### 4.2 DELTA B-A i pary (σΔ, MDE)

| forma     | DELTA (mediany)                                                                                                                                | pary: Δ (σΔ; MDE(t))                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mobile    | score -4, FCP +0,08 s, LCP +0,14 s, TBT +115 ms, SI +0,07 s, CLS 0, mainThread +426 ms, bootup -90 ms, transfer +0,2 KB, script +0,1 KB, req 0 | score -1,0 (3,0; 9,3); FCP +0,059 s (0,041; 0,128); LCP +0,105 s (0,074; 0,230); TBT -171 ms (435; 1346); SI -0,044 s (0,166; 0,515); TTI -0,102 s (0,132; 0,408) |
| desktop4x | score +2, FCP -0,03 s, LCP -0,02 s, TBT -30 ms, SI +0,02 s, CLS 0, mainThread +2 ms, bootup -4 ms, script +0,1 KB, req 0                       | score +1,7 (1,5; 4,7); FCP -0,025 s (0,088; 0,273); LCP -0,017 s (0,025; 0,079); TBT -24 ms (17; 53); SI -0,016 s (0,088; 0,271); TTI -0,055 s (0,073; 0,227)     |

### 4.3 Rozrzut przebiegów

| forma     | strona | perf         | FCP (s)            | LCP (s)            | TBT (ms)             | SI (s)             | load            |
| --------- | ------ | ------------ | ------------------ | ------------------ | -------------------- | ------------------ | --------------- |
| mobile    | A      | 91 / 69 / 98 | 1,53 / 1,53 / 1,53 | 2,28 / 2,29 / 2,28 | 303 / **2259** / 65  | 1,60 / 1,96 / 1,63 | 1,9 / 2,3 / 2,3 |
| mobile    | B      | 87 / 71 / 97 | 1,61 / 1,54 / 1,61 | 2,43 / 2,30 / 2,43 | 418 / **1588** / 107 | 1,70 / 1,73 / 1,61 | 2,4 / 2,3 / 1,6 |
| desktop4x | A      | 91 / 94 / 90 | 0,44 / 0,50 / 0,51 | 0,56 / 0,56 / 0,56 | 243 / 205 / 261      | 0,60 / 0,61 / 0,58 | 1,6 / 1,4 / 1,2 |
| desktop4x | B      | 93 / 94 / 93 | 0,47 / 0,38 / 0,52 | 0,57 / 0,54 / 0,52 | 213 / 200 / 223      | 0,61 / 0,49 / 0,63 | 1,6 / 1,3 / 1,4 |

Mobile szedł przy obciążeniu 1,6-2,4, czyli na granicy progu harnessu 2,4, bo równolegle budował inny agent.
Przebieg 2 po obu stronach ma w księdze zadanie `Other` 1 913 / 1 424 ms. To przestój maszyny, nie kod
strony. Dlatego puściłem **potwierdzający przebieg mobile** (`lh-mobile2/`, `ab-mobile2.log`, n = 3,
load 1,7-2,3).

### 4.4 Przebieg potwierdzający mobile (`lh-mobile2/`)

| strona      | perf         | FCP                    | LCP                    | TBT           | SI                 | CLS | mainThread | bootup  | req | transfer |
| ----------- | ------------ | ---------------------- | ---------------------- | ------------- | ------------------ | --- | ---------- | ------- | --- | -------- |
| A (mediana) | 97           | 1,54 s                 | 2,30 s                 | 98 ms         | 1,82 s             | 0   | 2948 ms    | 1362 ms | 72  | 915,2 KB |
| B (mediana) | 98           | 1,53 s                 | 2,30 s                 | 86 ms         | 1,67 s             | 0   | 2883 ms    | 1271 ms | 70  | 914,7 KB |
| A przebiegi | 97 / 96 / 97 | 1,54 / 1,53 / **1,60** | 2,30 / 2,30 / **2,42** | 98 / 161 / 82 | 1,82 / 1,85 / 1,60 | 0   |            |         |     |          |
| B przebiegi | 97 / 98 / 98 | 1,53 / 1,52 / 1,54     | 2,30 / 2,27 / 2,31     | 125 / 86 / 51 | 1,87 / 1,61 / 1,67 | 0   |            |         |     |          |

DELTA B-A: score +1, FCP -0,00, LCP -0,00, TBT -12 ms, SI -0,15 s, transfer -0,5 KB, req -2.

Pary: score +1,0 (σΔ 1,0; MDE(t) 3,1); FCP -0,024 s (0,028; 0,087); LCP -0,047 s (0,061; 0,188);
TBT -26 ms (52; 160); SI -0,040 s (0,174; 0,537); TTI -0,024 s (0,091; 0,281).

Tryb symulacji „FCP 1,60-1,61 / LCP 2,42-2,43”, który w przebiegu głównym trafił 2 z 3 przebiegów B, występuje
tu w A-mobile-3. To dwumodalność Lantern przy tym samym HTML-u, a nie efekt B. HTML jest identyczny (§4), a
klient różni się o 44 B. Delta mobile z przebiegu głównego (+0,08 FCP, +0,14 LCP mediany) mieści się w MDE(t) par
i znika w powtórce.

### 4.5 Księga zadań Lantern (blokowanie per klasa, ms sym.)

| przebieg        | ScriptCatchup | Style | Script:vendor-react | Timer:*                                     | ParseHTML/CSS | Other (przestój)    | TBT  |
| --------------- | ------------- | ----- | ------------------- | ------------------------------------------- | ------------- | ------------------- | ---- |
| A-mobile-1      | 130           | 36    | 16                  | 75 (dokument 44, dynamic-icon 18, index 13) | —             | GC 42               | 303  |
| A-mobile-2      | 117           | 162   | 39                  | 3                                           | 24            | **1913**            | 2259 |
| A-mobile-3      | —             | 38    | 15                  | 9                                           | —             | —                   | 65   |
| B-mobile-1      | 104           | 109   | 75                  | 87 (dynamic-icon 74, index 10, dokument 3)  | 41            | —                   | 418  |
| B-mobile-2      | 89            | —     | 13                  | 4                                           | 58 (CSS)      | **1424**            | 1588 |
| B-mobile-3      | —             | 48    | 23                  | —                                           | 36            | —                   | 107  |
| A-desktop4x-1   | 117           | 102   | 19                  | —                                           | 5             | —                   | 243  |
| A-desktop4x-2   | 104           | 74    | 13                  | —                                           | 14            | —                   | 205  |
| A-desktop4x-3   | 87            | 84    | 52                  | 28                                          | —             | 10                  | 261  |
| B-desktop4x-1   | 82            | 90    | 19                  | —                                           | 8             | — (dynamic-icon 14) | 213  |
| B-desktop4x-2   | 101           | 69    | 16                  | 6                                           | —             | — (Layerize 8)      | 200  |
| B-desktop4x-3   | 115           | 80    | 25                  | 3                                           | —             | —                   | 223  |
| A-mobile-1 (m2) | —             | 31    | 51                  | 7                                           | —             | — (Script:pl 9)     | 98   |
| A-mobile-2 (m2) | 64            | 50    | 40                  | —                                           | 7             | —                   | 161  |
| A-mobile-3 (m2) | —             | 33    | 20                  | —                                           | 29            | —                   | 82   |
| B-mobile-1 (m2) | 36            | 45    | 30                  | 15                                          | —             | —                   | 125  |
| B-mobile-2 (m2) | —             | 9     | 26                  | 5                                           | —             | — (Script:index 46) | 86   |
| B-mobile-3 (m2) | —             | 27    | 9                   | 15                                          | —             | —                   | 51   |

Po obu stronach występuje ten sam zestaw klas zadań i nie ma nowej klasy. Pozycja nie celuje w żadną klasę
zadań, bo jej efekt jest po stronie serwera i magazynu dokumentów. Desktop4x B (TBT 200-223 ms, perf 93-94)
jest wręcz lepszy od A, ale w granicach szumu (pary TBT -24 ms, MDE(t) 53 ms).

### 4.6 Speedline (obsSI, prawdziwy filmstrip, przebieg główny)

| przebieg                      | obsSI              | kształt                                                                                    |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| A-mobile-1 / 2 / 3            | 342 / 694 / 282 ms | 61-71% przy 262-369 ms (run 2: 713 ms, przestój), 99% przy 297-805 ms, 100% ok. 880-925 ms |
| B-mobile-1 / 2 / 3            | 456 / 567 / 262 ms | 61-71% przy 242-546 ms, 99% przy 277-644 ms, 100% ok. 860 ms                               |
| A-desktop4x-1 / B-desktop4x-1 | 308 / 337 ms       | 71% przy 292 / 319 ms, 99% przy 328 / 365 ms                                               |

Kształt filmstripu jest identyczny po obu stronach (te same kroki 61/71/99%). Bezwzględne obsSI zależą od
obciążenia maszyny w chwili przebiegu: przebiegi 3 przy load ≤ 2,3 dają A 282 ms i B 262 ms.

### 4.7 Audyty (mobile-1 z `lh-mobile2/`, przebieg przy niższym obciążeniu)

| pole                                                              | A                                                  | B                     |
| ----------------------------------------------------------------- | -------------------------------------------------- | --------------------- |
| element LCP                                                       | `img.eh-img` (`/cover.jpg`, priorityHinted, eager) | to samo               |
| LCP: TTFB / opóźnienie ładowania / ładowanie / opóźnienie renderu | 26 / 36 / 16 / 148 ms                              | 20 / 30 / 12 / 165 ms |
| CLS                                                               | 0                                                  | 0                     |
| żądania / transfer                                                | 70 / 914,6 KB                                      | 70 / 914,7 KB         |
| High przed obrazem LCP                                            | 112,4 KB                                           | 112,4 KB              |
| render-blocking                                                   | `styles-*.css` 68,5 KB                             | to samo               |
| fonty w ścieżce krytycznej                                        | `red-hat-display-latin` + `latin-ext`              | to samo               |

## 5. Ocena wobec kryteriów dowodu (PLAN-FALI-3 §2 P3.6b)

| kryterium                                                                                        | wynik                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| testy negatywne predykatu (każde odstępstwo = brak zapisu) i pozytywne B1/B2, testy `degradedBy` | obecne (IMPL, IMPL-fix1, IMPL-fix2: 467/467 testów w 13 plikach, kontrola mutacyjna). Na artefakcie potwierdzone: typ A i bramka wyczerpana bez zapisu, B1/B2 z zapisem, `degradedBy` w linii `doc` (§2.1) |
| (c) chrome po terminie czeka w ograniczonym budżecie                                             | potwierdzone na artefakcie (§2.2): baner w budżecie jest w HTML-u, wiszący baner nie wydłuża dokumentu                                                                                                     |
| harness bez regresji                                                                             | tak. Wszystkie delty par w MDE(t), w powtórce mobile ≈ 0. HTML i sieć bez zmian, CLS 0                                                                                                                     |
| fixture z opóźnieniem: zapis po pełnym strumieniu, typ A bez zapisu                              | tak (§2.1: B1/B2 `store:"stored"` z przebiegu czytelnika, 2. żądanie HIT bez rewalidacji; typ A `no-store`, bez `store`)                                                                                   |
| bramki artefaktu                                                                                 | zielone. Boot +44 B raw / +43 B gz, ad_placements w wejściu = baza                                                                                                                                         |

`effect_matches_plan`: **yes** dla struktury i **inconclusive** dla rozmiaru. Mechanizm działa na zbudowanym
artefakcie dokładnie tak, jak opisuje plan. Lokalny Lighthouse z definicji nie widzi efektu (L1 zawsze HIT,
§1 planu). Wielkość efektu trzeba zweryfikować na produkcji po wdrożeniu: odsetek `degraded:!0` na zimnych
MISS-ach oraz `store:"stored"` vs `revalidation` w Workers Logs.

Uwagi do raportu partii (nie blokują):

1. TTFB zimnego MISS-a typu A rośnie z 0,77 do 1,34 s (czekanie do terminu treści 1,2 s). B1 rośnie
   z 0,77 do 0,99 s, ale czytelnik dostaje pełną treść zamiast powłoki 180 KB. Ten koszt plan akceptuje.
2. „Bramka wyczerpana” w B wysyła czytelnikowi `public, s-maxage=30` dla dokumentu, którego magazyn nie
   przyjął. Nagłówek idzie przed końcem strumienia. Na produkcji hosting nadpisuje `cache-control` HTML-a na
   `no-cache, must-revalidate, max-age=0` (punkt (e) w IMPL), więc ryzyko praktyczne jest zerowe.
3. Odstępstwa nazwane w IMPL-fix2: m-a (hunk `__root.tsx` o trzy linie poza gałęzią `expired()`) i m-b
   (archiwum w trybie „najnowsze wpisy” na terminie treści).

## 6. Pliki

- Bramki: `build.log`, `check:bundle.log`, `check-bundle-base.log`, `check:chunks.log`,
  `check:entry-purity.log`, `check:server-entry-purity.log`, `document-weight(.json|.log)`,
  `document-weight-base(.json|.log)`, `e2e-ci.log`, `e2e.log`, `entrydiff/` (porównanie wejścia A/B).
- Lighthouse: `ab.log` i `lh/` (przebieg główny), `ab-mobile2.log` i `lh-mobile2/` (powtórka mobile).
  Zawierają ledgery, audyty, `*.artifacts/trace.json` i `summary.json`.
- Smoke: `smoke/tools/{replaySlow.mjs,probe2.sh,run-all.sh}`, `smoke/run-all.log`,
  `smoke/{A,B}-{clean,B1,B2,typeA,gateExhausted,chromeLateBanner,chromeLateBannerHang}/`.
- Poprzedni Prove (`80ce4d2b`): `prove-r0/`.

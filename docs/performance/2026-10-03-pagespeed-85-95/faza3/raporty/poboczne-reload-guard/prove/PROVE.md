# Dowód: strażnik przeładowania po błędzie chunku (`feat/w3-reload-guard`, `d67e1734`)

Worktree `scratchpad/wt3/reload-guard`, HEAD `d67e1734`, po wszystkich krokach `git status`
jest czysty. Kontrola to artefakt `scratchpad/base-w3b` (build z `63a05a32`, ten sam kod
aplikacji co baza `56da8d23`). Do przebiegu przeglądarkowego użyłem kopii jego `.output`
w `prove/base-copy/`, żeby równoległy build innego agenta nie podmienił plików w trakcie
pomiaru. Przed przebiegiem i po nim `diff -rq` z oryginałem nie pokazał różnic.

Werdykt: **wszystkie bramki zielone, waga bootu bez wzrostu kodu, dowód w przeglądarce
zgodny z oczekiwaniem.** `needs_fix = false`.

## 1. Bramki

| Krok             | Polecenie                                                                                                             | Wynik                                                                                                                | Log                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| build            | `heavy-bg.sh … env BUNDLE_INVENTORY=1 bun run build:smoke`                                                            | exit 0 (1 min 56 s)                                                                                                  | `build.log`                             |
| bundle           | `light.sh bun run check:bundle`                                                                                       | exit 0, „Bundle within budget” (ostrzeżenia o zapasie i ruchach względem baseline'u `b006c2e` są te same co w bazie) | `check:bundle.log`                      |
| graf chunków     | `light.sh bun run check:chunks`                                                                                       | exit 0, 893 chunki, graf acykliczny                                                                                  | `check:chunks.log`                      |
| czystość wejścia | `light.sh bun run check:entry-purity`                                                                                 | exit 0, ścieżka bootowania czysta                                                                                    | `check:entry-purity.log`                |
| czystość serwera | `light.sh bun run check:server-entry-purity`                                                                          | exit 0, 1813 plików, graf czysty                                                                                     | `check:server-entry-purity.log`         |
| waga dokumentu   | `node scripts/performance/check-document-weight.ts --json prove/document-weight.json` (przez mutex, bo stawia serwer) | exit 0, „Waga dokumentu w progach”                                                                                   | `docweight.log`, `document-weight.json` |
| e2e artefaktu    | `heavy-bg.sh … env NES_ARTIFACT_FIXTURE=1 SUPABASE_URL=https://placeholder.supabase.co … bun run test:e2e:artifact`   | exit 0, **12/12** (54,8 s)                                                                                           | `e2e.log`                               |

## 2. Waga dokumentu względem bazy (`w3/base-b/document-weight.json`)

Mediany z 5 próbek, `GET /`, fixture, `x-nes-cache HIT`.

| Metryka                | Baza      | Fix       | Delta   |
| ---------------------- | --------- | --------- | ------- |
| `bootClosureRawBytes`  | 1 636 946 | 1 636 946 | **0**   |
| `bootClosureGzipBytes` | 496 041   | 496 060   | **+19** |
| `bootBurstGzipBytes`   | 574 062   | 574 090   | **+28** |
| `bootBurstCount`       | 26        | 26        | 0       |
| `preLcpTransferBytes`  | 177 700   | 177 713   | +13     |
| `htmlGzipBytes`        | 52 542    | 52 555    | +13     |
| pozostałe mediany      | -         | -         | 0       |

Delty gzip to entropia hashy w nazwach plików, a nie kod. Sprawdziłem to plik po pliku
(`boot-closure-diff.txt`, skrypt `bootdiff.py`):

- Zamknięcie bootu ma w obu buildach 10 tych samych plików. Każdy ma identyczny rozmiar raw
  i jest identyczny bajt w bajt po zastąpieniu hashy w nazwach (`-XXXXXXXX.js`).
- Cała delta +19 B gzip siedzi w wejściu `index-*.js` (863 586 B raw w obu buildach). Jego
  nazwa zmieniła się z `index-c_XR_U82.js` na `index-DL6Hm7pW.js`, bo wejście trzyma mapę
  zależności dynamicznych importów z hashowanymi nazwami, a hash chunku z modułem się
  zmienił. Inne napisy hashy kompresują się trochę inaczej.
- `bootBurstGzipBytes` +28 B: zamknięcie (+19 B) plus hashe w nazwach pozostałych plików
  serii. Chunk z `cacheBusting.ts` nie należy do serii bootu. Gdyby należał, seria urosłaby
  o +163 B gzip, czyli o wzrost tego chunku, a nie o 28 B. Liczba plików serii też się nie
  zmieniła (26).
- To samo widać w IMPL-fix1 §5: runda 0 dała +30 B, runda 1 +19 B przy identycznym raw.

Rozmiar raw zamknięcia bootu, czyli kod wykonywany przy starcie, nie urósł ani o bajt.
Uznaję więc, że bramka „boot bytes nie rosną” jest spełniona. Zostaje zastrzeżenie: liczona
dosłownie metryka gzip ma +19/+28 B szumu nazw, którego żadna zmiana leniwego chunku nie
uniknie.

## 3. Zestaw chunków względem `base-w3b/.output/public/assets`

Szczegóły w `chunk-diff.txt` (skrypt `chunkdiff.py`).

| Miara                                                   | Wynik                                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| liczba plików                                           | 902 -> 902                                                                                                                                                       |
| pliki o tej samej nazwie (hash bez zmian)               | 51                                                                                                                                                               |
| pliki przemianowane (kaskada hashy od wejścia)          | 783 par 1:1 + 30 grup o wspólnym rdzeniu nazwy                                                                                                                   |
| suma raw `assets/`                                      | 16 269 662 -> 16 269 997 B (**+335**)                                                                                                                            |
| pliki ze zmienionym rozmiarem raw                       | **tylko `tag._slug-*.js`**: 2095 -> 2430 B (+335), gzip 1023 -> 1186 B (+163)                                                                                    |
| host `cacheBusting.ts` (`reports/chunk-inventory.json`) | `tag._slug-CC4c4lGd.js` -> `tag._slug-_jH88a13.js`, te same 3 moduły: `cacheBusting.ts`, `web-stories.$slug?tsr-shared`, `tag.$slug?tsr-split=notFoundComponent` |
| grupy niesparowane (kilka plików o tym samym rdzeniu)   | 30, w każdej te same rozmiary raw                                                                                                                                |
| treść inna niż same hashe nazw                          | 5 plików: `tag._slug` (moduł) oraz `eventBrandingDraft`, `serp`, `themeDesignCss`, `themeFontSizesCss`                                                           |

Cztery ostatnie pliki mają identyczny rozmiar raw. Diff tokenów pokazuje wyłącznie inną
kolejność instrukcji `import{…}from"./…"` (wejście `index-*` sortuje się teraz za
`vendor-tanstack-*`, bo zmienił się jego hash) i przemianowane aliasy importów. Logika
i zbiór importów są te same. To mechaniczny skutek nowego hasha wejścia, nie przesunięcie
modułów. Moduł nie przeszedł do wejścia ani do zamknięcia bootu, a współlokatorzy chunku
są ci sami. **Zmienił się wyłącznie chunk z `cacheBusting.ts`.**

## 4. Dowód w prawdziwej przeglądarce

Scratch (poza repo): `prove/pw/prove.config.ts` i `prove/pw/prove.spec.ts`. Chromium 1194
(Playwright, `Desktop Chrome`). Serwer tak jak w `test:e2e:artifact` z `NES_ARTIFACT_FIXTURE=1`:
`node --import replayFetch.mjs .output/server/index.mjs` z env fixture. Zmienne
placeholderowe CI były ustawione w procesie i fixture je nadpisał, tak samo jak w bramce e2e.
Fix działał na porcie 4291, kontrola na 4292. Oba przebiegi szły przez mutex, a serwery
uruchamiał i zatrzymywał Playwright (`reuseExistingServer: false`). Po przebiegach nie
został żaden mój proces. Działający serwer `integ-p38` należy do innego agenta i go nie
ruszałem.

**Uszkodzony chunk:** `SearchButtonWidget-*.js`, czyli wyspa wyszukiwarki w nagłówku `/`,
kandydat z badania rundy 0. `page.route` odpowiada `abort("failed")` albo 404. Wyspa importuje
chunk na intencję, więc w KAŻDYM nowym dokumencie, po `load` + 1,5 s, spec naciska „/”. To
model chunku, którego strona potrzebuje przy każdym wejściu. Odrzucony import dociera do
nasłuchu `unhandledrejection` korzenia i modułu jako „Failed to fetch dynamically imported
module” (zliczane w `pageerror`). Sam `<link rel=modulepreload>` pada po cichu i reloadu nie
wywołuje (ustalone w rundzie 0).

**Miara:** żądania nawigacji głównej ramki z `?_v=` w stałym oknie od `goto('/')`: 30 s
w trybach podstawowych i 75 s w trybach z późnym błędem. Każde takie żądanie to jeden
reload strażnika. Na końcu okna spec sprawdza w DOM obecność `<header>` i `<main>` oraz brak
tekstu Error Boundary.

Tryby magazynu (`addInitScript`):

- (a) `blocked`: getter `window.sessionStorage` rzuca `SecurityError`;
- (b) `quota`: `getItem` działa, `setItem` na `sessionStorage` rzuca `QuotaExceededError`;
- (c) `control`: magazyn działa;
- dodatkowo `blocked-404` (404 zamiast abortu) oraz `blocked-late` i `control-late`, gdzie
  abort przychodzi dopiero 20 s po żądaniu chunku, czyli po TTL 15 s. Te tryby sprawdzają
  kotwicę dokumentu z rundy 1, czego dotąd brakowało (uwaga M1 recenzji r1).

### Wyniki

| Tryb         | Okno | **Fix: reloady z `_v`** | Fix: błędy chunku | Fix: stan końcowy                             | **Baza: reloady z `_v`** | Baza: chwile reloadów (ms)    |
| ------------ | ---- | ----------------------- | ----------------- | --------------------------------------------- | ------------------------ | ----------------------------- |
| (a) blocked  | 30 s | **1** (2,6 s)           | 2                 | header + main, bez Error Boundary, `/en?_v=…` | **14** (pętla)           | 2566, 4553, 6568, … co ~2 s   |
| (b) quota    | 30 s | **1** (2,5 s)           | 2                 | jw.                                           | **13** (pętla)           | 2416, 4691, 7123, … co ~2,2 s |
| (c) control  | 30 s | **1** (2,4 s)           | 2                 | jw.                                           | **1**                    | 2435                          |
| blocked-404  | 30 s | **1** (2,4 s)           | 2                 | jw.                                           | **14** (pętla)           | 2454, 4406, 6425, …           |
| blocked-late | 75 s | **1** (20,3 s)          | 2                 | jw.                                           | **3** (wolna pętla)      | 20340, 40612, 60961           |
| control-late | 75 s | **1** (20,4 s)          | 2                 | jw.                                           | **3** (wolna pętla)      | 20388, 40783, 61099           |

Jak czytać tabelę:

- Fix ma dwa błędy chunku przy jednym reloadzie. Znaczy to, że drugi dokument (z `_v`)
  trafił na ten sam trwały błąd, a strażnik go stłumił. Strona zostaje na miejscu do końca
  okna: w trybach podstawowych przez ~27 s po reloadzie, w późnych przez ~55 s, w tym ~35 s
  po drugim błędzie. Nagłówek i `<main>` są obecne, Error Boundary nie ma, innych błędów
  strony brak.
- Baza w (a), (b) i 404 przeładowuje co ~2 s do końca okna, czyli ≥ 3 zgodnie
  z oczekiwaniem. W (c) daje jeden reload.
- Tryby późne pokazują, że baza zapętla się także przy **działającym** magazynie, gdy błąd
  przychodzi po TTL 15 s (okres ~20 s). Fix zatrzymuje to kotwicą dokumentu. To pierwszy
  dowód rundy 1 na zbudowanym artefakcie.

Wyniki surowe: `results-fix.json`, `results-base.json`. Logi: `pw-fix.log` i `pw-base.log`
(oba 6/6 przeszły, spec niczego nie asertuje, tylko zapisuje pomiar).

## 5. Czy commitować spec

Nie polecam w obecnej postaci. Pełna macierz trwa ~4,6 min na build. Spec zależy od nazwy
chunku `SearchButtonWidget-*` i od skrótu „/” wyspy, a to szczegóły UI niezwiązane
z modułem. Okna czasowe są celowo długie. Zachowanie przypinają już deterministycznie testy
jednostkowe `cacheBusting.test.ts` (55 przypadków, w tym 4 tryby magazynu i późny błąd).
Gdyby orkiestrator chciał strażnika e2e, najtańszy byłby jeden przypadek `blocked`
z oknem ~10 s (≈ 15 s czasu), asertujący `reloadsWithV === 1`. Decyzję zostawiam
orkiestratorowi. Niczego nie commitowałem.

## 6. Pliki

- `prove/build.log`, `check:*.log`, `docweight.log`, `document-weight.json`, `e2e.log`
- `prove/chunk-diff.txt`, `chunkdiff.py`, `boot-closure-diff.txt`, `bootdiff.py`,
  `importnorm.py`
- `prove/pw/prove.config.ts`, `prove/pw/prove.spec.ts`, `results-fix.json`,
  `results-base.json`, `pw-fix.log`, `pw-base.log`
- `prove/base-copy/` (kopia `.output` i `reports` z `base-w3b`, tylko do odczytu)

# P3.4 (fala 3) - runda poprawek 9: wycofanie (b), (a) zostaje

- Worktree: `scratchpad/wt3/P3.4`, gałąź `perf/w3-P3.4`. Nowy commit `0c3db638` na `c3433c56` (historia bez przepisywania).
- Wejście: ustalenie `prove` (blokujące, `PROVE.md` §6): (1) wycofać (b) wg reguły orkiestratora, bo `ScriptCatchup`
  nie dzieli się (jedno zadanie w 15/15 przebiegach B); (2) (a) spełnia literę kryterium, ale Style+Layout przechodzi
  do zadania pierwszej klatki, a Lantern dolicza je do FCP desktop (+0,09 / +0,10 s mediany w harnessie) - decyzja
  (i) przyjąć (a) albo (ii) przywrócić pomiar pola przy DCL.
- Stan worktree na starcie rundy: czysty (`git status` pusty, brak niezacommitowanych zmian po przerwanej próbie).
- Dane robocze rundy: `phase3/wave3/P3.4/fix9/` (logi bramek, `prodk4i.py`, `typecheck-noinc.sh`).

## 0. Najważniejsze dla orkiestratora

1. **(b) wycofane w całości** (nie tylko emisja `g`): `bootSet.server.ts` i jego test wracają bajt w bajt do bazy
   `c606bfa4`; z loadera znika `J`, `g`, `k` i akapit „SERIA GRUPAMI” (zamiast martwego kodu w `<head>` - właściciel
   prosi o usuwanie martwego kodu; tak też zalecała recenzja, MAJOR-1). Wariantu z zostawieniem (b) dla zysku na
   `Timer:(dokument)` desktop5x (PROVE §3.3) nie wybrałem: plan (§2 P3.4) i notatka orkiestratora mówią wprost
   „zostaje (a), a (b) jest wycofane”, zysk występuje tylko przy dławieniu ≥ ×5 i tylko w części przebiegów, a (b)
   kosztowało wejście 4-16 ms później i +12 B zestawu.
2. **(a) zostaje - wariant (i)**, zgodnie z regułą orkiestratora („K4i OBOWIĄZKOWO”, „zostaw (a) i wycofaj (b) w
   rundzie poprawek”) i planem. Nowy dowód, który rozstrzyga wątpliwość z PROVE §4 („w produkcji efekt
   prawdopodobnie zerowy” - wtedy na podstawie jednego starego LHR): **6/6 dzisiejszych śladów Lighthouse
   z produkcji** (`w3/prod-lh/*-0.trace.json`, 2026-10-08, kod bazy W3 z loaderem P2.1 na produkcji) ma pierwszą
   klatkę PRZED DCL, a zadanie pierwszego Paint niesie już pełny Style+Layout (tabela §2). Mechanizm Lantern z
   PROVE §4 (FCP rośnie, gdy klatkę po DCL zastępuje klatka z układem) wymaga DCL przed pierwszą klatką, czego na
   produkcji nie ma - tam (a) nie może podnieść FCP sym. Koszt w harnessie (dokument z lokalnego serwera w jednej
   porcji, DCL przed klatką) jest dla oceny pomijalny: przy FCP 0,4-0,6 s krzywa desktop (p10 934 ms, mediana
   1600 ms) daje Δ oceny FCP 0,0018 (desktop4x) / 0,0069 (desktop5x) × waga 10 % = **0,02 / 0,07 pkt**; LCP
   +0,02 s przy 0,54-0,56 s → 0,0007 × 25 % = 0,02 pkt.
   Wariant (ii) jest gotowy do wykonania w kilka minut, jeśli orkiestrator zdecyduje inaczej (przepis w §5).
3. `headRawBytes`: literał loadera **2733 → 2506 B (−227 B wobec bazy)**, zestaw bez zmian (bez `g`). Na artefakcie
   (`check-document-weight`, fixture, HIT): `<head>` **28 985 → 28 758 B** (zapas do progu 29 389 B: 0,4 → 0,6 KB).
   Progów `document-weight` nie ruszałem.
4. Typecheck: dwa pierwsze przebiegi `bun run typecheck` zabił cgroup OOM (`tsgo` 13,9 GB RSS, `dmesg`; pierwszy
   dodatkowo równolegle z moim `verify:static` - mój błąd, oba ubite, powtórzone osobno). Przyczyna jak w P3.5/P3.6a:
   `tsBuildInfoFile` w `node_modules/.cache`, a `node_modules` worktree to dowiązanie do checkoutu głównego (wspólny
   cache inkrementalny). Obowiązujący wynik: te same trzy kroki z `tsgo --incremental false`
   (`fix9/typecheck-noinc.sh`, kopia skryptu P3.5) - zielone.

## 1. Co się zmieniło i dlaczego, plik po pliku (diff względem `c3433c56`)

### `src/lib/boot/bootSet.server.ts`, `src/lib/boot/__tests__/bootSet.server.test.ts`

- Powrót do stanu bazy `c606bfa4` bajt w bajt (`git checkout c606bfa4 -- …`): bez pola `g` w `BootSet`, bez granic
  w `composeBootSet`, bez akapitu „GRUPY SERII”, bez testów granic. Względem bazy fali te dwa pliki nie mają diffu.
  Dzięki temu oczekiwany zestaw w testach (`toEqual` bez `g`) pilnuje, że granice nie wrócą przypadkiem.

### `src/lib/boot/bootLoaderScript.ts`

- `B`: seria `modulepreload` znowu jedną pętlą w zadaniu wyzwalacza (jak w bazie), wejście `H` po sparsowaniu
  dokumentu - `J`, `g`, `k` usunięte. Jedyna różnica wobec pętli bazy: stała `U` zamiast literału
  `"DOMContentLoaded"`.
- K4i bez zmian względem `c3433c56`: `Y(){R||Q();C();T(cap);F||!S||L(X)}` (zero geometrii w handlerze DCL), `X`
  w zadaniu po pierwszej klatce (rAF + `setTimeout(0)`), `nocand` bez geometrii dla dokumentu bez kandydata,
  reguła (ii) z wpisem sprzed pomiaru w `V`. `MutationObserver` nadal usunięty.
- Komentarze: nagłówek wraca do „całej listy” i „wejście nigdy przed końcem parsowania”; akapit K4i dostał zmierzony
  bilans (Style+Layout przechodzi do klatki, TBT bez zmiany ponad szum; FCP harnessu desktop vs produkcja); nowy
  krótki akapit „SERIA JEDNYM ZADANIEM (P3.4, zmierzone i wycofane)” - żeby nikt nie wracał do grup bez nowego
  powodu; „ZESTAW CZYTANY LENIWIE” wskazuje strażnika kolejności w e2e; legenda nazw bez `J/g/k`; DOKTRYNA bez
  wzmianki o grupach.
- Literał: 2733 B (baza) → 2615 B (`c3433c56`) → **2506 B**.

### `src/lib/boot/__tests__/bootLoaderScript.test.ts`

- Usunięte: stała `GROUPED_SET` i blok „seria grupami w osobnych zadaniach” (7 przypadków).
- Nowy blok „seria jednym zadaniem, wejście za całą serią” (2 przypadki): wyzwalacz po DCL wstawia całą serię
  i wejście w tym samym zadaniu (wejście w `<head>` za każdym `modulepreload`, watchdog raz); wyzwalacz przed DCL
  (interakcja w trakcie parsowania) - seria od razu, wejście przy DCL za każdym `modulepreload` (reguła CLS boot-js C3).
- K4i, `MutationObserver` i reszta bez zmian. Nagłówek pliku opisuje stan po wycofaniu.
- Dowód, że testy łapią regresję: ten sam plik na loaderze bazy (`git show c606bfa4:…` podstawiony na chwilę i
  przywrócony, `cmp` zgodny) → **5 czerwonych** (zestaw po skrypcie bez obserwatora, (ii) po klatce, kandydat poza
  oknem po klatce, K4i ×2); na nowym loaderze 39/39 zielone (`fix9/mental-revert-base.log`).

### `e2e/boot-home.spec.ts`

- Usunięte asercje `g` (kształt granic, słownik poza pierwszą grupą) i pole `g` w typie; asercja słownika wraca do
  postaci z bazy.
- **MINOR-1 z recenzji (strażnik kolejności):** na surowym HTML-u `/` i `/en` węzeł `id="nes-boot-set"` musi stać
  PRZED `<script data-nes-boot`. Po usunięciu `MutationObserver` to jedyna gwarancja, że loader zastaje zestaw przy
  starcie (inaczej czyta go dopiero przy DCL). Test potoku w `bootSet.server.test.ts` renderuje syntetyczny korzeń bez
  loadera, więc strażnik stoi w e2e na prawdziwym artefakcie (`__root.tsx`).
- **MINOR-3:** „każdy moduł serii zażądany przed wejściem” porównuje teraz pełny `href`
  (`new URL(url, location.href).href === link.href`), a nie `pathname` - poprawnie także dla bezwzględnych URL-i,
  które dopuszcza `BOOT_URL_RE`. Sama asercja zostaje (reguła CLS C3 jest niezależna od grup).

## 2. Produkcja: kolejność pierwszej klatki i DCL (nowy pomiar, bez ruchu na produkcji)

`python3 -I fix9/prodk4i.py w3/prod-lh/*-0.trace.json` - ślady Lighthouse 13.5 z produkcji zapisane przez orkiestratora
2026-10-08 08:55-08:58 (kod bazy W3, loader P2.1 na produkcji). Żadnych nowych żądań do produkcji.

| ślad      | FP / FCP obs. [ms] | DCL obs. [ms] | zadanie DCL (Style / Layout) [ms] | zadanie pierwszego Paint (Style / Layout) [ms] |
| --------- | ------------------ | ------------- | --------------------------------- | ---------------------------------------------- |
| desktop-1 | 2095 / 2095        | 2106          | 2,3 (0,3 / 0,2)                   | @1998: 30,0 (17,6 / 7,1)                       |
| desktop-2 | 2215 / 2215        | 2297          | 4,5 (0,1 / 0,0)                   | @2090: 66,0 (23,3 / 34,7)                      |
| desktop-3 | 1983 / 1983        | 2086          | 7,2 (0,2 / 0,0)                   | @1781: 129,5 (28,4 / 76,3)                     |
| mobile-1  | 2825 / 3303        | 3789          | 58,2 (2,5 / 0,0)                  | @2764: 47,2 (45,0 / 0,2)                       |
| mobile-2  | 1033 / 1033        | 1042          | 29,3 (1,1 / 22,0)                 | @827: 174,3 (38,9 / 105,6)                     |
| mobile-3  | 792 / 792          | 851           | 4,3 (0,1 / 0,0)                   | @621: 138,1 (33,8 / 69,2)                      |

- Pierwsza klatka przed DCL w **6/6**; zadanie pierwszego Paint ma już pełny Style+Layout (do 174 ms obs.), więc węzeł
  pierwszego Paint w grafie FCP Lantern jest „duży” także w bazie - (a) nie zmienia grafu FCP produkcji.
- Wymuszony układ w zadaniu DCL na produkcji to tylko układ treści sparsowanej po pierwszej klatce: 0-22 ms obs.
  (mobile-2: Layout 22 ms). (a) przenosi go do następnej klatki - niewielki, ale realny zysk na produkcji, zero
  wpływu na FCP.

## 3. Bramki

| bramka                                                                                               | wynik                                                                                                                                                                       | log                                              |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `bunx prettier --write` (5 plików)                                                                   | zielona (bez zmian po edycji)                                                                                                                                               | -                                                |
| `light.sh bunx eslint` (5 plików)                                                                    | zielona, exit 0                                                                                                                                                             | -                                                |
| `light.sh bunx vitest run` (6 plików: boot ×2, router, rootRoute, platformPreloads, bootProbeScript) | 177/177 zielone (loader 39, zestaw 11)                                                                                                                                      | -                                                |
| typecheck (mutex, `heavy-bg.sh`, `typecheck-noinc.sh` = 3 kroki, `tsgo --incremental false`)         | zielony (`tsc`, `scripts`, `e2e`); 2 wcześniejsze próby `bun run typecheck` ubite OOM                                                                                       | `fix9/typecheck.log`, `fix9/typecheck-oom-2.log` |
| `light.sh bun run verify:static`                                                                     | zielona: 15 bramek OK w 238 s (w tym `format:check`, `check:dangerous-html`, bramki SQL); pierwsza próba ubita OOM w `format:check` (równolegle z typecheck)                | `fix9/verify-static.log`                         |
| `heavy-bg.sh env BUNDLE_INVENTORY=1 bun run build:smoke`                                             | zielony, 1 min 58 s; literał loadera tylko w `.output/server/_ssr/router-*.mjs` (w `.output/public/assets` brak), `function J(){for` = 0                                    | `fix9/build-smoke.log`                           |
| `heavy-bg.sh bun run test:e2e:artifact`                                                              | zielone 9/9 (boot-home pl/en z nowym strażnikiem kolejności i pełnym `href`, sesja `now`, boot-artifact ×3, boot-timing ×3)                                                 | `fix9/e2e-artifact.log`                          |
| `light.sh bun run scripts/performance/check-document-weight.ts`                                      | zielone 28/28; **`headRawBytes` 28 758 B** (baza W3 28 985 B, `c3433c56` 28 879 B → −227 B wobec bazy), `inlineScriptBytes` 86 617 B (baza 86 844), zestaw 26 URL-i bez `g` | `fix9/document-weight.log`                       |

Nieuruchomione (etap Prove): build produkcyjny, `check:bundle`/`check:chunks`/`check:entry-purity` (loader jest
wyłącznie w bundlu serwera, bundel klienta bez zmian logiki), Lighthouse `--compare`.

## 4. Odstępstwa od planu

1. **(b) wycofane** - zgodnie z regułą planu („jeśli pomiar pokaże, że dokończenia kompilacji i tak lądują w jednym
   zadaniu, zostaje (a), a (b) jest wycofane z raportem”). Raport: PROVE §3.2 (jedno zadanie `ScriptCatchup` 15/15 B)
   - sonda IMPL §3 (15 przebiegów) - przeglądarka linkuje domknięcie wejścia jednym zadaniem niezależnie od podziału
     żądań. Realna dźwignia na K7 to objętość domknięcia (P5.1/P5.2), nie rozkład żądań.
2. **Kryterium FCP ±0,02 s w harnessie desktop niespełnione przez (a)** (PROVE §2: +0,09 / +0,10 s mediany) -
   świadomie przyjęte wg reguły „K4i OBOWIĄZKOWO”: to artefakt kolejności DCL/klatki w fixture (dokument w jednej
   porcji), na produkcji nieobecny (§2), a wpływ na ocenę desktop < 0,1 pkt (§0 pkt 2). Kierunek ΔTBT < 0 też nie
   jest spełniony (PROVE: wszystko w szumie) - Lantern liczy zadania z Layout z mnożnikiem 0,5 × CPU, więc Style+Layout
   przeniesiony do klatki kosztuje w symulacji tyle samo; realne zmniejszenie tej pracy to P3.3 (`content-visibility`,
   partia 2), który zmniejszy też koszt FCP harnessu z (a).
3. Reszta jak w IMPL §4 (pomiar w zadaniu po rAF zamiast w callbacku `PerformanceObserver`; `MutationObserver`
   usunięty). Punkty IMPL §4.3-4.4 (grupy tylko w `lcp`, grupy dla `input`/`nocand`/…) są bezprzedmiotowe.

## 5. Wariant (ii) - przepis, jeśli orkiestrator wybierze przywrócenie pomiaru przy DCL

Zmiana tylko w loaderze i jego teście (zestaw i e2e bez zmian):

- `Y` wraca do odczytu przy DCL (bez `MutationObserver`):
  `function Y(){R||Q();C();T(3000,"cap");if(F||!S)return;for(var c=I(),i=0,a,b=0;i<c.length;i++){a=Z(c[i]);if(a>A){A=a;b=1}}if(!b)return L(M);V&&O(V)&&T(50,"lcp")}`
  i usunięcie `X` (`L(f)`, `M`, `U` zostają) - literał 2511 B (policzone: −222 B wobec bazy).
- Test: blok K4i odwraca się na „odczyt przy DCL raz”, przypadki „(ii) po pierwszej klatce” i „kandydat poza oknem po
  klatce” wracają do wersji z bazy (rozstrzygnięcie przy DCL / `nocand` po rAF + 0).
- Skutek: `Script:(dokument)` z Style/Layout wraca w harnessie (A: 5/15 przebiegów, do 146 ms blok. desktop4x), FCP
  harnessu desktop wraca do bazy; na produkcji bez różnicy (§2).

## 6. Ryzyka

- **Martwy boot**: seria i wejście to znów kod bazy (pętla + `H` po DCL); testy „wejście nigdy przed końcem
  parsowania” (6 wyzwalaczy) zielone, nowe testy kolejności w `<head>`, e2e artefaktu (§3).
- **Zestaw po loaderze** (bez `MutationObserver`): strażnik kolejności w e2e (`/`, `/en`); gdyby kolejność się
  odwróciła, boot nie umiera - zestaw czyta handler DCL (test „zestaw PO skrypcie”), seria `lcp` rusza najpóźniej przy
  DCL, `now` ma serię w nagłówku `Link`.
- **K4i w ramce bez rAF** (recenzja MINOR-4): wpis (ii) sprzed DCL w ramce, w której rAF nie biegnie (ukryta, dławiona
  ramka obca bez sesji), rozstrzyga się na `load` + 500 ms albo limicie 3 s zamiast przy DCL. W ukrytej karcie `L`
  używa samego `setTimeout`. Skutek marginalny, bez zmiany kodu.
- **Stary HTML z cache po wdrożeniu**: loader i zestaw zawsze z tego samego builda w jednym dokumencie; produkcja
  nigdy nie dostała `g`, więc nie ma zestawów z granicami w obiegu.

## 7. Na co patrzeć w recenzji

1. `B` w `bootLoaderScript.ts` = pętla bazy (diff wobec `c606bfa4` tylko `U`); brak `J/g/k` w literale (grep `J(`).
2. `bootSet.server.ts` i jego test: `git diff c606bfa4 -- src/lib/boot/bootSet.server.ts src/lib/boot/__tests__/bootSet.server.test.ts` jest pusty.
3. e2e: strażnik `indexOf('id="nes-boot-set"') < indexOf("<script data-nes-boot")` i porównanie pełnego `href`.
4. Decyzja (i) vs (ii) (§0 pkt 2, §2, §5).

## 8. Potrzeby spoza własności

- Brak dla tej pozycji.
- Informacyjnie dla orkiestratora: `bun run typecheck` w worktree zabija OOM przez wspólny `tsBuildInfoFile`
  (`tsconfig.json` → `node_modules/.cache`, dowiązany `node_modules`); w kolejnych agentach `tsgo --incremental false`
  albo osobny `--tsBuildInfoFile` w scratchpadzie (to samo zalecenie co P3.5).

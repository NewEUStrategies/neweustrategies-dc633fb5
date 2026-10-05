# Stan fali 1 po bramce (2026-10-05)

Bramka fali 1 programu PSI 85/95 (`PLAN-FALE-1-2.md` §2.3 pkt 5, kryteria (a)–(f) z celu fali 1 w
`faza1/PLAN.json`, Definition of Done fali 1). Wszystkie pozycje fali 1 (P1.0b, P1.1, P1.2, P1.3, P1.4, P1.6, P1.7) są
scalone do gałęzi PR `claude/zen-johnson-wpzoxv`.

> **Aktualizacja 2026-10-05, po scaleniu P1.3b (`8d9c8d2a2`).** Kryterium (d) jest naprawione. Powłoka zgód jest
> odsłaniana dopiero wtedy, gdy parser domknie ją w całości: statyczny skrypt `CONSENT_SHELL_REVEAL_SCRIPT` (ostatnie
> dziecko gniazda, tylko render serwera) ustawia `html[data-consent-parsed]`, a do tego czasu karta ma `display: none`,
> więc ucięta karta zakotwiczona od dołu nigdy się nie maluje. Dowód (raporty `P1.3b-*.md`):
>
> - **deterministyczny** (nowy przypadek w `e2e-performance/consent-shell-geometry.spec.ts`, dokument podany w dwóch
>   porcjach rozciętych w środku karty z przerwą 800 ms): baza `67c87e16` oblewa (przesunięcie powłoki 0,0545 mobile,
>   0,0138 desktop), P1.3b daje 0 przesunięć na obu formach;
> - **A/B n = 10** (mobile, desktop4x) wobec `67c87e16`: 0/20 przebiegów z przesunięciem powłoki w B. Baza też miała
>   0/20, bo host był szybszy niż w bramce (benchmarkIndex ok. 2300 zamiast ok. 1300) i parser rzadko oddawał wątek w
>   środku karty; dlatego rozstrzyga dowód deterministyczny. Bez regresji: `observedSpeedIndex` mediana mobile
>   372 → 340 ms, desktop 380 → 368 ms, TBT i LCP w szumie (pary: mobile TBT −11 ms przy MDE 58 ms, LCP +0,022 s przy
>   MDE 0,064 s);
> - **waga dokumentu** zielona bez zmiany progów: +127 B raw, ok. +50 B gzip (zapas htmlGzip ok. 857 B).
>
> Dowód P1.3b biegł na drzewie po scaleniu `main` z PR #475, więc na scalonej głowie są teraz zmierzone także
> `build:smoke`, `check:bundle` (overall 4791,2 KB, czerwone tak jak na `main`), `check:document-weight` (zielone),
> e2e artefaktu (8/8), spec powłoki (8/8) i Lighthouse. `/dev/null` (§0) jest znów urządzeniem znakowym 1:3 od
> restartu kontenera. Desktopowe 0,003–0,011 (nagłówek i sekcja `…0029`) występuje po obu stronach i zostaje w
> liście przekazania (pkt 9, P2.3). Kryteria fali po tej zmianie: (a) częściowo (K13, K9b1/K10 przekazane), (b) co do
> intencji, (c), (d) i (e) zaliczone, (f) zmierzone (P3.3 i P3.4 obowiązkowe przed wdrożeniem).

- **A = W0** = `main` @ `ff719b9a6` (produkcja bez fali 1), worktree `$SCRATCH/base-w1gate`.
- **B = W1** = gałąź PR @ `45eb5747c` (po scaleniu P1.3 i jego raportów), worktree `$SCRATCH/gate-w1`.
- Oba drzewa zbudowane `BUNDLE_INVENTORY=1 bun run build:smoke`; kopie `lighthouse-local.mjs` po obu stronach bajt w
  bajt te same. Komendy, tabele surowe i uwagi o ważności: `POMIAR.md` §8. Liczby maszynowo:
  `raporty/W1-wyniki.json`.
- `main` po `ff719b9a6` przesunął się o commity backendu i CI oraz o commit Lovable `050c5d850` (renderowanie
  buildera); `ff719b9a6` jest przodkiem `45eb5747c`, więc para W0/W1 jest spójna.
- **Zakres werdyktu: wyłącznie `45eb5747c`.** Gałąź PR poszła dalej: scalenie `main` `61b6e7f43`
  (PR #475), potem `226e86dbc` (`.gitignore`) i `61d4e56df` (test `ConsentScriptInjector`). Scalenie zmienia 71 plików w `src/`, w tym publiczne renderowanie buildera
  (`ChromeWidgetView.tsx`, `widget-view/frame.ts`, `hoverCss.ts`, `themeGeometry.ts`, `themed.ts`, `typographyCss.ts`,
  `parse.ts`) i `styles.css` (wielkość liter kolorów), oraz usuwa 209 plików testów w `src/`, 21 modułów
  `src/lib/ci`, testy uprzęży pomiarowej (`scripts/performance/*.test.mjs`, w tym `document-weight.test.mjs` i
  `harness-ext.test.mjs`) i część skryptów bramek z `package.json` (m.in. `check:i18n-overlay-imports`,
  `check:chunk-parity`, `test:measurement-harness`). Na scalonej głowie orkiestrator uruchomił tylko `typecheck`
  (exit 0) i vitest (437/437 plików, 12 345 testów zielonych, 125 oczekiwanych porażek). `build:smoke`,
  `check:bundle`, `check:document-weight`, e2e i Lighthouse NIE były tam uruchamiane, a zapasy są małe (§6), więc
  trzeba je powtórzyć – po naprawie `/dev/null` (§0).

Werdykty przeszły dwie niezależne weryfikacje (statystyka i trafność; atrybucja i kompletność). Rozbieżności między
analizami i weryfikacją rozstrzygnąłem na danych surowych (§2.1). Kodu produktu, testów, konfiguracji ani progów nie
zmieniałem.

## 0. Werdykt w skrócie

| Kryterium                              | Werdykt                                                        | Kluczowe liczby                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) księga i mediana TBT               | **częściowo**                                                  | TBT mobile 1203 → 374 ms, desktop4x 1979 → 1037 ms, 10/10 par ujemnych; gtag, BRAND, K8a/K8b zniknęły w 10/10 B; K13 zostaje w 10/10 B, K9b1 i K10 ≥ 50 ms sym. w 10/10 B |
| (b) FCP/LCP ±0,02 s                    | **zaliczone co do intencji** (dosłownie nie, tylko na korzyść) | Δ median Lantern −0,028 … −0,061 s, w szumie; struktura bez zmian                                                                                                         |
| (c) SI                                 | **zaliczone** (wariant 1)                                      | `observedSpeedIndex` mobile 709 → 497 ms (próg ≤ 609), pary −202,8 ms                                                                                                     |
| (d) CLS ≤ 0,001, przesunięcie ≤ 0,0005 | **niezaliczone**                                               | nowa regresja P1.3: powłoka zgód w 3/20 przebiegów B (0,06628 i 0,03872 mobile, część 0,01586 desktop), 0/20 A; desktop 0,006–0,011 istniejący na W0                      |
| (e) kandydat LCP                       | **zaliczone**                                                  | `imgFetchpriorityHigh` 1; element LCP `img[data-lcp-candidate]` w 20/20 przebiegów B                                                                                      |
| (f) sprzężenie C3 i projekcja W2       | **zmierzone: P3.3 i P3.4 MUST przed wdrożeniem**               | projekcja W2 TBT PSI mobile **615 ms > 340 ms** (5 z 6 kombinacji powyżej progu)                                                                                          |
| Bramka fali 1 łącznie                  | **niezaliczona w całości**                                     | (d) niezaliczone, (a) częściowo                                                                                                                                           |
| Definition of Done fali 1              | **częściowo**                                                  | TBT i FCP/LCP spełnione; prognoza PSI mobile 63–67 (plan 64–68), desktop 77–79; bramki repo nie wszystkie zielone (`check:bundle` +6,6 KB ponad zakres znany z `main`)    |

**Pilne, środowisko.** Od 10:36 UTC `/dev/null` jest dowiązaniem symbolicznym do
`$SCRATCH/phase2/wave1/gate/lh-c3/summary.json` (błąd polecenia w etapie analizy C3; naprawę zablokował system
uprawnień). Każdy start powłoki nadpisuje ten plik, więc `summary.json` serii C3 jest stracony (LHR, artefakty,
księgi i `c3.log` są nienaruszone). Serie `lh-ab` (koniec 09:50) i `lh-c3` (koniec 10:03) powstały przed incydentem.
Przed kolejnym krokiem ciężkim (build, Lighthouse, Playwright) człowiek musi odtworzyć urządzenie, jako root:
`rm /dev/null && mknod -m 666 /dev/null c 1 3`.

## 1. Pozycje fali 1

Commity scalenia z `git log --merges --first-parent` gałęzi PR. „Baza dowodu” to drzewo, wobec którego pozycja była
mierzona A/B przed scaleniem (każda pozycja miała własną bazę, więc efekty się nie sumują).

| Id    | Co                                                                                                                                   | Scalenie (dalsze commity)                                                        | Efekt w dowodzie pozycji                                                                                                                                                                                                                   | Raporty (`raporty/`)                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.0b | ingest web-vitals zapisuje pola P0.6 (`edgeCache`, `edgeLayer`, `colo`, `inp*`), migracja `web_vitals_edge_inp`, typy                | `ddf82dbb8` (`2689a7a4b` snapshot authz)                                         | bez etapu dowodu (`prove: false`); 0 pkt, dane RUM; recenzja APPROVE                                                                                                                                                                       | `P1.0b-IMPL.md`, `P1.0b-REVIEW.md`                                                                                                                      |
| P1.2  | `StyleSink` arkuszy korzenia, start nagłówka bez zapisu stylu `<html>`, F1 (bez `oi-fade-in`), F1b (statyczny szkielet sekcji), F2b  | `319ae93df` (`e1ef20b2b`, `06a9600ac`)                                           | baza `cc1a3767`: BRAND A 10/10 → B 0/10; starty `oi-fade-in`/`lv-shimmer` 0/15 B; K13 zostaje na fixture (mobile 4/5, desktop 5/5 ≥ 50 ms sym.); ΔTBT mediana mobile −118 ms, desktop4x −576 ms                                            | `P1.2-IMPL.md`, `P1.2-REVIEW.md`, `P1.2-PROVE.md`                                                                                                       |
| P1.6  | prymityw wysp `HydrationIsland` i `useViewportDevice` (moduły bez importerów)                                                        | `91354e924` (`80f225c37`)                                                        | bez etapu dowodu; graf entry, bundle i waga dokumentu bez zmian; cztery rundy recenzji, runda 4 approve                                                                                                                                    | `P1.6-IMPL.md`, `P1.6-IMPL-fix1..3.md`, `P1.6-REVIEW.md`, `P1.6-REVIEW-1..3.md`                                                                         |
| P1.4  | jeden kandydat LCP na stronę, `data-lcp-candidate`, jedno źródło preloadu, bramka ścieżki krytycznej w `check-document-weight`       | `10262b979` (`91069f773`, `3551c1077` `altMarksLogo`, `135e5cec3`)               | baza `cc1a3767`: `imgFetchpriorityHigh` 9 → 1; jeden kandydat LCP = `img[data-lcp-candidate]` w 3/3 B; ΔLCP +0,02 s (w szumie); TBT pary +13 ms (w szumie); boot −1,2 KB gzip                                                              | `P1.4-IMPL.md`, `P1.4-IMPL-fix1/9/10.md`, `P1.4-REVIEW.md`, `P1.4-REVIEW-1/2/10.md`, `P1.4-PROVE.md`, `P1.4-PROVE-2.md`                                 |
| P1.1  | gtag poza śladem (punkt ciszy P0.3, kolejka po interakcji), Google Ads dopiero po zgodzie marketingowej                              | `f2a010365` (`8bfd26dbe`)                                                        | baza `7e2a66ad4`: zadania i żądania Google 0 w 15/15 B; ΔTBT mediana mobile −496 ms (pary −591, MDE(t) 385), desktop4x −541 ms (pary −417, MDE(t) 387, kierunek); boot −0,6 KB gzip, overall +2,6 KB                                       | `P1.1-IMPL.md`, `P1.1-IMPL-fix9.md`, `P1.1-REVIEW.md`, `P1.1-REVIEW-9.md`, `P1.1-PROVE.md`, `P1.1-PROVE-2.md`                                           |
| P1.7  | zadania korzenia: szybka ścieżka gościa w `AuthProvider`, `sessionHint.ts`, tyknięcie po drzewie tras, podział ciała timera (bez I2) | `16d83fec7` (`8bfd26dbe`, `ff3a4149c`, `92887a899`, `9866be8fc`, `a24cf26a4`)    | baza `7e2a66ad4`: ΔTBT mediana mobile −150 ms (pary −111, MDE(t) 148), desktop4x +1 ms (szum); blokowanie strefy korzenia mobile 176 → 61 ms; K9b1 i K10 ≥ 50 ms sym. w 10/10 B; entry +692 B gzip                                         | `P1.7-IMPL.md`, `P1.7-IMPL-fix9.md`, `P1.7-REVIEW.md`, `P1.7-REVIEW-9.md`, `P1.7-PROVE.md`, `P1.7-PROVE-2.md`, `P1.7-i2-island-experiment.test.tsx.txt` |
| P1.3  | powłoka zgód w SSR i skrypt zgód w `<head>`, przejęcie przez baner po interakcji, nakładki poza oknem                                | `05843a60f` (`e420a58d0` progi wagi dokumentu, `11f49aed1`, `45eb5747c` raporty) | baza `135e5cec3`: `observedSpeedIndex` mobile −218 ms (n = 10, MDE(t) 98, 10/10 par ujemnych), karta w klatce 0 filmstripu; desktop −71 ms; TBT mobile pary +105 ms przy MDE(t) 103 (nierozstrzygnięte); HTML +7 243 B raw / +2 145 B gzip | `P1.3-IMPL.md`, `P1.3-IMPL-fix1.md`, `P1.3-IMPL-fix9.md`, `P1.3-REVIEW.md`, `P1.3-REVIEW-1.md`, `P1.3-PROVE.md`, `P1.3-PROVE-2.md`                      |

Scalenia `main` w trakcie fali: `ebda61814`, `79652420a`, `054d3a92d`, `9be723f6e`; po bramce `61b6e7f43` (PR #475).
Pozycji warunkowych P1.0a i P1.0c nie uruchamiano (raport P0.5 i poprawki P0.3 weszły w PR #469, `STAN-FALI-0.md`).

## 2. Bramka fali 1: kryteria (a)–(f)

Serie (szczegóły w `POMIAR.md` §8): **`lh-ab`** – A/B z przeplotem, 5 przebiegów na stronę, formy mobile i desktop4x,
flagi `--client-backend fixture --third-party fake-gtag --save-artifacts`, 20/20 przebiegów ważnych; **`lh-c3`** – to
samo z transformacją C3 (`scripts/performance/whatif/c3-lcpobs.mjs`) po obu stronach, 20/20 ważnych; **what-if
deterministyczny** `dropscripts-before-lcp` na 20 artefaktach `lh-ab`. MDE(t) = (t₀,₉₇₅ + t₀,₈)·σΔ/√n (dla n = 5
mnożnik 3,717); MDE A/A z POMIAR §7 w tej definicji: 168 ms (mobile) i 600 ms (desktop4x) przy n = 5.

| Kryterium                                                                                                                                                                  | Werdykt                      | Dowód                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) księga W0→W1: zadania gtag, przepisania arkusza marki, metryk nagłówka i z listy P0.5 zniknęły albo skrócone we wszystkich przebiegach; mediana TBT < baza (wobec MDE) | **częściowo**                | **Część TBT – zaliczona.** Mobile 1203 → 374 ms (Δ mediany −829 ms, pary −794,7 ms, σΔ 170,5, MDE(t) 283, t −10,42, p 0,0005; wszystkie pary ujemne, największy B 547 < najmniejszy A 966,6). Desktop4x 1978,9 → 1037,0 ms (Δ mediany −941,9 ms, pary −915,5 ms, σΔ 569,2, MDE(t) 946, MDE(z) 713, t −3,60, p 0,023; wszystkie pary ujemne, Mann–Whitney p 0,008): kierunek i istotność potwierdzone, \|Δ\| poniżej MDE(t) serii, powyżej MDE(z) i MDE A/A. **Część księgi – częściowo.** Zniknęły w każdym przebiegu B: zadania Google (A 29 w 10/10 → B 0), przepisanie arkuszy korzenia BRAND (A 10/10 → B 0/10), starty `oi-fade-in` i `lv-shimmer` (A 7 + 40 na przebieg w 20/20 → B 0 w 20/20). Zostają: **K13** (zapis `--sticky-header-h`) w 10/10 B, sym. mobile A 111/164/116/133/93 → B 98/139/134/83/155 ms, desktop4x A 181/95/95/188/124 → B 178/152/188/122/125 ms – z założenia P1.2 na fixture (domyślna 123 px ≠ zmierzone 107 px, desktop bez domyślnej); **K9b1** (drzewo tras, 78–130 ms sym.) i **K10** (`createRouter`, B 64–108 ms sym.) ≥ 50 ms sym. w 10/10 B – właściciel P5.2; K11 ≥ 50 ms sym. A 10/10 → B 4/10 (plus kawałek TIMER 2/10). |
| (b) FCP/LCP ±0,02 s                                                                                                                                                        | **zaliczone co do intencji** | Dosłownie niespełnione wyłącznie po stronie poprawy: Δ median Lantern mobile FCP −0,028 s, LCP −0,044 s; desktop4x FCP −0,031 s, LCP −0,061 s. Żadna para nie jest istotna (\|t\| ≤ 1,08; MDE(t) 0,137 / 0,943 / 0,376 / 0,166 s), więc test nie ma mocy w skali 0,02 s. „Bez zmian” opiera się na strukturze: skrypty zakończone przed obs. LCP 508,1 KB (26) → 508,2 KB (25), bajty High przed obrazem LCP 620,1 → 620,5 KB, ten sam obraz LCP (`cover.jpg`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| (c) `observedSpeedIndex` mobile ≤ baza − 0,1 s ALBO baner w pierwszej klatce treści ALBO Lantern SI W1 + C3 ≤ W0 + C3 − 0,1 s                                              | **zaliczone**                | Wariant 1: 709 → 497 ms (próg ≤ 609 ms), pary −202,8 ms (σΔ 76,3, MDE(t) 127, t −5,94, p 0,004), każda para ≤ −134 ms, górna granica 95 % CI −108 ms. Wariant 2: pełny baner w pierwszej klatce treści w 2/5 przebiegów B (częściowa powłoka 2/5, brak 1/5; pełny baner 47–67 ms później); na A baner pojawia się w 2513–3195 ms. Wariant 3 spełniony tylko na medianach (2,215 → 1,892 s; pary −0,290 s, σΔ 0,253, p 0,063, 2/5 par nie osiąga −0,1 s).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| (d) CLS ≤ 0,001 i brak pojedynczego przesunięcia > 0,0005                                                                                                                  | **niezaliczone**             | **Nowe na W1 (P1.3), 3/20 przebiegów B, 0/20 A:** powłoka zgód `div[role=dialog][data-consent-shell]` – `lh-ab` B-mobile-1 0,06628 (`[12, 777, 388 × 34] → [12, 575, 388 × 236]`), B-mobile-2 0,03872 (`[12, 693, 388 × 118]` → ten sam), `lh-c3` B-desktop4x-5 karta `[936, 702, 380 × 218] → [936, 691, 380 × 230]` w zdarzeniu 0,01586 (ten sam zestaw węzłów bez karty daje 0,01127). **Istniejące na W0:** desktop4x w 10/10 przebiegów `lh-ab` po obu stronach (0,00608–0,01127) i w `lh-c3` (A 5/5, B 3/5): element wiersza nagłówka poszerza się z 136 do 402 px (x 1046 → 913), sekcja `…0029` przesuwa się o 42 px. Przesunięcie kolumny `…001b`: 0/20 przebiegów mobile. Mediana CLS mobile 0,000 po obu stronach.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| (e) `imgFetchpriorityHigh` ≤ 2 i element LCP = `img[data-lcp-candidate]` we wszystkich przebiegach                                                                         | **zaliczone**                | `imgFetchpriorityHigh` 1 (W0 9); element LCP `img.eh-img[data-lcp-candidate]` (`cover.jpg`) w 20/20 przebiegów B (`lh-ab` i `lh-c3`), 0/20 na A (atrybut wprowadza P1.4); w każdym z 40 śladów dokładnie jeden kandydat LCP typu obraz (68 121 px² mobile, 219 804 px² desktop).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| (f) sprzężenie C3 na drzewie W1, what-if `dropscripts-before-lcp`, tabela okna z właścicielami W2/W3, projekcja W2                                                         | **zmierzone**                | §5: sprzężenie, okno po C3, projekcja. Projekcja W2 TBT PSI mobile **615 ms > 340 ms ⇒ P3.3 i P3.4 MUST przed wdrożeniem**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 2.1 Rozbieżności rozstrzygnięte na danych surowych

- **(a) „zaliczone” (analiza metryk) wobec „częściowo” (weryfikacja):** rację ma weryfikacja. Kryterium obejmuje
  księgę „we wszystkich przebiegach”, a K13, K9b1 i K10 zostają w 10/10 B (`ledger/main-*.md`, przeliczenia stylu
  832/943 el. wobec 803/914 el. na A w śladach).
- **(b) „zaliczone co do intencji” (metryki) wobec „niejednoznaczne” (C3) wobec „dosłownie niespełnione” (weryfikacja):**
  jeden werdykt – dosłownie niespełnione wyłącznie po stronie poprawy, intencja (brak regresji) spełniona na podstawie
  niezmienionej struktury, nie statystyki.
- **(d) „powłoka nie przesuwa się w `lh-c3`”:** prawda tylko dla mobile. Sprawdziłem ślad `lh-c3/B-desktop4x-5`:
  zdarzenie `LayoutShift` 0,01586 zawiera węzeł karty `[936, 702, 380 × 218] → [936, 691, 380 × 230]` (dolna krawędź
  920 px = `sm:bottom-5` przy 940 px). Razem 3/20 B.
- **Flaga `had_recent_input = true` przy przesunięciach powłoki na mobile:** jedna weryfikacja uznała wpływ w terenie
  za niepewny, bo web-vitals pomija takie zdarzenia. Rację ma druga: `cumulative-layout-shift.js` Lighthouse'a liczy
  zdarzenia z tą flagą do 500 ms po zdarzeniu `viewport`, bo flagę ustawia emulacja rozmiaru okna. U użytkownika bez
  emulacji flaga ma wartość `false`, więc przesunięcie liczy się zawsze, gdy wystąpi; częstość w terenie zależy od
  miejsca, w którym parser odda wątek (niezmierzone).
- **DoD TBT „także bez gtag −57 % / −33 %”:** rację ma weryfikacja. Odjęcie blokowania Google od TBT strony A pomija
  skrócenie okna TTI po stronie B (`ledger/fullwindow.txt`); wskaźnik bez okna daje −35,6 % / −22,9 % (§4).
- **`check:bundle`:** „cacheBusting +1,46 KB (nowy)” to zmiana nazwy chunku-gospodarza `liveBlogs-*` (−1535 / +1491 B,
  netto −44 B, `bundle-analysis/stable-name-diff.txt`); entry rośnie o 213 B, a nie o 1,46 KB.
- **Wyciek modułu serwerowego na W0:** `serverOnlyLeaks` wskazuje `src/lib/builder/heroImage.ts` w
  `assets/index-Bf9uCWi0.js` (wywołanie w `aboveFold.tsx`); na W1 lista jest pusta.
- **MDE A/A:** „ok. 125 / ok. 448 ms” z POMIAR §7 to 2,776·σΔ/√5 (próg istotności), a nie MDE(t) harnessu; w tej
  definicji 168 / 600 ms. Werdyktów to nie zmienia.
- **Alternatywa `score.py` ≥ 87 w bramce W2:** wyniki 81,2 / 86,9 z analizy C3 liczą TBT fixture bez przełożenia przez
  k; po przełożeniu wynik zależy od przyjętych FCP/LCP (§5.3). Plik `whatif/w2proj-summary.txt` mnoży wiersze
  desktop4x przez 0,72 zamiast 0,42 – w tym raporcie i w `W1-wyniki.json` poprawione.

## 3. Bramki repo na W1 (`45eb5747c`)

| Bramka                                                        | W1                 | W0 (`ff719b9a6`) | Uwagi                                                                                                                          |
| ------------------------------------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `build:smoke` (`BUNDLE_INVENTORY=1`)                          | zielone            | zielone          | 3 min 1 s (W0 2 min 42 s); te same ostrzeżenia co na W0                                                                        |
| `typecheck` (tsc + scripts)                                   | zielone            | –                | dodatkowo, na checkout PR                                                                                                      |
| `check:bundle`                                                | **czerwone**       | czerwone         | overall 4784,6 → 4791,2 KB (+6781 B gzip), przekroczenie 4772 KB rośnie z 12,6 do 19,2 KB; pozostałe budżety zielone (§6)      |
| `check:chunks`                                                | zielone            | zielone          | 889 chunków / 6910 krawędzi (W0 887 / 6961), acykliczny                                                                        |
| `check:entry-purity`                                          | zielone            | zielone          | 9 chunków statycznie osiągalnych z bootu po obu stronach                                                                       |
| `check:server-entry-purity`                                   | zielone            | zielone          | 1813 plików (W0 1791); dług zamrożony bez zmian                                                                                |
| `check:document-weight`                                       | zielone (25/25)    | czerwone         | W0: 4 metryki modulepreload (§6)                                                                                               |
| `test:e2e:artifact`                                           | zielone (8/8)      | –                | React #418 w logu pochodzi z kontroli negatywnej                                                                               |
| e2e-performance `third-party-quiescence` (P1.1)               | zielone (4/4)      | –                |                                                                                                                                |
| e2e-performance `consent-shell-geometry` (P1.3)               | zielone (6/6)      | –                | 412×823 i 1350×940, cookie decyzji, klik przed hydratacją, bez JS, GPC                                                         |
| e2e-performance `on-demand-overlays` (P1.3)                   | zielone (1/1)      | –                |                                                                                                                                |
| e2e-performance `popup-first-render`                          | **czerwone (0/2)** | czerwone (0/2)   | ta sama asercja („popup content chunk requested”), spec bez zmian między drzewami                                              |
| `verify:static` bez `format:check` (`KEEP_GOING=1`)           | 32/33              | –                | czerwone tylko `check:i18n-overlay-imports` (`ChatComposer.tsx` 25 → 28); wejścia identyczne z W0, więc czerwone też na `main` |
| `format:check`                                                | czerwone (19)      | czerwone (22)    | lista W1 jest podzbiorem listy W0; `styles.css` bez nowej niezgodnej linii                                                     |
| `check:on-conflict-arbiters`, `check:authz-snapshot`          | zielone            | –                |                                                                                                                                |
| lint, vitest, progi pokrycia                                  | niezmierzone       | –                | nie uruchomione na `45eb5747c` (vitest 437 plików tylko na scalonej głowie)                                                    |
| e2e `popup-registration` (plik P1.3), e2e `user-paths` (P1.7) | niezmierzone       | –                | `user-paths` wymaga stagingu z auth (P1.7 REVIEW-9 D-4)                                                                        |

Żadna bramka nie jest czerwona na W1 i zielona na W0. Wyjątkiem co do wielkości jest `check:bundle`: czerwony po obu
stronach, ale fala go pogarsza (§6).

## 4. Definition of Done fali 1

| Warunek DoD                                                                                     | Werdykt       | Dowód                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TBT fixture z flagami: mobile 356 → 218–258 ms, desktop4x 444 → 393–411 ms (od zmierzonej bazy) | spełnione     | Cel przeniesiony na bazę A: mobile 737–872 ms, desktop4x 1752–1832 ms. Zmierzone: mobile 1203 → 374 ms (−68,9 %), desktop4x 1978,9 → 1037,0 ms (−47,6 %). Bez udziału P1.1 (wskaźnik bez okna TTI: blokowanie w [FCP_sim, koniec śladu] bez zadań Google): mobile 914 → 589 ms (−35,6 %, w paśmie −28…−39 %), desktop4x 1547 → 1192 ms (−22,9 %); obie średnie par nieistotne (mobile −237 ms, σΔ 236, MDE(t) 393; desktop4x −338 ms, σΔ 618, MDE(t) 1027). Większość zysku TBT fali to P1.1 (zadania gtag i krótsze okno TTI). |
| FCP/LCP bez zmian                                                                               | spełnione     | jak (b): struktura bez zmian, różnice median na korzyść i w szumie                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Prognoza PSI mobile 64–68, desktop 77–79                                                        | częściowo     | Prognoza punktowa mobile **63–67**, desktop **77–79** (`narzedzia/score.py`, FCP/LCP/CLS z PSI 2026-10-03). F1 = k(POMIAR §7) × mediana B: mobile 0,72 × 374 = 269 ms → 62,70 (SI 4,9 s) / 63,90 (SI 4,2 s); desktop 0,42 × 1037 = 435,5 ms → 77,30 / 77,50. F2 = TBT PSI W0 × B/A: mobile 600 × 374/1203 = 187 ms → 65,40 / 66,60; desktop 740 × 1037/1978,9 = 388 ms → 79,10 / 79,30. Rozrzut przebiegów: mobile 58,5–67,5, desktop 70,7–85,6. Dolny skraj mobile o 1 pkt poniżej planu.                                      |
| Wszystkie bramki repo zielone poza `check:bundle` wyłącznie w zakresie znanym z `main`          | niespełnione  | `check:bundle` gorszy o 6781 B gzip niż na `main`; `format:check`, `check:i18n-overlay-imports`, `popup-first-render` czerwone (także na `main`); lint, vitest i pokrycie niezmierzone na `45eb5747c`. Przyjęcie czerwieni z `main` to decyzja orkiestratora.                                                                                                                                                                                                                                                                   |
| **DoD łącznie**                                                                                 | **częściowo** |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Po fali 1 mobile traci w prognozie najwięcej na LCP 6,6 s (ok. 23 pkt), czyli zakres P2.1. Linie `K` harnessu w trybie
A/B (0,50 / 0,37) liczą k ze strony A tej serii i nie są kalibracją.

## 5. Sprzężenie C3 i konsekwencja dla fal 2 i 3

### 5.1 Sprzężenie (TBT Lantern, ms)

| Drzewo, forma | bez C3 (`lh-ab`) | + C3 żywo (`lh-c3`) | różnica żywo¹ | + C3 deterministycznie | sprzężenie det., mediana par (zakres) |
| ------------- | ---------------: | ------------------: | ------------: | ---------------------: | ------------------------------------: |
| W0 mobile     |             1203 |                1846 |          +643 |                   2056 |                       +824 (652–1087) |
| W1 mobile     |              374 |                1288 |          +914 |                   1062 |                        +647 (507–733) |
| W0 desktop4x  |           1978,9 |              2334,5 |          +356 |                   2109 |                        +205 (130–394) |
| W1 desktop4x  |           1037,0 |              1113,5 |           +76 |                   1179 |                         +218 (84–383) |

¹ Różnica median dwóch serii zebranych o różnym czasie (atrapa gtag ×2,85 w `lh-ab`, ×2,54 w `lh-c3`; dotyczy tylko
W0), więc tylko kierunek.

- Względem bazy sprzężenie W0 mobile (+68 %, mediana par) zgadza się z P0.5 (+72 %, 214 → 402 ms); bezwzględnie jest
  ok. 5 razy większe (pełne flagi P0.1, atrapa gtag, przeplot). Na W1 sprzężenie przewyższa resztę TBT (+173 %).
- Fala 1 zdjęła zadania, które i tak leżały w oknie (gtag, BRAND, K8a/K8b, K9, część K12: blokowanie 197 → 46 ms
  mobile). Nie dotknęła zadań, które C3 wciąga do okna: K7, K16, K6/K5/K4 i późne K14.
- W1 + C3 wobec W0 + C3 (pary, `lh-c3`): TBT mobile 1846 → 1288 ms (−748 ms, σΔ 300, MDE(t) 499), desktop4x
  2334,5 → 1113,5 ms (−1062 ms, σΔ 328,5, MDE(t) 546); FCP i LCP w ±0,024 s; SI mobile 2,215 → 1,892 s.
- Żywo W1 mobile sprzęga mocniej niż what-if (1288 wobec 1062 ms), ale to porównanie między seriami bez par (Welch
  p ok. 0,26), więc wielkość niewykazana; kierunek wspiera tylko klasa K- (zadania kompozytora przed bootem): 145 ms
  żywo wobec 0 ms w what-if.
- Granice rekonstrukcji C3: transformacja z repo (`7b3a4c7dd`) zamiast pliku z planu, którego w sesji nie ma; zapas
  `load` + `setTimeout(0)` jest uzbrojony przed LCP w 20/20 przebiegów, a timer bootu zainstalowany przed kandydatem
  LCP w 8/20 (3/5 B mobile). P2.1 planuje `load` + 500 ms. Mobile jest `bez-js` w 10/10 przebiegów, więc rekonstrukcja
  mobile się trzyma; na desktop4x 2/5 par jest mieszanych.

### 5.2 Okno po C3 (W1 + C3 żywo; blokowanie klasy w przebiegu, mediana z 5)

| Klasa   | mobile [ms] (zakres) | n ≥ 50 ms sym. | desktop4x [ms] | Właściciel                                       |
| ------- | -------------------: | -------------- | -------------: | ------------------------------------------------ |
| K16     |        229 (152–272) | 5/5            |              – | P2.4 + P2.2                                      |
| K14     |        187 (136–263) | 5/5            |            230 | P2.2                                             |
| K7      |        156 (139–238) | 5/5            |            191 | **P3.4**                                         |
| K-      |          145 (5–266) | 5/5            |             28 | brak (kandydaci P3.1, P2.4 g)                    |
| K15     |         108 (71–179) | 5/5            |              – | P2.4                                             |
| K6      |           82 (0–140) | 4/5            |             97 | P2.2 + **P3.3**                                  |
| K13     |          64 (47–134) | 5/5            |             86 | P1.2 F2 (zostaje na fixture), bez właściciela W2 |
| K9b1    |            48 (6–73) | 5/5            |             29 | P5.2                                             |
| K12     |           46 (34–66) | 5/5            |             78 | P2.2                                             |
| K10     |            30 (8–51) | 5/5            |             22 | P5.2                                             |
| K5      |            0 (0–165) | 5/5            |             53 | P2.4 + P2.6, warunkowo P3.3                      |
| C3BOOT  |             2 (0–45) | 3/5            |             44 | P2.1 (koszt własnego loadera)                    |
| **TBT** |             **1288** |                |     **1113,5** |                                                  |

Podział według właścicieli (mobile żywo): pozycje W2 727 ms, P3.4 156 ms, P5.x 106 ms, K13 64 ms, bez właściciela
(K-) 145 ms. Desktop4x żywo: W2 586, P3.4 191, K13 86, P5.x 75, C3BOOT 44, bez właściciela 38 ms. Pełne tabele:
`$SCRATCH/phase2/wave1/gate/whatif/c3-table-{mobile,desktop4x}.md`.

### 5.3 Projekcja W2 i decyzja

Metoda P0.5 §4.1 (`wave.py`): zadania klas skracane współczynnikami, Lantern liczony od nowa, potem × k (mobile 0,72,
desktop4x 0,42; POMIAR §7).

| Baza           | Wariant         | TBT fixture, przebiegi 1–5 [ms]      |   Mediana | TBT PSI mobile (× 0,72) |
| -------------- | --------------- | ------------------------------------ | --------: | ----------------------: |
| żywo (`lh-c3`) | W1 + C3         | 788 / 1120 / 1462 / 1288 / 1350      |      1288 |                     927 |
| żywo           | **W2 ×0,5**     | 473 / 675 / 854 / 864 / 956          |   **854** |                 **615** |
| żywo           | W2 PLAN-FALE §1 | 354 / 491 / 705 / 743 / 770          |       705 |                     508 |
| żywo           | W2 pełne        | 330 / 464 / 663 / 711 / 737          |       663 |                     477 |
| żywo           | W3 ×0,5 / pełne | –                                    | 788 / 533 |               567 / 384 |
| det. (what-if) | W1 + C3         | 791,5 / 1062 / 1204,5 / 883 / 1193,9 |      1062 |                     765 |
| det.           | W2 ×0,5         | 543 / 706 / 771 / 596 / 763          |       706 |                     508 |
| det.           | W2 PLAN-FALE §1 | 367 / 525 / 576 / 452 / 556          |       525 |                     378 |
| det.           | W2 pełne        | 301 / 420 / 548 / 433 / 496          |       433 |                     312 |
| det.           | W3 ×0,5 / pełne | –                                    | 643 / 366 |               463 / 263 |

Desktop4x (× 0,42): żywo W1 + C3 1113,5 → 468 ms, W2 ×0,5 754 → 317, W2 §1 607 → 255, W2 pełne 602 → 253, W3 pełne
445 → 187; det. 1179 → 495, 793 → 333, 658 → 276, 597 → 251, 469 → 197.

**Decyzja (f): projekcja W2 TBT PSI mobile wynosi 615 ms, więcej niż 340 ms, więc P3.3 i P3.4 stają się MUST przed
wdrożeniem.**

- Próg przekracza 5 z 6 kombinacji baz i wariantów W2; poniżej jest tylko najbardziej optymistyczna (det., pełne
  szacunki, 312 ms).
- Przy regule planu ×0,5 każdy z 5 przebiegów na obu bazach jest powyżej progu (minimum żywo 473 × 0,72 = 340,6 ms,
  det. 543 × 0,72 = 391 ms); mediana zostaje nad progiem przy k od 0,50 do 0,72 i po korekcie przeplotu ×0,81 (ok.
  498 ms żywo, 411 ms det.).
- Warunki własne pozycji już są spełnione na W1 + C3: P3.4 – K7 `ScriptCatchup` w oknie w 5/5 przebiegów mobile i
  desktop4x (sym. 56–288 ms); P3.3 – K6 w oknie w 4/5 przebiegów mobile (sym. 114–190 ms, ≥ 50 ms także po ×0,6).
- Bramka fixture W2 (≤ 200 ms mobile, ≤ 150 ms desktop4x) jest na tym hoście daleko: W2 pełne daje 433–663 ms mobile i
  597–602 ms desktop4x. Alternatywa `score.py` ≥ 87 po przełożeniu TBT przez k: z FCP/LCP/SI fixture żywo 82,15 (×0,5)
  / 84,85 (§1) / 85,75 (pełne), det. 84,6 / 88,5 / 90,6; z FCP/LCP/SI bliższymi PSI (1,8 / 2,85 / 3,8 s) maksimum
  86,0. To rozstrzygnie bramka W2 na zmierzonym drzewie.
- Zastrzeżenia: k skalibrowano na serii pojedynczej W1-bazy (832 ms, atrapa ×2,29), a obie serie bramki mają przeplot
  (A/A 1007–1032 ms); dokument PSI ma 569 KB wobec 401 KB na fixture; K13 i K- nie mają właściciela W2, więc nie są
  skracane; warunek P3.3 po W2 jest potwierdzony arytmetyką, nie pomiarem drzewa W2.

## 6. Bundle i waga dokumentu

### 6.1 `check:bundle` (host; runner niezmierzony)

| Liczba                       | W0 `ff719b9a6`         | W1 `45eb5747c`          | Różnica        | Próg                |
| ---------------------------- | ---------------------- | ----------------------- | -------------- | ------------------- |
| pliki JS                     | 889                    | 891                     | +2             | –                   |
| overall                      | 4784,6 KB              | 4791,2 KB               | +6,6 KB        | 4772 (oba czerwone) |
| public                       | 2731,3 KB              | 2842,3 KB               | +111,0 KB      | 2877                |
| admin-only                   | 2053,3 KB (304 chunki) | 1948,9 KB (299 chunków) | −104,4 KB      | –                   |
| największy chunk (`index-*`) | 254,3 KB               | 254,5 KB                | +0,2 KB        | 286                 |
| CSS / public CSS             | 95,1 / 80,9 KB         | 95,3 / 81,1 KB          | +0,2 / +0,2 KB | 96 / 83             |
| boot gzip / raw              | 476,9 / 1568,9 KB      | 477,1 / 1570,3 KB       | +0,2 / +1,4 KB | 579 (gzip)          |

- **Skąd +6781 B gzip** (suma grup do bajta, `bundle-analysis/final-attribution.txt`): `gtagLoadPolicy-*` +3633 (nowy,
  leniwy: polityka P1.1 razem z prymitywami P0.3, wspólny z P1.3), `consentInitScript-*` +1140 (P1.3),
  `ConsentBanner-*` +1070 (P1.3), drobne P1.3 +62 (`NewsletterPopup` +88, `useInFeedAds` +18, `cacheBusting` /
  `liveBlogs` −44), leniwe chunki P1.4 +624 (`sliderVariants` +470 i inne), chunk wejściowy +213 (cały przyrost
  bootu), przetasowanie Rollupa i kaskada hashy +39. CSS +244 B gzip (`styles-*.css`: klasy karty zgód P1.3 i reguły
  P1.2). P1.0b i P1.6 nie wnoszą nic do bundla klienta.
- **Public +111,0 KB to w 104,4 KB przeklasyfikowanie, nie nowe bajty:** `icons-0..3` (105 779 B, te same pliki i
  hashe) i `window` (1123 B) przeszły z admin-only do public, bo leniwy loader ikon (mniejszy niż
  `experimentalMinChunkSize` 2048) Rollup dokleił na W0 do `admin.settings-*`, a na W1 do `newsletter.confirm-*`.
  Bez przeklasyfikowań public rośnie o 6783 B. Skutek uboczny: publiczny `DynamicIcon` pobiera chunk cudzej trasy.
- Suma raportów pozycji (+11,1 KB, każda wobec własnej bazy) jest wyższa od pomiaru scalonego drzewa (+6,6 KB), bo
  prymitywy P0.3 liczyły się w P1.1 i w P1.3. Dokument wdrożeniowy (P6.2) cytuje liczbę scalonego drzewa.
- **Werdykt:** czerwony na `main` i gorszy na W1 o 6,6 KB; reguła planu „`check:bundle` nie gorzej niż baza” (§2.3
  pkt 4, §4) i założenie D10 („plan nie pogarsza OVERALL”) nie są dotrzymane. Progów nie ruszono; kronika budżetu ma
  wpis XXIII (`scripts/check-bundle-size.ts`, sam komentarz). Próg OVERALL ustali P6.1 z pierwszego zielonego logu
  runnera.
- Najciaśniejszy budżet po fali: CSS 95,3 / 96 KB (zapas 0,68 KB, 0,71 %); public CSS zapas 1,9 KB. Bramka P2.4 w
  `PLAN.json` zakłada ok. 3 KB zapasu, co jest nieaktualne.

### 6.2 `check:document-weight`

Decyzja właściciela (commit `e420a58d0`): pięć progów podniesionych **dokładnie** o przyrost powłoki zgód P1.3
zmierzony na artefakcie `20bbdab73` wobec bazy `135e5cec3`: `htmlRawBytes` 398 937 → 406 180 (+7 243),
`htmlGzipBytes` 55 565 → 57 710 (+2 145), `headRawBytes` 24 601 → 26 625 (+2 024), `inlineScriptBytes` 96 117 →
98 103 i `inlineExecutableScriptBytes` 89 739 → 91 725 (+1 986). Uzasadnienie: zysk `observedSpeedIndex` mobile
−218 ms; odrzucone alternatywy w kronice pliku progów.

| Metryka                       |     W0 |     W1 | Różnica |   Próg | Zapas W1 |
| ----------------------------- | -----: | -----: | ------: | -----: | -------: |
| `htmlRawBytes`                | 393695 | 400753 |   +7058 | 406180 |     5427 |
| `htmlGzipBytes`               |  54719 |  56798 |   +2079 |  57710 |      912 |
| `headRawBytes`                |  24117 |  25860 |   +1743 |  26625 |      765 |
| `inlineScriptBytes`           |  94274 |  96203 |   +1929 |  98103 |     1900 |
| `inlineExecutableScriptBytes` |  88021 |  89950 |   +1929 |  91725 |     1775 |
| `modulepreloadCount`          |     26 |     25 |      −1 |     25 |        0 |
| `linkHeaderEntries`           |     32 |     31 |      −1 |     31 |        0 |
| `preloadDuplicates`           |     23 |     21 |      −2 |     22 |        1 |
| `preloadedJsCount`            |     26 |     25 |      −1 |     25 |        0 |
| `imgFetchpriorityHigh`        |      9 |      1 |      −8 |      2 |        1 |
| `bootClosureGzipBytes`        | 485021 | 485273 |    +252 | 494985 |     9712 |
| `preloadedJsGzipBytes`        | 563556 | 563369 |    −187 | 572985 |     9616 |
| `renderBlockingCssGzipBytes`  |  80077 |  80313 |    +236 |  81399 |     1086 |
| `preLcpTransferBytes`         | 743085 | 745212 |   +2127 | 756230 |    11018 |

- W1: **25/25 metryk zielonych**; każdy przyrost mieści się w podniesieniu z `e420a58d0` (+7058 < 7243, +2079 < 2145,
  +1743 < 2024, +1929 < 1986). Nowe metryki P1.4 na W1: `lcpCandidateCount` 1, `lcpCandidateMissing` 0,
  `imgEagerNonCandidate` 0, `imagePreloadNonCandidate` 0, `linkHeaderDisallowed` 0 (W0 skryptem W1: 0 / 1 / 8 / 3 / 1).
- W0 czerwony w 4 metrykach modulepreload (zbłąkany `spreadsheetWorker` w manifeście trasy `/`); na W1 zielone (P1.4).
- `preLcpTransferBytes` +2127 B = HTML gzip +2078 (W0 54 720 B w pomiarze skryptem W1) + CSS +236 − JS 187, czyli
  koszt powłoki P1.3.
- Wartość W0 pochodzi z bramki bazy (`base/w1gate-docweight.log`); metryki P1.4 i `preLcpTransferBytes` dla W0
  zmierzono skryptem W1 (`document-weight-base-w1script.json`).

## 7. Przekazanie do fali 2 i dalej

Przeniesione z pozycji fali 1:

1. **I2 – stabilność kontekstu rozruchu gościa → P2.2.** `useAuth.tsx` (z `authHydration.test.tsx`) przeszedł z P1.7 do
   P2.2 (`92887a899`). Wraca wyłącznie razem z wyspami obejmującymi granice i z pomiarem zadań po commicie hydratacji;
   test akceptacyjny: `raporty/P1.7-i2-island-experiment.test.tsx.txt`.
2. **K9b1 (drzewo tras) i K10 (`createRouter`) → P5.2.** Oba ≥ 50 ms sym. w 10/10 przebiegów B (K9b1 78–130, K10
   64–108 ms sym.); przyczyny w pliku generowanym i router-core, poza plikami P1.7.
3. **e2e `user-paths` ze stagingiem (P1.7 REVIEW-9 D-4) nie uruchomione.** Zalogowany reload z rolami, magic-link,
   cross-tab: przed wydaniem gałęzi PR w CI ze stagingiem albo jako zapisane ryzyko.
4. **e2e-performance `popup-first-render` czerwone na W0 i W1** (0/2, ta sama asercja „popup content chunk
   requested”); do przypisania.
5. **Przesunięcie kolumny `data-col-id …001b` na mobile.** P1.3-PROVE-2: A 1/10, B 2/10 (0,401 i 0,406); w bramce
   0/20 przebiegów mobile – nieobecność w tej bramce nie dowodzi naprawy. Osobna pozycja przed bramką W2.
6. **Obserwacja TBT mobile z dowodu P1.3** (+96 / +113 ms, n = 10 razem +105 ms przy MDE(t) 103). Na scalonym drzewie
   okno ≥ 800 ms po starcie K12 jest krótsze niż na W0 (mobile średnio −81 ms obs), bo P1.2 zdejmuje tam −146 ms, a
   sam P1.3 dokłada ok. +76 ms; nadwyżka P1.3 jest prawdopodobnie zamaskowana i bez profilera nierozdzielna. Do
   pomiaru w P2.2.
7. **`playwright.performance.config.ts` bez domyślnej ścieżki lokalnego Chromium.** Spece e2e-performance trzeba
   uruchamiać z `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

Nowe z tej bramki:

8. **Przesunięcie powłoki zgód P1.3 (kryterium (d), 3/20 przebiegów B).** Powłoka (5163 B, `fixed`, `bottom-3`) leży w
   dokumencie za stopką (offset 205 444 z 400 753 B, w jednej linii o długości 96 818 B). Gdy parser odda wątek w jej
   środku, pierwsza klatka maluje uciętą kartę, a dopisanie reszty przesuwa górną krawędź w górę. Bramka W2 wymaga
   CLS ≤ 0,001, więc potrzebna jest poprawka plików P1.3 (decyzja orkiestratora o właścicielu): stała wysokość lub
   `min-height` karty, kotwica od góry albo odsłonięcie powłoki dopiero po jej zamknięciu (atrybut ustawiany skryptem
   tuż za powłoką, co wymaga wpisu w `dangerousHtmlAllowlist`). Koszt: CLS 0,066 to ok. −0,75 pkt w przebiegu.
9. **CLS desktop nagłówka i sekcji `…0029`** (0,006–0,011, istniejące na W0, także w `lh-c3`): element wiersza
   nagłówka 136 → 402 px szerokości. Bramka W2 wymaga CLS ≤ 0,001; kandydat na właściciela P2.3 (`Header.tsx`), do
   decyzji.
10. **K13 zostaje na fixture** (domyślna `--sticky-header-h` 123 px ≠ 107 px zmierzone na fixture, desktop bez
    domyślnej). Decyzja: wyrównanie fixture (P0.1) albo domyślna desktopowa; ślad K13b (`invalidationTracking`) na W1
    nie był powtórzony (otwarte z PLAN-FALE §6).
11. **Plastry Reacta K14 zaraz po commicie przeniesione z K12 przez P1.2** (1–4 plastry ≥ 50 ms sym. w 0–300 ms po
    K12 w 10/10 B, K12 krótszy o 28–123 ms obs). Dla P2.2 cel „K12” jest dziś rozłożony na K12 i wczesne K14.
12. **Efekt okna TTI.** Bez gtag TTI_sim mobile spada z ok. 10,3 do 5,5 s (wariant opt), więc późne zadania aplikacji
    liczą się tylko w połowie. Każde nowe długie zadanie po ok. 5,5 s sym. wciągnie K14/K15 z powrotem do okna.
13. **Bez właściciela:** Kmod (ewaluacja modułów leniwych chunków, do 88 ms sym.) i K- (kompozytor przed bootem w C3,
    145 ms mobile). Propozycje: P5.1/P5.2, P3.1, P2.4 (g).
14. **Obserwowane FCP** +40 ms mobile i +71 ms desktop na medianach; po połączeniu obu serii desktop4x +72 ms (95 % CI
    +1…+143 ms). Lantern FCP bez zmian; ważne dla wyzwalacza P2.1 z obserwowanego LCP.
15. **Scalona głowa PR (od `61b6e7f43`) bez bramek artefaktu i Lighthouse.** Powtórzyć co najmniej
    `build:smoke`, `check:bundle`, `check:document-weight` i e2e artefaktu – po naprawie `/dev/null`. PR #475 usunął
    testy uprzęży pomiarowej (`harness-ext.test.mjs`, `document-weight.test.mjs`, `psi-sample.test.mjs`) i skrypt
    `test:measurement-harness`, więc zmiany w `lighthouse-local.mjs`, `lanternTasks.ts` i `check-document-weight.ts`
    w fali 2 nie mają już kontroli negatywnych w repo; decyzja orkiestratora, czy je przywrócić.
16. **Incydent `/dev/null`** (§0): naprawa przez człowieka przed kolejnym krokiem ciężkim.
17. **`check:bundle` overall +6,6 KB.** P6.1 ustali próg z runnera; P2.1 (właściciel `vite.config.ts` i
    `vite.smoke.config.ts`) przypina loader ikon (`lazyNamedIcon.ts`, `DynamicIconChunk.tsx`, `iconChunkIndex.js`) do
    stałej nazwy w `manualChunks` obu presetów osobnym, zmierzonym commitem; ogólnie przyczynę usuwa P9.1 (C10).
18. **Zapasy:** CSS 0,68 KB (P2.4 i P2.6 mierzą CSS przed scaleniem), `htmlGzipBytes` 912 B i `headRawBytes` 765 B
    (P2.1 dokłada `#nes-boot-set` i loader bootu do `<head>`).
19. **Reżim refetchu postów klienta:** w części przebiegów klient wysyła w oknie Lighthouse 8 dodatkowych
    `GET /rest/v1/posts` (`lh-ab`: A 1/10, B 3/10; `lh-c3`: 3/10 i 3/10); w 5 z 10 takich przebiegów TBT jest
    maksimum grupy. Harness tego nie wykrywa ani nie paruje (kandydat na poprawkę P0.1).
20. **Nakładki `NewsletterPopup`/`PopupHost`** nadal pobierane w 1,9–2,8 s w 10/10 przebiegów B (TP-4 celowo bez
    zmian w P1.3); z nakładek poza okno wyszedł tylko interaktywny baner.
21. **Licznik gtag harnessu:** w B-desktop4x-4 harness zliczył 1 skrypt i 6 pingów, ale w śladzie i devtoolsLog nie ma
    żadnego żądania Google – padły poza oknem nagrania.
22. **Niezmierzone w bramce:** realne PSI (JSON-y PSI z D13, rekalibracja k), linia bazowa `page_view` z RUM
    (kryterium wycofania P1.1), forma desktop x5, `check:bundle` na runnerze, lint, vitest i pokrycie na
    `45eb5747c`, e2e `popup-registration`.

## 8. Pliki i dane

- Liczby maszynowo: `raporty/W1-wyniki.json`. Komendy i ważność serii: `POMIAR.md` §8. Kronika budżetu:
  `scripts/check-bundle-size.ts`, wpis XXIII.
- Dane robocze bramki (`$SCRATCH/phase2/wave1/gate/`): `ab.log`, `lh-ab/` (LHR, ślady, devtoolsLogi, księgi,
  `summary.json`), `c3.log`, `lh-c3/` (bez `summary.json`), `metrics/` (tabele per przebieg, filmstrip, kandydat LCP),
  `ledger/` (księga per zadanie, klasy K, wskaźnik bez okna), `whatif/` (what-if C3, okno po C3, projekcja W2),
  `bundle-analysis/` (atrybucja bundla per wiadro i moduł), `verify-stats.md` i `verify-attr/` (weryfikacje),
  `gate-*.log`, `document-weight-*.json`, `bundle-delta.txt`.

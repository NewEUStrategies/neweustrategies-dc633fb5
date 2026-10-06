# Weryfikacja bramki W2 – soczewka: atrybucja i kompletność

Weryfikator niezależny, 2026-10-06. Przedmiot: `$G/ANALIZA.md`, `$G/W2-wyniki.json` (bez zmian w nich).
`$G` = `/tmp/claude-0/-home-user-neweustrategies-dc633fb5/57088803-e7ea-5e89-8c05-954276daf4ba/scratchpad/phase2/wave2/gate`,
`$W` = `$G/weryfikacja-atrybucja`.

## Metoda (niezależna od `$G/analiza/`)

- **Własne księgi** `lanternTasks.ts --min 0 --json` dla wszystkich 60 przebiegów (oba ramiona, A i B, 3 formy × 5),
  uruchomione z drzewa `gate-w2` przez `light.sh` → `$W/ledger/<ramię>-<przebieg>.{json,txt}`. Suma księgi = audyt
  TBT `OK (±1 ms)` w 60/60 (`$W/ledger/*.txt`).
- **`$W/verify.py`** → `$W/verify.json`: z LHR (`$G/lh-*/X.json`), devtoolsLog i śladu (`X.artifacts/`) oraz z
  własnych ksiąg liczy (b) skrypty zakończone przed `observedLargestContentfulPaintTs` (typ `Script` albo `.js`,
  `loadingFinished`/`loadingFailed`, bajty `encodedDataLength`) i start pierwszego `/assets/*.js`; (e) każde zadanie
  ≥ 50 ms sym. klasy `ParseHTML` albo `Script:(dokument)`, a szerzej także każde zadanie, którego dominujący skrypt
  ma URL dokumentu albo z domieszką ParseHTML; nakładanie na okno pesymistyczne [FCP_opt, TTI_pes], na okno audytu
  [FCP, TTI] i wariant „start w oknie”; (f) wszystkie zdarzenia `LayoutShift` w śladzie oraz pozycje audytu
  `layout-shifts`.
- `$W/children.py`: dzieci zadań ze śladu (np. `FunctionCall` `Y` w linii 201, `TimerFire`, `$RV`).
- Nie czytałem `$G/analiza/*` do liczenia; `results.json`/`scan.json` tylko do porównania klasyfikacji K.

## Potwierdzone

**(b) `scriptBytesEndedBeforeObsLcp` = 0 i seria bootu po obs. LCP – ZALICZONE w 30/30 przebiegach B (15/15 na
ramię).** Źródło `$W/verify.json` (`b`) i `harnessSB` z własnych ksiąg.

- B: 0 skryptów / 0 B zakończonych przed obs. LCP w 30/30, zarówno w devtoolsLog, jak i w `lanternTasks`;
  `/~flock.js` przed obs. LCP 0/30; skrypty inicjowane parserem 0; pierwszy skrypt strony zawsze
  `/assets/index-fO-Yix7R.js`.
- Start serii bootu − obs. LCP (ms): browser mobile +58,9 / +64,8 / +61,3 / +62,0 / +55,8; d4 +59,3 / +66,0 / +53,8 /
  +57,0 / +52,3; d5 +55,9 / +63,3 / +58,9 / +52,5 / +54,3; bot mobile +54,9 / +63,5 / +71,0 / +60,8 / +57,3; d4 +54,6 /
  +57,6 / +84,3 / +52,6 / +55,3; d5 +53,8 / +58,1 / +55,6 / +54,9 / +55,3. Zakresy +52,3…+66,0 (browser) i
  +52,6…+84,3 (bot) zgadzają się z ANALIZA §2.2 („+52…+66”, „+53…+84”).
- A: 25 skryptów / 520 692 B w 30/30; start serii −387,1…−190,9 ms (browser), −377,5…−199,7 ms (bot) – zgodne.
- Element LCP `img[data-lcp-candidate]` (`/cover.jpg`) w 60/60 (`lcp-breakdown-insight`).

**(e) ParseHTML / inline skrypt dokumentu ≥ 50 ms sym. w [FCP, TTI] – NIEZALICZONE w obu ramionach.**

- Lista zadań ścisłych (`ParseHTML` + `Script:(dokument)`) jest identyczna z tabelą ANALIZA §2.5: 23 zadania w
  browser i 21 w bot, wiersz w wiersz (obs. start/czas, sym. start+czas, blokowanie opt/pes/śr.).
- Liczba przebiegów B z zadaniem: browser mobile 1/5 (B-mobile-3), d4 5/5, d5 5/5 = 11/15; bot mobile 1/5
  (B-mobile-4), d4 3/5 (B-desktop4x-2, -3, -4), d5 5/5 = 9/15. Z blokowaniem > 0: 11/15 i 8/15 (bot B-desktop4x-2:
  ParseHTML 511+82 ms przy FCP_opt 565 ms → 28 ms w oknie, blokowanie 0). Maks. 120 / 153 ms sym., blokowanie do
  66 / 103 ms. Wszystko zgodne.
- Wynik nie zależy od definicji okna: okno pesymistyczne i okno audytu [FCP, TTI] dają te same liczby; przy wariancie
  „zadanie musi zacząć się w oknie” bot d4 spada do 2/5 (B-desktop4x-3 ParseHTML 449 ms < FCP 454 ms), werdykt
  ten sam.
- A (W1): browser 1/5, 1/5, 4/5; bot 0/5, 1/5, 4/5 – zgodne z §2.5.
- Handler DCL loadera (`FunctionCall` `Y`, linia 201): osobne zadanie `Script:(dokument)` w 9/15 B browser i 8/15
  bot (17 łącznie), w 2 z nich 43 ms sym. (bot B-desktop4x-2, B-mobile-3); na mobile przed FCP_sim (0 blokowania);
  przykład bot B-desktop5x-5: Layout 699 obiektów – zgodne.

**(f) CLS ≤ 0,001, brak przesunięcia > 0,0005 – ZALICZONE w 30/30 B.** 0 zdarzeń `LayoutShift` w śladzie (wszystkie
ramki), 0 pozycji audytu, CLS 0 we wszystkich 30 przebiegach B. A: browser A-mobile-5 0,4014
(`div[data-column-slot][data-col-id=…001b]`, `had_recent_input = true`, 232,7 ms), A-desktop4x-3 0,0061,
A-desktop5x-3 0,0061, A-desktop5x-5 0,0016 (`section[data-sec-id=…0029]`, przyczyna według LH: „Media element
lacking an explicit size” – `img` `cover.jpg` z `loading="lazy"`), A-desktop5x-2 0,0113 (bez węzła w audycie);
bot A-mobile-4 0,0006 (`div.flex.items-center.gap-1`, `had_recent_input = true`) – zgodne z §2.6.

**Kompletność obu ramion.** Kryteria (a)–(f) i każdy punkt DoD (TBT w kombinacji, FCP, LCP, PSI mobile, PSI
desktop, warunek wdrożenia) są ocenione osobno dla `--warm-ua browser` i `--warm-ua bot` (ANALIZA §0, §2, §6;
`W2-wyniki.json` `criteria[*].browser/bot`, `dod`); (g) z definicji tylko bot. Seria była z flagami
`client-backend=fixture,third-party=fake-gtag` w obu ramionach (`summary.json` `flags`). Wartości (a) per przebieg
odtworzone z LHR (np. browser B-mobile-3 LCP 2452 ms, bot B-mobile-4 FCP 1624 / LCP 2436 ms).

**Wnioski dla fali 3 zgodne z księgą:** P3.4 – `ScriptCatchup` ≥ 50 ms sym. w oknie w 5/5 B d4 i d5 w obu ramionach
(mediany blokowania 96 / 123 ms d4, 136 / 143 ms d5); P3.3 – zadanie Style dokumentu ≥ 50 ms sym. w oknie 5/5 B d4
i d5; P3.1 ścisłe: `Script:index` browser mobile A 0/5 → B 2/5, `Script` (moduły wejścia) bot mobile 0/5 → 2/5,
bot d5 0/5 → 2/5, `v8.compileModule` (`Other`) browser d5 0/5 → 1/5 (67 ms, B-desktop5x-5) i bot d5 0/5 → 2/5
(3 / 12 ms); `Other` w browser A-desktop5x-5 to `FunctionCall`, nie `compileModule`, więc „0/5” po stronie A jest
poprawne.

## Rozbieżności

1. **Pominięte zadania inline skryptu dokumentu (P2.1) – błędna atrybucja do „Kmod”.** W bot B-desktop5x-1 i
   B-desktop5x-3 są zadania `Timer:(dokument)` ≥ 50 ms sym. w oknie: obs. 300,5 / 10,1 ms, sym. 738 + 51, blokowanie
   1 ms; obs. 302,8 / 14,5 ms, sym. 811 + 72, blokowanie 22 ms (`$W/ledger/bot-B-desktop5x-{1,3}.json`). Ślad:
   `TimerFire` → `FunctionCall` z URL dokumentu, linia 201 (`$W/children.py`), czyli ten sam inline loader bootu co
   `Y`; czas zgadza się ze startem serii bootu (obs. LCP 247,3 + 53,8 = 301,1 ms; 248,2 + 55,6 = 303,8 ms), więc to
   callback wyzwalający burst. `analyze.py` `kclass()` zalicza je do „Kmod inne chunki (leniwe moduły, timery)”
   (`$G/analiza/results.json`), stąd w ANALIZA §4.2 wiersz bot d5 Kmod „0,0 (2/5; 2/5) 1,0, 0,0, 22,0”. Skoro
   ANALIZA liczy handler DCL (`FunctionCall`, nie `EvaluateScript`) jako „inline EvaluateScript”, te same reguły
   obejmują timer loadera: w oknie jest **11 zadań inline skryptu dokumentu, nie 9** (9 × `Y` + 2 × timer loadera),
   wszystkie z P2.1. Brakuje ich w §2.5, w `W2-wyniki.json` `criteria.e` i na liście P3.1 („nowe w oknie z
   właścicielem w W2”; po stronie A brak). Liczby przebiegów (bot d5 5/5, blokowanie > 0 8/15) się nie zmieniają.
   **Werdykt bez zmian** (`wording`/atrybucja).
2. **K7 `ScriptCatchup` na desktopie nie jest „wciągnięty do okna” przez falę 2.** ANALIZA §2.4 („FCP przesunięte
   … wciąga do okna zadania, które na W1 leżały przed FCP (K7, K5/K6, K4i, K4)”) i §4 („Wciągnięte do okna przez boot
   po LCP (sprzężenie C3): K7 … desktop4x 96,0 / 123,0, desktop5x 136,0 / 143,0”). Moja księga: na W1 K7 ≥ 50 ms sym.
   leży w oknie w 5/5 A d4 i 5/5 A d5 w obu ramionach, z blokowaniem browser d4 15,4 / 114 / 86 / 0 / 78 (mediana 78),
   bot d4 91 / 97 / 119 / 101 / 86 (97), d5 159 / 156 (mediany). Przykład: A-desktop4x-2 FCP_opt 811 ms, K7 sym.
   1074 + 164. To samo widać we własnej tabeli ANALIZA §4.1 (A K7 78,0 (4/5; 5/5) i 97,0 (5/5; 5/5)). K5/K6 też już
   był w oknie na W1 (wg §4.1: browser 3/5, bot ≥ 50 ms w 5/5). Na d4 K7 rośnie o +18 / +26 ms (mediany), na d5 spada
   (159 → 136, 156 → 143). Nowe w oknie na desktopie są tylko K4i i część porcji K4. „Wciągnięcie do okna” jest
   prawdziwe dla K7 tylko na mobile (A 1/5 → B 3/5 browser, 0/5 → 4/5 bot). Wyjaśnienie braku poprawy TBT d4 trzeba
   więc przeformułować: K7 i K5/K6 trochę urosły, K4i doszedł, a K14/K12/K13 to wyrównały. **Werdykty (d) i P3.4
   bez zmian**, bo warunek P3.4 dotyczy tylko obecności zadania po W2 (`wording`).
3. **P3.4: „mobile 3/5 + 4/5 bez blokowania”** (§8, `W2-wyniki.json` `wave3[P3.4]`). bot B-mobile-3 ma blokowanie
   `ScriptCatchup` 11,9 ms (`$W/ledger/bot-B-mobile-3.json`; ta sama liczba w ANALIZA §4.1). Powinno być „bez
   blokowania w browser, 1/5 z 11,9 ms w bot” (`wording`).
4. **Etykieta „inline EvaluateScript” dla K4i.** Zadanie K4i to `EventDispatch DOMContentLoaded` → `FunctionCall Y`
   (linia 201), a nie `EvaluateScript`. W browser B-desktop4x-1 to samo zadanie zaczyna się `ParseHTML` 675–676 i
   dwoma `EvaluateScript` w linii 677 (0,4–0,5 ms). Ujęcie szerokie, które przyjęła ANALIZA, jest ostrożne i właściwe
   dla bramki, ale warto je nazwać wprost („zadanie skryptu inline dokumentu, w tym handler zdarzenia”). Bez tego
   rozszerzenia (e) i tak oblewa przez ParseHTML: browser 7/15 (d4 tylko B-desktop4x-1, d5 5/5, mobile 1), bot 9/15
   (`wording`).
5. **Zadania Style z `$RV`** (K5/K6, `FireAnimationFrame` → `FunctionCall $RV`, linia 676, 0,9 ms, potem
   Style+Layout 290/699 obiektów, np. browser B-desktop4x-1 obs. 189,3 ms, sym. 503 + 94, blokowanie 44) mają
   dominujący URL skryptu = dokument w browser d4 5/5 i d5 4/5. Skrypt zajmuje < 2 % zadania, więc słusznie nie są
   liczone jako inline EvaluateScript. ANALIZA nie zapisuje tego wyłączenia (pisze tylko o domieszce ParseHTML ≥ 20 %).
   Bez wpływu na liczby (`wording`).

## Czy coś zmienia werdykt

Nie. (b) i (f) zaliczone w 30/30 przebiegach B w obu ramionach. (e) niezaliczone w obu ramionach przy każdej z
trzech definicji okna i z rozszerzeniem o handler albo bez niego. Bramka W2 pozostaje niezaliczona, a konsekwencja
(P2.1 w gałęzi PR, P3.1/P3.3/P3.4 obowiązkowe) jest poprawna. Do poprawy atrybucja:

- timer loadera P2.1 dopisać do listy P3.1/K4i i nie wliczać do Kmod;
- K7 na desktopie opisać jako „już w oknie na W1, urósł na d4”, a nie „wciągnięty przez C3”;
- poprawić drobne sformułowanie w P3.4.

## Pliki

`$W/verify.py`, `$W/verify.json`, `$W/children.py`, `$W/ledger/*.json|txt` (60 przebiegów).

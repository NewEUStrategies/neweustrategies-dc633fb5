/**
 * Buduje listę interpretacji + rekomendacji dla dashboardu GSC.
 * Dostaje surowe wiersze i podsumowania - nie robi zapytań. Wołane z
 * `GscBiDashboard`. Każdy wpis odnosi się do konkretnego elementu
 * (KPI, trend, top zapytania, pozycja SERP, kraje, urządzenia, strony,
 * kalendarz), zgodnie z prośbą użytkownika o analitykę "dla każdego
 * elementu".
 */
import type { TFunction } from "i18next";
import type { GscRow } from "@/lib/analytics/gsc.functions";
import { type Insight, pctDelta, classifyDelta } from "./InsightSection";
import "@/lib/i18n-admin-analytics";

interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface Params {
  totals: Totals;
  prevTotals: Totals;
  dateRows: GscRow[];
  queryRows: GscRow[];
  pageRows: GscRow[];
  countryRows: GscRow[];
  deviceRows: GscRow[];
  windowDays: number;
  t: TFunction;
}

const CTR_BENCHMARK_BY_POS: Array<{ maxPos: number; expected: number }> = [
  { maxPos: 3, expected: 0.18 },
  { maxPos: 10, expected: 0.06 },
  { maxPos: 20, expected: 0.02 },
  { maxPos: Infinity, expected: 0.008 },
];

/** Benchmark dla pozycji, której GSC nie zmierzył - ostatni, najgłębszy kubełek. */
const CTR_BENCHMARK_DEEPEST = CTR_BENCHMARK_BY_POS[CTR_BENCHMARK_BY_POS.length - 1].expected;

/**
 * Martwa strefa dla zmiany średniej pozycji, w miejscach SERP. Jedna liczba
 * obsługuje OBA kierunki i OBIE decyzje wpisu (ocena + lista działań) -
 * uzasadnienie przy `kpi-position`.
 */
const POS_DEADBAND = 0.5;

/**
 * Martwa strefa dla LUKI CTR wobec benchmarku pozycji, wyrażona jako UDZIAŁ
 * benchmarku tego kubełka, a nie jako punkty procentowe. Steruje wyłącznie
 * WAGĄ wpisu, nie listą działań - dlaczego właśnie tak, opisuje blok `kpi-ctr`;
 * dlaczego udział, a nie punkty procentowe, opisuje komentarz niżej.
 *
 * DLACZEGO NIE ±2 PP, JAK BYŁO. `CTR_BENCHMARK_BY_POS` jest tabelą GEOMETRYCZNĄ:
 * 18% / 6% / 2% / 0.8%, czyli krok między kubełkami to mnożnik ~3x, nie stała
 * liczba punktów. Martwa strefa ±2 pp nałożona na taką skalę znaczyła w każdym
 * kubełku coś innego, a w dwóch najgłębszych była ARYTMETYCZNIE NIEOSIĄGALNA po
 * stronie alarmu - bo największa możliwa luka ujemna to CAŁY benchmark (przy
 * CTR = 0), a benchmark był tam mniejszy albo równy samej strefie:
 *
 *   kubełek        benchmark   max luka ujemna   `|luka| > 2 pp` po stronie alarmu
 *   pozycja <= 3      18%          -18.0 pp      osiągalne
 *   pozycja <= 10      6%           -6.0 pp      osiągalne
 *   pozycja <= 20      2%           -2.0 pp      NIEOSIĄGALNE (równość, próg ostry)
 *   pozycja > 20     0.8%           -0.8 pp      NIEOSIĄGALNE
 *
 * Strona POCHWAŁY osiągalna była wszędzie (CTR wolno przekroczyć benchmark
 * dowolnie), więc dla każdej właściwości rankującej poza TOP 10 blok umiał
 * wystawić „good” z samej luki i NIE UMIAŁ wystawić „warn” - reagował czulej
 * na dobrą wiadomość niż na złą i zawyżał obraz widoczności. To DOKŁADNIE ten
 * defekt, który commit progu 0.5 odrzucił w `kpi-position` („na metryce, gdzie
 * mniej znaczy lepiej, asymetria musi iść w drugą stronę albo nie iść wcale”),
 * tylko przeniesiony na oś CTR. Zerowy CTR na pozycji 15 - najgorszy możliwy
 * wynik snippetu w tym kubełku - dostawał niebieskie „info”.
 *
 * DLACZEGO 1/3. Pytanie tego bloku jest RELATYWNE z konstrukcji („czy snippet
 * dobiera tyle kliknięć, ile dobiera przeciętny wynik NA TYM MIEJSCU SERP”),
 * więc jego martwa strefa też musi być relatywna - absolutna strefa na
 * relatywnym pytaniu to pomyłka kategorii, a tabela wyżej jest jej rachunkiem.
 * Sama liczba 1/3 jest wybrana tak, by kubełek, którego zachowanie zostało
 * ROZSTRZYGNIĘTE i przypięte (pozycje 4-10, benchmark 6%), został co do bitu
 * tam, gdzie był: 6% / 3 = 2 pp, czyli stary próg. Zmienia się wyłącznie to,
 * co było zepsute albo nieosiągalne:
 *
 *   kubełek        benchmark   strefa (1/3)   alarm od CTR       pochwała od CTR
 *   pozycja <= 3      18%         6.0 pp        < 12%              > 24%
 *   pozycja <= 10      6%         2.0 pp        < 4%               > 8%     (bez zmian)
 *   pozycja <= 20      2%        0.67 pp        < 1.33%            > 2.67%
 *   pozycja > 20     0.8%       0.27 pp        < 0.53%            > 1.07%
 *
 * KOSZT, KTÓRY JEST ŚWIADOMY. W TOP 3 strefa rośnie z 2 pp do 6 pp, więc luka
 * -5 pp przy benchmarku 18% nie wystawia już alarmu z samej luki (wystawi go
 * trend, jeśli CTR spada). Operator NIE TRACI przez to ani jednej informacji:
 * `detail` dalej pisze „Twój CTR jest niższy o 5.0 pp”, a lista kroków dalej
 * jest remontowa, bo obie stoją na ZNAKU luki i granicy zero. Traci się tylko
 * roszczenie o PILNOŚĆ - a to jest zasób racjonowany (dziesięć kafelków, jeden
 * budżet uwagi) i 28% niedoboru wobec benchmarku, który między pozycją 3.0
 * i 3.1 skacze o 12 pp, jest wewnątrz rozdzielczości samego pomiaru. Odwrotna
 * strona kosztu: 0.67 pp CTR na pozycji 15 waży w kliknięciach mniej niż 5 pp
 * w TOP 3, więc blok alarmuje teraz o mniejszych bezwzględnych stratach głębiej
 * w SERP. Bezwzględna skala straty nie ginie z raportu - niesie ją `kpi-clicks`
 * (próg -10% kliknięć) i `pages` (licznik słabych stron) - a zadaniem TEGO
 * bloku jest wyłącznie „czy snippet robi swoje na miejscu, które zajmuje”.
 */
const CTR_GAP_DEADBAND_RATIO = 1 / 3;

/** Martwa strefa dla zmiany CTR wobec poprzedniego okna (0.005 = 0.5 pp). */
const CTR_MOVE_DEADBAND = 0.005;

/**
 * Czy GSC w ogóle ZMIERZYŁ średnią pozycję. Pozycja startuje od 1.0, więc
 * wartość mniejsza (0 z okna bez wyświetleń) albo nieliczbowa (uszkodzony
 * payload API) NIE jest miejscem w TOP 3 - to brak pomiaru. Negacja zamiast
 * `pos < 1` jest tu konieczna: dla `NaN` każde porównanie ostre jest fałszem,
 * więc „nie wiadomo” musi być zapisane jako `!(… >= …)`, inaczej uszkodzony
 * payload przechodzi jako pomiar.
 */
function posMeasured(pos: number): boolean {
  return pos >= 1;
}

/**
 * Oczekiwany CTR dla średniej pozycji. Bez pomiaru pozycji zwracany jest
 * najgłębszy, najniższy benchmark: inaczej pusty raport ogłaszałby lukę
 * -18 pp i kazał przepisywać meta title stron, których w nim nie ma. Sam
 * benchmark jest wtedy DOMYSŁEM, więc `kpi-ctr` nie buduje na nim wagi -
 * patrz `benchKnown` w tym bloku.
 */
function expectedCtr(pos: number): number {
  if (!posMeasured(pos)) return CTR_BENCHMARK_DEEPEST;
  const b = CTR_BENCHMARK_BY_POS.find((x) => pos <= x.maxPos);
  return b?.expected ?? CTR_BENCHMARK_DEEPEST;
}

export function buildGscInsights(p: Params): Insight[] {
  const out: Insight[] = [];
  const { totals, prevTotals, dateRows, queryRows, pageRows, countryRows, deviceRows, t } = p;
  const arr = (key: string): string[] => t(key, { returnObjects: true }) as string[];
  const B = "adminAnalytics.gsc.insights";
  const signed = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

  // ── 1. KPI: kliknięcia ─────────────────────────────────────────────
  const dClicks = pctDelta(totals.clicks, prevTotals.clicks);
  out.push({
    id: "kpi-clicks",
    element: t(`${B}.clicks.element`),
    severity: classifyDelta(dClicks, true),
    title:
      dClicks === null
        ? t(`${B}.clicks.titleNoDelta`, { clicks: totals.clicks })
        : t(`${B}.clicks.titleDelta`, { delta: signed(dClicks) }),
    detail: t(`${B}.clicks.detail`, {
      days: p.windowDays,
      clicks: totals.clicks,
      prev: prevTotals.clicks,
      impr: totals.impressions,
      prevImpr: prevTotals.impressions,
    }),
    fixes:
      dClicks !== null && dClicks < -10
        ? arr(`${B}.clicks.fixesDown`)
        : dClicks !== null && dClicks > 20
          ? arr(`${B}.clicks.fixesUp`)
          : arr(`${B}.clicks.fixesStable`),
  });

  // ── 2. KPI: CTR ────────────────────────────────────────────────────
  // DWA PROGI NA JEDNEJ LICZBIE - I TO JEST ZAMIERZONE, nie rozjazd taki, jak
  // ten domknięty niżej w `kpi-position`. Wpis odpowiada na DWA niezależne
  // pytania i każde ma własną granicę:
  //   * `ctrGap` = CTR minus `expectedCtr(pozycja)` - czy snippet dobiera tyle
  //     kliknięć, ile dobiera przeciętny wynik NA TYM MIEJSCU SERP. ZNAK tej
  //     luki wybiera LISTĘ DZIAŁAŃ, bo oba zestawy ze słownika są odpowiedzią
  //     właśnie na to pytanie: „Przepisz meta title…” kontra „Utrzymaj
  //     stylistykę tytułów - działa”. Żaden z nich nie mówi ani słowa o trendzie.
  //     Tę samą, ZEROWĄ granicę ma słowo w `detail` („niższy” / „wyższy”), więc
  //     zdanie opisowe i lista kroków nie mogą się rozjechać.
  //   * `dCtr` = CTR minus CTR poprzedniego okna - kierunek ruchu. Wchodzi
  //     wyłącznie do WAGI i wyłącznie wtedy, gdy luka jest w martwej strefie.
  //
  // DLACZEGO WAGA MA MARTWĄ STREFĘ, A PORADY NIE. Benchmark to CZTEROSTOPNIOWA
  // TABELA (18% / 6% / 2% / 0.8%), która między pozycją 3.0 i 3.1 skacze o 12 pp
  // - luka rzędu jednej trzeciej benchmarku jest więc poniżej rozdzielczości
  // samego pomiaru i nie może podnosić alarmu, bo waga to roszczenie o PILNOŚĆ,
  // konkurujące o jeden budżet uwagi z dziewięcioma innymi kafelkami. Znak tej
  // samej luki pozostaje użyteczny: słownik ma tylko DWA zestawy porad, więc
  // środek skali musi trafić do jednego z nich - i trafia do ostrożnego, bo
  // „sprawdź snippet w SERP” jest znikomy, a koszt fałszywego „działa” na
  // stronie zmierzonej PONIŻEJ krzywej - już nie.
  //
  // STREFA JEST UDZIAŁEM BENCHMARKU, NIE PUNKTAMI PROCENTOWYMI, i to jest
  // poprawka, nie kosmetyka: jako ±2 pp była po stronie alarmu ARYTMETYCZNIE
  // NIEOSIĄGALNA w dwóch najgłębszych kubełkach - największa możliwa luka
  // ujemna to CAŁY benchmark (przy CTR = 0), a benchmark wynosi tam 2% i 0.8%,
  // czyli mniej albo tyle samo, co sama strefa. Reguła benchmarku umiała więc
  // poza TOP 10 wyłącznie CHWALIĆ: strona pochwały (CTR wolno przekroczyć
  // benchmark dowolnie) była osiągalna w każdym kubełku. Zerowy CTR na pozycji
  // 15, najgorszy możliwy wynik snippetu w tym kubełku, dostawał niebieskie
  // „info”. Rachunek czterech kubełków, wybór liczby 1/3 i koszt tej zmiany
  // w TOP 3 stoją przy stałej `CTR_GAP_DEADBAND_RATIO`. Strefa pozostaje
  // SYMETRYCZNA w KAŻDYM kubełku: alarm od 2/3 benchmarku, pochwała od 4/3.
  //
  // BEZ POMIARU POZYCJI NIE MA WERDYKTU O BENCHMARKU (`benchKnown`). Gdy GSC
  // nie zmierzył pozycji (okno bez wyświetleń daje `position === 0`, uszkodzony
  // payload - `NaN`), `expectedCtr` zwraca najgłębszy benchmark jako DOMYSŁ.
  // Udziałowa strefa jest wtedy tak wąska (0.27 pp), że pusty raport ogłaszałby
  // z tego domysłu „warn” - alarm o snippetach stron, których w raporcie nie
  // ma. Waga spada więc w takim przypadku na regułę TRENDU, stojącą na liczbach
  // naprawdę zmierzonych w obu oknach. Bramka dotyczy WYŁĄCZNIE wagi: `detail`
  // i lista kroków dalej idą za znakiem luki, czyli za wersją ostrożną, bo
  // fałszywe „działa” jest tu droższe od zbędnego „sprawdź snippet”. Przedtem to
  // samo załatwiała strefa ±2 pp, ale PRZYPADKIEM - jako skutek uboczny tego,
  // że była szersza niż najgłębszy benchmark.
  //
  // `NaN` MUSI DAWAĆ „NIE WIADOMO”, NIE „DZIAŁA”. Uszkodzony `totals.ctr` robi
  // z `ctrGap` i `dCtr` wartość `NaN`, dla której KAŻDE porównanie ostre jest
  // fałszem. Dlatego decyzje, których odpowiedzią na „nie wiadomo” ma być
  // PRAWDA, są zapisane negacją (`ctrBelowBench`, `ctrFlat`), a ta, której
  // odpowiedzią ma być FAŁSZ (`ctrGapWide`), zostaje porównaniem ostrym - ten
  // sam idiom, co `posMeasured`. Dla liczb skończonych każda z tych form jest
  // tożsama z poprzednią, więc zachowanie zmierzonych raportów nie drga; zmienia
  // się tylko to, że przy `NaN` detal („niższy”) i porady (remontowe) mówią to
  // samo, a waga nie zgłasza roszczenia („info”). Przedtem detal mówił „niższy”,
  // porady „utrzymaj stylistykę tytułów - działa”, a waga wychodziła „good” -
  // trzy zdania o niczym, każde z innej gałęzi.
  //
  // ZIELONY KAFELEK Z LISTĄ REMONTOWĄ JEST POPRAWNY. Przy CTR 5.5% na pozycji 5
  // (benchmark 6%) i wzroście o 1 pp operator dostaje wagę „good” RAZEM z pełną,
  // czteroetapową listą naprawczą - a `detail` mówi mu oba fakty w jednym
  // zdaniu: „Twój CTR jest niższy o 0.5 pp. Zmiana vs poprzednie okno: 1.00 pp”.
  // To nie sprzeczność: „rośnie” i „wciąż poniżej normy dla swojego miejsca” to
  // dwa różne zdania o dwóch różnych liczbach. Lustrzany narożnik - waga „warn”
  // przy luce nieujemnej i spadającym CTR, z poradą „utrzymaj stylistykę
  // tytułów - działa” - jest poprawny z tego samego powodu: alarm dotyczy
  // spadku, a porada mówi, że przyczyną NIE jest snippet, i wskazuje drugą
  // dźwignię („wprowadź ten sam wzorzec na słabszych stronach”).
  //
  // CZYM TO SIĘ RÓŻNI OD `kpi-position`. Tam JEDNA liczba (`dPos`), opisana
  // JEDNYM zdaniem, sterowała OBIEMA decyzjami - rozjazd progów dawał więc
  // alarm z instrukcją bezczynności. Tu każda decyzja stoi na innej liczbie.
  //
  // NIE SPRZĘGAĆ TYCH PROGÓW JEDNYM BOOLEANEM - to rozstrzygnięcie zostaje
  // w mocy także po przejściu strefy na udział benchmarku. Wspólna strefa
  // (w kubełku 6% to dalej 2 pp)
  // wypisałaby „Utrzymaj stylistykę tytułów - działa” na bursztynowym kafelku
  // strony, która jest 1.9 pp POD krzywą i dalej spada - czyli
  // WYPRODUKOWAŁABY defekt z `kpi-position` zamiast go usunąć. Waga steruje też
  // miejscem na posortowanej liście i licznikiem odznaki (`InsightSection`),
  // więc zielony wpis idzie na SPÓD listy i liczy się do „N OK”; to również jest
  // zamierzone, bo `InsightSection` niczego nie zwija ani nie ucina - lista
  // remontowa spada w kolejności, a nie znika z widoku, i tak ma być:
  // to okazja do poprawy, nie incydent. Reguła jest przypięta testami
  // (`gscInsights.test.ts`, blok „dwa progi to dwa różne fakty”).
  const dCtr = totals.ctr - prevTotals.ctr; // punkty procentowe
  const ctrBench = expectedCtr(totals.position);
  const ctrGap = totals.ctr - ctrBench;
  const benchKnown = posMeasured(totals.position);
  const ctrBelowBench = !(ctrGap >= 0);
  const ctrGapWide = benchKnown && Math.abs(ctrGap) > ctrBench * CTR_GAP_DEADBAND_RATIO;
  const ctrFlat = !(Math.abs(dCtr) >= CTR_MOVE_DEADBAND);
  out.push({
    id: "kpi-ctr",
    element: t(`${B}.ctr.element`),
    severity: ctrGapWide
      ? ctrBelowBench
        ? "warn"
        : "good"
      : ctrFlat
        ? "info"
        : dCtr < 0
          ? "warn"
          : "good",
    title: t(`${B}.ctr.title`, {
      ctr: (totals.ctr * 100).toFixed(2),
      pos: totals.position.toFixed(1),
    }),
    detail: t(`${B}.ctr.detail`, {
      exp: (ctrBench * 100).toFixed(1),
      cmp: ctrBelowBench ? t(`${B}.ctr.cmpLower`) : t(`${B}.ctr.cmpHigher`),
      gap: (Math.abs(ctrGap) * 100).toFixed(1),
      dctr: (dCtr * 100).toFixed(2),
    }),
    fixes: ctrBelowBench ? arr(`${B}.ctr.fixesLow`) : arr(`${B}.ctr.fixesGood`),
  });

  // ── 3. KPI: pozycja ────────────────────────────────────────────────
  // Ocena i lista działań łamią się na TEJ SAMEJ, DOMKNIĘTEJ granicy
  // ±`POS_DEADBAND`, bo trafiają do użytkownika jako jeden kafelek: ta sama
  // ramka, ten sam nagłówek, a pod nim wypunktowanie kroków (`InsightSection`).
  // Wcześniej ocena łamała się na `>= 0.5`, a lista na `> 0.5`, więc
  // pogorszenie DOKŁADNIE o pół miejsca dawało kafelek ostrzegawczy -
  // bursztynowy, wyniesiony sortowaniem na szczyt listy i doliczony do odznaki
  // „do poprawy” - którego jedyną poradą było „utrzymaj tempo”. Operator był
  // kierowany uwagą tam, gdzie sam wpis mówił mu, że nie ma nic do zrobienia.
  // Domykamy stronę porad, a nie otwieramy strony oceny, bo strona poprawy
  // jest domknięta (`<= -POS_DEADBAND` to już „good”): przy otwartym `> 0.5`
  // pół miejsca w górę byłoby sygnałem, a pół miejsca w dół szumem, czyli
  // moduł reagowałby czulej na dobrą wiadomość niż na złą i zawyżałby obraz
  // widoczności. `detail` ma własną, ZEROWĄ granicę i to jest zamierzone -
  // opisuje kierunek ruchu, nie jego wagę.
  const dPos = totals.position - prevTotals.position;
  const posBetter = dPos <= -POS_DEADBAND;
  const posWorse = dPos >= POS_DEADBAND;
  out.push({
    id: "kpi-position",
    element: t(`${B}.position.element`),
    severity: posBetter ? "good" : posWorse ? "warn" : "info",
    title: t(`${B}.position.title`, {
      pos: totals.position.toFixed(1),
      delta: signed(dPos),
    }),
    detail:
      dPos > 0
        ? t(`${B}.position.detailWorse`, { n: dPos.toFixed(1) })
        : dPos < 0
          ? t(`${B}.position.detailBetter`, { n: Math.abs(dPos).toFixed(1) })
          : t(`${B}.position.detailStable`),
    fixes: posWorse ? arr(`${B}.position.fixesWorse`) : arr(`${B}.position.fixesStable`),
  });

  // ── 4. Trend widoczności ───────────────────────────────────────────
  if (dateRows.length > 3) {
    const sorted = dateRows
      .slice()
      .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    // Obie połowy muszą obejmować TĘ SAMĄ liczbę dni, inaczej porównanie sum
    // porównuje różne okna: przy nieparzystej liczbie dni krótsze H1 zawyża
    // trend (albo ukrywa spadek) na serii, która nie drgnęła. Dzień środkowy
    // nie należy więc do żadnej połowy - H1 to pierwsze `half` dni, H2 ostatnie.
    const half = Math.floor(sorted.length / 2);
    const early = sorted.slice(0, half).reduce((s, r) => s + r.clicks, 0);
    const late = sorted.slice(sorted.length - half).reduce((s, r) => s + r.clicks, 0);
    const trend = pctDelta(late, early);
    out.push({
      id: "trend",
      element: t(`${B}.trend.element`),
      severity: classifyDelta(trend, true),
      title:
        trend === null
          ? t(`${B}.trend.titleNoData`)
          : t(`${B}.trend.title`, { delta: signed(trend) }),
      detail: t(`${B}.trend.detail`, { early, late, days: p.windowDays }),
      fixes:
        trend !== null && trend < -10
          ? arr(`${B}.trend.fixesDown`)
          : arr(`${B}.trend.fixesDefault`),
    });
  }

  // ── 5. Top 15 zapytań ──────────────────────────────────────────────
  if (queryRows.length > 0) {
    const branded = queryRows
      .filter((r) => (r.keys[0] ?? "").toLowerCase().includes("new european"))
      .reduce((s, r) => s + r.clicks, 0);
    const brandedPct = totals.clicks > 0 ? branded / totals.clicks : 0;
    const zeroClickHigh = queryRows.filter((r) => r.clicks === 0 && r.impressions >= 20).length;
    out.push({
      id: "top-queries",
      element: t(`${B}.topQueries.element`),
      severity: brandedPct > 0.6 ? "warn" : zeroClickHigh > 5 ? "warn" : "info",
      title:
        brandedPct > 0.6
          ? t(`${B}.topQueries.titleBranded`, { pct: (brandedPct * 100).toFixed(0) })
          : t(`${B}.topQueries.titleZeroClick`, { count: zeroClickHigh }),
      detail:
        brandedPct > 0.6
          ? t(`${B}.topQueries.detailBranded`)
          : t(`${B}.topQueries.detailZeroClick`, { count: zeroClickHigh }),
      fixes:
        brandedPct > 0.6
          ? arr(`${B}.topQueries.fixesBranded`)
          : arr(`${B}.topQueries.fixesZeroClick`),
    });
  }

  // ── 6. Pozycja SERP - histogram ────────────────────────────────────
  if (queryRows.length > 0) {
    const inWindow = { top3: 0, top10: 0, top20: 0, deep: 0 };
    for (const r of queryRows) {
      if (r.position <= 3) inWindow.top3 += r.impressions;
      else if (r.position <= 10) inWindow.top10 += r.impressions;
      else if (r.position <= 20) inWindow.top20 += r.impressions;
      else inWindow.deep += r.impressions;
    }
    const totalImp = inWindow.top3 + inWindow.top10 + inWindow.top20 + inWindow.deep;
    const top10Pct = totalImp > 0 ? (inWindow.top3 + inWindow.top10) / totalImp : 0;
    out.push({
      id: "position-histogram",
      element: t(`${B}.positionHistogram.element`),
      severity: top10Pct >= 0.5 ? "good" : top10Pct >= 0.25 ? "info" : "warn",
      title: t(`${B}.positionHistogram.title`, { pct: (top10Pct * 100).toFixed(0) }),
      detail: t(`${B}.positionHistogram.detail`, {
        top3: inWindow.top3,
        top10: inWindow.top10,
        top20: inWindow.top20,
        deep: inWindow.deep,
      }),
      fixes: [
        t(`${B}.positionHistogram.fix1`),
        t(`${B}.positionHistogram.fix2`),
        top10Pct < 0.25
          ? t(`${B}.positionHistogram.fix3Low`)
          : t(`${B}.positionHistogram.fix3High`),
      ],
    });
  }

  // ── 7. Kraje ───────────────────────────────────────────────────────
  if (countryRows.length > 0) {
    const sorted = countryRows.slice().sort((a, b) => b.clicks - a.clicks);
    const top = sorted[0];
    const topShare = totals.clicks > 0 ? top.clicks / totals.clicks : 0;
    out.push({
      id: "countries",
      element: t(`${B}.countries.element`),
      severity: topShare > 0.9 ? "info" : "good",
      title: t(`${B}.countries.title`, {
        country: (top.keys[0] ?? "?").toUpperCase(),
        pct: (topShare * 100).toFixed(0),
      }),
      detail: t(`${B}.countries.detail`, {
        count: sorted.length,
        top3: sorted
          .slice(0, 3)
          .map((r) => `${(r.keys[0] ?? "?").toUpperCase()} ${r.clicks}`)
          .join(", "),
      }),
      fixes: topShare > 0.9 ? arr(`${B}.countries.fixesSingle`) : arr(`${B}.countries.fixesMulti`),
    });
  }

  // ── 8. Urządzenia ──────────────────────────────────────────────────
  if (deviceRows.length > 0) {
    const mobile = deviceRows.find((r) => (r.keys[0] ?? "").toLowerCase() === "mobile");
    const desktop = deviceRows.find((r) => (r.keys[0] ?? "").toLowerCase() === "desktop");
    const mobileClicks = mobile?.clicks ?? 0;
    const desktopClicks = desktop?.clicks ?? 0;
    const mobileCtr = mobile && mobile.impressions ? mobile.ctr : 0;
    const desktopCtr = desktop && desktop.impressions ? desktop.ctr : 0;
    // Luka jest ZNAKOWANA: dodatnia to przewaga desktopu, ujemna - mobile'a.
    // Alarm i lista "gap" mówią wyłącznie o mobilnym snippecie, więc należą się
    // tylko przewadze desktopu. Rozkład wolno nazwać równomiernym dopiero
    // wtedy, gdy różnica jest poniżej progu W OBIE strony - przy przewadze
    // mobile'a o 18 pp nie jest równomierny i tego zdania tu nie ma. Słownik
    // (`i18n-admin-analytics.ts`) nie ma jeszcze noty o przewadze mobile'a,
    // więc detal poprzestaje wtedy na obu zmierzonych CTR-ach, zamiast
    // dopisywać do nich nieprawdę.
    const gap = desktopCtr - mobileCtr;
    const desktopLeads = gap > 0.02;
    const evenSpread = Math.abs(gap) <= 0.02;
    out.push({
      id: "devices",
      element: t(`${B}.devices.element`),
      severity: desktopLeads ? "warn" : "info",
      title: t(`${B}.devices.title`, { mobile: mobileClicks, desktop: desktopClicks }),
      detail: t(`${B}.devices.detail`, {
        mctr: (mobileCtr * 100).toFixed(2),
        dctr: (desktopCtr * 100).toFixed(2),
        note: evenSpread
          ? t(`${B}.devices.noteEven`)
          : desktopLeads
            ? t(`${B}.devices.noteGap`)
            : "",
      }).trim(),
      fixes: desktopLeads ? arr(`${B}.devices.fixesGap`) : arr(`${B}.devices.fixesEven`),
    });
  }

  // ── 9. Strony (treemap) ────────────────────────────────────────────
  if (pageRows.length > 0) {
    // TEN SAM IDIOM, CO W `kpi-ctr`, INNE LICZBY - i to jest decyzja. Oba bloki
    // pytają o to samo (czy CTR jest poniżej benchmarku SWOJEJ pozycji) i oba
    // odpowiadają MNOŻNIKIEM benchmarku, bo tabela `CTR_BENCHMARK_BY_POS` jest
    // geometryczna i próg absolutny znaczyłby w każdym kubełku coś innego
    // (rachunek przy `CTR_GAP_DEADBAND_RATIO`). Mnożniki są jednak inne
    // i NIE WOLNO ich zrównywać przez przepisanie liczby z tamtej stałej:
    //   * tu klasyfikowany jest POJEDYNCZY WIERSZ, a alarm wystawia dopiero
    //     LICZNIK (`lowCtr.length > 3`) na wierszach od 30 wyświetleń - próg
    //     per wiersz ma więc nad sobą drugi filtr szumu i może być luźniejszy;
    //   * `kpi-ctr` stawia JEDNO roszczenie o pilność z jednej sumy, bez
    //     drugiego filtra, więc jego strefa musi zostać tam, gdzie została
    //     rozstrzygnięta i przypięta (1/3 benchmarku, czyli 2 pp w kubełku 6%);
    //   * tu progi są ASYMETRYCZNE (0.6 kontra 1.3), a strefa `kpi-ctr` jest
    //     świadomie symetryczna - zrównanie liczb przeniosłoby tę asymetrię na
    //     wagę całej właściwości, czyli dokładnie to, czego zakazuje komentarz
    //     przy `kpi-position`.
    const withImpr = pageRows.filter((r) => r.impressions >= 30);
    const lowCtr = withImpr.filter((r) => r.ctr < expectedCtr(r.position) * 0.6);
    const winners = withImpr.filter((r) => r.ctr > expectedCtr(r.position) * 1.3);
    out.push({
      id: "pages",
      element: t(`${B}.pages.element`),
      severity: lowCtr.length > 3 ? "warn" : "info",
      title: t(`${B}.pages.title`, { low: lowCtr.length, winners: winners.length }),
      detail: t(`${B}.pages.detail`, { count: withImpr.length }),
      fixes: arr(`${B}.pages.fixes`),
    });
  }

  // ── 10. Kalendarz aktywności ───────────────────────────────────────
  if (dateRows.length >= 7) {
    const sorted = dateRows
      .slice()
      .sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? ""));
    const zeros = sorted.filter((r) => r.clicks === 0).length;
    const spikeIdx = sorted.reduce((acc, r, i) => (r.clicks > sorted[acc].clicks ? i : acc), 0);
    const spike = sorted[spikeIdx];
    const manyZeros = zeros > sorted.length * 0.4;
    out.push({
      id: "calendar",
      element: t(`${B}.calendar.element`),
      severity: manyZeros ? "warn" : "info",
      title: manyZeros
        ? t(`${B}.calendar.titleZeros`, { zeros, total: sorted.length })
        : t(`${B}.calendar.titleSpike`, { clicks: spike.clicks, date: spike.keys[0] ?? "" }),
      detail: manyZeros
        ? t(`${B}.calendar.detailZeros`)
        : t(`${B}.calendar.detailSpike`, { date: spike.keys[0] ?? "-", clicks: spike.clicks }),
      fixes: manyZeros ? arr(`${B}.calendar.fixesZeros`) : arr(`${B}.calendar.fixesSpike`),
    });
  }

  return out;
}

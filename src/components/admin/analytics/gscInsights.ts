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
 * Oczekiwany CTR dla średniej pozycji. Pozycja GSC startuje od 1.0, więc
 * wartość mniejsza (0 z okna bez wyświetleń) albo nieliczbowa (uszkodzony
 * payload API) NIE jest miejscem w TOP 3 - to brak pomiaru. Taki przypadek
 * dostaje najgłębszy, najniższy benchmark: inaczej pusty raport ogłaszałby
 * lukę -18 pp i kazał przepisywać meta title stron, których w nim nie ma.
 */
function expectedCtr(pos: number): number {
  if (!(pos >= 1)) return CTR_BENCHMARK_DEEPEST;
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
  const dCtr = totals.ctr - prevTotals.ctr; // punkty procentowe
  const ctrGap = totals.ctr - expectedCtr(totals.position);
  out.push({
    id: "kpi-ctr",
    element: t(`${B}.ctr.element`),
    severity:
      ctrGap < -0.02
        ? "warn"
        : ctrGap > 0.02
          ? "good"
          : Math.abs(dCtr) < 0.005
            ? "info"
            : dCtr < 0
              ? "warn"
              : "good",
    title: t(`${B}.ctr.title`, {
      ctr: (totals.ctr * 100).toFixed(2),
      pos: totals.position.toFixed(1),
    }),
    detail: t(`${B}.ctr.detail`, {
      exp: (expectedCtr(totals.position) * 100).toFixed(1),
      cmp: ctrGap >= 0 ? t(`${B}.ctr.cmpHigher`) : t(`${B}.ctr.cmpLower`),
      gap: (Math.abs(ctrGap) * 100).toFixed(1),
      dctr: (dCtr * 100).toFixed(2),
    }),
    fixes: ctrGap < 0 ? arr(`${B}.ctr.fixesLow`) : arr(`${B}.ctr.fixesGood`),
  });

  // ── 3. KPI: pozycja ────────────────────────────────────────────────
  const dPos = totals.position - prevTotals.position;
  out.push({
    id: "kpi-position",
    element: t(`${B}.position.element`),
    severity: dPos <= -0.5 ? "good" : dPos >= 0.5 ? "warn" : "info",
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
    fixes: dPos > 0.5 ? arr(`${B}.position.fixesWorse`) : arr(`${B}.position.fixesStable`),
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

/**
 * Interpretacja + rekomendacje dla dashboardu GA4. Konsumuje surowe raporty
 * (nie robi zapytań) i produkuje wpisy per element dashboardu:
 * KPI (sesje / użytkownicy / odsłony / zaangażowanie), trend ruchu, źródła,
 * kraje, urządzenia, radar zaangażowania oraz top strony.
 */
import type { TFunction } from "i18next";
import type { Ga4Report } from "@/lib/analytics/ga4.functions";
import { type Insight, pctDelta, classifyDelta } from "./InsightSection";
import "@/lib/i18n-admin-analytics";

function num(v: string | undefined): number {
  if (v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function totalsFromReport(report: Ga4Report | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!report) return out;
  for (let i = 0; i < report.metricHeaders.length; i++) {
    out[report.metricHeaders[i]] = num(report.totals[i]);
  }
  return out;
}

interface Params {
  dateReport: Ga4Report | undefined;
  prevReport: Ga4Report | undefined;
  sourceReport: Ga4Report | undefined;
  countryReport: Ga4Report | undefined;
  deviceReport: Ga4Report | undefined;
  pageReport: Ga4Report | undefined;
  engagementReport: Ga4Report | undefined;
  windowDays: number;
  t: TFunction;
}

export function buildGa4Insights(p: Params): Insight[] {
  const out: Insight[] = [];
  const t = p.t;
  const arr = (key: string): string[] => t(key, { returnObjects: true }) as string[];
  const B = "adminAnalytics.ga4.insights";
  const signed = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
  const totals = totalsFromReport(p.dateReport);
  const prev = totalsFromReport(p.prevReport);
  const engage = totalsFromReport(p.engagementReport);

  // 1. KPI sesje
  const dSess = pctDelta(totals.sessions ?? 0, prev.sessions ?? 0);
  out.push({
    id: "kpi-sessions",
    element: t(`${B}.sessions.element`),
    severity: classifyDelta(dSess, true),
    title:
      dSess === null
        ? t(`${B}.sessions.titleNoDelta`, { sessions: totals.sessions ?? 0 })
        : t(`${B}.sessions.titleDelta`, { delta: signed(dSess), days: p.windowDays }),
    detail: t(`${B}.sessions.detail`, {
      sessions: totals.sessions ?? 0,
      prev: prev.sessions ?? 0,
      active: totals.activeUsers ?? 0,
    }),
    fixes:
      dSess !== null && dSess < -10
        ? arr(`${B}.sessions.fixesDown`)
        : dSess !== null && dSess > 15
          ? arr(`${B}.sessions.fixesUp`)
          : arr(`${B}.sessions.fixesStable`),
  });

  // 2. KPI Zaangażowanie
  const engRate = totals.engagementRate ?? 0;
  const prevEng = prev.engagementRate ?? 0;
  const dEng = engRate - prevEng;
  out.push({
    id: "kpi-engagement",
    element: t(`${B}.engagement.element`),
    severity: engRate >= 0.6 ? "good" : engRate >= 0.4 ? "info" : "warn",
    title: t(`${B}.engagement.title`, { rate: (engRate * 100).toFixed(1) }),
    detail: t(`${B}.engagement.detail`, { delta: (dEng * 100).toFixed(1) }),
    fixes: engRate < 0.4 ? arr(`${B}.engagement.fixesLow`) : arr(`${B}.engagement.fixesGood`),
  });

  // 3. Trend ruchu
  if (p.dateReport?.rows.length && p.dateReport.rows.length > 3) {
    const rows = p.dateReport.rows
      .slice()
      .sort((a, b) => (a.dims[0] ?? "").localeCompare(b.dims[0] ?? ""));
    const idx = p.dateReport.metricHeaders.indexOf("sessions");
    const half = Math.floor(rows.length / 2);
    const early = rows.slice(0, half).reduce((s, r) => s + num(r.metrics[idx]), 0);
    const late = rows.slice(half).reduce((s, r) => s + num(r.metrics[idx]), 0);
    const trend = pctDelta(late, early);
    out.push({
      id: "trend",
      element: t(`${B}.trend.element`),
      severity: classifyDelta(trend, true),
      title:
        trend === null
          ? t(`${B}.trend.titleNoData`)
          : t(`${B}.trend.title`, { delta: signed(trend) }),
      detail: t(`${B}.trend.detail`, { early, late }),
      fixes:
        trend !== null && trend < -10
          ? arr(`${B}.trend.fixesDown`)
          : arr(`${B}.trend.fixesDefault`),
    });
  }

  // 4. Źródła ruchu
  if (p.sourceReport?.rows.length) {
    const rows = p.sourceReport.rows.slice();
    const idx = p.sourceReport.metricHeaders.indexOf("sessions");
    rows.sort((a, b) => num(b.metrics[idx]) - num(a.metrics[idx]));
    const total = rows.reduce((s, r) => s + num(r.metrics[idx]), 0);
    const direct = rows.find((r) => (r.dims[0] ?? "").toLowerCase().includes("direct"));
    const organic = rows.find((r) => (r.dims[0] ?? "").toLowerCase().includes("google"));
    const directPct = total > 0 && direct ? num(direct.metrics[idx]) / total : 0;
    const organicPct = total > 0 && organic ? num(organic.metrics[idx]) / total : 0;
    out.push({
      id: "sources",
      element: t(`${B}.sources.element`),
      severity: directPct > 0.6 ? "warn" : organicPct < 0.2 ? "warn" : "info",
      title: t(`${B}.sources.title`, {
        direct: (directPct * 100).toFixed(0),
        organic: (organicPct * 100).toFixed(0),
      }),
      detail: t(`${B}.sources.detail`, {
        count: rows.length,
        top3: rows
          .slice(0, 3)
          .map((r) => `${r.dims[0] ?? "?"} (${num(r.metrics[idx])})`)
          .join(", "),
      }),
      fixes:
        directPct > 0.6
          ? arr(`${B}.sources.fixesDirect`)
          : organicPct < 0.2
            ? arr(`${B}.sources.fixesOrganic`)
            : arr(`${B}.sources.fixesDefault`),
    });
  }

  // 5. Kraje
  if (p.countryReport?.rows.length) {
    const rows = p.countryReport.rows.slice();
    const idx = p.countryReport.metricHeaders.indexOf("sessions");
    rows.sort((a, b) => num(b.metrics[idx]) - num(a.metrics[idx]));
    const total = rows.reduce((s, r) => s + num(r.metrics[idx]), 0);
    const top = rows[0];
    const topPct = total > 0 && top ? num(top.metrics[idx]) / total : 0;
    out.push({
      id: "countries",
      element: t(`${B}.countries.element`),
      severity: topPct > 0.9 ? "info" : "good",
      title: t(`${B}.countries.title`, {
        country: top?.dims[0] ?? "?",
        pct: (topPct * 100).toFixed(0),
      }),
      detail: t(`${B}.countries.detail`, { count: rows.length }),
      fixes: topPct > 0.9 ? arr(`${B}.countries.fixesSingle`) : arr(`${B}.countries.fixesMulti`),
    });
  }

  // 6. Urządzenia
  if (p.deviceReport?.rows.length) {
    const rows = p.deviceReport.rows;
    const idx = p.deviceReport.metricHeaders.indexOf("sessions");
    const mobile = rows.find((r) => (r.dims[0] ?? "").toLowerCase() === "mobile");
    const desktop = rows.find((r) => (r.dims[0] ?? "").toLowerCase() === "desktop");
    const total = rows.reduce((s, r) => s + num(r.metrics[idx]), 0);
    const mobilePct = total > 0 && mobile ? num(mobile.metrics[idx]) / total : 0;
    out.push({
      id: "devices",
      element: t(`${B}.devices.element`),
      severity: "info",
      title: t(`${B}.devices.title`, { pct: (mobilePct * 100).toFixed(0) }),
      detail: t(`${B}.devices.detail`, {
        mobile: mobile ? num(mobile.metrics[idx]) : 0,
        desktop: desktop ? num(desktop.metrics[idx]) : 0,
      }),
      fixes: mobilePct > 0.6 ? arr(`${B}.devices.fixesMobile`) : arr(`${B}.devices.fixesDesktop`),
    });
  }

  // 7. Radar zaangażowania
  if (Object.keys(engage).length > 0) {
    const asd = engage.averageSessionDuration ?? 0;
    const bounce = engage.bounceRate ?? 0;
    const spv = engage.screenPageViewsPerSession ?? 0;
    out.push({
      id: "engagement-radar",
      element: t(`${B}.engagementRadar.element`),
      severity: bounce > 0.6 ? "warn" : spv < 1.5 ? "warn" : "good",
      title: t(`${B}.engagementRadar.title`, {
        asd: asd.toFixed(0),
        spv: spv.toFixed(2),
        bounce: (bounce * 100).toFixed(0),
      }),
      detail: t(`${B}.engagementRadar.detail`),
      fixes:
        spv < 1.5
          ? arr(`${B}.engagementRadar.fixesLowSpv`)
          : bounce > 0.6
            ? arr(`${B}.engagementRadar.fixesHighBounce`)
            : arr(`${B}.engagementRadar.fixesGood`),
    });
  }

  // 8. Top strony
  if (p.pageReport?.rows.length) {
    const rows = p.pageReport.rows.slice();
    const idxV = p.pageReport.metricHeaders.indexOf("screenPageViews");
    const idxE = p.pageReport.metricHeaders.indexOf("engagementRate");
    rows.sort((a, b) => num(b.metrics[idxV]) - num(a.metrics[idxV]));
    const weakTop = rows.slice(0, 10).filter((r) => num(r.metrics[idxE]) < 0.35).length;
    out.push({
      id: "top-pages",
      element: t(`${B}.topPages.element`),
      severity: weakTop >= 3 ? "warn" : "info",
      title: t(`${B}.topPages.title`, { strong: 10 - weakTop, weak: weakTop }),
      detail: t(`${B}.topPages.detail`),
      fixes: weakTop >= 3 ? arr(`${B}.topPages.fixesWeak`) : arr(`${B}.topPages.fixesDefault`),
    });
  }

  return out;
}

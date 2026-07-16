/**
 * Interpretacja + rekomendacje dla dashboardu GA4. Konsumuje surowe raporty
 * (nie robi zapytań) i produkuje wpisy per element dashboardu:
 * KPI (sesje / użytkownicy / odsłony / zaangażowanie), trend ruchu, źródła,
 * kraje, urządzenia, radar zaangażowania oraz top strony.
 */
import type { Ga4Report } from "@/lib/analytics/ga4.functions";
import { type Insight, pctDelta, classifyDelta } from "./InsightSection";

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
}

export function buildGa4Insights(p: Params): Insight[] {
  const out: Insight[] = [];
  const totals = totalsFromReport(p.dateReport);
  const prev = totalsFromReport(p.prevReport);
  const engage = totalsFromReport(p.engagementReport);

  // 1. KPI sesje
  const dSess = pctDelta(totals.sessions ?? 0, prev.sessions ?? 0);
  out.push({
    id: "kpi-sessions",
    element: "KPI · Sesje",
    severity: classifyDelta(dSess, true),
    title:
      dSess === null
        ? `Sesje: ${totals.sessions ?? 0}`
        : `Sesje ${dSess >= 0 ? "+" : ""}${dSess.toFixed(1)}% vs poprzednie ${p.windowDays} dni`,
    detail: `Bieżące: ${totals.sessions ?? 0}, poprzednie: ${prev.sessions ?? 0}. Aktywni: ${totals.activeUsers ?? 0}.`,
    fixes:
      dSess !== null && dSess < -10
        ? [
            "Sprawdź GA4 > Acquisition > Traffic acquisition - który kanał spadł?",
            "Jeśli spadł organic - patrz GSC (Search Console).",
            "Jeśli spadł direct - sprawdź czy nie zniknął istotny backlink lub kampania.",
          ]
        : dSess !== null && dSess > 15
          ? [
              "Skaluj kanał który zyskał - powtórz publikacje w podobnym stylu.",
              "Dopracuj retencję: newsletter/RSS na stronach które zyskały ruch.",
            ]
          : ["Trend stabilny - dobra baza do eksperymentów CRO."],
  });

  // 2. KPI Zaangażowanie
  const engRate = totals.engagementRate ?? 0;
  const prevEng = prev.engagementRate ?? 0;
  const dEng = engRate - prevEng;
  out.push({
    id: "kpi-engagement",
    element: "KPI · Zaangażowanie",
    severity: engRate >= 0.6 ? "good" : engRate >= 0.4 ? "info" : "warn",
    title: `Engagement rate ${(engRate * 100).toFixed(1)}%`,
    detail:
      `Benchmark: >60% świetnie, 40-60% średnio, <40% problem z jakością ruchu lub UX. ` +
      `Zmiana: ${(dEng * 100).toFixed(1)} pp.`,
    fixes:
      engRate < 0.4
        ? [
            "Skróć LCP i INP w Web Vitals - wolne strony = odbicie w pierwszych 3 sekundach.",
            "Dopasuj intent: sprawdź czy landing page odpowiada na frazę, którą wpisał user.",
            "Zredukuj popupy/modale w pierwszej sesji - Google traktuje je jak intruzywne.",
          ]
        : ["Utrzymuj obecny UX - dodaj mikroeventy (scroll depth 75%) do lepszej segmentacji."],
  });

  // 3. Trend ruchu
  if (p.dateReport?.rows.length && p.dateReport.rows.length > 3) {
    const rows = p.dateReport.rows.slice().sort((a, b) => (a.dims[0] ?? "").localeCompare(b.dims[0] ?? ""));
    const idx = p.dateReport.metricHeaders.indexOf("sessions");
    const half = Math.floor(rows.length / 2);
    const early = rows.slice(0, half).reduce((s, r) => s + num(r.metrics[idx]), 0);
    const late = rows.slice(half).reduce((s, r) => s + num(r.metrics[idx]), 0);
    const trend = pctDelta(late, early);
    out.push({
      id: "trend",
      element: "Trend ruchu",
      severity: classifyDelta(trend, true),
      title:
        trend === null
          ? "Trend - brak wystarczających danych"
          : `Druga połowa okna: ${trend >= 0 ? "+" : ""}${trend.toFixed(1)}% sesji`,
      detail: `Sesje H1: ${early}, H2: ${late}. Sygnalizuje kierunek w bieżącym oknie.`,
      fixes:
        trend !== null && trend < -10
          ? [
              "Zestaw z GSC: jeśli GSC bez spadku - to problem po stronie GA4 (filtry, blokada IP).",
              "Sprawdź integrację analytics w consent bannerze - blokujący consent = spadek sesji.",
            ]
          : ["Kontynuuj obecną strategię publikacji."],
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
      element: "Źródła ruchu",
      severity: directPct > 0.6 ? "warn" : organicPct < 0.2 ? "warn" : "info",
      title:
        `Direct ${(directPct * 100).toFixed(0)}%, Google ${(organicPct * 100).toFixed(0)}%`,
      detail: `${rows.length} źródeł. TOP 3: ${rows
        .slice(0, 3)
        .map((r) => `${r.dims[0] ?? "?"} (${num(r.metrics[idx])})`)
        .join(", ")}.`,
      fixes:
        directPct > 0.6
          ? [
              "Wysoki direct = brak UTM w kampaniach lub problem z referrerem. Otaguj wszystkie linki (utm_source/medium/campaign).",
              "Sprawdź czy strona jest publikowana w social - dodaj UTM w każdym poście.",
            ]
          : organicPct < 0.2
            ? [
                "Niski organic - zainwestuj w GSC + content SEO (już masz GSC podłączone).",
                "Zbuduj cluster: 1 pillar + 5-8 supportujących artykułów per temat.",
              ]
            : ["Zdywersyfikuj: dodaj kanał referral (guest posts) i newsletter."],
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
      element: "Kraje",
      severity: topPct > 0.9 ? "info" : "good",
      title: `Dominuje: ${top?.dims[0] ?? "?"} (${(topPct * 100).toFixed(0)}%)`,
      detail: `${rows.length} krajów w wynikach.`,
      fixes:
        topPct > 0.9
          ? [
              "Rozważ wersję językową dla drugiego rynku - system i18n (PL/EN) już masz.",
              "Dodaj hreflang w head - Google skieruje właściwy język per kraj.",
            ]
          : ["Zdywersyfikowany geograficznie ruch - dobrze. Utrzymaj hreflang."],
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
      element: "Urządzenia",
      severity: "info",
      title: `Mobile ${(mobilePct * 100).toFixed(0)}% ruchu`,
      detail: `Mobile: ${mobile ? num(mobile.metrics[idx]) : 0}, desktop: ${desktop ? num(desktop.metrics[idx]) : 0}.`,
      fixes:
        mobilePct > 0.6
          ? [
              "Priorytet mobile-first: LCP < 2.5 s i INP < 200 ms na 4G.",
              "Sprawdź czy sticky elementy nie zjadają viewportu na 360×640.",
            ]
          : [
              "Desktop-heavy - zadbaj o czytelność na dużych ekranach (max-width contentu, line-length 60-75 znaków).",
            ],
    });
  }

  // 7. Radar zaangażowania
  if (Object.keys(engage).length > 0) {
    const asd = engage.averageSessionDuration ?? 0;
    const bounce = engage.bounceRate ?? 0;
    const spv = engage.screenPageViewsPerSession ?? 0;
    out.push({
      id: "engagement-radar",
      element: "Zaangażowanie (radar)",
      severity: bounce > 0.6 ? "warn" : spv < 1.5 ? "warn" : "good",
      title: `Śr. czas ${asd.toFixed(0)}s · ${spv.toFixed(2)} odsł./sesja · bounce ${(bounce * 100).toFixed(0)}%`,
      detail: `Radar sumuje 5 wymiarów: engagement, czas sesji, odsłony/sesja, retencję (100-bounce) i eventy.`,
      fixes:
        spv < 1.5
          ? [
              "Dodaj related posts na końcu artykułu - podniesie odsłony/sesja.",
              "Skrócone CTA w połowie artykułu do powiązanych materiałów.",
            ]
          : bounce > 0.6
            ? [
                "Sprawdź LCP + CLS - najczęstszy powód bounce.",
                "Dodaj table of contents w długich wpisach - zatrzymuje usera dłużej.",
              ]
            : ["Zaangażowanie w normie - dobra jakość ruchu."],
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
      element: "Top strony",
      severity: weakTop >= 3 ? "warn" : "info",
      title: `Top 10 stron: ${10 - weakTop} zaangażowanych, ${weakTop} słabych`,
      detail: `Słabe = engagement rate < 35%. Wysoki traffic + niski engagement = strona przyciąga zły intent.`,
      fixes:
        weakTop >= 3
          ? [
              "Przepisz H1 + pierwszy akapit tych stron - musi odpowiadać na frazę, którą wpisał user.",
              "Zbadaj GSC dla tych URL - może rankują na frazę, której nie chcesz.",
              "Dodaj CTA i internal links do powiązanych treści.",
            ]
          : ["Utrzymaj format zwycięskich stron - użyj go jako template."],
    });
  }

  return out;
}

/**
 * Generator interpretacji dla warstwy semantycznej - zasila istniejącą
 * `InsightSection` (ten sam prymityw, co GA4 / GSC / Web Vitals), więc admin
 * czyta wnioski w jednym, znanym formacie.
 *
 * Reguła: insight powstaje wyłącznie wtedy, gdy jest DECYZJA do podjęcia.
 * Dryf wynikający z konstrukcji strumieni (sesje per karta, filtrowanie botów)
 * nie generuje wpisu - inaczej panel produkowałby stały szum, w którym prawdziwa
 * rozbieżność by ginęła.
 */
import type { TFunction } from "i18next";
import type { Insight } from "@/components/admin/analytics/InsightSection";
import { metricById, streamById, type ReconciliationEntry } from "@/lib/analytics/semantic";
import { chartLangOf, formatMetricValue, formatSpread } from "@/lib/analytics/semantic/format";
import type { SemanticSnapshotResult } from "@/lib/analytics/semantic/snapshot.functions";
import "@/lib/i18n-admin-semantic";

/** Ile luk w danych raportujemy, zanim lista przestanie być czytelna. */
const MAX_GAP_INSIGHTS = 2;

/** Metryki, których brak jest istotny dla raportu zarządczego. */
const CORE_METRIC_IDS = new Set(["sessions", "visitors", "page_views", "content_views"]);

export interface BuildSemanticInsightsParams {
  snapshot: SemanticSnapshotResult;
  t: TFunction;
  /** Kod języka i18n - decyduje o formacie liczb i etykiet. */
  language?: string;
}

export function buildSemanticInsights({
  snapshot,
  t,
  language,
}: BuildSemanticInsightsParams): Insight[] {
  const out: Insight[] = [];
  const lang = chartLangOf(language);
  const isEn = (language ?? "").toLowerCase().startsWith("en");
  const B = "adminAnalytics.semantic.insights";
  const element = t(`${B}.element`);
  const arr = (key: string): string[] => t(key, { returnObjects: true }) as string[];
  const metricLabel = (entry: ReconciliationEntry): string => {
    const m = metricById(entry.metricId);
    return isEn ? m.labelEn : m.labelPl;
  };

  // 1. Okno, na którym porównanie międzystrumieniowe byłoby nieuczciwe.
  if (!snapshot.window.crossStreamSafe) {
    out.push({
      id: "semantic-window",
      element,
      severity: "warn",
      title: t(`${B}.windowTitle`),
      detail: t(`${B}.windowDetail`),
      fixes: arr(`${B}.windowFixes`),
    });
  }

  // 2. Brak strumienia autorytatywnego dla ruchu.
  if (!snapshot.ga4Configured) {
    out.push({
      id: "semantic-ga4-missing",
      element,
      severity: "critical",
      title: t(`${B}.ga4MissingTitle`),
      detail: t(`${B}.ga4MissingDetail`),
      fixes: arr(`${B}.ga4MissingFixes`),
    });
  }

  // 3. Odwrócona relacja wielkości - błąd konfiguracji, nie dryf.
  for (const entry of snapshot.entries) {
    if (entry.verdict !== "order_inverted") continue;
    out.push({
      id: `semantic-inverted-${entry.metricId}`,
      element,
      severity: "critical",
      title: t(`${B}.invertedTitle`, { metric: metricLabel(entry) }),
      detail: t(`${B}.invertedDetail`),
      fixes: arr(`${B}.invertedFixes`),
    });
  }

  // 4. Rozjazd poza pasmem tolerancji metryki.
  for (const entry of snapshot.entries) {
    if (entry.verdict !== "divergent") continue;
    const metric = metricById(entry.metricId);
    out.push({
      id: `semantic-divergent-${entry.metricId}`,
      element,
      severity: "warn",
      title: t(`${B}.divergentTitle`, {
        metric: metricLabel(entry),
        spread: formatSpread(entry.spread, lang, "?").replace(/\s*%$/, ""),
      }),
      detail: t(`${B}.divergentDetail`, {
        stream: isEn
          ? streamById(entry.authoritativeStream).labelEn
          : streamById(entry.authoritativeStream).labelPl,
        value: formatMetricValue(entry.canonicalValue, metric.unit, lang),
        spread: formatSpread(entry.spread, lang, "?").replace(/\s*%$/, ""),
        tolerance: Math.round(metric.driftTolerance * 100),
      }),
      fixes: arr(`${B}.divergentFixes`),
    });
  }

  // 5. Luki w danych dla metryk kluczowych (ograniczone, żeby nie zaszumiać).
  const gaps = snapshot.entries
    .filter((e) => e.verdict === "unavailable" && CORE_METRIC_IDS.has(e.metricId))
    .slice(0, MAX_GAP_INSIGHTS);
  for (const entry of gaps) {
    out.push({
      id: `semantic-gap-${entry.metricId}`,
      element,
      severity: "info",
      title: t(`${B}.gapTitle`, { metric: metricLabel(entry) }),
      detail: t(`${B}.gapDetail`, {
        stream: isEn
          ? streamById(entry.authoritativeStream).labelEn
          : streamById(entry.authoritativeStream).labelPl,
      }),
      fixes: arr(`${B}.gapFixes`),
    });
  }

  // 6. Wszystko uzgodnione - potwierdzenie, że liczby są gotowe do raportu.
  if (out.length === 0) {
    out.push({
      id: "semantic-aligned",
      element,
      severity: "good",
      title: t(`${B}.alignedTitle`),
      detail: t(`${B}.alignedDetail`),
      fixes: arr(`${B}.alignedFixes`),
    });
  }

  return out;
}

// Canonical Core Web Vitals thresholds + rating, shared by the client reporter
// (src/lib/webVitals.ts) and the server-side aggregator (./aggregate.ts) so the
// "good / needs-improvement / poor" boundaries never drift between ingest and
// analytics. Thresholds follow Google's published Web Vitals guidance: a value
// at or below the first number is "good", at or below the second is
// "needs-improvement", above is "poor".

import type { ChartSource } from "@/lib/charts/sources";

export type VitalName = "LCP" | "CLS" | "INP" | "FCP" | "TTFB" | "FID";
export type VitalRating = "good" | "needs-improvement" | "poor";

export const VITAL_THRESHOLDS: Record<VitalName, readonly [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  FID: [100, 300],
};

// Display order: the three Core Web Vitals first (LCP, INP, CLS), then the
// diagnostic metrics. Used to order the analytics dashboard deterministically.
export const VITAL_ORDER: readonly VitalName[] = ["LCP", "INP", "CLS", "FCP", "TTFB", "FID"];

/** True when a raw metric string is one of the known Web Vitals names. */
export function isVitalName(s: string): s is VitalName {
  return Object.prototype.hasOwnProperty.call(VITAL_THRESHOLDS, s);
}

/** Rate a single metric value against its Web Vitals thresholds. */
export function rateVital(name: VitalName, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

/** Display unit for a metric ("ms" for time metrics, "" for the unitless CLS). */
export function vitalUnit(name: VitalName): "ms" | "" {
  return name === "CLS" ? "" : "ms";
}

/**
 * ŹRÓDŁA PROGÓW - przedział oceny bez źródła nie istnieje (patrz
 * `effectiveBand` w `src/lib/charts/status.ts`). Progi „good" pochodzą
 * z dokumentacji Google na web.dev; daty publikacji i aktualizacji przepisane
 * ze stron, data dostępu to dzień weryfikacji progów z tymi stronami.
 * Wiarygodność A: Google definiuje te metryki, więc to źródło pierwotne.
 */
const WEB_VITALS_SOURCE: ChartSource = {
  id: "web-vitals",
  author: "Walton, Philip",
  title: "Web Vitals",
  container: "web.dev",
  publisher: "Google",
  published: "2020-05-04 (aktualizacja 2024-10-31)",
  accessed: "2026-10-09",
  url: "https://web.dev/articles/vitals",
  reliability: "A",
};

export const VITAL_THRESHOLD_SOURCES: Partial<Record<VitalName, ChartSource>> = {
  LCP: WEB_VITALS_SOURCE,
  INP: WEB_VITALS_SOURCE,
  CLS: WEB_VITALS_SOURCE,
  FCP: {
    id: "web-vitals-fcp",
    author: "Walton, Philip",
    title: "First Contentful Paint (FCP)",
    container: "web.dev",
    publisher: "Google",
    published: "aktualizacja 2023-12-06",
    accessed: "2026-10-09",
    url: "https://web.dev/articles/fcp",
    reliability: "A",
  },
  TTFB: {
    id: "web-vitals-ttfb",
    author: "Pollard, Barry, i Jeremy Wagner",
    title: "Time to First Byte (TTFB)",
    container: "web.dev",
    publisher: "Google",
    published: "2021-10-26",
    accessed: "2026-10-09",
    url: "https://web.dev/articles/ttfb",
    reliability: "A",
  },
};

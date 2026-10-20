// POWIERZCHNIE SYGNAŁÓW DIAGNOSTYKI (SPEC §2.7) - który ekran modułu pokazuje
// które obszary huba w `RevenueSignalChip`.
//
// Ekrany modułów (paywall, cennik, członkostwo, kupony, newsletter, CRM,
// automatyzacje, rozliczenia, wydarzenia, kluby) montują chip w I9 - tu jest
// wyłącznie MAPA i wybór diagnoz, żeby ekran nie składał listy obszarów sam
// (ta sama lista w dwóch miejscach rozjechałaby się przy nowej regule).
// Czysty moduł: bez hooków i bez I/O.
import type { RevenueArea, RevenueSeverity } from "@/lib/admin/revenue/hubTabs";
import { compareFindings, isOpenFinding, type RevenueFinding } from "./registry";

/** Ekran modułu → obszary diagnostyki, które go dotyczą (SPEC §2.7). */
export const SIGNAL_SURFACES = {
  paywall: ["catalog", "paywall", "metering", "checkout"],
  pricing: ["catalog", "retention", "checkout"],
  membership: ["catalog", "clubs"],
  coupons: ["coupons"],
  newsletter: ["newsletter", "funnel"],
  crm: ["crm", "dunning"],
  workflows: ["workflows", "journeys"],
  billing: ["dunning", "data_quality", "catalog"],
  events: ["events"],
  clubs: ["clubs"],
} as const satisfies Readonly<Record<string, readonly RevenueArea[]>>;
export type SignalSurface = keyof typeof SIGNAL_SURFACES;

/** Otwarte diagnozy (problem bez wyciszenia) w obszarach - od najpoważniejszej. */
export function findingsForAreas(
  findings: readonly RevenueFinding[],
  areas: readonly RevenueArea[],
): RevenueFinding[] {
  return findings
    .filter((f) => areas.includes(f.area) && isOpenFinding(f))
    .sort(compareFindings);
}

export interface SignalSummary {
  open: number;
  critical: number;
  warning: number;
  info: number;
  /** Najpoważniejsza waga wśród otwartych albo `null` (brak problemów). */
  worst: RevenueSeverity | null;
  /** Reguły tych obszarów, których dziś nie da się ocenić. */
  unknown: number;
}

/** Podsumowanie chipu: liczby per waga i „nie wiadomo" (nigdy cicha zieleń). */
export function signalSummary(
  findings: readonly RevenueFinding[],
  areas: readonly RevenueArea[],
): SignalSummary {
  const scoped = findings.filter((f) => areas.includes(f.area));
  const open = scoped.filter(isOpenFinding);
  const count = (severity: RevenueSeverity) => open.filter((f) => f.severity === severity).length;
  const critical = count("critical");
  const warning = count("warning");
  const info = count("info");
  return {
    open: open.length,
    critical,
    warning,
    info,
    worst: critical > 0 ? "critical" : warning > 0 ? "warning" : info > 0 ? "info" : null,
    unknown: scoped.filter((f) => f.state === "unknown").length,
  };
}

// GRUPOWANIE I FILTRY DIAGNOZ (S7, SPEC §2.2 „Diagnostyka", §6.1) - czysta
// logika listy `DiagnosticsBoard`, karty „Wymaga uwagi" i kondycji obszarów.
//
// JEDNA OCENA, WIELE WIDOKÓW. Komponenty nie liczą „otwarte", „wyciszone"
// i „kondycja" po swojemu: lista, karta Kokpitu i chip w module dostają te
// same funkcje, więc liczba w nagłówku, na pasku i w module jest jedna.
//
// KONDYCJA = `areaHealthScore` (S6, skala `brandAuditScore`: krytyczna −20,
// ważna −7) z OTWARTYCH diagnoz obszaru. Obszar, którego żadnej reguły nie
// da się dziś ocenić (brak faktów), ma kondycję `null` - „brak danych", nie
// 100 (`AreaHealthList` pokazuje to słowem).
import {
  REVENUE_AREAS,
  REVENUE_SEVERITIES,
  areaHealthScore,
  type RevenueArea,
  type RevenueSeverity,
} from "@/lib/admin/revenue/hubTabs";
import {
  compareFindings,
  isOpenFinding,
  type RevenueFinding,
} from "@/lib/revenue/diagnostics/registry";

/** Stan w filtrze listy: otwarte, wyciszone, w porządku, nie wiadomo albo wszystkie. */
export const DIAGNOSTIC_STATE_FILTERS = ["open", "snoozed", "ok", "unknown", "all"] as const;
export type DiagnosticStateFilter = (typeof DIAGNOSTIC_STATE_FILTERS)[number];

export interface DiagnosticFilters {
  area: RevenueArea | null;
  severity: RevenueSeverity | null;
  state: DiagnosticStateFilter;
}

export const DEFAULT_DIAGNOSTIC_FILTERS: DiagnosticFilters = {
  area: null,
  severity: null,
  state: "open",
};

export function isRevenueArea(raw: unknown): raw is RevenueArea {
  return typeof raw === "string" && (REVENUE_AREAS as readonly string[]).includes(raw);
}

export function isRevenueSeverity(raw: unknown): raw is RevenueSeverity {
  return typeof raw === "string" && (REVENUE_SEVERITIES as readonly string[]).includes(raw);
}

/** Stan diagnozy w języku filtra. */
export function stateOf(finding: RevenueFinding): Exclude<DiagnosticStateFilter, "all"> {
  if (finding.state === "unknown") return "unknown";
  if (finding.state === "ok") return "ok";
  return finding.snooze === null ? "open" : "snoozed";
}

export function matchesFilters(finding: RevenueFinding, filters: DiagnosticFilters): boolean {
  if (filters.area !== null && finding.area !== filters.area) return false;
  if (filters.severity !== null && finding.severity !== filters.severity) return false;
  return filters.state === "all" || stateOf(finding) === filters.state;
}

/** Diagnozy po filtrach, od najpoważniejszej (waga, skutek trwający, wpływ). */
export function filterFindings(
  findings: readonly RevenueFinding[],
  filters: DiagnosticFilters,
): RevenueFinding[] {
  return findings.filter((f) => matchesFilters(f, filters)).sort(compareFindings);
}

export interface StateCounts {
  open: number;
  snoozed: number;
  ok: number;
  unknown: number;
  all: number;
}

export function stateCounts(findings: readonly RevenueFinding[]): StateCounts {
  const counts: StateCounts = { open: 0, snoozed: 0, ok: 0, unknown: 0, all: findings.length };
  for (const finding of findings) counts[stateOf(finding)] += 1;
  return counts;
}

export interface AreaHealth {
  area: RevenueArea;
  /** 0-100 albo `null` (żadnej reguły obszaru nie da się ocenić). */
  score: number | null;
  counts: { critical: number; warning: number; info: number };
}

/** Kondycja obszaru z otwartych diagnoz (wyciszone nie obniżają wyniku). */
export function areaHealth(findings: readonly RevenueFinding[], area: RevenueArea): AreaHealth {
  const scoped = findings.filter((f) => f.area === area);
  const open = scoped.filter(isOpenFinding);
  const counts = {
    critical: open.filter((f) => f.severity === "critical").length,
    warning: open.filter((f) => f.severity === "warning").length,
    info: open.filter((f) => f.severity === "info").length,
  };
  const known = scoped.some((f) => f.state !== "unknown");
  return { area, score: known ? areaHealthScore(counts) : null, counts };
}

/** Kondycja każdego obszaru w kolejności `REVENUE_AREAS` (lista Kokpitu). */
export function areaHealthList(findings: readonly RevenueFinding[]): AreaHealth[] {
  return REVENUE_AREAS.map((area) => areaHealth(findings, area));
}

export interface FindingGroup {
  area: RevenueArea;
  health: AreaHealth;
  findings: RevenueFinding[];
}

/** Grupy listy po obszarze (puste pominięte) - kolejność `REVENUE_AREAS`. */
export function groupFindingsByArea(
  findings: readonly RevenueFinding[],
  filters: DiagnosticFilters,
): FindingGroup[] {
  const visible = filterFindings(findings, filters);
  return REVENUE_AREAS.map((area) => ({
    area,
    health: areaHealth(findings, area),
    findings: visible.filter((f) => f.area === area),
  })).filter((group) => group.findings.length > 0);
}

/** „Wymaga uwagi" (Kokpit): najpoważniejsze otwarte diagnozy, domyślnie trzy. */
export function topAttention(findings: readonly RevenueFinding[], limit = 3): RevenueFinding[] {
  return findings.filter(isOpenFinding).sort(compareFindings).slice(0, Math.max(0, limit));
}

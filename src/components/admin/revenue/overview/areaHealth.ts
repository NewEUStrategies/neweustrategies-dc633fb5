// Kondycja obszarów Kokpitu z diagnoz S7-A (SPEC §2.2 `overview`).
//
// Liczone są wyłącznie diagnozy OTWARTE (`isOpenFinding`) - wyciszona sprawa
// nie obniża wyniku, bo admin świadomie ją odłożył. Wynik `areaHealthScore`
// z `hubTabs.ts` (ta sama skala co audyt marki). Obszar bez faktów to
// `score: null` - brak danych, nie 100.
import type { AreaHealthGroup } from "@/components/admin/revenue/molecules/AreaHealthList";
import { REVENUE_AREAS, areaHealthScore } from "@/lib/admin/revenue/hubTabs";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import { isOpenFinding, type RevenueFinding } from "@/lib/revenue/diagnostics/registry";

/** Grupy listy kondycji z diagnoz - każdy obszar huba, w kolejności `REVENUE_AREAS`. */
export function areaHealthGroups(
  facts: RevenueFacts,
  findings: readonly RevenueFinding[],
): AreaHealthGroup[] {
  return REVENUE_AREAS.map((area) => {
    const open = findings.filter((f) => f.area === area && isOpenFinding(f));
    const counts = {
      critical: open.filter((f) => f.severity === "critical").length,
      warning: open.filter((f) => f.severity === "warning").length,
      info: open.filter((f) => f.severity === "info").length,
    };
    const known = facts.areas[area] !== undefined && facts.areas[area] !== null;
    return { group: area, score: known ? areaHealthScore(counts) : null, counts };
  });
}

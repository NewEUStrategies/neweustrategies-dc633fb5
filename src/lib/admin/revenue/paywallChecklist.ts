// Lista kontrolna paywalla na zakładce Dostęp (SPEC §2.2 `access`, karta S7).
//
// TE SAME REGUŁY CO DIAGNOSTYKA. Lista nie ma własnych warunków: to reguły
// rejestru S7-A z obszarów `paywall`, `metering` i `checkout`, ocenione na
// tych samych faktach (`revenueFactsQueryOptions`) i wyciszeniach. Druga
// kopia warunków („czy licznik ma ustawienia") rozjechałaby się z Diagnostyką
// przy pierwszej zmianie reguły - admin zobaczyłby „gotowe" na Dostępie
// i „krytyczne" w Diagnostyce dla tej samej sprawy.
//
// KAŻDA REGUŁA OBSZARU JEST POZYCJĄ - także `unknown`. Lista bez pozycji,
// której nie dało się ocenić, wyglądałaby na komplet zielonych; „nie wiadomo"
// mówi adminowi, że fakt nie dotarł (np. migracja w drodze).
//
// AKCJA BEZ DRUGIEGO DIALOGU. Naprawa w dialogu prowadzi do Diagnostyki
// z `?fix=` (tam mieszka dialog, ponowna ocena i „Cofnij"); naprawa-odnośnik
// i naprawa w kodzie - do ekranu-właściciela.
//
// MODUŁ CZYSTY (wyłącznie `import type`).
import type { RevenueArea, RevenueSeverity } from "@/lib/admin/revenue/hubTabs";
import type { RevenueCheckId, RevenueFinding } from "@/lib/revenue/diagnostics/registry";

/** Obszary listy kontrolnej - kolejność jak droga czytelnika: ściana, licznik, kasa. */
export const PAYWALL_CHECKLIST_AREAS = [
  "paywall",
  "metering",
  "checkout",
] as const satisfies readonly RevenueArea[];

export type PaywallChecklistStatus = "done" | "todo" | "snoozed" | "unknown";

export interface PaywallChecklistAction {
  to: string;
  search?: Readonly<Record<string, string>>;
}

export interface PaywallChecklistItem {
  checkId: RevenueCheckId;
  area: RevenueArea;
  severity: RevenueSeverity;
  status: PaywallChecklistStatus;
  /** Liczba obiektów diagnozy (`null` = reguła jej nie podaje). */
  count: number | null;
  /** Dokąd prowadzi „Napraw" - `null` dla pozycji gotowej i nieznanej. */
  action: PaywallChecklistAction | null;
}

export interface PaywallChecklistSummary {
  total: number;
  done: number;
  todo: number;
  snoozed: number;
  unknown: number;
}

const AREA_ORDER: Readonly<Record<string, number>> = Object.fromEntries(
  PAYWALL_CHECKLIST_AREAS.map((area, index) => [area, index]),
);

const SEVERITY_ORDER: Readonly<Record<RevenueSeverity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function statusOf(finding: RevenueFinding): PaywallChecklistStatus {
  if (finding.state === "ok") return "done";
  if (finding.state === "unknown") return "unknown";
  return finding.snooze === null ? "todo" : "snoozed";
}

function actionOf(finding: RevenueFinding): PaywallChecklistAction {
  const fix = finding.fix;
  if (fix?.kind === "dialog") {
    return { to: "/admin/revenue/diagnostics", search: { fix: finding.checkId } };
  }
  if (fix?.kind === "link") return { to: fix.to, ...(fix.search ? { search: fix.search } : {}) };
  return {
    to: finding.owner.to,
    ...(finding.owner.search ? { search: finding.owner.search } : {}),
  };
}

/**
 * Pozycje listy z diagnoz obszarów paywalla. Kolejność: obszar (ściana →
 * licznik → kasa), potem waga - najpierw to, co blokuje sprzedaż.
 */
export function paywallChecklist(findings: readonly RevenueFinding[]): PaywallChecklistItem[] {
  return findings
    .filter((finding) => finding.area in AREA_ORDER)
    .map((finding): PaywallChecklistItem => {
      const status = statusOf(finding);
      return {
        checkId: finding.checkId,
        area: finding.area,
        severity: finding.severity,
        status,
        count: finding.count,
        action: status === "todo" || status === "snoozed" ? actionOf(finding) : null,
      };
    })
    .sort(
      (a, b) =>
        (AREA_ORDER[a.area] ?? 0) - (AREA_ORDER[b.area] ?? 0) ||
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.checkId.localeCompare(b.checkId),
    );
}

/** Podsumowanie nad listą - „4 z 9 gotowe" bez liczenia nieznanych jako gotowych. */
export function paywallChecklistSummary(
  items: readonly PaywallChecklistItem[],
): PaywallChecklistSummary {
  const summary: PaywallChecklistSummary = {
    total: items.length,
    done: 0,
    todo: 0,
    snoozed: 0,
    unknown: 0,
  };
  for (const item of items) summary[item.status] += 1;
  return summary;
}

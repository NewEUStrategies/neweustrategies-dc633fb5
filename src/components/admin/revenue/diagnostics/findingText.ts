// Napisy diagnozy - jedno miejsce budowania kluczy słownika diagnostyki.
//
// Klucze reguł i dowodów składamy z identyfikatorów, bo rejestr ma 55 reguł
// i kilkadziesiąt rodzajów dowodów - jawna mapa byłaby drugą kopią
// `REVENUE_CHECK_IDS`. Bramka `i18nKeyDrift` sprawdza takie gałęzie
// dynamiczne (`adminRevenue.checks.*`, `adminRevenue.evidence.*`): obie
// istnieją i mają w PL i EN ten sam zbiór podkluczy, a test słownika
// (`i18n.test.ts`) pilnuje, że KAŻDY identyfikator ma swój napis.
import type { TFunction } from "i18next";

import type { RevenueEvidence } from "@/lib/revenue/diagnostics/facts";
import type { RevenueCheckId, RevenueFinding } from "@/lib/revenue/diagnostics/registry";

export function checkTitle(t: TFunction, id: RevenueCheckId): string {
  return t(`adminRevenue.checks.${id}.title`);
}

export function checkDescription(t: TFunction, id: RevenueCheckId): string {
  return t(`adminRevenue.checks.${id}.description`);
}

export function evidenceText(t: TFunction, evidence: RevenueEvidence): string {
  return t(`adminRevenue.evidence.${evidence.key}`, evidence.params);
}

/** Dowody diagnozy jednym zdaniem (komunikat po naprawie, opis zgłoszenia). */
export function evidenceSentence(t: TFunction, finding: Pick<RevenueFinding, "evidence">): string {
  return finding.evidence.map((e) => evidenceText(t, e)).join("; ");
}

/** Stan karty: wyciszenie ma pierwszeństwo przed stanem reguły. */
export type FindingBadge = "error" | "warn" | "unknown" | "ok" | "snoozed";

export function badgeOf(finding: Pick<RevenueFinding, "state" | "snooze">): FindingBadge {
  if (finding.snooze !== null && (finding.state === "warn" || finding.state === "error")) {
    return "snoozed";
  }
  return finding.state;
}

export const BADGE_KEY: Readonly<Record<FindingBadge, string>> = {
  error: "adminRevenue.diagnostics.stateBadge.error",
  warn: "adminRevenue.diagnostics.stateBadge.warn",
  unknown: "adminRevenue.diagnostics.stateBadge.unknown",
  ok: "adminRevenue.diagnostics.stateBadge.ok",
  snoozed: "adminRevenue.diagnostics.stateBadge.snoozed",
};

/** Adres naprawy-odnośnika z parametrem z pierwszego `refs` (szablon ścieżki). */
export function linkSearchOf(
  fix: { search?: Readonly<Record<string, string>>; refParam?: string },
  refs: readonly string[],
): Record<string, string> | undefined {
  const search: Record<string, string> = { ...(fix.search ?? {}) };
  if (fix.refParam && refs[0]) search[fix.refParam] = refs[0];
  return Object.keys(search).length > 0 ? search : undefined;
}

/** Element listy zogniskowany adresem `?finding=` - stabilny identyfikator DOM. */
export function findingDomId(id: RevenueCheckId): string {
  return `revenue-finding-${id.replace(".", "-")}`;
}

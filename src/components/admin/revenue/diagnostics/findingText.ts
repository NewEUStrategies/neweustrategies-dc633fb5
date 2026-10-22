// Napisy diagnozy i czyste pomocniki Diagnostyki - jedno miejsce budowania
// kluczy słownika diagnostyki i wyboru diagnozy z adresu.
//
// Klucze reguł i dowodów składamy z identyfikatorów, bo rejestr ma 55 reguł
// i kilkadziesiąt rodzajów dowodów - jawna mapa byłaby drugą kopią
// `REVENUE_CHECK_IDS`. Bramka `i18nKeyDrift` sprawdza takie gałęzie
// dynamiczne (`adminRevenue.checks.*`, `adminRevenue.evidence.*`): obie
// istnieją i mają w PL i EN ten sam zbiór podkluczy, a test słownika
// (`i18n.test.ts`) pilnuje, że KAŻDY identyfikator ma swój napis.
//
// Moduł BEZ komponentów: importują go tablica, karta, dialogi i lista
// kontrolna Dostępu (S7.2), a szybkie odświeżanie Vite działa tylko dla
// plików eksportujących same komponenty.
import type { TFunction } from "i18next";

import type { RevenueEvidence, RevenueImpact } from "@/lib/revenue/diagnostics/facts";
import {
  isRevenueCheckId,
  isRevenueFixDialogId,
  type RevenueCheckId,
  type RevenueFinding,
} from "@/lib/revenue/diagnostics/registry";

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

/** Reguła widzi problem (`warn`/`error`) - niezależnie od wyciszenia. */
export function isProblem(finding: Pick<RevenueFinding, "state">): boolean {
  return finding.state === "warn" || finding.state === "error";
}

/** Stan karty: wyciszenie ma pierwszeństwo przed stanem reguły. */
export type FindingBadge = "error" | "warn" | "unknown" | "ok" | "snoozed";

export function badgeOf(finding: Pick<RevenueFinding, "state" | "snooze">): FindingBadge {
  if (finding.snooze !== null && isProblem(finding)) return "snoozed";
  return finding.state;
}

export const BADGE_KEY: Readonly<Record<FindingBadge, string>> = {
  error: "adminRevenue.diagnostics.stateBadge.error",
  warn: "adminRevenue.diagnostics.stateBadge.warn",
  unknown: "adminRevenue.diagnostics.stateBadge.unknown",
  ok: "adminRevenue.diagnostics.stateBadge.ok",
  snoozed: "adminRevenue.diagnostics.stateBadge.snoozed",
};

export const IMPACT_KEY: Readonly<Record<RevenueImpact, string>> = {
  high: "adminRevenue.diagnostics.card.impact.high",
  medium: "adminRevenue.diagnostics.card.impact.medium",
  low: "adminRevenue.diagnostics.card.impact.low",
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

/**
 * Diagnoza wskazana w `?fix=` - id reguły albo dialogu naprawy (SPEC §2.6).
 * Dla id dialogu wybieramy regułę, która DZIŚ widzi problem (jeden dialog
 * obsługuje np. dwie reguły paywalla), a dopiero potem pierwszą pasującą -
 * żeby „Ten problem już nie występuje" mówiło prawdę o całym dialogu.
 */
export function findingForFix(
  findings: readonly RevenueFinding[],
  fix: string | undefined,
): RevenueFinding | null {
  if (!fix) return null;
  if (isRevenueCheckId(fix)) return findings.find((f) => f.checkId === fix) ?? null;
  if (isRevenueFixDialogId(fix)) {
    const matches = findings.filter((f) => f.fix?.kind === "dialog" && f.fix.dialog === fix);
    return matches.find(isProblem) ?? matches[0] ?? null;
  }
  return null;
}

/**
 * Opis zgłoszenia naprawy w kodzie („Zgłoś do zespołu"): tytuł, identyfikator
 * zgłoszenia, stan, dowody i chwila faktów - bez danych osobowych (fakty ich
 * nie niosą), więc tekst można wkleić do dowolnego narzędzia zespołu.
 */
export function reportBodyOf(
  t: TFunction,
  finding: RevenueFinding,
  factsAt: string | null,
): string {
  return t("adminRevenue.diagnostics.card.reportBody", {
    title: checkTitle(t, finding.checkId),
    id: finding.fix?.kind === "code" ? finding.fix.issueRef : finding.checkId,
    state: t(BADGE_KEY[badgeOf(finding)]),
    evidence: evidenceSentence(t, finding) || "-",
    at: factsAt ?? "-",
  });
}

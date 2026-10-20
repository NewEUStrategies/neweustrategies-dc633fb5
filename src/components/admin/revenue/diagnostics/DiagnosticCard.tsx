// Molekuła: jedna diagnoza (SPEC §6.1 `DiagnosticCard`) - w liście Diagnostyki
// (`full`) i w karcie „Wymaga uwagi" na Kokpicie (`compact`).
//
// CO, DLACZEGO, CO ZROBIĆ. Nagłówek mówi, co jest nie tak (tytuł reguły,
// waga słowem i ikoną, obszar, stan: „Skutek trwa" / „Do poprawy" / „Nie
// wiadomo" / „Wyciszone"); dowody - dlaczego tak uważamy (liczby z faktów,
// bez danych osobowych); akcje - co zrobić: „Napraw" (dialog z mutatorem
// modułu), „Przejdź do naprawy" (odnośnik z parametrami kontraktu) albo
// „Zgłoś do zespołu" (naprawa w kodzie - kopiuje opis z dowodami), plus
// „Otwórz moduł" i wyciszenie.
//
// WYCISZENIE TYLKO DLA ADMINISTRATORA (SPEC §2.5): redaktor widzi przycisk
// wyłączony z powodem (`DisabledReason`), a reguła krytyczna `sync`/
// `data_quality` - powód „niewyciszalna". Ten sam warunek egzekwuje SQL.
//
// Kolor nigdy sam: stan i waga mają słowo; ramka karty zmienia wyłącznie
// kolor tokenu (geometria identyczna w obu motywach).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { AreaChip } from "@/components/admin/revenue/atoms/AreaChip";
import { SeverityLabel } from "@/components/admin/revenue/atoms/SeverityLabel";
import { Button } from "@/components/ui/button";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import type { RevenueFinding } from "@/lib/revenue/diagnostics/registry";
import type { SnoozeKind } from "@/lib/revenue/limits";
import { cn } from "@/lib/utils";
import {
  BADGE_KEY,
  badgeOf,
  checkDescription,
  checkTitle,
  evidenceSentence,
  evidenceText,
  findingDomId,
  linkSearchOf,
} from "./findingText";

export interface DiagnosticCardProps {
  finding: RevenueFinding;
  variant: "full" | "compact";
  /** Dialog naprawy (tylko `fix.kind = "dialog"`). */
  onFix?(): void;
  onSnooze?(kind: SnoozeKind): void;
  onUnsnooze?(): void;
  /** Rola administratora (wyciszanie) - dokładna, nie `isAdmin`. */
  canSnooze?: boolean;
  /** Zogniskowana adresem `?finding=`. */
  focused?: boolean;
  /** `computedAt` faktów - do opisu zgłoszenia. */
  factsAt?: string | null;
  className?: string;
}

const BADGE_TONE: Readonly<Record<ReturnType<typeof badgeOf>, string>> = {
  error: "border-destructive/40 text-destructive",
  warn: "border-border text-brand-ink dark:text-brand",
  unknown: "border-border text-muted-foreground",
  ok: "border-border text-muted-foreground",
  snoozed: "border-border text-muted-foreground",
};

export function DiagnosticCard({
  finding,
  variant,
  onFix,
  onSnooze,
  onUnsnooze,
  canSnooze = false,
  focused = false,
  factsAt = null,
  className,
}: DiagnosticCardProps) {
  ensureShellI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const badge = badgeOf(finding);
  const compact = variant === "compact";
  const title = checkTitle(t, finding.checkId);
  const evidence = compact ? finding.evidence.slice(0, 1) : finding.evidence;
  const locale = i18n.language.startsWith("en") ? "en-GB" : "pl-PL";

  const report = async () => {
    const body = t("adminRevenue.diagnostics.card.reportBody", {
      title,
      id: finding.checkId,
      state: t(BADGE_KEY[badge]),
      evidence: evidenceSentence(t, finding) || "-",
      at: factsAt ?? "-",
    });
    try {
      await navigator.clipboard.writeText(body);
      toast.success(t("adminRevenue.diagnostics.card.reported"));
    } catch {
      toast.error(t("adminRevenue.diagnostics.card.reportFailed"));
    }
  };

  const snoozeReason = !finding.snoozable
    ? t("adminRevenue.diagnostics.card.notSnoozable")
    : canSnooze
      ? null
      : t("adminRevenue.diagnostics.card.snoozeAdminOnly");
  const showSnooze = !compact && (finding.state === "warn" || finding.state === "error");
  const snoozedUntil =
    finding.snooze?.kind === "days" && finding.snooze.until
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(finding.snooze.until))
      : null;

  return (
    <article
      id={findingDomId(finding.checkId)}
      tabIndex={-1}
      aria-labelledby={`${findingDomId(finding.checkId)}-title`}
      data-check-id={finding.checkId}
      data-state={finding.state}
      data-focused={focused || undefined}
      className={cn(
        "space-y-2 rounded-[6px] border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        focused ? "border-primary" : "border-border",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityLabel severity={finding.severity} />
        <AreaChip area={finding.area} />
        <span
          data-badge={badge}
          className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium", BADGE_TONE[badge])}
        >
          {t(BADGE_KEY[badge])}
        </span>
        {!compact && finding.count !== null && finding.count > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("adminRevenue.diagnostics.card.count", { count: finding.count })}
          </span>
        ) : null}
      </div>

      <h3 id={`${findingDomId(finding.checkId)}-title`} className="m-0 text-sm font-semibold">
        {title}
      </h3>
      {compact ? null : (
        <p className="m-0 text-sm text-muted-foreground">{checkDescription(t, finding.checkId)}</p>
      )}

      {finding.state === "unknown" ? (
        <p className="m-0 text-xs text-muted-foreground">{t("adminRevenue.diagnostics.card.unknownHint")}</p>
      ) : evidence.length > 0 ? (
        <div className="space-y-1">
          {compact ? null : (
            <p className="m-0 text-xs font-medium text-muted-foreground">
              {t("adminRevenue.diagnostics.card.evidenceLabel")}
            </p>
          )}
          <ul className="m-0 list-disc space-y-0.5 pl-5 text-sm">
            {evidence.map((item) => (
              <li key={item.key}>{evidenceText(t, item)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {finding.snooze ? (
        <p className="m-0 text-xs text-muted-foreground" data-testid="finding-snoozed">
          {snoozedUntil
            ? t("adminRevenue.diagnostics.card.snoozedUntil", { date: snoozedUntil })
            : t("adminRevenue.diagnostics.card.snoozedIntentional", { reason: finding.snooze.reason ?? "-" })}
        </p>
      ) : null}

      {finding.state === "warn" || finding.state === "error" || !compact ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {finding.fix?.kind === "dialog" && (finding.state === "warn" || finding.state === "error") ? (
            <Button type="button" size="sm" className="h-7" onClick={onFix}>
              {t("adminRevenue.diagnostics.card.fix")}
            </Button>
          ) : null}
          {finding.fix?.kind === "link" && (finding.state === "warn" || finding.state === "error") ? (
            <Button asChild size="sm" className="h-7">
              <Link to={finding.fix.to} search={linkSearchOf(finding.fix, finding.refs)}>
                {t("adminRevenue.diagnostics.card.openFix")}
              </Link>
            </Button>
          ) : null}
          {finding.fix?.kind === "code" && (finding.state === "warn" || finding.state === "error") ? (
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void report()}>
              {t("adminRevenue.diagnostics.card.report")}
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to={finding.owner.to} search={finding.owner.search}>
              {t("adminRevenue.diagnostics.card.openModule")}
            </Link>
          </Button>
          {showSnooze && finding.snooze === null ? (
            <DisabledReason reason={snoozeReason}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={snoozeReason !== null}
                onClick={() => onSnooze?.("days")}
              >
                {t("adminRevenue.diagnostics.card.snooze")}
              </Button>
            </DisabledReason>
          ) : null}
          {!compact && finding.snooze !== null ? (
            <DisabledReason reason={canSnooze ? null : t("adminRevenue.diagnostics.card.snoozeAdminOnly")}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={!canSnooze}
                onClick={onUnsnooze}
              >
                {t("adminRevenue.diagnostics.card.unsnooze")}
              </Button>
            </DisabledReason>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

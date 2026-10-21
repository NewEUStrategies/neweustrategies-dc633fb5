// Molekuła: jedna diagnoza (SPEC §6.1 `DiagnosticCard`) - w liście Diagnostyki
// (`full`) i w karcie „Wymaga uwagi" na Kokpicie (`compact`).
//
// CO, DLACZEGO, CO ZROBIĆ. Nagłówek mówi, co jest nie tak (tytuł reguły,
// waga słowem i ikoną, obszar, stan: „Skutek trwa" / „Do poprawy" / „Nie
// wiadomo" / „Wyciszone", wpływ); dowody - dlaczego tak uważamy (liczby
// z faktów, bez danych osobowych); akcje - co zrobić: „Napraw" (dialog
// z mutatorem modułu), „Przejdź do naprawy" (odnośnik z parametrami
// kontraktu) albo „Zgłoś do zespołu" (naprawa w kodzie - kopiuje opis
// z dowodami), plus „Otwórz moduł" i wyciszenie.
//
// WYCISZENIE TYLKO DLA ADMINISTRATORA (SPEC §2.5): redaktor widzi przycisk
// wyłączony z powodem (`DisabledReason` = `Tooltip` + tekst dla czytnika),
// a reguła krytyczna `sync`/`data_quality` - powód „niewyciszalna". Ten sam
// warunek egzekwuje SQL (`admin_revenue_diagnostic_snooze`).
//
// „ZGŁOŚ DO ZESPOŁU" BEZ TOASTU. Wynik kopiowania mówi karta w swoim miejscu
// (`role="status"`); gdy przeglądarka odmówi schowka (brak uprawnienia,
// kontekst bez HTTPS), karta pokazuje opis w polu tylko do odczytu, żeby
// dało się go zaznaczyć ręcznie - komunikat bez tekstu byłby ślepą uliczką.
//
// Kolor nigdy sam: stan i waga mają słowo; ramka karty zmienia wyłącznie
// kolor tokenu (geometria identyczna w obu motywach).
import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { DisabledReason } from "@/components/admin/pricing/atoms/DisabledReason";
import { AreaChip } from "@/components/admin/revenue/atoms/AreaChip";
import { SeverityLabel } from "@/components/admin/revenue/atoms/SeverityLabel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import type { RevenueFinding } from "@/lib/revenue/diagnostics/registry";
import type { SnoozeKind } from "@/lib/revenue/limits";
import { cn } from "@/lib/utils";
import {
  BADGE_KEY,
  IMPACT_KEY,
  badgeOf,
  checkDescription,
  checkTitle,
  evidenceText,
  findingDomId,
  isProblem,
  linkSearchOf,
  reportBodyOf,
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
  /**
   * Poziom nagłówka tytułu: 3 pod nagłówkiem sekcji (Kokpit), 4 pod
   * nagłówkiem grupy obszaru w Diagnostyce - bez przeskoków poziomów.
   */
  headingLevel?: 3 | 4;
  className?: string;
}

const LOCALE = { pl: "pl-PL", en: "en-GB" } as const;

const BADGE_TONE: Readonly<Record<ReturnType<typeof badgeOf>, string>> = {
  error: "border-destructive/40 text-destructive",
  warn: "border-border text-brand-ink dark:text-brand",
  unknown: "border-border text-muted-foreground",
  ok: "border-border text-muted-foreground",
  snoozed: "border-border text-muted-foreground",
};

type ReportState = { kind: "copied" } | { kind: "manual"; body: string } | null;

export function DiagnosticCard({
  finding,
  variant,
  onFix,
  onSnooze,
  onUnsnooze,
  canSnooze = false,
  focused = false,
  factsAt = null,
  headingLevel = 3,
  className,
}: DiagnosticCardProps) {
  ensureShellI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<ReportState>(null);
  const reportFieldId = useId();
  const badge = badgeOf(finding);
  const compact = variant === "compact";
  const problem = isProblem(finding);
  const domId = findingDomId(finding.checkId);
  const evidence = compact ? finding.evidence.slice(0, 1) : finding.evidence;
  const locale = LOCALE[chartLangFrom(i18n.language)];
  const Heading = headingLevel === 4 ? "h4" : "h3";

  const copyReport = async () => {
    const body = reportBodyOf(t, finding, factsAt);
    try {
      await navigator.clipboard.writeText(body);
      setReport({ kind: "copied" });
    } catch {
      setReport({ kind: "manual", body });
    }
  };

  const snoozeReason = !finding.snoozable
    ? t("adminRevenue.diagnostics.card.notSnoozable")
    : canSnooze
      ? null
      : t("adminRevenue.diagnostics.card.snoozeAdminOnly");
  const snoozedUntil =
    finding.snooze?.kind === "days" && finding.snooze.until
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(finding.snooze.until),
        )
      : null;

  return (
    <article
      id={domId}
      tabIndex={-1}
      aria-labelledby={`${domId}-title`}
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
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
            BADGE_TONE[badge],
          )}
        >
          {t(BADGE_KEY[badge])}
        </span>
        {!compact && problem ? (
          <span className="text-xs text-muted-foreground" data-impact={finding.impact}>
            {t(IMPACT_KEY[finding.impact])}
          </span>
        ) : null}
        {!compact && finding.count !== null && finding.count > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("adminRevenue.diagnostics.card.count", { value: finding.count })}
          </span>
        ) : null}
      </div>

      <Heading id={`${domId}-title`} className="m-0 text-sm font-semibold">
        {checkTitle(t, finding.checkId)}
      </Heading>
      {compact ? null : (
        <p className="m-0 text-sm text-muted-foreground">{checkDescription(t, finding.checkId)}</p>
      )}

      {finding.state === "unknown" ? (
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.diagnostics.card.unknownHint")}
        </p>
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
            : t("adminRevenue.diagnostics.card.snoozedIntentional", {
                reason: finding.snooze.reason ?? "-",
              })}
        </p>
      ) : null}

      {problem || !compact ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {finding.fix?.kind === "dialog" && problem && onFix ? (
            <Button type="button" size="sm" className="h-7" onClick={onFix}>
              {t("adminRevenue.diagnostics.card.fix")}
            </Button>
          ) : null}
          {finding.fix?.kind === "link" && problem ? (
            <Button asChild size="sm" className="h-7">
              <Link to={finding.fix.to} search={linkSearchOf(finding.fix, finding.refs)}>
                {t("adminRevenue.diagnostics.card.openFix")}
              </Link>
            </Button>
          ) : null}
          {finding.fix?.kind === "code" && problem ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => void copyReport()}
            >
              {t("adminRevenue.diagnostics.card.report")}
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to={finding.owner.to} search={finding.owner.search}>
              {t("adminRevenue.diagnostics.card.openModule")}
            </Link>
          </Button>
          {!compact && problem && finding.snooze === null ? (
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
            <DisabledReason
              reason={canSnooze ? null : t("adminRevenue.diagnostics.card.snoozeAdminOnly")}
            >
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

      {finding.fix?.kind === "code" ? (
        // Region istnieje od pierwszego renderu - czytnik ogłasza tylko zmianę
        // treści regionu, który już był w drzewie.
        <div role="status" className="text-xs" data-testid="finding-report-status">
          {report?.kind === "copied" ? (
            <p className="m-0 text-muted-foreground">
              {t("adminRevenue.diagnostics.card.reported")}
            </p>
          ) : null}
        </div>
      ) : null}
      {report?.kind === "manual" ? (
        <div className="space-y-1">
          <label htmlFor={reportFieldId} className="block text-xs text-muted-foreground">
            {t("adminRevenue.diagnostics.card.reportFailed")}
          </label>
          <Textarea
            id={reportFieldId}
            readOnly
            rows={3}
            value={report.body}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}
    </article>
  );
}

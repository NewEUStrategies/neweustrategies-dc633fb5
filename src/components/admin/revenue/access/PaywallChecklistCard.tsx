// Organizm: lista kontrolna paywalla na zakładce Dostęp (SPEC §2.2 `access`).
//
// Pozycje = reguły diagnostyki S7-A z obszarów ściany, licznika i kasy,
// ocenione na tych samych faktach i wyciszeniach co Diagnostyka
// (`paywallChecklist`, `lib/admin/revenue/paywallChecklist.ts`). Tytuł reguły
// ze słownika diagnostyki - ta sama nazwa sprawy na obu ekranach.
//
// „NIE WIADOMO" TO NIE „GOTOWE". Pozycja bez faktu ma własny stan i nie
// liczy się do „gotowe: X z Y" - inaczej brak odczytu wyglądałby jak sukces.
// Stan słowem i ikoną, nie samym kolorem.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { checkTitle } from "@/components/admin/revenue/diagnostics/findingText";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import {
  PAYWALL_CHECKLIST_AREAS,
  paywallChecklist,
  paywallChecklistSummary,
  type PaywallChecklistStatus,
} from "@/lib/admin/revenue/paywallChecklist";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensureDiagnosticsI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import {
  evaluateAreaFindings,
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
} from "@/lib/revenue/diagnostics/queries";

const STATUS_KEY: Readonly<Record<PaywallChecklistStatus, string>> = {
  done: "adminRevenue.accessTab.checklist.status.done",
  todo: "adminRevenue.accessTab.checklist.status.todo",
  snoozed: "adminRevenue.accessTab.checklist.status.snoozed",
  unknown: "adminRevenue.accessTab.checklist.status.unknown",
};

const STATUS_ICON = {
  done: CheckCircle2,
  todo: XCircle,
  snoozed: AlertTriangle,
  unknown: Info,
} as const;

export interface PaywallChecklistCardProps {
  tenantId: string | null;
  roles: readonly string[];
}

export function PaywallChecklistCard({ tenantId, roles }: PaywallChecklistCardProps) {
  ensureRevenueI18n();
  ensureDiagnosticsI18n();
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const facts = useQuery(revenueFactsQueryOptions(tenantId, { roleOk }));
  const snoozes = useQuery(revenueSnoozesQueryOptions(tenantId, { roleOk }));
  const items = useMemo(() => {
    if (facts.data?.state !== "ready") return null;
    const active = snoozes.data?.state === "ready" ? snoozes.data.snoozes : [];
    return paywallChecklist(
      evaluateAreaFindings(facts.data.facts, active, PAYWALL_CHECKLIST_AREAS),
    );
  }, [facts.data, snoozes.data]);

  let body;
  if (items !== null) {
    const summary = paywallChecklistSummary(items);
    body = (
      <div className="space-y-2">
        <p
          className="m-0 text-xs tabular-nums text-muted-foreground"
          data-testid="checklist-summary"
        >
          {t("adminRevenue.accessTab.checklist.summary", {
            done: summary.done,
            total: summary.total,
          })}
        </p>
        <ol
          aria-label={t("adminRevenue.accessTab.checklist.listLabel")}
          className="m-0 list-none divide-y divide-border p-0"
        >
          {items.map((item) => {
            const Icon = STATUS_ICON[item.status];
            return (
              <li
                key={item.checkId}
                data-check={item.checkId}
                data-status={item.status}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="flex min-w-0 items-start gap-2 text-sm">
                  <Icon
                    className={
                      item.status === "todo"
                        ? "mt-0.5 h-4 w-4 shrink-0 text-destructive"
                        : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    }
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block">{checkTitle(t, item.checkId)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(STATUS_KEY[item.status])}
                    </span>
                  </span>
                </span>
                {item.action ? (
                  <Button asChild size="sm" variant="outline" className="h-7">
                    <Link to={item.action.to} search={item.action.search}>
                      {t("adminRevenue.accessTab.checklist.fix")}
                    </Link>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    );
  } else if (facts.data?.state === "mfa_required") {
    body = <MfaRequiredNotice />;
  } else if (tenantId && roleOk && facts.isPending && !facts.isError) {
    body = (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminRevenue.common.loading")}
      </p>
    );
  } else {
    body = (
      <p
        role="status"
        className="m-0 text-sm text-muted-foreground"
        data-testid="checklist-unknown"
      >
        {t("adminRevenue.accessTab.checklist.unknownAll")}
      </p>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="paywall-checklist"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.accessTab.checklist.title")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.accessTab.checklist.description")}
        </p>
      </div>
      {body}
    </section>
  );
}

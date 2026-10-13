// Karta panelu rozliczeń: jednorazowe uzgodnienie DAWNYCH anulowań za brak
// płatności (audyt SUB-03, `legacyNonPaymentReconcile.functions.ts`).
//
// Logika jest w całości serwerowa i stoi za `requirePlatformAdmin`; karta
// tylko przechodzi zadanie partiami (kursor z poprzedniej odpowiedzi) i skleja
// raport. Symulacja jest przyciskiem domyślnym, zapis - osobnym, za
// potwierdzeniem. Raport odświeża się po KAŻDEJ partii, więc przerwany
// przebieg (sieć, odmowa, limit partii) zostawia widoczny stan i kursor do
// kontynuacji zamiast pustej karty.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";

import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  mergeLegacyReconcileReports,
  type LegacyReconcileMode,
  type LegacyReconcileReport,
} from "@/lib/billing/legacyNonPaymentReconcile";
import { runLegacyNonPaymentReconcile } from "@/lib/billing/legacyNonPaymentReconcile.functions";
import { uiLocale } from "@/lib/i18n/format";
import { ensureAdminLegacyNonPaymentI18n } from "@/lib/i18n-admin-legacy-non-payment";

/** Partie (po 50 wierszy `subscriptions`) przechodzone jednym kliknięciem. */
export const LEGACY_RECONCILE_PAGES_PER_RUN = 40;
/** Tyle pozycji raportu pokazuje tabela - liczniki obejmują wszystkie. */
const MAX_VISIBLE_ROWS = 200;

/**
 * Odmowa bramki operatora platformy - ten sam kontrakt komunikatu, który
 * rozpoznaje panel rozliczeń (`platformGateDenial`, przybity w
 * `requireStaff.test.ts`).
 */
const PLATFORM_ROLE_DENIAL = "Forbidden: platform admin role (super_admin) required";

interface RunInput {
  mode: LegacyReconcileMode;
  cursor: string | null;
  previous: LegacyReconcileReport | null;
}

export function LegacyNonPaymentReconcileCard() {
  ensureAdminLegacyNonPaymentI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const run = useServerFn(runLegacyNonPaymentReconcile);
  const [report, setReport] = useState<LegacyReconcileReport | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const runM = useMutation({
    mutationFn: async ({ mode, cursor, previous }: RunInput) => {
      let acc = previous;
      let next = cursor;
      for (let page = 0; page < LEGACY_RECONCILE_PAGES_PER_RUN; page += 1) {
        const batch = await run({ data: { mode, cursor: next } });
        acc = mergeLegacyReconcileReports(acc, batch);
        setReport(acc);
        if (batch.done || !batch.nextCursor) break;
        next = batch.nextCursor;
      }
      return acc;
    },
  });

  const start = (mode: LegacyReconcileMode) => {
    setReport(null);
    runM.mutate({ mode, cursor: null, previous: null });
  };

  const denial = runM.error instanceof Error ? runM.error.message : null;
  const platformOnly = denial === PLATFORM_ROLE_DENIAL;
  const errorText = !denial
    ? null
    : platformOnly
      ? t("adminLegacyNonPayment.platformOnly")
      : denial.includes("mfa_required")
        ? t("adminBilling.mfaStepUpRequired")
        : t("adminLegacyNonPayment.failed", { message: denial });

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(uiLocale(lang)) : t("adminLegacyNonPayment.noEnd");
  const unfinished = report !== null && !report.done && report.nextCursor !== null;
  const visible = report?.rows.slice(0, MAX_VISIBLE_ROWS) ?? [];

  return (
    <Card className="rounded-[6px]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-[0.9375rem]">
          <History className="h-4 w-4" />
          {t("adminLegacyNonPayment.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-[0.8125rem]">
        <p className="text-muted-foreground">{t("adminLegacyNonPayment.lead")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={runM.isPending || platformOnly}
            onClick={() => start("dry_run")}
          >
            {t("adminLegacyNonPayment.dryRun")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[6px]"
            disabled={runM.isPending || platformOnly}
            onClick={() =>
              setConfirm({
                title: t("adminLegacyNonPayment.confirmTitle"),
                description: t("adminLegacyNonPayment.confirmDescription"),
                confirmLabel: t("adminLegacyNonPayment.apply"),
                destructive: true,
                onConfirm: () => start("apply"),
              })
            }
          >
            {t("adminLegacyNonPayment.apply")}
          </Button>
          {unfinished && report ? (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-[6px]"
              disabled={runM.isPending}
              onClick={() =>
                runM.mutate({ mode: report.mode, cursor: report.nextCursor, previous: report })
              }
            >
              {t("adminLegacyNonPayment.resume")}
            </Button>
          ) : null}
          {runM.isPending ? (
            <span className="text-muted-foreground">{t("adminLegacyNonPayment.running")}</span>
          ) : null}
        </div>

        {errorText ? (
          <p className={platformOnly ? "text-muted-foreground" : "text-destructive"}>{errorText}</p>
        ) : null}

        {report ? (
          <div className="space-y-2">
            <p>
              {t("adminLegacyNonPayment.summary", {
                scanned: report.scanned,
                candidates: report.candidates,
              })}{" "}
              {report.mode === "dry_run"
                ? t("adminLegacyNonPayment.simulated")
                : t("adminLegacyNonPayment.writes", {
                    anchors: report.writes.anchors,
                    entitlements: report.writes.entitlements,
                    teams: report.writes.teams,
                  })}
            </p>
            {unfinished ? (
              <p className="text-muted-foreground">{t("adminLegacyNonPayment.unfinished")}</p>
            ) : null}
            {report.rows.length === 0 ? (
              <p className="text-muted-foreground">{t("adminLegacyNonPayment.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]">
                  <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        {t("adminLegacyNonPayment.columns.subscription")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminLegacyNonPayment.columns.decision")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminLegacyNonPayment.columns.before")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminLegacyNonPayment.columns.after")}
                      </th>
                      <th className="px-3 py-2 font-medium">
                        {t("adminLegacyNonPayment.columns.detail")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr
                        key={`${row.tenantId}:${row.subscriptionId}`}
                        className="border-b last:border-0"
                      >
                        <td className="px-3 py-2 font-mono text-[0.75rem] text-muted-foreground">
                          {row.subscriptionId}
                        </td>
                        <td className="px-3 py-2">
                          {t(`adminLegacyNonPayment.decisions.${row.decision}`)}
                        </td>
                        <td className="px-3 py-2">{fmt(row.accessUntilBefore)}</td>
                        <td className="px-3 py-2">
                          {row.accessUntilAfter ? fmt(row.accessUntilAfter) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            {row.applied ? (
                              <Badge variant="secondary" className="rounded-[6px]">
                                {t("adminLegacyNonPayment.applied")}
                              </Badge>
                            ) : null}
                            {row.suspendTeam ? (
                              <Badge variant="outline" className="rounded-[6px]">
                                {t("adminLegacyNonPayment.teamSuspended")}
                              </Badge>
                            ) : null}
                            {row.cancellationReason || row.invoiceStatus ? (
                              <span className="text-muted-foreground">
                                {row.cancellationReason ?? row.invoiceStatus}
                              </span>
                            ) : null}
                            {row.error ? (
                              <span className="text-destructive">{row.error}</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.rows.length > visible.length ? (
                  <p className="pt-2 text-muted-foreground">
                    {t("adminLegacyNonPayment.rowsTruncated", {
                      shown: visible.length,
                      total: report.rows.length,
                    })}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
      <ConfirmDialog
        state={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      />
    </Card>
  );
}

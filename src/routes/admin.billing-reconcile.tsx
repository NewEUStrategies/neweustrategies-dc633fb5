// Admin → Rozliczenia → Uzgadnianie. Porównuje stan u operatora płatności ze
// stanem lokalnym i pozwala odtworzyć brakującą obsługę webhooka.
//
// Cała logika jest serwerowa (`reconcile.functions.ts`, rola `admin`); ten plik
// odpowiada wyłącznie za prezentację.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { getReconcileReport, repairReconcileEntry } from "@/lib/billing/reconcile.functions";
import type { ReconcileIssue, ReconcileReport } from "@/lib/billing/reconcile.server";
import { ensureI18n as ensureAdminReconcileI18n } from "@/lib/i18n-admin-reconcile";

export const Route = createFileRoute("/admin/billing-reconcile")({
  head: () => ({
    meta: [
      { title: "Uzgadnianie płatności - Panel" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminBillingReconcile,
});

type Env = "sandbox" | "live";

function issueKey(issue: ReconcileIssue): string {
  return `${issue.kind}:${issue.reference}`;
}

function AdminBillingReconcile() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-reconcile.ts.
  ensureAdminReconcileI18n();
  const { t, i18n } = useTranslation();
  const [environment, setEnvironment] = useState<Env>(getStripeEnvironmentSafe());
  const [sinceHours, setSinceHours] = useState(72);
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  const scan = useMutation({
    mutationFn: () => getReconcileReport({ data: { environment, sinceHours } }),
    onSuccess: (data) => {
      setReport(data);
      setOutcomes({});
    },
  });

  const repair = useMutation({
    mutationFn: (issue: ReconcileIssue) =>
      repairReconcileEntry({
        data: { environment, kind: issue.kind, reference: issue.reference },
      }),
    onSuccess: (result, issue) => {
      setOutcomes((prev) => ({
        ...prev,
        [issueKey(issue)]:
          result.status === "failed"
            ? `${t("adminReconcile.outcome.failed")}: ${result.error ?? ""}`
            : t(`adminReconcile.outcome.${result.status}`),
      }));
    },
    onError: (error, issue) => {
      setOutcomes((prev) => ({
        ...prev,
        [issueKey(issue)]: `${t("adminReconcile.outcome.failed")}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }));
    },
  });

  const locale = i18n.language?.startsWith("en") ? "en-GB" : "pl-PL";

  return (
    <div>
      <h2 className="font-display text-xl">{t("adminReconcile.title")}</h2>
      <p className="mb-5 mt-1 max-w-3xl text-sm text-muted-foreground">
        {t("adminReconcile.lead")}
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminReconcile.environment")}
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value === "live" ? "live" : "sandbox")}
          >
            <option value="sandbox">{t("adminReconcile.sandbox")}</option>
            <option value="live">{t("adminReconcile.live")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminReconcile.window")}
          <input
            type="number"
            min={1}
            max={720}
            className="h-9 w-28 rounded-md border bg-background px-2 text-sm text-foreground"
            value={sinceHours}
            onChange={(e) => setSinceHours(Math.min(720, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          {scan.isPending ? t("adminReconcile.scanning") : t("adminReconcile.scan")}
        </Button>
      </div>

      {scan.isError && (
        <p className="mb-4 text-sm text-destructive">
          {scan.error instanceof Error ? scan.error.message : String(scan.error)}
        </p>
      )}

      {report && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {t("adminReconcile.scanned", {
              events: report.scannedEvents,
              orders: report.scannedOrders,
              subs: report.scannedSubscriptions,
            })}
          </p>
          {report.warnings.map((code) => (
            <p key={code} className="mb-2 text-xs text-amber-600 dark:text-amber-400">
              {t(`adminReconcile.warnings.${code}`, { defaultValue: code })}
            </p>
          ))}

          {report.issues.length === 0 ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              {t("adminReconcile.clean")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">{t("adminReconcile.columns.kind")}</th>
                    <th className="p-2">{t("adminReconcile.columns.reference")}</th>
                    <th className="p-2">{t("adminReconcile.columns.reason")}</th>
                    <th className="p-2">{t("adminReconcile.columns.occurredAt")}</th>
                    <th className="p-2">{t("adminReconcile.columns.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.issues.map((issue) => {
                    const key = issueKey(issue);
                    return (
                      <tr key={key} className="border-t align-top">
                        <td className="p-2">{t(`adminReconcile.kinds.${issue.kind}`)}</td>
                        <td className="p-2">
                          <code className="break-all text-xs">{issue.reference}</code>
                          {issue.eventType && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {issue.eventType}
                            </span>
                          )}
                        </td>
                        <td className="p-2">
                          {t(`adminReconcile.reasons.${issue.reason}`, {
                            defaultValue: issue.reason,
                          })}
                          {issue.detail && (
                            <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                              {issue.detail}
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {issue.occurredAt
                            ? new Date(issue.occurredAt).toLocaleString(locale)
                            : "-"}
                        </td>
                        <td className="p-2">
                          {issue.repairable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={repair.isPending}
                              onClick={() => repair.mutate(issue)}
                            >
                              {repair.isPending && repair.variables?.reference === issue.reference
                                ? t("adminReconcile.repairing")
                                : t("adminReconcile.repair")}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("adminReconcile.notRepairable")}
                            </span>
                          )}
                          {outcomes[key] && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {outcomes[key]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

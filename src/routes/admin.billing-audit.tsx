// Admin → Rozliczenia → Audyt. Przegląd zamówień, zdarzeń webhooków i decyzji
// korygujących, z ponowieniem rozliczenia i eksportem księgowym.
//
// Cała logika jest serwerowa (`audit.functions.ts`, rola `admin`); ten plik
// odpowiada wyłącznie za prezentację i pobranie pliku w przeglądarce.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getStripeEnvironmentSafe } from "@/lib/stripe";
import { getBillingAudit, exportBillingAudit } from "@/lib/billing/audit.functions";
import { retryWebhookEvent } from "@/lib/billing/webhookRetry.functions";
import type { AuditReport } from "@/lib/billing/audit.server";
import { ensureI18n as ensureAuditI18n } from "@/lib/i18n-admin-billing-audit";

export const Route = createFileRoute("/admin/billing-audit")({
  head: () => ({
    meta: [{ title: "Audyt rozliczeń - Panel" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminBillingAudit,
});

type Env = "sandbox" | "live";
type Tab = "orders" | "webhooks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zamienia base64 z serwera na pobranie pliku - bez pośrednictwa sieci. */
function downloadBase64(fileName: string, mimeType: string, base64: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function AdminBillingAudit() {
  ensureAuditI18n();
  const { t, i18n } = useTranslation();
  const [environment, setEnvironment] = useState<Env>(getStripeEnvironmentSafe());
  const [sinceHours, setSinceHours] = useState(168);
  const [eventId, setEventId] = useState("");
  const [tab, setTab] = useState<Tab>("orders");
  const [report, setReport] = useState<AuditReport | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  const locale = i18n.language?.startsWith("en") ? "en-GB" : "pl-PL";
  const query = {
    environment,
    sinceHours,
    eventId: UUID_RE.test(eventId.trim()) ? eventId.trim() : null,
  };

  const load = useMutation({
    mutationFn: () => getBillingAudit({ data: query }),
    onSuccess: (data) => {
      setReport(data);
      setOutcomes({});
    },
  });

  const exportFile = useMutation({
    mutationFn: (format: "csv" | "xlsx") => exportBillingAudit({ data: { ...query, format } }),
    onSuccess: (file) => downloadBase64(file.fileName, file.mimeType, file.base64),
  });

  const retry = useMutation({
    mutationFn: (id: string) => retryWebhookEvent({ data: { id } }),
    onSuccess: (result) =>
      setOutcomes((prev) => ({
        ...prev,
        [result.id]: t("adminBillingAudit.retryOk", { status: result.status }),
      })),
    onError: (error, id) =>
      setOutcomes((prev) => ({
        ...prev,
        [id]: t("adminBillingAudit.retryFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      })),
  });

  const money = (cents: number | null, currency: string | null) =>
    cents === null
      ? "-"
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: (currency ?? "PLN").toUpperCase(),
        }).format(cents / 100);

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "-";

  return (
    <div>
      <h2 className="font-display text-xl">{t("adminBillingAudit.title")}</h2>
      <p className="mb-5 mt-1 max-w-3xl text-sm text-muted-foreground">
        {t("adminBillingAudit.lead")}
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminBillingAudit.environment")}
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as Env)}
            className="h-9 rounded-[6px] border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="sandbox">{t("adminBillingAudit.sandbox")}</option>
            <option value="live">{t("adminBillingAudit.live")}</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminBillingAudit.window")}
          <input
            type="number"
            min={1}
            max={8760}
            value={sinceHours}
            onChange={(e) => setSinceHours(Math.max(1, Number(e.target.value) || 1))}
            className="h-9 w-28 rounded-[6px] border border-border bg-background px-2 text-sm text-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("adminBillingAudit.eventFilter")}
          <input
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="h-9 w-72 rounded-[6px] border border-border bg-background px-2 text-sm text-foreground"
          />
        </label>

        <Button onClick={() => load.mutate()} disabled={load.isPending}>
          {load.isPending ? t("adminBillingAudit.loading") : t("adminBillingAudit.load")}
        </Button>
        <Button
          variant="outline"
          onClick={() => exportFile.mutate("csv")}
          disabled={exportFile.isPending}
        >
          {t("adminBillingAudit.exportCsv")}
        </Button>
        <Button
          variant="outline"
          onClick={() => exportFile.mutate("xlsx")}
          disabled={exportFile.isPending}
        >
          {t("adminBillingAudit.exportXlsx")}
        </Button>
      </div>

      {report && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["orders", String(report.totals.orders)],
                ["paid", money(report.totals.paidCents, null)],
                ["refunded", money(report.totals.refundedCents, null)],
                ["failed", String(report.totals.webhooksFailed)],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded-[6px] border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">
                  {t(`adminBillingAudit.summary.${key}`)}
                </div>
                <div className="font-display text-lg text-foreground">{value}</div>
              </div>
            ))}
          </div>

          {report.truncated && (
            <p className="mb-3 text-sm text-destructive">{t("adminBillingAudit.truncated")}</p>
          )}

          <div className="mb-3 flex gap-2">
            {(["orders", "webhooks"] as const).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={tab === key ? "default" : "outline"}
                onClick={() => setTab(key)}
              >
                {t(`adminBillingAudit.tabs.${key}`)}
              </Button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-[6px] border border-border">
            {tab === "orders" ? (
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">{t("adminBillingAudit.orders.created")}</th>
                    <th className="p-2">{t("adminBillingAudit.orders.status")}</th>
                    <th className="p-2">{t("adminBillingAudit.orders.kind")}</th>
                    <th className="p-2">{t("adminBillingAudit.orders.amount")}</th>
                    <th className="p-2">{t("adminBillingAudit.orders.refunded")}</th>
                    <th className="p-2">{t("adminBillingAudit.orders.intent")}</th>
                    <th className="p-2">{t("adminBillingAudit.orders.customer")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.orders.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="p-2 whitespace-nowrap">{when(row.createdAt)}</td>
                      <td className="p-2">{row.status}</td>
                      <td className="p-2">{row.kind}</td>
                      <td className="p-2 whitespace-nowrap">
                        {money(row.amountCents, row.currency)}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {row.refundedCents > 0 ? money(row.refundedCents, row.currency) : "-"}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {row.providerPaymentIntentId ?? row.providerSessionId ?? "-"}
                      </td>
                      <td className="p-2 font-mono text-xs">{row.providerCustomerId ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">{t("adminBillingAudit.webhooks.occurred")}</th>
                    <th className="p-2">{t("adminBillingAudit.webhooks.type")}</th>
                    <th className="p-2">{t("adminBillingAudit.webhooks.status")}</th>
                    <th className="p-2">{t("adminBillingAudit.webhooks.retries")}</th>
                    <th className="p-2">{t("adminBillingAudit.webhooks.duration")}</th>
                    <th className="p-2">{t("adminBillingAudit.webhooks.error")}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {report.webhooks.map((row) => (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="p-2 whitespace-nowrap">{when(row.occurredAt)}</td>
                      <td className="p-2 font-mono text-xs">{row.eventType}</td>
                      <td className="p-2">{row.status}</td>
                      <td className="p-2">{row.retryCount}</td>
                      <td className="p-2">
                        {row.durationMs === null ? "-" : `${row.durationMs} ms`}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {outcomes[row.id] ?? row.error ?? "-"}
                      </td>
                      <td className="p-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(row.id)}
                        >
                          {retry.isPending && retry.variables === row.id
                            ? t("adminBillingAudit.webhooks.retrying")
                            : t("adminBillingAudit.webhooks.retry")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {report.orders.length === 0 && report.webhooks.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">{t("adminBillingAudit.empty")}</p>
          )}
        </>
      )}

      {/* Zdrowie webhooków stoi POD dziennikiem, nie w osobnej zakładce:
          metryka i wiersz błędu opisują to samo zdarzenie, a rozdzielenie ich
          zmuszałoby dyżurnego do przeskakiwania między widokami. */}
      <div className="mt-8 border-t border-border pt-6">
        <WebhookHealthPanel environment={environment} sinceHours={sinceHours} />
      </div>
    </div>
  );
}

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
import type { AuditOrderRow, AuditReport } from "@/lib/billing/audit.server";
import { ensureI18n as ensureAuditI18n } from "@/lib/i18n-admin-billing-audit";
import { WebhookHealthPanel } from "@/components/admin/billing/WebhookHealthPanel";

export const Route = createFileRoute("/admin/billing-audit")({
  head: () => ({
    meta: [{ title: "Audyt rozliczeń - Panel" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminBillingAudit,
});

type Env = "sandbox" | "live";
type Tab = "orders" | "webhooks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Górna granica okna audytu - TA SAMA, którą wymusza schemat funkcji serwerowej. */
const MAX_WINDOW_HOURS = 8760;

/**
 * Statusy, które `buildAuditReport` wlicza do „Zaksięgowanych". Reguła jest tu
 * POWTÓRZONA świadomie i jest to jedyne jej powtórzenie po stronie klienta:
 * `AuditReport.totals` nie niesie waluty, a kafel musi ją podać. Rozbicie
 * liczymy z `report.orders`, czyli DOKŁADNIE z tej tablicy, którą serwer
 * redukuje do `totals` (patrz `audit.server.ts`) - sumy nie mają jak się
 * rozjechać, także wtedy, gdy raport został przycięty limitem wierszy.
 */
const PAID_STATUSES: ReadonlySet<string> = new Set(["paid", "partially_refunded"]);

/** Sumy pieniężne rozbite PO WALUCIE - pusta lista, gdy nic nie wchodzi do sumy. */
function totalsByCurrency(
  orders: readonly AuditOrderRow[],
  pick: (row: AuditOrderRow) => number,
): Array<{ currency: string; cents: number }> {
  const sums = new Map<string, number>();
  for (const row of orders) {
    const cents = pick(row);
    if (cents === 0) continue;
    const currency = (row.currency ?? "PLN").toUpperCase();
    sums.set(currency, (sums.get(currency) ?? 0) + cents);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => ({ currency, cents }));
}

/** Treść błędu z granicy serwerowej - operator ma zobaczyć POWÓD, nie ciszę. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

  /**
   * Kwota podpisana KODEM waluty (PLN/EUR), nie symbolem. Panel księgowy
   * stawia obok siebie zamówienia w różnych walutach, a symbol zależy od
   * locale i wersji ICU - kod ISO nazywa walutę jednoznacznie w obu językach.
   */
  const money = (cents: number | null, currency: string | null) =>
    cents === null
      ? "-"
      : new Intl.NumberFormat(locale, {
          style: "currency",
          currency: (currency ?? "PLN").toUpperCase(),
          currencyDisplay: "code",
        }).format(cents / 100);

  /** Liczba bez waluty - dla zera, którego nie ma czym (i po co) podpisywać. */
  const plainAmount = (cents: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);

  /**
   * KAFEL SUMY NIE MOŻE PODPISYWAĆ MIESZANKI WALUT JEDNĄ WALUTĄ. Wcześniej
   * kafle wołały `money(report.totals.paidCents, null)`, czyli formatowały sumę
   * WSZYSTKICH walut zakresu jako złotówki: 49,00 PLN + 24,75 EUR dawało jedną
   * liczbę 73,75 podpisaną „zł". Kolumna kwoty w TABELI robiła to poprawnie
   * (waluta wiersza), więc kafel i wiersze mówiły różne rzeczy o tym samym
   * zakresie - a kafel jest czytany pierwszy i bez tabeli.
   *
   * Kafel rozbija więc sumę po walutach: jedna pozycja na walutę, złączone
   * w jeden napis, żeby liczba dalej była jedną liczbą na walutę.
   */
  const summaryMoney = (orders: readonly AuditOrderRow[], pick: (row: AuditOrderRow) => number) => {
    const parts = totalsByCurrency(orders, pick);
    return parts.length === 0
      ? plainAmount(0)
      : parts.map((part) => money(part.cents, part.currency)).join(" + ");
  };

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
            max={MAX_WINDOW_HOURS}
            value={sinceHours}
            // Atrybut `max` w polu liczbowym NIE blokuje wpisania większej
            // wartości, a schemat funkcji serwerowej ma `max(8760)`. Przycięcie
            // samego dołu zakresu (`Math.max(1, ...)`) wypuszczało więc 99999
            // do serwera, gdzie zapytanie odbijało się od schematu - i to bez
            // śladu na ekranie. Przycinamy obie strony, jak bliźniaczy panel
            // uzgadniania (`Math.min(720, Math.max(1, ...))`).
            onChange={(e) =>
              setSinceHours(Math.min(MAX_WINDOW_HOURS, Math.max(1, Number(e.target.value) || 1)))
            }
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
          {exportFile.isPending && exportFile.variables === "csv"
            ? t("adminBillingAudit.exporting")
            : t("adminBillingAudit.exportCsv")}
        </Button>
        <Button
          variant="outline"
          onClick={() => exportFile.mutate("xlsx")}
          disabled={exportFile.isPending}
        >
          {exportFile.isPending && exportFile.variables === "xlsx"
            ? t("adminBillingAudit.exporting")
            : t("adminBillingAudit.exportXlsx")}
        </Button>
      </div>

      {/* AWARIA MUSI BYĆ SŁYSZALNA. Obie mutacje szły wcześniej bez `onError`
          i bez odczytu `isError`: odmowa roli, odrzucony schemat i awaria bazy
          kończyły się ekranem nie do odróżnienia od stanu sprzed kliknięcia.
          Na ekranie, z którego księgowość zamyka miesiąc, cisza po kliknięciu
          czyta się jak „zapytanie przeszło, w tym oknie nic nie ma". */}
      {load.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t("adminBillingAudit.loadFailed", { error: errorText(load.error) })}
        </p>
      )}
      {exportFile.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t("adminBillingAudit.exportFailed", { error: errorText(exportFile.error) })}
        </p>
      )}

      {report && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["orders", String(report.totals.orders)],
                [
                  "paid",
                  summaryMoney(report.orders, (row) =>
                    PAID_STATUSES.has(row.status) ? (row.amountCents ?? 0) : 0,
                  ),
                ],
                ["refunded", summaryMoney(report.orders, (row) => row.refundedCents)],
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

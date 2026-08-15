// Zamówienia płatnicze w panelu admina: pełna lista transakcji z filtrem statusu
// oraz jawnym wskazaniem zamówień „wiszących" (brak sesji operatora), bo to
// właśnie one sygnalizują przerwaną ścieżkę checkoutu.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-billing";
import { AlertTriangle, Loader2, Receipt, RefreshCcw } from "lucide-react";

import { listPaymentOrders } from "@/lib/billing/paymentOrders.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uiLocale } from "@/lib/i18n/format";

const STATUS_TONE: Record<string, string> = {
  paid: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  pending: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  processing: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  refunded: "bg-muted text-muted-foreground",
  canceled: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

const FILTERS = ["all", "pending", "processing", "paid", "failed", "refunded", "canceled"] as const;
type Filter = (typeof FILTERS)[number];

function money(cents: number, currency: string, lang: "pl" | "en"): string {
  return new Intl.NumberFormat(uiLocale(lang), {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function AdminPaymentOrdersPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";

  const [status, setStatus] = useState<Filter>("all");
  const load = useServerFn(listPaymentOrders);
  const q = useQuery({
    queryKey: ["admin", "payment-orders", status],
    queryFn: () => load({ data: { status, limit: 200 } }),
    staleTime: 15_000,
  });

  const rows = q.data?.rows ?? [];
  const summary = q.data?.summary;

  const filterLabel = (value: Filter): string =>
    value === "all"
      ? t("adminBilling.all")
      : value === "pending"
        ? t("adminBilling.pending")
        : value === "processing"
          ? t("adminBilling.processing")
          : value === "paid"
            ? t("adminBilling.paid")
            : value === "failed"
              ? t("adminBilling.failed")
              : value === "refunded"
                ? t("adminBilling.refunded")
                : t("adminBilling.canceled");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" aria-hidden="true" />
          {t("adminBilling.paymentOrders")}
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCcw
            className={`mr-2 h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {t("adminBilling.refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <nav className="tabs-scroller -mx-1 px-1" aria-label={t("adminBilling.statusFilter")}>
          <ul className="flex w-max min-w-full gap-2">
            {FILTERS.map((value) => (
              <li key={value}>
                <button
                  type="button"
                  onClick={() => setStatus(value)}
                  aria-pressed={status === value}
                  className={`rounded-[6px] border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                    status === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {filterLabel(value)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {summary && summary.stuck > 0 ? (
          <p className="flex items-start gap-2 rounded-[6px] bg-amber-500/10 px-3 py-2 text-[0.8125rem] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t("adminBilling.ordersWithoutSession", { count: summary.stuck })}
          </p>
        ) : null}

        {q.isLoading ? (
          <p className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t("adminBilling.loadingOrders")}
          </p>
        ) : q.isError ? (
          <p className="text-[0.8125rem] text-destructive">{t("adminBilling.couldLoadOrders")}</p>
        ) : rows.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">{t("adminBilling.ordersFilter")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[0.8125rem]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">{t("adminBilling.date")}</th>
                  <th className="py-2 pr-3 font-medium">{t("adminBilling.item")}</th>
                  <th className="py-2 pr-3 font-medium">{t("adminBilling.buyer")}</th>
                  <th className="py-2 pr-3 font-medium">{t("adminBilling.amount")}</th>
                  <th className="py-2 pr-3 font-medium">{t("adminBilling.status")}</th>
                  <th className="py-2 pr-3 font-medium">{t("adminBilling.session")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString(uiLocale(lang))}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block">
                        {row.planName ??
                          (row.kind === "subscription"
                            ? t("adminBilling.subscription")
                            : t("adminBilling.oneTimePayment"))}
                      </span>
                      <span className="text-[0.75rem] text-muted-foreground">
                        {row.provider}
                        {row.environment ? ` · ${row.environment}` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-3 break-all">
                      {row.buyerEmail ?? t("adminBilling.email")}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {money(row.amountCents, row.currency, lang)}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge
                        variant="outline"
                        className={`border-0 text-[0.75rem] ${
                          STATUS_TONE[row.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {row.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 break-all text-muted-foreground">
                      {row.sessionId ?? (
                        <span className="text-amber-600 dark:text-amber-400">
                          {t("adminBilling.missing")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

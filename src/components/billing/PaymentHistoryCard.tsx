// Historia faktur i płatności: numer, kwota, waluta, data, status, link do
// szczegółów u operatora. Ta sama karta obsługuje skrót na /profile/plan
// (`limit`) i pełne zestawienie na /profile/payments (`limit` pominięty,
// eksport CSV/PDF).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, ExternalLink, FileText, Printer } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchMyBillingDocuments, fetchMyOrders } from "@/lib/billing/queries";
import {
  mergePaymentHistory,
  paymentHistoryToCsv,
  type PaymentHistoryRow,
} from "@/lib/billing/paymentHistory";
import {
  downloadTextFile,
  historyFileName,
  historyPrintHtml,
  printHistoryPdf,
} from "@/lib/billing/exportHistory";
import { formatMoney } from "@/lib/billing/types";

interface Props {
  /** Skrót na stronie planu; bez wartości - pełna lista z eksportem. */
  limit?: number;
  showExport?: boolean;
  showAllLink?: boolean;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "paid") return "default";
  if (["failed", "refunded", "canceled", "void"].includes(status)) return "destructive";
  return "secondary";
}

export function PaymentHistoryCard({ limit, showExport = false, showAllLink = false }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { session } = useAuth();
  const uid = session?.user?.id;

  const ordersQ = useQuery({
    queryKey: billingKeys.myOrders(uid),
    queryFn: fetchMyOrders,
    enabled: !!session,
  });
  const docsQ = useQuery({
    queryKey: billingKeys.myBillingDocuments(uid),
    queryFn: fetchMyBillingDocuments,
    enabled: !!session,
  });

  const all = useMemo(
    () => mergePaymentHistory(ordersQ.data ?? [], docsQ.data ?? []),
    [ordersQ.data, docsQ.data],
  );
  const rows = typeof limit === "number" ? all.slice(0, limit) : all;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const kindLabel = (kind: PaymentHistoryRow["kind"]) => t(`profile.planPage.history.kind.${kind}`);
  const statusLabel = (status: string) =>
    t(`profile.planPage.history.status.${status}`, { defaultValue: status });

  function exportCsv() {
    const csv = paymentHistoryToCsv(all, {
      number: t("profile.planPage.history.colNumber"),
      date: t("profile.planPage.history.colDate"),
      kind: t("profile.planPage.history.colKind"),
      amount: t("profile.planPage.history.colAmount"),
      currency: t("profile.planPage.history.colCurrency"),
      status: t("profile.planPage.history.colStatus"),
      document: t("profile.planPage.history.colDocument"),
    });
    downloadTextFile(csv, historyFileName("payments", "csv"), "text/csv");
  }

  function exportPdf() {
    const html = historyPrintHtml(
      all,
      {
        title: t("profile.planPage.history.exportTitle"),
        number: t("profile.planPage.history.colNumber"),
        date: t("profile.planPage.history.colDate"),
        kind: t("profile.planPage.history.colKind"),
        amount: t("profile.planPage.history.colAmount"),
        status: t("profile.planPage.history.colStatus"),
        generatedAt: t("profile.planPage.history.generatedAt", {
          date: new Date().toLocaleString(lang === "en" ? "en-GB" : "pl-PL"),
        }),
        kindLabel,
        statusLabel,
      },
      lang,
    );
    if (!printHistoryPdf(html)) toast.error(t("profile.planPage.history.popupBlocked"));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("profile.planPage.history.title")}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {showExport && all.length > 0 && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("profile.planPage.history.exportCsv")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={exportPdf}>
                <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
                {t("profile.planPage.history.exportPdf")}
              </Button>
            </>
          )}
          {showAllLink && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/profile/payments">{t("profile.planPage.history.all")}</Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("profile.planPage.history.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("profile.planPage.history.colNumber")}</TableHead>
                  <TableHead>{t("profile.planPage.history.colDate")}</TableHead>
                  <TableHead>{t("profile.planPage.history.colKind")}</TableHead>
                  <TableHead className="text-right">
                    {t("profile.planPage.history.colAmount")}
                  </TableHead>
                  <TableHead>{t("profile.planPage.history.colStatus")}</TableHead>
                  <TableHead>{t("profile.planPage.history.colDocument")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.number}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(row.date)}</TableCell>
                    <TableCell>{kindLabel(row.kind)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatMoney(row.amountCents, row.currency, lang)}{" "}
                      <span className="text-xs uppercase text-muted-foreground">
                        {row.currency}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.detailsUrl || row.pdfUrl ? (
                        <a
                          href={(row.detailsUrl ?? row.pdfUrl) as string}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {t("profile.planPage.history.details")}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

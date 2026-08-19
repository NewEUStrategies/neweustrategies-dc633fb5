// Historia faktur i płatności: numer, kwota, waluta, data, status, link do
// szczegółów u operatora. Ta sama karta obsługuje skrót na /profile/plan
// (`limit`) i pełne zestawienie na /profile/payments (`limit` pominięty,
// eksport CSV/PDF).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, ExternalLink, FileText, Gift, Printer, Tag } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { BillingDate } from "@/components/billing/atoms/BillingDate";
import { BillingEmptyState } from "@/components/billing/atoms/BillingEmptyState";
import { MoneyText } from "@/components/billing/atoms/MoneyText";
import { PaymentStatusBadge } from "@/components/billing/atoms/PaymentStatusBadge";
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
import { useMyGrants } from "@/lib/billing/membership";
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

  // Nadania (np. dożywotni VIP eksperta lub dostęp z darowizny) to też część
  // historii - użytkownik ma widzieć, skąd wziął się jego dostęp, nawet gdy
  // nie było za niego płatności.
  const grantsQ = useMyGrants();

  const all = useMemo(
    () =>
      mergePaymentHistory(
        ordersQ.data ?? [],
        docsQ.data ?? [],
        (grantsQ.data ?? []).map((grant) => ({
          id: grant.id,
          tierKey: grant.tier_key,
          source: grant.source,
          note: grant.note,
          startsAt: grant.starts_at ?? grant.created_at,
          expiresAt: grant.expires_at,
          revokedAt: grant.revoked_at,
        })),
      ),
    [ordersQ.data, docsQ.data, grantsQ.data],
  );
  const rows = typeof limit === "number" ? all.slice(0, limit) : all;

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
      discount: t("profile.planPage.history.colDiscount"),
      coupon: t("profile.planPage.history.colCoupon"),
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
          <BillingEmptyState>{t("profile.planPage.history.empty")}</BillingEmptyState>
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
                    <TableCell className="text-xs">{row.number}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <BillingDate iso={row.date} variant="short" />
                    </TableCell>
                    <TableCell>{kindLabel(row.kind)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {row.originalAmountCents && row.discountCents ? (
                        <span className="mr-1 text-xs text-muted-foreground line-through">
                          <MoneyText cents={row.originalAmountCents} currency={row.currency} />
                        </span>
                      ) : null}
                      <MoneyText cents={row.amountCents} currency={row.currency} />{" "}
                      <span className="text-xs uppercase text-muted-foreground">
                        {row.currency}
                      </span>
                      {(row.discountCents || row.gift) && (
                        <span className="mt-1 flex flex-wrap justify-end gap-1">
                          {row.discountCents ? (
                            <Badge variant="secondary" className="gap-1 text-[11px]">
                              <Tag className="h-3 w-3" aria-hidden="true" />
                              {t("profile.planPage.history.discount", {
                                amount: formatMoney(row.discountCents, row.currency, lang),
                              })}
                              {row.couponCode ? ` · ${row.couponCode}` : ""}
                            </Badge>
                          ) : null}
                          {row.gift && (
                            <Badge variant="outline" className="gap-1 text-[11px]">
                              <Gift className="h-3 w-3" aria-hidden="true" />
                              {row.giftSource
                                ? t(`profile.planPage.grantSource.${row.giftSource}`, {
                                    defaultValue: t("profile.planPage.history.gift"),
                                  })
                                : t("profile.planPage.history.gift")}
                            </Badge>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge
                        status={row.status}
                        labelPrefix="profile.planPage.history.status"
                      />
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

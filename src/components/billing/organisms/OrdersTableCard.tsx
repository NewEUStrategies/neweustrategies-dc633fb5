// Rejestr zamówień użytkownika (payment_orders) jako karta wielokrotnego
// użytku. Wyodrębniona 1:1 z dawnej trasy /profile/orders (teraz
// przekierowanie), żeby konsolidacja IA finansów nie odbyła się kosztem
// funkcji: tabela z datą, pozycją, kwotą, statusem i linkiem do faktury żyje
// dalej - tyle że na /profile/payments, obok scalonej historii płatności.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchMyOrders } from "@/lib/billing/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BillingDate } from "@/components/billing/atoms/BillingDate";
import { BillingEmptyState } from "@/components/billing/atoms/BillingEmptyState";
import { MoneyText } from "@/components/billing/atoms/MoneyText";
import { PaymentStatusBadge } from "@/components/billing/atoms/PaymentStatusBadge";

export function OrdersTableCard() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: billingKeys.myOrders(session?.user?.id),
    queryFn: fetchMyOrders,
    enabled: !!session,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.orders.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!data || data.length === 0 ? (
          <BillingEmptyState>{t("profile.orders.empty")}</BillingEmptyState>
        ) : (
          // Tabela szersza niż kolumna profilu na wąskich ekranach przewija się
          // WEWNĄTRZ karty - strona nigdy nie jedzie w poziomie.
          <div className="-mx-2 overflow-x-auto px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("profile.orders.colDate")}</TableHead>
                  <TableHead>{t("profile.orders.colItem")}</TableHead>
                  <TableHead className="text-right">{t("profile.orders.colAmount")}</TableHead>
                  <TableHead>{t("profile.orders.colStatus")}</TableHead>
                  <TableHead>{t("profile.orders.colInvoice")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((o) => {
                  const label =
                    (o.metadata && typeof o.metadata.label === "string"
                      ? o.metadata.label
                      : null) ??
                    (o.kind === "subscription"
                      ? t("profile.orders.kindSubscription")
                      : t("profile.orders.kindOneTime"));
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <BillingDate iso={o.created_at} variant="short" />
                      </TableCell>
                      <TableCell>{label}</TableCell>
                      <TableCell className="text-right">
                        <MoneyText cents={o.amount_cents} currency={o.currency} />
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>
                        {o.invoice_url ? (
                          <a
                            href={o.invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {t("profile.orders.invoice")}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

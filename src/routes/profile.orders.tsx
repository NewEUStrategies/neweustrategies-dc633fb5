import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyOrders } from "@/lib/billing/queries";
import { formatMoney } from "@/lib/billing/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/profile/orders")({
  component: OrdersPage,
});

function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["my-orders"],
    queryFn: fetchMyOrders,
    enabled: !!session,
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === "en" ? "en-US" : "pl-PL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
    if (s === "paid") return "default";
    if (s === "failed" || s === "refunded" || s === "canceled") return "destructive";
    return "secondary";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.orders.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("profile.orders.empty")}</p>
        ) : (
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
                  (o.metadata && typeof o.metadata.label === "string" ? o.metadata.label : null) ??
                  (o.kind === "subscription" ? t("profile.orders.kindSubscription") : t("profile.orders.kindOneTime"));
                return (
                  <TableRow key={o.id}>
                    <TableCell>{fmtDate(o.created_at)}</TableCell>
                    <TableCell>{label}</TableCell>
                    <TableCell className="text-right">{formatMoney(o.amount_cents, o.currency, i18n.language)}</TableCell>
                    <TableCell><Badge variant={statusVariant(o.status)}>{t(`profile.status.${o.status}`)}</Badge></TableCell>
                    <TableCell>
                      {o.invoice_url ? (
                        <a href={o.invoice_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
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
        )}
      </CardContent>
    </Card>
  );
}

// Rejestr dokumentów rozliczeniowych użytkownika (faktury z zakupów i KAŻDEGO
// odnowienia subskrypcji, paragony; statusy w tym refund). Dane zasila webhook
// Stripe do billing_documents (RLS: właściciel); podgląd i PDF to trwałe linki
// operatora płatności. Zdarzenie billing_document.issued.v1 z szyny odświeża
// listę na żywo, gdy webhook doksięguje dokument.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, Receipt } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchMyBillingDocuments } from "@/lib/billing/queries";
import { formatMoney, type BillingDocument } from "@/lib/billing/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function statusVariant(
  status: BillingDocument["status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "paid") return "default";
  if (status === "refunded" || status === "void") return "destructive";
  return "secondary";
}

export function BillingDocumentsCard() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: billingKeys.myBillingDocuments(session?.user?.id),
    queryFn: fetchMyBillingDocuments,
    enabled: !!session,
  });
  const documents = data ?? [];

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === "en" ? "en-GB" : "pl-PL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("profile.orders.documents.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("profile.orders.documents.hint")}</p>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("profile.orders.documents.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("profile.orders.documents.colDate")}</TableHead>
                  <TableHead>{t("profile.orders.documents.colNumber")}</TableHead>
                  <TableHead>{t("profile.orders.documents.colKind")}</TableHead>
                  <TableHead>{t("profile.orders.documents.colAmount")}</TableHead>
                  <TableHead>{t("profile.orders.documents.colStatus")}</TableHead>
                  <TableHead
                    className="text-right"
                    aria-label={t("profile.orders.documents.view")}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(doc.issued_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{doc.number ?? "-"}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        {doc.kind === "receipt" ? (
                          <Receipt
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : (
                          <FileText
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        {t(`profile.orders.documents.kind.${doc.kind}`)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatMoney(doc.amount_cents, doc.currency, i18n.language)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(doc.status)}>
                        {t(`profile.orders.documents.status.${doc.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <span className="inline-flex items-center gap-3">
                        {doc.hosted_url && (
                          <a
                            href={doc.hosted_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            {t("profile.orders.documents.view")}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                        {doc.pdf_url && (
                          <a
                            href={doc.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {t("profile.orders.documents.pdf")}
                          </a>
                        )}
                      </span>
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

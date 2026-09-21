// Rejestr faktur z pobieraniem PDF.
//
// Dokument operatora (Stripe, MoR) jest oryginałem, ale bywa niedostępny -
// paragon zamiast faktury albo link wygasł. Dlatego obok linku do oryginału
// zawsze stoi „Pobierz PDF": kopia składana po stronie serwera z danych
// dokumentu, profilu rozliczeniowego i wystawcy.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { billingKeys } from "@/lib/billing/keys";
import { fetchMyBillingDocuments } from "@/lib/billing/queries";
import { generateMyInvoicePdf } from "@/lib/billing/invoices.functions";
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

/** base64 -> plik na dysku użytkownika (bez wychodzenia ze strony). */
export function downloadBase64Pdf(base64: string, fileName: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function InvoiceLedgerCard() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: billingKeys.myBillingDocuments(session?.user?.id),
    queryFn: fetchMyBillingDocuments,
    enabled: !!session,
  });
  const documents = data ?? [];

  const download = async (documentId: string) => {
    setBusyId(documentId);
    try {
      const result = await generateMyInvoicePdf({
        data: { documentId, locale: i18n.language.startsWith("en") ? "en" : "pl" },
      });
      if (!result.ok) throw new Error(result.error);
      downloadBase64Pdf(result.result.base64, result.result.fileName);
      toast.success(t("invoices.ledger.ready"));
    } catch {
      toast.error(t("invoices.ledger.error"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("invoices.ledger.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("invoices.ledger.hint")}</p>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <BillingEmptyState>{t("invoices.ledger.empty")}</BillingEmptyState>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.ledger.colDate")}</TableHead>
                  <TableHead>{t("invoices.ledger.colNumber")}</TableHead>
                  <TableHead>{t("invoices.ledger.colAmount")}</TableHead>
                  <TableHead>{t("invoices.ledger.colStatus")}</TableHead>
                  <TableHead className="text-right" aria-label={t("invoices.ledger.download")} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="whitespace-nowrap">
                      <BillingDate iso={doc.issued_at} variant="short" />
                    </TableCell>
                    <TableCell className="text-xs">{doc.number ?? "-"}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <MoneyText cents={doc.amount_cents} currency={doc.currency} />
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge
                        status={doc.status}
                        labelPrefix="profile.orders.documents.status"
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <span className="inline-flex items-center gap-3">
                        {(doc.pdf_url || doc.hosted_url) && (
                          <a
                            href={doc.pdf_url ?? doc.hosted_url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            {t("invoices.ledger.original")}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-md"
                          disabled={busyId === doc.id}
                          onClick={() => void download(doc.id)}
                        >
                          {busyId === doc.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {busyId === doc.id
                            ? t("invoices.ledger.generating")
                            : t("invoices.ledger.download")}
                        </Button>
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

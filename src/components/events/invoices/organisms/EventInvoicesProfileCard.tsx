// Organizm: "FAKTURY ZA WYDARZENIA" w profilu kupujacego (/profile/invoices).
//
// DWIE LISTY, JEDNO PYTANIE ("gdzie jest moja faktura za bilet"):
//   * wystawione dokumenty organizatorow (faktury, proformy, korekty) z PDF
//     skladanym w przegladarce z migawki dokumentu - to ten sam dokument,
//     ktory widzi organizator, w jezyku faktury, nie strony;
//   * zamowienia bez faktury (wlasne zapisy i pakiety) z prosba o fakture
//     do konca terminu pilnowanego przez baze.
//
// DANE SA PRYWATNE I PO STRONIE KLIENTA: zapytania startuja dopiero z sesja
// (`enabled`), wiec SSR i pierwszy render klienta rysuja to samo (stan
// wczytywania) - bez rozjazdu hydratacji.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, FileText, Loader2 } from "lucide-react";

import { MoneyText } from "@/components/billing/atoms/MoneyText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InvoiceRequestDialog } from "@/components/events/invoices/molecules/InvoiceRequestDialog";
import { useAuth } from "@/hooks/useAuth";
import { buyerDraftFromColumns, emptyBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";
import type { EventInvoiceKind } from "@/lib/events/eventInvoiceEnums";
import { downloadEventInvoicePdf } from "@/lib/events/eventInvoicePdfLabels";
import { eventInvoiceErrorMessage } from "@/lib/events/eventInvoiceErrors";
import {
  fetchMyInvoice,
  type MyInvoiceRow,
  type MyInvoiceSourceRow,
} from "@/lib/events/myEventInvoicesApi";
import {
  useCancelInvoiceRequest,
  useMyInvoiceSources,
  useMyInvoices,
} from "@/lib/events/useMyEventInvoices";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";

const KIND_LABEL_KEYS: Record<EventInvoiceKind, string> = {
  invoice: "eventInvoices.kinds.invoice",
  proforma: "eventInvoices.kinds.proforma",
  correction: "eventInvoices.kinds.correction",
};

function kindKey(kind: string): string {
  return kind === "proforma" || kind === "correction" ? KIND_LABEL_KEYS[kind] : KIND_LABEL_KEYS.invoice;
}

function titleOf(row: { event_title_pl: string; event_title_en: string }, english: boolean): string {
  return english && row.event_title_en !== "" ? row.event_title_en : row.event_title_pl;
}

export function EventInvoicesProfileCard() {
  ensureEventInvoicesI18n();
  const { t, i18n } = useTranslation();
  const english = i18n.language.startsWith("en");
  const { session } = useAuth();
  const enabled = session !== null;
  const documentsQ = useMyInvoices(enabled);
  const sourcesQ = useMyInvoiceSources(enabled);
  const cancelRequest = useCancelInvoiceRequest();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<MyInvoiceSourceRow | null>(null);

  async function download(row: MyInvoiceRow): Promise<void> {
    setBusyId(row.id);
    try {
      downloadEventInvoicePdf(await fetchMyInvoice(row.id));
    } catch {
      toast.error(t("eventInvoices.profile.downloadFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const documents = documentsQ.data ?? [];
  const openOrders = (sourcesQ.data ?? []).filter((row) => row.invoice_id === null);
  const failed = documentsQ.isError || sourcesQ.isError;
  const loading = enabled && (documentsQ.isLoading || sourcesQ.isLoading);

  return (
    <Card className="rounded-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("eventInvoices.profile.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("eventInvoices.profile.description")}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            {t("eventInvoices.profile.loadFailed")}
          </p>
        ) : loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("eventInvoices.profile.loading")}
          </p>
        ) : (
          <>
            <section className="space-y-2" aria-labelledby="event-invoices-documents">
              <h3 id="event-invoices-documents" className="text-sm font-semibold">
                {t("eventInvoices.profile.documentsTitle")}
              </h3>
              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("eventInvoices.profile.documentsEmpty")}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {documents.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-medium">
                          {t(kindKey(row.kind))} {row.number}
                          {row.status === "cancelled" ? (
                            <Badge variant="outline" className="ml-2">
                              {t("eventInvoices.statuses.cancelled")}
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {titleOf(row, english)} · {row.issue_date}
                          {row.corrects_number === null
                            ? null
                            : ` · ${t("eventInvoices.profile.correctionOf", { number: row.corrects_number })}`}
                        </p>
                        {row.paid_at === null && row.status === "issued" && row.due_date !== null ? (
                          <p className="text-xs text-muted-foreground">
                            {t("eventInvoices.profile.dueDate", { date: row.due_date })}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3">
                        <MoneyText
                          cents={row.gross_cents}
                          currency={row.currency}
                          className="text-sm tabular-nums"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.id}
                          onClick={() => void download(row)}
                        >
                          {busyId === row.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {busyId === row.id
                            ? t("eventInvoices.profile.downloading")
                            : t("eventInvoices.profile.download")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="space-y-2" aria-labelledby="event-invoices-orders">
              <h3 id="event-invoices-orders" className="text-sm font-semibold">
                {t("eventInvoices.profile.ordersTitle")}
              </h3>
              {openOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("eventInvoices.profile.ordersEmpty")}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {openOrders.map((row) => (
                    <OrderRow
                      key={row.source_id}
                      row={row}
                      english={english}
                      cancelling={cancelRequest.isPending}
                      onRequest={() => setRequesting(row)}
                      onCancel={() =>
                        cancelRequest.mutate(row.request_id, {
                          onSuccess: () => toast.success(t("eventInvoices.profile.requestCancelled")),
                          onError: (error) => toast.error(eventInvoiceErrorMessage(error)),
                        })
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </CardContent>
      {requesting === null ? null : (
        <InvoiceRequestDialog
          target={
            requesting.source_kind === "package_order"
              ? { packageOrderId: requesting.source_id }
              : { registrationId: requesting.source_id }
          }
          initial={
            requesting.request_id === null ? emptyBuyerDraft() : buyerDraftFromColumns(requesting)
          }
          onClose={() => setRequesting(null)}
          onSaved={() => {
            setRequesting(null);
            toast.success(t("eventInvoices.request.saved"));
          }}
        />
      )}
    </Card>
  );
}

function OrderRow({
  row,
  english,
  cancelling,
  onRequest,
  onCancel,
}: {
  row: MyInvoiceSourceRow;
  english: boolean;
  cancelling: boolean;
  onRequest: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const label = english && row.label_en !== "" ? row.label_en : row.label_pl;
  const pending = row.request_status === "pending";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">
          {row.source_kind === "package_order"
            ? t("eventInvoices.profile.packageLabel", { name: label })
            : label}
          <span className="ml-2 text-xs text-muted-foreground">
            {t("eventInvoices.profile.seats", { count: row.seats })}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{titleOf(row, english)}</p>
        {row.payment_state === "unpaid" ? (
          <p className="text-xs text-muted-foreground">{t("eventInvoices.profile.unpaid")}</p>
        ) : null}
        {pending ? (
          <p className="text-xs text-muted-foreground">{t("eventInvoices.profile.requestPending")}</p>
        ) : null}
        {row.request_deadline === null ? null : row.can_request ? (
          <p className="text-xs text-muted-foreground">
            {t("eventInvoices.profile.deadline", { date: row.request_deadline })}
          </p>
        ) : (
          <p className="text-xs text-destructive">
            {t("eventInvoices.profile.windowClosed", { date: row.request_deadline })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MoneyText cents={row.gross_cents} currency={row.currency} className="text-sm tabular-nums" />
        {row.can_request ? (
          <Button type="button" size="sm" variant="outline" onClick={onRequest}>
            {pending ? t("eventInvoices.profile.editRequest") : t("eventInvoices.profile.request")}
          </Button>
        ) : null}
        {pending ? (
          <Button type="button" size="sm" variant="ghost" disabled={cancelling} onClick={onCancel}>
            {t("eventInvoices.profile.cancelRequest")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

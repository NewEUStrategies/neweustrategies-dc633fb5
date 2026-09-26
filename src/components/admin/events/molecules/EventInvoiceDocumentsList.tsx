// Molekula: DOKUMENTY wydarzenia w jednej z trzech zakladek (wystawione,
// szkice i proformy, korekty) z akcjami wlasciwymi dla stanu dokumentu.
//
// AKCJE WYNIKAJA ZE STANU, NIE Z UPRAWNIEN EKRANU. Szkic mozna edytowac,
// wystawic i porzucic; wystawiona faktura - pobrac, skorygowac, oznaczyc jako
// oplacona, opisac stanem KSeF i (dopoki nie trafila do KSeF) anulowac z
// powodem; proforma - zamienic w fakture koncowa. Kazda odmowa bazy (np.
// dokument juz w KSeF) wraca zdaniem z mapy bledow - ekran nie zgaduje
// regul, ktore i tak egzekwuje SQL.
//
// FILTR "DO WYSLANIA W KSEF" pokazuje wystawione dokumenty w stanie
// `pending` - to jest lista pracy dla ksiegowosci, dopoki nie ma klienta API.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MoneyText } from "@/components/billing/atoms/MoneyText";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { KSEF_STATUS_LABEL_KEYS } from "@/components/admin/events/molecules/EventInvoiceKsefDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmDialog, promptDialog } from "@/lib/appDialogs";
import { adminEventInvoiceErrorMessage } from "@/lib/events/adminEventInvoiceErrors";
import {
  EVENT_INVOICE_KINDS,
  EVENT_INVOICE_KSEF_STATUSES,
  EVENT_INVOICE_STATUSES,
  pickEnum,
  type EventInvoiceKind,
  type EventInvoiceStatus,
} from "@/lib/events/eventInvoiceEnums";
import {
  fetchEventInvoice,
  type EventInvoiceListRow,
  type IssuedInvoice,
} from "@/lib/events/eventInvoicesApi";
import { downloadEventInvoicePdf } from "@/lib/events/eventInvoicePdfLabels";
import {
  useCancelInvoice,
  useEventInvoices,
  useInvoiceFromProforma,
  useIssueInvoice,
  useSetInvoicePaid,
} from "@/lib/events/useEventInvoices";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

export type EventInvoiceDocumentsTab = "issued" | "drafts" | "corrections";

export const KIND_LABEL_KEYS: Record<EventInvoiceKind, string> = {
  invoice: "adminEventInvoices.kinds.invoice",
  proforma: "adminEventInvoices.kinds.proforma",
  correction: "adminEventInvoices.kinds.correction",
};

export const STATUS_LABEL_KEYS: Record<EventInvoiceStatus, string> = {
  draft: "adminEventInvoices.statuses.draft",
  issued: "adminEventInvoices.statuses.issued",
  cancelled: "adminEventInvoices.statuses.cancelled",
};

/** Ktore dokumenty naleza do zakladki. */
export function documentsForTab(
  rows: readonly EventInvoiceListRow[],
  tab: EventInvoiceDocumentsTab,
): EventInvoiceListRow[] {
  return rows.filter((row) => {
    if (tab === "corrections") return row.kind === "correction";
    if (tab === "issued") return row.kind === "invoice" && row.status !== "draft";
    return row.kind !== "correction" && (row.status === "draft" || row.kind === "proforma");
  });
}

export interface EventInvoiceDocumentsListProps {
  eventId: string;
  tab: EventInvoiceDocumentsTab;
  onEdit: (invoiceId: string) => void;
  onCorrect: (invoiceId: string) => void;
  onKsef: (row: EventInvoiceListRow) => void;
  onIssued: (issued: IssuedInvoice) => void;
}

export function EventInvoiceDocumentsList({
  eventId,
  tab,
  onEdit,
  onCorrect,
  onKsef,
  onIssued,
}: EventInvoiceDocumentsListProps) {
  ensureAdminEventInvoicesI18n();
  const { t } = useTranslation();
  const listQ = useEventInvoices(eventId);
  const issue = useIssueInvoice(eventId);
  const cancel = useCancelInvoice(eventId);
  const fromProforma = useInvoiceFromProforma(eventId);
  const setPaid = useSetInvoicePaid(eventId);
  const [ksefOnly, setKsefOnly] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const rows = documentsForTab(listQ.data ?? [], tab).filter(
    (row) => !ksefOnly || (row.status === "issued" && row.ksef_status === "pending"),
  );
  const busy = issue.isPending || cancel.isPending || fromProforma.isPending || setPaid.isPending;

  async function pdf(row: EventInvoiceListRow): Promise<void> {
    setPdfBusy(row.id);
    try {
      downloadEventInvoicePdf(await fetchEventInvoice(row.id));
    } catch {
      toast.error(t("adminEventInvoices.toasts.pdfFailed"));
    } finally {
      setPdfBusy(null);
    }
  }

  async function issueRow(row: EventInvoiceListRow): Promise<void> {
    const confirmed = await confirmDialog({
      title: t("adminEventInvoices.documents.issueTitle"),
      description: t("adminEventInvoices.documents.issueBody"),
      confirmLabel: t("adminEventInvoices.documents.issue"),
      cancelLabel: t("adminEventInvoices.documents.keep"),
    });
    if (!confirmed) return;
    issue.mutate(row.id, {
      onSuccess: onIssued,
      onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
    });
  }

  async function cancelRow(row: EventInvoiceListRow): Promise<void> {
    let reason = "";
    if (row.status === "draft") {
      const confirmed = await confirmDialog({
        title: t("adminEventInvoices.documents.cancelTitle"),
        description: t("adminEventInvoices.documents.cancelDraftBody"),
        confirmLabel: t("adminEventInvoices.documents.cancelConfirm"),
        cancelLabel: t("adminEventInvoices.documents.keep"),
        destructive: true,
      });
      if (!confirmed) return;
    } else {
      const answer = await promptDialog({
        title: t("adminEventInvoices.documents.cancelTitle"),
        label: t("adminEventInvoices.documents.cancelReasonLabel"),
        confirmLabel: t("adminEventInvoices.documents.cancelConfirm"),
        cancelLabel: t("adminEventInvoices.documents.keep"),
      });
      if (answer === null) return;
      reason = answer;
    }
    cancel.mutate(
      { id: row.id, reason },
      {
        onSuccess: () => toast.success(t("adminEventInvoices.toasts.cancelled")),
        onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
      },
    );
  }

  function convert(row: EventInvoiceListRow): void {
    fromProforma.mutate(row.id, {
      onSuccess: (draftId) => {
        toast.success(t("adminEventInvoices.toasts.draftCreated"));
        onEdit(draftId);
      },
      onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
    });
  }

  function togglePaid(row: EventInvoiceListRow): void {
    setPaid.mutate(
      { id: row.id, paidAt: row.paid_at === null ? new Date().toISOString() : null },
      {
        onSuccess: () => toast.success(t("adminEventInvoices.toasts.paidSaved")),
        onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
      },
    );
  }

  return (
    <div className="space-y-3">
      {tab === "drafts" ? null : (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ksefOnly} onChange={(event) => setKsefOnly(event.target.checked)} />
          {t("adminEventInvoices.documents.ksefOnly")}
        </label>
      )}
      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventInvoices.loading")}
        errorMessage={listQ.isError ? adminEventInvoiceErrorMessage(listQ.error) : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventInvoices.documents.empty")}
      >
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => {
            const kind = pickEnum(EVENT_INVOICE_KINDS, row.kind);
            const status = pickEnum(EVENT_INVOICE_STATUSES, row.status);
            const number = row.number ?? t("adminEventInvoices.documents.draftNumber");
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {t(KIND_LABEL_KEYS[kind])} {number}
                    {row.corrects_number === null
                      ? null
                      : ` ${t("adminEventInvoices.documents.corrects", { number: row.corrects_number })}`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.buyer_name} {row.buyer_tax_id === "" ? null : `· ${row.buyer_tax_id}`}
                    {row.issue_date === null ? null : ` · ${row.issue_date}`}
                  </p>
                </div>
                <MoneyText cents={row.gross_cents} currency={row.currency} className="tabular-nums" />
                <Badge variant={status === "cancelled" ? "outline" : "secondary"}>
                  {t(STATUS_LABEL_KEYS[status])}
                </Badge>
                {status === "issued" && kind !== "proforma" ? (
                  <Badge variant="outline">
                    {t(KSEF_STATUS_LABEL_KEYS[pickEnum(EVENT_INVOICE_KSEF_STATUSES, row.ksef_status)])}
                  </Badge>
                ) : null}
                {status === "issued" ? (
                  <span className="text-xs text-muted-foreground">
                    {row.paid_at === null
                      ? t("adminEventInvoices.documents.unpaid")
                      : t("adminEventInvoices.documents.paidOn", { date: row.paid_at.slice(0, 10) })}
                  </span>
                ) : null}
                <div
                  className="flex flex-wrap gap-1"
                  role="group"
                  aria-label={t("adminEventInvoices.documents.actionsFor", { number })}
                >
                  {status === "draft" ? (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => onEdit(row.id)}>
                        {t("adminEventInvoices.documents.edit")}
                      </Button>
                      <Button type="button" size="sm" disabled={busy} onClick={() => void issueRow(row)}>
                        {t("adminEventInvoices.documents.issue")}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pdfBusy === row.id}
                    onClick={() => void pdf(row)}
                  >
                    {t("adminEventInvoices.documents.pdf")}
                  </Button>
                  {status === "issued" && kind === "invoice" ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onCorrect(row.id)}>
                      {t("adminEventInvoices.documents.correct")}
                    </Button>
                  ) : null}
                  {status === "issued" && kind === "proforma" && row.converted_invoice_id === null ? (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => convert(row)}>
                      {t("adminEventInvoices.documents.fromProforma")}
                    </Button>
                  ) : null}
                  {status === "issued" && kind !== "proforma" ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onKsef(row)}>
                      {t("adminEventInvoices.documents.ksef")}
                    </Button>
                  ) : null}
                  {status === "issued" && kind !== "correction" ? (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => togglePaid(row)}>
                      {row.paid_at === null
                        ? t("adminEventInvoices.documents.markPaid")
                        : t("adminEventInvoices.documents.markUnpaid")}
                    </Button>
                  ) : null}
                  {status === "cancelled" ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy}
                      onClick={() => void cancelRow(row)}
                    >
                      {t("adminEventInvoices.documents.cancel")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </AdminCatalogListState>
    </div>
  );
}

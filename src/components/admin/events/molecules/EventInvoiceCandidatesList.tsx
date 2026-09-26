// Molekula: ZAMOWIENIA DO ZAFAKTUROWANIA pogrupowane po NIP-ie nabywcy.
//
// FAKTURA ZBIORCZA ZACZYNA SIE OD GRUPY. Firma, ktora kupila bilety dla
// zespolu, zostawia kilka zamowien (kazdy bilet z karty to osobne zamowienie)
// albo pakiet - baza sortuje je po znormalizowanym NIP-ie z prosby nabywcy,
// a ekran rysuje grupe na NIP. Zaznaczenie wielu zamowien daje JEDNA fakture
// z pozycjami wedlug rodzaju biletu; jedno zamowienie - fakture z pozycja na
// zamowienie. Proforma dziala dla dowolnego zaznaczenia (typowo pakiety
// i zapisy oplacane przelewem).
//
// "WYSTAW Z PROSB" to masowa sciezka: baza wystawia faktury ze wszystkich
// oczekujacych prosb o OPLACONE zamowienia (jedna na prosbe albo zbiorczo per
// NIP); blad jednej grupy nie wycofuje reszty, a ekran mowi, ile sie udalo.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MoneyText } from "@/components/billing/atoms/MoneyText";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/lib/appDialogs";
import { adminEventInvoiceErrorMessage } from "@/lib/events/adminEventInvoiceErrors";
import type {
  EventInvoiceCandidateRow,
  IssuePendingResult,
  InvoiceSourceRef,
} from "@/lib/events/eventInvoicesApi";
import { pickEnum, EVENT_INVOICE_SOURCE_KINDS } from "@/lib/events/eventInvoiceEnums";
import {
  useCreateInvoiceDraft,
  useInvoiceCandidates,
  useIssuePendingInvoices,
} from "@/lib/events/useEventInvoices";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

type PaymentState = "paid" | "unpaid" | "partially_refunded";

const PAYMENT_LABEL_KEYS: Record<PaymentState, string> = {
  paid: "adminEventInvoices.candidates.payment.paid",
  unpaid: "adminEventInvoices.candidates.payment.unpaid",
  partially_refunded: "adminEventInvoices.candidates.payment.partially_refunded",
};

const PAID_VIA_LABEL_KEYS: Record<"card" | "transfer", string> = {
  card: "adminEventInvoices.candidates.paidVia.card",
  transfer: "adminEventInvoices.candidates.paidVia.transfer",
};

interface CandidateGroup {
  key: string;
  taxKey: string | null;
  buyerName: string;
  rows: EventInvoiceCandidateRow[];
}

/** Grupy po NIP-ie w kolejnosci bazy (NIP rosnaco, potem zamowienia bez NIP-u). */
export function groupCandidates(rows: readonly EventInvoiceCandidateRow[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const row of rows) {
    const key = row.tax_key === null ? "none" : `tax:${row.tax_key}`;
    const group = groups.get(key) ?? { key, taxKey: row.tax_key, buyerName: row.buyer_name ?? "", rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function paymentState(value: string): PaymentState {
  return value === "paid" || value === "partially_refunded" ? value : "unpaid";
}

export interface EventInvoiceCandidatesListProps {
  eventId: string;
  enabled: boolean;
  onDraftCreated: (invoiceId: string) => void;
  onBulkIssued: (result: IssuePendingResult) => void;
}

export function EventInvoiceCandidatesList({
  eventId,
  enabled,
  onDraftCreated,
  onBulkIssued,
}: EventInvoiceCandidatesListProps) {
  ensureAdminEventInvoicesI18n();
  const { t } = useTranslation();
  const candidatesQ = useInvoiceCandidates(eventId);
  const createDraft = useCreateInvoiceDraft(eventId);
  const issuePending = useIssuePendingInvoices(eventId);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const rows = useMemo(
    () => (candidatesQ.data ?? []).filter((row) => !onlyOpen || row.invoice_id === null),
    [candidatesQ.data, onlyOpen],
  );
  const groups = groupCandidates(rows);
  const selectedRows = rows.filter((row) => selected.has(row.source_id));
  const busy = createDraft.isPending || issuePending.isPending;

  function toggle(ids: readonly string[], on: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function draft(kind: "invoice" | "proforma"): void {
    const sources: InvoiceSourceRef[] = selectedRows.map((row) => ({
      kind: pickEnum(EVENT_INVOICE_SOURCE_KINDS, row.source_kind),
      id: row.source_id,
    }));
    createDraft.mutate(
      {
        eventId,
        kind,
        sources,
        aggregate: sources.length > 1 ? "per_ticket_type" : "per_source",
      },
      {
        onSuccess: (invoiceId) => {
          setSelected(new Set());
          toast.success(t("adminEventInvoices.toasts.draftCreated"));
          onDraftCreated(invoiceId);
        },
        onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
      },
    );
  }

  async function bulk(collective: boolean): Promise<void> {
    const confirmed = await confirmDialog({
      title: t("adminEventInvoices.candidates.issuePendingTitle"),
      description: collective
        ? t("adminEventInvoices.candidates.issuePendingCollectiveBody")
        : t("adminEventInvoices.candidates.issuePendingBody"),
      confirmLabel: t("adminEventInvoices.candidates.issuePendingConfirm"),
      cancelLabel: t("adminEventInvoices.documents.keep"),
    });
    if (!confirmed) return;
    issuePending.mutate(collective, {
      onSuccess: (result) => {
        if (result.issued.length === 0 && result.failed.length === 0) {
          toast.info(t("adminEventInvoices.candidates.bulkNothing"));
        } else {
          toast.success(
            t("adminEventInvoices.candidates.bulkResult", {
              issued: result.issued.length,
              failed: result.failed.length,
            }),
          );
        }
        for (const failure of result.failed) {
          toast.error(adminEventInvoiceErrorMessage(`${failure.code}: bulk`));
        }
        onBulkIssued(result);
      },
      onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(event) => setOnlyOpen(event.target.checked)}
          />
          {t("adminEventInvoices.candidates.onlyOpen")}
        </label>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!enabled || busy} onClick={() => void bulk(false)}>
            {t("adminEventInvoices.candidates.issuePending")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!enabled || busy} onClick={() => void bulk(true)}>
            {t("adminEventInvoices.candidates.issuePendingCollective")}
          </Button>
        </span>
      </div>
      <AdminCatalogListState
        isLoading={candidatesQ.isLoading}
        loadingLabel={t("adminEventInvoices.loading")}
        errorMessage={candidatesQ.isError ? adminEventInvoiceErrorMessage(candidatesQ.error) : null}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventInvoices.candidates.empty")}
      >
        <div className="space-y-4">
          {groups.map((group) => {
            const selectable = group.rows.filter((row) => row.invoice_id === null).map((row) => row.source_id);
            const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
            return (
              <section key={group.key} className="rounded-md border border-border">
                <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      aria-label={t("adminEventInvoices.candidates.selectGroup")}
                      onChange={(event) => toggle(selectable, event.target.checked)}
                    />
                    {group.taxKey === null
                      ? t("adminEventInvoices.candidates.groupNoTaxId")
                      : `${group.buyerName} · ${t("adminEventInvoices.candidates.groupTaxId", { taxId: group.taxKey })}`}
                  </label>
                </header>
                <ul className="divide-y divide-border">
                  {group.rows.map((row) => (
                    <CandidateRow
                      key={row.source_id}
                      row={row}
                      checked={selected.has(row.source_id)}
                      onToggle={(on) => toggle([row.source_id], on)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </AdminCatalogListState>
      {selectedRows.length === 0 ? null : (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 py-3">
          <span className="mr-auto text-sm">
            {t("adminEventInvoices.candidates.selected", { count: selectedRows.length })}
          </span>
          <Button type="button" variant="outline" disabled={!enabled || busy} onClick={() => draft("proforma")}>
            {t("adminEventInvoices.candidates.proforma")}
          </Button>
          <Button type="button" disabled={!enabled || busy} onClick={() => draft("invoice")}>
            {selectedRows.length > 1
              ? t("adminEventInvoices.candidates.collective")
              : t("adminEventInvoices.candidates.invoice")}
          </Button>
        </div>
      )}
    </div>
  );
}

function CandidateRow({
  row,
  checked,
  onToggle,
}: {
  row: EventInvoiceCandidateRow;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const english = i18n.language.startsWith("en");
  const itemName = english && row.label_en !== "" ? row.label_en : row.label_pl;
  const label =
    row.source_kind === "package_order"
      ? t("adminEventInvoices.candidates.package", { name: itemName })
      : t("adminEventInvoices.candidates.ticket", { name: itemName });
  const state = paymentState(row.payment_state);
  return (
    <li className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_auto_minmax(0,1.5fr)] sm:items-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={row.invoice_id !== null}
        aria-label={t("adminEventInvoices.candidates.selectRow", { name: row.person_name })}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <div className="min-w-0">
        <p className="truncate font-medium">{row.person_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {label} · {t("adminEventInvoices.candidates.seats", { count: row.seats })}
        </p>
      </div>
      <div className="min-w-0 text-xs">
        {row.request_id === null ? (
          <span className="text-muted-foreground">{row.company_text}</span>
        ) : (
          <>
            <Badge variant="secondary">{t("adminEventInvoices.candidates.requested")}</Badge>
            <span className="ml-2">{row.buyer_name}</span>
          </>
        )}
      </div>
      <div className="text-right tabular-nums">
        <MoneyText cents={row.gross_cents} currency={row.currency} />
        <p className="text-xs text-muted-foreground">
          {t(PAYMENT_LABEL_KEYS[state])}
          {state === "unpaid" ? null : ` · ${t(PAID_VIA_LABEL_KEYS[row.paid_via === "card" ? "card" : "transfer"])}`}
        </p>
        {row.amount_source === "price_list" ? (
          <p className="text-xs text-amber-700">{t("adminEventInvoices.candidates.priceList")}</p>
        ) : null}
      </div>
      <div className="text-xs">
        {row.invoice_id !== null ? (
          <Badge variant="outline">
            {row.invoice_status === "draft"
              ? t("adminEventInvoices.candidates.hasDraft")
              : t("adminEventInvoices.candidates.hasInvoice", { number: row.invoice_number })}
          </Badge>
        ) : row.proforma_id !== null ? (
          <Badge variant="outline">
            {t("adminEventInvoices.candidates.hasProforma", {
              number: row.proforma_number ?? t("adminEventInvoices.documents.draftNumber"),
            })}
          </Badge>
        ) : (
          <span className="text-muted-foreground">{t("adminEventInvoices.candidates.noDocument")}</span>
        )}
      </div>
    </li>
  );
}

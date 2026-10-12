// Molekula: RECZNY STAN KSeF wystawionego dokumentu.
//
// Klienta API KSeF w tej wersji nie ma (szew pod nastepny krok): organizator
// wysyla dokument do KSeF poza systemem i tu zapisuje stan oraz numer nadany
// przez KSeF. "Przyjeta" wymaga numeru - pilnuje tego baza, a okno mowi
// dlaczego zapis zostal odrzucony.
//
// TYLKO DO PRZODU (INV-02). Lista stanow to obecny stan i stany z niego
// osiagalne (`ksefNextStatuses`, lustro grafu w bazie): dokumentu przyjetego
// w KSeF nie da sie "cofnac" do stanu, w ktorym wolno go anulowac. Numer
// nadany raz jest tylko do odczytu, a kazda zmiana trafia do dziennika
// (notatka + kto i kiedy) widocznego pod formularzem.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { adminEventInvoiceErrorMessage } from "@/lib/events/adminEventInvoiceErrors";
import { KSEF_STATUS_LABEL_KEYS } from "@/lib/events/adminEventInvoiceLabels";
import {
  EVENT_INVOICE_KSEF_STATUSES,
  KSEF_NUMBER_PATTERN,
  ksefNextStatuses,
  normalizeKsefNumber,
  pickEnum,
  type EventInvoiceKsefStatus,
} from "@/lib/events/eventInvoiceEnums";
import type { EventInvoiceListRow } from "@/lib/events/eventInvoicesApi";
import { useEventInvoice, useUpdateInvoiceKsef } from "@/lib/events/useEventInvoices";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

export function EventInvoiceKsefDialog({
  eventId,
  row,
  onClose,
}: {
  eventId: string;
  row: EventInvoiceListRow | null;
  onClose: () => void;
}) {
  ensureAdminEventInvoicesI18n();
  const { t } = useTranslation();
  return (
    <Dialog open={row !== null} onOpenChange={onClose}>
      <DialogContent className="event-dialog-compact max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("adminEventInvoices.ksef.title", { number: row?.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("adminEventInvoices.ksef.hint")}</DialogDescription>
        </DialogHeader>
        {row === null ? null : (
          <KsefForm key={row.id} eventId={eventId} row={row} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function KsefForm({
  eventId,
  row,
  onClose,
}: {
  eventId: string;
  row: EventInvoiceListRow;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const update = useUpdateInvoiceKsef(eventId);
  const detailQ = useEventInvoice(eventId, row.id);
  const current = pickEnum(EVENT_INVOICE_KSEF_STATUSES, row.ksef_status);
  const options = ksefNextStatuses(current);
  const [status, setStatus] = useState<EventInvoiceKsefStatus>(current);
  const [number, setNumber] = useState(row.ksef_number ?? "");
  const [note, setNote] = useState("");
  const numberLocked = row.ksef_number !== null;
  const normalized = normalizeKsefNumber(number);
  const numberInvalid =
    status === "accepted" &&
    !numberLocked &&
    normalized !== "" &&
    !KSEF_NUMBER_PATTERN.test(normalized);
  const unchanged = status === current && (numberLocked || normalized === "") && note.trim() === "";

  function submit(): void {
    update.mutate(
      { id: row.id, status, number: status === "accepted" ? normalized : "", note: note.trim() },
      {
        onSuccess: () => {
          toast.success(t("adminEventInvoices.toasts.ksefSaved"));
          onClose();
        },
        onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
      },
    );
  }

  const events = detailQ.data?.ksefEvents ?? [];
  const when = (value: string): string =>
    value === "" ? "" : new Date(value).toLocaleString(i18n.language === "en" ? "en-GB" : "pl-PL");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`ksef-status-${row.id}`}>{t("adminEventInvoices.ksef.status")}</Label>
        <FormSelect
          id={`ksef-status-${row.id}`}
          value={status}
          disabled={options.length === 1}
          onValueChange={(value) => setStatus(pickEnum(options, value))}
          options={options.map((value) => ({
            value,
            label: t(KSEF_STATUS_LABEL_KEYS[value]),
          }))}
        />
        {options.length === 1 ? (
          <p className="text-xs text-muted-foreground">{t("adminEventInvoices.ksef.terminal")}</p>
        ) : null}
      </div>
      {status === "accepted" || numberLocked ? (
        <AdminFormTextRow
          label={t("adminEventInvoices.ksef.number")}
          value={number}
          maxLength={35}
          monospace
          disabled={numberLocked}
          hint={
            numberLocked
              ? t("adminEventInvoices.ksef.numberLocked")
              : numberInvalid
                ? t("adminEventInvoices.ksef.numberFormat")
                : t("adminEventInvoices.ksef.numberHint")
          }
          onValueChange={setNumber}
        />
      ) : null}
      <AdminFormTextRow
        label={t("adminEventInvoices.ksef.note")}
        value={note}
        maxLength={500}
        hint={t("adminEventInvoices.ksef.noteHint")}
        onValueChange={setNote}
      />
      {events.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("adminEventInvoices.ksef.history")}</p>
          <ol className="space-y-1 text-xs text-muted-foreground">
            {events.map((event, index) => (
              <li key={`${event.createdAt}-${index}`}>
                {when(event.createdAt)} ·{" "}
                {event.fromStatus === null
                  ? ""
                  : `${t(KSEF_STATUS_LABEL_KEYS[event.fromStatus])} → `}
                {t(KSEF_STATUS_LABEL_KEYS[event.toStatus])}
                {event.toNumber !== null && event.toNumber !== event.fromNumber
                  ? ` · ${event.toNumber}`
                  : ""}
                {event.note !== "" && event.note !== "issued" ? ` · ${event.note}` : ""}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("adminEventInvoices.ksef.cancel")}
        </Button>
        <Button
          type="button"
          disabled={update.isPending || unchanged || numberInvalid}
          onClick={submit}
        >
          {t("adminEventInvoices.ksef.save")}
        </Button>
      </DialogFooter>
    </div>
  );
}

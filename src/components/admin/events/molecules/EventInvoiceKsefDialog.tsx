// Molekula: RECZNY STAN KSeF wystawionego dokumentu.
//
// Klienta API KSeF w tej wersji nie ma (szew pod nastepny krok): organizator
// wysyla dokument do KSeF poza systemem i tu zapisuje stan oraz numer nadany
// przez KSeF. "Przyjeta" wymaga numeru - pilnuje tego baza, a okno mowi
// dlaczego zapis zostal odrzucony.
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
  pickEnum,
  type EventInvoiceKsefStatus,
} from "@/lib/events/eventInvoiceEnums";
import type { EventInvoiceListRow } from "@/lib/events/eventInvoicesApi";
import { useUpdateInvoiceKsef } from "@/lib/events/useEventInvoices";
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
  const { t } = useTranslation();
  const update = useUpdateInvoiceKsef(eventId);
  const [status, setStatus] = useState<EventInvoiceKsefStatus>(
    pickEnum(EVENT_INVOICE_KSEF_STATUSES, row.ksef_status),
  );
  const [number, setNumber] = useState(row.ksef_number ?? "");

  function submit(): void {
    update.mutate(
      { id: row.id, status, number: number.trim() },
      {
        onSuccess: () => {
          toast.success(t("adminEventInvoices.toasts.ksefSaved"));
          onClose();
        },
        onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`ksef-status-${row.id}`}>{t("adminEventInvoices.ksef.status")}</Label>
        <FormSelect
          id={`ksef-status-${row.id}`}
          value={status}
          onValueChange={(value) => setStatus(pickEnum(EVENT_INVOICE_KSEF_STATUSES, value))}
          options={EVENT_INVOICE_KSEF_STATUSES.map((value) => ({
            value,
            label: t(KSEF_STATUS_LABEL_KEYS[value]),
          }))}
        />
      </div>
      <AdminFormTextRow
        label={t("adminEventInvoices.ksef.number")}
        value={number}
        maxLength={64}
        monospace
        onValueChange={setNumber}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("adminEventInvoices.ksef.cancel")}
        </Button>
        <Button type="button" disabled={update.isPending} onClick={submit}>
          {t("adminEventInvoices.ksef.save")}
        </Button>
      </DialogFooter>
    </div>
  );
}

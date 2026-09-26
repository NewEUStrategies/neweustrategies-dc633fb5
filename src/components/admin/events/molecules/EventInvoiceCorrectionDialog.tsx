// Molekula: KOREKTA wystawionej faktury - wybor zakresu i przyczyny.
//
// Pelna korekta odwraca caly dokument (typowo: zwrot biletu) i po
// wystawieniu zwalnia zamowienia do ponownego zafakturowania. Korekta
// wybranych pozycji zapisuje pare "przed/po" dla kazdej zmienionej pozycji
// (nowa ilosc, cena brutto albo stawka). Okno tworzy SZKIC korekty, ktory
// organizator oglada w edytorze przed wystawieniem - baza nadaje mu numer
// z serii korekt dopiero przy wystawieniu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { adminEventInvoiceErrorMessage } from "@/lib/events/adminEventInvoiceErrors";
import { VAT_RATE_LABEL_KEYS } from "@/lib/events/adminEventInvoiceLabels";
import type { EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { pickEnum, type EventInvoiceCorrectionMode } from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES, type EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";
import type { CorrectionLineChange } from "@/lib/events/eventInvoicesApi";
import {
  registrationPriceCents,
  registrationPriceInput,
} from "@/lib/events/registrationSettingsDraft";
import { useCreateInvoiceCorrection, useEventInvoice } from "@/lib/events/useEventInvoices";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

interface LineChangeDraft {
  quantity: string;
  unitGross: string;
  vatRate: EventInvoiceVatRate;
}

export function EventInvoiceCorrectionDialog({
  eventId,
  invoiceId,
  onClose,
  onCreated,
}: {
  eventId: string;
  invoiceId: string | null;
  onClose: () => void;
  onCreated: (draftId: string) => void;
}) {
  ensureAdminEventInvoicesI18n();
  const { t } = useTranslation();
  const docQ = useEventInvoice(eventId, invoiceId);
  return (
    <Dialog open={invoiceId !== null} onOpenChange={onClose}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("adminEventInvoices.correction.title", { number: docQ.data?.number ?? "" })}
          </DialogTitle>
        </DialogHeader>
        {docQ.data === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("adminEventInvoices.loading")}
          </p>
        ) : (
          <CorrectionForm
            key={docQ.data.id}
            eventId={eventId}
            doc={docQ.data}
            onClose={onClose}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CorrectionForm({
  eventId,
  doc,
  onClose,
  onCreated,
}: {
  eventId: string;
  doc: EventInvoiceDocument;
  onClose: () => void;
  onCreated: (draftId: string) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateInvoiceCorrection(eventId);
  const [mode, setMode] = useState<EventInvoiceCorrectionMode>("full");
  const [reason, setReason] = useState("");
  const [changes, setChanges] = useState<Record<string, LineChangeDraft>>(() =>
    Object.fromEntries(
      doc.lines.map((line) => [
        line.id,
        {
          quantity: String(line.quantity),
          unitGross: registrationPriceInput(line.unitGrossCents),
          vatRate: line.vatRate,
        },
      ]),
    ),
  );

  function lineChanges(): CorrectionLineChange[] | null {
    const out: CorrectionLineChange[] = [];
    for (const line of doc.lines) {
      const change = changes[line.id];
      const quantity = Number(change.quantity.trim());
      const unitGross = registrationPriceCents(change.unitGross);
      if (
        !/^\d{1,5}$/.test(change.quantity.trim()) ||
        unitGross === null ||
        Number.isNaN(unitGross)
      ) {
        return null;
      }
      if (
        quantity !== line.quantity ||
        unitGross !== line.unitGrossCents ||
        change.vatRate !== line.vatRate
      ) {
        out.push({ lineId: line.id, quantity, unitGrossCents: unitGross, vatRate: change.vatRate });
      }
    }
    return out;
  }

  function submit(): void {
    const lines = mode === "partial" ? lineChanges() : [];
    if (lines === null) {
      toast.error(t("adminEventInvoices.draft.errors.fix"));
      return;
    }
    create.mutate(
      { invoiceId: doc.id, mode, reason: reason.trim(), ...(mode === "partial" ? { lines } : {}) },
      {
        onSuccess: (draftId) => {
          toast.success(t("adminEventInvoices.toasts.correctionCreated"));
          onCreated(draftId);
        },
        onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("adminEventInvoices.correction.mode")}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={`correction-mode-${doc.id}`}
            checked={mode === "full"}
            onChange={() => setMode("full")}
          />
          {t("adminEventInvoices.correction.modeFull")}
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={`correction-mode-${doc.id}`}
            checked={mode === "partial"}
            onChange={() => setMode("partial")}
          />
          {t("adminEventInvoices.correction.modePartial")}
        </label>
      </fieldset>
      <AdminFormTextRow
        label={t("adminEventInvoices.correction.reason")}
        hint={t("adminEventInvoices.correction.reasonHint")}
        value={reason}
        maxLength={500}
        onValueChange={setReason}
      />
      {mode === "partial" ? (
        <ul className="space-y-3">
          {doc.lines.map((line) => {
            const change = changes[line.id];
            const update = (patch: Partial<LineChangeDraft>) =>
              setChanges((current) => ({
                ...current,
                [line.id]: { ...current[line.id], ...patch },
              }));
            return (
              <li
                key={line.id}
                className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
              >
                <AdminFormTextRow
                  label={t("adminEventInvoices.correction.lineQuantity", {
                    description: line.description,
                  })}
                  value={change.quantity}
                  inputMode="numeric"
                  onValueChange={(quantity) => update({ quantity })}
                />
                <AdminFormTextRow
                  label={t("adminEventInvoices.correction.lineUnitGross", {
                    description: line.description,
                  })}
                  value={change.unitGross}
                  inputMode="decimal"
                  onValueChange={(unitGross) => update({ unitGross })}
                />
                <div className="space-y-1.5">
                  <Label htmlFor={`correction-rate-${line.id}`}>
                    {t("adminEventInvoices.correction.lineVatRate", {
                      description: line.description,
                    })}
                  </Label>
                  <FormSelect
                    id={`correction-rate-${line.id}`}
                    value={change.vatRate}
                    onValueChange={(value) =>
                      update({ vatRate: pickEnum(EVENT_INVOICE_VAT_RATES, value) })
                    }
                    options={EVENT_INVOICE_VAT_RATES.map((rate) => ({
                      value: rate,
                      label: t(VAT_RATE_LABEL_KEYS[rate]),
                    }))}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("adminEventInvoices.correction.cancel")}
        </Button>
        <Button type="button" disabled={create.isPending} onClick={submit}>
          {create.isPending
            ? t("adminEventInvoices.correction.creating")
            : t("adminEventInvoices.correction.create")}
        </Button>
      </DialogFooter>
    </div>
  );
}

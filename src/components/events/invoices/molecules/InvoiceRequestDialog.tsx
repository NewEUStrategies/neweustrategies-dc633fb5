// Molekula: okno "Dane do faktury" dla zamowienia z profilu kupujacego.
//
// Prosba po zakupie (obietnica z regulaminu: "wystawimy fakture, jesli
// podasz dane przed zakupem albo niezwlocznie po nim"). Termin pilnuje baza
// (koniec trzeciego miesiaca po miesiacu zaplaty) - okno pokazuje jej odmowe
// zdaniem z `eventInvoices.errors.*`.
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InvoiceBuyerFields } from "@/components/events/invoices/molecules/InvoiceBuyerFields";
import {
  hasBuyerErrors,
  validateBuyerDraft,
  type InvoiceBuyerDraft,
} from "@/lib/events/eventInvoiceBuyerDraft";
import { eventInvoiceErrorKey } from "@/lib/events/eventInvoiceErrors";
import type { InvoiceRequestTarget } from "@/lib/events/myEventInvoicesApi";
import { useSaveInvoiceRequest } from "@/lib/events/useMyEventInvoices";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";

export interface InvoiceRequestDialogProps {
  target: InvoiceRequestTarget;
  initial: InvoiceBuyerDraft;
  onClose: () => void;
  onSaved: () => void;
}

export function InvoiceRequestDialog({ target, initial, onClose, onSaved }: InvoiceRequestDialogProps) {
  ensureEventInvoicesI18n();
  const { t } = useTranslation();
  const save = useSaveInvoiceRequest();
  const [buyer, setBuyer] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [failureKey, setFailureKey] = useState<string | null>(null);
  const errors = validateBuyerDraft(buyer);

  function submit(): void {
    setShowErrors(true);
    if (hasBuyerErrors(errors)) return;
    setFailureKey(null);
    save.mutate(
      { target, buyer },
      {
        onSuccess: onSaved,
        onError: (error) => setFailureKey(eventInvoiceErrorKey(error)),
      },
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("eventInvoices.profile.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("eventInvoices.profile.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <InvoiceBuyerFields
          value={buyer}
          onChange={setBuyer}
          errors={errors}
          showErrors={showErrors}
          disabled={save.isPending}
        />
        {failureKey === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {t(failureKey)}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("eventInvoices.profile.close")}
          </Button>
          <Button type="button" onClick={submit} disabled={save.isPending}>
            {save.isPending
              ? t("eventInvoices.profile.submitting")
              : t("eventInvoices.profile.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

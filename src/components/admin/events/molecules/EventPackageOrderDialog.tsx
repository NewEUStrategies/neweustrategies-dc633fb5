// Molekuła: nowe ZAMÓWIENIE pakietu grupowego.
//
// PUSTE POLA ZNACZĄ „JAK W PAKIECIE", nie zero. Liczba miejsc i kwota są
// nadpisaniami warunków oferty (negocjacja, rabat delegacyjny), więc pusty
// input musi wysłać `null`, a nie `0` - zero zamknęłoby zamówienie bez ani
// jednego miejsca albo wystawiło je za darmo.
import { useEffect, useState } from "react";
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
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import type { PackageOrderInput } from "@/lib/events/packagesApi";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface OrderDraft {
  buyerEmail: string;
  buyerName: string;
  seatsTotal: string;
  amountCents: string;
  invoiceNote: string;
}

const EMPTY: OrderDraft = {
  buyerEmail: "",
  buyerName: "",
  seatsTotal: "",
  amountCents: "",
  invoiceNote: "",
};

type OrderField = keyof OrderDraft;

function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function orderDraftIssue(
  draft: OrderDraft,
): { field: OrderField; errorKey: string } | null {
  if (!EMAIL_PATTERN.test(draft.buyerEmail.trim())) {
    return { field: "buyerEmail", errorKey: "packageOrderBuyerEmail" };
  }
  if (draft.seatsTotal.trim() !== "") {
    const seats = intOrNull(draft.seatsTotal);
    if (seats === null || seats < 1 || seats > 1_000) {
      return { field: "seatsTotal", errorKey: "packageOrderSeats" };
    }
  }
  if (draft.amountCents.trim() !== "") {
    const amount = intOrNull(draft.amountCents);
    if (amount === null || amount > 10_000_000) {
      return { field: "amountCents", errorKey: "packageOrderAmount" };
    }
  }
  return null;
}

interface EventPackageOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId: string;
  isSaving: boolean;
  onSubmit: (input: PackageOrderInput) => void;
}

export function EventPackageOrderDialog({
  open,
  onOpenChange,
  packageId,
  isSaving,
  onSubmit,
}: EventPackageOrderDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<OrderDraft>(EMPTY);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(EMPTY);
    setTouched(false);
  }, [open]);

  const issue = orderDraftIssue(draft);
  const errorFor = (field: OrderField): string | null =>
    touched && issue?.field === field ? t(`adminEventRegistration.errors.${issue.errorKey}`) : null;

  const set = <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit({
      packageId,
      buyerEmail: draft.buyerEmail.trim(),
      buyerName: draft.buyerName.trim(),
      seatsTotal: draft.seatsTotal.trim() === "" ? null : intOrNull(draft.seatsTotal),
      amountCents: draft.amountCents.trim() === "" ? null : intOrNull(draft.amountCents),
      invoiceNote: draft.invoiceNote.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("adminEventRegistration.packages.orders.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("adminEventRegistration.packages.orders.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <AdminFormSection title={t("adminEventRegistration.packages.orders.buyer")} columns={2}>
          <AdminFormTextRow
            label={t("adminEventRegistration.packages.orders.buyerEmail")}
            value={draft.buyerEmail}
            onValueChange={(value) => set("buyerEmail", value)}
            type="email"
            maxLength={200}
            error={errorFor("buyerEmail")}
          />
          <AdminFormTextRow
            label={t("adminEventRegistration.packages.orders.buyerName")}
            value={draft.buyerName}
            onValueChange={(value) => set("buyerName", value)}
            maxLength={200}
          />
          <AdminFormTextRow
            label={t("adminEventRegistration.packages.orders.seatsTotal")}
            hint={t("adminEventRegistration.packages.orders.seatsTotalHint")}
            value={draft.seatsTotal}
            onValueChange={(value) => set("seatsTotal", value)}
            inputMode="numeric"
            error={errorFor("seatsTotal")}
          />
          <AdminFormTextRow
            label={t("adminEventRegistration.packages.orders.amountCents")}
            hint={t("adminEventRegistration.packages.orders.amountHint")}
            value={draft.amountCents}
            onValueChange={(value) => set("amountCents", value)}
            inputMode="numeric"
            error={errorFor("amountCents")}
          />
          <AdminFormTextRow
            label={t("adminEventRegistration.packages.orders.invoiceNote")}
            value={draft.invoiceNote}
            onValueChange={(value) => set("invoiceNote", value)}
            rows={2}
            maxLength={500}
            className="sm:col-span-2"
          />
        </AdminFormSection>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("adminEventRegistration.packages.orders.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventRegistration.packages.orders.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

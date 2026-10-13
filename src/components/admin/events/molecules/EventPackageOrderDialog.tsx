// Molekuła: nowe ZAMÓWIENIE pakietu grupowego.
//
// PUSTE POLA ZNACZĄ „JAK W PAKIECIE", nie zero. Liczba miejsc i kwota są
// nadpisaniami warunków oferty (negocjacja, rabat delegacyjny), więc pusty
// input musi wysłać `null`, a nie `0` - zero zamknęłoby zamówienie bez ani
// jednego miejsca albo wystawiło je za darmo.
//
// KWOTA W ZŁOTYCH (TIX-14a), jak cena pakietu w tym samym panelu. Pole w
// groszach obok ceny w złotych to dwie jednostki na jednym ekranie: „899"
// wpisane tu z myślą o złotych wystawiało zamówienie za 8,99 zł. Tekst zamienia
// na grosze ten sam parser co cenę pakietu, a podgląd mówi kwotę w walucie
// pakietu, zanim zamówienie powstanie.
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
import { MoneyInputPreview } from "@/components/admin/events/atoms/MoneyInputPreview";
import { parseMoneyInput } from "@/lib/billing/moneyInput";
import type { PackageOrderInput } from "@/lib/events/packagesApi";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface OrderDraft {
  buyerEmail: string;
  buyerName: string;
  seatsTotal: string;
  /** Kwota w jednostce głównej waluty pakietu („899,00"); puste = cena pakietu. */
  amount: string;
  invoiceNote: string;
}

/** Górna granica nadpisanej kwoty: 100 000,00 w walucie pakietu. */
const MAX_ORDER_AMOUNT_CENTS = 10_000_000;

const EMPTY: OrderDraft = {
  buyerEmail: "",
  buyerName: "",
  seatsTotal: "",
  amount: "",
  invoiceNote: "",
};

type OrderField = keyof OrderDraft;

function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function orderDraftIssue(draft: OrderDraft): { field: OrderField; errorKey: string } | null {
  if (!EMAIL_PATTERN.test(draft.buyerEmail.trim())) {
    return { field: "buyerEmail", errorKey: "packageOrderBuyerEmail" };
  }
  if (draft.seatsTotal.trim() !== "") {
    const seats = intOrNull(draft.seatsTotal);
    if (seats === null || seats < 1 || seats > 1_000) {
      return { field: "seatsTotal", errorKey: "packageOrderSeats" };
    }
  }
  if (draft.amount.trim() !== "") {
    const amount = parseMoneyInput(draft.amount);
    if (amount === null || amount > MAX_ORDER_AMOUNT_CENTS) {
      return { field: "amount", errorKey: "packageOrderAmount" };
    }
  }
  return null;
}

interface EventPackageOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packageId: string;
  /** Waluta pakietu - podgląd kwoty mówi w niej, jak cena pakietu. */
  currency: string;
  isSaving: boolean;
  onSubmit: (input: PackageOrderInput) => void;
}

export function EventPackageOrderDialog({
  open,
  onOpenChange,
  packageId,
  currency,
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
      amountCents: draft.amount.trim() === "" ? null : parseMoneyInput(draft.amount),
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
            label={t("adminEventRegistration.packages.orders.orderAmount")}
            hint={t("adminEventRegistration.packages.orders.amountHint")}
            value={draft.amount}
            onValueChange={(value) => set("amount", value)}
            inputMode="decimal"
            error={errorFor("amount")}
            endAdornment={<MoneyInputPreview value={draft.amount} currency={currency} />}
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

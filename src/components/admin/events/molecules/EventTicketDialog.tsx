// Molekuła: formularz jednego BILETU wydarzenia.
//
// KLUCZ JEST ZAMROŻONY PO ZAPISIE. Zapisane zgłoszenia wskazują bilet przez
// identyfikator, ale integracje i importy posługują się kluczem - jego zmiana
// rozjechałaby je bez żadnego błędu. RPC zapisu też ignoruje klucz przy edycji,
// więc pole pokazujemy wyłączone, zamiast udawać, że da się je poprawić.
//
// GRUPY NIE WYBIERAMY TUTAJ. Katalog grup wydarzenia ma własny ekran; do czasu
// jego powstania edycja biletu PRZENOSI istniejące przypisanie bez zmian,
// zamiast po cichu je zerować przy każdym zapisie nazwy.
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
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import {
  TICKET_CURRENCIES,
  TICKET_MAX_DESCRIPTION,
  TICKET_MAX_NAME,
  emptyTicketDraft,
  ticketDraftFromRow,
  ticketDraftIssue,
  ticketDraftToInput,
  type TicketCurrency,
  type TicketDraft,
  type TicketDraftField,
} from "@/lib/events/ticketDraft";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";

interface EventTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy bilet. */
  ticket: EventTicketRow | null;
  /** Domyślna kolejność dla nowego biletu - koniec listy. */
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: EventTicketInput) => void;
}

export function EventTicketDialog({
  open,
  onOpenChange,
  eventId,
  ticket,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventTicketDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TicketDraft>(() => emptyTicketDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  // Szkic odtwarzamy przy KAŻDYM otwarciu, nie tylko przy zmianie biletu:
  // porzucone zmiany nie mogą wrócić do formularza następnego biletu.
  useEffect(() => {
    if (!open) return;
    setDraft(ticket === null ? emptyTicketDraft(nextSortOrder) : ticketDraftFromRow(ticket));
    setTouched(false);
  }, [open, ticket, nextSortOrder]);

  const issue = ticketDraftIssue(draft);
  const errorFor = (field: TicketDraftField): string | null =>
    touched && issue?.field === field ? t(`adminEventRegistration.errors.${issue.errorKey}`) : null;

  const set = <K extends keyof TicketDraft>(key: K, value: TicketDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit(ticketDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventRegistration.tickets.editor.createTitle"
                : "adminEventRegistration.tickets.editor.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventRegistration.tickets.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <AdminFormSection title={t("adminEventRegistration.tickets.columns.name")} columns={2}>
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.key")}
              hint={t("adminEventRegistration.tickets.editor.keyHint")}
              value={draft.key}
              onValueChange={(value) => set("key", value)}
              disabled={!isNew}
              monospace
              maxLength={49}
              error={errorFor("key")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.sortOrder")}
              value={draft.sortOrder}
              onValueChange={(value) => set("sortOrder", value)}
              inputMode="numeric"
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.namePl")}
              value={draft.namePl}
              onValueChange={(value) => set("namePl", value)}
              maxLength={TICKET_MAX_NAME}
              error={errorFor("namePl")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.nameEn")}
              value={draft.nameEn}
              onValueChange={(value) => set("nameEn", value)}
              maxLength={TICKET_MAX_NAME}
              error={errorFor("nameEn")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.descriptionPl")}
              value={draft.descriptionPl}
              onValueChange={(value) => set("descriptionPl", value)}
              rows={3}
              maxLength={TICKET_MAX_DESCRIPTION}
              error={errorFor("descriptionPl")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.descriptionEn")}
              value={draft.descriptionEn}
              onValueChange={(value) => set("descriptionEn", value)}
              rows={3}
              maxLength={TICKET_MAX_DESCRIPTION}
              error={errorFor("descriptionEn")}
            />
          </AdminFormSection>

          <AdminFormSection title={t("adminEventRegistration.tickets.columns.price")} columns={2}>
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.priceCents")}
              hint={t("adminEventRegistration.tickets.editor.priceHint")}
              value={draft.priceCents}
              onValueChange={(value) => set("priceCents", value)}
              inputMode="numeric"
              error={errorFor("priceCents")}
            />
            <AdminFormEnumRow<TicketCurrency>
              label={t("adminEventRegistration.tickets.editor.currency")}
              value={draft.currency}
              options={TICKET_CURRENCIES}
              labelFor={(option) => t(`adminEventRegistration.currencies.${option}`)}
              onValueChange={(value) => set("currency", value)}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.quota")}
              hint={t("adminEventRegistration.tickets.editor.quotaHint")}
              value={draft.quota}
              onValueChange={(value) => set("quota", value)}
              inputMode="numeric"
              placeholder={t("adminEventRegistration.tickets.unlimitedQuota")}
              error={errorFor("quota")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.minTierRank")}
              value={draft.minTierRank}
              onValueChange={(value) => set("minTierRank", value)}
              inputMode="numeric"
              error={errorFor("minTierRank")}
            />
          </AdminFormSection>

          <AdminFormSection title={t("adminEventRegistration.tickets.columns.window")} columns={2}>
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.salesFrom")}
              value={draft.salesFrom}
              onValueChange={(value) => set("salesFrom", value)}
              type="datetime-local"
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.salesTo")}
              value={draft.salesTo}
              onValueChange={(value) => set("salesTo", value)}
              type="datetime-local"
              error={errorFor("salesTo")}
            />
          </AdminFormSection>

          <AdminFormSection
            title={t("adminEventRegistration.tickets.columns.approval")}
            columns={1}
          >
            <AdminFormSwitchRow
              label={t("adminEventRegistration.tickets.editor.requiresApproval")}
              hint={t("adminEventRegistration.tickets.editor.requiresApprovalHint")}
              checked={draft.requiresApproval}
              onCheckedChange={(checked) => set("requiresApproval", checked)}
            />
            <AdminFormSwitchRow
              label={t("adminEventRegistration.tickets.editor.active")}
              checked={draft.isActive}
              onCheckedChange={(checked) => set("isActive", checked)}
            />
          </AdminFormSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {t("adminEventRegistration.tickets.editor.cancelAction")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventRegistration.tickets.editor.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

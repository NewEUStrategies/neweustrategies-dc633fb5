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
import { useEffect, useRef, useState } from "react";
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
import { EventTicketPhasesEditor } from "@/components/admin/events/molecules/EventTicketPhasesEditor";
import {
  TICKET_ACCESS_CODE_MAX,
  TICKET_CURRENCIES,
  TICKET_MAX_DESCRIPTION,
  TICKET_MAX_ACCESS_CODE_HINT,
  TICKET_MAX_NAME,
  TICKET_MAX_BENEFITS,
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
  //
  // ZALEŻNOŚĆ JEST TOŻSAMOŚCIĄ WIERSZA, NIE OBIEKTEM. `ticket` i `nextSortOrder`
  // przychodzą od rodzica, który przelicza je przy każdym renderze z listy
  // pobieranej zapytaniem. Odświeżenie tej listy W TLE (ktoś inny dodał bilet,
  // fokus wrócił do okna) dawało nowe referencje, efekt ruszał PRZY OTWARTYM
  // dialogu i zamiatał całą wpisaną pracę do wartości z wiersza - bez
  // ostrzeżenia i bez śladu. Kolejność początkowa jest czytana przez `ref`,
  // bo jest potrzebna TYLKO w chwili otwarcia i nie ma prawa niczego wznawiać.
  const nextSortOrderRef = useRef(nextSortOrder);
  nextSortOrderRef.current = nextSortOrder;
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;
  const ticketId = ticket === null ? null : ticket.id;

  useEffect(() => {
    if (!open) return;
    const row = ticketRef.current;
    setDraft(row === null ? emptyTicketDraft(nextSortOrderRef.current) : ticketDraftFromRow(row));
    setTouched(false);
  }, [open, ticketId]);

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

          {/* KORZYSCI SA CZESCIA OFERTY, NIE OPISEM. Karta biletu wypisuje je
              punktami w jezyku widza, wiec kazda linia to jedna korzysc - bez
              recznego wstawiania myslnikow, ktore rozjechalyby sie miedzy PL a EN. */}
          <AdminFormSection
            title={t("adminEventRegistration.tickets.editor.benefitsSection")}
            columns={2}
          >
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.benefitsPl")}
              hint={t("adminEventRegistration.tickets.editor.benefitsHint", {
                max: TICKET_MAX_BENEFITS,
              })}
              value={draft.benefitsPl}
              onValueChange={(value) => set("benefitsPl", value)}
              rows={5}
              error={errorFor("benefitsPl")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.benefitsEn")}
              hint={t("adminEventRegistration.tickets.editor.benefitsHint", {
                max: TICKET_MAX_BENEFITS,
              })}
              value={draft.benefitsEn}
              onValueChange={(value) => set("benefitsEn", value)}
              rows={5}
              error={errorFor("benefitsEn")}
            />
          </AdminFormSection>

          {/* CENNIK FAZOWY WYGRYWA Z CENA BAZOWA I EARLY BIRD - tak liczy baza,
              wiec edytor stoi tuz nad polami, ktore nadpisuje. */}
          <AdminFormSection
            title={t("adminEventRegistration.tickets.editor.phasesSection")}
            columns={1}
          >
            <EventTicketPhasesEditor
              phases={draft.phases}
              onChange={(phases) => set("phases", phases)}
              error={errorFor("phases")}
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

          {/* KOD DOSTĘPU NIE WRACA Z SERWERA. Baza trzyma wyłącznie skrót, więc
              formularz nie ma czego pokazać w polu: puste pole znaczy „zostaw
              obecny kod", a zdjęcie bramki ma osobny przełącznik. Wpisanie
              pustego napisu jako „skasuj" myliłoby jedno z drugim. */}
          <AdminFormSection
            title={t("adminEventRegistration.tickets.editor.advancedSection")}
            columns={2}
          >
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.earlyBirdPriceCents")}
              hint={t("adminEventRegistration.tickets.editor.earlyBirdHint")}
              value={draft.earlyBirdPriceCents}
              onValueChange={(value) => set("earlyBirdPriceCents", value)}
              inputMode="numeric"
              error={errorFor("earlyBirdPriceCents")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.earlyBirdUntil")}
              value={draft.earlyBirdUntil}
              onValueChange={(value) => set("earlyBirdUntil", value)}
              type="datetime-local"
              error={errorFor("earlyBirdUntil")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.accessCode")}
              hint={t(
                draft.hasAccessCode
                  ? "adminEventRegistration.tickets.editor.accessCodeSet"
                  : "adminEventRegistration.tickets.editor.accessCodeNone",
              )}
              value={draft.accessCode}
              onValueChange={(value) => set("accessCode", value)}
              disabled={draft.removeAccessCode}
              maxLength={TICKET_ACCESS_CODE_MAX}
              placeholder={t("adminEventRegistration.tickets.editor.accessCodeHelp")}
              error={errorFor("accessCode")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.tickets.editor.accessCodeHintLabel")}
              hint={t("adminEventRegistration.tickets.editor.accessCodeHintHelp")}
              value={draft.accessCodeHint}
              onValueChange={(value) => set("accessCodeHint", value)}
              maxLength={TICKET_MAX_ACCESS_CODE_HINT}
              error={errorFor("accessCodeHint")}
            />
            {draft.hasAccessCode ? (
              <AdminFormSwitchRow
                label={t("adminEventRegistration.tickets.editor.removeAccessCode")}
                checked={draft.removeAccessCode}
                onCheckedChange={(checked) => set("removeAccessCode", checked)}
              />
            ) : null}
            <AdminFormSwitchRow
              label={t("adminEventRegistration.tickets.editor.waitlistEnabled")}
              hint={t("adminEventRegistration.tickets.editor.waitlistHint")}
              checked={draft.waitlistEnabled}
              onCheckedChange={(checked) => set("waitlistEnabled", checked)}
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

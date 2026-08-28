// Molekuła: formularz jednego PAKIETU GRUPOWEGO.
//
// KLUCZ ZAMRAŻAMY PO ZAPISIE - tak samo jak w bilecie: zamówienia wskazują
// pakiet identyfikatorem, ale importy i faktury posługują się kluczem.
//
// BILET WYBIERAMY Z LISTY BILETÓW TEGO WYDARZENIA, a nie wpisujemy z ręki:
// miejsce z pakietu zamienia się w zwykłe zgłoszenie na wskazanym bilecie, więc
// literówka w identyfikatorze dawałaby pakiet, którego nie da się zrealizować.
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
import { FormSelect } from "@/components/atoms/FormSelect";
import { Label } from "@/components/ui/label";
import { TICKET_CURRENCIES, type TicketCurrency } from "@/lib/events/ticketDraft";
import {
  emptyPackageDraft,
  packageDraftFromRow,
  packageDraftIssue,
  packageDraftToInput,
  type PackageDraft,
  type PackageDraftField,
} from "@/lib/events/packageDraft";
import {
  PACKAGE_AUDIENCES,
  type EventPackageInput,
  type EventPackageRow,
  type PackageAudience,
} from "@/lib/events/packagesApi";
import type { EventTicketRow } from "@/lib/events/registrationsApi";

interface EventPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy pakiet. */
  eventPackage: EventPackageRow | null;
  tickets: EventTicketRow[];
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: EventPackageInput) => void;
}

export function EventPackageDialog({
  open,
  onOpenChange,
  eventId,
  eventPackage,
  tickets,
  nextSortOrder,
  isSaving,
  onSubmit,
}: EventPackageDialogProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<PackageDraft>(() => emptyPackageDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);

  // ZALEŻNOŚĆ JEST TOŻSAMOŚCIĄ WIERSZA, NIE OBIEKTEM - dokładnie jak
  // w `EventTicketDialog`. Rodzic przelicza `eventPackage` i `nextSortOrder`
  // z listy przy każdym renderze, więc odświeżenie tej listy w tle podawało tu
  // nowe referencje, efekt ruszał przy OTWARTYM dialogu i kasował wpisane
  // zmiany. Kolejność początkowa idzie przez `ref`, bo liczy się tylko
  // w chwili otwarcia.
  const nextSortOrderRef = useRef(nextSortOrder);
  nextSortOrderRef.current = nextSortOrder;
  const packageRef = useRef(eventPackage);
  packageRef.current = eventPackage;
  const packageId = eventPackage === null ? null : eventPackage.id;

  useEffect(() => {
    if (!open) return;
    const row = packageRef.current;
    setDraft(
      row === null ? emptyPackageDraft(nextSortOrderRef.current) : packageDraftFromRow(row),
    );
    setTouched(false);
  }, [open, packageId]);

  const issue = packageDraftIssue(draft);
  const errorFor = (field: PackageDraftField): string | null =>
    touched && issue?.field === field ? t(`adminEventRegistration.errors.${issue.errorKey}`) : null;

  const set = <K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit(packageDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;
  const ticketLabel = (row: EventTicketRow) =>
    i18n.language.startsWith("pl") ? row.name_pl : row.name_en;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t(
              isNew
                ? "adminEventRegistration.packages.editor.createTitle"
                : "adminEventRegistration.packages.editor.editTitle",
            )}
          </DialogTitle>
          <DialogDescription>{t("adminEventRegistration.packages.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <AdminFormSection
            title={t("adminEventRegistration.packages.editor.identitySection")}
            columns={2}
          >
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.key")}
              hint={t("adminEventRegistration.packages.editor.keyHint")}
              value={draft.key}
              onValueChange={(value) => set("key", value)}
              disabled={!isNew}
              monospace
              maxLength={49}
              error={errorFor("key")}
            />
            <AdminFormEnumRow
              label={t("adminEventRegistration.packages.editor.audience")}
              value={draft.audience}
              options={PACKAGE_AUDIENCES}
              labelFor={(option: PackageAudience) =>
                t(`adminEventRegistration.packages.audiences.${option}`)
              }
              onValueChange={(value) => set("audience", value)}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.namePl")}
              value={draft.namePl}
              onValueChange={(value) => set("namePl", value)}
              maxLength={200}
              error={errorFor("namePl")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.nameEn")}
              value={draft.nameEn}
              onValueChange={(value) => set("nameEn", value)}
              maxLength={200}
              error={errorFor("nameEn")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.descriptionPl")}
              value={draft.descriptionPl}
              onValueChange={(value) => set("descriptionPl", value)}
              rows={2}
              maxLength={1000}
              error={errorFor("descriptionPl")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.descriptionEn")}
              value={draft.descriptionEn}
              onValueChange={(value) => set("descriptionEn", value)}
              rows={2}
              maxLength={1000}
              error={errorFor("descriptionEn")}
            />
          </AdminFormSection>

          <AdminFormSection
            title={t("adminEventRegistration.packages.editor.offerSection")}
            columns={2}
          >
            <div className="space-y-1.5">
              <Label htmlFor="event-package-ticket">
                {t("adminEventRegistration.packages.editor.ticketTypeId")}
              </Label>
              <FormSelect
                id="event-package-ticket"
                value={draft.ticketTypeId}
                placeholder={t("adminEventRegistration.packages.editor.ticketHint")}
                options={tickets.map((row) => ({ value: row.id, label: ticketLabel(row) }))}
                onValueChange={(value) => set("ticketTypeId", value)}
              />
              <p className="text-xs leading-snug text-muted-foreground">
                {t("adminEventRegistration.packages.editor.ticketHint")}
              </p>
              {errorFor("ticketTypeId") === null ? null : (
                <p className="text-xs text-destructive">{errorFor("ticketTypeId")}</p>
              )}
            </div>
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.seats")}
              hint={t("adminEventRegistration.packages.editor.seatsHint")}
              value={draft.seats}
              onValueChange={(value) => set("seats", value)}
              inputMode="numeric"
              error={errorFor("seats")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.priceCents")}
              value={draft.priceCents}
              onValueChange={(value) => set("priceCents", value)}
              inputMode="numeric"
              error={errorFor("priceCents")}
            />
            <AdminFormEnumRow
              label={t("adminEventRegistration.packages.editor.currency")}
              value={draft.currency}
              options={TICKET_CURRENCIES}
              labelFor={(option: TicketCurrency) => option}
              onValueChange={(value) => set("currency", value)}
            />
          </AdminFormSection>

          <AdminFormSection
            title={t("adminEventRegistration.packages.editor.rulesSection")}
            columns={2}
          >
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.quota")}
              hint={t("adminEventRegistration.packages.editor.quotaHint")}
              value={draft.quota}
              onValueChange={(value) => set("quota", value)}
              inputMode="numeric"
              error={errorFor("quota")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.minTierRank")}
              value={draft.minTierRank}
              onValueChange={(value) => set("minTierRank", value)}
              inputMode="numeric"
              error={errorFor("minTierRank")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.salesFrom")}
              value={draft.salesFrom}
              onValueChange={(value) => set("salesFrom", value)}
              type="datetime-local"
              error={errorFor("salesFrom")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.salesTo")}
              value={draft.salesTo}
              onValueChange={(value) => set("salesTo", value)}
              type="datetime-local"
              error={errorFor("salesTo")}
            />
            <AdminFormTextRow
              label={t("adminEventRegistration.packages.editor.sortOrder")}
              value={draft.sortOrder}
              onValueChange={(value) => set("sortOrder", value)}
              inputMode="numeric"
              error={errorFor("sortOrder")}
            />
            <div className="space-y-3">
              <AdminFormSwitchRow
                label={t("adminEventRegistration.packages.editor.requiresVerification")}
                checked={draft.requiresVerification}
                onCheckedChange={(checked) => set("requiresVerification", checked)}
              />
              <AdminFormSwitchRow
                label={t("adminEventRegistration.packages.editor.active")}
                checked={draft.isActive}
                onCheckedChange={(checked) => set("isActive", checked)}
              />
            </div>
          </AdminFormSection>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("adminEventRegistration.packages.editor.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t("adminEventRegistration.packages.editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Molekuła: formularz jednego PAKIETU GRUPOWEGO.
//
// KLUCZ ZAMRAŻAMY PO ZAPISIE - tak samo jak w bilecie: zamówienia wskazują
// pakiet identyfikatorem, ale importy i faktury posługują się kluczem.
//
// BILET WYBIERAMY Z LISTY BILETÓW TEGO WYDARZENIA, a nie wpisujemy z ręki:
// miejsce z pakietu zamienia się w zwykłe zgłoszenie na wskazanym bilecie, więc
// literówka w identyfikatorze dawałaby pakiet, którego nie da się zrealizować.
//
// OKNO SPRZEDAŻY JEST ZEGAREM W STREFIE WYDARZENIA (klasa OPS-15), jak terminy
// biletu - strefa przychodzi od rodzica, a pod polem stoi jej nazwa albo zdanie
// o luce/zakładce zmiany czasu.
//
// CENA W ZŁOTYCH, NIE W GROSZACH (TIX-14a) - z podglądem kwoty obok pola
// (wspólny atom `MoneyInputPreview`, ten sam co w oknie biletu).
//
// WARUNKI ZAKUPU I PODATEK (TIX-07, TIX-09) pokazujemy tylko wtedy, gdy panel
// je ZNA (`PackageTermsLookup`). W każdym innym stanie w miejscu sekcji stoi
// zdanie, a zapis nie niesie kluczy warunków - chwilowa awaria odczytu nie może
// nadpisać prawdziwego terminu płatności wartością domyślną.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { eventLocalInputHint } from "@/lib/events/eventLocalInput";
import { eventTimeZone } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
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
import { MoneyInputPreview } from "@/components/admin/events/atoms/MoneyInputPreview";
import { moneyDecimalSeparator } from "@/lib/billing/moneyInput";
import { TaxProfileFields } from "@/components/admin/events/molecules/TaxProfileFields";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Label } from "@/components/ui/label";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { TICKET_CURRENCIES, type TicketCurrency } from "@/lib/events/ticketDraft";
import {
  emptyPackageDraft,
  packageDraftFromRow,
  packageDraftIssue,
  packageDraftIssueMessage,
  packageDraftToInput,
  packageTermsForDraft,
  type PackageDraft,
  type PackageDraftField,
  type PackageTermsDraft,
  type PackageTermsLookup,
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
  /** Strefa wydarzenia (`events.timezone`); pola okna sprzedaży są zegarem w niej. */
  timezone: string | null;
  /** Warunki zakupu i profil podatkowy pakietów wydarzenia (`usePackageTerms`). */
  packageTerms: PackageTermsLookup;
}

const E = "adminEventRegistration.packages.editor";

export function EventPackageDialog({
  open,
  onOpenChange,
  eventId,
  eventPackage,
  tickets,
  nextSortOrder,
  isSaving,
  onSubmit,
  timezone,
  packageTerms,
}: EventPackageDialogProps) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const zone = eventTimeZone({ timezone });
  // Kwota z bazy wraca do pola z separatorem języka interfejsu; parser i tak
  // przyjmuje oba, więc przełączenie języka nie zmienia zapisanej kwoty.
  const decimalSeparator = moneyDecimalSeparator(i18n.language);
  const decimalSeparatorRef = useRef(decimalSeparator);
  decimalSeparatorRef.current = decimalSeparator;
  const [draft, setDraft] = useState<PackageDraft>(() => emptyPackageDraft(nextSortOrder, zone));
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
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const termsRef = useRef(packageTerms);
  termsRef.current = packageTerms;
  const packageId = eventPackage === null ? null : eventPackage.id;

  useEffect(() => {
    if (!open) return;
    const row = packageRef.current;
    const terms = packageTermsForDraft(row === null ? null : row.id, termsRef.current);
    setDraft(
      row === null
        ? emptyPackageDraft(nextSortOrderRef.current, zoneRef.current, terms)
        : packageDraftFromRow(row, zoneRef.current, terms, decimalSeparatorRef.current),
    );
    setTouched(false);
  }, [open, packageId]);

  // WARUNKI, KTÓRE DOJECHAŁY PO OTWARCIU, UZUPEŁNIAJĄ SZKIC - i tylko wtedy,
  // gdy szkic ich jeszcze nie ma. Zależnością jest FLAGA „warunki znane", nie
  // mapa: odświeżenie listy warunków w tle podaje nową mapę przy otwartym
  // dialogu i nie może skasować tego, co organizator już zmienił. Pozostałe
  // pola szkicu zostają nietknięte, bo sekcji warunków do tej chwili nie było.
  const termsKnown = packageTermsForDraft(packageId, packageTerms) !== null;
  useEffect(() => {
    if (!open || !termsKnown) return;
    setDraft((previous) =>
      previous.terms !== null
        ? previous
        : { ...previous, terms: packageTermsForDraft(previous.id, termsRef.current) },
    );
  }, [open, termsKnown]);

  const issue = packageDraftIssue(draft);
  const errorFor = (field: PackageDraftField): string | null => {
    if (!touched || issue === null || issue.field !== field) return null;
    const message = packageDraftIssueMessage(issue);
    return message.params === undefined ? t(message.key) : t(message.key, message.params);
  };

  const set = <K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const timeHint = (field: "salesFrom" | "salesTo"): string | undefined =>
    eventLocalInputHint(t, lang, draft[field], draft.timeZone, draft.savedTimes[field] ?? null);

  const setTerms = (patch: Partial<PackageTermsDraft>) =>
    setDraft((previous) =>
      previous.terms === null ? previous : { ...previous, terms: { ...previous.terms, ...patch } },
    );

  const submit = () => {
    setTouched(true);
    if (issue !== null) return;
    onSubmit(packageDraftToInput(draft, eventId));
  };

  const isNew = draft.id === null;
  const ticketLabel = (row: EventTicketRow) =>
    i18n.language.startsWith("pl") ? row.name_pl : row.name_en;

  // Zdanie w miejscu sekcji warunków, gdy formularz ich nie zna.
  const termsNote = (): string => {
    switch (packageTerms.status) {
      case "loading":
        return t(`${E}.termsLoading`);
      case "unavailable":
        return t(`${E}.termsUnavailable`);
      case "failed":
        return t(`${E}.termsLoadFailed`, {
          reason: adminRegistrationErrorMessage(packageTerms.error),
        });
      case "ready":
        return t(`${E}.termsMissing`);
    }
  };

  const terms = draft.terms;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(isNew ? `${E}.createTitle` : `${E}.editTitle`)}</DialogTitle>
          <DialogDescription>{t("adminEventRegistration.packages.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <AdminFormSection title={t(`${E}.identitySection`)} columns={2}>
            <AdminFormTextRow
              label={t(`${E}.key`)}
              hint={t(`${E}.keyHint`)}
              value={draft.key}
              onValueChange={(value) => set("key", value)}
              disabled={!isNew}
              monospace
              maxLength={49}
              error={errorFor("key")}
            />
            <AdminFormEnumRow
              label={t(`${E}.audience`)}
              value={draft.audience}
              options={PACKAGE_AUDIENCES}
              labelFor={(option: PackageAudience) =>
                t(`adminEventRegistration.packages.audiences.${option}`)
              }
              onValueChange={(value) => set("audience", value)}
            />
            <AdminFormTextRow
              label={t(`${E}.namePl`)}
              value={draft.namePl}
              onValueChange={(value) => set("namePl", value)}
              maxLength={200}
              error={errorFor("namePl")}
            />
            <AdminFormTextRow
              label={t(`${E}.nameEn`)}
              value={draft.nameEn}
              onValueChange={(value) => set("nameEn", value)}
              maxLength={200}
              error={errorFor("nameEn")}
            />
            <AdminFormTextRow
              label={t(`${E}.descriptionPl`)}
              value={draft.descriptionPl}
              onValueChange={(value) => set("descriptionPl", value)}
              rows={2}
              maxLength={1000}
              error={errorFor("descriptionPl")}
            />
            <AdminFormTextRow
              label={t(`${E}.descriptionEn`)}
              value={draft.descriptionEn}
              onValueChange={(value) => set("descriptionEn", value)}
              rows={2}
              maxLength={1000}
              error={errorFor("descriptionEn")}
            />
          </AdminFormSection>

          <AdminFormSection title={t(`${E}.offerSection`)} columns={2}>
            <div className="space-y-1.5">
              <Label htmlFor="event-package-ticket">{t(`${E}.ticketTypeId`)}</Label>
              <FormSelect
                id="event-package-ticket"
                value={draft.ticketTypeId}
                placeholder={t(`${E}.ticketHint`)}
                options={tickets.map((row) => ({ value: row.id, label: ticketLabel(row) }))}
                onValueChange={(value) => set("ticketTypeId", value)}
              />
              <p className="text-xs leading-snug text-muted-foreground">{t(`${E}.ticketHint`)}</p>
              {errorFor("ticketTypeId") === null ? null : (
                <p className="text-xs text-destructive">{errorFor("ticketTypeId")}</p>
              )}
            </div>
            <AdminFormTextRow
              label={t(`${E}.seats`)}
              hint={t(`${E}.seatsHint`)}
              value={draft.seats}
              onValueChange={(value) => set("seats", value)}
              inputMode="numeric"
              error={errorFor("seats")}
            />
            <AdminFormTextRow
              label={t(`${E}.price`)}
              hint={t(`${E}.priceHint`)}
              value={draft.price}
              onValueChange={(value) => set("price", value)}
              inputMode="decimal"
              error={errorFor("price")}
              endAdornment={<MoneyInputPreview value={draft.price} currency={draft.currency} />}
            />
            <AdminFormEnumRow
              label={t(`${E}.currency`)}
              value={draft.currency}
              options={TICKET_CURRENCIES}
              labelFor={(option: TicketCurrency) => option}
              onValueChange={(value) => set("currency", value)}
            />
          </AdminFormSection>

          <AdminFormSection title={t(`${E}.rulesSection`)} columns={2}>
            <AdminFormTextRow
              label={t(`${E}.quota`)}
              hint={t(`${E}.quotaHint`)}
              value={draft.quota}
              onValueChange={(value) => set("quota", value)}
              inputMode="numeric"
              error={errorFor("quota")}
            />
            <AdminFormTextRow
              label={t(`${E}.minTierRank`)}
              value={draft.minTierRank}
              onValueChange={(value) => set("minTierRank", value)}
              inputMode="numeric"
              error={errorFor("minTierRank")}
            />
            <AdminFormTextRow
              label={t(`${E}.salesFrom`)}
              value={draft.salesFrom}
              onValueChange={(value) => set("salesFrom", value)}
              type="datetime-local"
              hint={timeHint("salesFrom")}
              error={errorFor("salesFrom")}
            />
            <AdminFormTextRow
              label={t(`${E}.salesTo`)}
              value={draft.salesTo}
              onValueChange={(value) => set("salesTo", value)}
              type="datetime-local"
              hint={timeHint("salesTo")}
              error={errorFor("salesTo")}
            />
            <AdminFormTextRow
              label={t(`${E}.sortOrder`)}
              value={draft.sortOrder}
              onValueChange={(value) => set("sortOrder", value)}
              inputMode="numeric"
              error={errorFor("sortOrder")}
            />
            <div className="space-y-3">
              <AdminFormSwitchRow
                label={t(`${E}.requiresVerification`)}
                checked={draft.requiresVerification}
                onCheckedChange={(checked) => set("requiresVerification", checked)}
              />
              <AdminFormSwitchRow
                label={t(`${E}.active`)}
                checked={draft.isActive}
                onCheckedChange={(checked) => set("isActive", checked)}
              />
            </div>
          </AdminFormSection>

          {terms === null ? (
            <AdminFormSection title={t(`${E}.termsSection`)} columns={1}>
              <p className="text-sm text-muted-foreground" role="note">
                {termsNote()}
              </p>
            </AdminFormSection>
          ) : (
            <>
              <AdminFormSection title={t(`${E}.termsSection`)} columns={2}>
                <AdminFormSwitchRow
                  className="sm:col-span-2"
                  label={t(`${E}.admitBeforePayment`)}
                  hint={t(`${E}.admitBeforePaymentHint`)}
                  checked={terms.admitBeforePayment}
                  onCheckedChange={(checked) => setTerms({ admitBeforePayment: checked })}
                />
                <AdminFormTextRow
                  label={t(`${E}.paymentTermsDays`)}
                  hint={t(`${E}.paymentTermsDaysHint`)}
                  value={terms.paymentTermsDays}
                  onValueChange={(value) => setTerms({ paymentTermsDays: value })}
                  inputMode="numeric"
                  error={errorFor("paymentTermsDays")}
                />
                <AdminFormTextRow
                  label={t(`${E}.maxOpenOrders`)}
                  hint={t(`${E}.maxOpenOrdersHint`)}
                  placeholder={t("adminEventRegistration.packages.unlimitedQuota")}
                  value={terms.maxOpenOrdersPerBuyer}
                  onValueChange={(value) => setTerms({ maxOpenOrdersPerBuyer: value })}
                  inputMode="numeric"
                  error={errorFor("maxOpenOrdersPerBuyer")}
                />
              </AdminFormSection>
              <TaxProfileFields
                value={terms.taxProfile}
                onChange={(taxProfile) => setTerms({ taxProfile })}
                inherit="ticket"
                showErrors={touched}
              />
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t(`${E}.cancel`)}
          </Button>
          <Button onClick={submit} disabled={isSaving}>
            {t(`${E}.save`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

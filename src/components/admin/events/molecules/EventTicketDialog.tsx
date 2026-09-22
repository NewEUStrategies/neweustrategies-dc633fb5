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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormSelect } from "@/components/atoms/FormSelect";
import { EventTicketPreview } from "@/components/admin/events/atoms/EventTicketPreview";
import { EventTicketChoice } from "@/components/admin/events/atoms/EventTicketChoice";
import { useEventGroups } from "@/lib/events/useEventTermsGroups";
import {
  DEFAULT_TICKET_PRESENTATION,
  TICKET_PRICE_LABEL_MAX,
  ticketRegistrationUrl,
  type TicketPresentation,
} from "@/lib/events/ticketPresentation";
import { toast } from "sonner";
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
import { formatMoney } from "@/lib/billing/types";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";

const NO_GROUP = "__none";

interface EventTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy bilet. */
  ticket: EventTicketRow | null;
  /** Domyślna kolejność dla nowego biletu - koniec listy. */
  nextSortOrder: number;
  isSaving: boolean;
  onSubmit: (input: EventTicketInput, presentation: TicketPresentation) => void;
  /** Slug wydarzenia - buduje bezpośredni link rejestracyjny biletu. */
  eventSlug?: string;
  /** Zapisana prezentacja edytowanego biletu (widoczność, etykieta, zapis grupowy). */
  presentation?: TicketPresentation;
  /** Duplikacja z poziomu edycji (jak w szufladzie biletu). */
  onDuplicate?: () => void;
}

export function EventTicketDialog({
  open,
  onOpenChange,
  eventId,
  ticket,
  nextSortOrder,
  isSaving,
  onSubmit,
  eventSlug,
  presentation,
  onDuplicate,
}: EventTicketDialogProps) {
  const { t, i18n } = useTranslation();
  const uiLang: "pl" | "en" = i18n.language.startsWith("en") ? "en" : "pl";
  const [draft, setDraft] = useState<TicketDraft>(() => emptyTicketDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);
  const [look, setLook] = useState<TicketPresentation>(DEFAULT_TICKET_PRESENTATION);
  const [contentLang, setContentLang] = useState<"pl" | "en">("pl");
  const [paid, setPaid] = useState(false);
  const groupsQ = useEventGroups(eventId, open);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

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
    const next =
      row === null ? emptyTicketDraft(nextSortOrderRef.current) : ticketDraftFromRow(row);
    setDraft(next);
    setPaid(next.priceCents.trim() !== "" && next.priceCents.trim() !== "0");
    setLook(presentationRef.current ?? DEFAULT_TICKET_PRESENTATION);
    setContentLang("pl");
    setTouched(false);
  }, [open, ticketId]);

  const issue = ticketDraftIssue(draft);
  const errorFor = (field: TicketDraftField): string | null =>
    touched && issue?.field === field ? t(`adminEventRegistration.errors.${issue.errorKey}`) : null;

  const set = <K extends keyof TicketDraft>(key: K, value: TicketDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (issue !== null) {
      // Błąd w polu drugiego języka przełącza zakładkę - inaczej komunikat
      // stałby w niewidocznej karcie, a przycisk „nic by nie robił".
      if (issue.field.endsWith("Pl")) setContentLang("pl");
      if (issue.field.endsWith("En")) setContentLang("en");
      return;
    }
    onSubmit(ticketDraftToInput(draft, eventId), look);
  };

  const isNew = draft.id === null;
  const setLookField = <K extends keyof TicketPresentation>(key: K, value: TicketPresentation[K]) =>
    setLook((previous) => ({ ...previous, [key]: value }));
  const choosePaid = (next: boolean) => {
    setPaid(next);
    if (!next) {
      set("priceCents", "0");
      set("earlyBirdPriceCents", "");
      set("phases", []);
    }
  };
  const registrationUrl =
    !isNew && eventSlug !== undefined && eventSlug !== ""
      ? ticketRegistrationUrl(eventSlug, draft.key)
      : null;
  const copy = (value: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("adminEventRegistration.tickets.studio.copied")))
      .catch(() => toast.error(t("adminEventRegistration.tickets.studio.copyFailed")));
  };
  const langFields = (lang: "pl" | "en") => {
    const suffix = lang === "pl" ? "Pl" : "En";
    const nameKey = lang === "pl" ? "namePl" : "nameEn";
    const descKey = lang === "pl" ? "descriptionPl" : "descriptionEn";
    const benKey = lang === "pl" ? "benefitsPl" : "benefitsEn";
    const labelKey = lang === "pl" ? "priceLabelPl" : "priceLabelEn";
    return (
      <div className="grid gap-4">
        <AdminFormTextRow
          label={t(`adminEventRegistration.tickets.editor.name${suffix}`)}
          value={draft[nameKey]}
          onValueChange={(value) => set(nameKey, value)}
          maxLength={TICKET_MAX_NAME}
          error={errorFor(nameKey)}
        />
        <AdminFormTextRow
          label={t(`adminEventRegistration.tickets.editor.description${suffix}`)}
          value={draft[descKey]}
          onValueChange={(value) => set(descKey, value)}
          rows={3}
          maxLength={TICKET_MAX_DESCRIPTION}
          error={errorFor(descKey)}
        />
        <AdminFormTextRow
          label={t(`adminEventRegistration.tickets.editor.benefits${suffix}`)}
          hint={t("adminEventRegistration.tickets.editor.benefitsHint", {
            max: TICKET_MAX_BENEFITS,
          })}
          value={draft[benKey]}
          onValueChange={(value) => set(benKey, value)}
          rows={4}
          error={errorFor(benKey)}
        />
        {look.showPriceLabel ? (
          <AdminFormTextRow
            label={`${t("adminEventRegistration.tickets.studio.label")} (${t(
              `adminEventRegistration.tickets.studio.tab${suffix}`,
            )})`}
            hint={t("adminEventRegistration.tickets.studio.charCount", {
              count: look[labelKey].length,
              max: TICKET_PRICE_LABEL_MAX,
            })}
            value={look[labelKey]}
            onValueChange={(value) => setLookField(labelKey, value)}
            maxLength={TICKET_PRICE_LABEL_MAX}
          />
        ) : null}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="event-dialog-compact max-h-[92vh] max-w-5xl overflow-y-auto">
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

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-6">
            <AdminFormSection
              title={t("adminEventRegistration.tickets.studio.content")}
              hint={t("adminEventRegistration.tickets.studio.contentHint")}
              columns={1}
            >
              <Tabs
                value={contentLang}
                onValueChange={(value) => setContentLang(value === "en" ? "en" : "pl")}
              >
                <TabsList aria-label={t("adminEventRegistration.tickets.studio.langTabs")}>
                  <TabsTrigger value="pl">
                    {t("adminEventRegistration.tickets.studio.tabPl")}
                  </TabsTrigger>
                  <TabsTrigger value="en">
                    {t("adminEventRegistration.tickets.studio.tabEn")}
                  </TabsTrigger>
                </TabsList>
                {/* forceMount: pola drugiego języka zostają w formularzu (walidacja,
                  czytniki ekranu, testy) - karta jest tylko ukryta wizualnie. */}
                <TabsContent value="pl" forceMount className="mt-4 data-[state=inactive]:hidden">
                  {langFields("pl")}
                </TabsContent>
                <TabsContent value="en" forceMount className="mt-4 data-[state=inactive]:hidden">
                  {langFields("en")}
                </TabsContent>
              </Tabs>
            </AdminFormSection>

            <AdminFormSection
              title={t("adminEventRegistration.tickets.studio.basics")}
              hint={t("adminEventRegistration.tickets.studio.basicsHint")}
              columns={2}
            >
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

            <AdminFormSection
              title={t("adminEventRegistration.tickets.studio.visibility")}
              hint={t("adminEventRegistration.tickets.studio.hiddenHint")}
              columns={2}
            >
              <EventTicketChoice
                name="ticket-visibility"
                selected={!look.isHidden}
                label={t("adminEventRegistration.tickets.studio.visible")}
                onSelect={() => setLookField("isHidden", false)}
              />
              <EventTicketChoice
                name="ticket-visibility"
                selected={look.isHidden}
                label={t("adminEventRegistration.tickets.studio.hidden")}
                onSelect={() => setLookField("isHidden", true)}
              />
            </AdminFormSection>

            <AdminFormSection
              title={t("adminEventRegistration.tickets.studio.type")}
              hint={t("adminEventRegistration.tickets.studio.typeHint")}
              columns={2}
            >
              <EventTicketChoice
                name="ticket-type"
                selected={!paid}
                label={t("adminEventRegistration.tickets.studio.free")}
                onSelect={() => choosePaid(false)}
              />
              <EventTicketChoice
                name="ticket-type"
                selected={paid}
                label={t("adminEventRegistration.tickets.studio.paid")}
                onSelect={() => choosePaid(true)}
              />
              <div className="sm:col-span-2">
                <AdminFormSwitchRow
                  label={t("adminEventRegistration.tickets.studio.showLabel")}
                  hint={t("adminEventRegistration.tickets.studio.showLabelHint")}
                  checked={look.showPriceLabel}
                  onCheckedChange={(checked) => setLookField("showPriceLabel", checked)}
                />
              </div>
            </AdminFormSection>

            {/* Szczegóły płatności są zawsze widoczne: kwota > 0 sama przełącza
                bilet na „Płatny", a wybór „Bezpłatny" zeruje cenę i cennik. */}
            <AdminFormSection
              title={t("adminEventRegistration.tickets.studio.payment")}
              hint={t("adminEventRegistration.tickets.studio.paymentHint")}
              columns={2}
            >
              <AdminFormTextRow
                label={t("adminEventRegistration.tickets.editor.priceCents")}
                hint={t("adminEventRegistration.tickets.editor.priceHint")}
                value={draft.priceCents}
                onValueChange={(value) => {
                  set("priceCents", value);
                  const cents = Number(value.trim());
                  setPaid(value.trim() !== "" && Number.isFinite(cents) && cents !== 0);
                }}
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
            </AdminFormSection>
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

            <AdminFormSection
              title={t("adminEventRegistration.tickets.studio.other")}
              hint={t("adminEventRegistration.tickets.studio.otherHint")}
              columns={1}
            >
              <FormSelect
                value={draft.groupId ?? NO_GROUP}
                aria-label={t("adminEventRegistration.tickets.studio.columns.group")}
                options={[
                  {
                    value: NO_GROUP,
                    label: t("adminEventRegistration.tickets.studio.groupPlaceholder"),
                  },
                  ...(groupsQ.data ?? []).map((group) => ({
                    value: group.id,
                    label: (uiLang === "en" ? group.name_en : group.name_pl) || group.key,
                  })),
                ]}
                onValueChange={(value) => set("groupId", value === NO_GROUP ? null : value)}
              />
              <AdminFormSwitchRow
                label={t("adminEventRegistration.tickets.editor.requiresApproval")}
                hint={t("adminEventRegistration.tickets.studio.moderatedHint")}
                checked={draft.requiresApproval}
                onCheckedChange={(checked) => set("requiresApproval", checked)}
              />
              <AdminFormSwitchRow
                label={t("adminEventRegistration.tickets.studio.groupRegistration")}
                hint={t("adminEventRegistration.tickets.studio.groupRegistrationHint")}
                checked={look.groupRegistrationEnabled}
                onCheckedChange={(checked) => setLookField("groupRegistrationEnabled", checked)}
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
            <AdminFormSection title={t("adminEventRegistration.tickets.studio.access")} columns={2}>
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

          <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
            <EventTicketPreview
              name={(contentLang === "en" ? draft.nameEn : draft.namePl).trim()}
              description={contentLang === "en" ? draft.descriptionEn : draft.descriptionPl}
              priceLabel={
                !look.showPriceLabel
                  ? null
                  : (contentLang === "en" ? look.priceLabelEn : look.priceLabelPl).trim() ||
                    (paid && Number(draft.priceCents) > 0
                      ? formatMoney(Number(draft.priceCents), draft.currency, contentLang)
                      : t("adminEventRegistration.tickets.studio.free"))
              }
              salesTo={draft.salesTo}
              lang={contentLang}
            />
            {registrationUrl !== null ? (
              <div className="space-y-3 rounded-[6px] border border-border bg-card p-3 text-sm">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {t("adminEventRegistration.tickets.studio.registrationUrl")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("adminEventRegistration.tickets.studio.registrationUrlHint")}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">{registrationUrl}</code>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => copy(registrationUrl)}
                    >
                      {t("adminEventRegistration.tickets.studio.copy")}
                    </Button>
                  </div>
                </div>
                {draft.id !== null ? (
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      {t("adminEventRegistration.tickets.studio.ticketId")}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-xs">{draft.id}</code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => copy(draft.id ?? "")}
                      >
                        {t("adminEventRegistration.tickets.studio.copy")}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {onDuplicate !== undefined ? (
                  <Button type="button" variant="outline" className="w-full" onClick={onDuplicate}>
                    {t("adminEventRegistration.tickets.studio.duplicate")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </aside>
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

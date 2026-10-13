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
//
// CENY W ZŁOTYCH, NIE W GROSZACH (TIX-14a). Każde pole ceny (bazowa, promocyjna,
// progi) przyjmuje kwotę w jednostce głównej waluty i ma obok podgląd kwoty
// liczony tym samym parserem, którym szkic liczy grosze.
//
// PROFIL PODATKOWY (TIX-09) PRZYCHODZI OD RODZICA jako stan zapytania i wraca
// TRZECIM argumentem `onSubmit` - wyłącznie wtedy, gdy redaktor go zmienił.
// Szkic profilu startuje od wartości zapisanej dopiero, gdy ta się wczyta;
// odświeżenie listy w tle nie nadpisuje już wpisanych zmian.
import { clampGroupSize } from "@/lib/events/ticketTaxGroup";
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
import { TaxProfileFields } from "@/components/admin/events/molecules/TaxProfileFields";
import { MoneyInputPreview } from "@/components/admin/events/atoms/MoneyInputPreview";
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
  ticketDraftIssueMessage,
  ticketDraftToInput,
  type TicketCurrency,
  type TicketDraft,
  type TicketDraftField,
} from "@/lib/events/ticketDraft";
import { moneyDecimalSeparator, parseMoneyInput } from "@/lib/billing/moneyInput";
import { formatMoney } from "@/lib/billing/types";
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";
import {
  EMPTY_TAX_PROFILE,
  taxProfileIssues,
  type TaxProfileDraft,
} from "@/lib/events/taxProfileDraft";
import {
  ticketTaxProfileChanged,
  type TicketTaxProfileState,
} from "@/lib/events/ticketTaxProfileApi";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";

const NO_GROUP = "__none";

/**
 * Pola jednej wersji językowej biletu. To wybór KOLUMNY, nie tekst dla
 * użytkownika - jedna mapa zamiast pięciu ternary po `lang`, więc etykiety
 * zostają w słowniku, a nazwy pól w jednym miejscu.
 */
const LANG_FIELDS = {
  pl: {
    suffix: "Pl",
    name: "namePl",
    description: "descriptionPl",
    benefits: "benefitsPl",
    priceLabel: "priceLabelPl",
  },
  en: {
    suffix: "En",
    name: "nameEn",
    description: "descriptionEn",
    benefits: "benefitsEn",
    priceLabel: "priceLabelEn",
  },
} as const;

interface EventTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  /** `null` = nowy bilet. */
  ticket: EventTicketRow | null;
  /** Domyślna kolejność dla nowego biletu - koniec listy. */
  nextSortOrder: number;
  isSaving: boolean;
  /**
   * `taxProfile` = profil do zapisu osobnym RPC po upsercie biletu albo `null`,
   * gdy nie ma czego zapisywać (bez zmian, baza bez migracji, profil się nie
   * wczytał).
   */
  onSubmit: (
    input: EventTicketInput,
    presentation: TicketPresentation,
    taxProfile: TaxProfileDraft | null,
  ) => void;
  /**
   * Profil podatkowy edytowanego biletu (TIX-09). Dla nowego biletu `ready`
   * niesie `EMPTY_TAX_PROFILE` - tyle zapisze baza bez drugiego RPC.
   */
  taxProfile: TicketTaxProfileState;
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
  taxProfile,
  eventSlug,
  presentation,
  onDuplicate,
}: EventTicketDialogProps) {
  ensureRegistrationI18n();
  const { t, i18n } = useTranslation();
  const uiLang: "pl" | "en" = i18n.language.startsWith("en") ? "en" : "pl";
  // Kwota z bazy wraca do pola z separatorem języka interfejsu; parser i tak
  // przyjmuje oba, więc przełączenie języka nie zmienia zapisanej kwoty.
  const decimalSeparator = moneyDecimalSeparator(uiLang);
  const decimalSeparatorRef = useRef(decimalSeparator);
  decimalSeparatorRef.current = decimalSeparator;
  const [draft, setDraft] = useState<TicketDraft>(() => emptyTicketDraft(nextSortOrder));
  const [touched, setTouched] = useState(false);
  const [look, setLook] = useState<TicketPresentation>(DEFAULT_TICKET_PRESENTATION);
  const [contentLang, setContentLang] = useState<"pl" | "en">("pl");
  const [paid, setPaid] = useState(false);
  const groupsQ = useEventGroups(eventId, open);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  // Profil podatkowy: `taxSaved` = wartość zapisana, od której liczymy zmianę;
  // `null` = jeszcze nie wiemy (wczytywanie, migracja, awaria) i NIE zapisujemy.
  const [taxSaved, setTaxSaved] = useState<TaxProfileDraft | null>(null);
  const [taxDraft, setTaxDraft] = useState<TaxProfileDraft>(EMPTY_TAX_PROFILE);
  const taxReady = taxProfile.status === "ready" ? taxProfile.value : null;

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
      row === null
        ? emptyTicketDraft(nextSortOrderRef.current)
        : ticketDraftFromRow(row, decimalSeparatorRef.current);
    setDraft(next);
    setPaid((parseMoneyInput(next.price) ?? 0) > 0);
    setLook(presentationRef.current ?? DEFAULT_TICKET_PRESENTATION);
    setContentLang("pl");
    setTouched(false);
    setTaxSaved(null);
    setTaxDraft(EMPTY_TAX_PROFILE);
  }, [open, ticketId]);

  // Profil wczytany PO otwarciu (albo od razu) staje się punktem odniesienia
  // RAZ na otwarcie - kolejna odpowiedź zapytania (odświeżenie w tle) trafia
  // tu z `taxSaved !== null` i nie rusza tego, co redaktor już wpisał.
  useEffect(() => {
    if (!open || taxSaved !== null || taxReady === null) return;
    setTaxSaved(taxReady);
    setTaxDraft(taxReady);
  }, [open, taxSaved, taxReady]);

  const issue = ticketDraftIssue(draft);
  const taxInvalid = taxSaved !== null && Object.keys(taxProfileIssues(taxDraft)).length > 0;
  const errorFor = (field: TicketDraftField): string | null => {
    if (!touched || issue?.field !== field) return null;
    const message = ticketDraftIssueMessage(issue);
    return message.params === undefined ? t(message.key) : t(message.key, message.params);
  };

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
    // Zły kod podatkowy albo za długa podstawa zatrzymują CAŁY zapis: bilet
    // zapisany bez profilu, o który redaktor prosił, rozjechałby fakturę z kasą.
    if (taxInvalid) return;
    const taxToSave =
      taxSaved !== null && ticketTaxProfileChanged(taxSaved, taxDraft) ? taxDraft : null;
    onSubmit(ticketDraftToInput(draft, eventId), look, taxToSave);
  };

  const isNew = draft.id === null;
  const setLookField = <K extends keyof TicketPresentation>(key: K, value: TicketPresentation[K]) =>
    setLook((previous) => ({ ...previous, [key]: value }));
  const choosePaid = (next: boolean) => {
    setPaid(next);
    if (!next) {
      set("price", "0");
      set("earlyBirdPrice", "");
      set("phases", []);
    }
  };
  const priceCents = parseMoneyInput(draft.price);
  const isPaidPrice = paid && priceCents !== null && priceCents > 0;
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
    const {
      suffix,
      name: nameKey,
      description: descKey,
      benefits: benKey,
      priceLabel: labelKey,
    } = LANG_FIELDS[lang];
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
              {/* REG-05: bilet ukryty BEZ kodu dostępu baza oddaje wyłącznie po
                  kodzie odsłaniającym - sam link z kluczem już nie wystarcza.
                  Kod liczymy tak, jak zapisze go upsert: nowy kod albo stary,
                  którego organizator nie zdejmuje. */}
              {look.isHidden &&
                draft.accessCode.trim() === "" &&
                (!draft.hasAccessCode || draft.removeAccessCode) && (
                  <p role="note" className="text-xs text-muted-foreground sm:col-span-2">
                    {t("adminEventRegistration.tickets.studio.hiddenNeedsCodeHint")}
                  </p>
                )}
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
                value={draft.price}
                onValueChange={(value) => {
                  set("price", value);
                  // Typ biletu idzie za kwotą, którą DA SIĘ przeczytać. Zapis
                  // w połowie („15,") nie przełącza go tam i z powrotem przy
                  // każdej literze; puste pole to bilet bez ceny.
                  const cents = parseMoneyInput(value);
                  if (cents !== null) setPaid(cents > 0);
                  else if (value.trim() === "") setPaid(false);
                }}
                inputMode="decimal"
                error={errorFor("price")}
                endAdornment={<MoneyInputPreview value={draft.price} currency={draft.currency} />}
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
                value={draft.earlyBirdPrice}
                onValueChange={(value) => set("earlyBirdPrice", value)}
                inputMode="decimal"
                error={errorFor("earlyBirdPrice")}
                endAdornment={
                  <MoneyInputPreview value={draft.earlyBirdPrice} currency={draft.currency} />
                }
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
                currency={draft.currency}
              />
            </AdminFormSection>

            {taxProfile.status === "loading" || taxProfile.status === "ready" ? (
              <TaxProfileFields
                value={taxDraft}
                onChange={setTaxDraft}
                inherit="tenant"
                showErrors={touched}
                // Do wczytania wartości zapisanej pola są zgaszone: wpis na
                // pustym szkicu zostałby i tak nadpisany wartością z bazy.
                disabled={taxSaved === null}
              />
            ) : (
              <AdminFormSection title={t("adminEventRegistration.taxProfile.section")} columns={1}>
                <p className="text-sm text-muted-foreground" role="note">
                  {taxProfile.status === "unavailable"
                    ? t("adminEventRegistration.taxProfile.unavailable")
                    : t("adminEventRegistration.tickets.editor.taxProfileLoadFailed", {
                        reason: adminRegistrationErrorMessage(taxProfile.error),
                      })}
                </p>
              </AdminFormSection>
            )}

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
              {look.groupRegistrationEnabled && (
                <AdminFormTextRow
                  id="ticket-group-max-size"
                  label={t("adminEventRegistration.tickets.studio.groupMaxSize")}
                  hint={t("adminEventRegistration.tickets.studio.groupMaxSizeHint")}
                  type="number"
                  inputMode="numeric"
                  value={String(look.groupMaxSize)}
                  onValueChange={(value) =>
                    setLookField("groupMaxSize", clampGroupSize(Number(value)))
                  }
                />
              )}
              <FormSelect
                value={look.taxMode}
                aria-label={t("adminEventRegistration.tickets.studio.taxMode")}
                options={[
                  {
                    value: "inclusive",
                    label: t("adminEventRegistration.tickets.studio.taxInclusive"),
                  },
                  {
                    value: "exclusive",
                    label: t("adminEventRegistration.tickets.studio.taxExclusive"),
                  },
                ]}
                onValueChange={(value) =>
                  setLookField("taxMode", value === "exclusive" ? "exclusive" : "inclusive")
                }
              />
              <p className="text-xs text-muted-foreground">
                {t("adminEventRegistration.tickets.studio.taxHint")}
              </p>
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
                    (isPaidPrice && priceCents !== null
                      ? formatMoney(priceCents, draft.currency, contentLang)
                      : t("adminEventRegistration.tickets.studio.free"))
              }
              taxAdded={look.showPriceLabel && look.taxMode === "exclusive" && isPaidPrice}
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

// Molekuła: profil podatkowy biletu albo pakietu (TIX-09) - stawka VAT na
// fakturze, podstawa zwolnienia i kod podatkowy produktu Stripe.
//
// JEDNA MOLEKUŁA DLA OBU OKIEN. Okno biletu i okno pakietu pytają o te same
// trzy rzeczy z tymi samymi regułami (`taxProfileDraft.ts`); różni je tylko to,
// co znaczy „bez własnej stawki" - bilet bierze domyślną stawkę organizatora,
// pakiet stawkę swojego biletu (`inherit`).
//
// PODSTAWA ZWOLNIENIA POJAWIA SIĘ PRZY `zw` albo gdy już coś w niej jest -
// wtedy da się ją wyczyścić także po zmianie stawki. Pole NIE ma `maxLength`:
// wklejony przepis dłuższy niż 300 znaków nie jest po cichu ucinany, tylko
// dostaje zdanie, ile znaków trzeba usunąć (baza i tak odmówiłaby zapisu).
import { useTranslation } from "react-i18next";

import { AdminFormEnumRow } from "@/components/admin/molecules/AdminFormEnumRow";
import { AdminFormSection } from "@/components/admin/molecules/AdminFormSection";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import {
  exemptBasisLength,
  TAX_EXEMPT_BASIS_MAX,
  TAX_RATE_CHOICES,
  taxProfileIssues,
  type TaxProfileDraft,
  type TaxRateChoice,
} from "@/lib/events/taxProfileDraft";
import { ensureI18n as ensureRegistrationI18n } from "@/lib/i18n-admin-event-registration";

ensureRegistrationI18n();

export interface TaxProfileFieldsProps {
  value: TaxProfileDraft;
  onChange: (next: TaxProfileDraft) => void;
  /** Co znaczy „bez własnej stawki": stawka organizatora albo stawka biletu pakietu. */
  inherit: "tenant" | "ticket";
  /**
   * Czy pokazać błędy pól. Wołający włącza je po pierwszej próbie zapisu, tak
   * jak resztę walidacji okna - błąd nie świeci od pierwszej litery.
   */
  showErrors: boolean;
  disabled?: boolean;
}

export function TaxProfileFields({
  value,
  onChange,
  inherit,
  showErrors,
  disabled,
}: TaxProfileFieldsProps) {
  const { t } = useTranslation();
  const issues = showErrors ? taxProfileIssues(value) : {};
  const showBasis = value.vatRate === "zw" || value.vatExemptBasis.trim() !== "";

  const rateLabel = (option: TaxRateChoice): string =>
    option === "default"
      ? inherit === "tenant"
        ? t("adminEventRegistration.taxProfile.rateDefaultTenant")
        : t("adminEventRegistration.taxProfile.rateDefaultTicket")
      : t(`adminEventRegistration.taxProfile.rates.${option}`);

  return (
    <AdminFormSection title={t("adminEventRegistration.taxProfile.section")} columns={2}>
      <AdminFormEnumRow
        label={t("adminEventRegistration.taxProfile.vatRate")}
        hint={t("adminEventRegistration.taxProfile.vatRateHint")}
        value={value.vatRate}
        options={TAX_RATE_CHOICES}
        labelFor={rateLabel}
        onValueChange={(vatRate) => onChange({ ...value, vatRate })}
        disabled={disabled}
      />
      <AdminFormTextRow
        label={t("adminEventRegistration.taxProfile.stripeTaxCode")}
        hint={t("adminEventRegistration.taxProfile.stripeTaxCodeHint")}
        placeholder="txcd_10000000"
        value={value.stripeTaxCode}
        onValueChange={(stripeTaxCode) => onChange({ ...value, stripeTaxCode })}
        monospace
        disabled={disabled}
        error={
          issues.stripeTaxCode === true
            ? t("adminEventRegistration.taxProfile.stripeTaxCodeInvalid")
            : null
        }
      />
      {showBasis && (
        <AdminFormTextRow
          className="sm:col-span-2"
          label={t("adminEventRegistration.taxProfile.vatExemptBasis")}
          hint={t("adminEventRegistration.taxProfile.vatExemptBasisHint")}
          value={value.vatExemptBasis}
          onValueChange={(vatExemptBasis) => onChange({ ...value, vatExemptBasis })}
          rows={2}
          disabled={disabled}
          error={
            issues.vatExemptBasis === true
              ? t("adminEventRegistration.taxProfile.vatExemptBasisTooLong", {
                  length: exemptBasisLength(value),
                  max: TAX_EXEMPT_BASIS_MAX,
                })
              : null
          }
        />
      )}
    </AdminFormSection>
  );
}

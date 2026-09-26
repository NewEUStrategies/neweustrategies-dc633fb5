// Molekula: USTAWIENIA WYSTAWCY faktur wydarzen (wspolne dla najemcy).
//
// Zakladka ekranu faktur, ale dane NIE naleza do wydarzenia: sprzedawca,
// rachunek, prefiksy serii i domyslna stawka obowiazuja kazde wydarzenie
// organizatora - dlatego pierwsze zdanie ekranu mowi to wprost.
//
// ZAPIS JEST JAWNY (pasek "Zapisz" jak w calym studiu), a wlaczenie
// fakturowania po raz pierwszy wymaga zaznaczenia "Wystawiamy faktury jako
// sprzedawca biletow" - baza przyjmuje je tylko razem z kompletem danych
// sprzedawcy i zapamietuje, kto i kiedy potwierdzil.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { FormSelect } from "@/components/atoms/FormSelect";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { AdminFormSwitchRow } from "@/components/admin/molecules/AdminFormSwitchRow";
import { AdminFormTextRow } from "@/components/admin/molecules/AdminFormTextRow";
import { EventStudioRow, EventStudioSaveBar } from "@/components/admin/events/studio/EventStudioSection";
import { Label } from "@/components/ui/label";
import { adminEventInvoiceErrorMessage } from "@/lib/events/adminEventInvoiceErrors";
import type { EventInvoiceSettings } from "@/lib/events/eventInvoicesApi";
import { EVENT_INVOICE_LOCALES, pickEnum, type EventInvoiceLocale } from "@/lib/events/eventInvoiceEnums";
import { EVENT_INVOICE_VAT_RATES, type EventInvoiceVatRate } from "@/lib/events/eventInvoiceMath";
import {
  isSettingsDraftDirty,
  settingsDraftFromSettings,
  settingsDraftToInput,
  validateSettingsDraft,
  type InvoiceSettingsDraft,
  type InvoiceSettingsErrors,
  type InvoiceSettingsField,
} from "@/lib/events/eventInvoiceSettingsDraft";
import { useInvoiceSettings, useSaveInvoiceSettings } from "@/lib/events/useEventInvoices";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

export const VAT_RATE_LABEL_KEYS: Record<EventInvoiceVatRate, string> = {
  "23": "adminEventInvoices.vatRates.23",
  "8": "adminEventInvoices.vatRates.8",
  "5": "adminEventInvoices.vatRates.5",
  "0": "adminEventInvoices.vatRates.0",
  zw: "adminEventInvoices.vatRates.zw",
  np: "adminEventInvoices.vatRates.np",
};

export const LOCALE_LABEL_KEYS: Record<EventInvoiceLocale, string> = {
  pl: "adminEventInvoices.locales.pl",
  en: "adminEventInvoices.locales.en",
};

export function EventInvoiceSettingsForm() {
  ensureAdminEventInvoicesI18n();
  const { t } = useTranslation();
  const settingsQ = useInvoiceSettings();
  return (
    <AdminCatalogListState
      isLoading={settingsQ.isLoading}
      loadingLabel={t("adminEventInvoices.loading")}
      errorMessage={settingsQ.isError ? adminEventInvoiceErrorMessage(settingsQ.error) : null}
      isEmpty={false}
      emptyLabel=""
    >
      {settingsQ.data === undefined ? null : (
        // Bez `key` zaleznego od danych: przemontowanie w trakcie zapisu zgubiloby
        // wywolania zwrotne `mutate` (toast i reset formularza po zapisie).
        <SettingsEditor settings={settingsQ.data} />
      )}
    </AdminCatalogListState>
  );
}

function SettingsEditor({ settings }: { settings: EventInvoiceSettings }) {
  const { t } = useTranslation();
  const save = useSaveInvoiceSettings();
  const [initial, setInitial] = useState(() => settingsDraftFromSettings(settings));
  const [draft, setDraft] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const errors: InvoiceSettingsErrors = validateSettingsDraft(draft, settings.confirmedAt);
  const shown = showErrors ? errors : {};

  function set<K extends keyof InvoiceSettingsDraft>(field: K, value: InvoiceSettingsDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function error(field: InvoiceSettingsField): string | null {
    const key = shown[field];
    return key === undefined ? null : t(key);
  }

  function text(
    field: Exclude<InvoiceSettingsField, "enabled" | "confirmSeller" | "defaultVatRate" | "defaultLocale">,
    labelKey: string,
    extra: { hint?: string; rows?: number; maxLength: number },
  ) {
    return (
      <AdminFormTextRow
        label={t(labelKey)}
        value={draft[field]}
        onValueChange={(value) => set(field, value)}
        hint={extra.hint}
        rows={extra.rows}
        maxLength={extra.maxLength}
        error={error(field)}
      />
    );
  }

  function submit(): void {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    save.mutate(settingsDraftToInput(draft), {
      onSuccess: (next) => {
        const fresh = settingsDraftFromSettings(next);
        setInitial(fresh);
        setDraft(fresh);
        setShowErrors(false);
        toast.success(t("adminEventInvoices.toasts.settingsSaved"));
      },
      onError: (failure) => toast.error(adminEventInvoiceErrorMessage(failure)),
    });
  }

  return (
    <div className="space-y-10">
      <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
        {t("adminEventInvoices.settings.sharedNotice")}
      </p>
      <EventStudioRow
        label={t("adminEventInvoices.settings.sellerSection")}
        description={t("adminEventInvoices.settings.sellerSectionHint")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {text("sellerName", "adminEventInvoices.settings.sellerName", { maxLength: 200 })}
          {text("sellerTaxId", "adminEventInvoices.settings.sellerTaxId", { maxLength: 24 })}
          {text("sellerAddress", "adminEventInvoices.settings.sellerAddress", { maxLength: 200 })}
          {text("sellerPostalCode", "adminEventInvoices.settings.sellerPostalCode", { maxLength: 20 })}
          {text("sellerCity", "adminEventInvoices.settings.sellerCity", { maxLength: 100 })}
          {text("sellerCountry", "adminEventInvoices.settings.sellerCountry", { maxLength: 2 })}
          {text("sellerEmail", "adminEventInvoices.settings.sellerEmail", { maxLength: 254 })}
          {text("sellerPhone", "adminEventInvoices.settings.sellerPhone", { maxLength: 40 })}
          {text("sellerBankAccount", "adminEventInvoices.settings.bankAccount", { maxLength: 64 })}
          {text("sellerBankSwift", "adminEventInvoices.settings.bankSwift", { maxLength: 20 })}
        </div>
      </EventStudioRow>
      <EventStudioRow
        label={t("adminEventInvoices.settings.numberingSection")}
        description={t("adminEventInvoices.settings.numberingHint")}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {text("seriesInvoice", "adminEventInvoices.settings.seriesInvoice", { maxLength: 10 })}
          {text("seriesProforma", "adminEventInvoices.settings.seriesProforma", { maxLength: 10 })}
          {text("seriesCorrection", "adminEventInvoices.settings.seriesCorrection", { maxLength: 10 })}
        </div>
      </EventStudioRow>
      <EventStudioRow label={t("adminEventInvoices.settings.defaultsSection")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("paymentDays", "adminEventInvoices.settings.paymentDays", { maxLength: 3 })}
          <div className="space-y-1.5">
            <Label htmlFor="invoice-settings-vat">{t("adminEventInvoices.settings.defaultVatRate")}</Label>
            <FormSelect
              id="invoice-settings-vat"
              value={draft.defaultVatRate}
              onValueChange={(value) => set("defaultVatRate", pickEnum(EVENT_INVOICE_VAT_RATES, value))}
              options={EVENT_INVOICE_VAT_RATES.map((rate) => ({ value: rate, label: t(VAT_RATE_LABEL_KEYS[rate]) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-settings-locale">{t("adminEventInvoices.settings.defaultLocale")}</Label>
            <FormSelect
              id="invoice-settings-locale"
              value={draft.defaultLocale}
              onValueChange={(value) => set("defaultLocale", pickEnum(EVENT_INVOICE_LOCALES, value))}
              options={EVENT_INVOICE_LOCALES.map((locale) => ({ value: locale, label: t(LOCALE_LABEL_KEYS[locale]) }))}
            />
          </div>
          {text("vatExemptBasis", "adminEventInvoices.settings.vatExemptBasis", {
            hint: t("adminEventInvoices.settings.vatExemptBasisHint"),
            maxLength: 300,
          })}
          {text("footerNote", "adminEventInvoices.settings.footerNote", { rows: 2, maxLength: 500 })}
        </div>
      </EventStudioRow>
      <EventStudioRow label={t("adminEventInvoices.settings.enabledSection")}>
        <div className="space-y-3">
          <AdminFormSwitchRow
            label={t("adminEventInvoices.settings.enabled")}
            hint={t("adminEventInvoices.settings.enabledHint")}
            checked={draft.enabled}
            onCheckedChange={(checked) => set("enabled", checked)}
          />
          {settings.confirmedAt === null ? (
            <div className="space-y-1">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.confirmSeller}
                  onChange={(event) => set("confirmSeller", event.target.checked)}
                />
                <span>
                  <span className="font-medium">{t("adminEventInvoices.settings.confirmSeller")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("adminEventInvoices.settings.confirmSellerHint")}
                  </span>
                </span>
              </label>
              {error("confirmSeller") === null ? null : (
                <p className="text-xs text-destructive">{error("confirmSeller")}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("adminEventInvoices.settings.confirmedAt", { date: settings.confirmedAt.slice(0, 10) })}
            </p>
          )}
        </div>
      </EventStudioRow>
      <EventStudioSaveBar
        dirty={isSettingsDraftDirty(draft, initial)}
        saving={save.isPending}
        saveLabel={t("adminEventInvoices.settings.save")}
        discardLabel={t("adminEventInvoices.settings.discard")}
        savingLabel={t("adminEventInvoices.settings.saving")}
        onSave={submit}
        onDiscard={() => {
          setDraft(initial);
          setShowErrors(false);
        }}
      />
    </div>
  );
}

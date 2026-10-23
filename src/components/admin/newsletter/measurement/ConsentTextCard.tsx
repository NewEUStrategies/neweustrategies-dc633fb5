// Organizm: treść zgody na newsletter PL/EN w ustawieniach newslettera
// (I9d-Y2; I9d-Y2b - decyzje właściciela 2026-10-23: D1 wariant (b) - każda
// zgoda ma osobne pole, D2 - pomiar tylko dla skrzynki potwierdzonej przez
// jej właściciela).
//
// CO POKAZUJE. Dwa pola (`policy_html_pl/_en`, grupa `inline` zapisu
// ustawień z CAS) - tekst pod formularzem zapisu (formularz w treści strony,
// kreator formularzy, popup newslettera). Puste pole = bieżąca treść
// domyślna z JEDNEGO źródła (`consentText.ts`, bez pomiaru, z wersją);
// placeholder pokazuje, co wyjdzie. Stan pola: „Treść domyślna (wersja …)"
// albo „Treść własna" (`consentFieldStatus`).
//
// POMIAR TO OSOBNE POLE. Treść zgody na newsletter nie daje zgody na pomiar
// otwarć i kliknięć - ani domyślna, ani własna (oznaczeń admina z wariantu
// (a) już nie ma). Karta pokazuje TYLKO DO ODCZYTU treść i wersję osobnego
// pola zgody na pomiar (`MeasurementConsentText`,
// `EMAIL_MEASUREMENT_CONSENT_VERSION`) - pole dokładają formularze, a zgodę
// zapisuje dopiero potwierdzenie właściciela skrzynki. Własny tekst zgody na
// newsletter, który wspomina pomiar, dostaje ostrzeżenie (R1.24,
// `newsletterConsentMentionsMeasurement` - lustro kontroli K5b runbooka).
//
// ROLE (lustro bramek SQL): treść zapisuje admin i redaktor
// (`admin_newsletter_settings_patch`) - sekcja wejściowa montuje kartę obu
// rolom.
//
// WSPÓŁBIEŻNOŚĆ jak przegląd newslettera: baza szkicu z tokenem
// `updated_at`; bez zmian szkic idzie za serwerem, ze zmianami - zostaje;
// konflikt pokazuje wspólny komunikat z akcją „Wczytaj aktualne".
import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import {
  MeasurementConsentText,
  NewsletterConsentText,
} from "@/components/newsletter/NewsletterConsentText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  newsletterSettingsQueryOptions,
  useNewsletterSettings,
  type NewsletterSettings,
} from "@/hooks/useNewsletterSettings";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { SYNC_MESSAGE_KEYS } from "@/lib/billing/planQueries";
import { ensureI18n } from "@/lib/i18n-admin-newsletter-measurement";
import { ensureI18n as ensurePaywallSyncI18n } from "@/lib/i18n-admin-paywall-sync";
import {
  NEWSLETTER_CONSENT_VERSION,
  newsletterConsentHtml,
  resolveNewsletterConsent,
  type ConsentLang,
} from "@/lib/newsletter/consentText";
import { EMAIL_MEASUREMENT_CONSENT_VERSION } from "@/lib/newsletter/measurementConsentText";
import { usePatchNewsletterSettings } from "@/lib/newsletter/settingsQueries";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  CONSENT_POLICY_FIELD,
  CONSENT_TEXT_LANGS,
  consentColumnValue,
  consentDraftDirty,
  consentDraftFrom,
  consentFieldStatus,
  newsletterConsentMentionsMeasurement,
  type ConsentDraft,
} from "./consentTextRules";

/** Grupa kolumn tego edytora - biała lista TS i SQL (`newsletter-groups`). */
const SETTINGS_GROUP = "inline" as const;

/** Etykiety pól wypisane literalnie - bramka pokrycia kluczy widzi każdy. */
const FIELD_LABEL_KEYS: Readonly<Record<ConsentLang, string>> = {
  pl: "adminNewsletterMeasurement.consent.fieldPl",
  en: "adminNewsletterMeasurement.consent.fieldEn",
};

/** Nagłówki języków w podglądzie pola pomiaru - literalnie (bramka pokrycia kluczy). */
const MEASUREMENT_LANG_KEYS: Readonly<Record<ConsentLang, string>> = {
  pl: "adminNewsletterMeasurement.consent.measurement.langPl",
  en: "adminNewsletterMeasurement.consent.measurement.langEn",
};

export function ConsentTextCard() {
  ensureI18n();
  ensurePaywallSyncI18n();
  const { t } = useTranslation();
  const settingsQ = useNewsletterSettings();
  const settings = settingsQ.data;

  return (
    <SectionCard
      icon={ShieldCheck}
      title={t("adminNewsletterMeasurement.consent.title")}
      description={t("adminNewsletterMeasurement.consent.subtitle")}
    >
      {settings ? (
        <div className="space-y-6">
          <ConsentTextBody saved={settings} />
          <MeasurementFieldSection />
        </div>
      ) : settingsQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminNewsletterMeasurement.consent.state.loadError")}
          <Button size="sm" variant="outline" onClick={() => void settingsQ.refetch()}>
            {t("adminNewsletterMeasurement.retry")}
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("adminNewsletterMeasurement.consent.state.loading")}
        </p>
      )}
    </SectionCard>
  );
}

function ConsentTextBody({ saved }: { saved: NewsletterSettings }) {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const save = usePatchNewsletterSettings(SETTINGS_GROUP);
  // `base` = wiersz, od którego szkic się zaczął (token CAS); `synced` - ostatni
  // odczyt, za którym szkic bez zmian podąża.
  const [base, setBase] = useState<NewsletterSettings>(saved);
  const [synced, setSynced] = useState<NewsletterSettings>(saved);
  const [draft, setDraft] = useState<ConsentDraft>(() => consentDraftFrom(saved));

  // Nowszy odczyt (zapis z innej karty, szyna): szkic bez zmian idzie za nim,
  // szkic ze zmianami zostaje na swojej bazie. Korekta stanu w renderze -
  // wzorzec Reacta dla stanu zależnego od propsów, bez efektu i migotania.
  if (saved !== synced) {
    setSynced(saved);
    if (!consentDraftDirty(draft, base)) {
      setBase(saved);
      setDraft(consentDraftFrom(saved));
    }
  }

  const dirty = consentDraftDirty(draft, base);
  useUnsavedChangesGuard(dirty);

  const reloadCurrent = async () => {
    const fresh = await queryClient.fetchQuery({
      ...newsletterSettingsQueryOptions(),
      staleTime: 0,
    });
    // Wpisany tekst zostaje na świeżej bazie - kolejny zapis świadomie
    // nadpisze cudzą zmianę już z aktualnym tokenem.
    setBase(fresh);
    setSynced(fresh);
    toast.info(t("adminPaywall.sync.reloaded"));
  };

  const onSave = async () => {
    if (!dirty || save.isPending) return;
    const next: NewsletterSettings = {
      ...base,
      [CONSENT_POLICY_FIELD.pl]: consentColumnValue(draft.pl),
      [CONSENT_POLICY_FIELD.en]: consentColumnValue(draft.en),
    };
    try {
      const result = await save.mutateAsync({
        base,
        draft: next,
        expectedUpdatedAt: base.updated_at ?? null,
      });
      setBase({ ...next, updated_at: result.updatedAt ?? next.updated_at });
      toast.success(
        result.merged ? t(SYNC_MESSAGE_KEYS.merged) : t("adminNewsletterMeasurement.consent.saved"),
      );
    } catch (err) {
      showSaveError(err, t, () => void reloadCurrent());
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {t("adminNewsletterMeasurement.consent.hint")}
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        {CONSENT_TEXT_LANGS.map((lang) => {
          const column = CONSENT_POLICY_FIELD[lang];
          return (
            <ConsentField
              key={lang}
              id={`${id}-${lang}`}
              lang={lang}
              label={t(FIELD_LABEL_KEYS[lang])}
              value={draft[lang]}
              // Stan dotyczy tekstu ZAPISANEGO w bazie (ostatni odczyt) - to
              // widzi dziś czytelnik; ostrzeżenie i podgląd - szkicu.
              savedText={saved[column]}
              disabled={save.isPending}
              onChange={(value) => setDraft((prev) => ({ ...prev, [lang]: value }))}
              onReset={() => setDraft((prev) => ({ ...prev, [lang]: "" }))}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty ? (
          <Badge variant="outline" className="font-normal">
            {t("adminNewsletterMeasurement.consent.unsaved")}
          </Badge>
        ) : null}
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => void onSave()}>
          {save.isPending
            ? t("adminNewsletterMeasurement.consent.saving")
            : t("adminNewsletterMeasurement.consent.save")}
        </Button>
      </div>
    </div>
  );
}

interface ConsentFieldProps {
  id: string;
  lang: ConsentLang;
  label: string;
  value: string;
  savedText: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}

function ConsentField({
  id,
  lang,
  label,
  value,
  savedText,
  disabled,
  onChange,
  onReset,
}: ConsentFieldProps) {
  const { t } = useTranslation();
  const status = consentFieldStatus(savedText);
  const mentionsMeasurement = newsletterConsentMentionsMeasurement(value);
  const resolved = resolveNewsletterConsent(value, lang);
  const statusId = `${id}-status`;

  return (
    <div className="space-y-2" data-consent-field={lang}>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7"
          disabled={disabled || value === ""}
          onClick={onReset}
        >
          {t("adminNewsletterMeasurement.consent.reset")}
        </Button>
      </div>
      <Textarea
        id={id}
        rows={5}
        value={value}
        placeholder={newsletterConsentHtml(lang)}
        disabled={disabled}
        aria-describedby={statusId}
        onChange={(event) => onChange(event.target.value)}
      />

      <div id={statusId} className="space-y-1 text-xs">
        <p className="text-muted-foreground" data-consent-status={status}>
          {status === "default"
            ? t("adminNewsletterMeasurement.consent.status.default", {
                version: NEWSLETTER_CONSENT_VERSION,
              })
            : t("adminNewsletterMeasurement.consent.status.custom")}
        </p>
        {mentionsMeasurement ? (
          <p
            role="note"
            data-consent-warning="mentions-measurement"
            className="flex items-start gap-1.5 text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("adminNewsletterMeasurement.consent.mentionsMeasurement")}
          </p>
        ) : null}
      </div>

      <div className="space-y-1 rounded-md border border-border/60 p-3">
        <p className="text-xs font-medium">
          {t("adminNewsletterMeasurement.consent.previewLabel")}
        </p>
        {resolved.isDefault ? (
          <p className="text-xs text-muted-foreground" lang={lang}>
            <NewsletterConsentText lang={lang} />
          </p>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            lang={lang}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(resolved.text) }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Sekcja tylko do odczytu: treść i wersja OSOBNEGO pola zgody na pomiar.
 * Treść jest stała i wersjonowana w kodzie (dowód zgody wskazuje jedną
 * treść), więc panel jej nie edytuje - pokazuje, co zobaczy czytelnik.
 */
function MeasurementFieldSection() {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-measurement-field-preview=""
      className="space-y-3 rounded-md border border-border/60 p-3"
    >
      <div className="space-y-1">
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {t("adminNewsletterMeasurement.consent.measurement.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("adminNewsletterMeasurement.consent.measurement.version", {
            version: EMAIL_MEASUREMENT_CONSENT_VERSION,
          })}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("adminNewsletterMeasurement.consent.measurement.note")}
      </p>
      <p className="text-xs font-medium">
        {t("adminNewsletterMeasurement.consent.measurement.previewLabel")}
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {CONSENT_TEXT_LANGS.map((lang) => (
          <div key={lang} className="space-y-1" data-measurement-preview={lang}>
            <p className="text-xs font-medium">{t(MEASUREMENT_LANG_KEYS[lang])}</p>
            <p className="text-xs text-muted-foreground" lang={lang}>
              <MeasurementConsentText lang={lang} />
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("adminNewsletterMeasurement.consent.measurement.fixedNote")}
      </p>
    </section>
  );
}

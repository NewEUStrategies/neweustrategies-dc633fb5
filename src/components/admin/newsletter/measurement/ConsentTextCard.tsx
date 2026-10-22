// Organizm: treść zgody na newsletter PL/EN w ustawieniach newslettera
// (I9d-Y2, decyzje właściciela 2026-10-20 i 2026-10-21, wariant (a)).
//
// CO POKAZUJE. Dwa pola (`policy_html_pl/_en`, grupa `inline` zapisu
// ustawień z CAS) - tekst pod formularzem zapisu (formularz w treści strony,
// kreator formularzy, popup newslettera). Puste pole = bieżąca treść
// domyślna z JEDNEGO źródła (`consentText.ts`), z pomiarem otwarć i kliknięć
// i wersją; placeholder pokazuje, co wyjdzie.
//
// OSTRZEŻENIE ZAMIAST HEURYSTYKI. Własny tekst obejmuje pomiar WYŁĄCZNIE po
// jawnym oznaczeniu admina „mój tekst obejmuje pomiar" - baza liczy skrót
// ZAPISANEGO tekstu, więc każda zmiana tekstu unieważnia oznaczenie, a panel
// mówi to przed zapisem (`draftLosesMeasurement`) i po nim (`uncovered`,
// `stale`). Szukanie słów „pomiar"/„kliknięcia" w tekście nie jest dowodem
// zgody, więc panel go nie robi.
//
// ROLE (lustro bramek SQL): treść zapisuje admin i redaktor
// (`admin_newsletter_settings_patch`), stan treści czytają oboje
// (`requireAdminEditor`), oznaczenie zmienia wyłącznie admin (`requireAdmin`)
// - redaktor widzi ostrzeżenie i zablokowane pole z wyjaśnieniem.
//
// WSPÓŁBIEŻNOŚĆ jak przegląd newslettera: baza szkicu z tokenem
// `updated_at`; bez zmian szkic idzie za serwerem, ze zmianami - zostaje;
// konflikt pokazuje wspólny komunikat z akcją „Wczytaj aktualne".
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";
import { showSaveError } from "@/components/admin/pricing/saveErrorToast";
import { NewsletterConsentText } from "@/components/newsletter/NewsletterConsentText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDate } from "@/lib/i18n/format";
import {
  NEWSLETTER_CONSENT_VERSION,
  newsletterConsentHtml,
  resolveNewsletterConsent,
  type ConsentLang,
} from "@/lib/newsletter/consentText";
import { usePatchNewsletterSettings } from "@/lib/newsletter/settingsQueries";
import type { ConsentMeasurementFieldDto } from "@/lib/privacy/measurementParse";
import {
  newsletterConsentMeasurementQueryOptions,
  useMarkNewsletterConsentMeasurement,
} from "@/lib/privacy/measurementQueries";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  CONSENT_POLICY_FIELD,
  CONSENT_TEXT_LANGS,
  consentColumnValue,
  consentDraftDirty,
  consentDraftFrom,
  consentFieldDirty,
  consentFieldStatus,
  draftLosesMeasurement,
  type ConsentDraft,
} from "./consentTextRules";

/** Grupa kolumn tego edytora - biała lista TS i SQL (`newsletter-groups`). */
const SETTINGS_GROUP = "inline" as const;

/** Etykiety pól wypisane literalnie - bramka pokrycia kluczy widzi każdy. */
const FIELD_LABEL_KEYS: Readonly<Record<ConsentLang, string>> = {
  pl: "adminNewsletterMeasurement.consent.fieldPl",
  en: "adminNewsletterMeasurement.consent.fieldEn",
};

export function ConsentTextCard({ canMark }: { canMark: boolean }) {
  ensureI18n();
  ensurePaywallSyncI18n();
  const { t } = useTranslation();
  const settingsQ = useNewsletterSettings();
  const settings = settingsQ.data;

  return (
    <SectionCard
      icon={ShieldCheck}
      title={t("adminNewsletterMeasurement.consent.title")}
      description={t("adminNewsletterMeasurement.consent.subtitle", {
        version: NEWSLETTER_CONSENT_VERSION,
      })}
    >
      {settings ? (
        <ConsentTextBody saved={settings} canMark={canMark} />
      ) : settingsQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminNewsletterMeasurement.consent.state.readError")}
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

function ConsentTextBody({ saved, canMark }: { saved: NewsletterSettings; canMark: boolean }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const save = usePatchNewsletterSettings(SETTINGS_GROUP);
  const consentQ = useQuery(newsletterConsentMeasurementQueryOptions());
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
  const fields = consentQ.data?.state === "ready" ? consentQ.data.data.fields : null;

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
      {consentQ.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          {t("adminNewsletterMeasurement.consent.state.readError")}
          <Button size="sm" variant="outline" onClick={() => void consentQ.refetch()}>
            {t("adminNewsletterMeasurement.retry")}
          </Button>
        </div>
      ) : consentQ.data?.state === "unavailable" ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("adminNewsletterMeasurement.consent.state.unavailable")}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {CONSENT_TEXT_LANGS.map((lang) => {
          const column = CONSENT_POLICY_FIELD[lang];
          const fieldId = `${id}-${lang}`;
          return (
            <ConsentField
              key={lang}
              id={fieldId}
              lang={lang}
              label={t(FIELD_LABEL_KEYS[lang])}
              value={draft[lang]}
              // Stan i oznaczenie dotyczą tekstu ZAPISANEGO w bazie (ostatni
              // odczyt), nie bazy szkicu - baza liczy skrót zapisanej treści.
              savedText={saved[column]}
              measurement={fields?.find((f) => f.field === column) ?? null}
              loading={consentQ.isLoading}
              canMark={canMark}
              uiLang={i18n.language}
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
  measurement: ConsentMeasurementFieldDto | null;
  loading: boolean;
  canMark: boolean;
  uiLang: string;
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
  measurement,
  loading,
  canMark,
  uiLang,
  disabled,
  onChange,
  onReset,
}: ConsentFieldProps) {
  const { t } = useTranslation();
  const markM = useMarkNewsletterConsentMeasurement();
  const status = consentFieldStatus(savedText, measurement);
  const fieldDirty = consentFieldDirty(value, savedText);
  const losesMeasurement = draftLosesMeasurement(value, savedText);
  const resolved = resolveNewsletterConsent(value, lang);
  const statusId = `${id}-status`;

  const toggleMark = async (next: boolean) => {
    if (!measurement) return;
    const result = await markM.mutateAsync({ field: measurement.field, marked: next });
    if (result.ok) {
      toast.success(
        next
          ? t("adminNewsletterMeasurement.consent.mark.marked")
          : t("adminNewsletterMeasurement.consent.mark.unmarked"),
      );
    } else if (result.error === "forbidden") {
      toast.error(t("adminNewsletterMeasurement.consent.mark.adminOnly"));
    } else if (result.error === "invalid") {
      // `text_missing`: pole w bazie jest puste - oznaczać nie ma czego.
      toast.error(t("adminNewsletterMeasurement.consent.mark.saveFirst"));
    } else {
      toast.error(t("adminNewsletterMeasurement.consent.mark.error"));
    }
  };

  // Oznaczać można wyłącznie ZAPISANY własny tekst: puste pole i treść
  // domyślna obejmują pomiar same, a szkic niezapisany ma inny skrót.
  const markable = status === "marked" || status === "uncovered";
  const markChecked = measurement?.marked === true && !measurement.stale;
  const markDisabled = !canMark || fieldDirty || markM.isPending || disabled;

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
        {losesMeasurement ? (
          <p role="note" className="flex items-start gap-1.5 text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("adminNewsletterMeasurement.consent.status.draftCustom")}
          </p>
        ) : null}
        {loading && status === "unknown" ? null : status === "default" ? (
          <p className="text-muted-foreground" data-consent-status="default">
            {t("adminNewsletterMeasurement.consent.status.default")}
          </p>
        ) : status === "marked" ? (
          <p className="text-muted-foreground" data-consent-status="marked">
            {t("adminNewsletterMeasurement.consent.status.marked", {
              date: measurement?.markedAt ? formatDate(measurement.markedAt, uiLang) : "",
            })}
          </p>
        ) : status === "uncovered" ? (
          <div className="space-y-1 text-destructive" data-consent-status="uncovered">
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("adminNewsletterMeasurement.consent.status.uncovered")}
            </p>
            {measurement?.stale ? (
              <p>{t("adminNewsletterMeasurement.consent.status.stale")}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {markable ? (
        <div className="flex items-start gap-2 rounded-md border border-border/60 p-3">
          <Checkbox
            id={`${id}-mark`}
            checked={markChecked}
            disabled={markDisabled}
            aria-describedby={`${id}-mark-hint`}
            onCheckedChange={(state) => void toggleMark(state === true)}
          />
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${id}-mark`} className="cursor-pointer text-sm font-normal">
              {t("adminNewsletterMeasurement.consent.mark.label")}
            </Label>
            <p id={`${id}-mark-hint`} className="text-xs text-muted-foreground">
              {t("adminNewsletterMeasurement.consent.mark.hint")}{" "}
              {!canMark
                ? t("adminNewsletterMeasurement.consent.mark.adminOnly")
                : fieldDirty
                  ? t("adminNewsletterMeasurement.consent.mark.saveFirst")
                  : null}
            </p>
          </div>
        </div>
      ) : null}

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

// Organizm: WSPÓLNY edytor treści jednorazowego maila do listy newslettera
// (PL/EN, pola z limitami, podgląd renderu serwera, zapis z CAS) - prośba
// o potwierdzenie subskrypcji (wygaszanie, I9d-Y1) i prośba o zgodę na
// pomiar otwarć i kliknięć (I9d-Y2). Kształt nadpisań jest jeden
// (`NewsletterSunsetCopyOverrides`, ten sam schemat zapisu), różnią się
// wyłącznie treść domyślna, zmienne, mutatory i napisy komunikatów - te
// przychodzą z opakowania, więc obie prośby mają jeden edytor, nie dwie kopie.
//
// WZORZEC PÓL NEWSLETTERA (`TxEmailContentPanel`): PL/EN przełącznikiem,
// PUSTE pole = treść domyślna w tonie NES (placeholder pokazuje, co wyjdzie),
// „Przywróć domyślne" czyści JEDEN język (reset obu wyciera pracę tłumacza),
// podgląd z tego samego renderu co wysyłka (funkcja serwerowa).
//
// LIMIT ODRZUCA, NIE PRZYCINA (AGENTS). Licznik liczy punkty kodowe jak
// `char_length` (`copyLength`); pole ponad limit blokuje zapis z komunikatem
// przy polu - mail nie dostanie po cichu uciętego zdania.
//
// WSPÓŁBIEŻNOŚĆ. Zapis niesie token `updated_at` odczytu (CAS). Konflikt NIE
// wyciera szkicu: edytor przyjmuje nowszą wersję jako bazę (`latest()` -
// z pamięci zapytań, bo mutator czeka na ponowny odczyt przed oddaniem
// wyniku), zostawia wpisany tekst i mówi, że kolejny zapis nadpisze tamtą
// wersję - świadomie.
//
// Etykiety pól i przycisków są wspólne (`adminDataRetention.sunsetCopy.*`,
// słownik ładuje się tu) - napisy właściwe dla prośby (`texts`) tłumaczy
// opakowanie swoim słownikiem.
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ensureI18n } from "@/lib/i18n-admin-data-retention";
import { uiLang } from "@/lib/i18n/format";
import {
  NEWSLETTER_SUNSET_COPY_FIELDS,
  NEWSLETTER_SUNSET_COPY_LIMITS,
  copyLength,
  type NewsletterSunsetCopy,
  type NewsletterSunsetCopyField,
  type NewsletterSunsetCopyOverrides,
  type NewsletterSunsetLang,
} from "@/lib/privacy/newsletterSunset";
import type { DataRetentionMutation } from "@/lib/privacy/rpcResult";
import {
  SUNSET_COPY_LANGS as LANGS,
  sunsetCopyDirty,
  sunsetCopyOverLimit,
} from "./sunsetCopyRules";

/** Zapisana treść z tokenem CAS (`null` = najemca nie zapisał jeszcze treści). */
export interface MailCopySaved {
  overrides: NewsletterSunsetCopyOverrides;
  updatedAt: string | null;
}

export interface MailCopyPreviewInput {
  lang: NewsletterSunsetLang;
  overrides: NewsletterSunsetCopyOverrides;
}

export interface MailCopyPreview {
  subject: string;
  html: string;
  text: string;
}

/** Wycinek wyniku `useMutation` podglądu, którego edytor używa. */
export interface MailCopyPreviewMutation {
  mutate: (input: MailCopyPreviewInput) => void;
  data: DataRetentionMutation<MailCopyPreview> | undefined;
  variables: MailCopyPreviewInput | undefined;
  isPending: boolean;
  isError: boolean;
}

/** Napisy właściwe dla prośby - już przetłumaczone przez opakowanie. */
export interface MailCopyTexts {
  tokens: string;
  saved: string;
  saveError: string;
  conflict: string;
  forbidden: string;
  previewFrame: string;
  previewNote: string;
}

export interface MailCopyEditorBodyProps {
  saved: MailCopySaved;
  defaults: Readonly<Record<NewsletterSunsetLang, NewsletterSunsetCopy>>;
  texts: MailCopyTexts;
  saving: boolean;
  save: (input: {
    overrides: NewsletterSunsetCopyOverrides;
    expectedUpdatedAt: string | null;
  }) => Promise<DataRetentionMutation<MailCopySaved>>;
  /** Najnowsza wersja z pamięci zapytań - baza szkicu po konflikcie. */
  latest: () => MailCopySaved | null;
  preview: MailCopyPreviewMutation;
}

/** Pola wielowierszowe - reszta to krótkie napisy (temat, przycisk...). */
const MULTILINE: ReadonlySet<NewsletterSunsetCopyField> = new Set(["intro", "note"]);

/** Klucze etykiet wypisane literalnie - bramka pokrycia kluczy widzi każdy. */
const FIELD_LABEL_KEYS: Readonly<Record<NewsletterSunsetCopyField, string>> = {
  subject: "adminDataRetention.sunsetCopy.fields.subject",
  preview: "adminDataRetention.sunsetCopy.fields.preview",
  eyebrow: "adminDataRetention.sunsetCopy.fields.eyebrow",
  heading: "adminDataRetention.sunsetCopy.fields.heading",
  intro: "adminDataRetention.sunsetCopy.fields.intro",
  cta: "adminDataRetention.sunsetCopy.fields.cta",
  note: "adminDataRetention.sunsetCopy.fields.note",
};

const EMPTY_LANG: Record<NewsletterSunsetCopyField, string> = {
  subject: "",
  preview: "",
  eyebrow: "",
  heading: "",
  intro: "",
  cta: "",
  note: "",
};

export function MailCopyEditorBody({
  saved,
  defaults,
  texts,
  saving,
  save,
  latest,
  preview: previewM,
}: MailCopyEditorBodyProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const id = useId();
  // Język EDYTOWANEJ treści startuje od języka panelu, dalej jest niezależny.
  const [lang, setLang] = useState<NewsletterSunsetLang>(uiLang(i18n.language));
  const [draft, setDraft] = useState<NewsletterSunsetCopyOverrides>(saved.overrides);
  // Baza szkicu: wersja, od której szkic się zaczął (token CAS i znacznik zmian).
  const [base, setBase] = useState<MailCopySaved>(saved);
  const [synced, setSynced] = useState<MailCopySaved>(saved);
  const [previewLang, setPreviewLang] = useState<NewsletterSunsetLang | null>(null);

  // Nowszy odczyt (zapis z innej karty, szyna): szkic bez zmian idzie za nim,
  // szkic ze zmianami zostaje na swojej bazie. Korekta stanu w renderze -
  // wzorzec Reacta dla stanu zależnego od propsów, bez efektu i migotania.
  if (saved !== synced) {
    setSynced(saved);
    if (!sunsetCopyDirty(draft, base.overrides)) {
      setDraft(saved.overrides);
      setBase(saved);
    }
  }

  const dirty = sunsetCopyDirty(draft, base.overrides);
  const overLimit = sunsetCopyOverLimit(draft);
  const valid = overLimit.length === 0;

  const runPreview = (target: NewsletterSunsetLang) => {
    setPreviewLang(target);
    previewM.mutate({ lang: target, overrides: draft });
  };

  // Pierwszy podgląd i podgląd po zmianie języka - raz na język, bez pętli
  // ponowień przy błędzie (ponowienie to przycisk „Odśwież podgląd").
  useEffect(() => {
    if (previewLang === lang || !valid) return;
    setPreviewLang(lang);
    previewM.mutate({ lang, overrides: draft });
  }, [lang, previewLang, valid, draft, previewM]);

  const setField = (field: NewsletterSunsetCopyField, value: string) =>
    setDraft((prev) => ({ ...prev, [lang]: { ...prev[lang], [field]: value } }));

  const resetLang = () => setDraft((prev) => ({ ...prev, [lang]: { ...EMPTY_LANG } }));

  const onSave = async () => {
    if (!dirty || !valid) return;
    const result = await save({ overrides: draft, expectedUpdatedAt: base.updatedAt });
    if (result.ok) {
      setBase(result.data);
      setDraft(result.data.overrides);
      toast.success(texts.saved);
      runPreview(lang);
      return;
    }
    if (result.error === "conflict") {
      const newer = latest();
      if (newer) setBase(newer);
      toast.error(texts.conflict);
    } else if (result.error === "invalid") {
      toast.error(t("adminDataRetention.sunsetCopy.invalid"));
    } else if (result.error === "forbidden") {
      toast.error(texts.forbidden);
    } else {
      toast.error(texts.saveError);
    }
  };

  const current = draft[lang];
  const langDefaults = defaults[lang];
  const preview =
    previewM.data?.ok && previewM.variables?.lang === lang ? previewM.data.data : null;
  const previewFailed =
    previewM.isError || (previewM.data !== undefined && !previewM.data.ok && !previewM.isPending);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span id={`${id}-lang`} className="text-xs font-medium text-muted-foreground">
          {t("adminDataRetention.sunsetCopy.langLabel")}
        </span>
        <div role="group" aria-labelledby={`${id}-lang`} className="flex flex-wrap gap-1">
          {LANGS.map((code) => (
            <Button
              key={code}
              type="button"
              size="sm"
              variant={code === lang ? "default" : "outline"}
              className="h-7"
              aria-pressed={code === lang}
              onClick={() => setLang(code)}
            >
              {code.toUpperCase()}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {dirty ? (
            <Badge variant="outline" className="font-normal">
              {t("adminDataRetention.sunsetCopy.unsaved")}
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" disabled={saving} onClick={resetLang}>
            {t("adminDataRetention.sunsetCopy.reset")}
          </Button>
          <Button size="sm" disabled={!dirty || !valid || saving} onClick={() => void onSave()}>
            {t("adminDataRetention.sunsetCopy.save")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          {NEWSLETTER_SUNSET_COPY_FIELDS.map((field) => {
            const value = current[field];
            const max = NEWSLETTER_SUNSET_COPY_LIMITS[field];
            const count = copyLength(value);
            const tooLong = count > max;
            const fieldId = `${id}-${lang}-${field}`;
            const common = {
              id: fieldId,
              value,
              placeholder: langDefaults[field],
              "aria-invalid": tooLong ? true : undefined,
              "aria-describedby": `${fieldId}-count`,
            } as const;
            return (
              <div key={field} className="space-y-1">
                <Label htmlFor={fieldId}>{t(FIELD_LABEL_KEYS[field])}</Label>
                {MULTILINE.has(field) ? (
                  <Textarea
                    {...common}
                    rows={field === "intro" ? 5 : 3}
                    onChange={(event) => setField(field, event.target.value)}
                  />
                ) : (
                  <Input {...common} onChange={(event) => setField(field, event.target.value)} />
                )}
                <p
                  id={`${fieldId}-count`}
                  className={tooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
                >
                  {tooLong
                    ? t("adminDataRetention.sunsetCopy.tooLong", { count, max })
                    : t("adminDataRetention.sunsetCopy.counter", { count, max })}
                </p>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">{texts.tokens}</p>
        </div>

        <div
          role="region"
          aria-labelledby={`${id}-preview`}
          className="space-y-2 rounded-md border border-border/60 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-preview`} className="text-sm font-semibold">
              {t("adminDataRetention.sunsetCopy.previewTitle")}
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={!valid || previewM.isPending}
              onClick={() => runPreview(lang)}
            >
              {t("adminDataRetention.sunsetCopy.previewRefresh")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{texts.previewNote}</p>
          {previewM.isPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t("adminDataRetention.sunsetCopy.previewLoading")}
            </p>
          ) : previewFailed ? (
            <p role="alert" className="text-xs">
              {t("adminDataRetention.sunsetCopy.previewError")}
            </p>
          ) : preview ? (
            <>
              <p className="text-xs font-medium">
                {t("adminDataRetention.sunsetCopy.previewSubject", { subject: preview.subject })}
              </p>
              <iframe
                title={texts.previewFrame}
                srcDoc={preview.html}
                sandbox=""
                className="h-[620px] w-full rounded-md border border-border/60 bg-white"
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

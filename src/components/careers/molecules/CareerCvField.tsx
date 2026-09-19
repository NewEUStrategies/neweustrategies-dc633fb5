// Molekuła: obowiązkowe CV kandydata - plik (do 5 MB) ALBO link.
// Plik ląduje w prywatnym bucketcie `career-cv` od razu po wyborze, dzięki
// czemu wysyłka formularza nie czeka na transfer, a kandydat widzi status.
//
// POWŁOKA JEST WSPÓLNA (`@/components/ui/upload-area`): kandydat widzi ten sam
// obszar wgrywania, co redakcja w panelu - z przeciąganiem pliku, którego to
// pole wcześniej NIE MIAŁO (był wyłącznie przycisk „Wgraj").
//
// KONTENER `[data-field="cv"]` ZOSTAJE. Formularz kariery ustawia na nim fokus
// po nieudanej walidacji (`document.querySelector('[data-field="cv"]')`), więc
// jest częścią kontraktu z rodzicem, a nie dekoracją.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCheck2, FileText, FileUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloatingInput } from "@/components/ui/floating-input";
import { UploadArea } from "@/components/ui/upload-area";
import { CV_ACCEPT_ATTR } from "@/lib/careers/applicationSchema";
import { uploadCv } from "@/lib/careers/cvUpload";

export interface CvValue {
  /** Ścieżka w buckecie `career-cv` (pusta, gdy kandydat podał link). */
  path: string;
  /** Oryginalna nazwa pliku - trafia do metadanych zgłoszenia. */
  fileName: string;
  /** Link do CV podany ręcznie. */
  url: string;
}

export const EMPTY_CV: CvValue = { path: "", fileName: "", url: "" };

export function CareerCvField({
  value,
  onChange,
  error,
  onErrorMessage,
}: {
  value: CvValue;
  onChange: (next: CvValue) => void;
  error?: string;
  /** Błędy wysyłki pliku raportujemy do rodzica (jedno miejsce na komunikat). */
  onErrorMessage: (key: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const id = useId();
  const errorId = `${id}-err`;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    onErrorMessage(undefined);
    setUploading(true);
    const result = await uploadCv(file);
    setUploading(false);
    if (!result.ok) {
      onErrorMessage(`careers.form.errors.${result.errorKey}`);
      return;
    }
    onChange({ path: result.path, fileName: result.fileName, url: "" });
  };

  const ctaLabel = value.fileName ? t("careers.form.cvChange") : t("careers.form.cvUpload");

  return (
    <div
      data-field="cv"
      data-invalid={error ? "true" : undefined}
      tabIndex={-1}
      aria-describedby={error ? errorId : undefined}
    >
      <UploadArea
        size="sm"
        className="text-left sm:text-center"
        title={t("careers.form.cv")}
        description={t("careers.form.cvHint")}
        ctaLabel={ctaLabel}
        busyLabel={t("careers.form.cvUploading")}
        busy={uploading}
        icons={[FileText, FileUp, FileCheck2]}
        accept={CV_ACCEPT_ATTR}
        inputLabel={t("careers.form.cvUpload")}
        error={error}
        errorId={errorId}
        onFiles={(files) => void pickFile(files[0])}
        preview={
          value.fileName ? (
            <span className="inline-flex max-w-full items-center gap-2 rounded-md bg-brand/[0.06] px-2 py-1 text-xs">
              <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
              <span className="truncate">{value.fileName}</span>
            </span>
          ) : undefined
        }
        actions={
          value.fileName ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("careers.form.cvRemove")}
              onClick={() => onChange({ ...EMPTY_CV })}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          ) : undefined
        }
        footer={
          value.fileName ? undefined : (
            <div className="space-y-2">
              <p className="text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {t("careers.form.cvOr")}
              </p>
              <FloatingInput
                label={t("careers.form.cvUrl")}
                inputMode="url"
                value={value.url}
                onChange={(event) => onChange({ path: "", fileName: "", url: event.target.value })}
              />
            </div>
          )
        }
      />
    </div>
  );
}

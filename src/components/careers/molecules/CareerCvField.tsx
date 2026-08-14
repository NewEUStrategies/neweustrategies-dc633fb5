// Molekuła: obowiązkowe CV kandydata - plik (do 5 MB) ALBO link.
// Plik ląduje w prywatnym bucketcie `career-cv` od razu po wyborze, dzięki
// czemu wysyłka formularza nie czeka na transfer, a kandydat widzi status.
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Paperclip, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FloatingInput } from "@/components/ui/floating-input";
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
  const inputRef = useRef<HTMLInputElement>(null);
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

  return (
    <div
      className="rounded-md border border-border/70 p-3"
      data-field="cv"
      data-invalid={error ? "true" : undefined}
      tabIndex={-1}
      aria-describedby={error ? errorId : undefined}
    >
      <p className="text-sm font-medium">{t("careers.form.cv")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("careers.form.cvHint")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={CV_ACCEPT_ATTR}
          onChange={(event) => {
            void pickFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Paperclip className="h-4 w-4" aria-hidden />
          )}
          {uploading
            ? t("careers.form.cvUploading")
            : value.fileName
              ? t("careers.form.cvChange")
              : t("careers.form.cvUpload")}
        </Button>

        {value.fileName ? (
          <span className="inline-flex max-w-full items-center gap-2 rounded-md bg-brand/[0.06] px-2 py-1 text-xs">
            <FileText className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
            <span className="truncate">{value.fileName}</span>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label={t("careers.form.cvRemove")}
              onClick={() => onChange({ ...EMPTY_CV })}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ) : (
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {t("careers.form.cvOr")}
          </span>
        )}
      </div>

      {!value.fileName ? (
        <div className="mt-3">
          <FloatingInput
            label={t("careers.form.cvUrl")}
            inputMode="url"
            value={value.url}
            onChange={(event) => onChange({ path: "", fileName: "", url: event.target.value })}
          />
        </div>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

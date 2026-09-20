// Atom: pole grafiki z uploadem z dysku, przeciągnięciem pliku i podglądem.
//
// JEDNA ŚCIEŻKA UPLOADU: walidacja MIME/rozmiaru -> storage w prefiksie najemcy
// -> rejestracja w bibliotece mediów (`uploadAndRegisterMedia`). Adres ręczny
// zostaje, bo redakcja bywa szybsza z gotowym linkiem z CDN.
//
// POWŁOKA JEST WSPÓLNA DLA CAŁEJ PLATFORMY (`@/components/ui/upload-area`):
// ten atom miał własną strefę `div[role="button"]` z obsługą Enter/Spacji, a
// obok niej przycisk robiący to samo - dwa punkty wejścia dla jednej czynności
// i dwa różne zachowania na klawiaturze niż w pozostałych polach platformy.
// Teraz klawiatura prowadzi przez CTA obszaru (prawdziwy `<button>`), a
// upuszczenie pliku obsługuje cały obszar.
//
// PODGLĄD MA PROPORCJE DOCELOWE (domyślnie 16:9), żeby autor od razu widział
// kadr, który zobaczy uczestnik - i rekomendowane wymiary pod spodem.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { FileImage, ImagePlus, Images, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadArea } from "@/components/ui/upload-area";
import { useAuth } from "@/hooks/useAuth";
import { registerMediaUpload } from "@/lib/media.functions";
import { IMAGE_ACCEPT_ATTR, IMAGE_MIME, uploadAndRegisterMedia } from "@/lib/media/upload";

interface EventImageDropzoneProps {
  label: string;
  /** Podpowiedź pod polem adresu - np. do czego grafika jest używana. */
  hint?: string;
  /** Rekomendowane wymiary pokazywane przy podglądzie, np. „1600 x 900 px". */
  recommendation: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Katalog w bibliotece mediów, np. `event-tracks`. */
  subfolder: string;
  /** Klasa proporcji kafla podglądu. */
  aspectClassName?: string;
  className?: string;
}

export function EventImageDropzone({
  label,
  hint,
  recommendation,
  value,
  onValueChange,
  subfolder,
  aspectClassName = "aspect-video",
  className,
}: EventImageDropzoneProps) {
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const registerUpload = useServerFn(registerMediaUpload);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasImage = value.trim() !== "";

  const handleFile = async (file: File): Promise<void> => {
    if (tenantId === null || tenantId === undefined || user?.id === undefined) {
      setError(t("adminEventAgenda.imageDrop.failed"));
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadAndRegisterMedia({
        file,
        tenantId,
        userId: user.id,
        registerMedia: registerUpload,
        allowedMime: IMAGE_MIME,
        subfolder,
      });
      onValueChange(uploaded.publicUrl);
      setError(null);
    } catch (e) {
      setError(`${t("adminEventAgenda.imageDrop.failed")} ${(e as Error).message}`.trim());
    } finally {
      setUploading(false);
    }
  };

  return (
    <UploadArea
      size="sm"
      className={className}
      title={label}
      description={t("adminEventAgenda.imageDrop.dropHint")}
      ctaLabel={
        hasImage ? t("adminEventAgenda.imageDrop.replace") : t("adminEventAgenda.imageDrop.upload")
      }
      busy={uploading}
      busyLabel={t("adminEventAgenda.imageDrop.uploading")}
      error={error}
      icons={[FileImage, ImagePlus, Images]}
      accept={IMAGE_ACCEPT_ATTR}
      inputLabel={
        hasImage ? t("adminEventAgenda.imageDrop.replace") : t("adminEventAgenda.imageDrop.upload")
      }
      // POLE TRZYMA JEDEN ADRES, więc z upuszczonej paczki bierzemy PIERWSZY
      // plik. Pętla nadpisywałaby wartość w kolejności odpowiedzi serwera i
      // redaktor dostawałby losowy z upuszczonych obrazów.
      onFiles={(files) => void handleFile(files[0])}
      preview={
        hasImage ? (
          <div
            className={`w-full overflow-hidden rounded-[6px] border border-border/60 ${aspectClassName}`}
          >
            <img src={value} alt={label} className="size-full object-cover" />
          </div>
        ) : undefined
      }
      actions={
        hasImage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("adminEventAgenda.imageDrop.remove")}
            onClick={() => onValueChange("")}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        ) : undefined
      }
      hint={t("adminEventAgenda.imageDrop.recommended", { size: recommendation })}
      footer={
        <>
          <Input
            className="h-9 w-full rounded-[6px]"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="https://"
            type="url"
            maxLength={2000}
            aria-label={t("adminEventAgenda.imageDrop.urlLabel")}
          />
          {hint !== undefined && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
        </>
      }
    />
  );
}

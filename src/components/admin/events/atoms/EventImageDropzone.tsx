// Atom: pole grafiki z uploadem z dysku, przeciągnięciem pliku i podglądem.
//
// JEDNA ŚCIEŻKA UPLOADU: walidacja MIME/rozmiaru -> storage w prefiksie najemcy
// -> rejestracja w bibliotece mediów (`uploadAndRegisterMedia`). Adres ręczny
// zostaje, bo redakcja bywa szybsza z gotowym linkiem z CDN.
//
// PODGLĄD MA PROPORCJE DOCELOWE (domyślnie 16:9), żeby autor od razu widział
// kadr, który zobaczy uczestnik - i rekomendowane wymiary pod spodem.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Trash2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
      if (fileRef.current !== null) fileRef.current.value = "";
    }
  };

  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</Label>
      <div
        role="button"
        tabIndex={0}
        aria-label={hasImage ? t("adminEventAgenda.imageDrop.replace") : t("adminEventAgenda.imageDrop.upload")}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file !== undefined) void handleFile(file);
        }}
        className={`relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-[6px] border border-dashed bg-muted/40 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${aspectClassName} ${
          dragOver ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/60"
        }`}
      >
        {uploading ? (
          <Loader2 aria-hidden="true" className="size-6 animate-spin text-muted-foreground" />
        ) : hasImage ? (
          <img src={value} alt={label} className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-3 text-center">
            <UploadCloud aria-hidden="true" className="size-6 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {t("adminEventAgenda.imageDrop.dropHint")}
            </span>
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t("adminEventAgenda.imageDrop.recommended", { size: recommendation })}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          className="h-9 min-w-[12rem] flex-1 rounded-[6px]"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="https://"
          type="url"
          maxLength={2000}
          aria-label={t("adminEventAgenda.imageDrop.urlLabel")}
        />
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={IMAGE_ACCEPT_ATTR}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void handleFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 rounded-[6px]"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ImagePlus aria-hidden="true" className="size-4" />
          )}
          {uploading
            ? t("adminEventAgenda.imageDrop.uploading")
            : hasImage
              ? t("adminEventAgenda.imageDrop.replace")
              : t("adminEventAgenda.imageDrop.upload")}
        </Button>
        {hasImage && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-[6px]"
            aria-label={t("adminEventAgenda.imageDrop.remove")}
            onClick={() => onValueChange("")}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
      {hint !== undefined && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      {error !== null && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

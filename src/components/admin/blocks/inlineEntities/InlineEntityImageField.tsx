// Pole obrazu encji inline (logo firmy / zdjęcie osoby): wgranie z dysku albo
// z biblioteki mediów, kadrowanie (rozmiar + przesuwanie), usunięcie.
//
// Każdy zapis kadru tworzy NOWY plik w bibliotece mediów - obraz źródłowy
// (logo w CRM, zdjęcie w profilu autora) nigdy nie jest nadpisywany. Oryginał
// wgrany z dysku też trafia do biblioteki, żeby ponowne kadrowanie startowało
// z pełnej jakości, a nie z już przyciętego kwadratu.

import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Crop, ImagePlus, Library, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { useAuth } from "@/hooks/useAuth";
import { registerMediaUpload } from "@/lib/media.functions";
import {
  checkUploadable,
  IMAGE_ACCEPT_ATTR,
  IMAGE_MIME,
  uploadAndRegisterMedia,
} from "@/lib/media/upload";
import { readFileAsDataUrl } from "@/lib/media/imageCrop";
import { buildAvatarSrc } from "@/lib/cropSizes";
import type { InlineEntityImage } from "@/lib/blocks/inlineEntities/model";
import { InlineEntityImageCropDialog, type CropResult } from "./InlineEntityImageCropDialog";
import "@/lib/i18n-admin-blocks";

const SUBFOLDER = "inline-entities";

interface Props {
  value: InlineEntityImage | null;
  onChange: (next: InlineEntityImage | null) => void;
  /** Etykieta pola („Logo" / „Zdjęcie"). */
  label: string;
  /** Inicjały do zastępczego awatara. */
  initials: string;
}

interface CropSession {
  /** Źródło w cropperze (data URL pliku albo adres oryginału). */
  source: string;
  /** Plik z dysku - wgrywany jako oryginał dopiero przy zapisie kadru. */
  file: File | null;
  /** Adres oryginału, gdy już jest w bibliotece / w źródle. */
  original: string | null;
  area?: InlineEntityImage["area"];
  zoom?: number;
}

function extensionFor(type: string): string {
  if (type === "image/webp") return "webp";
  if (type === "image/png") return "png";
  return "jpg";
}

export function InlineEntityImageField({ value, onChange, label, initials }: Props) {
  const { t } = useTranslation();
  const { user, tenantId } = useAuth();
  const registerMedia = useServerFn(registerMediaUpload);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [session, setSession] = useState<CropSession | null>(null);

  const upload = async (file: File): Promise<string> => {
    if (!user?.id || !tenantId) throw new Error(t("blocks.inlineEntity.crop.notSignedIn"));
    const uploaded = await uploadAndRegisterMedia({
      file,
      tenantId,
      userId: user.id,
      registerMedia,
      allowedMime: IMAGE_MIME,
      subfolder: SUBFOLDER,
    });
    return uploaded.publicUrl;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (checkUploadable(file, IMAGE_MIME)) {
      toast.error(t("blocks.inlineEntity.dialog.imageInvalid"));
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setSession({ source: dataUrl, file, original: null });
  };

  const onCropSave = async ({ blob, area, zoom }: CropResult) => {
    if (!session) return;
    const stamp = Date.now();
    const cropped = new File([blob], `inline-entity-${stamp}.${extensionFor(blob.type)}`, {
      type: blob.type || "image/png",
    });
    const [src, original] = await Promise.all([
      upload(cropped),
      session.file ? upload(session.file) : Promise.resolve(session.original),
    ]);
    onChange({ src, ...(original ? { original } : {}), area, zoom });
  };

  const recrop = () => {
    if (!value) return;
    const original = value.original ?? value.src;
    setSession({
      source: original,
      file: null,
      original,
      // Parametry kadru dotyczą oryginału - bez niego zaczynamy od zera.
      area: value.original ? value.area : undefined,
      zoom: value.original ? value.zoom : undefined,
    });
  };

  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-center gap-3">
        {value?.src ? (
          <img
            alt=""
            src={buildAvatarSrc(value.src, 56)}
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-[6px] object-cover ring-1 ring-foreground/15"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex size-14 shrink-0 items-center justify-center rounded-[6px] bg-muted text-base font-semibold text-muted-foreground ring-1 ring-foreground/15"
          >
            {initials}
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-3.5" aria-hidden />
            {t("blocks.inlineEntity.dialog.imageUpload")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setLibraryOpen(true)}
          >
            <Library className="size-3.5" aria-hidden />
            {t("blocks.inlineEntity.dialog.imageLibrary")}
          </Button>
          {value ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={recrop}
              >
                <Crop className="size-3.5" aria-hidden />
                {t("blocks.inlineEntity.dialog.imageCrop")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 text-destructive hover:text-destructive"
                onClick={() => onChange(null)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                {t("blocks.inlineEntity.dialog.imageRemove")}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <p className="m-0 text-[11px] text-muted-foreground">
        {t("blocks.inlineEntity.dialog.imageHint")}
      </p>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void onFile(file);
        }}
      />
      {/* Montowany dopiero po otwarciu - picker wymaga kontekstu tenanta
          i od razu pobiera listę mediów. */}
      {libraryOpen ? (
        <MediaPickerDialog
          open
          onOpenChange={setLibraryOpen}
          accept="image"
          title={t("blocks.inlineEntity.dialog.imageLibrary")}
          onPick={(url) => {
            setLibraryOpen(false);
            setSession({ source: url, file: null, original: url });
          }}
        />
      ) : null}
      <InlineEntityImageCropDialog
        open={session !== null}
        source={session?.source ?? null}
        initialArea={session?.area}
        initialZoom={session?.zoom}
        onOpenChange={(open) => {
          if (!open) setSession(null);
        }}
        onSave={onCropSave}
      />
    </div>
  );
}

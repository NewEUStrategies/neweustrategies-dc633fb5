// Organism: image upload slot with URL/file fallback, used by Image and Slider editors.
// Includes URL validation and rich error messages for upload failures
// (file size/type/storage). Errors render inline below the input.
// Uploady rejestrują się w bibliotece mediów (registerMediaUpload, folder
// /widgets) - wcześniej lądowały w storage z pominięciem tabeli `media`,
// więc były niewidoczne w bibliotece i cleanupie (higiena z audytu 13.07).
import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { IMAGE_MIME, VIDEO_MIME, uploadAndRegisterMedia } from "@/lib/media/upload";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Upload, X, AlertCircle, FileImage, FolderOpen, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadArea } from "@/components/ui/upload-area";
import "@/lib/i18n-upload-area";
import { mediaRenderUrl } from "@/lib/media/publicUrl";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { createMediaFolder, registerMediaUpload, updateMediaMeta } from "@/lib/media.functions";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { isImageOversized, isImageTooSmall, type PixelSize } from "@/lib/media/recommendedSize";
import "@/lib/i18n-builder";

/** Folder biblioteki, w którym lądują uploady z inspektora buildera. */
const WIDGETS_FOLDER = "/widgets/";

// Folder tworzymy raz na sesję panelu (createMediaFolder jest idempotentny -
// upsert po tenant_id+path - więc flaga to tylko oszczędność wywołań).
let widgetsFolderEnsured = false;

interface Props {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  /** Max upload size in MB (default 8). */
  maxSizeMb?: number;
  /**
   * Rekomendowany rozmiar pliku w pikselach - podany, włącza DWIE rzeczy:
   * podpowiedź przy polu ("Zalecany rozmiar: 1024 × 576 px") oraz pomiar
   * faktycznego obrazu po wgraniu/wybraniu i miękkie ostrzeżenie, gdy jest
   * wyraźnie mniejszy albo znacznie większy, niż trzeba. Bez tego propsu
   * kontrolka zachowuje się dokładnie jak wcześniej (zero zapytań o wymiary).
   */
  recommendedSize?: PixelSize | null;
}

// Obsługiwane formaty tła:
// - statyczne obrazy: JPG, PNG, WEBP, AVIF
// - animowane obrazy: GIF, animowany WEBP, APNG
// - wideo w tle (autoplay, muted, loop): MP4 (H.264), WEBM (VP9/AV1)
// - Lottie/JSON renderowany jest osobnym playerem, nie przez <img>, więc tu nie jest wgrywany.
//
// SVG NIE jest na liście: bucket `media` jest publiczny i serwuje bajty
// bezpośrednio, więc osadzony `<script>` wykonałby się w kontekście domeny.
// Serwerowa allowlista (`registerMediaUpload`) odrzuca ten typ od 23.07 - lista
// klienta zapraszała jednak do wgrania pliku, który i tak nie miał szans
// przejść, a przy niesprzątającej ścieżce uploadu zostawał żywy w storage.
// Źródłem prawdy jest teraz `@/lib/media/upload` (jedna lista dla całego UI).
const ALLOWED_MIME: readonly string[] = [...IMAGE_MIME, ...VIDEO_MIME];
/** Returns null when the URL is acceptable, otherwise a localized error. */
function validateUrl(raw: string, t: TFunction): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith("data:image/")) return null;
  if (v.startsWith("/")) return null; // project-relative asset
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return t("builder.imageSlot.urlProtocol");
    }
    return null;
  } catch {
    return t("builder.imageSlot.urlInvalid", { hint: t("builder.imageSlot.urlHint") });
  }
}

export function ImageSlot({
  label,
  icon,
  value,
  onChange,
  hint,
  maxSizeMb = 8,
  recommendedSize = null,
}: Props) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [natural, setNatural] = useState<PixelSize | null>(null);
  const tenantId = useRequiredTenant();
  const registerUpload = useServerFn(registerMediaUpload);
  const updateMeta = useServerFn(updateMediaMeta);
  const ensureFolder = useServerFn(createMediaFolder);

  const urlError = validateUrl(value, t);

  // Rekomendacja przyjeżdża z panelu jako NOWY obiekt przy każdym renderze
  // (liczy ją funkcja schematu z bieżącej treści), więc efekt zależy od dwóch
  // LICZB, nie od tożsamości obiektu - inaczej pomiar startowałby od nowa po
  // każdym naciśnięciu klawisza w sąsiednim polu.
  const recWidth = recommendedSize?.width ?? 0;
  const recHeight = recommendedSize?.height ?? 0;

  // Wymiary MIERZYMY, nie zgadujemy z nazwy pliku ani z nagłówka odpowiedzi:
  // obraz wgrany przez panel przechodzi przez transformacje storage, a URL
  // wklejony ręcznie może wskazywać cokolwiek. Pomiar idzie przez obiekt
  // `Image` poza drzewem DOM (bez renderu, bez layoutu), a każdy wynik jest
  // odcinany flagą `alive` - inaczej odpowiedź na poprzedni adres nadpisałaby
  // wymiary bieżącego obrazu po szybkiej zmianie pola.
  useEffect(() => {
    if (recWidth <= 0 || recHeight <= 0 || !value || urlError || typeof window === "undefined") {
      setNatural(null);
      return;
    }
    let alive = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (alive) setNatural({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    // Obraz nie do pobrania to sprawa POLA ADRESU (błąd wyżej), nie
    // rekomendacji - milczymy zamiast dokładać drugi komunikat o tym samym.
    probe.onerror = () => {
      if (alive) setNatural(null);
    };
    probe.src = value;
    return () => {
      alive = false;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [value, urlError, recWidth, recHeight]);

  const sizeNotice = (() => {
    if (!recommendedSize || !natural) return null;
    if (isImageTooSmall(natural, recommendedSize)) {
      return t("builder.imageSlot.sizeTooSmall", {
        width: natural.width,
        height: natural.height,
      });
    }
    if (isImageOversized(natural, recommendedSize)) {
      return t("builder.imageSlot.sizeOversized", {
        width: natural.width,
        height: natural.height,
      });
    }
    return null;
  })();

  const handleFile = async (file: File) => {
    setError(null);
    if (!ALLOWED_MIME.includes(file.type)) {
      setError(
        t("builder.imageSlot.badType", {
          type: file.type || t("builder.imageSlot.unknownType"),
        }),
      );
      return;
    }
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > maxSizeMb) {
      setError(t("builder.imageSlot.tooBig", { size: sizeMb.toFixed(1), max: maxSizeMb }));
      return;
    }
    setUploading(true);
    try {
      const { data: sess, error: authErr } = await supabase.auth.getSession();
      if (authErr) throw authErr;
      const uid = sess.session?.user?.id;
      if (!uid) throw new Error(t("builder.imageSlot.noUser"));
      // Wspólna ścieżka uploadu: walidacja -> storage -> rejestr w bibliotece
      // (audyt + tenant + MIME po stronie serwera), a przy odrzuconej
      // rejestracji OBOWIĄZKOWE sprzątnięcie obiektu ze storage.
      const uploaded = await uploadAndRegisterMedia({
        file,
        tenantId,
        userId: uid,
        registerMedia: registerUpload,
        allowedMime: ALLOWED_MIME,
        subfolder: "widgets",
      });
      if (!widgetsFolderEnsured) {
        await ensureFolder({ data: { path: WIDGETS_FOLDER } });
        widgetsFolderEnsured = true;
      }
      await updateMeta({ data: { mediaId: uploaded.mediaId, folderPath: WIDGETS_FOLDER } });
      onChange(uploaded.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("builder.imageSlot.unknownError");
      setError(t("builder.imageSlot.uploadError", { msg }));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          placeholder={t("builder.imageSlot.urlPlaceholder")}
          onChange={(e) => {
            setError(null);
            onChange(e.target.value);
          }}
          aria-invalid={urlError ? true : undefined}
          className={`h-8 text-xs flex-1 ${urlError ? "border-destructive focus-visible:ring-destructive" : ""}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              onChange("");
            }}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted text-muted-foreground"
            title={t("builder.common.delete")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <UploadArea
        size="sm"
        title={t("uploadArea.image.title")}
        description={t("uploadArea.image.description")}
        ctaLabel={t("builder.imageSlot.uploadFile")}
        busyLabel={t("builder.imageSlot.uploading")}
        busy={uploading}
        error={error}
        icons={[FileImage, Upload, Images]}
        accept={ALLOWED_MIME.join(",")}
        onFiles={(files) => void handleFile(files[0])}
        preview={
          value && !urlError ? (
            <img
              src={mediaRenderUrl(value)}
              alt=""
              className="max-h-24 max-w-full rounded-[6px] border border-border/60 object-contain"
            />
          ) : undefined
        }
        actions={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              setPickerOpen(true);
            }}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t("builder.imageSlot.mediaLibrary")}
          </Button>
        }
      />
      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(url) => {
          setError(null);
          onChange(url);
          setPickerOpen(false);
        }}
        title={t("builder.imageSlot.pickFromLibrary")}
      />
      {recommendedSize && (
        <div className="text-[10px] text-muted-foreground">
          {t("builder.imageSlot.recommendedSize", {
            width: recommendedSize.width,
            height: recommendedSize.height,
          })}
        </div>
      )}
      {sizeNotice && (
        <div className="flex items-start gap-1 text-[10px] text-amber-600 dark:text-amber-400">
          <AlertCircle className="w-3 h-3 mt-[1px] shrink-0" />
          <span>{sizeNotice}</span>
        </div>
      )}
      {hint && !urlError && !error && (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      )}
      {urlError && (
        <div className="flex items-start gap-1 text-[10px] text-destructive" role="alert">
          <AlertCircle className="w-3 h-3 mt-[1px] shrink-0" />
          <span>{urlError}</span>
        </div>
      )}
    </div>
  );
}

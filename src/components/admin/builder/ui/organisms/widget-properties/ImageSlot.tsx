// Organism: image upload slot with URL/file fallback, used by Image and Slider editors.
// Includes URL validation and rich error messages for upload failures
// (file size/type/storage). Errors render inline below the input.
import { useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Upload, X, AlertCircle, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import "@/lib/i18n-builder";

interface Props {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  /** Max upload size in MB (default 8). */
  maxSizeMb?: number;
}

// Obsługiwane formaty tła:
// - statyczne obrazy: JPG, PNG, WEBP, AVIF
// - animowane obrazy: GIF, animowany WEBP, APNG
// - wektor (może zawierać <animate>/SMIL/CSS): SVG
// - wideo w tle (autoplay, muted, loop): MP4 (H.264), WEBM (VP9/AV1)
// - Lottie/JSON renderowany jest osobnym playerem, nie przez <img>, więc tu nie jest wgrywany.
const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/apng",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
];
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

export function ImageSlot({ label, icon, value, onChange, hint, maxSizeMb = 8 }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const tenantId = useRequiredTenant();

  const urlError = validateUrl(value, t);

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
      const { data: userData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = userData.user?.id;
      if (!uid) throw new Error(t("builder.imageSlot.noUser"));
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${tenantId}/${uid}/widgets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      if (!data?.publicUrl) throw new Error(t("builder.imageSlot.noPublicUrl"));
      onChange(data.publicUrl);
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
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/apng,image/svg+xml,video/mp4,video/webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-border hover:border-brand hover:bg-muted/30 text-xs disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? t("builder.imageSlot.uploading") : t("builder.imageSlot.uploadFile")}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPickerOpen(true);
          }}
          className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border hover:border-brand hover:bg-muted/30 text-xs"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {t("builder.imageSlot.mediaLibrary")}
        </button>
      </div>
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
      {hint && !urlError && !error && (
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      )}
      {urlError && (
        <div className="flex items-start gap-1 text-[10px] text-destructive" role="alert">
          <AlertCircle className="w-3 h-3 mt-[1px] shrink-0" />
          <span>{urlError}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-1 text-[10px] text-destructive" role="alert">
          <AlertCircle className="w-3 h-3 mt-[1px] shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// Reusable image upload slot used by ThemeOptions and similar forms.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Image, Upload, X } from "@/lib/lucide-shim";
import { UploadArea } from "@/components/ui/upload-area";
import { matchesAccept } from "@/lib/media/acceptMatch";
import "@/lib/i18n-upload-area";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { brandedMediaUrl, mediaRenderUrl } from "@/lib/media/publicUrl";
import "@/lib/i18n-admin-panes-misc";

/** Limit dla slotu obrazu - ten sam, co w `lib/media/upload.ts` dla grafik. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ImageSlotTransform {
  /** Zwraca plik do wysyłki (null = odrzucony) plus komunikaty dla użytkownika. */
  (file: File): Promise<{ file: File | null; errors: string[]; warnings: string[] }>;
}

export function ImageSlot({
  label,
  icon,
  value,
  onChange,
  hint,
  bucket = "media",
  folder = "theme",
  previewMode = "auto",
  accept = "image/*",
  transformFile,
}: {
  label: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  bucket?: string;
  folder?: string;
  /** Background of the preview box. 'light' uses theme body bg, 'dark' uses dark body bg, 'auto' uses neutral muted. */
  previewMode?: "auto" | "light" | "dark";
  /** Filtr pickera plików (np. ograniczenie do JPG/PNG/WebP). */
  accept?: string;
  /** Walidacja + optymalizacja pliku przed uploadem (np. karta OG 1200x630). */
  transformFile?: ImageSlotTransform;
}) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const { tenantId } = useAuth();

  const handleFile = async (input: File) => {
    setError(null);
    setNotices([]);
    // WALIDACJA STOI PRZED SIECIĄ i dotyczy TAK SAMO pliku z okna wyboru, jak
    // i upuszczonego. `accept` filtruje wyłącznie okno systemowe, więc bez
    // tego sprawdzenia upuszczony PDF albo wideo szedł wprost do publicznego
    // bucketu i zapisywał w ustawieniach adres, którego nie da się wyświetlić
    // jako obrazu (zgłoszenie Codeksa P2 do tego pliku).
    if (!matchesAccept(input, accept)) {
      setError(t("uploadArea.badType", { name: input.name }));
      return;
    }
    if (input.size > MAX_IMAGE_BYTES) {
      setError(
        t("uploadArea.tooLarge", {
          name: input.name,
          max: Math.round(MAX_IMAGE_BYTES / (1024 * 1024)),
        }),
      );
      return;
    }
    if (!tenantId) {
      setError(t("adminPanesMisc.imageSlot.uploadError"));
      return;
    }
    let file = input;
    if (transformFile) {
      const result = await transformFile(input);
      setNotices(result.warnings);
      if (!result.file) {
        setError(result.errors.join(" ") || t("adminPanesMisc.imageSlot.uploadError"));
        return;
      }
      file = result.file;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth
        .getSession()
        .then((r) => ({ data: { user: r.data.session?.user ?? null } }));
      const uid = userData.user?.id ?? "anon";
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${tenantId}/${uid}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(brandedMediaUrl(data.publicUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("adminPanesMisc.imageSlot.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <UploadArea
        size="sm"
        title={
          <span className="inline-flex items-center justify-center gap-1.5">
            {icon}
            {label}
          </span>
        }
        description={t("uploadArea.image.description")}
        ctaLabel={t("adminPanesMisc.imageSlot.uploadBtn")}
        busyLabel={t("adminPanesMisc.imageSlot.uploadingBtn")}
        busy={uploading}
        error={error}
        icons={[Image, Upload]}
        accept={accept}
        onFiles={(files) => void handleFile(files[0])}
        onRejectedFiles={(files) => setError(t("uploadArea.badType", { name: files[0].name }))}
        preview={
          value ? (
            <div
              className={`w-full rounded-md border border-border p-2 flex items-center justify-center min-h-[80px] ${previewMode === "auto" ? "bg-muted/30" : ""}`}
              style={{
                background:
                  previewMode === "dark"
                    ? "#141414"
                    : previewMode === "light"
                      ? "#f8f6f4"
                      : undefined,
              }}
              data-preview-mode={previewMode}
            >
              <img
                src={mediaRenderUrl(value)}
                alt=""
                className="max-h-24 max-w-full object-contain"
              />
            </div>
          ) : undefined
        }
        actions={
          value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted text-muted-foreground"
              title={t("adminPanesMisc.imageSlot.remove")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : undefined
        }
        hint={
          <>
            {hint && <div>{hint}</div>}
            {notices.map((n) => (
              <div key={n} role="status">
                {n}
              </div>
            ))}
          </>
        }
        footer={
          <Input
            value={brandedMediaUrl(value)}
            placeholder={t("adminPanesMisc.imageSlot.urlPlaceholder")}
            onChange={(e) => onChange(brandedMediaUrl(e.target.value))}
            className="h-8 text-xs w-full"
            aria-label={t("adminPanesMisc.imageSlot.urlPlaceholder")}
          />
        }
      />
    </div>
  );
}

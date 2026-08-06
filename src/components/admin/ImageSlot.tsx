// Reusable image upload slot used by ThemeOptions and similar forms.
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Upload, X } from "@/lib/lucide-shim";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-panes-misc";

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const { tenantId } = useAuth();

  const handleFile = async (input: File) => {
    setError(null);
    setNotices([]);
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
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("adminPanesMisc.imageSlot.uploadError"));
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
      {value && (
        <div
          className={`rounded-md border border-border p-2 flex items-center justify-center min-h-[80px] ${previewMode === "auto" ? "bg-muted/30" : ""}`}
          style={{
            background:
              previewMode === "dark" ? "#141414" : previewMode === "light" ? "#f8f6f4" : undefined,
          }}
          data-preview-mode={previewMode}
        >
          <img src={value} alt="" className="max-h-24 max-w-full object-contain" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={value}
          placeholder={t("adminPanesMisc.imageSlot.urlPlaceholder")}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted text-muted-foreground"
            title={t("adminPanesMisc.imageSlot.remove")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-border hover:border-brand hover:bg-muted/30 text-xs disabled:opacity-50"
      >
        <Upload className="w-3.5 h-3.5" />
        {uploading
          ? t("adminPanesMisc.imageSlot.uploadingBtn")
          : t("adminPanesMisc.imageSlot.uploadBtn")}
      </button>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      {notices.map((n) => (
        <div key={n} className="text-[10px] text-muted-foreground" role="status">
          {n}
        </div>
      ))}
      {error && (
        <div className="text-[10px] text-destructive" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

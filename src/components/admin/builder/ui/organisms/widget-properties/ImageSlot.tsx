// Organism: image upload slot with URL/file fallback, used by Image and Slider editors.
// Includes URL validation and rich error messages for upload failures
// (file size/type/storage). Errors render inline below the input.
import { useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Upload, X, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  /** Max upload size in MB (default 8). */
  maxSizeMb?: number;
}

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
];
const URL_HINT = "Podaj pełny adres https://… lub wgraj plik z dysku.";

/** Returns null when the URL is acceptable, otherwise a localized error. */
function validateUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.startsWith("data:image/")) return null;
  if (v.startsWith("/")) return null; // project-relative asset
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return "Adres musi zaczynać się od https:// (lub http://).";
    }
    return null;
  } catch {
    return "Nieprawidłowy adres URL miniatury. " + URL_HINT;
  }
}

export function ImageSlot({ label, icon, value, onChange, hint, maxSizeMb = 8 }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tenantId = useRequiredTenant();

  const urlError = validateUrl(value);

  const handleFile = async (file: File) => {
    setError(null);
    if (!ALLOWED_MIME.includes(file.type)) {
      setError(
        `Niedozwolony typ pliku (${file.type || "nieznany"}). Dozwolone: JPG, PNG, WEBP, AVIF, GIF, SVG.`,
      );
      return;
    }
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > maxSizeMb) {
      setError(`Plik jest za duży (${sizeMb.toFixed(1)} MB). Maksymalnie ${maxSizeMb} MB.`);
      return;
    }
    setUploading(true);
    try {
      const { data: userData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const uid = userData.user?.id;
      if (!uid) throw new Error("Brak zalogowanego użytkownika - zaloguj się ponownie.");
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${tenantId}/${uid}/widgets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("media").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      if (!data?.publicUrl) throw new Error("Nie udało się pobrać publicznego adresu pliku.");
      onChange(data.publicUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Nieznany błąd uploadu.";
      setError(`Błąd uploadu: ${msg}`);
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
          placeholder="https://... lub wgraj plik"
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
            title="Usuń"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
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
        {uploading ? "Wgrywam…" : "Wgraj obrazek"}
      </button>
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

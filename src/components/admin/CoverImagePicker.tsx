// Cover / featured image picker with three input modes:
//  1) Upload from local device (stored in the tenant's `media` bucket)
//  2) Pick from the Media Library
//  3) Paste an external URL
//
// Uses the same storage layout as ImageSlot so uploads land in the tenant's
// media bucket and remain accessible via the standard public URL.
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, Image as ImageIcon, Link as LinkIcon, X, Monitor, Tablet, Smartphone } from "@/lib/lucide-shim";

type DevicePreview = "desktop" | "tablet" | "mobile";

const DEVICE_FRAMES: Record<DevicePreview, { aspect: string; maxWidth: string; label: string }> = {
  desktop: { aspect: "16 / 9", maxWidth: "100%", label: "Desktop" },
  tablet: { aspect: "4 / 3", maxWidth: "62%", label: "Tablet" },
  mobile: { aspect: "9 / 16", maxWidth: "34%", label: "Mobile" },
};
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { useTranslation } from "react-i18next";

interface Props {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  bucket?: string;
  folder?: string;
}

export function CoverImagePicker({
  label,
  value,
  onChange,
  bucket = "media",
  folder = "posts",
}: Props) {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState(value ?? "");
  const [device, setDevice] = useState<DevicePreview>("desktop");

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? "anon";
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${tenantId}/${uid}/${folder}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
      setUrlDraft(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload error");
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    onChange("");
    setUrlDraft("");
  };

  const commitUrl = () => {
    const v = urlDraft.trim();
    if (v !== value) onChange(v);
  };

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}

      {value ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
              {(Object.keys(DEVICE_FRAMES) as DevicePreview[]).map((d) => {
                const Icon = d === "desktop" ? Monitor : d === "tablet" ? Tablet : Smartphone;
                const active = device === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDevice(d)}
                    aria-pressed={active}
                    aria-label={DEVICE_FRAMES[d].label}
                    title={DEVICE_FRAMES[d].label}
                    className={`h-6 w-7 inline-flex items-center justify-center rounded-sm transition-colors ${
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                );
              })}
            </div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {DEVICE_FRAMES[device].label} - {DEVICE_FRAMES[device].aspect.replace(" / ", ":")}
            </span>
          </div>
          <div className="relative rounded-md border border-border bg-[linear-gradient(45deg,hsl(var(--muted)/0.6)_25%,transparent_25%,transparent_75%,hsl(var(--muted)/0.6)_75%),linear-gradient(45deg,hsl(var(--muted)/0.6)_25%,transparent_25%,transparent_75%,hsl(var(--muted)/0.6)_75%)] [background-position:0_0,6px_6px] [background-size:12px_12px] p-3 flex justify-center">
            <div
              className="relative w-full transition-all duration-300 ease-out rounded-md overflow-hidden border border-border/80 shadow-sm bg-background"
              style={{
                maxWidth: DEVICE_FRAMES[device].maxWidth,
                aspectRatio: DEVICE_FRAMES[device].aspect,
              }}
            >
              <img src={value} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <button
                type="button"
                onClick={clear}
                className="absolute top-1.5 right-1.5 h-6 w-6 inline-flex items-center justify-center rounded-md bg-background/90 border border-border hover:bg-destructive hover:text-destructive-foreground"
                title={t("admin.remove", { defaultValue: "Usuń" })}
                aria-label={t("admin.remove", { defaultValue: "Usuń" })}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border h-24 flex items-center justify-center text-[11px] text-muted-foreground">
          {t("admin.posts.coverEmpty", { defaultValue: "Brak obrazka wyróżniającego" })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="h-8 text-xs"
        >
          <Upload className="w-3.5 h-3.5 mr-1" />
          {uploading
            ? t("admin.uploading", { defaultValue: "Wgrywam…" })
            : t("admin.posts.coverUpload", { defaultValue: "Wgraj plik" })}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPickerOpen(true)}
          className="h-8 text-xs"
        >
          <ImageIcon className="w-3.5 h-3.5 mr-1" />
          {t("admin.posts.coverLibrary", { defaultValue: "Biblioteka" })}
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Input
          type="url"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={commitUrl}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitUrl();
            }
          }}
          placeholder="https://..."
          className="h-8 text-xs"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      {error && <div className="text-[10px] text-destructive">{error}</div>}

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(url) => {
          onChange(url);
          setUrlDraft(url);
          setPickerOpen(false);
        }}
        accept="image"
        title={t("admin.posts.coverLibraryTitle", {
          defaultValue: "Wybierz obrazek wyróżniający",
        })}
      />
    </div>
  );
}

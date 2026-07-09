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
import { Upload, Image as ImageIcon, Link as LinkIcon, X } from "@/lib/lucide-shim";
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
        <div className="relative rounded-md border border-border overflow-hidden bg-muted/30">
          <img src={value} alt="" className="w-full h-32 object-cover" />
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

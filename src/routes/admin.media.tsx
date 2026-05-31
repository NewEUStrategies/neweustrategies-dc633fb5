import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, Copy, Check } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { registerMediaUpload, deleteMedia } from "@/lib/media.functions";

export const Route = createFileRoute("/admin/media")({
  component: Media,
});

interface MediaItem {
  id: string;
  storage_path: string;
  public_url: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
}

function Media() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const tenantId = useRequiredTenant();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const registerUpload = useServerFn(registerMediaUpload);
  const removeMedia = useServerFn(deleteMedia);

  const { data } = useQuery({
    queryKey: ["media", tenantId],
    queryFn: async (): Promise<MediaItem[]> => {
      const { data, error } = await supabase.from("media").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !user) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${tenantId}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
        await registerUpload({
          data: {
            storagePath: path,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            publicUrl: urlData.publicUrl,
          },
        });
      }
      toast.success(t("admin.media.uploaded"));
      qc.invalidateQueries({ queryKey: ["media"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const del = async (item: MediaItem) => {
    if (!confirm(t("admin.confirmDelete"))) return;
    try {
      await removeMedia({ data: { mediaId: item.id } });
      qc.invalidateQueries({ queryKey: ["media"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl font-bold">{t("admin.nav.media")}</h1>
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload className="w-4 h-4 mr-2" /> {busy ? "..." : t("admin.media.upload")}
        </Button>
        <input ref={inputRef} type="file" multiple accept="image/*" hidden onChange={onUpload} />
      </div>

      {!data?.length ? (
        <div className="p-12 text-center text-muted-foreground bg-card border border-border rounded-lg">{t("admin.empty")}</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {data.map((m) => (
            <div key={m.id} className="bg-card border border-border rounded-lg overflow-hidden group">
              <div className="aspect-square bg-muted/30">
                {m.mime_type?.startsWith("image/") ? (
                  <img src={m.public_url} alt={m.filename} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">{m.mime_type}</div>
                )}
              </div>
              <div className="p-2 text-xs">
                <div className="truncate font-medium" title={m.filename}>{m.filename}</div>
                <div className="text-muted-foreground">{((m.size_bytes ?? 0) / 1024).toFixed(0)} KB</div>
                <div className="flex justify-between mt-2">
                  <button type="button" onClick={() => copy(m.public_url)} aria-label="Copy URL" className="p-1 hover:text-brand">
                    {copied === m.public_url ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button type="button" onClick={() => del(m)} aria-label={t("admin.delete")} className="p-1 hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

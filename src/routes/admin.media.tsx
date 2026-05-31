import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/media")({
  component: Media,
});

function Media() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["media"],
    queryFn: async () => (await supabase.from("media").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !user) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop();
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
        const { error } = await supabase.from("media").insert({
          uploader_id: user.id,
          storage_path: path,
          public_url: urlData.publicUrl,
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        });
        if (error) throw error;
      }
      toast.success(t("admin.media.uploaded"));
      qc.invalidateQueries({ queryKey: ["media"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const del = async (item: any) => {
    if (!confirm(t("admin.confirmDelete"))) return;
    await supabase.storage.from("media").remove([item.storage_path]);
    await supabase.from("media").delete().eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["media"] });
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
          <Upload className="w-4 h-4 mr-2" /> {busy ? "…" : t("admin.media.upload")}
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
                  <button onClick={() => copy(m.public_url)} className="p-1 hover:text-brand">
                    {copied === m.public_url ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button onClick={() => del(m)} className="p-1 hover:text-destructive">
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

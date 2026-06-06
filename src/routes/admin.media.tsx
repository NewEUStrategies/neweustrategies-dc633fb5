import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, useMemo, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, Copy, Check, Settings as SettingsIcon, Search, X, Link as LinkIcon } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { registerMediaUpload, deleteMedia, getMediaUsage, type MediaUsageItem } from "@/lib/media.functions";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MediaPreviewDialog, type PreviewableMedia } from "@/components/MediaPreviewDialog";
import { useTenantAuthors, authorLabel } from "@/components/admin/hooks/useTenantAuthors";

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
  uploader_id: string | null;
  created_at: string;
}

type TypeFilter = "all" | "image" | "video" | "audio" | "other";

function classifyType(mime: string | null): TypeFilter {
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

function Media() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const tenantId = useRequiredTenant();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewableMedia | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const registerUpload = useServerFn(registerMediaUpload);
  const removeMedia = useServerFn(deleteMedia);
  const fetchUsage = useServerFn(getMediaUsage);
  const [usageFor, setUsageFor] = useState<MediaItem | null>(null);

  const authorsQ = useTenantAuthors(tenantId);
  const authorMap = useMemo(
    () => new Map((authorsQ.data ?? []).map((a) => [a.id, a])),
    [authorsQ.data],
  );

  const { data } = useQuery({
    queryKey: ["media", tenantId],
    queryFn: async (): Promise<MediaItem[]> => {
      const { data, error } = await supabase
        .from("media")
        .select("id, storage_path, public_url, filename, mime_type, size_bytes, uploader_id, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((m) => {
      if (q && !m.filename.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && classifyType(m.mime_type) !== typeFilter) return false;
      if (authorFilter !== "all" && m.uploader_id !== authorFilter) return false;
      return true;
    });
  }, [data, search, typeFilter, authorFilter]);

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

  const isFiltered = !!search || typeFilter !== "all" || authorFilter !== "all";
  const clearFilters = () => { setSearch(""); setTypeFilter("all"); setAuthorFilter("all"); };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("admin.nav.media")}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{filtered.length}{data && data.length !== filtered.length ? ` / ${data.length}` : ""}</p>
        </div>
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload className="w-4 h-4 mr-1.5" /> {busy ? "…" : t("admin.media.upload")}
        </Button>
        <input ref={inputRef} type="file" multiple hidden onChange={onUpload} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.list.searchMedia", { defaultValue: "Szukaj plików…" })} className="pl-7 h-8 text-xs" />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.list.media.allTypes", { defaultValue: "Wszystkie typy" })}</SelectItem>
            <SelectItem value="image">{t("admin.list.media.images", { defaultValue: "Obrazy" })}</SelectItem>
            <SelectItem value="video">{t("admin.list.media.videos", { defaultValue: "Wideo" })}</SelectItem>
            <SelectItem value="audio">{t("admin.list.media.audio", { defaultValue: "Audio" })}</SelectItem>
            <SelectItem value="other">{t("admin.list.media.other", { defaultValue: "Inne" })}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={authorFilter} onValueChange={setAuthorFilter}>
          <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.list.author.all", { defaultValue: "Wszyscy autorzy" })}</SelectItem>
            {(authorsQ.data ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.display_name || a.email || a.id.slice(0, 6)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
            <X className="w-3.5 h-3.5 mr-1" /> {t("admin.list.clear", { defaultValue: "Wyczyść" })}
          </Button>
        )}
      </div>

      {!filtered.length ? (
        <div className="p-10 text-center text-muted-foreground text-sm bg-card border border-border rounded-lg">
          {data?.length ? t("admin.list.noResults", { defaultValue: "Brak wyników dla filtrów" }) : t("admin.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {filtered.map((m) => {
            const author = m.uploader_id ? authorMap.get(m.uploader_id) : null;
            return (
              <div key={m.id} className="bg-card border border-border rounded-md overflow-hidden group">
                <button
                  type="button"
                  onClick={() => setPreview(m)}
                  className="block w-full aspect-square bg-muted/30 hover:bg-muted/50 transition-colors"
                  aria-label={`${t("admin.list.preview", { defaultValue: "Podgląd" })} ${m.filename}`}
                >
                  {m.mime_type?.startsWith("image/") ? (
                    <img src={m.public_url} alt={m.filename} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-[10px] text-muted-foreground gap-1 p-1 text-center">
                      <span className="text-xl">📄</span>
                      <span className="truncate w-full">{m.mime_type || m.filename.split('.').pop()?.toUpperCase()}</span>
                    </div>
                  )}
                </button>
                <div className="p-1.5 text-[10px]">
                  <div className="truncate font-medium" title={m.filename}>{m.filename}</div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{((m.size_bytes ?? 0) / 1024).toFixed(0)} KB</span>
                    <span className="truncate ml-1" title={authorLabel(author)}>{authorLabel(author)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <button type="button" onClick={() => copy(m.public_url)} aria-label="Copy URL" className="p-0.5 hover:text-brand">
                      {copied === m.public_url ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button" onClick={() => setUsageFor(m)} aria-label="Użycia" title="Pokaż użycia" className="p-0.5 hover:text-brand">
                      <LinkIcon className="w-3.5 h-3.5" />
                    </button>
                    <Dialog>
                      <DialogTrigger asChild>
                        <button type="button" aria-label="Dostęp" className="p-0.5 hover:text-brand">
                          <SettingsIcon className="w-3.5 h-3.5" />
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle className="truncate">{m.filename}</DialogTitle></DialogHeader>
                        <AccessSettingsPane entityType="media" entityId={m.id} />
                      </DialogContent>
                    </Dialog>
                    <button type="button" onClick={() => del(m)} aria-label={t("admin.delete")} className="p-0.5 hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <MediaPreviewDialog item={preview} open={!!preview} onOpenChange={(o) => !o && setPreview(null)} gated={false} />
      <MediaUsageDialog item={usageFor} onClose={() => setUsageFor(null)} fetchUsage={fetchUsage} />
    </div>
  );
}

function MediaUsageDialog({
  item, onClose, fetchUsage,
}: {
  item: MediaItem | null;
  onClose: () => void;
  fetchUsage: (args: { data: { mediaId: string } }) => Promise<{ items: MediaUsageItem[] }>;
}) {
  const open = !!item;
  const { data, isLoading, error } = useQuery({
    queryKey: ["media-usage", item?.id],
    queryFn: () => fetchUsage({ data: { mediaId: item!.id } }),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate">Użycia: {item?.filename}</DialogTitle>
        </DialogHeader>
        <div className="text-xs">
          {isLoading && <p className="text-muted-foreground">Sprawdzam użycia…</p>}
          {error && <p className="text-destructive">Błąd: {error instanceof Error ? error.message : String(error)}</p>}
          {!isLoading && !error && (data?.items.length ?? 0) === 0 && (
            <p className="text-muted-foreground">Ten materiał nie jest jeszcze używany w żadnym poście ani stronie.</p>
          )}
          {!!data?.items.length && (
            <ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
              {data.items.map((it) => (
                <li key={`${it.kind}-${it.id}`} className="p-2 flex items-center justify-between gap-3 hover:bg-muted/40">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{it.title}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <span className="uppercase">{it.kind === "post" ? "Post" : "Strona"}</span>
                      <span>·</span>
                      <span className="truncate">/{it.slug}</span>
                      <span>·</span>
                      <span className="truncate">{it.where.join(", ")}</span>
                    </div>
                  </div>
                  <Link
                    to={it.kind === "post" ? "/admin/posts/$slug" : "/admin/pages/$slug"}
                    params={{ slug: it.slug }}
                    onClick={onClose}
                    className="shrink-0 inline-flex items-center gap-1 text-brand hover:underline"
                  >
                    Edytuj <LinkIcon className="w-3 h-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

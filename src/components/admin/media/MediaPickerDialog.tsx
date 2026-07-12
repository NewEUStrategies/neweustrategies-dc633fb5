/**
 * MediaPickerDialog - browse images stored in the tenant's Media Library
 * and pick one. Lightweight modal used by newsletter/page/post builders to
 * insert existing assets without leaving the current editor.
 * Supports uploading new files directly from the user's local disk.
 */
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { registerMediaUpload, updateMediaMeta } from "@/lib/media.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Check, X, Folder, Upload, Loader2 } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { toastError } from "@/lib/toastError";

interface PickerRow {
  id: string;
  public_url: string;
  filename: string;
  mime_type: string | null;
  folder_path: string;
  created_at: string;
  alt_text: string | null;
}

export function MediaPickerDialog({
  open,
  onOpenChange,
  onPick,
  accept = "image",
  title,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (url: string) => void;
  accept?: "image" | "audio" | "all";
  title?: string;
}) {
  const tenantId = useRequiredTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  const registerUpload = useServerFn(registerMediaUpload);
  const updateMeta = useServerFn(updateMediaMeta);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("all");
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [altDraft, setAltDraft] = useState("");
  const [savingAlt, setSavingAlt] = useState(false);

  const acceptAttr = accept === "image" ? "image/*" : accept === "audio" ? "audio/*" : undefined;

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      if (!user) {
        toast.error("Musisz być zalogowany");
        return;
      }
      setUploading(true);
      let lastUrl: string | null = null;
      try {
        for (const file of list) {
          if (accept === "image" && !file.type.startsWith("image/")) {
            toast.error(`Pominięto ${file.name} - to nie jest obraz`);
            continue;
          }
          if (accept === "audio" && !file.type.startsWith("audio/")) {
            toast.error(`Pominięto ${file.name} - to nie jest plik audio`);
            continue;
          }
          const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
          const path = `${tenantId}/${user.id}/${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("media")
            .upload(path, file, { contentType: file.type });
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
          lastUrl = urlData.publicUrl;
        }
        toast.success(list.length > 1 ? `Wgrano ${list.length} plików` : "Wgrano plik");
        await qc.invalidateQueries({ queryKey: ["media-picker", tenantId, accept] });
        if (lastUrl) setPickedUrl(lastUrl);
      } catch (err) {
        toastError(err, "upload");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [accept, qc, registerUpload, tenantId, user],
  );

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void handleFiles(e.target.files);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
  };

  const { data } = useQuery({
    queryKey: ["media-picker", tenantId, accept],
    enabled: open,
    queryFn: async (): Promise<PickerRow[]> => {
      let query = supabase
        .from("media")
        .select("id, public_url, filename, mime_type, folder_path, created_at, alt_text")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (accept === "image") query = query.like("mime_type", "image/%");
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const folders = useMemo(() => {
    const s = new Set<string>();
    for (const r of data ?? []) s.add(r.folder_path || "/");
    return Array.from(s).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((m) => {
      if (folder !== "all" && (m.folder_path || "/") !== folder) return false;
      if (needle && !m.filename.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, folder]);

  const picked = useMemo(
    () => (data ?? []).find((m) => m.public_url === pickedUrl) ?? null,
    [data, pickedUrl],
  );
  const pickedIsImage = !!picked?.mime_type?.startsWith("image/");
  const altDirty = picked ? (picked.alt_text ?? "") !== altDraft : false;

  const handlePickRow = (row: PickerRow) => {
    setPickedUrl(row.public_url);
    setAltDraft(row.alt_text ?? "");
  };

  const saveAlt = async () => {
    if (!picked) return;
    setSavingAlt(true);
    try {
      await updateMeta({ data: { mediaId: picked.id, altText: altDraft.trim() } });
      await qc.invalidateQueries({ queryKey: ["media-picker"] });
      toast.success("Zapisano alt");
    } catch (err) {
      toastError(err, "save");
    } finally {
      setSavingAlt(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title ?? "Biblioteka mediów"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px] focus-within:[&_.mp-icon]:text-primary focus-within:[&_.mp-divider]:bg-primary/40">
            <Search
              className="mp-icon pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70 transition-colors"
              aria-hidden
            />
            <span
              aria-hidden
              className="mp-divider pointer-events-none absolute left-[26px] top-1/2 -translate-y-1/2 h-3.5 w-px bg-border transition-colors"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Szukaj plików..."
              className="pl-8 h-8 text-xs placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="h-8 text-xs bg-background border border-border rounded px-2"
          >
            <option value="all">Wszystkie foldery</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="hidden"
            onChange={onInputChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Wgrywanie…
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 mr-1" /> Wgraj z dysku
              </>
            )}
          </Button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative max-h-[60vh] overflow-y-auto -mx-2 px-2 rounded-md transition-colors ${
            dragOver ? "outline outline-2 outline-dashed outline-primary/60 bg-primary/5" : ""
          }`}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm font-medium text-primary bg-background/70 backdrop-blur-sm rounded-md">
              <Upload className="w-4 h-4 mr-2" /> Upuść pliki, aby wgrać
            </div>
          )}
          {!filtered.length ? (
            <div className="text-center text-muted-foreground text-sm py-10">
              {uploading
                ? "Trwa wgrywanie…"
                : "Brak pasujących plików. Przeciągnij pliki tutaj lub użyj przycisku „Wgraj z dysku”."}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {filtered.map((m) => {
                const selected = pickedUrl === m.public_url;
                const isImg = m.mime_type?.startsWith("image/");
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handlePickRow(m)}
                    onDoubleClick={() => {
                      onPick(m.public_url);
                      onOpenChange(false);
                    }}
                    className={`relative aspect-square rounded-md border overflow-hidden text-left transition-colors ${
                      selected
                        ? "border-brand ring-2 ring-brand/40"
                        : "border-border hover:border-brand/50"
                    }`}
                    title={`${m.filename}\n${m.folder_path}`}
                  >
                    {isImg ? (
                      <img
                        src={m.public_url}
                        alt={m.filename}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center text-2xl">
                        📄
                      </div>
                    )}
                    {selected && (
                      <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-brand text-primary-foreground flex items-center justify-center shadow">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[10px] text-white flex items-center gap-1">
                      {m.folder_path && m.folder_path !== "/" && (
                        <Folder className="w-2.5 h-2.5 shrink-0" />
                      )}
                      <span className="truncate">{m.filename}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {picked && pickedIsImage && (
          <div className="border-t border-border pt-3 space-y-2">
            <label htmlFor="picker-alt" className="block text-xs text-muted-foreground font-medium">
              Tekst alternatywny (alt) — dla dostępności i SEO
            </label>
            <div className="flex items-start gap-2">
              <textarea
                id="picker-alt"
                value={altDraft}
                onChange={(e) => setAltDraft(e.target.value.slice(0, 500))}
                rows={2}
                placeholder="Opisz obraz w 1-2 zdaniach"
                className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!altDirty || savingAlt}
                onClick={saveAlt}
              >
                {savingAlt ? "Zapisywanie…" : "Zapisz alt"}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">{altDraft.length}/500</div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-3.5 h-3.5 mr-1" /> Anuluj
          </Button>
          <Button
            disabled={!pickedUrl}
            onClick={() => {
              if (pickedUrl) {
                onPick(pickedUrl);
                onOpenChange(false);
              }
            }}
          >
            <Check className="w-3.5 h-3.5 mr-1" /> Wstaw
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

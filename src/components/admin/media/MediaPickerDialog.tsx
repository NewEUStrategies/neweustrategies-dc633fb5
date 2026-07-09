/**
 * MediaPickerDialog - browse images stored in the tenant's Media Library
 * and pick one. Lightweight modal used by newsletter/page/post builders to
 * insert existing assets without leaving the current editor.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRequiredTenant } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Check, X, Folder } from "@/lib/lucide-shim";

interface PickerRow {
  id: string;
  public_url: string;
  filename: string;
  mime_type: string | null;
  folder_path: string;
  created_at: string;
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
  accept?: "image" | "all";
  title?: string;
}) {
  const tenantId = useRequiredTenant();
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("all");
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["media-picker", tenantId, accept],
    enabled: open,
    queryFn: async (): Promise<PickerRow[]> => {
      let query = supabase
        .from("media")
        .select("id, public_url, filename, mime_type, folder_path, created_at")
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
        </div>

        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
          {!filtered.length ? (
            <div className="text-center text-muted-foreground text-sm py-10">
              Brak pasujących plików.
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
                    onClick={() => setPickedUrl(m.public_url)}
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

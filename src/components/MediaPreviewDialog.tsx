import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "@/lib/lucide-shim";
import { useContentAccess } from "@/hooks/useContentAccess";
import { Paywall } from "@/components/Paywall";

export interface PreviewableMedia {
  id: string;
  filename: string;
  public_url: string;
  mime_type: string | null;
  size_bytes?: number | null;
}

interface Props {
  item: PreviewableMedia | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, respect paywall rules for this media before showing the file/download */
  gated?: boolean;
}

export function MediaPreviewDialog({ item, open, onOpenChange, gated = true }: Props) {
  const { hasAccess, loading, rule } = useContentAccess(gated ? "media" : null, item?.id ?? null);

  // Pre-fetch as blob for safer downloads with the original filename
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (!item) return;
    setDownloading(true);
    try {
      const res = await fetch(item.public_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(item.public_url, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (!open) setDownloading(false);
  }, [open]);

  if (!item) return null;

  const mime = item.mime_type ?? "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || item.filename.toLowerCase().endsWith(".pdf");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isText = mime.startsWith("text/") || /\.(txt|md|csv|json|xml|log)$/i.test(item.filename);

  const blocked = gated && !loading && !hasAccess;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b border-border flex-row items-center justify-between space-y-0">
          <DialogTitle className="truncate pr-4">{item.filename}</DialogTitle>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {mime || "plik"}
              {item.size_bytes ? ` · ${(item.size_bytes / 1024).toFixed(0)} KB` : ""}
            </span>
            {!blocked && (
              <Button size="sm" onClick={download} disabled={downloading}>
                <Download className="w-4 h-4 mr-2" />
                {downloading ? "..." : "Pobierz"}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto bg-muted/30">
          {blocked ? (
            <div className="p-6">
              <Paywall entityType="media" entityId={item.id} rule={rule ?? undefined} title={item.filename} />
            </div>
          ) : loading && gated ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Sprawdzanie dostępu…</div>
          ) : isImage ? (
            <div className="h-full w-full flex items-center justify-center p-4">
              <img src={item.public_url} alt={item.filename} className="max-h-full max-w-full object-contain" />
            </div>
          ) : isPdf ? (
            <iframe
              src={`${item.public_url}#toolbar=1&navpanes=0`}
              title={item.filename}
              className="w-full h-full border-0 bg-white"
            />
          ) : isVideo ? (
            <div className="h-full w-full flex items-center justify-center bg-black">
              <video src={item.public_url} controls className="max-h-full max-w-full" />
            </div>
          ) : isAudio ? (
            <div className="h-full flex items-center justify-center p-8">
              <audio src={item.public_url} controls className="w-full max-w-xl" />
            </div>
          ) : isText ? (
            <iframe src={item.public_url} title={item.filename} className="w-full h-full border-0 bg-white" />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8 text-muted-foreground">
              <FileText className="w-12 h-12 opacity-60" />
              <p className="text-sm">Podgląd nie jest dostępny dla tego typu pliku.</p>
              <Button onClick={download} disabled={downloading}>
                <Download className="w-4 h-4 mr-2" /> Pobierz plik
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

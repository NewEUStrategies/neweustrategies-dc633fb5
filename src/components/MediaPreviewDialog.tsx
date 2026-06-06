import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Link as LinkIcon } from "@/lib/lucide-shim";
import { useContentAccess, type AccessEntityType } from "@/hooks/useContentAccess";
import { Paywall } from "@/components/Paywall";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMediaUsage } from "@/lib/media.functions";
import { Link } from "@tanstack/react-router";

const DownloadIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
  </svg>
);

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
  /** When true, show the "Used in" panel with links to CMS edit pages (admin only) */
  showUsage?: boolean;
}

export function MediaPreviewDialog({ item, open, onOpenChange, gated = true, showUsage = false }: Props) {
  const { i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "pl") as "pl" | "en";
  // Hook needs a stable entity type; pass id only when gated + open
  const entityId = gated && open && item ? item.id : null;
  const { hasAccess, loading, rule } = useContentAccess("media" as AccessEntityType, entityId);

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
                <DownloadIcon className="w-4 h-4 mr-2" />
                {downloading ? "..." : lang === "pl" ? "Pobierz" : "Download"}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto bg-muted/30">
          {blocked && rule ? (
            <div className="p-6">
              <Paywall rule={rule} lang={lang} fallbackText={null} />
            </div>
          ) : loading && gated ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {lang === "pl" ? "Sprawdzanie dostępu…" : "Checking access…"}
            </div>
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
              <p className="text-sm">
                {lang === "pl" ? "Podgląd nie jest dostępny dla tego typu pliku." : "Preview not available for this file type."}
              </p>
              <Button onClick={download} disabled={downloading}>
                <DownloadIcon className="w-4 h-4 mr-2" /> {lang === "pl" ? "Pobierz plik" : "Download file"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

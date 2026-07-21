import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRequiredTenant } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, X, Download } from "@/lib/lucide-shim";
import { getMediaUsage } from "@/lib/media.functions";
import type { MediaRow } from "../types";
import { extOf } from "../lib/mediaFormat";
import { resolvePreviewKind } from "../lib/mediaKind";
import { MediaUsageList } from "../molecules/MediaUsageList";

interface MediaPreviewDialogProps {
  file: MediaRow | null;
  onClose: () => void;
}

/**
 * Organism: full-screen asset preview with the correct viewer per type and a
 * collapsible "used in" panel. The usage query key is namespaced by tenant so
 * cached results can never bleed across workspaces.
 */
export function MediaPreviewDialog({ file, onClose }: MediaPreviewDialogProps) {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const mime = file?.mime_type ?? "";
  const url = file?.public_url ?? "";
  const ext = file ? extOf(file.filename).toLowerCase() : "";
  const kind = resolvePreviewKind(file?.mime_type, file?.filename);

  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => {
    if (!file) setInfoOpen(false);
  }, [file]);

  const fetchUsage = useServerFn(getMediaUsage);
  const usageQ = useQuery({
    queryKey: ["media-usage", tenantId, file?.id],
    queryFn: () => fetchUsage({ data: { mediaId: file!.id } }),
    enabled: !!file && infoOpen,
  });

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0 flex-row items-center justify-between gap-3 space-y-0">
          <DialogTitle className="truncate text-sm min-w-0">{file?.filename ?? ""}</DialogTitle>
          <Button
            type="button"
            size="sm"
            variant={infoOpen ? "default" : "outline"}
            onClick={() => setInfoOpen((v) => !v)}
            className="shrink-0 mr-8"
            title={t("admin.media.usageInfo", { defaultValue: "Gdzie wykorzystywane" })}
            aria-label={t("admin.media.usageInfo", { defaultValue: "Gdzie wykorzystywane" })}
            aria-pressed={infoOpen}
          >
            <Info className="w-4 h-4" />
          </Button>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-w-0 bg-muted/30 flex items-center justify-center overflow-auto">
            {file && kind === "image" && (
              <img
                src={url}
                alt={file.alt_text || file.filename}
                className="max-w-full max-h-full object-contain"
              />
            )}
            {file && kind === "video" && (
              <video src={url} controls className="max-w-full max-h-full" />
            )}
            {file && kind === "audio" && <audio src={url} controls className="w-[80%]" />}
            {file && kind === "pdf" && (
              <iframe
                src={`${url}#toolbar=1`}
                title={file.filename}
                className="w-full h-full border-0 bg-background"
              />
            )}
            {file && kind === "text" && (
              <iframe
                src={url}
                title={file.filename}
                className="w-full h-full border-0 bg-background"
              />
            )}
            {file && kind === "office" && (
              <iframe
                src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
                title={file.filename}
                className="w-full h-full border-0 bg-background"
              />
            )}
            {file && kind === "other" && (
              <div className="flex flex-col items-center gap-3 text-muted-foreground p-6 text-center">
                <span className="text-5xl">📄</span>
                <div className="text-sm">
                  {t("admin.media.previewUnavailable", {
                    defaultValue: "Podgląd niedostępny dla tego formatu.",
                  })}
                </div>
                <div className="text-xs">{mime || ext.toUpperCase()}</div>
              </div>
            )}
          </div>
          {infoOpen && (
            <aside className="w-80 shrink-0 border-l border-border bg-background overflow-y-auto">
              <div className="flex items-center justify-between p-3 border-b border-border">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Info className="w-4 h-4" />
                  {t("admin.media.usedIn", { defaultValue: "Wykorzystywane w" })}
                </h3>
                <button
                  type="button"
                  onClick={() => setInfoOpen(false)}
                  className="p-1 rounded hover:bg-muted"
                  aria-label={t("admin.close", { defaultValue: "Zamknij" })}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <MediaUsageList
                isLoading={usageQ.isLoading}
                error={usageQ.error}
                items={usageQ.data?.items}
              />
            </aside>
          )}
        </div>
        <DialogFooter className="px-4 py-3 border-t border-border shrink-0 gap-2">
          {file && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground underline"
            >
              {t("admin.media.openInNewTab", { defaultValue: "Otwórz w nowej karcie" })}
            </a>
          )}
          {file && (
            <a href={url} download={file.filename} className="inline-flex">
              <Button variant="outline" size="sm">
                <Download className="w-4 h-4 mr-1" />
                {t("admin.download", { defaultValue: "Pobierz" })}
              </Button>
            </a>
          )}
          <Button size="sm" onClick={onClose}>
            {t("admin.close", { defaultValue: "Zamknij" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

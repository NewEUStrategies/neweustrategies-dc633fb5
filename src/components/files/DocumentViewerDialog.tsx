// Popup podglądu pliku - jedna powłoka dla wszystkich formatów.
//
// POWŁOKA JEST LEKKA, TREŚĆ CIĘŻKA. Nagłówek, akcje i klawiatura żyją tutaj i
// wchodzą do zwykłego chunku; parsery formatów biurowych są za `lazy()`, więc
// samo istnienie przycisku "Podgląd" na stronie nic nie kosztuje.
//
// PLIK ZOSTAJE W SESJI: podgląd renderuje się z podpisanego adresu w naszej
// przeglądarce, bez pośrednika typu Office Online. To wymóg dla materiałów
// członkowskich, nie preferencja estetyczna.
import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fileLabel, humanSize } from "@/lib/files/fileKinds";
import { ensureI18n as ensureFileViewerI18n } from "@/lib/i18n-file-viewer";
import type { ViewerSource } from "./DocumentViewerBody";

const Body = lazy(() =>
  import("./DocumentViewerBody").then((m) => ({ default: m.DocumentViewerBody })),
);

export interface DocumentViewerFile extends ViewerSource {
  size?: number | null;
}

export function DocumentViewerDialog({
  file,
  open,
  onOpenChange,
}: {
  file: DocumentViewerFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  ensureFileViewerI18n();
  const { t } = useTranslation();

  return (
    <Dialog open={open && file !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[92vh] max-h-[92vh] w-[min(96vw,1200px)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0"
        data-testid="file-viewer-dialog"
      >
        {file !== null ? (
          <>
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 py-3 pr-12 sm:px-5">
              <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                {fileLabel(file.name, file.mime)}
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm font-semibold">{file.name}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {humanSize(file.size ?? null)}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                  <a href={file.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t("fileViewer.openInTab")}</span>
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                  <a href={file.url} download={file.name}>
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{t("fileViewer.download")}</span>
                  </a>
                </Button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              <Suspense
                fallback={
                  <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {t("fileViewer.loading")}
                  </div>
                }
              >
                <Body source={{ url: file.url, name: file.name, mime: file.mime }} />
              </Suspense>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

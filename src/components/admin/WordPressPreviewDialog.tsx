// Dialog porównania: oryginalny HTML z WordPressa vs wynikowy BuilderDocument.
// Bez zapisu - tylko podgląd konwersji przed importem.
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Monitor, Smartphone, AlertCircle, CheckCircle2 } from "lucide-react";
import { wpPreviewPage } from "@/lib/wp-import.functions";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import type { Device } from "@/lib/builder/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteDomain: string;
  wpId: number | null;
  wpIdEn?: number | null;
}

export function WordPressPreviewDialog({ open, onOpenChange, siteDomain, wpId, wpIdEn }: Props) {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const previewFn = useServerFn(wpPreviewPage);
  const [device, setDevice] = useState<Device>("desktop");

  const { data, isLoading, error } = useQuery({
    queryKey: ["wp-preview", siteDomain, wpId, wpIdEn ?? null],
    enabled: open && !!wpId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!wpId) throw new Error("No wpId");
      return previewFn({
        data: {
          siteDomain,
          wpId,
          ...(wpIdEn ? { wpIdEn } : {}),
        },
      });
    },
  });

  const iframeSrc = useMemo(() => {
    if (!data) return "";
    const clean = data.original.cleanedHtml
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/on[a-z]+\s*=\s*"[^"]*"/gi, "");
    return `<!doctype html><html><head><meta charset="utf-8"/><style>body{font-family:system-ui,sans-serif;padding:16px;color:#111;max-width:100%;} img{max-width:100%;height:auto;} .elementor-widget{margin:8px 0;padding:8px;border:1px dashed #ddd;} .elementor-section{margin:12px 0;padding:12px;border:1px solid #eee;background:#fafafa;}</style></head><body>${clean}</body></html>`;
  }, [data]);

  const containerWidth = device === "mobile" ? 390 : device === "tablet" ? 768 : "100%";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] max-w-[95vw] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {lang === "pl" ? "Podgląd konwersji" : "Conversion preview"}
            {data ? ` — ${data.title || `#${data.wpId}`}` : ""}
          </DialogTitle>
          <DialogDescription>
            {lang === "pl"
              ? "Lewa strona: oryginalny HTML z WordPressa. Prawa strona: wynik konwersji do naszych widgetów."
              : "Left: original HTML from WordPress. Right: converted output rendered by our builder."}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <span>{error instanceof Error ? error.message : String(error)}</span>
          </div>
        )}

        {data && (
          <>
            {/* pasek pokrycia */}
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium">
                {lang === "pl" ? "Źródło:" : "Source:"}{" "}
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                  {data.source}
                </span>
              </span>
              <span className="text-emerald-700 dark:text-emerald-300">
                Elementor: {data.coverage.elementorMapped}
              </span>
              <span className="text-sky-700 dark:text-sky-300">
                Gutenberg: {data.coverage.gutenbergMapped}
              </span>
              <span className="text-amber-700 dark:text-amber-300">
                Fallback: {data.coverage.fallback}
              </span>
              <span className="text-muted-foreground">
                {lang === "pl" ? "Razem" : "Total"}: {data.coverage.total}
              </span>
              <span className="text-muted-foreground">
                {lang === "pl" ? "Media" : "Media"}: {data.original.mediaUrls.length}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant={device === "desktop" ? "default" : "outline"}
                  onClick={() => setDevice("desktop")}
                >
                  <Monitor className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={device === "mobile" ? "default" : "outline"}
                  onClick={() => setDevice("mobile")}
                >
                  <Smartphone className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {data.warnings.length > 0 && (
              <details className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-amber-800 dark:text-amber-200">
                  {lang === "pl" ? "Ostrzeżenia" : "Warnings"} ({data.warnings.length})
                </summary>
                <ul className="mt-2 space-y-1 pl-4 text-amber-900 dark:text-amber-100">
                  {data.warnings.slice(0, 20).map((w, i) => (
                    <li key={i} className="list-disc">
                      {w}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* side-by-side */}
            <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-hidden">
              <div className="flex min-h-0 flex-col rounded-md border border-border">
                <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium">
                  {lang === "pl" ? "Oryginał (WordPress)" : "Original (WordPress)"}
                </div>
                <iframe
                  title="wp-original"
                  sandbox="allow-same-origin"
                  srcDoc={iframeSrc}
                  className="min-h-0 flex-1 bg-background"
                />
              </div>
              <div className="flex min-h-0 flex-col rounded-md border border-border">
                <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium">
                  {lang === "pl" ? "Wynik (nasze widgety)" : "Converted (our widgets)"}
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-background">
                  <div
                    className="mx-auto"
                    style={{
                      maxWidth:
                        typeof containerWidth === "number" ? `${containerWidth}px` : containerWidth,
                    }}
                  >
                    <BuilderRenderer doc={data.converted} lang={lang} device={device} />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {lang === "pl"
                ? 'Podgląd nie zapisuje niczego — kliknij „Importuj", aby wdrożyć.'
                : 'Preview does not save anything — click "Import" to persist.'}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {lang === "pl" ? "Zamknij" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

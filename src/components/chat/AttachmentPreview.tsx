// Rozbudowany podgląd załączników w czacie:
//  - ImageLightbox: pełnoekranowy podgląd obrazu z zoomem (kółko myszy, +/-),
//    obrotem, przeciąganiem, nawigacją strzałkami po galerii (opcjonalna
//    lista siblingów, np. z historii mediów), pobraniem i otwarciem w karcie.
//  - PdfPreviewDialog: szybki podgląd PDF w iframie (native viewer) z akcjami
//    Pobierz / Otwórz w nowej karcie.
// Oba korzystają z Dialog (Radix) - focus trap, portal, Esc, aria-modal.
// i18n: klucze pod `chat.preview.*` (PL/EN, parity test w i18n-chat).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Maximize2,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_MIN_ZOOM,
  LIGHTBOX_ZOOM_STEP,
  clampLightboxIndex,
  lightboxKeyIntent,
  nextRotation,
  shouldZoomOnWheel,
  wheelZoomDelta,
  wrapLightboxIndex,
  zoomBy,
} from "@/lib/chat/attachmentPresentation";
import { cn } from "@/lib/utils";

const MIN_ZOOM = LIGHTBOX_MIN_ZOOM;
const MAX_ZOOM = LIGHTBOX_MAX_ZOOM;
const ZOOM_STEP = LIGHTBOX_ZOOM_STEP;

export interface LightboxImage {
  url: string;
  name?: string | null;
}

export interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: readonly LightboxImage[];
  index: number;
  onIndexChange?: (next: number) => void;
}

export function ImageLightbox({
  open,
  onOpenChange,
  images,
  index,
  onIndexChange,
}: ImageLightboxProps) {
  const { t } = useTranslation();
  const total = images.length;
  const clamped = clampLightboxIndex(index, total);
  const current = images[clamped];

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  // Reset transform po zmianie obrazu lub zamknięciu.
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, [clamped, open]);

  const changeIndex = useCallback(
    (delta: number) => {
      if (!onIndexChange || total <= 1) return;
      onIndexChange(wrapLightboxIndex(clamped, delta, total));
    },
    [clamped, total, onIndexChange],
  );

  // Skróty klawiaturowe (Esc obsługuje Radix).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const intent = lightboxKeyIntent(e.key);
      if (intent === "none") return;
      e.preventDefault();
      if (intent === "next") changeIndex(1);
      else if (intent === "prev") changeIndex(-1);
      else if (intent === "zoom-in") setZoom((z) => zoomBy(z, ZOOM_STEP));
      else if (intent === "zoom-out") setZoom((z) => zoomBy(z, -ZOOM_STEP));
      else if (intent === "rotate") setRotation(nextRotation);
      else {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, changeIndex]);

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!shouldZoomOnWheel(e)) return;
    e.preventDefault();
    const delta = wheelZoomDelta(e.deltaY);
    setZoom((z) => zoomBy(z, delta));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { startX, startY, baseX, baseY } = dragRef.current;
    setOffset({ x: baseX + (e.clientX - startX), y: baseY + (e.clientY - startY) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const zoomedIn = zoom > 1;
  const name = current?.name ?? t("chat.photo");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[96vw] gap-0 border-none bg-black/90 p-0 shadow-none sm:max-w-[92vw]"
        aria-label={t("chat.preview.title")}
      >
        <DialogTitle className="sr-only">{name}</DialogTitle>

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 border-b border-white/10 bg-black/50 px-2.5 py-2 text-white">
          <span className="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm">{name}</span>
          {total > 1 && (
            <span
              className="mr-1 shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[11px] tabular-nums"
              aria-live="polite"
            >
              {t("chat.preview.counter", {
                index: clamped + 1,
                total,
              })}
            </span>
          )}
          <ToolbarButton
            onClick={() => setZoom((z) => zoomBy(z, -ZOOM_STEP))}
            disabled={zoom <= MIN_ZOOM}
            label={t("chat.preview.zoomOut")}
          >
            <ZoomOut className="h-4 w-4" aria-hidden />
          </ToolbarButton>
          <span className="w-10 shrink-0 text-center text-[11px] tabular-nums text-white/70">
            {Math.round(zoom * 100)}%
          </span>
          <ToolbarButton
            onClick={() => setZoom((z) => zoomBy(z, ZOOM_STEP))}
            disabled={zoom >= MAX_ZOOM}
            label={t("chat.preview.zoomIn")}
          >
            <ZoomIn className="h-4 w-4" aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
            }}
            disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
            label={t("chat.preview.reset")}
          >
            <Maximize2 className="h-4 w-4" aria-hidden />
          </ToolbarButton>
          <ToolbarButton onClick={() => setRotation(nextRotation)} label={t("chat.preview.rotate")}>
            <RotateCw className="h-4 w-4" aria-hidden />
          </ToolbarButton>
          {current?.url && (
            <>
              <ToolbarLink
                href={current.url}
                download={current.name ?? undefined}
                label={t("chat.preview.download")}
              >
                <Download className="h-4 w-4" aria-hidden />
              </ToolbarLink>
              <ToolbarLink
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                label={t("chat.preview.openInNewTab")}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </ToolbarLink>
            </>
          )}
          <ToolbarButton onClick={() => onOpenChange(false)} label={t("chat.preview.close")}>
            <X className="h-4 w-4" aria-hidden />
          </ToolbarButton>
        </div>

        {/* Canvas */}
        <div
          className="relative flex h-[78vh] max-h-[78vh] w-full items-center justify-center overflow-hidden bg-black"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ cursor: zoomedIn ? (dragRef.current ? "grabbing" : "grab") : "default" }}
        >
          {current?.url ? (
            <img
              src={current.url}
              alt={name}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain transition-transform duration-100 will-change-transform"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              }}
            />
          ) : (
            <div className="text-sm text-white/60">{t("chat.mediaHistory.loading")}</div>
          )}

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => changeIndex(-1)}
                className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label={t("chat.preview.prev")}
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => changeIndex(1)}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label={t("chat.preview.next")}
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarLink({
  children,
  href,
  download,
  target,
  rel,
  label,
}: {
  children: React.ReactNode;
  href: string;
  download?: string;
  target?: string;
  rel?: string;
  label: string;
}) {
  return (
    <a
      href={href}
      download={download}
      target={target}
      rel={rel}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {children}
    </a>
  );
}

export interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  name: string | null;
}

export function PdfPreviewDialog({ open, onOpenChange, url, name }: PdfPreviewDialogProps) {
  const { t } = useTranslation();
  const title = name ?? t("chat.preview.pdfTitle");
  // Do wielu widocznych PDF w tej samej sesji można trzymać sygnaturę URL,
  // by wymusić remount iframe'a przy zmianie źródła.
  const iframeKey = useMemo(() => url ?? "empty", [url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[88vh] max-h-[88vh] max-w-[96vw] flex-col gap-0 p-0 sm:max-w-[92vw]"
        aria-label={title}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex items-center gap-1.5 border-b border-border/60 bg-card px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm">{title}</span>
          {url && (
            <>
              <a
                href={url}
                download={name ?? undefined}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={t("chat.preview.download")}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("chat.preview.download")}</span>
              </a>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={t("chat.preview.openInNewTab")}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("chat.preview.openInNewTab")}</span>
              </a>
            </>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("chat.preview.close")}
            title={t("chat.preview.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-muted">
          {url ? (
            <iframe
              key={iframeKey}
              src={`${url}#toolbar=1&navpanes=0`}
              title={title}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("chat.preview.pdfLoading")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

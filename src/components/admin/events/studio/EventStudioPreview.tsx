// Dok PODGLADU NA ZYWO - przypiety do ramy studia, widoczny na kazdej sekcji.
//
// PODGLAD JEST STALYM ELEMENTEM RAMY, a nie osobnym ekranem: pytanie „jak to
// bedzie wygladac" pada przy KAZDEJ zmianie (tytul, kolor, kolejnosc podstron),
// a odpowiedz wymagajaca przejscia na inny ekran nie jest odpowiedzia.
//
// SKALA LICZY SIE Z ZMIERZONEJ SZEROKOSCI, nie z zalozonej. Kanwa ma stala
// szerokosc wirtualna (1240 px albo 390 px), a dok bywa waski albo rozlozony na
// pol ekranu - `transform: scale` z wyliczonym wspolczynnikiem daje ten sam
// uklad w kazdym rozmiarze doku. Wysokosc wnetrza tez jest mierzona, inaczej
// pasek przewijania kończyłby się w połowie strony.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, ExternalLink, Monitor, Smartphone } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EventPreviewCanvas,
  PREVIEW_WIDTHS,
  type PreviewDevice,
} from "@/components/admin/events/studio/EventPreviewCanvas";
import { useEventPreviewModel } from "@/components/admin/events/studio/EventStudioPreviewContext";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

const DOCK_HEIGHT = 300;
const EXPANDED_HEIGHT = 620;

export function EventStudioPreview({
  open,
  onOpenChange,
  publicHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adres strony publicznej albo `null` dla szkicu - nie ma czego otwierac. */
  publicHref: string | null;
}) {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const model = useEventPreviewModel();
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [expanded, setExpanded] = useState(false);
  const [scale, setScale] = useState(0.3);
  const [contentHeight, setContentHeight] = useState(0);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (frame === null) return;
    const available = frame.clientWidth;
    if (available > 0) setScale(Math.min(1, available / PREVIEW_WIDTHS[device]));
    if (canvas !== null) setContentHeight(canvas.scrollHeight);
  }, [device]);

  useEffect(() => {
    if (!open) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    if (frameRef.current !== null) observer.observe(frameRef.current);
    if (canvasRef.current !== null) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [open, measure, model]);

  if (!open) return null;

  const height = expanded ? EXPANDED_HEIGHT : DOCK_HEIGHT;

  return (
    <aside
      aria-label={t("adminEvents.studio.preview.title")}
      className={cn(
        "fixed bottom-4 right-4 z-40 overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
        expanded ? "w-[min(1100px,calc(100vw-2rem))]" : "w-[min(460px,calc(100vw-2rem))]",
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="mr-auto text-xs font-medium">
          {t("adminEvents.studio.preview.title")}
          {model.status === "published" ? null : (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {t("adminEvents.studio.preview.draftNotice")}
            </span>
          )}
        </span>

        <Button
          type="button"
          variant={device === "desktop" ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          aria-label={t("adminEvents.studio.preview.desktop")}
          aria-pressed={device === "desktop"}
          onClick={() => setDevice("desktop")}
        >
          <Monitor className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant={device === "mobile" ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          aria-label={t("adminEvents.studio.preview.mobile")}
          aria-pressed={device === "mobile"}
          onClick={() => setDevice("mobile")}
        >
          <Smartphone className="h-3.5 w-3.5" />
        </Button>

        {publicHref === null ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t("adminEvents.studio.preview.openPublic")}
            asChild
          >
            <a href={publicHref} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t(
            expanded ? "adminEvents.studio.preview.collapse" : "adminEvents.studio.preview.expand",
          )}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => onOpenChange(false)}
        >
          {t("adminEvents.studio.preview.close")}
        </Button>
      </div>

      <div ref={frameRef} className="overflow-auto bg-muted/40" style={{ height }}>
        <div
          style={{
            width: PREVIEW_WIDTHS[device] * scale,
            height: contentHeight * scale,
            margin: device === "mobile" ? "0 auto" : undefined,
          }}
        >
          <div
            ref={canvasRef}
            style={{
              width: PREVIEW_WIDTHS[device],
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <EventPreviewCanvas model={model} device={device} />
          </div>
        </div>
      </div>
    </aside>
  );
}

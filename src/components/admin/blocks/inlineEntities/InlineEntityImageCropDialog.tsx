// Kadrowanie logo / zdjęcia encji inline.
//
// Wymagania redakcji: zaokrąglenie 6 px, zmiana rozmiaru (zoom), przesuwanie
// w lewo / prawo / górę / dół (przeciąganie, przyciski i strzałki klawiatury)
// i zapis. Wynik to kwadrat `OUTPUT_PX` × `OUTPUT_PX` (WebP, z przezroczystością
// dla logotypów) - wystarcza na 3x karty (44 px) i jest kilkadziesiąt razy
// mniejszy od oryginału, więc nie obciąża LCP. Parametry kadru (`area`, `zoom`)
// wracają do wołającego, żeby ponowne otwarcie kadrowania startowało z tego
// samego miejsca na ORYGINALE (bez kumulowania strat jakości).

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Cropper, { type Area, type MediaSize, type Size } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  ImageOff,
  Loader2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { getCroppedBlob } from "@/lib/media/imageCrop";
import { quantizeZoom, stepZoom, ZOOM_MAX, ZOOM_MIN } from "@/lib/media/cropGeometry";
import { clampCropOffset, corsSafeImageSource, croppedPreviewStyle } from "./cropMath";
import type { InlineEntityImage } from "@/lib/blocks/inlineEntities/model";
import "@/lib/i18n-admin-blocks";

/** Bok zapisywanego kwadratu (px). */
export const OUTPUT_PX = 256;
/** Krok przesunięcia przyciskami / strzałkami (px kadru); z Shift - większy. */
const NUDGE_PX = 6;
const NUDGE_PX_COARSE = 24;
/** Promień ramki kadru: 6 px na 44 px karty w skali ramki. */
const FRAME_RADIUS_RATIO = 6 / 44;

export interface CropResult {
  blob: Blob;
  area: NonNullable<InlineEntityImage["area"]>;
  zoom: number;
}

interface Props {
  open: boolean;
  /** Źródło kadrowania: data URL świeżo wgranego pliku albo adres oryginału. */
  source: string | null;
  initialArea?: InlineEntityImage["area"];
  initialZoom?: number;
  onOpenChange: (open: boolean) => void;
  onSave: (result: CropResult) => Promise<void>;
}

async function encodeSquare(src: string, pixels: Area): Promise<Blob> {
  // WebP trzyma przezroczystość logotypów i jest najmniejszy; przeglądarka bez
  // kodera WebP odda PNG (też z kanałem alfa) - wołający czyta `blob.type`.
  return getCroppedBlob(src, pixels, 0, OUTPUT_PX, OUTPUT_PX, "image/webp", 0.9);
}

export function InlineEntityImageCropDialog({
  open,
  source,
  initialArea,
  initialZoom,
  onOpenChange,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(initialZoom ?? 1);
  const [area, setArea] = useState<Area | null>(null);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [media, setMedia] = useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Klucz wymusza świeży Cropper po zmianie źródła - `initialCroppedArea…`
  // jest czytane tylko przy wczytaniu obrazu.
  const [session, setSession] = useState(0);

  const imageSrc = useMemo(() => (source ? corsSafeImageSource(source) : null), [source]);

  useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(initialZoom ?? 1);
    setArea(null);
    setPixels(null);
    setFailed(false);
    setBusy(false);
    setSession((n) => n + 1);
  }, [open, source, initialZoom]);

  const onCropComplete = useCallback((nextArea: Area, nextPixels: Area) => {
    setArea(nextArea);
    setPixels(nextPixels);
  }, []);

  const nudge = (dx: number, dy: number) =>
    setCrop((current) =>
      clampCropOffset({ x: current.x + dx, y: current.y + dy }, media, cropSize, zoom),
    );

  const onFrameKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? NUDGE_PX_COARSE : NUDGE_PX;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      nudge(move[0], move[1]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((z) => stepZoom(z, 1, event.shiftKey));
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom((z) => stepZoom(z, -1, event.shiftKey));
    }
  };

  const reset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const save = async () => {
    if (!imageSrc || !pixels || !area) return;
    setBusy(true);
    setFailed(false);
    try {
      const blob = await encodeSquare(imageSrc, pixels);
      await onSave({
        blob,
        area: { x: area.x, y: area.y, width: area.width, height: area.height },
        zoom,
      });
      onOpenChange(false);
    } catch {
      // Canvas „skażony" obrazem z obcej domeny bez CORS, brak kontekstu 2d,
      // błąd wgrywania - redakcja dostaje jasny komunikat zamiast martwego
      // przycisku.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const moveButtons = [
    {
      key: "left",
      icon: ArrowLeft,
      label: t("blocks.inlineEntity.crop.moveLeft"),
      d: [-NUDGE_PX, 0],
    },
    { key: "up", icon: ArrowUp, label: t("blocks.inlineEntity.crop.moveUp"), d: [0, -NUDGE_PX] },
    {
      key: "down",
      icon: ArrowDown,
      label: t("blocks.inlineEntity.crop.moveDown"),
      d: [0, NUDGE_PX],
    },
    {
      key: "right",
      icon: ArrowRight,
      label: t("blocks.inlineEntity.crop.moveRight"),
      d: [NUDGE_PX, 0],
    },
  ] as const;

  const frameRadius = cropSize ? Math.round(cropSize.width * FRAME_RADIUS_RATIO) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="rounded-[6px] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("blocks.inlineEntity.crop.title")}</DialogTitle>
          <DialogDescription>
            {t("blocks.inlineEntity.crop.description", { size: OUTPUT_PX })}
          </DialogDescription>
        </DialogHeader>

        {failed ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[6px] border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
          >
            <ImageOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("blocks.inlineEntity.crop.failed")}</span>
          </div>
        ) : null}

        <div
          className="relative h-[300px] w-full overflow-hidden rounded-[6px] border border-border bg-[repeating-conic-gradient(#e5e7eb_0_25%,#f8fafc_0_50%)] bg-[length:16px_16px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="group"
          aria-label={t("blocks.inlineEntity.crop.title")}
          onKeyDown={onFrameKeyDown}
          data-testid="inline-entity-crop-frame"
        >
          {imageSrc ? (
            <Cropper
              key={session}
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={0}
              aspect={1}
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              zoomSpeed={0.15}
              cropShape="rect"
              showGrid
              restrictPosition
              objectFit="contain"
              initialCroppedAreaPercentages={initialArea}
              onCropChange={setCrop}
              onZoomChange={(z) => setZoom(quantizeZoom(z))}
              onCropComplete={onCropComplete}
              onMediaLoaded={setMedia}
              onCropSizeChange={setCropSize}
              style={{ cropAreaStyle: { borderRadius: frameRadius } }}
              mediaProps={{ crossOrigin: imageSrc.startsWith("http") ? "anonymous" : undefined }}
            />
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-3">
            <label className="text-xs">
              <span className="mb-1 flex items-center gap-2">
                {t("blocks.inlineEntity.crop.zoom")}
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {zoom.toFixed(2)}×
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-7"
                  aria-label={t("blocks.inlineEntity.crop.zoomOut")}
                  onClick={() => setZoom((z) => stepZoom(z, -1, false))}
                >
                  <ZoomOut className="size-3.5" aria-hidden />
                </Button>
                <Slider
                  value={[zoom]}
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={0.01}
                  onValueChange={(v) => setZoom(quantizeZoom(v[0] ?? ZOOM_MIN))}
                  aria-label={t("blocks.inlineEntity.crop.zoom")}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-7"
                  aria-label={t("blocks.inlineEntity.crop.zoomIn")}
                  onClick={() => setZoom((z) => stepZoom(z, 1, false))}
                >
                  <ZoomIn className="size-3.5" aria-hidden />
                </Button>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {moveButtons.map(({ key, icon: Icon, label, d }) => (
                <Button
                  key={key}
                  type="button"
                  size="icon"
                  variant="outline"
                  className="size-8"
                  aria-label={label}
                  title={label}
                  onClick={() => nudge(d[0], d[1])}
                >
                  <Icon className="size-4" aria-hidden />
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setCrop({ x: 0, y: 0 })}
                className="gap-1.5"
              >
                <Crosshair className="size-3.5" aria-hidden />
                {t("blocks.inlineEntity.crop.center")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={reset} className="gap-1.5">
                <RotateCcw className="size-3.5" aria-hidden />
                {t("blocks.inlineEntity.crop.reset")}
              </Button>
            </div>
          </div>

          <div className="flex items-end gap-4" aria-hidden={area ? undefined : true}>
            {[
              { size: 24, label: t("blocks.inlineEntity.crop.previewInline") },
              { size: 44, label: t("blocks.inlineEntity.crop.previewCard") },
            ].map(({ size, label }) => (
              <figure key={size} className="m-0 grid justify-items-center gap-1">
                <div
                  className="relative overflow-hidden rounded-[6px] bg-muted ring-1 ring-foreground/15"
                  style={{ width: size, height: size }}
                >
                  {area && imageSrc ? (
                    <img
                      alt=""
                      src={imageSrc}
                      style={croppedPreviewStyle(area)}
                      draggable={false}
                    />
                  ) : null}
                </div>
                <figcaption className="text-[10px] text-muted-foreground">{label}</figcaption>
              </figure>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("blocks.inlineEntity.crop.cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={busy || !pixels} className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {busy ? t("blocks.inlineEntity.crop.saving") : t("blocks.inlineEntity.crop.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Modalny edytor zdjęcia: kadrowanie (zoom + drag), obrót, wymuszona
// proporcja + docelowe wymiary z rekomendacji presetu. Blokuje wgranie
// zdjęcia o skrajnie niezgodnym stosunku bez świadomej zgody użytkownika.
//
// Używa react-easy-crop (Web, dotyk + mysz) i lokalnego helpera
// getCroppedBlob (canvas). Zwraca gotowy Blob w docelowym rozmiarze —
// warstwa uploadu (Supabase Storage) się nie zmienia.
import { useCallback, useEffect, useMemo, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { RotateCcw, RotateCw, ZoomIn, ZoomOut, ImageOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  getCroppedBlob,
  getImageDimensions,
  readFileAsDataUrl,
} from "@/lib/media/imageCrop";

export type CropKind = "avatar" | "cover";

export interface CropPreset {
  /** e.g. 1 for 1:1, 16/6 for cover */
  aspect: number;
  /** Docelowa szerokość w px zapisywanego pliku */
  targetWidth: number;
  /** Docelowa wysokość w px zapisywanego pliku */
  targetHeight: number;
  /**
   * Tolerancja proporcji: dopuszczalne odchylenie źródłowego stosunku boków
   * od `aspect` (0.35 = ±35%). Powyżej pokazujemy warning i wymagamy
   * potwierdzenia.
   */
  tolerance?: number;
}

interface Props {
  open: boolean;
  file: File | null;
  preset: CropPreset;
  kind: CropKind;
  lang?: "pl" | "en";
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob, previewUrl: string) => void;
}

const L = {
  pl: {
    title: "Wykadruj zdjęcie",
    descAvatar: "Wybierz obszar zdjęcia profilowego. Zdjęcie zostanie zapisane w wymaganych proporcjach.",
    descCover: "Wybierz obszar okładki. Zdjęcie zostanie zapisane w wymaganych proporcjach.",
    zoom: "Zoom",
    rotate: "Obrót",
    rotateL: "Obróć w lewo",
    rotateR: "Obróć w prawo",
    reset: "Resetuj",
    cancel: "Anuluj",
    apply: "Zastosuj",
    aspectMismatch: "Proporcje zdjęcia mocno odbiegają od zalecanych - efekt może być mocno przycięty. Popraw kadr poniżej lub wgraj inne zdjęcie.",
    target: "Zapis: ",
    ratio: "Wymagany format: ",
  },
  en: {
    title: "Crop image",
    descAvatar: "Choose the profile photo area. The image will be saved in the required aspect ratio.",
    descCover: "Choose the cover area. The image will be saved in the required aspect ratio.",
    zoom: "Zoom",
    rotate: "Rotation",
    rotateL: "Rotate left",
    rotateR: "Rotate right",
    reset: "Reset",
    cancel: "Cancel",
    apply: "Apply",
    aspectMismatch: "Source aspect ratio differs significantly from the recommended one - the result may be heavily cropped. Adjust the frame below or upload another image.",
    target: "Saved as: ",
    ratio: "Required aspect: ",
  },
} as const;

export function ImageCropDialog({
  open,
  file,
  preset,
  kind,
  lang = "pl",
  onOpenChange,
  onConfirm,
}: Props) {
  const t = L[lang];
  const [src, setSrc] = useState<string | null>(null);
  const [aspectWarn, setAspectWarn] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixelCrop, setPixelCrop] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const tolerance = preset.tolerance ?? 0.35;

  const ratioLabel = useMemo(() => {
    if (Math.abs(preset.aspect - 1) < 0.01) return "1:1";
    // Reduce a/b using GCD approximation
    const w = preset.targetWidth;
    const h = preset.targetHeight;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(w, h);
    return `${w / g}:${h / g}`;
  }, [preset]);

  // Load file into a data URL + validate source aspect ratio.
  useEffect(() => {
    let cancelled = false;
    if (!open || !file) {
      setSrc(null);
      setAspectWarn(false);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setPixelCrop(null);
      return;
    }
    (async () => {
      const url = await readFileAsDataUrl(file);
      if (cancelled) return;
      setSrc(url);
      try {
        const { width, height } = await getImageDimensions(url);
        const sourceRatio = width / height;
        const diff = Math.abs(sourceRatio - preset.aspect) / preset.aspect;
        setAspectWarn(diff > tolerance);
      } catch {
        setAspectWarn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, file, preset.aspect, tolerance]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setPixelCrop(areaPixels);
  }, []);

  const handleReset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
  };

  const handleConfirm = async () => {
    if (!src || !pixelCrop) return;
    setBusy(true);
    try {
      const blob = await getCroppedBlob(
        src,
        pixelCrop,
        rotation,
        preset.targetWidth,
        preset.targetHeight,
        "image/jpeg",
        0.92,
      );
      const previewUrl = URL.createObjectURL(blob);
      onConfirm(blob, previewUrl);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl rounded-[6px]">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {kind === "avatar" ? t.descAvatar : t.descCover}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-[6px] border border-border bg-muted/40 px-2 py-1">
            {t.ratio}
            <b>{ratioLabel}</b>
          </span>
          <span className="rounded-[6px] border border-border bg-muted/40 px-2 py-1">
            {t.target}
            <b>
              {preset.targetWidth}×{preset.targetHeight} px
            </b>
          </span>
        </div>

        {aspectWarn && (
          <div className="flex items-start gap-2 rounded-[6px] border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
            <ImageOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t.aspectMismatch}</span>
          </div>
        )}

        <div
          className="relative w-full overflow-hidden rounded-[6px] border border-border bg-black/80"
          style={{ height: 380 }}
        >
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={preset.aspect}
              cropShape={kind === "avatar" ? "round" : "rect"}
              showGrid
              minZoom={1}
              maxZoom={6}
              zoomSpeed={0.15}
              restrictPosition
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onCropComplete}
            />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <span className="flex items-center gap-2 mb-1">
              <ZoomOut className="h-3.5 w-3.5" aria-hidden />
              {t.zoom}
              <ZoomIn className="h-3.5 w-3.5" aria-hidden />
              <span className="ml-auto tabular-nums text-muted-foreground">
                {zoom.toFixed(2)}×
              </span>
            </span>
            <Slider
              value={[zoom]}
              min={1}
              max={6}
              step={0.01}
              onValueChange={(v) => setZoom(Math.round((v[0] ?? 1) * 100) / 100)}
              onKeyDown={(e) => {
                // Precyzyjny krok: Shift = 0.01, domyślny 0.05
                const fine = e.shiftKey ? 0.01 : 0.05;
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setZoom((z) => Math.min(6, Math.round((z + fine) * 100) / 100));
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  setZoom((z) => Math.max(1, Math.round((z - fine) * 100) / 100));
                }
              }}
              aria-label={t.zoom}
            />
          </label>
          <label className="text-xs">
            <span className="flex items-center gap-2 mb-1">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t.rotate}
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              <span className="ml-auto tabular-nums text-muted-foreground">
                {rotation.toFixed(1)}°
              </span>
            </span>
            <Slider
              value={[rotation]}
              min={-180}
              max={180}
              step={0.5}
              onValueChange={(v) => setRotation(Math.round((v[0] ?? 0) * 10) / 10)}
              onKeyDown={(e) => {
                // Shift = 0.1°, domyślny 1°, snap co 15° z Alt
                const fine = e.altKey ? 15 : e.shiftKey ? 0.1 : 1;
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setRotation((r) => Math.min(180, Math.round((r + fine) * 10) / 10));
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  setRotation((r) => Math.max(-180, Math.round((r - fine) * 10) / 10));
                }
              }}
              aria-label={t.rotate}
            />
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRotation((r) => r - 90)}
            aria-label={t.rotateL}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRotation((r) => r + 90)}
            aria-label={t.rotateR}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" onClick={handleReset}>
            {t.reset}
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={busy || !pixelCrop}>
            {t.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ready-to-use crop presets aligned with ExpertLayoutPreview recommendations. */
export const CROP_PRESETS: Record<CropKind, CropPreset> = {
  avatar: { aspect: 1, targetWidth: 600, targetHeight: 600, tolerance: 0.35 },
  cover: { aspect: 16 / 6, targetWidth: 1600, targetHeight: 600, tolerance: 0.35 },
};

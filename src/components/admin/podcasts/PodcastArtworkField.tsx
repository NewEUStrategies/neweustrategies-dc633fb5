// Pole okładki podcastu (kanał sieciowy i program) z POMIAREM wymiarów.
//
// Okładka trafia do `<itunes:image>`, a Apple przyjmuje wyłącznie kwadrat
// 1400..3000 px w JPEG/PNG. Dotąd było to gołe pole URL z podpowiedzią - do
// feedu szły banery 16:9 i nikt tego nie widział, bo strony publiczne kadrują
// okładkę do kwadratu po stronie serwera. Pole ładuje obraz, pokazuje go w
// RZECZYWISTYCH proporcjach (`object-contain` w kwadratowej ramce) i ocenia
// wymiary tą samą regułą, co karta gotowości kanału (`artworkRules`).
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { isSupabaseStorageUrl } from "@/lib/cropSizes";
import { mediaRenderUrl } from "@/lib/media/publicUrl";
import { checkPodcastArtworkDimensions } from "@/lib/podcast/artworkRules";

export interface PodcastArtworkSize {
  width: number;
  height: number;
}

type Measurement =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | ({ status: "ready" } & PodcastArtworkSize);

/** Wczytuje obraz w odłączonym `<img>` i zwraca jego wymiary naturalne. */
function usePodcastArtworkSize(url: string): Measurement {
  const [state, setState] = React.useState<Measurement>({ status: "idle" });
  React.useEffect(() => {
    const src = url.trim();
    if (!src || typeof window === "undefined") {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) {
        setState({ status: "ready", width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.onerror = () => {
      if (!cancelled) setState({ status: "error" });
    };
    img.src = mediaRenderUrl(src);
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

const APPLE_FORMATS = /\.(?:jpe?g|png)$/i;

function hasAppleFormat(url: string): boolean {
  try {
    const { pathname } = new URL(url, "https://example.invalid");
    // Bez rozszerzenia nie rozstrzygamy - zostawiamy ocenę walidatorowi Apple.
    return !/\.[a-z0-9]{2,5}$/i.test(pathname) || APPLE_FORMATS.test(pathname);
  } catch {
    return true;
  }
}

interface Props {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (url: string) => void;
  /** Zmierzone wymiary (albo `null`, gdy brak obrazu / błąd / pomiar trwa). */
  onMeasured?: (size: PodcastArtworkSize | null) => void;
  pickerTitle?: string;
  placeholder?: string;
}

export function PodcastArtworkField({
  id,
  label,
  hint,
  value,
  onChange,
  onMeasured,
  pickerTitle,
  placeholder = "https://…/cover-3000x3000.jpg",
}: Props): React.ReactElement {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const measurement = usePodcastArtworkSize(value);
  const statusId = `${id}-status`;

  const onMeasuredRef = React.useRef(onMeasured);
  onMeasuredRef.current = onMeasured;
  const measuredWidth = measurement.status === "ready" ? measurement.width : null;
  const measuredHeight = measurement.status === "ready" ? measurement.height : null;
  React.useEffect(() => {
    onMeasuredRef.current?.(
      measuredWidth != null && measuredHeight != null
        ? { width: measuredWidth, height: measuredHeight }
        : null,
    );
  }, [measuredWidth, measuredHeight]);

  const trimmed = value.trim();
  const check =
    measurement.status === "ready"
      ? checkPodcastArtworkDimensions(measurement.width, measurement.height)
      : null;
  const fromLibrary = trimmed !== "" && isSupabaseStorageUrl(trimmed);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-start gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded border border-border bg-muted/40">
          {trimmed && measurement.status !== "error" ? (
            <img
              src={mediaRenderUrl(trimmed)}
              alt={t("adminPodcasts.artwork.previewAlt")}
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
        </div>
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex gap-2">
            <Input
              id={id}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              aria-describedby={statusId}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setPickerOpen(true)}
              title={t("adminPodcasts.artwork.pick")}
              aria-label={t("adminPodcasts.artwork.pick")}
            >
              <Upload className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          <div id={statusId} role="status" className="grid gap-0.5 text-xs">
            {measurement.status === "loading" && (
              <span className="text-muted-foreground">{t("adminPodcasts.artwork.measuring")}</span>
            )}
            {measurement.status === "error" && (
              <span className="text-destructive">{t("adminPodcasts.artwork.loadError")}</span>
            )}
            {check && (
              <span
                className={
                  check.state === "ok"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-destructive"
                }
              >
                {t(`adminPodcasts.artwork.${check.state}`, {
                  width: check.width,
                  height: check.height,
                })}
              </span>
            )}
            {check?.state === "notSquare" && fromLibrary && (
              <span className="text-muted-foreground">
                {t("adminPodcasts.artwork.croppedInFeed")}
              </span>
            )}
            {trimmed && !hasAppleFormat(trimmed) && (
              <span className="text-destructive">{t("adminPodcasts.artwork.format")}</span>
            )}
          </div>
        </div>
      </div>
      {pickerOpen && (
        <MediaPickerDialog
          open
          onOpenChange={setPickerOpen}
          onPick={(url) => onChange(url)}
          accept="image"
          title={pickerTitle}
        />
      )}
    </div>
  );
}

// Widget odsłuchu w sidebarze - premium "Studio Hi-Fi" karta nad "Spis treści".
// Steruje globalnym playerem: pierwsze kliknięcie ładuje audio i uruchamia
// odtwarzanie, kolejne przełączają play/pause. Po zmianie strony bottom bar
// przejmuje kontrolę bez utraty ciągłości.
import { useMemo, useState } from "react";
import { Loader2, Download, Play, Pause } from "@/lib/lucide-shim";
import { toast } from "sonner";
import {
  formatAudioTime,
  useGlobalAudioPlayer,
  type AudioTrackMeta,
} from "@/lib/audio/global-player";

interface SidebarListenCardProps {
  postId: string;
  lang: "pl" | "en";
  title: string;
  author?: string | null;
  authorHref?: string | null;
  postHref?: string;
  /** Szacowany czas czytania w min - do estymacji długości audio. */
  readMinutes?: number | null;
}

const COPY = {
  pl: {
    label: "Posłuchaj artykułu",
    play: "Odtwórz",
    pause: "Pauza",
    download: "Pobierz MP3",
    downloading: "Pobieram audio…",
    downloadFailed: "Nie udało się pobrać audio",
    retry: "Spróbuj ponownie",
    error: "Nie udało się wygenerować audio",
    seek: "Przewiń materiał",
    approx: "ok. {min} min",
    loading: "Generuję audio…",
  },
  en: {
    label: "Listen to this article",
    play: "Play",
    pause: "Pause",
    download: "Download MP3",
    downloading: "Downloading audio…",
    downloadFailed: "Download failed",
    retry: "Try again",
    error: "Could not generate audio",
    seek: "Seek audio",
    approx: "~{min} min",
    loading: "Generating audio…",
  },
} as const;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function SidebarListenCard({
  postId,
  lang,
  title,
  author,
  authorHref,
  postHref,
  readMinutes,
}: SidebarListenCardProps) {
  const t = COPY[lang];
  const player = useGlobalAudioPlayer();
  const isThis = player.isActive(postId, lang);
  const loading = isThis && player.status === "loading";
  const playing = isThis && player.status === "playing";
  const errored = isThis && player.status === "error";

  const [scrub, setScrub] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  const meta: AudioTrackMeta = useMemo(
    () => ({
      postId,
      lang,
      title,
      author: author ?? null,
      authorHref: authorHref ?? null,
      postHref:
        postHref ??
        (typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "/"),
    }),
    [postId, lang, title, author, authorHref, postHref],
  );

  const approxMin =
    readMinutes && readMinutes > 0 ? Math.max(1, Math.round(readMinutes * 1.15)) : null;

  const duration = isThis ? player.duration : 0;
  const currentTime = isThis ? player.currentTime : 0;
  const displayTime = scrub ?? currentTime;
  const displayPct = duration > 0 ? (displayTime / duration) * 100 : 0;
  const showProgress = isThis && duration > 0;

  const onPrimary = () => {
    if (loading) return;
    if (isThis) void player.toggle();
    else void player.loadAndPlay(meta);
  };

  const commitSeek = (v: number) => {
    player.seek(v);
    setScrub(null);
  };

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      if (!isThis) await player.loadAndPlay(meta);
      await player.download();
    } catch {
      toast.error(t.downloadFailed);
    } finally {
      setDownloading(false);
    }
  };

  const currentLabel = formatAudioTime(displayTime);
  const totalLabel = duration > 0 ? formatAudioTime(duration) : approxMin ? t.approx.replace("{min}", String(approxMin)) : "--:--";

  return (
    <aside
      aria-label={t.label}
      className="group/card relative rounded-[6px] border border-border/70 bg-card p-5 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.35)] transition-shadow hover:shadow-[0_14px_36px_-16px_rgba(0,0,0,0.4)]"
    >
      {/* Section label */}
      <div className="flex items-center gap-3 mb-5">
        <h3 className="text-[10px] font-black tracking-[0.25em] uppercase text-muted-foreground whitespace-nowrap">
          {t.label}
        </h3>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Main row: play + time/progress */}
      <div className="flex items-center gap-4">
        {/* Play button with soft glow */}
        <button
          type="button"
          onClick={onPrimary}
          disabled={loading}
          aria-label={playing ? t.pause : t.play}
          aria-pressed={playing}
          className={[
            "relative shrink-0 group/btn",
            FOCUS_RING,
            "rounded-[6px]",
          ].join(" ")}
        >
          <span
            aria-hidden
            className={[
              "absolute -inset-1 rounded-full blur-md transition-opacity",
              playing
                ? "bg-brand/40 opacity-100 animate-pulse"
                : "bg-brand/25 opacity-70 group-hover/btn:opacity-100",
            ].join(" ")}
          />
          <span
            className={[
              "relative flex h-14 w-14 items-center justify-center rounded-full",
              "bg-brand text-brand-foreground shadow-lg shadow-brand/40",
              "transition-transform active:scale-95 group-hover/btn:brightness-110",
              loading ? "opacity-80" : "",
            ].join(" ")}
          >
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            ) : playing ? (
              <Pause className="h-6 w-6" aria-hidden />
            ) : (
              <Play className="h-6 w-6 translate-x-[1px]" aria-hidden fill="currentColor" />
            )}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 mb-2.5">
            <span className="text-lg font-bold tracking-tight tabular-nums text-foreground">
              {showProgress ? currentLabel : loading ? "…" : "00:00"}
            </span>
            <span className="text-[11px] font-bold tabular-nums tracking-wide text-muted-foreground">
              / {totalLabel}
            </span>
          </div>

          {/* Slider */}
          <div className="relative h-4 flex items-center">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-[6px] bg-muted" />
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-[6px] bg-brand transition-[width] duration-150"
              style={{ width: `${displayPct}%` }}
            />
            <div
              aria-hidden
              className={[
                "absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-background border-2 border-brand shadow-md transition-transform",
                showProgress ? "scale-0 group-hover/card:scale-100" : "scale-0",
              ].join(" ")}
              style={{ left: `calc(${displayPct}% - 6px)` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={displayTime}
              disabled={!showProgress}
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
              onBlur={(e) => {
                if (scrub !== null) commitSeek(Number(e.target.value));
              }}
              aria-label={t.seek}
              aria-valuemin={0}
              aria-valuemax={Math.max(duration, 0)}
              aria-valuenow={Math.floor(displayTime)}
              aria-valuetext={`${currentLabel} / ${formatAudioTime(duration)}`}
              className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed rounded-[6px] ${FOCUS_RING}`}
            />
          </div>
        </div>
      </div>

      {/* Footer: download + status/retry */}
      <div className="mt-5 pt-4 flex items-center justify-between border-t border-border/60">
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={downloading || loading}
          aria-label={downloading ? t.downloading : t.download}
          title={t.download}
          className={[
            "group/dl inline-flex items-center gap-2 rounded-[6px] text-muted-foreground",
            "hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            FOCUS_RING,
          ].join(" ")}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-muted/60 group-hover/dl:bg-brand/10 transition-colors">
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
          <span className="text-[10px] font-extrabold tracking-[0.2em] uppercase">
            {t.download}
          </span>
        </button>

        {errored ? (
          <button
            type="button"
            onClick={() => void player.loadAndPlay(meta)}
            className={`text-[11px] font-semibold text-brand underline hover:no-underline rounded-[6px] ${FOCUS_RING}`}
          >
            {t.retry}
          </button>
        ) : loading ? (
          <span className="text-[10px] font-medium text-muted-foreground italic">
            {t.loading}
          </span>
        ) : null}
      </div>
    </aside>
  );
}

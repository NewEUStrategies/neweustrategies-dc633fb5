// Widget odsłuchu w sidebarze - premium karta nad "Spis treści".
// Steruje globalnym playerem: pierwsze kliknięcie ładuje audio i uruchamia
// odtwarzanie, kolejne przełączają play/pause. Po zmianie strony bottom bar
// przejmuje kontrolę bez utraty ciągłości.
import { useMemo, useState } from "react";
import { Loader2, Download, Play, Pause } from "@/lib/lucide-shim";
import { toast } from "sonner";

const HeadphonesIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
    <path d="M21 14a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3v4Z" />
    <path d="M3 14a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H3v4Z" />
  </svg>
);
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
    subLoading: "Generuję audio…",
    subReady: "Odsłuch materiału",
    approx: "ok. {min} min",
    play: "Odtwórz",
    pause: "Pauza",
    download: "Pobierz MP3",
    downloading: "Pobieram audio…",
    downloadFailed: "Nie udało się pobrać audio",
    retry: "Spróbuj ponownie",
    error: "Nie udało się wygenerować audio",
    seek: "Przewiń materiał",
  },
  en: {
    label: "Listen to this article",
    subLoading: "Generating audio…",
    subReady: "Audio playback",
    approx: "~{min} min",
    play: "Play",
    pause: "Pause",
    download: "Download MP3",
    downloading: "Downloading audio…",
    downloadFailed: "Download failed",
    retry: "Try again",
    error: "Could not generate audio",
    seek: "Seek audio",
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
        (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/"),
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
      // Jeśli to nie jest aktywny track, załaduj go najpierw.
      if (!isThis) await player.loadAndPlay(meta);
      await player.download();
    } catch {
      toast.error(t.downloadFailed);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <aside
      aria-label={t.label}
      className="relative overflow-hidden rounded-[5px] border border-border/70 bg-gradient-to-br from-brand/8 via-background to-background p-3.5"
    >
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-brand/20 blur-3xl"
      />

      <div className="relative flex items-center gap-2.5 mb-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand/15">
          <HeadphonesIcon className="h-3.5 w-3.5 text-brand" />
        </span>
        <span className="text-[11px] font-extrabold tracking-[0.18em] uppercase text-foreground">
          {t.label}
        </span>
      </div>

      <div className="relative flex items-center gap-3">
        <button
          type="button"
          onClick={onPrimary}
          disabled={loading}
          aria-label={playing ? t.pause : t.play}
          aria-pressed={playing}
          className={[
            "group relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
            "bg-brand text-brand-foreground shadow-lg shadow-brand/25",
            "hover:brightness-110 hover:shadow-brand/40 active:scale-95",
            "transition disabled:opacity-70",
            FOCUS_RING,
          ].join(" ")}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : playing ? (
            <Pause className="h-5 w-5" aria-hidden />
          ) : (
            <Play className="h-5 w-5 translate-x-[1px]" aria-hidden />
          )}
          {playing && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-brand/40 animate-ping"
              style={{ animationDuration: "1.8s" }}
            />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-foreground truncate">
            {loading ? t.subLoading : errored ? t.error : t.subReady}
          </div>
          <div
            className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums"
            aria-live="off"
          >
            {showProgress ? (
              <>
                <span>{formatAudioTime(displayTime)}</span>
                <span aria-hidden>/</span>
                <span>{formatAudioTime(duration)}</span>
              </>
            ) : approxMin ? (
              <span>{t.approx.replace("{min}", String(approxMin))}</span>
            ) : (
              <span>MP3</span>
            )}
          </div>
        </div>
      </div>

      {/* Slider */}
      <div
        className={[
          "relative mt-3 h-4 flex items-center",
          "rounded-full",
          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
        ].join(" ")}
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-muted" />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-brand transition-[width] duration-150"
          style={{ width: `${displayPct}%` }}
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
          aria-valuetext={`${formatAudioTime(displayTime)} / ${formatAudioTime(duration)}`}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </div>

      {/* Akcje */}
      <div className="relative mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void onDownload()}
          disabled={downloading || loading}
          className={[
            "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1.5",
            "text-[11px] font-semibold text-muted-foreground",
            "hover:text-brand hover:bg-background border border-border/60",
            "transition disabled:opacity-50 disabled:cursor-not-allowed",
            FOCUS_RING,
          ].join(" ")}
          aria-label={downloading ? t.downloading : t.download}
          title={t.download}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>MP3</span>
        </button>
        {errored && (
          <button
            type="button"
            onClick={() => void player.loadAndPlay(meta)}
            className={`text-[11px] font-semibold text-brand underline hover:no-underline ml-auto rounded-sm ${FOCUS_RING}`}
          >
            {t.retry}
          </button>
        )}
      </div>
    </aside>
  );
}

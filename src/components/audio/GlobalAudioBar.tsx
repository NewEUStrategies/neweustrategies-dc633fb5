// Trwały bottom bar globalnego odtwarzacza audio. Renderowany raz w __root,
// widoczny tylko gdy w playerze siedzi jakiś track. Płynnie pojawia się gdy
// user uruchomi odsłuch, przetrwa zmiany stron.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Download, Play, Pause, X, Share2 } from "@/lib/lucide-shim";
import { formatAudioTime, useGlobalAudioPlayer } from "@/lib/audio/global-player";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

import { promptDialog } from "@/lib/appDialogs";
function ActionTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="rounded-[6px] text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const COPY = {
  pl: {
    play: "Odtwórz",
    pause: "Pauza",
    download: "Pobierz MP3",
    downloading: "Pobieram audio…",
    downloadFailed: "Nie udało się pobrać audio",
    share: "Udostępnij link do artykułu",
    close: "Zamknij odtwarzacz",
    seek: "Przewiń materiał",
    copied: "Skopiowano link do artykułu",
    region: "Odtwarzacz audio",
    error: "Nie udało się wygenerować audio",
    loading: "Generuję audio…",
    stagePreparing: "Przygotowuję tekst",
    stageSynthesizing: "ElevenLabs syntezuje głos",
    stageStreaming: "Pobieram audio",
    stageReady: "Gotowe",
    stageCached: "Z pamięci podręcznej",
  },
  en: {
    play: "Play",
    pause: "Pause",
    download: "Download MP3",
    downloading: "Downloading audio…",
    downloadFailed: "Download failed",
    share: "Share article link",
    close: "Close player",
    seek: "Seek audio",
    copied: "Article link copied",
    region: "Audio player",
    error: "Could not generate audio",
    loading: "Generating audio…",
    stagePreparing: "Preparing text",
    stageSynthesizing: "ElevenLabs synthesizing voice",
    stageStreaming: "Streaming audio",
    stageReady: "Ready",
    stageCached: "From cache",
  },
} as const;

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

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function GlobalAudioBar() {
  const player = useGlobalAudioPlayer();
  const [mounted, setMounted] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Powiadomienie o nieudanej syntezie. Musi żyć nad wczesnym returnem (reguły
  // hooków) i działać nawet gdy `track` jest null - błąd na pierwszym podejściu
  // (np. 402/429) nie ustawia tracka, więc bar się nie renderuje i toast jest
  // jedynym sygnałem. Odpalamy raz na przejście statusu w "error" (poprzedni
  // status w ref). Współdzielony `id` deduplikuje toast z SidebarListenCard.
  const prevStatusRef = useRef(player.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = player.status;
    if (prev !== "error" && player.status === "error") {
      toast.error(player.error ?? "Nie udało się wygenerować audio / Could not generate audio", {
        id: "tts-error",
      });
    }
  }, [player.status, player.error]);

  if (!mounted || !player.track) return null;

  const { track } = player;
  const t = COPY[track.lang];
  const loading = player.status === "loading";
  const playing = player.status === "playing";
  const tts = player.tts;
  const stageLabel = (() => {
    switch (tts.stage) {
      case "preparing":
        return t.stagePreparing;
      case "synthesizing":
        return t.stageSynthesizing;
      case "streaming":
        return t.stageStreaming;
      case "ready":
        return t.stageReady;
      case "cached":
        return t.stageCached;
      default:
        return t.loading;
    }
  })();
  const stagePct = tts.stage === "streaming" && tts.percent > 0 ? tts.percent : null;
  const duration = player.duration || 0;
  const displayTime = scrub ?? player.currentTime;
  const displayPct = duration > 0 ? (displayTime / duration) * 100 : 0;

  const commitSeek = (v: number) => {
    player.seek(v);
    setScrub(null);
  };

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await player.download();
    } catch {
      toast.error(t.downloadFailed);
    } finally {
      setDownloading(false);
    }
  };

  const onShare = async () => {
    // Zawsze udostępniamy link do materiału (artykułu), nie plik audio.
    const url = new URL(track.postHref, window.location.origin).toString();
    const shareData = { title: track.title, url } as ShareData;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share(shareData);
        return;
      }
    } catch (err) {
      // Użytkownik anulował — nie fallbackujemy.
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t.copied);
    } catch {
      // Ostateczny fallback: dialog z adresem do skopiowania.
      void promptDialog({ title: t.share, defaultValue: url, confirmLabel: "OK" });
    }
  };

  return (
    <div
      role="region"
      aria-label={t.region}
      className="fixed inset-x-0 bottom-0 z-[70] pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-[1400px] px-3 pb-3 sm:px-5 sm:pb-4">
        <div
          className={[
            "relative overflow-hidden rounded-2xl border border-border/70",
            "bg-background/85 backdrop-blur-xl",
            "shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)]",
            "animate-in slide-in-from-bottom-8 fade-in duration-500",
          ].join(" ")}
        >
          {/* Progress line na górze */}
          <div className="absolute inset-x-0 top-0 h-[3px] bg-muted/50" aria-hidden>
            <div
              className="h-full bg-brand transition-[width] duration-150"
              style={{ width: `${displayPct}%` }}
            />
          </div>

          <div className="flex items-center gap-3 sm:gap-4 px-3 py-2.5 sm:px-4 sm:py-3">
            {/* Play/pause */}
            <button
              type="button"
              onClick={() => void player.toggle()}
              disabled={loading}
              aria-label={playing ? t.pause : t.play}
              aria-pressed={playing}
              className={[
                "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                "bg-brand text-brand-foreground shadow-md",
                "hover:brightness-110 active:scale-95 transition disabled:opacity-70",
                FOCUS_RING,
              ].join(" ")}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : playing ? (
                <Pause className="h-5 w-5" aria-hidden strokeWidth={2.5} />
              ) : (
                <Play className="h-5 w-5 translate-x-[1px]" aria-hidden strokeWidth={2.5} />
              )}
            </button>

            {/* Info + progress */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <HeadphonesIcon className="h-3.5 w-3.5 shrink-0 text-brand" />
                <a
                  href={track.postHref}
                  className={[
                    "text-[13px] sm:text-sm font-semibold text-foreground truncate",
                    "hover:text-brand transition-colors rounded-sm",
                    FOCUS_RING,
                  ].join(" ")}
                  title={track.title}
                >
                  {track.title}
                </a>
                {track.author && (
                  <span className="hidden md:inline text-xs text-muted-foreground truncate">
                    ·{" "}
                    {track.authorHref ? (
                      <a
                        href={track.authorHref}
                        className={`hover:text-foreground transition-colors rounded-sm ${FOCUS_RING}`}
                      >
                        {track.author}
                      </a>
                    ) : (
                      track.author
                    )}
                  </span>
                )}
              </div>

              {loading ? (
                /* Postęp syntezy TTS zamiast osi czasu (mirror SidebarListenCard). */
                <div
                  className="mt-1.5 flex items-center gap-2"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
                    <span className="absolute inset-0 rounded-full bg-brand animate-ping opacity-75" />
                    <span className="relative rounded-full bg-brand h-1.5 w-1.5" />
                  </span>
                  <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground tabular-nums">
                    {stageLabel}
                    {stagePct !== null ? ` · ${stagePct}%` : null}
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-2">
                  <span
                    className="text-[11px] tabular-nums text-muted-foreground shrink-0 w-9 text-right"
                    aria-hidden
                  >
                    {formatAudioTime(displayTime)}
                  </span>

                  {/* Slider (natywny range dla pełnej a11y + klawiatury) */}
                  <div
                    className={[
                      "relative h-4 flex-1 flex items-center group",
                      "rounded-full",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                    ].join(" ")}
                  >
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-muted" />
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-brand"
                      style={{ width: `${displayPct}%` }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-brand shadow ring-2 ring-background opacity-0 group-hover:opacity-100 transition"
                      style={{ left: `calc(${displayPct}% - 6px)` }}
                      aria-hidden
                    />
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={displayTime}
                      disabled={duration <= 0}
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
                      className="absolute inset-0 w-full h-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    />
                  </div>

                  <span
                    className="text-[11px] tabular-nums text-muted-foreground shrink-0 w-9"
                    aria-hidden
                  >
                    {formatAudioTime(duration)}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <TooltipProvider delayDuration={200}>
                <ActionTip label={downloading ? t.downloading : t.download}>
                  <button
                    type="button"
                    onClick={() => void onDownload()}
                    disabled={downloading || loading}
                    aria-label={downloading ? t.downloading : t.download}
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-[6px]",
                      "text-muted-foreground hover:text-brand hover:bg-muted transition",
                      "disabled:opacity-60 disabled:cursor-not-allowed",
                      FOCUS_RING,
                    ].join(" ")}
                  >
                    {downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Download className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </ActionTip>
                <ActionTip label={t.share}>
                  <button
                    type="button"
                    onClick={() => void onShare()}
                    aria-label={t.share}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-muted-foreground hover:text-brand hover:bg-muted transition ${FOCUS_RING}`}
                  >
                    <Share2 className="h-4 w-4" aria-hidden />
                  </button>
                </ActionTip>
                <ActionTip label={t.close}>
                  <button
                    type="button"
                    onClick={() => player.close()}
                    aria-label={t.close}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-muted-foreground hover:text-destructive hover:bg-muted transition ${FOCUS_RING}`}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </ActionTip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

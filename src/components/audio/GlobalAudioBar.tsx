// Trwały bottom bar globalnego odtwarzacza audio. Renderowany raz w __root,
// widoczny tylko gdy w playerze siedzi jakiś track. Płynnie pojawia się gdy
// user uruchomi odsłuch, przetrwa zmiany stron.
import { useEffect, useState } from "react";
import { Loader2, Download, Play, Pause, X, Share2 } from "@/lib/lucide-shim";
import { formatAudioTime, useGlobalAudioPlayer } from "@/lib/audio/global-player";
import { toast } from "sonner";

const COPY = {
  pl: {
    play: "Odtwórz",
    pause: "Pauza",
    download: "Pobierz MP3",
    share: "Udostępnij link do artykułu",
    close: "Zamknij",
    goToArticle: "Otwórz artykuł",
    copied: "Skopiowano link do artykułu",
  },
  en: {
    play: "Play",
    pause: "Pause",
    download: "Download MP3",
    share: "Share article link",
    close: "Close",
    goToArticle: "Open article",
    copied: "Article link copied",
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

export function GlobalAudioBar() {
  const player = useGlobalAudioPlayer();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !player.track) return null;

  const { track } = player;
  const t = COPY[track.lang];
  const loading = player.status === "loading";
  const playing = player.status === "playing";

  const onSeek = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    player.seekPct(pct);
  };

  const onShare = async () => {
    const url = new URL(track.postHref, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: track.title, url });
        return;
      }
    } catch {
      /* user anulował */
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t.copied);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      role="region"
      aria-label={t.play}
      className={[
        "fixed inset-x-0 bottom-0 z-[70]",
        "pointer-events-none",
      ].join(" ")}
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
          <div className="absolute inset-x-0 top-0 h-[3px] bg-muted/50">
            <div
              className="h-full bg-brand transition-[width] duration-150"
              style={{ width: `${player.progress}%` }}
            />
          </div>

          <div className="flex items-center gap-3 sm:gap-4 px-3 py-2.5 sm:px-4 sm:py-3">
            {/* Play/pause */}
            <button
              type="button"
              onClick={() => void player.toggle()}
              disabled={loading}
              aria-label={playing ? t.pause : t.play}
              className={[
                "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                "bg-brand text-brand-foreground shadow-md",
                "hover:brightness-110 active:scale-95 transition disabled:opacity-70",
              ].join(" ")}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : playing ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5 translate-x-[1px]" />
              )}
            </button>

            {/* Info + progress */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <HeadphonesIcon className="h-3.5 w-3.5 shrink-0 text-brand" />
                <a
                  href={track.postHref}
                  className="text-[13px] sm:text-sm font-semibold text-foreground truncate hover:text-brand transition-colors"
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
                        className="hover:text-foreground transition-colors"
                      >
                        {track.author}
                      </a>
                    ) : (
                      track.author
                    )}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-muted-foreground shrink-0 w-9 text-right">
                  {formatAudioTime(player.currentTime)}
                </span>
                <button
                  type="button"
                  onClick={onSeek}
                  aria-label="Seek"
                  className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden cursor-pointer group"
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-brand"
                    style={{ width: `${player.progress}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-brand shadow ring-2 ring-background opacity-0 group-hover:opacity-100 transition"
                    style={{ left: `calc(${player.progress}% - 6px)` }}
                    aria-hidden
                  />
                </button>
                <span className="text-[11px] tabular-nums text-muted-foreground shrink-0 w-9">
                  {formatAudioTime(player.duration)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void player.download()}
                aria-label={t.download}
                title={t.download}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-brand hover:bg-muted transition"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void onShare()}
                aria-label={t.share}
                title={t.share}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-brand hover:bg-muted transition"
              >
                <Share2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => player.close()}
                aria-label={t.close}
                title={t.close}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-muted transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

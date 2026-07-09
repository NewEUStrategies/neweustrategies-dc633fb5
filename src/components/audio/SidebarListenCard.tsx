// Widget odsłuchu w sidebarze - premium karta nad "Spis treści".
// Steruje globalnym playerem: pierwsze kliknięcie ładuje audio i uruchamia
// odtwarzanie, kolejne przełączają play/pause. Po zmianie strony bottom bar
// przejmuje kontrolę bez utraty ciągłości.
import { useMemo } from "react";
import { Loader2, Download, Play, Pause } from "@/lib/lucide-shim";

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
    retry: "Spróbuj ponownie",
    error: "Nie udało się wygenerować audio",
  },
  en: {
    label: "Listen to this article",
    subLoading: "Generating audio…",
    subReady: "Audio playback",
    approx: "~{min} min",
    play: "Play",
    pause: "Pause",
    download: "Download MP3",
    retry: "Try again",
    error: "Could not generate audio",
  },
} as const;

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

  const onPrimary = () => {
    if (loading) return;
    if (isThis) void player.toggle();
    else void player.loadAndPlay(meta);
  };

  const onSeek = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    player.seekPct(pct);
  };

  const showProgress = isThis && player.duration > 0;

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
          <Headphones className="h-3.5 w-3.5 text-brand" />
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
          className={[
            "group relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
            "bg-brand text-brand-foreground shadow-lg shadow-brand/25",
            "hover:brightness-110 hover:shadow-brand/40 active:scale-95",
            "transition disabled:opacity-70",
          ].join(" ")}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : playing ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 translate-x-[1px]" />
          )}
          {/* Pulse when playing */}
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
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
            {showProgress ? (
              <>
                <span>{formatAudioTime(player.currentTime)}</span>
                <span aria-hidden>/</span>
                <span>{formatAudioTime(player.duration)}</span>
              </>
            ) : approxMin ? (
              <span>{t.approx.replace("{min}", String(approxMin))}</span>
            ) : (
              <span>MP3</span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar - klikalny gdy audio jest załadowane */}
      <div className="relative mt-3">
        <button
          type="button"
          onClick={onSeek}
          disabled={!showProgress}
          aria-label="Seek"
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted cursor-pointer disabled:cursor-default"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-150"
            style={{ width: `${isThis ? player.progress : 0}%` }}
          />
        </button>
      </div>

      {/* Akcje */}
      <div className="relative mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void player.download()}
          disabled={!isThis || loading || errored}
          className={[
            "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1.5",
            "text-[11px] font-semibold text-muted-foreground",
            "hover:text-brand hover:bg-background border border-border/60",
            "transition disabled:opacity-50 disabled:cursor-not-allowed",
          ].join(" ")}
          aria-label={t.download}
          title={t.download}
        >
          <Download className="h-3.5 w-3.5" />
          <span>MP3</span>
        </button>
        {errored && (
          <button
            type="button"
            onClick={() => void player.loadAndPlay(meta)}
            className="text-[11px] font-semibold text-brand underline hover:no-underline ml-auto"
          >
            {t.retry}
          </button>
        )}
      </div>
    </aside>
  );
}

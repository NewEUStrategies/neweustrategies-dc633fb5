// Publiczny pasek odsłuchu artykułu (ElevenLabs TTS).
// Widoczny dla wszystkich (nawet niezalogowanych) - endpoint `/api/public/post-tts`
// spina rate-limity i wczytuje treść server-side, więc klient nie może wypchać
// dowolnego tekstu.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "@/lib/lucide-shim";

interface PostListenBarProps {
  postId: string;
  lang: "pl" | "en";
  /** Szacowany czas czytania w minutach - używany do estymacji długości audio. */
  readMinutes?: number | null;
}

const COPY = {
  pl: {
    listen: "Posłuchaj artykułu",
    listening: "Odtwarzanie…",
    loading: "Generuję audio…",
    pause: "Pauza",
    resume: "Wznów",
    approx: "ok. {min} min",
    error: "Nie udało się wygenerować audio",
    retry: "Spróbuj ponownie",
  },
  en: {
    listen: "Listen to this article",
    listening: "Playing…",
    loading: "Generating audio…",
    pause: "Pause",
    resume: "Resume",
    approx: "~{min} min",
    error: "Could not generate audio",
    retry: "Try again",
  },
} as const;

const PlayIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
  </svg>
);
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

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PostListenBar({ postId, lang, readMinutes }: PostListenBarProps) {
  const t = COPY[lang];
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const approxMinutes = readMinutes && readMinutes > 0 ? Math.max(1, Math.round(readMinutes * 1.15)) : null;

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  const attachEvents = useCallback((audio: HTMLAudioElement) => {
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => {
      setPlaying(false);
      setProgress(0);
      setCurrent(0);
    });
    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration || 0);
    });
    audio.addEventListener("timeupdate", () => {
      const d = audio.duration || 0;
      setCurrent(audio.currentTime);
      setProgress(d > 0 ? (audio.currentTime / d) * 100 : 0);
    });
  }, []);

  const fetchAudio = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/public/post-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, lang }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      attachEvents(audio);
      await audio.play();
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : t.error;
      setError(msg.length > 120 ? t.error : msg);
    } finally {
      setLoading(false);
    }
  }, [postId, lang, t.error, attachEvents]);

  const onToggle = useCallback(async () => {
    if (loading) return;
    const audio = audioRef.current;
    if (audio) {
      if (audio.paused) await audio.play().catch(() => setPlaying(false));
      else audio.pause();
      return;
    }
    await fetchAudio();
  }, [loading, fetchAudio]);

  const onSeek = useCallback((pct: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = (pct / 100) * audio.duration;
  }, []);

  const label = loading
    ? t.loading
    : playing
      ? t.pause
      : audioRef.current
        ? t.resume
        : t.listen;

  return (
    <div
      className="not-prose my-6 flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 backdrop-blur-sm p-4 sm:p-5 shadow-sm"
      data-listen-bar
      aria-label={t.listen}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onToggle}
          disabled={loading}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:brightness-110 active:scale-95 transition disabled:opacity-60"
          aria-label={label}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : playing ? (
            <PauseIcon className="h-5 w-5" />
          ) : (
            <PlayIcon className="h-5 w-5 translate-x-[1px]" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <HeadphonesIcon className="h-4 w-4 opacity-70" />
            <span className="truncate">{label}</span>
            {approxMinutes && !audioRef.current && !loading && (
              <span className="text-xs text-muted-foreground font-normal">
                · {t.approx.replace("{min}", String(approxMinutes))}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              className="relative h-1.5 flex-1 rounded-full bg-muted overflow-hidden cursor-pointer group"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                const pct = ((e.clientX - rect.left) / rect.width) * 100;
                onSeek(Math.min(100, Math.max(0, pct)));
              }}
              aria-label="Seek"
              disabled={!audioRef.current}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </button>
            {duration > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                {formatTime(current)} / {formatTime(duration)}
              </span>
            )}
          </div>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-3 text-xs text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchAudio}
            className="underline hover:no-underline"
          >
            {t.retry}
          </button>
        </div>
      )}
    </div>
  );
}

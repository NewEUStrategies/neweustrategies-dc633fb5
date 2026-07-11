// HTML5 audio podcast player atom - variants: mini/full/sticky.
// World-class UX: keyboard accessible, A11Y labelled, speed control,
// 15s skip, seek slider, time display.
import { useEffect, useId, useRef, useState } from "react";
import { Play, Pause, Rewind, FastForward, Volume2, VolumeX } from "lucide-react";
import { formatDuration } from "@/lib/podcast/types";
import { announcePlayback, subscribePlayback } from "@/lib/audio/playbackBus";

type Variant = "mini" | "full" | "sticky";

interface Props {
  src: string;
  variant?: Variant;
  initialDuration?: number;
  title?: string;
  showSpeed?: boolean;
  autoPlay?: boolean;
  className?: string;
  lang?: "pl" | "en";
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

// Trwałość pozycji odtwarzania per `src` (localStorage). Wspólny prefiks klucza
// z globalnym playerem TTS. Dostęp chroniony pod kątem SSR i trybu prywatnego.
const POSITION_KEY_PREFIX = "audio-pos:";
// Poniżej tego progu (s) nie zapisujemy/nie przywracamy - offset jest trywialny.
const POSITION_MIN_SECONDS = 5;
// Odstęp od końca (s), przy którym uznajemy materiał za "prawie skończony".
const POSITION_END_MARGIN = 5;
// Throttle zapisu pozycji (ms).
const POSITION_SAVE_INTERVAL = 5000;

function positionKey(src: string): string {
  return `${POSITION_KEY_PREFIX}${src}`;
}

function readStoredPosition(src: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(positionKey(src));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeStoredPosition(src: string, seconds: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(positionKey(src), String(Math.floor(seconds)));
  } catch {
    /* private mode / quota - ignorujemy */
  }
}

function clearStoredPosition(src: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(positionKey(src));
  } catch {
    /* noop */
  }
}

/** Czy pozycja `t` w materiale o długości `dur` warta jest zapisania/przywrócenia. */
function isRestorablePosition(t: number, dur: number): boolean {
  if (t <= POSITION_MIN_SECONDS) return false;
  if (Number.isFinite(dur) && dur > 0 && t >= dur - POSITION_END_MARGIN) return false;
  return true;
}

export function PodcastPlayer({
  src,
  variant = "full",
  initialDuration = 0,
  title,
  showSpeed = true,
  autoPlay = false,
  className,
  lang = "pl",
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Unikalny identyfikator instancji na szynie arbitrażu odtwarzania.
  const playerId = useId();
  // Znacznik czasu ostatniego zapisu pozycji (throttle) + strażnik jednorazowego
  // przywrócenia pozycji per `src`.
  const lastSaveRef = useRef(0);
  const restoredSrcRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);

  // Stan `playing` napędzają realne zdarzenia elementu <audio>, nie tylko własny
  // toggle - dzięki temu pauza z zewnątrz (OS, inna karta, szyna arbitrażu) też
  // aktualizuje ikonę. Tu również trwałość/odtworzenie pozycji per `src`.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const maybeRestore = () => {
      if (restoredSrcRef.current === src) return;
      restoredSrcRef.current = src;
      const stored = readStoredPosition(src);
      if (isRestorablePosition(stored, a.duration)) {
        try {
          a.currentTime = stored;
          setTime(stored);
        } catch {
          /* seek niedostępny dla źródła - ignorujemy */
        }
      }
    };

    const onTime = () => {
      setTime(a.currentTime || 0);
      const now = Date.now();
      if (now - lastSaveRef.current >= POSITION_SAVE_INTERVAL) {
        lastSaveRef.current = now;
        if (isRestorablePosition(a.currentTime, a.duration))
          writeStoredPosition(src, a.currentTime);
      }
    };
    const onLoaded = () => {
      setDuration(a.duration || initialDuration);
      maybeRestore();
    };
    const onPlay = () => {
      setPlaying(true);
      // Start ⇒ inne odtwarzacze (inne PodcastPlayer + globalny TTS) pauzują.
      announcePlayback(playerId);
    };
    const onPause = () => {
      setPlaying(false);
      if (isRestorablePosition(a.currentTime, a.duration)) writeStoredPosition(src, a.currentTime);
    };
    const onEnded = () => {
      setPlaying(false);
      clearStoredPosition(src);
    };

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    // Metadane mogą być już dostępne (cache/preload) zanim podpięliśmy listener.
    if (a.readyState >= 1 /* HAVE_METADATA */) {
      setDuration(a.duration || initialDuration);
      maybeRestore();
    }
    // Zsynchronizuj początkowy stan (np. gdy `autoPlay` zdążył wystartować
    // zanim podpięliśmy listenery) i - jeśli już gramy - przejmij szynę.
    if (!a.paused) {
      setPlaying(true);
      announcePlayback(playerId);
    }
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [src, initialDuration, playerId]);

  // Arbitraż: gdy zagra inny player, pauzujemy ten. Pauza wyemituje zdarzenie
  // `pause`, które zsynchronizuje stan/ikonę.
  useEffect(() => {
    const unsubscribe = subscribePlayback((activeId) => {
      if (activeId !== playerId) audioRef.current?.pause();
    });
    return unsubscribe;
  }, [playerId]);

  // Media Session API - lockscreen / klawisze multimedialne + metadane na
  // mobile. Feature-detect + no-op na SSR / w nieobsługiwanych przeglądarkach.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const a = audioRef.current;
    const ms = navigator.mediaSession;
    if (playing) {
      try {
        ms.metadata = new MediaMetadata({ title: title ?? "Podcast" });
      } catch {
        /* MediaMetadata niedostępne - pomijamy metadane */
      }
      const setHandler = (
        action: MediaSessionAction,
        handler: MediaSessionActionHandler | null,
      ) => {
        try {
          ms.setActionHandler(action, handler);
        } catch {
          /* akcja nieobsługiwana w tej przeglądarce */
        }
      };
      setHandler("play", () => {
        void a?.play();
      });
      setHandler("pause", () => {
        a?.pause();
      });
      setHandler("seekbackward", () => {
        if (a) a.currentTime = Math.max(0, a.currentTime - 15);
      });
      setHandler("seekforward", () => {
        if (a) a.currentTime = Math.min(a.duration || 0, a.currentTime + 15);
      });
      setHandler("seekto", (details) => {
        if (a && typeof details.seekTime === "number") a.currentTime = details.seekTime;
      });
    }
    ms.playbackState = playing ? "playing" : "paused";
  }, [playing, title]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // Stan `playing` napędzają zdarzenia audio (patrz efekt wyżej); toggle tylko
  // steruje odtwarzaniem.
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const skip = (delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || duration, a.currentTime + delta));
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = v;
    setTime(v);
  };

  const t = (k: "play" | "pause" | "back" | "fwd" | "speed" | "mute") => {
    const pl = {
      play: "Odtwórz",
      pause: "Pauza",
      back: "−15s",
      fwd: "+15s",
      speed: "Tempo",
      mute: "Wycisz",
    };
    const en = {
      play: "Play",
      pause: "Pause",
      back: "−15s",
      fwd: "+15s",
      speed: "Speed",
      mute: "Mute",
    };
    return (lang === "en" ? en : pl)[k];
  };

  const compact = variant === "mini";

  return (
    <div
      data-podcast-player
      data-variant={variant}
      className={[
        "flex items-center gap-3 rounded-lg border border-border bg-card text-foreground p-3",
        variant === "sticky"
          ? "fixed bottom-0 left-0 right-0 z-30 rounded-none border-x-0 border-b-0 shadow-2xl"
          : "",
        className ?? "",
      ].join(" ")}
      role="region"
      aria-label={title ?? "Podcast"}
    >
      <audio ref={audioRef} src={src} preload="metadata" autoPlay={autoPlay} />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? t("pause") : t("play")}
        className="h-11 w-11 shrink-0 rounded-full bg-brand text-brand-foreground flex items-center justify-center hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
      </button>

      {!compact && (
        <>
          <button
            type="button"
            onClick={() => skip(-15)}
            aria-label={t("back")}
            className="h-9 w-9 rounded-full border border-border flex items-center justify-center text-xs hover:bg-muted"
          >
            <Rewind className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => skip(15)}
            aria-label={t("fwd")}
            className="h-9 w-9 rounded-full border border-border flex items-center justify-center text-xs hover:bg-muted"
          >
            <FastForward className="w-4 h-4" />
          </button>
        </>
      )}

      <div className="flex-1 min-w-0">
        {title && !compact && <div className="text-xs font-medium truncate mb-1">{title}</div>}
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground w-10">
            {formatDuration(time)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={time}
            onChange={onSeek}
            aria-label="Seek"
            className="flex-1 h-1 accent-brand"
          />
          <span className="text-[11px] tabular-nums text-muted-foreground w-12 text-right">
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      {!compact && showSpeed && (
        <select
          aria-label={t("speed")}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="text-xs bg-background border border-border rounded px-1.5 py-1"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      )}

      {!compact && (
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={t("mute")}
          className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

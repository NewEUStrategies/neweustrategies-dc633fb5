// HTML5 audio podcast player atom — variants: mini/full/sticky.
// World-class UX: keyboard accessible, A11Y labelled, speed control,
// 15s skip, seek slider, time display.
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Rewind, FastForward, Volume2, VolumeX } from "lucide-react";
import { formatDuration } from "@/lib/podcast/types";

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
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime || 0);
    const onLoaded = () => setDuration(a.duration || initialDuration);
    const onEnded = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("ended", onEnded);
    };
  }, [initialDuration]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed]);
  useEffect(() => { if (audioRef.current) audioRef.current.muted = muted; }, [muted]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { void a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  };

  const skip = (delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min((a.duration || duration), a.currentTime + delta));
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = v;
    setTime(v);
  };

  const t = (k: "play" | "pause" | "back" | "fwd" | "speed" | "mute") => {
    const pl = { play: "Odtwórz", pause: "Pauza", back: "−15s", fwd: "+15s", speed: "Tempo", mute: "Wycisz" };
    const en = { play: "Play", pause: "Pause", back: "−15s", fwd: "+15s", speed: "Speed", mute: "Mute" };
    return (lang === "en" ? en : pl)[k];
  };

  const compact = variant === "mini";

  return (
    <div
      data-podcast-player
      data-variant={variant}
      className={[
        "flex items-center gap-3 rounded-lg border border-border bg-card text-foreground p-3",
        variant === "sticky" ? "fixed bottom-0 left-0 right-0 z-30 rounded-none border-x-0 border-b-0 shadow-2xl" : "",
        className ?? "",
      ].join(" ")}
      role="region"
      aria-label={title ?? "Podcast"}
    >
      <audio ref={audioRef} src={src} preload="metadata" autoPlay={autoPlay} />

      <button
        type="button" onClick={toggle}
        aria-label={playing ? t("pause") : t("play")}
        className="h-11 w-11 shrink-0 rounded-full bg-brand text-brand-foreground flex items-center justify-center hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
      </button>

      {!compact && (
        <>
          <button type="button" onClick={() => skip(-15)} aria-label={t("back")} className="h-9 w-9 rounded-full border border-border flex items-center justify-center text-xs hover:bg-muted">
            <Rewind className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => skip(15)} aria-label={t("fwd")} className="h-9 w-9 rounded-full border border-border flex items-center justify-center text-xs hover:bg-muted">
            <FastForward className="w-4 h-4" />
          </button>
        </>
      )}

      <div className="flex-1 min-w-0">
        {title && !compact && <div className="text-xs font-medium truncate mb-1">{title}</div>}
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground w-10">{formatDuration(time)}</span>
          <input
            type="range" min={0} max={duration || 0} step={1} value={time} onChange={onSeek}
            aria-label="Seek"
            className="flex-1 h-1 accent-brand"
          />
          <span className="text-[11px] tabular-nums text-muted-foreground w-12 text-right">{formatDuration(duration)}</span>
        </div>
      </div>

      {!compact && showSpeed && (
        <select
          aria-label={t("speed")}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="text-xs bg-background border border-border rounded px-1.5 py-1"
        >
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      )}

      {!compact && (
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={t("mute")} className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

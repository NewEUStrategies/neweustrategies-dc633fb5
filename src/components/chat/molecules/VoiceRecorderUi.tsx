// Nagrywanie i odsłuch wiadomości głosowej. Nagranie nigdy nie wychodzi samo:
// "stop" przenosi do odsłuchu, gdzie użytkownik wybiera Wyślij albo Usuń.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Send, Trash2 } from "@/lib/lucide-shim";
import { formatVoiceDuration, type RecordedVoice } from "@/lib/chat/voice";
import { cn } from "@/lib/utils";

const BAR_COUNT = 12;

function Equalizer({ active }: { active: boolean }) {
  return (
    <div className="flex h-4 items-center gap-0.5" aria-hidden>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          className={cn(
            "voice-eq-bar w-0.5 rounded-full bg-primary",
            active ? "voice-eq-bar--active" : "h-0.5",
          )}
          style={{ animationDelay: `${i * 0.05}s`, animationDuration: `${0.8 + (i % 4) * 0.12}s` }}
        />
      ))}
    </div>
  );
}

const iconBtn = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors";

export function VoiceRecordingBar({
  elapsed,
  onCancel,
  onStop,
  labels,
}: {
  elapsed: string;
  onCancel: () => void;
  onStop: () => void;
  labels: { recording: string; cancel: string; stop: string };
}) {
  return (
    <div
      className="voice-pill-enter flex h-10 items-center gap-2 rounded-full border border-input bg-card px-1.5"
      role="status"
      aria-label={labels.recording}
    >
      <button
        type="button"
        onClick={onCancel}
        className={cn(iconBtn, "text-muted-foreground hover:bg-muted hover:text-destructive")}
        aria-label={labels.cancel}
        title={labels.cancel}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <Equalizer active />
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
          {elapsed}
        </span>
      </div>
      <button
        type="button"
        onClick={onStop}
        className={cn(iconBtn, "border border-input hover:bg-muted")}
        aria-label={labels.stop}
        title={labels.stop}
      >
        <span className="voice-stop-square h-3.5 w-3.5 rounded-sm bg-primary" aria-hidden />
      </button>
    </div>
  );
}

export function VoiceReview({
  voice,
  onDelete,
  onSend,
  labels,
}: {
  voice: RecordedVoice;
  onDelete: () => void;
  onSend: () => void;
  labels: { review: string; delete: string; send: string };
}) {
  const url = useMemo(() => URL.createObjectURL(voice.file), [voice.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const progress = Math.min(1, position / Math.max(1, voice.durationSeconds));

  return (
    <div
      className="voice-pill-enter flex h-10 items-center gap-2 rounded-full border border-input bg-card px-1.5"
      role="group"
      aria-label={labels.review}
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
      />
      <button
        type="button"
        onClick={onDelete}
        className={cn(iconBtn, "text-muted-foreground hover:bg-muted hover:text-destructive")}
        aria-label={labels.delete}
        title={labels.delete}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={toggle}
        className={cn(iconBtn, "border border-input hover:bg-muted")}
        aria-label={labels.review}
        title={labels.review}
      >
        {playing ? (
          <Pause className="h-4 w-4" aria-hidden />
        ) : (
          <Play className="h-4 w-4" aria-hidden />
        )}
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
          {formatVoiceDuration(
            playing || position > 0 ? Math.floor(position) : voice.durationSeconds,
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={onSend}
        className={cn(iconBtn, "bg-primary text-primary-foreground hover:opacity-90")}
        aria-label={labels.send}
        title={labels.send}
      >
        <Send className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

// Wspólny wskaźnik nagrywania dla wszystkich mikrofonów (czat, wyszukiwarka,
// widget wyszukiwania) - wzorzec VoiceInput: obracający się kwadrat "stop",
// a obok płynnie rozwijany pasek z falującymi słupkami i licznikiem czasu.
// Animacje (voice-eq-bar, voice-stop-square, voice-pill-enter) w styles.css,
// z obsługą prefers-reduced-motion.
import { useEffect, useState } from "react";
import { formatVoiceDuration } from "@/lib/chat/voice";
import { cn } from "@/lib/utils";

const BAR_COUNT = 12;

export function VoiceListeningIndicator({ className }: { className?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={cn("inline-flex items-center", className)} data-voice-listening="" aria-hidden>
      <span className="flex h-5 w-5 items-center justify-center">
        <span className="voice-stop-square h-3.5 w-3.5 rounded-sm bg-primary" />
      </span>
      <span className="voice-pill-enter ml-2 flex items-center gap-2 overflow-hidden">
        <span className="flex h-4 items-center gap-0.5">
          {Array.from({ length: BAR_COUNT }, (_, i) => (
            <span
              key={i}
              className="voice-eq-bar voice-eq-bar--active w-0.5 rounded-full bg-primary"
              style={{ animationDelay: `${i * 0.05}s`, animationDuration: `${0.8 + (i % 4) * 0.12}s` }}
            />
          ))}
        </span>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
          {formatVoiceDuration(seconds)}
        </span>
      </span>
    </span>
  );
}

// Wspólny wskaźnik nagrywania dla wszystkich mikrofonów (czat, wyszukiwarka,
// widget wyszukiwania): falujące słupki + obracający się kwadrat "stop".
// Animacje (voice-eq-bar, voice-stop-square, voice-pill-enter) w styles.css,
// z obsługą prefers-reduced-motion.
import { cn } from "@/lib/utils";

const BAR_COUNT = 5;

export function VoiceListeningIndicator({ className }: { className?: string }) {
  return (
    <span
      className={cn("voice-pill-enter inline-flex items-center gap-1.5", className)}
      data-voice-listening=""
      aria-hidden
    >
      <span className="flex h-4 items-center gap-0.5">
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span
            key={i}
            className="voice-eq-bar voice-eq-bar--active w-0.5 rounded-full bg-primary"
            style={{ animationDelay: `${i * 0.05}s`, animationDuration: `${0.8 + (i % 4) * 0.12}s` }}
          />
        ))}
      </span>
      <span className="voice-stop-square h-3 w-3 rounded-sm bg-primary" />
    </span>
  );
}

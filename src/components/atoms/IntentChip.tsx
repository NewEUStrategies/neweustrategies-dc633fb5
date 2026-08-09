// Atom: chip intencji profilu ("Konsorcja", "Doradztwo").
//
// Dwa tryby, jedna prezentacja: `readOnly` renderuje znacznik (span), tryb
// interaktywny renderuje przycisk-toggle z `aria-pressed`. To celowo NIE jest
// checkbox - w edytorze intencji chipy zachowują się jak przełączniki tagów,
// a nie jak lista formularza, i czytnik ekranu ma to usłyszeć tak samo.
//
// Kolorystyka wyłącznie z tokenów semantycznych (brand / muted / border),
// zero własnych barw - chip pojawia się i w katalogu, i na karcie sugestii,
// i w edytorze, więc musi wyglądać identycznie w każdym motywie.
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface IntentChipProps {
  label: string;
  /** Pełna etykieta dla technologii asystujących, gdy `label` jest skrócony. */
  ariaLabel?: string;
  selected?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  className?: string;
}

const BASE =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium leading-none transition-colors";

export function IntentChip({

  label,
  ariaLabel,
  selected = false,
  readOnly = false,
  disabled = false,
  onToggle,
  className,
}: IntentChipProps) {
  if (readOnly) {
    return (
      <span
        className={cn(
          BASE,
          "border-[var(--brand)]/30 bg-[var(--brand)]/5 text-[var(--brand)]",
          className,
        )}
        title={ariaLabel ?? label}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        BASE,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-[var(--brand)]/50 bg-[var(--brand)]/10 text-[var(--brand)]"
          : "border-border/70 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground",
        disabled &&
          "cursor-not-allowed opacity-50 hover:border-border/70 hover:text-muted-foreground",
        className,
      )}
    >
      {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}

      <span className="truncate">{label}</span>
    </button>
  );
}

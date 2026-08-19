// Atom: przycisk ikonowy odtwarzacza (−15 s / +15 s / tempo / pobierz /
// udostępnij / zamknij, oraz główny przycisk odtwarzania w wariancie `primary`).
//
// POWSTAŁ Z OŚMIU KOPII JSX: siedmiu w `GlobalAudioBar` i trzech w
// `SidebarListenCard` (część się pokrywa funkcją, nie kodem). Dowód duplikacji
// nie z oka: stała `FOCUS_RING` była ZADEKLAROWANA DWA RAZY, po jednej kopii
// w każdym pliku - a to jedyna rzecz w tym rzędzie, która odpowiada za
// widoczność fokusu klawiatury. Jeden atom = jeden pierścień fokusu, jeden
// kontrakt `aria-label`/`aria-pressed`/`disabled` dla wszystkich.
import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Widoczny pierścień fokusu. Jedno miejsce, w którym o nim decydujemy - i to
 * jest cały powód istnienia tego atomu.
 */
export const AUDIO_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Warianty geometrii. `primary` to duży przycisk odtwarzania, resztę robi rząd. */
export const AUDIO_ICON_BUTTON_VARIANTS = {
  primary:
    "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] bg-brand text-brand-foreground shadow-md overflow-hidden hover:brightness-110 active:scale-95 transition disabled:opacity-70",
  outline:
    "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-brand hover:bg-muted transition disabled:opacity-50",
  ghost:
    "inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-muted-foreground hover:text-brand hover:bg-muted transition disabled:opacity-50",
  danger:
    "inline-flex h-9 w-9 items-center justify-center rounded-[6px] text-muted-foreground hover:text-destructive hover:bg-muted transition disabled:opacity-50",
} as const;

export type AudioIconButtonVariant = keyof typeof AUDIO_ICON_BUTTON_VARIANTS;

export interface AudioIconButtonProps {
  /** Etykieta dostępna - JEDYNA nazwa przycisku (ikona jest dekoracją). */
  label: string;
  onClick: () => void;
  icon?: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  /** Treść zamiast ikony (spinner w trakcie generowania, morfująca ikona play). */
  children?: ReactNode;
  variant?: AudioIconButtonVariant;
  disabled?: boolean;
  /**
   * Przyciski PRZEŁĄCZAJĄCE (odtwarzanie) ogłaszają stan przez `aria-pressed`.
   * Przyciski akcji (pobierz, zamknij, ±15 s) zostawiają `undefined` i nie
   * ogłaszają stanu, którego nie mają - kopia numer trzy w `GlobalAudioBar`
   * miała `aria-pressed` na przycisku pobierania, czyli stan bez znaczenia.
   */
  pressed?: boolean;
  /** Trwająca operacja - `aria-busy` dla czytnika ekranu. */
  busy?: boolean;
  className?: string;
  iconClassName?: string;
}

export function AudioIconButton({
  label,
  onClick,
  icon: Icon,
  children,
  variant = "ghost",
  disabled,
  pressed,
  busy,
  className,
  iconClassName = "h-4 w-4",
}: AudioIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || undefined}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      className={cn(AUDIO_ICON_BUTTON_VARIANTS[variant], AUDIO_FOCUS_RING, className)}
    >
      {children ?? (Icon ? <Icon className={iconClassName} aria-hidden /> : null)}
    </button>
  );
}

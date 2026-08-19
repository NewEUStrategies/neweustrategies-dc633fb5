// Atom: kwadratowy przycisk ikonowy pasków artykułu (udostępnij cytat na X,
// LinkedIn, kopiuj cytat; kciuki w ankiecie przydatności).
//
// POWSTAŁ Z TRZECH KOPII JSX w `QuoteShareBar` - każda z własnym, identycznym
// łańcuchem klas, własnym `aria-label` i własnym `title` powtórzonym z etykiety.
// Trzy kopie tego samego przycisku to trzy miejsca, w których można zgubić
// kontrakt dostępności; jeden atom to jedno miejsce.
import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

/** Wspólna geometria przycisku ikonowego paska. */
export const POST_ICON_BUTTON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition disabled:opacity-60";

export interface PostIconButtonProps {
  /**
   * Etykieta dostępna - trafia JEDNOCZEŚNIE do `aria-label` i `title`, więc
   * dymek przeglądarki i czytnik ekranu nie mogą powiedzieć czegoś innego.
   */
  label: string;
  onClick: () => void;
  /** Ikona jako dekoracja; alternatywnie dowolna treść przez `children`. */
  icon?: ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
  children?: ReactNode;
  disabled?: boolean;
  /** Przyciski PRZEŁĄCZAJĄCE ogłaszają stan; przyciski akcji zostawiają `undefined`. */
  pressed?: boolean;
  className?: string;
}

export function PostIconButton({
  label,
  onClick,
  icon: Icon,
  children,
  disabled,
  pressed,
  className,
}: PostIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || undefined}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(POST_ICON_BUTTON_CLASS, className)}
    >
      {children ?? (Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null)}
    </button>
  );
}

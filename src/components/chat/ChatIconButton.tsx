// Atom: okrągły przycisk ikonowy nagłówka rozmowy (szukaj / media / menu /
// minimalizuj / zamknij).
//
// Powstał z czterech niemal identycznych bloków JSX w `ChatWindow` - każdy
// z własnym `Tooltip`, własnym łańcuchem klas i własnym `aria-label`. Kopia
// numer trzy zgubiła `aria-pressed`, kopia numer cztery `aria-hidden` na
// ikonie: dokładnie tak psuje się dostępność w powtórzonym kodzie. Jeden atom
// = jeden kontrakt a11y dla wszystkich przycisków tego rzędu.
import type { ComponentType } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ChatIconButtonProps {
  /** Ikona z `lucide-react` (renderowana jako dekoracja, nigdy jako treść). */
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Etykieta dostępna i treść tooltipa - jedno źródło, więc nie mogą się rozjechać. */
  label: string;
  onClick: () => void;
  /**
   * Przyciski PRZEŁĄCZAJĄCE (szukaj, media) podają stan: dostają `aria-pressed`
   * i podświetlenie tła. Przyciski akcji (zamknij, minimalizuj) zostawiają
   * `undefined` i nie ogłaszają stanu, którego nie mają.
   */
  pressed?: boolean;
  /** Menu rozmowy zamiast `aria-pressed` deklaruje `aria-haspopup="menu"`. */
  hasPopup?: "menu" | "dialog";
  className?: string;
}

/**
 * Wspólna geometria rzędu akcji nagłówka - h-7/w-7 w obu wariantach okna.
 * Eksportowana, bo wyzwalacz menu rozmowy musi wpleść `PopoverTrigger` między
 * tooltip i przycisk, więc składa własny element, ale MA wyglądać identycznie.
 */
export const CHAT_ICON_BUTTON_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Klasa aktywnego (wciśniętego) przycisku przełączającego. */
export const CHAT_ICON_BUTTON_PRESSED_CLASS = "bg-muted text-foreground";

export function ChatIconButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  hasPopup,
  className,
}: ChatIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            CHAT_ICON_BUTTON_CLASS,
            pressed && CHAT_ICON_BUTTON_PRESSED_CLASS,
            className,
          )}
          aria-label={label}
          aria-pressed={pressed}
          aria-haspopup={hasPopup}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

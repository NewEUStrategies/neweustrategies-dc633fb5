// Tytuł jako ETYKIETA INLINE.
//
// DLACZEGO. Tytuł wątku, wydarzenia, dokumentu i etapu stoją w jednej kolumnie
// jeden pod drugim. Gdy każdy z nich jest zwykłym nagłówkiem, karty czytają się
// jak jedna ściana tekstu i nie widać, gdzie kończy się jeden element, a zaczyna
// drugi. Etykieta inline (tło + krawędź + promień 6 px) domyka tytuł do jego
// własnego pudełka i od razu rozróżnia rodzaj elementu tonem akcentu.
//
// TRYB JASNY I CIEMNY. Żadnych wartości hex ani `text-white`: ton to zawsze
// `color-mix` na tokenach (`bg-primary/10`), więc kontrast jedzie za motywem.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ClubInlineTitleTone = "thread" | "event" | "document" | "milestone" | "neutral";

export type ClubInlineTitleSize = "sm" | "md" | "lg";

/** Ton = rodzaj elementu. Tylko tokeny semantyczne - działa w obu motywach. */
const TONES: Record<ClubInlineTitleTone, string> = {
  thread: "border-primary/30 bg-primary/10",
  event: "border-sky-500/30 bg-sky-500/10",
  document: "border-border/70 bg-muted/60",
  milestone: "border-emerald-500/30 bg-emerald-500/10",
  neutral: "border-border/70 bg-muted/50",
};

const SIZES: Record<ClubInlineTitleSize, string> = {
  sm: "px-2 py-0.5 text-sm font-medium",
  md: "px-2.5 py-1 text-base font-semibold",
  lg: "px-3 py-1.5 text-lg font-semibold sm:text-xl",
};

/**
 * Etykieta tytułu. Renderuje `<span>` wewnątrz nagłówka nadrzędnego, więc
 * hierarchia dokumentu (h2/h3) zostaje po stronie wywołującego.
 */
export function ClubInlineTitle({
  children,
  tone = "neutral",
  size = "md",
  interactive = false,
  className,
}: {
  children: ReactNode;
  tone?: ClubInlineTitleTone;
  size?: ClubInlineTitleSize;
  /** Tytuł jest linkiem - dodaje sygnał najazdu. */
  interactive?: boolean;
  className?: string;
}) {
  return (
    <span
      data-club-inline-title={tone}
      className={cn(
        "inline-block max-w-full rounded-lg border leading-snug text-foreground",
        "[overflow-wrap:anywhere]",
        TONES[tone],
        SIZES[size],
        interactive && "transition-colors group-hover/title:border-primary/60 hover:text-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}

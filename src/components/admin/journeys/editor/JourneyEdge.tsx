// Krawędź kanwy ścieżki i etykieta gałęzi (S8, SPEC §6.3 „Render”).
//
// GEOMETRIA Z UKŁADU, NIE Z DOM. Ścieżkę (`M x1 y1 V ym H x2 V y2`) i miejsce
// etykiety liczy `layoutJourney` (S8.1) - tu jest wyłącznie rysunek. Kanwa
// trzyma WSZYSTKIE krawędzie w jednym `<svg aria-hidden>` z klasą
// `text-border`, więc kreska bierze `currentColor` z tokenu obramowania i
// zmienia się razem z motywem bez żadnego koloru w kodzie.
//
// `vector-effect="non-scaling-stroke"`: kanwa skaluje treść `transform:
// scale(z)` (50-150 %); bez tego linia przy 50 % byłaby włosem, a przy 150 %
// grubą krechą. Grubość zależy tylko od podświetlenia (ścieżka symulacji),
// nigdy od motywu - geometria identyczna w light/dark.
//
// Scalenie i brakująca gałąź są kreskowane: to nie jest dalszy ciąg drzewa,
// tylko odnośnik („→ dalej jak w kroku …”) albo miejsce na krok.
//
// Etykieta gałęzi jest HTML (czytelna przy każdym powiększeniu, ten sam krój
// co karty), ale `aria-hidden` - nazwę gałęzi czytnik słyszy w nazwie karty
// („Krok 3.1.1 z 7, gałąź „Tak”: …”), więc w trybie przeglądania nie pojawia
// się drugi raz, oderwana od kroku.
import type { JourneyLayoutEdge } from "@/lib/admin/journeys/layout";
import { cn } from "@/lib/utils";

export interface JourneyEdgeProps {
  edge: JourneyLayoutEdge;
  /** Krawędź na podświetlonej ścieżce symulacji. */
  highlighted?: boolean;
}

export function JourneyEdge({ edge, highlighted = false }: JourneyEdgeProps) {
  return (
    <path
      d={edge.path}
      fill="none"
      stroke="currentColor"
      strokeWidth={highlighted ? 2 : 1.5}
      strokeLinejoin="round"
      strokeDasharray={edge.kind === "tree" ? undefined : "4 4"}
      vectorEffect="non-scaling-stroke"
      className={highlighted ? "text-primary" : undefined}
      data-edge-kind={edge.kind}
      data-from={edge.from}
      data-to={edge.to ?? undefined}
      data-branch={edge.branch}
    />
  );
}

export interface JourneyBranchLabelProps {
  edge: JourneyLayoutEdge;
  /** Nazwa gałęzi w języku panelu („Tak”, „Wariant A”, „Minął termin”). */
  text: string;
}

/** Etykieta gałęzi pod rozgałęzieniem; `next` nie ma etykiety (`label: null`). */
export function JourneyBranchLabel({ edge, text }: JourneyBranchLabelProps) {
  if (edge.label === null) return null;
  return (
    <span
      aria-hidden="true"
      data-branch-label={edge.branch}
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-background px-1",
        "text-[11px] font-medium leading-4 text-muted-foreground",
      )}
      style={{ left: edge.label.x, top: edge.label.y }}
    >
      {text}
    </span>
  );
}

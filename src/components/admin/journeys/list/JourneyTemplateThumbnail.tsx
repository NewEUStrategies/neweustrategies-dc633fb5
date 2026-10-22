// Miniatura grafu szablonu w galerii (S8, SPEC §6.3 „statyczny mini-SVG”).
//
// TEN SAM UKŁAD CO KANWA. Miniatura liczy `layoutJourney(buildJourneyView(…))`
// - te same reguły, które rysują kanwę edytora - i pokazuje go w `viewBox`
// w skali ramki. Administrator, który wybrał szablon po kształcie, widzi po
// instalacji dokładnie ten kształt, a nie ilustrację, która się z nim rozjeżdża.
//
// DEKORACJA. Kształt nic nie mówi czytnikowi ekranu (fakty szablonu - liczba
// kroków i maili, wyzwalacz, cel - są obok tekstem), więc SVG jest
// `aria-hidden` i nie przyjmuje fokusu. Kolory wyłącznie z tokenów
// (`currentColor` na `text-border`, karty `fill-card stroke-border`), linie
// `vector-effect="non-scaling-stroke"` - przy każdej skali i w obu motywach
// mają tę samą grubość.
import { useMemo } from "react";

import { layoutJourney, CHIP_H, CHIP_W, NODE_H, NODE_W } from "@/lib/admin/journeys/layout";
import { buildJourneyView, type JourneyGraphLike } from "@/lib/admin/journeys/viewModel";
import { cn } from "@/lib/utils";

/** Margines rysunku w jednostkach układu - ramka nie ucina kart przy brzegu. */
const PAD = 24;

export function JourneyTemplateThumbnail({
  graph,
  className,
}: {
  graph: JourneyGraphLike;
  className?: string;
}) {
  const layout = useMemo(() => layoutJourney(buildJourneyView(graph)), [graph]);
  if (layout.width === 0 || layout.height === 0) return null;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="journey-template-thumbnail"
      viewBox={`${-PAD} ${-PAD} ${layout.width + PAD * 2} ${layout.height + PAD * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("h-24 w-full text-border", className)}
    >
      <g fill="none" stroke="currentColor" strokeWidth={1.5}>
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}-${edge.branch}`}
            d={edge.path}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={edge.kind === "merge" ? "6 6" : undefined}
          />
        ))}
      </g>
      {layout.nodes.map((node) => (
        <rect
          key={node.id}
          x={node.x}
          y={node.y}
          width={NODE_W}
          height={NODE_H}
          rx={18}
          className="fill-card stroke-border"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {layout.chips.map((chip) => (
        <rect
          key={`${chip.from}-${chip.branch}`}
          x={chip.x}
          y={chip.y}
          width={CHIP_W}
          height={CHIP_H}
          rx={CHIP_H / 2}
          className="fill-muted stroke-border"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

// Atom: LEGENDA planu sali - stany miejsc (ksztalt) i kategorie (kolor).
//
// Legenda powtarza te same znaki co `SeatGlyph` (pelne kolo, obrys, obrys
// przerywany, kreskowanie, kwadracik dostepnosci), wiec kazdy stan jest
// opisany slowem, a nie tylko pokazany.
import { useTranslation } from "react-i18next";

import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

ensureSeatingI18n();

export interface SeatLegendCategory {
  id: string;
  name: string;
  color: string;
}

type Mark = "available" | "occupied" | "held" | "blocked" | "accessible" | "selected";

const MARKS: readonly Mark[] = ["available", "occupied", "held", "blocked", "accessible", "selected"];

const MARK_LABEL_KEYS: Record<Mark, string> = {
  available: "adminEventSeating.legend.available",
  occupied: "adminEventSeating.legend.occupied",
  held: "adminEventSeating.legend.held",
  blocked: "adminEventSeating.legend.blocked",
  accessible: "adminEventSeating.legend.accessible",
  selected: "adminEventSeating.legend.selected",
};

function MarkIcon({ mark }: { mark: Mark }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted-foreground" aria-hidden="true">
      {mark === "selected" ? (
        <circle cx={10} cy={10} r={8.5} className="fill-none stroke-brand" strokeWidth={2} />
      ) : null}
      <circle
        cx={10}
        cy={10}
        r={6}
        fill={mark === "occupied" ? "currentColor" : "transparent"}
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={mark === "held" ? "3 2" : undefined}
      />
      {mark === "blocked" ? (
        <path d="M5 14 L14 5 M7 16 L16 7" stroke="currentColor" strokeWidth={1.5} />
      ) : null}
      {mark === "accessible" ? <rect x={8} y={8} width={4} height={4} fill="currentColor" /> : null}
    </svg>
  );
}

export function SeatMapLegend({ categories }: { categories: readonly SeatLegendCategory[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="seat-legend-title" className="space-y-2">
      <h3 id="seat-legend-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("adminEventSeating.legend.title")}
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
        {MARKS.map((mark) => (
          <li key={mark} className="flex items-center gap-1.5">
            <MarkIcon mark={mark} />
            {t(MARK_LABEL_KEYS[mark])}
          </li>
        ))}
        {categories.map((category) => (
          <li key={category.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: category.color }}
            />
            {category.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

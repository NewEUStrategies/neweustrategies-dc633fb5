// Atom: JEDNO miejsce na plotnie planu sali (element SVG).
//
// STAN NIE JEST NIESIONY SAMYM KOLOREM. Kolor to kategoria (VIP, Prasa), wiec
// stan miejsca ma wlasny, niezalezny od koloru kanal: zajete = pelne kolo,
// wolne = sam obrys, rezerwacja = obrys przerywany, blokada = kreskowanie
// (wzor `seat-hatch` z `<defs>` plotna), zaznaczenie = zewnetrzny pierscien
// tokenem `--brand`. Uzytkownik z zaburzeniem widzenia barw odroznia stany
// ksztaltem, a czytnik ekranu - z `aria-label`.
//
// ROVING TABINDEX: tylko jedno miejsce planu ma `tabIndex=0` (reszta -1), wiec
// plotno jest JEDNYM przystankiem tabulacji, a po miejscach chodzi sie
// strzalkami (obsluga klawiszy siedzi w plotnie, tu tylko ja przekazujemy).
import { memo, type KeyboardEvent } from "react";

import type { SeatStatus } from "@/lib/events/seatingApi";

export interface SeatGlyphProps {
  seatId: string;
  cx: number;
  cy: number;
  r: number;
  /** Kolor kategorii (#RRGGBB) albo `null` = neutralny token. */
  color: string | null;
  status: SeatStatus;
  occupied: boolean;
  accessible: boolean;
  selected: boolean;
  tabStop: boolean;
  label: string;
  onActivate: (seatId: string, extend: boolean) => void;
  onKey: (seatId: string, event: KeyboardEvent<SVGGElement>) => void;
  onFocusSeat: (seatId: string) => void;
}

function SeatGlyphImpl({
  seatId,
  cx,
  cy,
  r,
  color,
  status,
  occupied,
  accessible,
  selected,
  tabStop,
  label,
  onActivate,
  onKey,
  onFocusSeat,
}: SeatGlyphProps) {
  const stroke = color ?? "currentColor";
  const fill =
    status === "blocked"
      ? "url(#seat-hatch)"
      : occupied
        ? (color ?? "currentColor")
        : "transparent";
  return (
    <g
      role="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-seat-id={seatId}
      data-status={status}
      data-occupied={occupied ? "true" : "false"}
      className="group cursor-pointer text-muted-foreground outline-none"
      onClick={(event) => onActivate(seatId, event.shiftKey || event.metaKey || event.ctrlKey)}
      onKeyDown={(event) => onKey(seatId, event)}
      onFocus={() => onFocusSeat(seatId)}
    >
      {selected ? (
        <circle cx={cx} cy={cy} r={r + 4} className="fill-none stroke-brand" strokeWidth={3} />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={r + 7}
        className="fill-none stroke-foreground opacity-0 group-focus-visible:opacity-100"
        strokeWidth={2}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={status === "held" ? "4 3" : undefined}
      />
      {accessible ? (
        <rect
          x={cx - r * 0.35}
          y={cy - r * 0.35}
          width={r * 0.7}
          height={r * 0.7}
          className={occupied ? "fill-background" : "fill-foreground"}
        />
      ) : null}
    </g>
  );
}

/** Memo: przerysowanie jednego miejsca nie odswieza tysiaca sasiadow. */
export const SeatGlyph = memo(SeatGlyphImpl);

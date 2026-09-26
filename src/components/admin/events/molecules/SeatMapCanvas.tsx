// Molekula: PLOTNO planu sali (SVG) - scena, sekcje, miejsca.
//
// PARAMETRY, NIE RYSUNEK. Miejsca przychodza z bazy z LOKALNYMI wspolrzednymi
// sekcji; plotno przenosi je na plan (`toMapPoint`: poczatek + obrot sekcji).
// Organizator nie rysuje krzesla po krzesle - edytuje parametry sekcji
// w dialogu, a tutaj widzi wynik.
//
// JEDEN CEL UPUSZCZENIA, NIE TYSIAC. Przeciagniecie uczestnika na miejsce
// rejestruje JEDNO `useDroppable` na cale plotno; konkretne miejsce rozstrzyga
// organizm z elementu pod wskaznikiem (`data-seat-id`). Po jednym droppable na
// krzeslo dawaloby 2000 obserwatorow kolizji przy kazdym ruchu myszy.
//
// KLAWIATURA: roving tabindex (jedno miejsce w tabulacji), strzalki po
// sasiadach (`nextSeatId`), Enter/spacja = aktywacja (zaznacz albo posadz
// wybrana osobe), Shift+Enter = dodaj do zaznaczenia, Delete = zwolnij.
// Widok tabeli (`SeatMapTable`) jest zawsze dostepny obok - plotno nigdy nie
// jest jedyna droga do miejsca.
import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";

import { SeatGlyph } from "@/components/admin/events/atoms/SeatGlyph";
import type { Seat, SeatAssignment, SeatMapDetail, SeatSection } from "@/lib/events/seatingApi";
import {
  boundsOf,
  isSeatNavKey,
  nextSeatId,
  orderSeats,
  planViewBox,
  seatRadius,
  toMapPoint,
  type Point,
} from "@/lib/events/seatingGeometry";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";
import { cn } from "@/lib/utils";

ensureSeatingI18n();

/** Identyfikator jedynego celu upuszczenia na plotnie (czyta go organizm). */
export const SEAT_CANVAS_DROP_ID = "seat-map-canvas";

export interface SeatMapCanvasProps {
  detail: SeatMapDetail;
  selected: ReadonlySet<string>;
  occupantBySeat: ReadonlyMap<string, SeatAssignment>;
  labelFor: (seat: Seat) => string;
  onActivate: (seatId: string, extend: boolean) => void;
  onRelease: (seatId: string) => void;
}

interface PlacedSeat extends Point {
  seat: Seat;
}

interface SectionLayerProps {
  section: SeatSection;
  seats: readonly PlacedSeat[];
  radius: number;
  colorOf: (seat: Seat, section: SeatSection) => string | null;
  selected: ReadonlySet<string>;
  occupantBySeat: ReadonlyMap<string, SeatAssignment>;
  tabStopId: string | null;
  labelFor: (seat: Seat) => string;
  onActivate: (seatId: string, extend: boolean) => void;
  onKey: (seatId: string, event: KeyboardEvent<SVGGElement>) => void;
  onFocusSeat: (seatId: string) => void;
}

const SectionLayer = memo(function SectionLayer({
  section,
  seats,
  radius,
  colorOf,
  selected,
  occupantBySeat,
  tabStopId,
  labelFor,
  onActivate,
  onKey,
  onFocusSeat,
}: SectionLayerProps) {
  const labelPoint = { x: section.originX, y: section.originY - radius * 2.2 };
  return (
    <g data-section-id={section.id}>
      <text
        x={labelPoint.x}
        y={labelPoint.y}
        className="fill-muted-foreground text-[14px] font-semibold"
        aria-hidden="true"
      >
        {section.label}
      </text>
      {seats.map(({ seat, x, y }) => (
        <SeatGlyph
          key={seat.id}
          seatId={seat.id}
          cx={x}
          cy={y}
          r={radius}
          color={colorOf(seat, section)}
          status={seat.status}
          occupied={occupantBySeat.has(seat.id)}
          accessible={seat.isAccessible}
          selected={selected.has(seat.id)}
          tabStop={seat.id === tabStopId}
          label={labelFor(seat)}
          onActivate={onActivate}
          onKey={onKey}
          onFocusSeat={onFocusSeat}
        />
      ))}
    </g>
  );
});

export function SeatMapCanvas({
  detail,
  selected,
  occupantBySeat,
  labelFor,
  onActivate,
  onRelease,
}: SeatMapCanvasProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const { setNodeRef, isOver } = useDroppable({ id: SEAT_CANVAS_DROP_ID });

  const categoryColor = useMemo(
    () => new Map(detail.categories.map((category) => [category.id, category.color])),
    [detail.categories],
  );

  // Warstwy sekcji w kolejnosci planu; miejsce przenosimy na plan RAZ na zmiane danych.
  const layers = useMemo(() => {
    const bySection = new Map<string, Seat[]>();
    for (const seat of detail.seats) {
      const list = bySection.get(seat.sectionId);
      if (list === undefined) bySection.set(seat.sectionId, [seat]);
      else list.push(seat);
    }
    return detail.sections.map((section, index) => ({
      section,
      index,
      seats: (bySection.get(section.id) ?? []).map((seat) => ({
        seat,
        ...toMapPoint(seat, section),
      })),
    }));
  }, [detail.seats, detail.sections]);

  const ordered = useMemo(
    () =>
      orderSeats(
        layers.flatMap((layer) =>
          layer.seats.map(({ seat }) => ({
            id: seat.id,
            sectionId: seat.sectionId,
            sectionOrder: layer.index,
            sortKey: seat.sortKey,
          })),
        ),
      ),
    [layers],
  );

  const tabStopId =
    focusId !== null && ordered.some((seat) => seat.id === focusId)
      ? focusId
      : (ordered[0]?.id ?? null);

  const colorOf = useCallback(
    (seat: Seat, section: SeatSection): string | null => {
      const categoryId = seat.categoryId ?? section.categoryId;
      return categoryId === null ? null : (categoryColor.get(categoryId) ?? null);
    },
    [categoryColor],
  );

  const onKey = useCallback(
    (seatId: string, event: KeyboardEvent<SVGGElement>) => {
      if (isSeatNavKey(event.key)) {
        event.preventDefault();
        const next = nextSeatId(ordered, seatId, event.key);
        setFocusId(next);
        const target = svgRef.current?.querySelector<SVGGElement>(`[data-seat-id="${next}"]`);
        target?.focus();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onActivate(seatId, event.shiftKey);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onRelease(seatId);
      }
    },
    [onActivate, onRelease, ordered],
  );

  const allPoints: Point[] = layers.flatMap((layer) => layer.seats);
  const stage = detail.map.stage;
  if (stage !== null) {
    allPoints.push({ x: stage.x, y: stage.y }, { x: stage.x + stage.w, y: stage.y + stage.h });
  }
  const pitch = detail.sections[0]?.seatPitch ?? 50;
  const viewBox = planViewBox(detail.map.width, detail.map.height, boundsOf(allPoints, pitch));
  const instructionsId = `seat-canvas-help-${detail.map.id}`;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "overflow-auto rounded-[6px] border border-border bg-card p-2",
        isOver ? "ring-2 ring-inset ring-brand" : null,
      )}
    >
      <p id={instructionsId} className="sr-only">
        {t("adminEventSeating.canvas.instructions")}
      </p>
      <svg
        ref={svgRef}
        role="group"
        aria-label={t("adminEventSeating.canvas.label", { name: detail.map.name })}
        aria-describedby={instructionsId}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto max-h-[70vh] w-full"
      >
        <defs>
          <pattern
            id="seat-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" />
          </pattern>
        </defs>
        <rect
          x={0}
          y={0}
          width={detail.map.width}
          height={detail.map.height}
          className="fill-none stroke-border"
          strokeDasharray="8 6"
        />
        {stage === null ? null : (
          <g aria-hidden="true">
            <rect
              x={stage.x}
              y={stage.y}
              width={stage.w}
              height={stage.h}
              rx={8}
              className="fill-muted stroke-border"
            />
            <text
              x={stage.x + stage.w / 2}
              y={stage.y + stage.h / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[18px] font-semibold"
            >
              {t("adminEventSeating.canvas.stage")}
            </text>
          </g>
        )}
        {layers.map(({ section, seats }) => (
          <SectionLayer
            key={section.id}
            section={section}
            seats={seats}
            radius={seatRadius(section.seatPitch, section.rowPitch)}
            colorOf={colorOf}
            selected={selected}
            occupantBySeat={occupantBySeat}
            tabStopId={tabStopId}
            labelFor={labelFor}
            onActivate={onActivate}
            onKey={onKey}
            onFocusSeat={setFocusId}
          />
        ))}
      </svg>
    </div>
  );
}

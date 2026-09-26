// Atom: MINI-MAPA miejsca uczestnika na sali.
//
// RYSUJE WYLACZNIE TO, CO PRZYSZLO Z `event_my_seats`: scene (jesli plan ja
// ma) i miejsca WLASNEJ sekcji uczestnika, z wyroznionym "moim". Baza nie oddaje
// cudzych miejsc ani ich stanow, wiec mapa nie ma czego zdradzic.
//
// DETERMINISTYCZNA: ten sam SVG na serwerze i w przegladarce (zero zegara,
// losowania i pomiarow DOM) - karta renderuje sie pod SSR-owym layoutem
// wydarzenia i przechodzi test hydratacji.
//
// DOSTEPNOSC: grafika ma nazwe (`role="img"` + `aria-label` z pelna etykieta
// miejsca), a ta sama informacja stoi obok tekstem - mapa nigdy nie jest
// jedynym nosnikiem.
import { useTranslation } from "react-i18next";

import type { MySeatGeometry } from "@/lib/events/mySeatsApi";
import { boundsOf, seatRadius, toMapPoint, type Point } from "@/lib/events/seatingGeometry";
import { ensureEventSeatingI18n } from "@/lib/i18n-event-seating";

ensureEventSeatingI18n();

export function SeatMiniMap({ geometry, label }: { geometry: MySeatGeometry; label: string }) {
  const { t } = useTranslation();
  const { section, stage } = geometry;
  const radius = seatRadius(section.seatPitch, section.rowPitch);
  const seats = geometry.seats.map((seat) => ({
    ...toMapPoint(seat, section),
    mine: seat.mine,
  }));
  const corners: Point[] = [...seats];
  if (stage !== null) {
    corners.push({ x: stage.x, y: stage.y }, { x: stage.x + stage.w, y: stage.y + stage.h });
  }
  const box = boundsOf(corners, Math.max(section.seatPitch, radius * 2));
  const viewBox = `${box.minX} ${box.minY} ${box.maxX - box.minX} ${box.maxY - box.minY}`;

  return (
    <svg
      role="img"
      aria-label={t("eventSeating.map.label", { seat: label })}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="h-40 w-full rounded-[6px] border border-border bg-muted/30"
    >
      {stage === null ? null : (
        <g>
          <rect
            x={stage.x}
            y={stage.y}
            width={stage.w}
            height={stage.h}
            rx={6}
            className="fill-muted stroke-border"
          />
          <text
            x={stage.x + stage.w / 2}
            y={stage.y + stage.h / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            fontSize={Math.max(12, Math.min(stage.h * 0.4, 48))}
          >
            {t("eventSeating.map.stage")}
          </text>
        </g>
      )}
      {seats.map((seat, index) => (
        <circle
          key={index}
          cx={seat.x}
          cy={seat.y}
          r={seat.mine ? radius * 1.35 : radius}
          data-mine={seat.mine ? "true" : undefined}
          className={seat.mine ? "fill-primary stroke-primary" : "fill-muted-foreground/30"}
        />
      ))}
    </svg>
  );
}

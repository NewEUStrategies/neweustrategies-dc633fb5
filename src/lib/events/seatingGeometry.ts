// Geometria planu sali - czyste funkcje, bez Reacta i bez przegladarki.
//
// LUSTRO SQL. `generateSectionSeats()` liczy uklad LOKALNY miejsc sekcji ta
// sama formula co `_event_seat_section_layout()` w migracji 20260926130000.
// Baza materializuje miejsca przy zapisie sekcji; ten modul liczy to samo
// w przegladarce, zeby dialog sekcji pokazal podglad NA ZYWO, zanim cokolwiek
// zostanie zapisane. Zgodnosc obu stron pilnuje `seatingGeometryParity.test.ts`,
// ktory czyta zloty wzorzec z asercji events-harness (`65_seating.sql`).
//
// WSPOLRZEDNE: miejsce ma wspolrzedne LOKALNE sekcji, a sekcja - poczatek
// i obrot. `toMapPoint()` przenosi punkt lokalny na plan. Dzieki temu
// przesuniecie sekcji to jedna zmiana w bazie, a nie przepisanie tysiaca
// wierszy.
//
// DETERMINIZM (SSR/hydratacja): zero `Math.random`, zegara i stref czasowych -
// ten sam wynik na serwerze i w przegladarce, takze w mini-mapie uczestnika.
import type {
  SeatNumbering,
  SeatRowLabelScheme,
  SeatSectionKind,
  SeatTableShape,
} from "@/lib/events/seatingApi";

export interface SectionLayoutParams {
  kind: SeatSectionKind;
  rowsCount: number | null;
  seatsPerRow: number | null;
  rowLabelScheme: SeatRowLabelScheme | null;
  rowLabelStart: number;
  seatNumbering: SeatNumbering | null;
  seatNumberStart: number;
  seatPitch: number;
  rowPitch: number;
  aisleAfter: readonly number[];
  tableShape: SeatTableShape | null;
  tableSeats: number | null;
}

export interface LayoutSeat {
  rowLabel: string | null;
  seatNumber: number;
  x: number;
  y: number;
  sortKey: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Zaokraglenie do setnych jak `round(numeric, 2)` w PostgreSQL: polowka OD
 * ZERA (JS-owe `Math.round` zaokragla polowke w strone +nieskonczonosci).
 * `+ 0` zamienia `-0` na `0`, zeby `-0.00` z cosinusa nie rozjechal porownan.
 */
export function roundCoord(value: number): number {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  return (value < 0 ? -rounded : rounded) + 0;
}

/** Etykieta rzedu: `alpha` = A..Z, AA..AZ (bijektywna podstawa 26), `numeric` = numer. */
export function rowLabel(scheme: SeatRowLabelScheme, index: number): string {
  if (scheme === "numeric") return String(index);
  let n = index;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** Numer miejsca w rzedzie dla pozycji fizycznej `p` (0 = skrajnie lewe). */
function rowSeatNumber(numbering: SeatNumbering, p: number, perRow: number, start: number): number {
  if (numbering === "ltr") return start + p;
  if (numbering === "rtl") return start + (perRow - 1 - p);
  // Od srodka: nieparzyste w lewo, parzyste w prawo.
  const left = Math.floor((perRow + 1) / 2);
  const base = p < left ? 2 * (left - 1 - p) + 1 : 2 * (p - left + 1);
  return start - 1 + base;
}

function rowsLayout(params: SectionLayoutParams): LayoutSeat[] {
  const rows = params.rowsCount ?? 0;
  const perRow = params.seatsPerRow ?? 0;
  const scheme = params.rowLabelScheme ?? "alpha";
  const numbering = params.seatNumbering ?? "ltr";
  const out: LayoutSeat[] = [];
  for (let r = 0; r < rows; r += 1) {
    const label = rowLabel(scheme, params.rowLabelStart + r);
    for (let p = 0; p < perRow; p += 1) {
      const aisles = params.aisleAfter.filter((after) => after <= p).length;
      out.push({
        rowLabel: label,
        seatNumber: rowSeatNumber(numbering, p, perRow, params.seatNumberStart),
        x: roundCoord((p + aisles) * params.seatPitch),
        y: roundCoord(r * params.rowPitch),
        sortKey: r * 1000 + p,
      });
    }
  }
  return out;
}

/** Promien stolu okraglego - nie mniejszy niz jeden rozstaw miejsc. */
export function roundTableRadius(seatPitch: number, seats: number): number {
  return Math.max(seatPitch, Math.ceil((seatPitch * seats) / (2 * Math.PI)));
}

function tableLayout(params: SectionLayoutParams): LayoutSeat[] {
  const n = params.tableSeats ?? 0;
  const out: LayoutSeat[] = [];
  if (params.tableShape === "rect") {
    const top = Math.floor((n + 1) / 2);
    for (let i = 0; i < n; i += 1) {
      const onTop = i < top;
      out.push({
        rowLabel: null,
        seatNumber: params.seatNumberStart + i,
        x: roundCoord((onTop ? i : top - 1 - (i - top)) * params.seatPitch),
        y: roundCoord(onTop ? 0 : params.rowPitch),
        sortKey: i,
      });
    }
    return out;
  }
  const radius = roundTableRadius(params.seatPitch, n);
  for (let i = 0; i < n; i += 1) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.push({
      rowLabel: null,
      seatNumber: params.seatNumberStart + i,
      x: roundCoord(radius * Math.cos(angle)),
      y: roundCoord(radius * Math.sin(angle)),
      sortKey: i,
    });
  }
  return out;
}

/** Uklad lokalny miejsc sekcji - lustro `_event_seat_section_layout()`. */
export function generateSectionSeats(params: SectionLayoutParams): LayoutSeat[] {
  return params.kind === "rows" ? rowsLayout(params) : tableLayout(params);
}

export interface SectionPlacement {
  originX: number;
  originY: number;
  rotationDeg: number;
}

/** Punkt lokalny sekcji -> punkt planu (obrot wokol poczatku sekcji). */
export function toMapPoint(point: Point, placement: SectionPlacement): Point {
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: roundCoord(placement.originX + point.x * cos - point.y * sin),
    y: roundCoord(placement.originY + point.x * sin + point.y * cos),
  };
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Obrys zbioru punktow powiekszony o margines; pusty zbior = pudelko w zerze. */
export function boundsOf(points: readonly Point[], margin = 0): Box {
  if (points.length === 0) return { minX: -margin, minY: -margin, maxX: margin, maxY: margin };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** Promien kolka miejsca - mniejszy z rozstawow, zeby sasiedzi sie nie zlewali. */
export function seatRadius(seatPitch: number, rowPitch: number): number {
  return roundCoord(Math.min(seatPitch, rowPitch) * 0.38);
}

/** Atrybut `viewBox` planu: caly plan plus zawartosc, ktora z niego wystaje. */
export function planViewBox(width: number, height: number, content: Box): string {
  const minX = Math.min(0, content.minX);
  const minY = Math.min(0, content.minY);
  const maxX = Math.max(width, content.maxX);
  const maxY = Math.max(height, content.maxY);
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

// ---------------------------------------------------------------------------
// NAWIGACJA KLAWIATURA (roving tabindex na plotnie)
// ---------------------------------------------------------------------------

export interface NavigableSeat {
  id: string;
  sectionId: string;
  /** Kolejnosc sekcji na planie (indeks w liscie sekcji). */
  sectionOrder: number;
  sortKey: number;
}

export type SeatNavKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export const SEAT_NAV_KEYS: readonly SeatNavKey[] = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
];

export function isSeatNavKey(key: string): key is SeatNavKey {
  return (SEAT_NAV_KEYS as readonly string[]).includes(key);
}

/** Miejsca w kolejnosci czytania: sekcja po sekcji, w sekcji po `sort_key`. */
export function orderSeats<T extends NavigableSeat>(seats: readonly T[]): T[] {
  return [...seats].sort((a, b) => a.sectionOrder - b.sectionOrder || a.sortKey - b.sortKey);
}

/**
 * Nastepne miejsce dla klawisza. Strzalki w lewo/prawo ida po kolejnosci
 * czytania (takze przez granice sekcji), w gore/dol - do tej samej pozycji
 * w sasiednim rzedzie tej samej sekcji (`sort_key = rzad * 1000 + pozycja`;
 * stol ma jeden "rzad", wiec gora/dol dzialaja tam jak lewo/prawo). Home/End -
 * pierwsze i ostatnie miejsce planu. Brak ruchu = to samo miejsce.
 */
export function nextSeatId(
  ordered: readonly NavigableSeat[],
  currentId: string,
  key: SeatNavKey,
): string {
  const index = ordered.findIndex((seat) => seat.id === currentId);
  if (index === -1) return ordered[0]?.id ?? currentId;
  if (key === "Home") return ordered[0].id;
  if (key === "End") return ordered[ordered.length - 1].id;
  if (key === "ArrowLeft") return ordered[Math.max(0, index - 1)].id;
  if (key === "ArrowRight") return ordered[Math.min(ordered.length - 1, index + 1)].id;

  const current = ordered[index];
  const row = Math.floor(current.sortKey / 1000);
  const position = current.sortKey % 1000;
  const sameSection = ordered.filter((seat) => seat.sectionId === current.sectionId);
  const rows = [...new Set(sameSection.map((seat) => Math.floor(seat.sortKey / 1000)))];
  if (rows.length === 1) {
    return nextSeatId(ordered, currentId, key === "ArrowUp" ? "ArrowLeft" : "ArrowRight");
  }
  const targetRow = key === "ArrowUp" ? row - 1 : row + 1;
  const candidates = sameSection.filter((seat) => Math.floor(seat.sortKey / 1000) === targetRow);
  if (candidates.length === 0) return currentId;
  let best = candidates[0];
  for (const seat of candidates) {
    if (Math.abs((seat.sortKey % 1000) - position) < Math.abs((best.sortKey % 1000) - position)) {
      best = seat;
    }
  }
  return best.id;
}
